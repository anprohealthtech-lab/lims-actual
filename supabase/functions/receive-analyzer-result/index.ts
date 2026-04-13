// AI Result Receiver - Enhanced version with ACK handling and intelligent result storage
// Webhook endpoint for analyzer_raw_messages table inserts
// Handles: ORU (Results), ACK (Acknowledgments), NAK (Rejections)

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { GoogleGenerativeAI } from 'npm:@google/generative-ai'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Parse HL7 message type from MSH segment
function parseMessageType(rawContent: string): { type: string; controlId: string } {
  const mshMatch = rawContent.match(/MSH\|[^|]*\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|[^|]*\|([^|]*)\|([^|]*)/i)
  
  if (mshMatch) {
    return {
      type: mshMatch[6] || 'UNKNOWN',    // Message Type (ORM, ORU, ACK)
      controlId: mshMatch[7] || ''       // Message Control ID
    }
  }
  
  // Try ASTM format
  if (rawContent.includes('H|') || rawContent.startsWith('1H')) {
    return { type: 'ASTM_RESULT', controlId: '' }
  }
  
  return { type: 'UNKNOWN', controlId: '' }
}

// Handle ACK/NAK messages - update order queue status
async function handleAcknowledgment(
  supabase: any, 
  messageType: string, 
  controlId: string, 
  rawContent: string,
  labId: string
): Promise<{ handled: boolean; message: string }> {
  
  if (!controlId) {
    return { handled: false, message: 'No control ID for ACK correlation' }
  }

  // Find the original order in queue
  const { data: queueEntry, error } = await supabase
    .from('analyzer_order_queue')
    .select('*')
    .eq('message_control_id', controlId)
    .eq('lab_id', labId)
    .single()

  if (error || !queueEntry) {
    return { handled: false, message: `No matching order found for control ID: ${controlId}` }
  }

  const isPositiveAck = messageType.includes('ACK') || 
                        rawContent.includes('AA') ||  // Application Accept
                        rawContent.includes('CA')     // Commit Accept

  const newStatus = isPositiveAck ? 'acknowledged' : 'rejected'
  const errorMsg = isPositiveAck ? null : extractAckError(rawContent)

  await supabase
    .from('analyzer_order_queue')
    .update({
      status: newStatus,
      ack_received_at: new Date().toISOString(),
      last_error: errorMsg
    })
    .eq('id', queueEntry.id)

  // Log communication
  await supabase
    .from('analyzer_comm_log')
    .insert({
      lab_id: labId,
      analyzer_connection_id: queueEntry.analyzer_connection_id,
      direction: 'RECEIVE',
      message_type: messageType,
      message_control_id: controlId,
      message_preview: rawContent.slice(0, 500),
      message_size: rawContent.length,
      success: isPositiveAck,
      error_message: errorMsg,
      order_id: queueEntry.order_id,
      queue_id: queueEntry.id
    })

  return { 
    handled: true, 
    message: `${messageType} processed: Order ${queueEntry.order_id} marked as ${newStatus}` 
  }
}

// Extract error message from NAK
function extractAckError(rawContent: string): string | null {
  // Look for ERR segment
  const errMatch = rawContent.match(/ERR\|[^|]*\|[^|]*\|[^|]*\|([^|]*)/i)
  if (errMatch) return errMatch[1]
  
  // Look for MSA segment error code
  const msaMatch = rawContent.match(/MSA\|([^|]*)\|[^|]*\|([^|]*)/i)
  if (msaMatch && msaMatch[2]) return msaMatch[2]
  
  return null
}

// Extract sample barcode from various message formats
function extractBarcode(rawContent: string): string | null {
  // HL7: OBR segment field 3 or 20
  const obrMatch = rawContent.match(/OBR\|[^|]*\|([^|]*)\|([^|]*)/i)
  if (obrMatch && obrMatch[1]) return obrMatch[1].split('^')[0]
  
  // HL7: PID segment field 3
  const pidMatch = rawContent.match(/PID\|[^|]*\|[^|]*\|([^|]*)/i)
  if (pidMatch && pidMatch[1]) return pidMatch[1].split('^')[0]
  
  // ASTM: Patient record
  const astmPatient = rawContent.match(/P\|[^|]*\|([^|]*)/i)
  if (astmPatient) return astmPatient[1]
  
  return null
}

