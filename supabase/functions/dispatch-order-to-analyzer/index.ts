// AI-Powered Order Dispatch
// For push analyzers, stores an outbound ORM^O01 order.
// For analyzer-initiated worklist analyzers, stores an ORR^O02 response payload
// that the bridge can serve when the analyzer queries by sample barcode.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { GoogleGenerativeAI } from 'npm:@google/generative-ai'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface TestMapping {
  lims_code: string
  analyzer_code: string
  analyzer_display?: string | null
  analyzer_code_system?: string | null
  mapping_type?: string
  direction?: string
  hl7_field?: string | null
  value_map?: Record<string, unknown>
  metadata?: Record<string, unknown>
  confidence: number
  from_cache: boolean
  source?: 'lab_mapping' | 'profile_mapping' | 'ai' | 'fallback'
}

interface OrderPayload {
  order_id: string
  sample_barcode: string
  analyzer_connection_id: string
  tests: string[]
  patient?: {
    name: string
    dob?: string
    gender?: string
  }
  priority?: number
}

function normalizeHl7Sex(gender?: string): string {
  const value = (gender || '').trim().toLowerCase()
  if (!value) return ''
  if (['m', 'male'].includes(value)) return 'M'
  if (['f', 'female'].includes(value)) return 'F'
  if (['o', 'other', 'non-binary', 'nonbinary'].includes(value)) return 'O'
  if (['u', 'unknown', 'undisclosed', 'na', 'n/a'].includes(value)) return 'U'
  return String(gender).trim().slice(0, 1).toUpperCase()
}

function compactHl7Timestamp(date = new Date()): string {
  return date.toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)
}

function formatHl7Dob(dob?: string): string {
  if (!dob) return ''
  const digits = String(dob).replace(/\D/g, '')
  if (digits.length >= 14) return digits.slice(0, 14)
  if (digits.length >= 8) return `${digits.slice(0, 8)}000000`

  const parsed = new Date(dob)
  if (Number.isNaN(parsed.getTime())) return ''
  return `${parsed.toISOString().slice(0, 10).replace(/-/g, '')}000000`
}

function getProfileSetting(profile: any, key: string, fallback = ''): string {
  return String(profile?.connection_settings?.[key] ?? profile?.[key] ?? fallback)
}

function isAnalyzerInitiated(profile: any, connection: any): boolean {
  const flow = connection?.config?.worklist_flow ?? profile?.connection_settings?.worklist_flow
  const responseType = profile?.ai_parsing_hints?.worklist_response_type
  return flow === 'analyzer_initiated' || responseType === 'ORR^O02'
}

function universalServiceId(test: TestMapping, profile: any): string {
  const fromMetadata = test.metadata?.universal_service_id
  if (typeof fromMetadata === 'string' && fromMetadata) return fromMetadata
  if (test.analyzer_code.includes('^')) return test.analyzer_code

  const display = test.analyzer_display || test.lims_code
  const system = test.analyzer_code_system || getProfileSetting(profile, 'obr4_coding_system', 'LOCAL')
  return `${test.analyzer_code}^${display}^${system}`
}

