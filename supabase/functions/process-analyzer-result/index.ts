import { createClient } from 'jsr:@supabase/supabase-js@2'
import Anthropic from 'npm:@anthropic-ai/sdk'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Helper to extract Base64 images from HL7/ASTM messages
function extractEmbeddedImages(rawContent: string): Array<{ type: string; data: string; name: string }> {
  const images: Array<{ type: string; data: string; name: string }> = [];

  // Pattern 1: OBX segments with ED (Encapsulated Data) - HL7 standard
  // Format: OBX|1|ED|HISTOGRAM^WBC||^^PNG^BASE64^/9j/4AAQSkZJRgABAQAA...
  const obxEdPattern = /OBX\|[^|]*\|ED\|([^|]*)\|[^|]*\|([^^]*)\^([^^]*)\^([^^]*)\^([^|]*)/gi;
  let match;
  while ((match = obxEdPattern.exec(rawContent)) !== null) {
    const [_full, testCode, _sub, mimeType, encoding, data] = match;
    if (encoding?.toUpperCase() === 'BASE64' && data) {
      images.push({
        type: mimeType?.toLowerCase() || 'png',
        data: data.trim(),
        name: testCode || 'analyzer_image'
      });
    }
  }

  // Pattern 2: Inline base64 data (common in some analyzers)
  // Look for PNG/JPEG magic bytes in base64
  const base64Pattern = /data:image\/(png|jpeg|jpg|gif);base64,([A-Za-z0-9+/=]+)/gi;
  while ((match = base64Pattern.exec(rawContent)) !== null) {
    images.push({
      type: match[1],
      data: match[2],
      name: 'inline_image'
    });
  }

  // Pattern 3: Raw base64 blocks (PNG starts with iVBOR, JPEG with /9j/)
  const rawBase64Pattern = /(iVBOR[A-Za-z0-9+/=]{100,}|\/9j\/[A-Za-z0-9+/=]{100,})/g;
  while ((match = rawBase64Pattern.exec(rawContent)) !== null) {
    const data = match[1];
    const type = data.startsWith('iVBOR') ? 'png' : 'jpeg';
    images.push({
      type,
      data,
      name: 'raw_image'
    });
  }

  return images;
}

// Extract Octer-stream histogram data from ED-type OBX segments (3-digit decimal encoding)
function extractOcterStreamHistograms(rawContent: string): Array<{
  name: string
  testCode: string
  data: number[]
  leftLine?: number
  rightLine?: number
  divisionLines?: number[]
}> {
  const histograms: Array<{
    name: string; testCode: string; data: number[]
    leftLine?: number; rightLine?: number; divisionLines?: number[]
  }> = []

  // Match ED type OBX with Octer-stream encoding
  // Format: OBX|n|ED|CODE^Name^sys||^Application^Octer-stream^DIGITS||||||F
  const edPattern = /OBX\|\d+\|ED\|([^^|]+)\^([^^|]+)\^[^|]*\|\|[^^]*\^Application\^Octer-stream\^([0-9]+)/gi
  let match
  while ((match = edPattern.exec(rawContent)) !== null) {
    const testCode = match[1].trim()
    const name = match[2].trim()
    const digits = match[3]

    // Parse 3-digit chunks into numbers
    const data: number[] = []
    for (let i = 0; i + 3 <= digits.length; i += 3) {
      data.push(parseInt(digits.slice(i, i + 3), 10))
    }

    if (data.length > 0) {
      histograms.push({ testCode, name, data })
    }
  }

  // Parse boundary/division line values from NM segments
  const nmPattern = /OBX\|\d+\|NM\|(\d+)\^[^|]+\|\|([0-9.]+)/gi
  const lineMap = new Map<string, number>()
  while ((match = nmPattern.exec(rawContent)) !== null) {
    lineMap.set(match[1], parseFloat(match[2]))
  }

  for (const hist of histograms) {
    if (hist.testCode === '15000') { // WBC: Lym|Mid|Gran divisions
      hist.leftLine = lineMap.get('15010')
      hist.rightLine = lineMap.get('15013')
      const d1 = lineMap.get('15011'), d2 = lineMap.get('15012')
      if (d1 !== undefined && d2 !== undefined) hist.divisionLines = [d1, d2]
    } else if (hist.testCode === '15050') { // RBC
      hist.leftLine = lineMap.get('15051')
      hist.rightLine = lineMap.get('15052')
    } else if (hist.testCode === '15100') { // PLT
      hist.leftLine = lineMap.get('15111')
      hist.rightLine = lineMap.get('15112')
    }
  }

  return histograms
}

