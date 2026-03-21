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
    { "test_code": "string", "value": "string", "unit": "string", "flag": "string" }
  ],
  "instrument": "string",
  "graphs": [
    { "type": "histogram|scatter|waveform", "name": "string", "test_code": "string", "description": "string", "associated_test": "string" }
  ]
}

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
    
    let parsedData;
    try {
        parsedData = JSON.parse(jsonStr)
    } catch (e) {
        console.error("AI returned invalid JSON:", aiText)
        throw new Error("AI Parsing Failed: Invalid JSON format")
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
        
        // Fetch Patient Details from Order
        const { data: orderData } = await supabase
            .from('orders')
            .select(`
                patient_id,
                patients (
                    name
                )
            `)
            .eq('id', sample.order_id)
            .single()
            
        const patientId = orderData?.patient_id
        // @ts-ignore
        const patientName = orderData?.patients?.name || "Unknown Patient"
        
        // Ensure master Result record exists
        let { data: resultHeader } = await supabase
            .from('results')
            .select('id')
            .eq('sample_id', sample.id) 
            .maybeSingle()

        if (!resultHeader) {
            const { data: newResult, error: createError } = await supabase
                .from('results')
                .insert({
                    order_id: sample.order_id,
                    patient_id: patientId, // Use fetched patient_id
                    patient_name: patientName,
                    lab_id: sample.lab_id,
                    sample_id: sample.id, // Explicitly link sample
                    test_name: 'Analyzer Result', // Valid Default
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
                    return !NON_CLINICAL_PREFIXES.some(p => code.startsWith(p)) && r.value !== '' && r.flag !== 'F'
                })

                const mappingPrompt = `
You are a laboratory data mapper. Match machine analyzer results to expected lab analytes.
Output ONLY valid JSON. No markdown fences, no explanation.

MACHINE RESULTS:
${JSON.stringify(clinicalResults.map((r: any) => ({ test_code: r.test_code, name: r.name, value: r.value, unit: r.unit })), null, 2)}

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
                
                let aiMappings
                try {
                    aiMappings = JSON.parse(mappingJsonStr)
                } catch (e) {
                    console.error("AI mapping returned invalid JSON:", aiMappingText)
                    statusLog += "AI mapping failed. "
                    aiMappings = { mappings: [] }
                }
                
                // Build lookup map from AI mappings
                const analyteMap = new Map()
                if (aiMappings.mappings && Array.isArray(aiMappings.mappings)) {
                    for (const mapping of aiMappings.mappings) {
                        if (mapping.machine_code && mapping.analyte_id) {
                            analyteMap.set(mapping.machine_code.toUpperCase(), {
                                analyte_id: mapping.analyte_id,
                                analyte_name: mapping.analyte_name,
                                test_group_id: mapping.test_group_id,
                                order_test_group_id: null, // Not in view, will be populated by trigger
                                order_test_id: mapping.order_test_id,
                                confidence: mapping.confidence || 0.8
                            })
                        }
                    }
                }
                
                console.log(`DEBUG: AI mapped ${analyteMap.size} analytes:`, Array.from(analyteMap.keys()).join(', '))

                // Enrich analyteMap with real order_test_group_id and test_group_id
                // by querying order_test_groups → test_group_analytes directly,
                // since v_order_missing_analytes returns null for these fields.
                const mappedAnalyteIds = Array.from(analyteMap.values()).map((m: any) => m.analyte_id)
                if (mappedAnalyteIds.length > 0) {
                    const { data: otgRows } = await supabase
                        .from('order_test_groups')
                        .select('id, test_group_id, test_group_analytes!inner(analyte_id)')
                        .eq('order_id', sample.order_id)

                    if (otgRows) {
                        const analyteToOTG = new Map<string, { order_test_group_id: string; test_group_id: string }>()
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
                        for (const [code, mapping] of analyteMap) {
                            const otgInfo = analyteToOTG.get((mapping as any).analyte_id)
                            if (otgInfo) {
                                analyteMap.set(code, { ...(mapping as any), ...otgInfo })
                            }
                        }
                        console.log(`DEBUG: Enriched ${analyteToOTG.size} analytes with order_test_group_id`)
                    }
                }

            // D. Insert Result Values with Context
            let mappedCount = 0
            let unmappedCount = 0
            for (const item of parsedData.results) {
                const machineCode = item.test_code?.toUpperCase()
                
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
                
                const { error: valError } = await supabase.from('result_values').insert({
                    result_id: resultHeader.id,
                    analyte_id: mapping.analyte_id,
                    parameter: finalParamName,
                    analyte_name: finalParamName,
                    value: item.value, 
                    unit: item.unit,
                    flag: item.flag,
                    reference_range: '-',
                    extracted_by_ai: true,
                    flag_source: 'ai',
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

  } catch (error) {
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
