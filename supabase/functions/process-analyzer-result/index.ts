import { createClient } from 'jsr:@supabase/supabase-js@2'
import { GoogleGenerativeAI } from 'npm:@google/generative-ai'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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
    const genAI = new GoogleGenerativeAI(Deno.env.get('GEMINI_API_KEY') || '')
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' })

    // 4. AI Parse
    const prompt = `
    You are a strictly technical laboratory interface parser. 
    Output ONLY valid JSON. Do NOT write introduction text. Do NOT write "Okay".
    
    Parse this raw analyzer data:
    ${record.raw_content}
    
    REQUIRED JSON STRUCTURE:
    {
      "sample_barcode": "string",
      "results": [
        { "test_code": "string", "value": "string", "unit": "string", "flag": "string" }
      ],
      "instrument": "string"
    }
    `

    const aiResult = await model.generateContent(prompt)
    const aiText = aiResult.response.text()
    
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
    const barcode = String(parsedData.sample_barcode).trim()
    
    // A. Find Sample (using robust WILDCARD search)
    const { data: sampleList, error: sampleError } = await supabase
        .from('samples')
        // REMOVED patient_id because it doesn't exist on samples table
        .select('id, order_id, lab_id, barcode') 
        .ilike('barcode', `%${barcode}%`) 
        .limit(1)

    const sample = sampleList && sampleList.length > 0 ? sampleList[0] : null
    
    if (sampleError || !sample) {
       statusLog += `Warning: Sample with barcode '${barcode}' not found (Lab: ${record.lab_id}).`
    } else {
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
                const mappingPrompt = `
You are a laboratory data mapper. Match machine analyzer results to expected lab analytes.

MACHINE RESULTS:
${JSON.stringify(parsedData.results, null, 2)}

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

                const aiMappingResult = await model.generateContent(mappingPrompt)
                const aiMappingText = aiMappingResult.response.text()
                
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
            statusLog += `Mapped ${mappedCount} analytes.`
            }
        }
    }

    // 6. Update Message Log
    await supabase
      .from('analyzer_raw_messages')
      .update({
        ai_status: 'completed',
        ai_result: parsedData,
        ai_confidence: 0.9,
        sample_barcode: parsedData.sample_barcode,
        // Save the log
        // metadata: { status_log: statusLog } // if metadata column existed, or just store in ai_result?
        ai_result: { ...parsedData, processing_log: statusLog } 
      })
      .eq('id', record.id)

    return new Response(JSON.stringify({ success: true, log: statusLog }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (error) {
    console.error(error)
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})
