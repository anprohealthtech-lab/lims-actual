// AI-Powered Order Dispatch - Sends orders to analyzers via intelligent mapping
// Endpoint: POST /functions/v1/dispatch-order-to-analyzer

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { GoogleGenerativeAI } from 'npm:@google/generative-ai'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface TestMapping {
  lims_code: string
  analyzer_code: string
  confidence: number
  from_cache: boolean
}

interface OrderPayload {
  order_id: string
  sample_barcode: string
  analyzer_connection_id: string
  tests: string[]  // LIMS codes
  patient?: {
    name: string
    dob?: string
    gender?: string
  }
  priority?: number // 1=STAT, 5=Routine
}

// Generate HL7 ORM^O01 message
function generateHL7Order(
  payload: OrderPayload,
  mappedTests: TestMapping[],
  messageControlId: string
): string {
  const now = new Date()
  const timestamp = now.toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)
  
  const segments: string[] = []
  
  // MSH - Message Header
  segments.push([
    'MSH',
    '^~\\&',                              // Encoding characters
    'LIMSV2',                             // Sending application
    'LAB',                                // Sending facility
    'ANALYZER',                           // Receiving application
    'ANALYZER',                           // Receiving facility
    timestamp,                            // Date/time
    '',                                   // Security
    'ORM^O01',                            // Message type
    messageControlId,                     // Message control ID
    'P',                                  // Processing ID (P=Production)
    '2.5.1',                              // Version ID
  ].join('|'))
  
  // PID - Patient Identification
  if (payload.patient) {
    segments.push([
      'PID',
      '1',                                // Set ID
      '',                                 // Patient ID
      payload.sample_barcode,             // Patient ID (using barcode)
      '',                                 // Alternate Patient ID
      payload.patient.name || '',         // Patient Name
      '',                                 // Mother's Maiden Name
      payload.patient.dob || '',          // Date of Birth
      payload.patient.gender || '',       // Sex
    ].join('|'))
  }
  
  // ORC - Common Order
  segments.push([
    'ORC',
    'NW',                                 // Order Control (NW = New Order)
    payload.order_id,                     // Placer Order Number
    '',                                   // Filler Order Number
    '',                                   // Placer Group Number
    'SC',                                 // Order Status (SC = Scheduled)
  ].join('|'))
  
  // OBR - Observation Request (one per test)
  mappedTests.forEach((test, index) => {
    segments.push([
      'OBR',
      String(index + 1),                  // Set ID
      payload.order_id,                   // Placer Order Number
      '',                                 // Filler Order Number
      `${test.analyzer_code}^^LOCAL`,     // Universal Service ID
      payload.priority === 1 ? 'S' : 'R', // Priority (S=STAT, R=Routine)
      timestamp,                          // Requested Date/Time
      '',                                 // Observation Date/Time
      '',                                 // Observation End Date/Time
      '',                                 // Collection Volume
      '',                                 // Collector Identifier
      '',                                 // Specimen Action Code
      '',                                 // Danger Code
      '',                                 // Relevant Clinical Info
      '',                                 // Specimen Received Date/Time
      `${payload.sample_barcode}^^Barcode`, // Specimen Source
    ].join('|'))
  })
  
  return segments.join('\r') + '\r'
}

