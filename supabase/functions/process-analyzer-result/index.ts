import { createClient } from 'jsr:@supabase/supabase-js@2'
import { GoogleGenerativeAI } from 'npm:@google/generative-ai'

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
    const [_, testCode, _, mimeType, encoding, data] = match;
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

    // 3. Init AI - Use vision model if images detected
    const genAI = new GoogleGenerativeAI(Deno.env.get('GEMINI_API_KEY') || '')
    
    // 3a. Extract embedded images and waveform data
    const embeddedImages = extractEmbeddedImages(record.raw_content);
    const waveformData = extractWaveformData(record.raw_content);
    
    console.log(`📊 Found ${embeddedImages.length} images and ${waveformData.length} waveforms in analyzer data`);
    
    // Use vision model if images are present
    const modelName = embeddedImages.length > 0 ? 'gemini-2.5-flash' : 'gemini-2.5-flash';
    const model = genAI.getGenerativeModel({ model: modelName })

    // 4. AI Parse - Include image analysis if images present
    let prompt = `
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
      "instrument": "string",
      "graphs": [
        { "type": "histogram|scatter|waveform", "name": "string", "description": "string", "associated_test": "string" }
      ]
    }
    
    If waveform/histogram data is present, include it in the graphs array.
    `
    
    // Build content parts for AI
    const contentParts: any[] = [{ text: prompt }];
    
    // Add images if present (for vision analysis)
    if (embeddedImages.length > 0) {
      for (const img of embeddedImages) {
        contentParts.push({
          inlineData: {
            mimeType: `image/${img.type}`,
            data: img.data
          }
        });
      }
      contentParts.push({
        text: `\n\nANALYZE THE ATTACHED ${embeddedImages.length} IMAGE(S) FROM THE ANALYZER.
        For each image, identify:
        - What type of graph/chart it is (histogram, scatter plot, waveform, etc.)
        - What test/parameter it relates to (WBC diff, RBC histogram, etc.)
        - Any abnormalities visible
        - Include this analysis in the "graphs" array of your response.`
      });
    }
    
    // Add waveform data context
    if (waveformData.length > 0) {
      contentParts.push({
        text: `\n\nWAVEFORM DATA DETECTED:
        ${JSON.stringify(waveformData, null, 2)}
        Include these in the "graphs" array with type "waveform".`
      });
    }

    const aiResult = await model.generateContent(contentParts)
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
            statusLog += `Mapped ${mappedCount} analytes. `
            
            // E. Store analyzer graphs/images if present
            if (embeddedImages.length > 0 || waveformData.length > 0 || parsedData.graphs?.length > 0) {
                statusLog += `Processing ${embeddedImages.length} images, ${waveformData.length} waveforms. `
                
                // Store images in Supabase Storage
                const storedImages: Array<{ name: string; url: string; type: string }> = [];
                for (const img of embeddedImages) {
                    try {
                        // Decode base64 and upload to storage
                        const binaryData = Uint8Array.from(atob(img.data), c => c.charCodeAt(0));
                        const fileName = `analyzer-graphs/${sample.lab_id}/${sample.order_id}/${img.name}_${Date.now()}.${img.type}`;
                        
                        const { data: uploadData, error: uploadError } = await supabase.storage
                            .from('attachments')
                            .upload(fileName, binaryData, {
                                contentType: `image/${img.type}`,
                                upsert: true
                            });
                        
                        if (!uploadError && uploadData) {
                            const { data: urlData } = supabase.storage
                                .from('attachments')
                                .getPublicUrl(fileName);
                            
                            storedImages.push({
                                name: img.name,
                                url: urlData?.publicUrl || '',
                                type: img.type
                            });
                            statusLog += `Uploaded ${img.name}. `;
                        }
                    } catch (imgErr) {
                        console.error('Failed to upload analyzer image:', imgErr);
                    }
                }
                
                // Build analyzer_graph_data structure for the order
                const analyzerGraphData = {
                    generated_at: new Date().toISOString(),
                    source: 'analyzer_interface',
                    instrument: parsedData.instrument,
                    images: storedImages,
                    waveforms: waveformData,
                    ai_analysis: parsedData.graphs || [],
                };
                
                // Store in order's trend_graph_data (or a dedicated field)
                // We'll merge with existing trend_graph_data if present
                const { data: existingOrder } = await supabase
                    .from('orders')
                    .select('trend_graph_data')
                    .eq('id', sample.order_id)
                    .single();
                
                const existingData = existingOrder?.trend_graph_data || {};
                const updatedGraphData = {
                    ...existingData,
                    analyzer_graphs: analyzerGraphData
                };
                
                await supabase
                    .from('orders')
                    .update({ trend_graph_data: updatedGraphData })
                    .eq('id', sample.order_id);
                
                statusLog += `Stored ${storedImages.length} graph images. `;
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
      graphs_analyzed: parsedData.graphs?.length || 0
    };
    
    await supabase
      .from('analyzer_raw_messages')
      .update({
        ai_status: 'completed',
        ai_result: finalResult,
        ai_confidence: 0.9,
        sample_barcode: parsedData.sample_barcode,
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
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})