function buildHl7Payload(
  payload: OrderPayload,
  mappedTests: TestMapping[],
  profile: any,
  messageControlId: string,
  messageType: 'ORM^O01' | 'ORR^O02',
) {
  const timestamp = compactHl7Timestamp()
  const patientSuffix = getProfileSetting(profile, 'patient_id_suffix', '')
  const diagnosticServiceId = getProfileSetting(profile, 'diagnostic_service_id', '')
  const characterSet = profile?.hl7_character_set || profile?.connection_settings?.character_set || ''
  const protocolVersion = profile?.protocol_version || profile?.connection_settings?.hl7_version || '2.5.1'

  return {
    message: {
      type: messageType,
      control_id: messageControlId,
      timestamp,
      protocol_version: protocolVersion,
      character_set: characterSet,
    },
    patient: {
      id: `${payload.sample_barcode}${patientSuffix}`,
      name: payload.patient?.name || '',
      dob: formatHl7Dob(payload.patient?.dob),
      gender: normalizeHl7Sex(payload.patient?.gender),
    },
    orc: {
      order_control: messageType === 'ORR^O02'
        ? getProfileSetting(profile, 'order_control_orr', 'AF')
        : getProfileSetting(profile, 'order_control_orm', 'NW'),
      placer_order_number: payload.sample_barcode,
      order_status: getProfileSetting(profile, 'order_status_orm', 'IP'),
    },
    obr: mappedTests.map((test, index) => ({
      set_id: index + 1,
      placer_order_number: payload.sample_barcode,
      filler_order_number: messageType === 'ORR^O02' ? payload.sample_barcode : '',
      universal_service_id: universalServiceId(test, profile),
      priority: payload.priority === 1 ? 'S' : 'R',
      requested_datetime: timestamp,
      diagnostic_serv_sect_id: diagnosticServiceId,
      lims_code: test.lims_code,
    })),
    obx: messageType === 'ORR^O02'
      ? [
          {
            set_id: 1,
            value_type: 'IS',
            observation_id: '08002^Blood Mode^99MRC',
            value: String(mappedTests[0]?.value_map?.blood_mode ?? 'W'),
            status: 'F',
          },
          {
            set_id: 2,
            value_type: 'IS',
            observation_id: '08003^Test Mode^99MRC',
            value: String(mappedTests[0]?.value_map?.test_mode ?? 'CBC+DIFF'),
            status: 'F',
          },
        ]
      : [],
  }
}

function generateHL7Order(
  payload: OrderPayload,
  mappedTests: TestMapping[],
  messageControlId: string,
  profile: any,
): { hl7Message: string; hl7Payload: Record<string, unknown> } {
  const hl7Payload = buildHl7Payload(payload, mappedTests, profile, messageControlId, 'ORM^O01')
  const p = hl7Payload as any
  const segments: string[] = []

  segments.push([
    'MSH',
    '^~\\&',
    'LIMSV2',
    'LAB',
    'ANALYZER',
    'ANALYZER',
    p.message.timestamp,
    '',
    'ORM^O01',
    messageControlId,
    'P',
    p.message.protocol_version,
  ].join('|'))

  if (payload.patient) {
    segments.push([
      'PID',
      '1',
      '',
      p.patient.id,
      '',
      p.patient.name,
      '',
      p.patient.dob,
      p.patient.gender,
    ].join('|'))
  }

  segments.push([
    'ORC',
    p.orc.order_control,
    p.orc.placer_order_number,
    '',
    '',
    p.orc.order_status,
  ].join('|'))

  for (const obr of p.obr) {
    segments.push([
      'OBR',
      String(obr.set_id),
      obr.placer_order_number,
      obr.filler_order_number,
      obr.universal_service_id,
      obr.priority,
      obr.requested_datetime,
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
    ].join('|'))
  }

  return { hl7Message: segments.join('\r') + '\r', hl7Payload }
}

