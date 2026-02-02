import { createClient } from 'jsr:@supabase/supabase-js@2'
import Anthropic from 'npm:@anthropic-ai/sdk'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

/**
 * Process Pending Orders - AI-Powered Test Code Mapping
 * 
 * This edge function resolves LIMS test codes to analyzer-specific codes.
 * Triggered when orders are queued via the LIMS Bridge utility.
 * 
 * Flow:
 * 1. Bridge queues order with LIMS codes (e.g., 'CBC', 'LFT')
 * 2. This function fetches analyzer profile and existing mappings
 * 3. AI resolves unknown codes based on context
 * 4. Updates test_mappings cache and marks order as 'mapped'
 * 5. Bridge polls/receives mapped orders and sends to analyzer
 */

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const payload = await req.json()
    const { record, type } = payload

    // Handle both webhook (INSERT trigger) and direct invocation
    const pendingOrder = record || payload.order
    
    if (!pendingOrder) {
      return new Response(JSON.stringify({ message: 'No order provided' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400
      })
    }

    // Initialize Supabase
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Initialize Claude 3.5 Haiku
    const anthropic = new Anthropic({
      apiKey: Deno.env.get('ANTHROPIC_API_KEY') || ''
    })

    const labId = pendingOrder.lab_id
    const analyzerId = pendingOrder.target_analyzer || 'default'
    const requestedTests = pendingOrder.requested_tests || []

    console.log(`Processing order for lab ${labId}, analyzer ${analyzerId}`)
    console.log(`Requested tests: ${requestedTests.join(', ')}`)

    // Mark as processing
    await supabase
      .from('pending_orders')
      .update({ ai_status: 'processing' })
      .eq('id', pendingOrder.id)

    // 1. Fetch existing mappings for this lab/analyzer
    const { data: existingMappings } = await supabase
      .from('test_mappings')
      .select('*')
      .eq('lab_id', labId)
      .eq('analyzer_id', analyzerId)

    const mappingCache = new Map<string, any>()
    if (existingMappings) {
      for (const m of existingMappings) {
        mappingCache.set(m.lims_code.toUpperCase(), m)
      }
    }

    // 2. Fetch analyzer profile (if exists)
    const { data: analyzerProfile } = await supabase
      .from('analyzer_profiles')
      .select('*')
      .eq('id', analyzerId)
      .maybeSingle()

    // 3. Fetch lab's analyte definitions for context
    const { data: labAnalytes } = await supabase
      .from('lab_analytes')
      .select('id, name, code, loinc_code')
      .eq('lab_id', labId)
      .limit(500)

    // 4. Identify codes that need AI resolution
    const resolvedTests: Array<{ lims_code: string; analyzer_code: string; confidence: number }> = []
    const needsResolution: string[] = []

    for (const testCode of requestedTests) {
      const cached = mappingCache.get(testCode.toUpperCase())
      if (cached) {
        resolvedTests.push({
          lims_code: testCode,
          analyzer_code: cached.analyzer_code,
          confidence: cached.ai_confidence || 1.0
        })
      } else {
        needsResolution.push(testCode)
      }
    }

    console.log(`Resolved from cache: ${resolvedTests.length}, needs AI: ${needsResolution.length}`)

    // 5. AI Resolution for unknown codes
    if (needsResolution.length > 0) {
      const prompt = `
You are a laboratory informatics expert specializing in analyzer interfaces.
Your task is to map LIMS test codes to analyzer-specific codes.

ANALYZER INFORMATION:
${analyzerProfile ? JSON.stringify({
  name: analyzerProfile.name,
  manufacturer: analyzerProfile.manufacturer,
  protocol: analyzerProfile.protocol,
  supported_tests: analyzerProfile.supported_tests
}, null, 2) : 'Generic hematology/chemistry analyzer'}

LAB'S ANALYTE DEFINITIONS (for context):
${labAnalytes ? JSON.stringify(labAnalytes.slice(0, 50).map(a => ({
  code: a.code,
  name: a.name,
  loinc: a.loinc_code
})), null, 2) : 'Not available'}

EXISTING MAPPINGS (already resolved):
${JSON.stringify(Array.from(mappingCache.entries()).slice(0, 20).map(([k, v]) => ({
  lims_code: k,
  analyzer_code: v.analyzer_code
})), null, 2)}

CODES TO RESOLVE:
${JSON.stringify(needsResolution)}

TASK: Map each LIMS code to the most likely analyzer code.
Consider:
- Common abbreviations (CBC, CMP, LFT, RFT, KFT, TFT, etc.)
- HL7/ASTM naming conventions
- The specific analyzer's likely test menu
- Use same code if likely direct match
- For panels (like CBC), the analyzer might use same name or variations

OUTPUT ONLY valid JSON:
{
  "mappings": [
    {
      "lims_code": "CBC",
      "analyzer_code": "CBC",
      "test_name": "Complete Blood Count",
      "confidence": 0.95,
      "reasoning": "Standard CBC panel name"
    }
  ]
}
`

      try {
        const message = await anthropic.messages.create({
          model: 'claude-3-5-haiku-20241022',
          max_tokens: 1024,
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ]
        })
        
        const aiText = message.content[0].type === 'text' ? message.content[0].text : ''
        
        // Extract JSON
        const jsonMatch = aiText.match(/\{[\s\S]*\}/)
        const jsonStr = jsonMatch ? jsonMatch[0] : aiText.trim()
        
        const aiMappings = JSON.parse(jsonStr)
        
        if (aiMappings.mappings && Array.isArray(aiMappings.mappings)) {
          for (const mapping of aiMappings.mappings) {
            // Add to resolved tests
            resolvedTests.push({
              lims_code: mapping.lims_code,
              analyzer_code: mapping.analyzer_code,
              confidence: mapping.confidence || 0.8
            })

            // Save to mappings cache for future use
            const { error: insertError } = await supabase
              .from('test_mappings')
              .upsert({
                lab_id: labId,
                analyzer_id: analyzerId,
                lims_code: mapping.lims_code,
                analyzer_code: mapping.analyzer_code,
                test_name: mapping.test_name || mapping.lims_code,
                ai_confidence: mapping.confidence || 0.8,
                verified: false,
                updated_at: new Date().toISOString()
              }, {
                onConflict: 'lab_id,analyzer_id,lims_code'
              })

            if (insertError) {
              console.error(`Failed to cache mapping for ${mapping.lims_code}:`, insertError)
            } else {
              console.log(`Cached new mapping: ${mapping.lims_code} → ${mapping.analyzer_code}`)
            }
          }
        }
      } catch (aiError) {
        console.error('AI mapping failed:', aiError)
        
        // Fallback: use same code as LIMS code
        for (const code of needsResolution) {
          resolvedTests.push({
            lims_code: code,
            analyzer_code: code, // Assume same code
            confidence: 0.5
          })
        }
      }
    }

    // 6. Update the pending order with resolved tests
    const { error: updateError } = await supabase
      .from('pending_orders')
      .update({
        resolved_tests: resolvedTests,
        status: 'mapped',
        ai_status: 'completed'
      })
      .eq('id', pendingOrder.id)

    if (updateError) {
      throw new Error(`Failed to update order: ${updateError.message}`)
    }

    console.log(`Order ${pendingOrder.id} mapped successfully with ${resolvedTests.length} tests`)

    return new Response(JSON.stringify({
      success: true,
      order_id: pendingOrder.id,
      resolved_tests: resolvedTests,
      from_cache: resolvedTests.length - needsResolution.length,
      ai_resolved: needsResolution.length
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('Error processing pending order:', error)
    
    // Try to mark as error if we have the order ID
    try {
      const payload = await req.clone().json()
      const orderId = payload.record?.id || payload.order?.id
      if (orderId) {
        const supabase = createClient(
          Deno.env.get('SUPABASE_URL') ?? '',
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        )
        await supabase
          .from('pending_orders')
          .update({
            ai_status: 'error',
            error_message: error.message
          })
          .eq('id', orderId)
      }
    } catch (e) {
      // Ignore
    }

    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500
    })
  }
})