// Generate inline SVG area histogram chart
function generateHistogramSVG(
  name: string,
  data: number[],
  opts: { leftLine?: number; rightLine?: number; divisionLines?: number[]; color?: string }
): string {
  const W = 300, H = 110
  const PAD = { top: 8, right: 8, bottom: 22, left: 28 }
  const chartW = W - PAD.left - PAD.right
  const chartH = H - PAD.top - PAD.bottom

  const maxVal = Math.max(...data, 1)
  const n = data.length

  const xScale = (i: number) => PAD.left + (i / n) * chartW
  const yScale = (v: number) => PAD.top + chartH - (v / maxVal) * chartH

  // Area fill path
  let path = `M${PAD.left},${PAD.top + chartH}`
  for (let i = 0; i < n; i++) {
    path += ` L${xScale(i).toFixed(1)},${yScale(data[i]).toFixed(1)}`
  }
  path += ` L${(PAD.left + chartW).toFixed(1)},${PAD.top + chartH} Z`

  const color = opts.color ?? '#3B82F6'

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`
  svg += `<rect width="${W}" height="${H}" fill="white" stroke="#E5E7EB" stroke-width="0.5" rx="3"/>`

  // Area
  svg += `<path d="${path}" fill="${color}" fill-opacity="0.25" stroke="${color}" stroke-width="1.2"/>`

  // Division lines (e.g. Lym|Mid|Gran for WBC)
  if (opts.divisionLines) {
    for (const dl of opts.divisionLines) {
      const x = xScale(dl).toFixed(1)
      svg += `<line x1="${x}" y1="${PAD.top}" x2="${x}" y2="${PAD.top + chartH}" stroke="#9CA3AF" stroke-width="1" stroke-dasharray="3,2"/>`
    }
  }

  // Left/right gate markers
  if (opts.leftLine !== undefined) {
    const x = xScale(opts.leftLine).toFixed(1)
    svg += `<line x1="${x}" y1="${PAD.top}" x2="${x}" y2="${PAD.top + chartH}" stroke="#EF4444" stroke-width="1.2"/>`
  }
  if (opts.rightLine !== undefined) {
    const x = xScale(opts.rightLine).toFixed(1)
    svg += `<line x1="${x}" y1="${PAD.top}" x2="${x}" y2="${PAD.top + chartH}" stroke="#EF4444" stroke-width="1.2"/>`
  }

  // Y-axis ticks (0, mid, max)
  svg += `<line x1="${PAD.left}" y1="${PAD.top}" x2="${PAD.left}" y2="${PAD.top + chartH}" stroke="#6B7280" stroke-width="0.8"/>`
  svg += `<text x="${PAD.left - 3}" y="${PAD.top + 4}" text-anchor="end" font-size="7" fill="#6B7280" font-family="sans-serif">${maxVal}</text>`
  svg += `<text x="${PAD.left - 3}" y="${PAD.top + chartH / 2 + 3}" text-anchor="end" font-size="7" fill="#6B7280" font-family="sans-serif">${Math.round(maxVal / 2)}</text>`
  svg += `<text x="${PAD.left - 3}" y="${PAD.top + chartH}" text-anchor="end" font-size="7" fill="#6B7280" font-family="sans-serif">0</text>`

  // X-axis
  svg += `<line x1="${PAD.left}" y1="${PAD.top + chartH}" x2="${PAD.left + chartW}" y2="${PAD.top + chartH}" stroke="#6B7280" stroke-width="0.8"/>`

  // Title
  svg += `<text x="${W / 2}" y="${H - 5}" text-anchor="middle" font-size="9" fill="#374151" font-family="sans-serif" font-weight="600">${name}</text>`

  svg += `</svg>`
  return svg
}

function formatCalculatedResult(value: number): string {
  if (!Number.isFinite(value)) return String(value)
  const rounded = value.toFixed(6).replace(/\.?0+$/, '')
  return rounded === '-0' ? '0' : rounded
}

function parseHl7Components(value: string | undefined): string[] {
  return String(value ?? '').split('^')
}

function firstComponent(value: string | undefined): string {
  return parseHl7Components(value)[0]?.trim() ?? ''
}

function normalizeHl7Flag(value: string | undefined): string {
  const flag = String(value ?? '').trim().replace(/^["']+|["']+$/g, '')
  if (!flag) return 'N'

  const components = flag
    .split(/[~\\]/)
    .map((component) => component.trim().replace(/^["']+|["']+$/g, '').toUpperCase())
    .filter(Boolean)
  return components.find((component) => ['LL', 'HH', 'L', 'H', 'A', 'N'].includes(component))
    || 'N'
}

function normalizeAnalyzerValue(value: unknown): string | null {
  const normalized = String(value ?? '').trim()
  if (!normalized) return null

  const unquoted = normalized.replace(/^["']+|["']+$/g, '').trim()
  if (!unquoted) return null

  const placeholder = unquoted.toUpperCase()
  if (['NULL', 'N/A', 'NA', 'NIL', '*****', '****', '***'].includes(placeholder)) {
    return null
  }

  return unquoted
}

function logAiRefRange(event: string, details: Record<string, unknown> = {}) {
  console.log(`[interface-ai-ref-range] ${event} ${JSON.stringify(details)}`)
}

function normalizeAnalyteName(value: unknown): string {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

function matchResolvedRange(candidate: {
  analyte_id: string
  analyte_name: string
}, results: any[]): { result: any; matchType: string } | null {
  let result = results.find((item) => item?.analyte_id === candidate.analyte_id)
  if (result) return { result, matchType: 'exact_id' }

  result = results.find((item) => item?.analyte_name === candidate.analyte_name)
  if (result) return { result, matchType: 'exact_name' }

  const candidateName = normalizeAnalyteName(candidate.analyte_name)
  if (candidateName) {
    result = results.find((item) => {
      const resultName = normalizeAnalyteName(item?.analyte_name)
      return resultName && (candidateName.includes(resultName) || resultName.includes(candidateName))
    })
    if (result) return { result, matchType: 'fuzzy_name' }
  }

  if (results.length === 1) return { result: results[0], matchType: 'single_result' }
  return null
}

async function resolveAiReferenceRanges(
  orderId: string,
  candidates: Array<{
    analyte_id: string
    lab_analyte_id: string | null
    analyte_name: string
    value: string
    unit: string
    test_group_id: string | null
  }>,
): Promise<Map<string, any>> {
  const resolvedByKey = new Map<string, any>()
  const grouped = new Map<string, typeof candidates>()

  for (const candidate of candidates) {
    if (!candidate.test_group_id) continue
    const group = grouped.get(candidate.test_group_id) ?? []
    group.push(candidate)
    grouped.set(candidate.test_group_id, group)
  }

  if (grouped.size === 0) {
    logAiRefRange('resolver_skipped_no_candidates', { order_id: orderId })
    return resolvedByKey
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    logAiRefRange('resolver_skipped_missing_credentials', {
      order_id: orderId,
      test_group_count: grouped.size,
    })
    return resolvedByKey
  }

  logAiRefRange('resolver_started', {
    order_id: orderId,
    test_group_count: grouped.size,
    analyte_count: candidates.length,
  })

  for (const [testGroupId, groupCandidates] of grouped) {
    try {
      const startedAt = Date.now()
      logAiRefRange('group_request_started', {
        order_id: orderId,
        test_group_id: testGroupId,
        analyte_count: groupCandidates.length,
        analyte_ids: groupCandidates.map((candidate) => candidate.analyte_id),
      })

      const response = await fetch(`${supabaseUrl}/functions/v1/resolve-reference-ranges`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${serviceRoleKey}`,
          'x-internal-service-key': serviceRoleKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          orderId,
          testGroupId,
          analytes: groupCandidates.map((candidate) => ({
            id: candidate.analyte_id,
            lab_analyte_id: candidate.lab_analyte_id,
            name: candidate.analyte_name,
            value: candidate.value,
            unit: candidate.unit,
          })),
        }),
      })

      if (!response.ok) {
        const responseText = await response.text().catch(() => '')
        logAiRefRange('group_request_failed', {
          order_id: orderId,
          test_group_id: testGroupId,
          status: response.status,
          duration_ms: Date.now() - startedAt,
          response: responseText.slice(0, 500),
        })
        continue
      }

      const payload = await response.json()
      if (!payload?.success || !Array.isArray(payload.results)) {
        logAiRefRange('group_response_invalid', {
          order_id: orderId,
          test_group_id: testGroupId,
          duration_ms: Date.now() - startedAt,
          error: payload?.error || 'Missing results array',
        })
        continue
      }

      const unmatchedCandidates: Array<{ analyte_id: string; analyte_name: string }> = []
      for (const candidate of groupCandidates) {
        const match = matchResolvedRange(candidate, payload.results)
        if (match) {
          resolvedByKey.set(`${testGroupId}:${candidate.analyte_id}`, match.result)
          logAiRefRange('analyte_response_matched', {
            order_id: orderId,
            test_group_id: testGroupId,
            requested_analyte_id: candidate.analyte_id,
            requested_analyte_name: candidate.analyte_name,
            returned_analyte_id: match.result?.analyte_id || null,
            returned_analyte_name: match.result?.analyte_name || null,
            match_type: match.matchType,
          })
        } else {
          unmatchedCandidates.push({
            analyte_id: candidate.analyte_id,
            analyte_name: candidate.analyte_name,
          })
        }
      }

      logAiRefRange('group_request_completed', {
        order_id: orderId,
        test_group_id: testGroupId,
        requested_count: groupCandidates.length,
        returned_count: payload.results.length,
        matched_count: groupCandidates.length - unmatchedCandidates.length,
        unmatched_candidates: unmatchedCandidates,
        returned_results: payload.results.map((result: any) => ({
          analyte_id: result?.analyte_id || null,
          analyte_name: result?.analyte_name || null,
          used_reference_range: result?.used_reference_range || null,
        })),
        duration_ms: Date.now() - startedAt,
      })
    } catch (error) {
      logAiRefRange('group_request_exception', {
        order_id: orderId,
        test_group_id: testGroupId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  logAiRefRange('resolver_completed', {
    order_id: orderId,
    resolved_count: resolvedByKey.size,
  })
  return resolvedByKey
}

function parseHl7ResultsDeterministic(rawContent: string): {
  sample_barcode: string
  results: Array<{ test_code: string; name: string; value: string; unit: string; flag: string; reference_range: string }>
  instrument: string
  graphs: Array<{ type: string; name: string; test_code: string; description: string; associated_test: string }>
} | null {
  const segments = rawContent.split(/\r|\n/).map((s) => s.trim()).filter(Boolean)
  if (!segments.some((s) => s.startsWith('MSH|'))) return null

  const msh = segments.find((s) => s.startsWith('MSH|'))?.split('|') ?? []
  const instrument = [msh[2], msh[3]].filter(Boolean).join('^')
  let sampleBarcode = ''

  for (const segment of segments) {
    const fields = segment.split('|')
    if (fields[0] === 'OBR') {
      sampleBarcode = firstComponent(fields[3]) || firstComponent(fields[2]) || sampleBarcode
    } else if (fields[0] === 'ORC') {
      sampleBarcode = firstComponent(fields[2]) || sampleBarcode
    } else if (fields[0] === 'PID') {
      sampleBarcode = firstComponent(fields[3]) || sampleBarcode
    }
  }

  const results: Array<{ test_code: string; name: string; value: string; unit: string; flag: string; reference_range: string }> = []
  const graphs: Array<{ type: string; name: string; test_code: string; description: string; associated_test: string }> = []

  for (const segment of segments) {
    const fields = segment.split('|')
    if (fields[0] !== 'OBX') continue

    const valueType = String(fields[2] ?? '').trim().toUpperCase()
    const idParts = parseHl7Components(fields[3])
    const testCode = (idParts[0] || '').trim()
    const name = (idParts[1] || testCode).trim()
    const value = String(fields[5] ?? '').trim()

    if (!testCode) continue

    if (['ED', 'NA'].includes(valueType)) {
      graphs.push({
        type: valueType === 'ED' ? 'histogram' : 'waveform',
        name,
        test_code: testCode,
        description: name,
        associated_test: '',
      })
      continue
    }

    results.push({
      test_code: testCode,
      name,
      value,
      unit: firstComponent(fields[6]),
      reference_range: String(fields[7] ?? '').trim(),
      flag: normalizeHl7Flag(fields[8]),
    })
  }

  if (!sampleBarcode && results.length === 0) return null
  return { sample_barcode: sampleBarcode, results, instrument, graphs }
}

async function saveAnalyzerLearning(
  supabase: any,
  record: any,
  parsedData: any,
  messageType: string,
) {
  const sampleResults = (parsedData.results ?? [])
    .slice(0, 25)
    .map((r: any) => `${r.test_code}${r.name ? ` (${r.name})` : ''}`)
    .join(', ')

  await supabase.from('analyzer_knowledge').insert({
    lab_id: record.lab_id,
    knowledge_type: 'protocol',
    title: `${messageType || 'HL7'} ${parsedData.instrument || record.analyzer_connection_id || 'analyzer'} message`,
    content: [
      `message_type=${messageType || 'UNKNOWN'}`,
      `analyzer_connection_id=${record.analyzer_connection_id || ''}`,
      `instrument=${parsedData.instrument || ''}`,
      `sample_barcode_field=OBR-3/OBR-2/PID-3`,
      `result_format=HL7_OBX`,
      `result_codes=${sampleResults}`,
    ].join('\n'),
    metadata: {
      analyzer_connection_id: record.analyzer_connection_id,
      message_type: messageType || null,
      sample_barcode: parsedData.sample_barcode || null,
      parser: 'deterministic_hl7_obx',
      result_count: parsedData.results?.length ?? 0,
      graph_count: parsedData.graphs?.length ?? 0,
      raw_message_id: record.id,
    },
    confidence_score: 0.8,
  })
}

// Helper to extract histogram/waveform numeric data
function extractWaveformData(rawContent: string): Array<{ name: string; data: number[] }> {
  const waveforms: Array<{ name: string; data: number[] }> = [];

  // Pattern: OBX with NA (Numeric Array) data type
  // Format: OBX|1|NA|HISTOGRAM^RBC||12^15^18^22^...
  const naPattern = /OBX\|[^|]*\|NA\|([^|]*)\|[^|]*\|([^|]*)/gi;
  let match;
  while ((match = naPattern.exec(rawContent)) !== null) {
    const name = match[1]?.split('^')[0] || 'histogram';
    const dataStr = match[2];
    if (dataStr) {
      const numbers = dataStr.split('^').map(n => parseFloat(n)).filter(n => !isNaN(n));
      if (numbers.length > 0) {
        waveforms.push({ name, data: numbers });
      }
    }
  }

  return waveforms;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // 1. Parse Webhook Payload
    const payload = await req.json()
    const { record } = payload

    if (!record || !record.raw_content) {
        return new Response(JSON.stringify({ message: 'No record content' }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200
        })
    }

    // 2. Init Supabase (Admin Client)
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const mshFields = String(record.raw_content).split(/\r|\n/).find((s) => s.startsWith('MSH|'))?.split('|') ?? []
    const hl7MessageType = mshFields[8] || record.message_type || ''
    const hasResultObx = /\r?OBX\|/i.test(record.raw_content)
    const isResultMessage =
      hl7MessageType.includes('ORU') ||
      hl7MessageType.includes('ASTM_RESULT') ||
      hasResultObx

    if (!isResultMessage) {
      await supabase
        .from('analyzer_raw_messages')
        .update({
          ai_status: 'completed',
          message_type: hl7MessageType || record.message_type || 'NON_RESULT',
          ai_result: {
            ignored: true,
            reason: 'non_result_message',
            message_type: hl7MessageType || record.message_type || null,
          },
        })
        .eq('id', record.id)

      return new Response(JSON.stringify({
        success: true,
        ignored: true,
        reason: 'non_result_message',
        message_type: hl7MessageType || null,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 3. Init AI
    const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') || '' })
    const MODEL = 'claude-haiku-4-5-20251001'

    // 3a. Extract embedded images, waveform data, and Octer-stream histograms
    const embeddedImages = extractEmbeddedImages(record.raw_content);
    const waveformData = extractWaveformData(record.raw_content);
    const octerHistograms = extractOcterStreamHistograms(record.raw_content);

    // Generate SVG charts for each decoded histogram
    const histogramColors: Record<string, string> = {
      '15000': '#3B82F6', // WBC — blue
      '15050': '#EF4444', // RBC — red
      '15100': '#F59E0B', // PLT — amber
    }
    const generatedHistogramSVGs = octerHistograms.map(h => ({
      testCode: h.testCode,
      name: h.name,
      channels: h.data.length,
      svg: generateHistogramSVG(h.name, h.data, {
        leftLine: h.leftLine,
        rightLine: h.rightLine,
        divisionLines: h.divisionLines,
        color: histogramColors[h.testCode] ?? '#6366F1',
      }),
    }))

    console.log(`📊 Found ${embeddedImages.length} images, ${waveformData.length} waveforms, ${octerHistograms.length} Octer-stream histograms in analyzer data`);

	    // 4. Parse results. Standard HL7 OBX messages are deterministic; AI is fallback.
	    let parsedData = parseHl7ResultsDeterministic(record.raw_content)
	    let parserUsed = parsedData ? 'deterministic_hl7_obx' : 'ai'

	    if (!parsedData || !Array.isArray(parsedData.results) || parsedData.results.length === 0) {
	      parserUsed = 'ai'

	    // 4. AI Parse
    // Strip ED/Octer-stream binary blobs before sending to AI — already decoded separately
    const rawForAI = record.raw_content.replace(
      /(\|ED\|[^|]*\|\|[^^]*\^Application\^Octer-stream\^)[0-9]+/gi,
      '$1<binary_histogram_data_stripped>'
    )

    let parsePrompt = `You are a strictly technical laboratory interface parser.
Output ONLY valid JSON. No markdown fences, no explanation, no introduction.

Parse this raw analyzer data:
${rawForAI}

REQUIRED JSON STRUCTURE:
{
  "sample_barcode": "string",
  "results": [
    { "test_code": "string", "value": "string", "unit": "string", "flag": "string", "reference_range": "string" }
  ],
  "instrument": "string",
  "graphs": [
    { "type": "histogram|scatter|waveform", "name": "string", "test_code": "string", "description": "string", "associated_test": "string" }
  ]
}

CRITICAL FLAG RULES for HL7 OBX segments:
- OBX field 7 = Reference Range (put this in "reference_range" if present)
- OBX field 8 = Abnormal Flag (THIS is what goes in "flag"): H=High, L=Low, HH=Critical High, LL=Critical Low, A=Abnormal. Empty or missing = "N" (Normal)
- OBX field 11 = Result Status (F=Final, P=Preliminary) — DO NOT put this in "flag"
- If OBX-8 is empty/missing, set flag to "N" (Normal)

For graphs/histograms, use the OBX test code (e.g. "15000" for WBC histogram).
Do NOT include or describe binary histogram data — it is already extracted separately.`

    if (waveformData.length > 0) {
      parsePrompt += `\n\nWAVEFORM DATA DETECTED:\n${JSON.stringify(waveformData, null, 2)}\nInclude these in the "graphs" array with type "waveform".`
    }

    const aiResult = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4096,
      messages: [{ role: 'user', content: parsePrompt }]
    })
    const aiText = (aiResult.content[0] as { type: string; text: string }).text

    // Robust JSON Extraction
    const jsonMatch = aiText.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? jsonMatch[0] : aiText.trim();

	    try {
	        parsedData = JSON.parse(jsonStr)
	    } catch (e) {
	        console.error("AI returned invalid JSON:", aiText)
	        throw new Error("AI Parsing Failed: Invalid JSON format")
	    }
	    }

	    if (parsedData && parserUsed === 'deterministic_hl7_obx') {
	      try {
	        await saveAnalyzerLearning(supabase, record, parsedData, hl7MessageType || record.message_type || 'HL7')
	      } catch (learningError) {
	        console.warn('Analyzer knowledge save skipped:', learningError)
	      }
	    }

	    if (!parsedData) {
	      throw new Error('Analyzer parsing failed: no parser produced result data')
	    }

	    // 5. Order Lookup & Insertion Logic
    let statusLog = "Parsed successfully. "
    let foundOrderId: string | null = null
    const barcode = String(parsedData.sample_barcode).trim()

    // A. Find Sample (using robust WILDCARD search)
    const { data: sampleList, error: sampleError } = await supabase
        .from('samples')
        .select('id, order_id, lab_id, barcode')
        .eq('lab_id', record.lab_id)
        .ilike('barcode', `%${barcode}%`)
        .limit(1)

    const sample = sampleList && sampleList.length > 0 ? sampleList[0] : null

    if (sampleError || !sample) {
       statusLog += `Warning: Sample with barcode '${barcode}' not found (Lab: ${record.lab_id}).`
    } else {
        foundOrderId = sample.order_id ?? null
        // B. Process Results
        statusLog += "Sample found. Processing results... "

        // Fetch Patient Details from Order (patient_name from orders, gender from patients join)
        const { data: orderData, error: orderError } = await supabase
            .from('orders')
            .select('patient_id, patient_name, patients (gender)')
            .eq('id', sample.order_id)
            .single()

        if (orderError) {
            console.error("Failed to fetch order data for sample", sample.order_id, orderError)
        }

        const patientId = orderData?.patient_id
        // @ts-ignore
        const patientGender: string = (orderData as any)?.patients?.gender || ''
        const patientName = orderData?.patient_name || "Unknown Patient"

        // Ensure master Result record exists
        let { data: resultHeader } = await supabase
            .from('results')
            .select('id, test_group_id')
            .eq('sample_id', sample.id)
            .maybeSingle()

        if (!resultHeader) {
            if (!patientId) {
                console.error("Cannot create result header: patient_id is null for order", sample.order_id)
                statusLog += `Error: Could not create result record. Patient not found for order ${sample.order_id}. `
            } else {
                const { data: newResult, error: createError } = await supabase
                    .from('results')
                    .insert({
                        order_id: sample.order_id,
                        patient_id: patientId,
                        patient_name: patientName,
                        lab_id: sample.lab_id,
                        sample_id: sample.id,
                        test_name: 'Analyzer Result',
                        entered_by: 'AI Interface',
                        status: 'Entered',
                    })
                    .select()
                    .single()

                if (createError) {
                    console.error("Failed to create result header", createError)
                    statusLog += `Error: Could not create result record. ${createError.message} `
                } else {
                    resultHeader = newResult
                }
            }
        }

        if (resultHeader) {
            // C. Fetch Expected Analytes from v_order_missing_analytes view
            const { data: missingAnalytes } = await supabase
                .from('v_order_missing_analytes')
                .select('*')
                .eq('order_id', sample.order_id)

            if (!missingAnalytes || missingAnalytes.length === 0) {
                statusLog += "No expected analytes found for this order. "
            } else {
                // D. Use AI to map machine results to expected analytes
                // Filter to only clinical result codes — skip instrument mode/alert/boundary line codes
                const NON_CLINICAL_PREFIXES = ['080', '010', '120', '150']
                const clinicalResults = (parsedData.results || []).filter((r: any) => {
                    const code = String(r.test_code ?? '')
                    const value = normalizeAnalyzerValue(r.value)
                    // r.flag = HL7 OBX-8 (abnormal flag: H/L/HH/LL) NOT OBX-11 result status (F=Final).
                    // Never filter out based on flag value — F here means Final result, not a clinical flag.
                    return !NON_CLINICAL_PREFIXES.some(p => code.startsWith(p)) && value !== null
                })

                const machineCodes = clinicalResults
                    .map((r: any) => String(r.test_code ?? '').toUpperCase())
                    .filter(Boolean)
                const expectedAnalyteIds = missingAnalytes
                    .map((a: any) => a.analyte_id)
                    .filter(Boolean)
                let deterministicMappingRows: any[] = []

                // Collect lab_analyte_ids from missingAnalytes view
                const expectedLabAnalyteIds = missingAnalytes
                    .map((a: any) => a.lab_analyte_id)
                    .filter(Boolean)

                if (machineCodes.length > 0 && (expectedAnalyteIds.length > 0 || expectedLabAnalyteIds.length > 0)) {
                    // Primary: lookup by lab_analyte_id (most specific)
                    if (expectedLabAnalyteIds.length > 0) {
                        let laQuery = supabase
                            .from('test_mappings')
                            .select('analyzer_code, analyte_id, lab_analyte_id, test_name, test_group_id, ai_confidence, analyzer_connection_id')
                            .eq('lab_id', sample.lab_id)
                            .eq('mapping_type', 'result_analyte')
                            .in('direction', ['inbound', 'bidirectional'])
                            .in('analyzer_code', machineCodes)
                            .in('lab_analyte_id', expectedLabAnalyteIds)

                        if (record.analyzer_connection_id) {
                            laQuery = laQuery.or(`analyzer_connection_id.eq.${record.analyzer_connection_id},analyzer_connection_id.is.null`)
                        }

                        const { data: laRows, error: laError } = await laQuery
                        if (!laError && laRows) {
                            deterministicMappingRows.push(...laRows)
                        }
                    }

                    // Fallback: lookup by analyte_id (legacy)
                    const foundMachineCodes = new Set(deterministicMappingRows.map((r: any) => String(r.analyzer_code).toUpperCase()))
                    const remainingCodes = machineCodes.filter((c: string) => !foundMachineCodes.has(c))

                    if (remainingCodes.length > 0 && expectedAnalyteIds.length > 0) {
                        let deterministicQuery = supabase
                            .from('test_mappings')
                            .select('analyzer_code, analyte_id, lab_analyte_id, test_name, test_group_id, ai_confidence, analyzer_connection_id')
                            .eq('lab_id', sample.lab_id)
                            .eq('mapping_type', 'result_analyte')
                            .in('direction', ['inbound', 'bidirectional'])
                            .in('analyzer_code', remainingCodes)
                            .in('analyte_id', expectedAnalyteIds)

                        if (record.analyzer_connection_id) {
                            deterministicQuery = deterministicQuery.or(`analyzer_connection_id.eq.${record.analyzer_connection_id},analyzer_connection_id.is.null`)
                        }

                        const { data: mappingRows, error: mappingRowsError } = await deterministicQuery
                        if (mappingRowsError) {
                            console.error('Deterministic analyzer mapping lookup failed:', mappingRowsError)
                        } else if (mappingRows) {
                            deterministicMappingRows.push(...mappingRows)
                        }
                    }
                }

                const analyteMap = new Map()
                const mappingSpecificity = (row: any) => {
                    if (record.analyzer_connection_id && row.analyzer_connection_id === record.analyzer_connection_id) return 2
                    return 1
                }
                deterministicMappingRows.sort((a: any, b: any) => mappingSpecificity(a) - mappingSpecificity(b))
                for (const row of deterministicMappingRows) {
                    const machineCode = String(row.analyzer_code ?? '').toUpperCase()
                    if (!machineCode) continue

                    // Match by lab_analyte_id first, then analyte_id
                    let expected = row.lab_analyte_id
                        ? missingAnalytes.find((a: any) => a.lab_analyte_id === row.lab_analyte_id)
                        : null
                    if (!expected && row.analyte_id) {
                        expected = missingAnalytes.find((a: any) => a.analyte_id === row.analyte_id)
                    }
                    if (!expected) continue

                    analyteMap.set(machineCode, {
                        analyte_id: row.analyte_id || expected.analyte_id,
                        lab_analyte_id: row.lab_analyte_id || expected.lab_analyte_id,
                        analyte_name: expected.analyte_name || row.test_name,
                        test_group_id: expected.test_group_id || row.test_group_id,
                        order_test_group_id: null,
                        order_test_id: expected.order_test_id,
                        confidence: row.ai_confidence || 1.0,
                        mapping_source: 'test_mappings'
                    })
                }

	                const unresolvedClinicalResults = clinicalResults.filter((r: any) => {
	                    const code = String(r.test_code ?? '').toUpperCase()
	                    return code && !analyteMap.has(code)
	                })

	                let aiMappings = { mappings: [] as any[] }
	                if (unresolvedClinicalResults.length > 0) {
	                const mappingPrompt = `
You are a laboratory data mapper. Match machine analyzer results to expected lab analytes.
Output ONLY valid JSON. No markdown fences, no explanation.

MACHINE RESULTS:
${JSON.stringify(unresolvedClinicalResults.map((r: any) => ({ test_code: r.test_code, name: r.name, value: r.value, unit: r.unit })), null, 2)}

EXPECTED ANALYTES FOR THIS ORDER:
${JSON.stringify(missingAnalytes.map(a => ({
    analyte_id: a.analyte_id,
    analyte_name: a.analyte_name,
    test_group_id: a.test_group_id,
    order_test_id: a.order_test_id
})), null, 2)}

TASK: Map each machine result to the correct analyte_id from the expected list.
Consider common abbreviations:
- WBC = White Blood Cell / Total White Blood Cell Count
- RBC = Red Blood Cell Count
- HGB = Hemoglobin
- HCT = Hematocrit
- PLT = Platelet Count
- MCV = Mean Corpuscular Volume
- MCH = Mean Corpuscular Hemoglobin
- MCHC = Mean Corpuscular Hemoglobin Concentration

OUTPUT ONLY valid JSON in this exact format (no markdown, no explanation):
{
  "mappings": [
    {
      "machine_code": "WBC",
      "analyte_id": "uuid-here",
      "analyte_name": "matched name",
      "test_group_id": "uuid-here",
      "order_test_id": "uuid-here",
      "confidence": 0.95
    }
  ]
}
`

                const aiMappingResult = await anthropic.messages.create({
                  model: MODEL,
                  max_tokens: 4096,
                  messages: [{ role: 'user', content: mappingPrompt }]
                })
                const aiMappingText = (aiMappingResult.content[0] as { type: string; text: string }).text

                // Robust JSON extraction
                const mappingJsonMatch = aiMappingText.match(/\{[\s\S]*\}/)
                const mappingJsonStr = mappingJsonMatch ? mappingJsonMatch[0] : aiMappingText.trim()

	                try {
	                    aiMappings = JSON.parse(mappingJsonStr)
	                } catch (e) {
	                    console.error("AI mapping returned invalid JSON:", aiMappingText)
	                    statusLog += "AI mapping failed. "
	                    aiMappings = { mappings: [] }
	                }
	                }

                // Build lookup map from AI mappings
                if (aiMappings.mappings && Array.isArray(aiMappings.mappings)) {
                    for (const mapping of aiMappings.mappings) {
                        if (mapping.machine_code && mapping.analyte_id) {
                            const machineCode = mapping.machine_code.toUpperCase()
                            if (analyteMap.has(machineCode)) continue
                            // Resolve lab_analyte_id from missingAnalytes
                            const expectedForAi = missingAnalytes.find((a: any) => a.analyte_id === mapping.analyte_id)
                            analyteMap.set(machineCode, {
                                analyte_id: mapping.analyte_id,
                                lab_analyte_id: expectedForAi?.lab_analyte_id || null,
                                analyte_name: mapping.analyte_name,
                                test_group_id: mapping.test_group_id,
                                order_test_group_id: null,
                                order_test_id: mapping.order_test_id,
                                confidence: mapping.confidence || 0.8,
                                mapping_source: 'ai'
                            })
                        }
                    }
                }

                console.log(`DEBUG: Mapped ${analyteMap.size} analytes:`, Array.from(analyteMap.keys()).join(', '))

                // Enrich analyteMap with real order_test_group_id and test_group_id.
                // Orders may use either order_test_groups OR order_tests — try both.
                const mappedAnalyteIds = Array.from(analyteMap.values()).map((m: any) => m.analyte_id)
                if (mappedAnalyteIds.length > 0) {
                    const analyteToOTG = new Map<string, { order_test_group_id: string | null; test_group_id: string; order_test_id?: string | null }>()

                    // Try order_test_groups first
                    const { data: otgRows } = await supabase
                        .from('order_test_groups')
                        .select('id, test_group_id, test_group_analytes!inner(analyte_id)')
                        .eq('order_id', sample.order_id)

                    if (otgRows && otgRows.length > 0) {
                        for (const otg of otgRows) {
                            for (const tga of (otg as any).test_group_analytes || []) {
                                if (mappedAnalyteIds.includes(tga.analyte_id)) {
                                    analyteToOTG.set(tga.analyte_id, {
                                        order_test_group_id: otg.id,
                                        test_group_id: otg.test_group_id,
                                    })
                                }
                            }
                        }
                    }

                    // Fallback: try order_tests if order_test_groups yielded nothing.
                    // Two-step lookup: order_tests → test_group_analytes via test_group_id
                    // (there is no direct FK between order_tests and test_group_analytes).
                    if (analyteToOTG.size === 0) {
                        const { data: otRows } = await supabase
                            .from('order_tests')
                            .select('id, test_group_id')
                            .eq('order_id', sample.order_id)

                        if (otRows && otRows.length > 0) {
                            const tgIds = otRows.map((ot: any) => ot.test_group_id).filter(Boolean) as string[]
                            const { data: tgaRows } = await supabase
                                .from('test_group_analytes')
                                .select('analyte_id, test_group_id')
                                .in('test_group_id', tgIds)

                            if (tgaRows) {
                                // Map test_group_id → order_test so we can look up order_test_id per analyte
                                const tgToOT = new Map<string, { id: string; test_group_id: string }>()
                                for (const ot of otRows) {
                                    if (ot.test_group_id) tgToOT.set(ot.test_group_id, ot as any)
                                }
                                for (const tga of tgaRows) {
                                    if (mappedAnalyteIds.includes(tga.analyte_id)) {
                                        const ot = tgToOT.get(tga.test_group_id)
                                        if (ot) {
                                            analyteToOTG.set(tga.analyte_id, {
                                                order_test_group_id: null, // FK references order_test_groups, not order_tests
                                                test_group_id: tga.test_group_id,
                                                order_test_id: ot.id,
                                            })
                                        }
                                    }
                                }
                            }
                            console.log(`DEBUG: Fell back to order_tests, enriched ${analyteToOTG.size} analytes`)
                        }
                    }

                    // If still nothing, use the first test_group_id from either table as blanket fallback
                    if (analyteToOTG.size === 0) {
                        const { data: fallbackRows } = await supabase
                            .from('order_test_groups')
                            .select('id, test_group_id')
                            .eq('order_id', sample.order_id)
                            .limit(1)
                        const fallback = fallbackRows?.[0] ?? null
                        if (!fallback) {
                            const { data: fallbackOT } = await supabase
                                .from('order_tests')
                                .select('id, test_group_id')
                                .eq('order_id', sample.order_id)
                                .limit(1)
                            if (fallbackOT?.[0]) {
                                for (const id of mappedAnalyteIds) {
                                    analyteToOTG.set(id, {
                                        order_test_group_id: null, // FK references order_test_groups, not order_tests
                                        test_group_id: fallbackOT[0].test_group_id,
                                        order_test_id: fallbackOT[0].id,
                                    })
                                }
                                console.log(`DEBUG: Used order_tests blanket fallback test_group_id=${fallbackOT[0].test_group_id} order_test_id=${fallbackOT[0].id}`)
                            }
                        } else {
                            for (const id of mappedAnalyteIds) {
                                analyteToOTG.set(id, {
                                    order_test_group_id: fallback.id,
                                    test_group_id: fallback.test_group_id,
                                })
                            }
                            console.log(`DEBUG: Used order_test_groups blanket fallback test_group_id=${fallback.test_group_id}`)
                        }
                    }

                    // Always back-fill order_test_id from order_tests using test_group_id.
                    // The order_test_groups path sets order_test_group_id but leaves order_test_id null.
                    const { data: otRowsForId } = await supabase
                        .from('order_tests')
                        .select('id, test_group_id')
                        .eq('order_id', sample.order_id)
                    const tgToOrderTestId = new Map<string, string>()
                    for (const ot of otRowsForId || []) {
                        if (ot.test_group_id) tgToOrderTestId.set(ot.test_group_id, ot.id)
                    }
                    for (const [analyteId, entry] of analyteToOTG) {
                        if (!entry.order_test_id && entry.test_group_id) {
                            const otId = tgToOrderTestId.get(entry.test_group_id)
                            if (otId) entry.order_test_id = otId
                        }
                    }

                    for (const [code, mapping] of analyteMap) {
                        const otgInfo = analyteToOTG.get((mapping as any).analyte_id)
                        if (otgInfo) {
                            analyteMap.set(code, { ...(mapping as any), ...otgInfo })
                        }
                    }
                    console.log(`DEBUG: Enriched ${analyteToOTG.size} analytes with order_test_group_id/order_test_id`)
                }

                // Backfill test_group_id on the results row so v_result_panel_status can see it.
                // Pick the most-common test_group_id among mapped analytes.
                if (!resultHeader.test_group_id) {
                    const tgIds = Array.from(analyteMap.values())
                        .map((m: any) => m.test_group_id)
                        .filter(Boolean) as string[]
                    if (tgIds.length > 0) {
                        const freq = new Map<string, number>()
                        for (const id of tgIds) freq.set(id, (freq.get(id) ?? 0) + 1)
                        const dominantTgId = [...freq.entries()].sort((a, b) => b[1] - a[1])[0][0]
                        await supabase.from('results')
                            .update({ test_group_id: dominantTgId })
                            .eq('id', resultHeader.id)
                        resultHeader.test_group_id = dominantTgId
                        console.log(`DEBUG: Set results.test_group_id = ${dominantTgId}`)
                    }
                }

            // D. Insert Result Values with Context
            let mappedCount = 0
            let unmappedCount = 0

            // Preserve exact IDs from mappings; only resolve legacy rows by global analyte_id.
            const labAnalyteIdMap = new Map<string, string>() // analyte_id → lab_analyte_id
            const exactLabAnalyteIds = Array.from(analyteMap.values())
              .map((m: any) => m.lab_analyte_id)
              .filter(Boolean) as string[]
            const analyteIdsNeedingFallback = Array.from(analyteMap.values())
              .filter((m: any) => !m.lab_analyte_id && m.analyte_id)
              .map((m: any) => m.analyte_id) as string[]
            if (analyteIdsNeedingFallback.length > 0) {
              const { data: laRows } = await supabase
                .from('lab_analytes')
                .select('id, analyte_id')
                .eq('lab_id', sample.lab_id)
                .in('analyte_id', [...new Set(analyteIdsNeedingFallback)])
                .order('created_at', { ascending: true })
              if (laRows) {
                for (const la of laRows) {
                  if (!labAnalyteIdMap.has(la.analyte_id)) labAnalyteIdMap.set(la.analyte_id, la.id)
                }
              }
            }

            // Batch-fetch lab_analyte_interface_config (dilution + unit conversion + auto-verify)
            const interfaceConfigMap = new Map<string, {
              multiply_by: number; add_offset: number;
              dilution_factor: number; dilution_mode: string;
              lims_unit: string | null; auto_verify: boolean;
              analyzer_connection_id: string | null
            }>() // lab_analyte_id → config
            const allLabAnalyteIds = [
              ...new Set([...exactLabAnalyteIds, ...labAnalyteIdMap.values()]),
            ]
            if (allLabAnalyteIds.length > 0) {
              const { data: configRows } = await supabase
                .from('lab_analyte_interface_config')
                .select('lab_analyte_id, analyzer_connection_id, multiply_by, add_offset, dilution_factor, dilution_mode, lims_unit, auto_verify')
                .eq('lab_id', sample.lab_id)
                .in('lab_analyte_id', allLabAnalyteIds)
              if (configRows) {
                for (const cfg of configRows) {
                  const existing = interfaceConfigMap.get(cfg.lab_analyte_id)
                  const isSpecific = cfg.analyzer_connection_id && cfg.analyzer_connection_id === record.analyzer_connection_id
                  const isFallback = !cfg.analyzer_connection_id
                  const keepExistingSpecific = existing?.analyzer_connection_id === record.analyzer_connection_id && !isSpecific
                  if ((!isSpecific && !isFallback) || keepExistingSpecific) continue

                  interfaceConfigMap.set(cfg.lab_analyte_id, {
                    multiply_by: Number(cfg.multiply_by ?? 1),
                    add_offset:  Number(cfg.add_offset  ?? 0),
                    dilution_factor: Number(cfg.dilution_factor ?? 1),
                    dilution_mode: String(cfg.dilution_mode ?? 'auto'),
                    lims_unit:   cfg.lims_unit ?? null,
                    auto_verify: cfg.auto_verify ?? false,
                    analyzer_connection_id: cfg.analyzer_connection_id ?? null,
                  })
                }
                console.log(`DEBUG: Loaded interface config for ${interfaceConfigMap.size} analytes`)
              }
            }

            // Batch-fetch reference ranges from lab_analytes
            const refRangeMap = new Map<string, {
              lab_specific: string | null; ref_generic: string | null;
              ref_male: string | null; ref_female: string | null
            }>()
            if (allLabAnalyteIds.length > 0) {
              const { data: refRows } = await supabase
                .from('lab_analytes')
                .select('id, reference_range, reference_range_male, reference_range_female, lab_specific_reference_range')
                .eq('lab_id', sample.lab_id)
                .in('id', allLabAnalyteIds)
              if (refRows) {
                for (const la of refRows) {
                  refRangeMap.set(la.id, {
                    lab_specific: la.lab_specific_reference_range || null,
                    ref_generic:  la.reference_range || null,
                    ref_male:     la.reference_range_male || null,
                    ref_female:   la.reference_range_female || null,
                  })
                }
                console.log(`DEBUG: Loaded reference ranges for ${refRangeMap.size} lab_analytes`)
              }
            }

            const mappedCandidates: Array<{
              item: any
              mapping: any
              labAnalyteId: string | null
              finalParamName: string
              finalValue: string
              finalUnit: string
              verifyStatus: string
              fallbackReferenceRange: string
            }> = []

            for (const item of parsedData.results) {
                const machineCode = item.test_code?.toUpperCase()
                const normalizedValue = normalizeAnalyzerValue(item.value)

                if (normalizedValue === null) {
                    console.log(`[analyzer-result] skipped_empty_value ${JSON.stringify({
                      raw_message_id: record.id,
                      order_id: sample.order_id,
                      analyzer_code: item.test_code || null,
                      raw_value: item.value ?? null,
                    })}`)
                    continue
                }

                // Only use context-aware lookup from order
                const mapping = analyteMap.get(machineCode)

                if (!mapping) {
                    // Log unmapped analyte
                    console.log(`Unmapped analyte: ${item.test_code} - not found in order context`)
                    statusLog += `Unmapped: ${item.test_code}. `
                    unmappedCount++
                    continue
                }

                // Use mapped name
                const finalParamName = mapping.analyte_name

                // Apply dilution + unit conversion + auto-verify from lab_analyte_interface_config.
                // Manual dilution means the analyzer measured a diluted specimen, so multiply
                // back to the original specimen concentration before unit conversion.
                const labAnalyteId = mapping.lab_analyte_id || labAnalyteIdMap.get(mapping.analyte_id) || null
                const ifCfg = labAnalyteId ? interfaceConfigMap.get(labAnalyteId) : null

                let finalValue = normalizedValue
                let finalUnit  = item.unit
                let verifyStatus = 'pending'

                if (ifCfg) {
                  const raw = parseFloat(finalValue)
                  if (!isNaN(raw)) {
                    const dilutionFactor = ifCfg.dilution_mode === 'manual'
                      ? Math.max(1, ifCfg.dilution_factor || 1)
                      : 1
                    const converted = (raw * dilutionFactor * ifCfg.multiply_by) + ifCfg.add_offset
                    finalValue = formatCalculatedResult(converted)
                  }
                  if (ifCfg.lims_unit) finalUnit = ifCfg.lims_unit
                  if (ifCfg.auto_verify)  verifyStatus = 'approved'
                  console.log(`DEBUG: Conversion applied to ${item.test_code}: ${item.value}${item.unit} → ${finalValue}${finalUnit}`)
                }

                const rr = labAnalyteId ? refRangeMap.get(labAnalyteId) : null
                const isMale = patientGender?.toLowerCase().startsWith('m')
                const isFemale = patientGender?.toLowerCase().startsWith('f')
                const fallbackReferenceRange =
                  rr?.lab_specific ||
                  (isMale ? rr?.ref_male : null) ||
                  (isFemale ? rr?.ref_female : null) ||
                  item.reference_range ||
                  rr?.ref_generic ||
                  '-'

                mappedCandidates.push({
                  item,
                  mapping,
                  labAnalyteId,
                  finalParamName,
                  finalValue,
                  finalUnit,
                  verifyStatus,
                  fallbackReferenceRange,
                })
            }

            const candidateTestGroupIds = [
              ...new Set(mappedCandidates.map((candidate) => candidate.mapping.test_group_id).filter(Boolean)),
            ] as string[]
            const aiEnabledTestGroupIds = new Set<string>()
            if (candidateTestGroupIds.length > 0) {
              const { data: aiGroups, error: aiGroupsError } = await supabase
                .from('test_groups')
                .select('id, ref_range_ai_config')
                .in('id', candidateTestGroupIds)

              if (aiGroupsError) {
                console.warn('Failed to load AI reference range configuration:', aiGroupsError)
              } else {
                for (const group of aiGroups ?? []) {
                  if (group.ref_range_ai_config?.enabled === true) aiEnabledTestGroupIds.add(group.id)
                }
              }
            }

            logAiRefRange('configuration_evaluated', {
              order_id: sample.order_id,
              raw_message_id: record.id,
              candidate_count: mappedCandidates.length,
              candidate_test_group_ids: candidateTestGroupIds,
              enabled_test_group_ids: [...aiEnabledTestGroupIds],
            })

            const aiResolvedRanges = await resolveAiReferenceRanges(
              sample.order_id,
              mappedCandidates
                .filter((candidate) => aiEnabledTestGroupIds.has(candidate.mapping.test_group_id))
                .map((candidate) => ({
                  analyte_id: candidate.mapping.analyte_id,
                  lab_analyte_id: candidate.labAnalyteId,
                  analyte_name: candidate.finalParamName,
                  value: candidate.finalValue,
                  unit: candidate.finalUnit,
                  test_group_id: candidate.mapping.test_group_id,
                })),
            )

            for (const candidate of mappedCandidates) {
                const {
                  item,
                  mapping,
                  labAnalyteId,
                  finalParamName,
                  finalValue,
                  finalUnit,
                  verifyStatus,
                  fallbackReferenceRange,
                } = candidate
                const aiResolution = mapping.test_group_id
                  ? aiResolvedRanges.get(`${mapping.test_group_id}:${mapping.analyte_id}`)
                  : null
                const finalFlag = aiResolution?.flag || normalizeHl7Flag(item.flag)
                const finalReferenceRange = aiResolution?.used_reference_range || fallbackReferenceRange
                const fallbackReason = aiResolution
                  ? null
                  : !mapping.test_group_id
                    ? 'missing_test_group'
                    : !aiEnabledTestGroupIds.has(mapping.test_group_id)
                      ? 'ai_disabled'
                      : 'ai_no_resolution'

                logAiRefRange(aiResolution ? 'result_resolution_applied' : 'result_fallback_used', {
                  order_id: sample.order_id,
                  raw_message_id: record.id,
                  test_group_id: mapping.test_group_id || null,
                  analyte_id: mapping.analyte_id,
                  analyzer_code: item.test_code || null,
                  range_source: aiResolution ? 'ai' : 'analyzer_or_lab',
                  fallback_reason: fallbackReason,
                  reference_range: finalReferenceRange,
                  flag: finalFlag,
                })

                const { error: valError } = await supabase.from('result_values').insert({
                    result_id: resultHeader.id,
                    analyte_id: mapping.analyte_id,
                    lab_analyte_id: labAnalyteId,
                    parameter: finalParamName,
                    analyte_name: finalParamName,
                    value: finalValue,
                    unit: finalUnit,
                    flag: finalFlag,
                    reference_range: finalReferenceRange,
                    reference_range_male: labAnalyteId ? (refRangeMap.get(labAnalyteId)?.ref_male ?? null) : null,
                    reference_range_female: labAnalyteId ? (refRangeMap.get(labAnalyteId)?.ref_female ?? null) : null,
                    extracted_by_ai: true,
                    flag_source: aiResolution ? 'ai' : 'analyzer',
                    verify_status: verifyStatus,
                    order_id: sample.order_id,
                    test_group_id: mapping.test_group_id,
                    order_test_group_id: mapping.order_test_group_id,
                    order_test_id: mapping.order_test_id,
                    lab_id: sample.lab_id
                })

                if (valError) {
                    console.error(`Failed to insert result value for ${item.test_code}`, valError)
                    statusLog += `Error inserting ${item.test_code}: ${valError.message}. `
                } else {
                    mappedCount++
                }
            }
            statusLog += `Mapped ${mappedCount} analytes. `

            // Mark order queue entry as completed now that results are stored
            if (mappedCount > 0) {
                await supabase
                    .from('analyzer_order_queue')
                    .update({ status: 'completed', completed_at: new Date().toISOString() })
                    .eq('order_id', sample.order_id)
                    .in('status', ['acknowledged', 'sent'])
            }

            // E. Save decoded histograms to analyzer_graphs table
            if (octerHistograms.length > 0) {
                statusLog += `Saving ${octerHistograms.length} histograms. `

                // Build associated_test map from AI-parsed graphs (test_code → associated_test)
                const aiGraphMap = new Map<string, string>()
                for (const g of (parsedData.graphs || [])) {
                    if (g.test_code) aiGraphMap.set(g.test_code, g.associated_test ?? '')
                }

                const graphRows = octerHistograms.map(h => ({
                    lab_id: sample.lab_id,
                    order_id: sample.order_id,
                    result_id: resultHeader.id,
                    raw_message_id: record.id,
                    test_code: h.testCode,
                    name: h.name,
                    associated_test: aiGraphMap.get(h.testCode) ?? null,
                    histogram_data: h.data,
                    boundaries: {
                        leftLine: h.leftLine ?? null,
                        rightLine: h.rightLine ?? null,
                        divisionLines: h.divisionLines ?? [],
                    },
                    svg_data: generatedHistogramSVGs.find(s => s.testCode === h.testCode)?.svg ?? null,
                }))

                const { error: graphInsertError } = await supabase
                    .from('analyzer_graphs')
                    .insert(graphRows)

                if (graphInsertError) {
                    console.error('Failed to insert analyzer_graphs', graphInsertError)
                    statusLog += `Error saving histograms: ${graphInsertError.message}. `
                } else {
                    statusLog += `Saved ${graphRows.length} histogram rows. `
                }
            }
            }
        }
    }

    // 6. Update Message Log with complete data including graphs
    const finalResult = {
      ...parsedData,
      processing_log: statusLog,
      extracted_images: embeddedImages.length,
      extracted_waveforms: waveformData.length,
      extracted_histograms: octerHistograms.length,
      graphs_analyzed: parsedData.graphs?.length || 0
    };

    await supabase
      .from('analyzer_raw_messages')
      .update({
        ai_status: 'completed',
        ai_result: finalResult,
        ai_confidence: 0.9,
        sample_barcode: parsedData.sample_barcode,
        order_id: foundOrderId,
      })
      .eq('id', record.id)

    return new Response(JSON.stringify({
      success: true,
      log: statusLog,
      images_found: embeddedImages.length,
      waveforms_found: waveformData.length
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (error: any) {
    console.error(error)

    // Mark message as failed so it doesn't stay stuck as 'pending'
    try {
      const supabaseFallback = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      )
      const payload = await req.clone().json().catch(() => null)
      const recordId = payload?.record?.id
      if (recordId) {
        await supabaseFallback
          .from('analyzer_raw_messages')
          .update({
            ai_status: 'failed',
            ai_result: { error: error.message, failed_at: new Date().toISOString() },
          })
          .eq('id', recordId)
      }
    } catch (_) { /* best effort */ }

    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})