// AI-powered test code mapping
async function mapTestCodesWithAI(
  supabase: any,
  genAI: GoogleGenerativeAI,
  labId: string,
  analyzerProfileId: string,
  limsCodes: string[]
): Promise<TestMapping[]> {
  const mappedTests: TestMapping[] = []
  const unmappedCodes: string[] = []
  
  // Step 1: Check cache/database for existing mappings
  for (const limsCode of limsCodes) {
    const { data: cached } = await supabase
      .rpc('get_cached_mapping', {
        p_lab_id: labId,
        p_lims_code: limsCode,
        p_analyzer_id: analyzerProfileId  // Function accepts analyzer_id (text)
      })
    
    if (cached && cached.length > 0) {
      mappedTests.push({
        lims_code: limsCode,
        analyzer_code: cached[0].analyzer_code,
        confidence: cached[0].confidence,
        from_cache: true
      })
    } else {
      unmappedCodes.push(limsCode)
    }
  }
  
  // Step 2: Use AI for unmapped codes
  if (unmappedCodes.length > 0) {
    // Get analyzer profile for context
    const { data: profile } = await supabase
      .from('analyzer_profiles')
      .select('*')
      .eq('id', analyzerProfileId)
      .single()
    
    // Get lab's existing successful mappings for context
    // Check both analyzer_id (existing) and analyzer_profile_id (new) columns
    const { data: existingMappings } = await supabase
      .from('test_mappings')
      .select('lims_code, analyzer_code')
      .eq('lab_id', labId)
      .or(`analyzer_id.eq.${analyzerProfileId},analyzer_profile_id.eq.${analyzerProfileId}`)
      .gt('usage_count', 0)
      .limit(50)
    
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })
    
    const prompt = `You are a laboratory interface expert. Map LIMS test codes to analyzer codes.

ANALYZER PROFILE:
- Manufacturer: ${profile?.manufacturer || 'Unknown'}
- Model: ${profile?.model || 'Unknown'}
- Protocol: ${profile?.protocol || 'HL7'}
- Supported Tests: ${profile?.supported_tests?.join(', ') || 'Various'}

EXISTING SUCCESSFUL MAPPINGS (for reference):
${existingMappings?.map((m: any) => `${m.lims_code} -> ${m.analyzer_code}`).join('\n') || 'None yet'}

CODES TO MAP:
${unmappedCodes.join(', ')}

OUTPUT ONLY valid JSON:
{
  "mappings": [
    {"lims_code": "WBC", "analyzer_code": "WBC", "confidence": 0.95, "reasoning": "Direct match"},
    {"lims_code": "HGB", "analyzer_code": "HGB", "confidence": 0.95, "reasoning": "Standard abbreviation"}
  ]
}

RULES:
1. Use exact analyzer code format for the profile
2. Confidence: 1.0 for exact matches, 0.9+ for standard abbreviations, 0.7-0.9 for inferred
3. If completely unknown, use lims_code as analyzer_code with confidence 0.5`
    
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
            confidence: mapping.confidence || 0.7,
            from_cache: false
          })
          
          // Save to cache for future use
          await supabase.rpc('save_ai_mapping', {
            p_lab_id: labId,
            p_lims_code: mapping.lims_code,
            p_analyzer_code: mapping.analyzer_code,
            p_analyzer_id: analyzerProfileId,  // Function uses analyzer_id parameter
            p_confidence: mapping.confidence || 0.7,
            p_test_name: mapping.lims_code
          })
        }
      }
    } catch (e) {
      console.error('AI mapping failed:', e)
      // Fallback: use lims_code as analyzer_code
      for (const code of unmappedCodes) {
        mappedTests.push({
          lims_code: code,
          analyzer_code: code,
          confidence: 0.5,
          from_cache: false
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
        error: 'Missing required fields: order_id, sample_barcode, tests' 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400
      })
    }

    // Initialize clients
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )
    
    const genAI = new GoogleGenerativeAI(Deno.env.get('GEMINI_API_KEY') || '')

    // Get analyzer connection details
    const { data: connection, error: connError } = await supabase
      .from('analyzer_connections')
      .select('*, profile:analyzer_profiles(*)')
      .eq('id', payload.analyzer_connection_id)
      .single()

    if (connError || !connection) {
      return new Response(JSON.stringify({ 
        error: 'Analyzer connection not found' 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 404
      })
    }

    // Create queue entry
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
        message_control_id: messageControlId
      })
      .select()
      .single()

    if (queueError) {
      throw new Error(`Queue entry failed: ${queueError.message}`)
    }

    // Map test codes using AI + cache
    const mappedTests = await mapTestCodesWithAI(
      supabase,
      genAI,
      connection.lab_id,
      connection.profile_id || 'generic-hl7',
      payload.tests
    )

    // Generate HL7 message
    const hl7Message = generateHL7Order(payload, mappedTests, messageControlId)

    // Update queue entry with mapping results
    await supabase
      .from('analyzer_order_queue')
      .update({
        status: 'mapped',
        ai_status: 'completed',
        mapped_at: new Date().toISOString(),
        resolved_tests: mappedTests,
        hl7_message: hl7Message,
        ai_mapping_log: {
          timestamp: new Date().toISOString(),
          total_tests: payload.tests.length,
          cached_mappings: mappedTests.filter(t => t.from_cache).length,
          ai_mappings: mappedTests.filter(t => !t.from_cache).length,
          average_confidence: mappedTests.reduce((sum, t) => sum + t.confidence, 0) / mappedTests.length
        }
      })
      .eq('id', queueEntry.id)

    // Log communication
    await supabase
      .from('analyzer_comm_log')
      .insert({
        lab_id: connection.lab_id,
        analyzer_connection_id: payload.analyzer_connection_id,
        direction: 'SEND',
        message_type: 'ORM^O01',
        message_control_id: messageControlId,
        message_preview: hl7Message.slice(0, 500),
        message_size: hl7Message.length,
        success: true,
        order_id: payload.order_id,
        queue_id: queueEntry.id
      })

    return new Response(JSON.stringify({
      success: true,
      queue_id: queueEntry.id,
      message_control_id: messageControlId,
      mapped_tests: mappedTests,
      hl7_message: hl7Message,
      stats: {
        total_tests: payload.tests.length,
        cached: mappedTests.filter(t => t.from_cache).length,
        ai_mapped: mappedTests.filter(t => !t.from_cache).length,
        avg_confidence: (mappedTests.reduce((sum, t) => sum + t.confidence, 0) / mappedTests.length).toFixed(2)
      }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('Dispatch error full:', error?.message, JSON.stringify(error))
    return new Response(JSON.stringify({ 
      error: error.message 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500
    })
  }
})