function generateHL7WorklistResponse(
  payload: OrderPayload,
  mappedTests: TestMapping[],
  messageControlId: string,
  profile: any,
): { hl7Message: string; hl7Payload: Record<string, unknown> } {
  const hl7Payload = buildHl7Payload(payload, mappedTests, profile, messageControlId, 'ORR^O02')
  const p = hl7Payload as any
  const segments: string[] = []

  segments.push([
    'MSH',
    '^~\\&',
    'LIMSV2',
    'LAB',
    'ANALYZER',
    '',
    p.message.timestamp,
    '',
    'ORR^O02',
    messageControlId,
    'P',
    p.message.protocol_version,
    '',
    '',
    '',
    '',
    '',
    p.message.character_set,
  ].join('|'))

  segments.push(['MSA', 'AA', messageControlId].join('|'))
  segments.push([
    'PID',
    '1',
    '',
    p.patient.id,
    '',
    p.patient.name,
    '',
    p.patient.dob,
    p.patient.gender,
  ].join('|'))
  segments.push(['ORC', p.orc.order_control, p.orc.placer_order_number].join('|'))

  for (const obr of p.obr) {
    segments.push([
      'OBR',
      String(obr.set_id),
      obr.placer_order_number,
      obr.filler_order_number,
      obr.universal_service_id,
      '',
      obr.requested_datetime,
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      obr.requested_datetime,
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      obr.diagnostic_serv_sect_id,
    ].join('|'))
  }

  for (const obx of p.obx) {
    segments.push([
      'OBX',
      String(obx.set_id),
      obx.value_type,
      obx.observation_id,
      '',
      obx.value,
      '',
      '',
      '',
      '',
      '',
      obx.status,
    ].join('|'))
  }

  return { hl7Message: segments.join('\r') + '\r', hl7Payload }
}