// Main AI parsing function for results
async function parseResultsWithAI(
  supabase: any,
  genAI: GoogleGenerativeAI,
  rawContent: string,
  labId: string
): Promise<{
  barcode: string
  results: Array<{
    test_code: string
    value: string
    unit: string
    flag: string
    reference_range?: string
  }>
  instrument?: string
  graphs?: any[]
}> {
  
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })
  
  // Get lab's existing mappings for context
  // usage_count may be null for older records, so handle that
  const { data: knownMappings } = await supabase
    .from('test_mappings')
    .select('analyzer_code, lims_code')
    .eq('lab_id', labId)
    .or('usage_count.gt.0,verified.eq.true')
    .limit(100)
  
  const mappingContext = knownMappings?.length 
    ? `\nKNOWN CODE MAPPINGS:\n${knownMappings.map((m: any) => `${m.analyzer_code} -> ${m.lims_code}`).join('\n')}`
    : ''
  
  const prompt = `You are a laboratory analyzer result parser. Parse this raw analyzer data.
${mappingContext}

RAW DATA:
${rawContent}

OUTPUT ONLY valid JSON:
{
  "barcode": "sample/patient identifier",
  "instrument": "analyzer name if detectable",
  "results": [
    {
      "test_code": "LIMS code (use mapping if available, otherwise analyzer code)",
      "analyzer_code": "original code from analyzer",
      "value": "numeric or text value",
      "unit": "unit if present",
      "flag": "H/L/HH/LL/A/N/empty for normal",
      "reference_range": "range if present"
    }
  ],
  "graphs": [
    {
      "type": "histogram/scatter/waveform",
      "name": "description",
      "associated_test": "related test code"
    }
  ]
}

PARSING RULES:
1. Extract ALL result values (OBX segments in HL7, R records in ASTM)
2. Preserve original flags (H=High, L=Low, HH=Critical High, etc.)
3. Include units and reference ranges when present
4. Identify embedded images/graphs
5. Use LIMS code from mappings when available`

  const aiResult = await model.generateContent(prompt)
  const text = aiResult.response.text()
  
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    throw new Error('AI returned invalid JSON')
  }
  
  return JSON.parse(jsonMatch[0])
}

// Store results in database with intelligent analyte matching
async function storeResults(
  supabase: any,
  genAI: GoogleGenerativeAI,
  parsedData: any,
  labId: string,
  rawMessageId: string
): Promise<{ success: boolean; mapped: number; unmapped: number; log: string }> {
  
  let log = ''
  let mappedCount = 0
  let unmappedCount = 0
  
  // Find sample by barcode
  const { data: samples } = await supabase
    .from('samples')
    .select('id, order_id, lab_id, barcode')
    .eq('lab_id', labId)
    .ilike('barcode', `%${parsedData.barcode}%`)
    .limit(1)
  
  const sample = samples?.[0]
  
  if (!sample) {
    // Try orders table sample_id field
    const { data: orders } = await supabase
      .from('orders')
      .select('id, sample_id, patient_id, lab_id')
      .eq('lab_id', labId)
      .ilike('sample_id', `%${parsedData.barcode}%`)
      .limit(1)
    
    if (!orders?.[0]) {
      log = `Sample not found for barcode: ${parsedData.barcode}`
      return { success: false, mapped: 0, unmapped: parsedData.results?.length || 0, log }
    }
    
    // Use order directly
    const order = orders[0]
    return await storeResultsForOrder(supabase, genAI, parsedData, order, labId, log)
  }
  
  return await storeResultsForSample(supabase, genAI, parsedData, sample, labId, log)
}

async function storeResultsForOrder(
  supabase: any,
  genAI: GoogleGenerativeAI,
  parsedData: any,
  order: any,
  labId: string,
  log: string
) {
  let mappedCount = 0
  let unmappedCount = 0
  
  // Get expected analytes for this order
  const { data: expectedAnalytes } = await supabase
    .from('v_order_missing_analytes')
    .select('*')
    .eq('order_id', order.id)
  
  // AI mapping of results to expected analytes
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })
  
  const mappingPrompt = `Match analyzer results to expected lab analytes.

ANALYZER RESULTS:
${JSON.stringify(parsedData.results, null, 2)}

EXPECTED ANALYTES:
${JSON.stringify(expectedAnalytes?.map((a: any) => ({
  analyte_id: a.analyte_id,
  analyte_name: a.analyte_name,
  test_group_id: a.test_group_id,
  order_test_id: a.order_test_id
})) || [], null, 2)}

OUTPUT JSON:
{
  "mappings": [
    {
      "analyzer_code": "original code",
      "analyte_id": "uuid or null if no match",
      "analyte_name": "matched name",
      "test_group_id": "uuid or null",
      "order_test_id": "uuid or null",
      "confidence": 0.95
    }
  ]
}`

  let analyteMap = new Map()
  
  try {
    const aiResult = await model.generateContent(mappingPrompt)
    const text = aiResult.response.text()
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    
    if (jsonMatch) {
      const mappings = JSON.parse(jsonMatch[0])
      for (const m of mappings.mappings || []) {
        if (m.analyzer_code && m.analyte_id) {
          analyteMap.set(m.analyzer_code.toUpperCase(), m)
        }
      }
    }
  } catch (e: any) {
    console.error('AI mapping error:', e?.message, JSON.stringify(e))
    log += `AI mapping failed: ${e?.message}. `
  }
  
  // Ensure result record exists
  let { data: resultHeader } = await supabase
    .from('results')
    .select('id')
    .eq('order_id', order.id)
    .maybeSingle()
  
  if (!resultHeader) {
    const { data: newResult } = await supabase
      .from('results')
      .insert({
        order_id: order.id,
        patient_id: order.patient_id,
        lab_id: labId,
        test_name: 'Analyzer Result',
        entered_by: 'AI Interface',
        status: 'Entered'
      })
      .select()
      .single()
    resultHeader = newResult
  }
  
  if (!resultHeader) {
    return { success: false, mapped: 0, unmapped: parsedData.results.length, log: 'Failed to create result record' }
  }
  
  // Insert result values
  // Batch-resolve lab_analyte_id for all mapped analytes
  const allMappedAnalyteIds = Array.from(analyteMap.values()).map((m: any) => m.analyte_id).filter(Boolean) as string[]
  const labAnalyteIdMap = new Map<string, string>()
  if (allMappedAnalyteIds.length > 0) {
    const { data: laRows } = await supabase
      .from('lab_analytes')
      .select('id, analyte_id')
      .eq('lab_id', labId)
      .in('analyte_id', allMappedAnalyteIds)
      .order('created_at', { ascending: true })
    if (laRows) {
      for (const la of laRows) {
        if (!labAnalyteIdMap.has(la.analyte_id)) labAnalyteIdMap.set(la.analyte_id, la.id)
      }
    }
  }

  for (const item of parsedData.results) {
    const code = (item.analyzer_code || item.test_code)?.toUpperCase()
    const mapping = analyteMap.get(code)
    
    if (!mapping?.analyte_id) {
      unmappedCount++
      log += `Unmapped: ${item.test_code}. `
      continue
    }
    
    const { error } = await supabase.from('result_values').insert({
      result_id: resultHeader.id,
      order_id: order.id,
      lab_id: labId,
      analyte_id: mapping.analyte_id,
      lab_analyte_id: labAnalyteIdMap.get(mapping.analyte_id) || null,
      parameter: mapping.analyte_name,
      analyte_name: mapping.analyte_name,
      value: item.value,
      unit: item.unit,
      flag: item.flag,
      reference_range: item.reference_range || '-',
      extracted_by_ai: true,
      flag_source: 'analyzer',
      test_group_id: mapping.test_group_id,
      order_test_id: mapping.order_test_id
    })
    
    if (!error) {
      mappedCount++
    } else {
      log += `Error: ${item.test_code}: ${error.message}. `
    }
  }
  
  log += `Mapped ${mappedCount}/${parsedData.results.length} results. `
  
  // Update order queue if exists
  await supabase
    .from('analyzer_order_queue')
    .update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq('order_id', order.id)
    .eq('status', 'acknowledged')
  
  return { success: true, mapped: mappedCount, unmapped: unmappedCount, log }
}