async function mapTestCodesWithAI(
  supabase: any,
  genAI: GoogleGenerativeAI,
  labId: string,
  analyzerProfileId: string,
  analyzerConnectionId: string | null,
  limsCodes: string[],
): Promise<TestMapping[]> {
  const mappedTests: TestMapping[] = []
  const unmappedCodes: string[] = []

  const pushMapping = (limsCode: string, row: any, source: TestMapping['source']) => {
    mappedTests.push({
      lims_code: limsCode,
      analyzer_code: row.analyzer_code,
      analyzer_display: row.analyzer_display ?? null,
      analyzer_code_system: row.analyzer_code_system ?? null,
      mapping_type: row.mapping_type ?? 'order_service',
      direction: row.direction ?? 'outbound',
      hl7_field: row.hl7_field ?? null,
      value_map: row.value_map ?? {},
      metadata: row.metadata ?? {},
      confidence: row.ai_confidence ?? 1,
      from_cache: true,
      source,
    })
  }

  const profileMappings = new Map<string, any>()
  const { data: profileRows } = await supabase
    .from('analyzer_profile_code_mappings')
    .select('*')
    .eq('analyzer_profile_id', analyzerProfileId)
    .eq('mapping_type', 'order_service')
    .in('direction', ['outbound', 'bidirectional'])
    .eq('is_active', true)
    .in('lims_code', limsCodes)

  for (const row of profileRows ?? []) {
    profileMappings.set(String(row.lims_code).toUpperCase(), row)
  }

  const labMappings = new Map<string, any>()
  let labQuery = supabase
    .from('test_mappings')
    .select('*')
    .eq('lab_id', labId)
    .eq('mapping_type', 'order_service')
    .in('direction', ['outbound', 'bidirectional'])
    .in('lims_code', limsCodes)

  if (analyzerConnectionId) {
    labQuery = labQuery.or(`analyzer_connection_id.eq.${analyzerConnectionId},analyzer_profile_id.eq.${analyzerProfileId},analyzer_id.eq.${analyzerProfileId}`)
  } else {
    labQuery = labQuery.or(`analyzer_profile_id.eq.${analyzerProfileId},analyzer_id.eq.${analyzerProfileId}`)
  }

  const { data: labRows } = await labQuery
  for (const row of labRows ?? []) {
    labMappings.set(String(row.lims_code).toUpperCase(), row)
  }

  for (const limsCode of limsCodes) {
    const key = String(limsCode).toUpperCase()
    const labMapping = labMappings.get(key)
    const profileMapping = profileMappings.get(key)

    if (labMapping) {
      pushMapping(limsCode, labMapping, 'lab_mapping')
    } else if (profileMapping) {
      pushMapping(limsCode, profileMapping, 'profile_mapping')
    } else {
      unmappedCodes.push(limsCode)
    }
  }

  if (unmappedCodes.length > 0) {
    const { data: profile } = await supabase
      .from('analyzer_profiles')
      .select('*')
      .eq('id', analyzerProfileId)
      .single()

    const { data: existingMappings } = await supabase
      .from('test_mappings')
      .select('lims_code, analyzer_code')
      .eq('lab_id', labId)
      .or(`analyzer_id.eq.${analyzerProfileId},analyzer_profile_id.eq.${analyzerProfileId}`)
      .gt('usage_count', 0)
      .limit(50)

    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })
    const prompt = `You are a laboratory interface expert. Map LIMS test codes to analyzer order service codes.

ANALYZER PROFILE:
- Manufacturer: ${profile?.manufacturer || 'Unknown'}
- Model: ${profile?.model || 'Unknown'}
- Protocol: ${profile?.protocol || 'HL7'}
- Supported Tests: ${profile?.supported_tests?.join(', ') || 'Various'}

EXISTING SUCCESSFUL MAPPINGS:
${existingMappings?.map((m: any) => `${m.lims_code} -> ${m.analyzer_code}`).join('\n') || 'None yet'}

CODES TO MAP:
${unmappedCodes.join(', ')}

OUTPUT ONLY valid JSON:
{
  "mappings": [
    {"lims_code": "CBC", "analyzer_code": "00001", "analyzer_display": "Automated Count", "analyzer_code_system": "99MRC", "confidence": 0.95}
  ]
}`

    try {
      const result = await model.generateContent(prompt)
      const text = result.response.text()
      const jsonMatch = text.match(/\{[\s\S]*\}/)

      if (jsonMatch) {
        const aiResult = JSON.parse(jsonMatch[0])

        for (const mapping of aiResult.mappings || []) {
          mappedTests.push({
            lims_code: mapping.lims_code,
            analyzer_code: mapping.analyzer_code,
            analyzer_display: mapping.analyzer_display || mapping.lims_code,
            analyzer_code_system: mapping.analyzer_code_system || 'LOCAL',
            mapping_type: 'order_service',
            direction: 'outbound',
            value_map: {},
            metadata: {},
            confidence: mapping.confidence || 0.7,
            from_cache: false,
            source: 'ai',
          })

          await supabase.rpc('save_ai_mapping', {
            p_lab_id: labId,
            p_lims_code: mapping.lims_code,
            p_analyzer_code: mapping.analyzer_code,
            p_analyzer_id: analyzerProfileId,
            p_confidence: mapping.confidence || 0.7,
            p_test_name: mapping.analyzer_display || mapping.lims_code,
          })
        }
      }
    } catch (e) {
      console.error('AI mapping failed:', e)
      for (const code of unmappedCodes) {
        mappedTests.push({
          lims_code: code,
          analyzer_code: code,
          analyzer_display: code,
          analyzer_code_system: 'LOCAL',
          mapping_type: 'order_service',
          direction: 'outbound',
          value_map: {},
          metadata: {},
          confidence: 0.5,
          from_cache: false,
          source: 'fallback',
        })
      }
    }
  }

  return mappedTests
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const payload: OrderPayload = await req.json()

    if (!payload.order_id || !payload.sample_barcode || !payload.tests?.length) {
      return new Response(JSON.stringify({
        error: 'Missing required fields: order_id, sample_barcode, tests',
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )
    const genAI = new GoogleGenerativeAI(Deno.env.get('GEMINI_API_KEY') || '')

    const { data: connection, error: connError } = await supabase
      .from('analyzer_connections')
      .select('*, profile:analyzer_profiles(*)')
      .eq('id', payload.analyzer_connection_id)
      .single()

    if (connError || !connection) {
      return new Response(JSON.stringify({ error: 'Analyzer connection not found' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 404,
      })
    }

    const baseProfile = connection.profile ?? {}
    const connectionConfig = connection.config ?? {}
    const profile = {
      ...baseProfile,
      connection_settings: {
        ...(baseProfile.connection_settings ?? {}),
        ...connectionConfig,
      },
      ai_parsing_hints: {
        ...(baseProfile.ai_parsing_hints ?? {}),
        ...(connectionConfig.ai_parsing_hints ?? {}),
      },
    }
    const analyzerInitiated = isAnalyzerInitiated(profile, connection)
    const messageControlId = `LIMS${Date.now()}`

    const { data: queueEntry, error: queueError } = await supabase
      .from('analyzer_order_queue')
      .insert({
        lab_id: connection.lab_id,
        analyzer_connection_id: payload.analyzer_connection_id,
        order_id: payload.order_id,
        sample_barcode: payload.sample_barcode,
        patient_name: payload.patient?.name || null,
        patient_dob: payload.patient?.dob || null,
        patient_gender: payload.patient?.gender || null,
        requested_tests: payload.tests,
        status: 'pending',
        ai_status: 'processing',
        priority: payload.priority || 5,
        message_control_id: messageControlId,
        flow_type: analyzerInitiated ? 'analyzer_initiated' : 'lims_push',
        response_message_type: analyzerInitiated ? 'ORR^O02' : null,
      })
      .select()
      .single()

    if (queueError) {
      throw new Error(`Queue entry failed: ${queueError.message}`)
    }

    const mappedTests = await mapTestCodesWithAI(
      supabase,
      genAI,
      connection.lab_id,
      connection.profile_id || 'generic-hl7',
      payload.analyzer_connection_id,
      payload.tests,
    )

    const generated = analyzerInitiated
      ? generateHL7WorklistResponse(payload, mappedTests, messageControlId, profile)
      : generateHL7Order(payload, mappedTests, messageControlId, profile)
    const messageType = analyzerInitiated ? 'ORR^O02' : 'ORM^O01'

    await supabase
      .from('analyzer_order_queue')
      .update({
        status: 'mapped',
        ai_status: 'completed',
        mapped_at: new Date().toISOString(),
        resolved_tests: mappedTests,
        hl7_message: generated.hl7Message,
        hl7_payload: generated.hl7Payload,
        response_message_type: messageType,
        ai_mapping_log: {
          timestamp: new Date().toISOString(),
          total_tests: payload.tests.length,
          cached_mappings: mappedTests.filter((t) => t.from_cache).length,
          ai_mappings: mappedTests.filter((t) => !t.from_cache).length,
          average_confidence: mappedTests.reduce((sum, t) => sum + t.confidence, 0) / mappedTests.length,
        },
      })
      .eq('id', queueEntry.id)

    await supabase
      .from('analyzer_comm_log')
      .insert({
        lab_id: connection.lab_id,
        analyzer_connection_id: payload.analyzer_connection_id,
        direction: 'SEND',
        message_type: messageType,
        message_control_id: messageControlId,
        message_preview: generated.hl7Message.slice(0, 500),
        message_size: generated.hl7Message.length,
        success: true,
        order_id: payload.order_id,
        queue_id: queueEntry.id,
      })

    return new Response(JSON.stringify({
      success: true,
      queue_id: queueEntry.id,
      message_control_id: messageControlId,
      mapped_tests: mappedTests,
      hl7_message: generated.hl7Message,
      hl7_payload: generated.hl7Payload,
      flow_type: analyzerInitiated ? 'analyzer_initiated' : 'lims_push',
      response_message_type: messageType,
      stats: {
        total_tests: payload.tests.length,
        cached: mappedTests.filter((t) => t.from_cache).length,
        ai_mapped: mappedTests.filter((t) => !t.from_cache).length,
        avg_confidence: (mappedTests.reduce((sum, t) => sum + t.confidence, 0) / mappedTests.length).toFixed(2),
      },
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error: any) {
    console.error('Dispatch error full:', error?.message, JSON.stringify(error))
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})