async function storeResultsForSample(
  supabase: any,
  genAI: GoogleGenerativeAI,
  parsedData: any,
  sample: any,
  labId: string,
  log: string
) {
  // Get order from sample
  const { data: order } = await supabase
    .from('orders')
    .select('id, patient_id')
    .eq('id', sample.order_id)
    .single()
  
  if (!order) {
    return { success: false, mapped: 0, unmapped: parsedData.results.length, log: 'Order not found for sample' }
  }
  
  return await storeResultsForOrder(supabase, genAI, parsedData, order, labId, log)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const startTime = Date.now()
  
  try {
    const payload = await req.json()
    const { record } = payload

    if (!record?.raw_content) {
      return new Response(JSON.stringify({ message: 'No content to process' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Deduplication guard: process-analyzer-result is the primary handler.
    // If the row is already being processed or completed, skip to avoid duplicate result_values.
    if (record.ai_status && record.ai_status !== 'pending') {
      return new Response(JSON.stringify({ message: 'Already handled by primary processor' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )
    
    const genAI = new GoogleGenerativeAI(Deno.env.get('GEMINI_API_KEY') || '')

    // Parse message type
    const { type: messageType, controlId } = parseMessageType(record.raw_content)
    
    console.log(`📥 Received ${messageType} message, Control ID: ${controlId || 'N/A'}`)

    // Update message with type info
    await supabase
      .from('analyzer_raw_messages')
      .update({ 
        message_type: messageType,
        message_control_id: controlId,
        ai_status: 'processing'
      })
      .eq('id', record.id)

    // Handle ACK/NAK messages
    if (messageType.includes('ACK') || messageType.includes('NAK')) {
      const ackResult = await handleAcknowledgment(
        supabase, messageType, controlId, record.raw_content, record.lab_id
      )
      
      await supabase
        .from('analyzer_raw_messages')
        .update({ 
          ai_status: 'completed',
          ai_result: { type: 'acknowledgment', ...ackResult },
          processing_time_ms: Date.now() - startTime
        })
        .eq('id', record.id)
      
      return new Response(JSON.stringify(ackResult), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Handle result messages (ORU, ASTM_RESULT, etc.)
    const parsedData = await parseResultsWithAI(supabase, genAI, record.raw_content, record.lab_id)
    
    // Update with barcode for quick lookup
    await supabase
      .from('analyzer_raw_messages')
      .update({ sample_barcode: parsedData.barcode })
      .eq('id', record.id)

    // Store results
    const storeResult = await storeResults(supabase, genAI, parsedData, record.lab_id, record.id)

    // Final update
    await supabase
      .from('analyzer_raw_messages')
      .update({
        ai_status: storeResult.success ? 'completed' : 'review_needed',
        ai_result: {
          ...parsedData,
          storage_result: storeResult
        },
        ai_confidence: storeResult.mapped / (storeResult.mapped + storeResult.unmapped) || 0,
        processing_time_ms: Date.now() - startTime
      })
      .eq('id', record.id)

    // Log communication
    await supabase
      .from('analyzer_comm_log')
      .insert({
        lab_id: record.lab_id,
        analyzer_connection_id: record.analyzer_connection_id,
        direction: 'RECEIVE',
        message_type: messageType,
        message_control_id: controlId,
        message_preview: record.raw_content.slice(0, 500),
        message_size: record.raw_content.length,
        success: storeResult.success,
        processing_time_ms: Date.now() - startTime,
        raw_message_id: record.id
      })

    return new Response(JSON.stringify({
      success: storeResult.success,
      message_type: messageType,
      barcode: parsedData.barcode,
      results_count: parsedData.results?.length || 0,
      mapped: storeResult.mapped,
      unmapped: storeResult.unmapped,
      processing_time_ms: Date.now() - startTime,
      log: storeResult.log
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('Process error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500
    })
  }
})
