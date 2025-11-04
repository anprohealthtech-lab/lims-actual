import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface ContextualizerRequest {
  protocol_id: string;
  technician_flow_draft: any;
  ai_spec_draft: any;
  lab_id: string;
  test_group_id?: string | null;
}

interface ContextualizerResponse {
  technician_flow_final: any;
  ai_spec_final: any;
  version_metadata: {
    version_hint: string;
    test_code: string;
    display_name: string;
    analyte_names: string[];
  };
  final_validation: {
    needs_attention: Array<{
      description: string;
      severity: 'info' | 'warning' | 'error';
    }>;
  };
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Verify authentication
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      throw new Error('No authorization header')
    }

    // Initialize Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: authHeader },
        },
      }
    )

    // Verify user authentication
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser()
    if (authError || !user) {
      throw new Error('Invalid authentication')
    }

    // Parse request body
    const { 
      protocol_id, 
      technician_flow_draft, 
      ai_spec_draft, 
      lab_id, 
      test_group_id 
    }: ContextualizerRequest = await req.json()

    if (!protocol_id || !technician_flow_draft || !ai_spec_draft) {
      throw new Error('Protocol ID and draft workflows are required')
    }

    // Get lab context and test group information
    let labContext = {}
    let testGroupContext = {}
    let analytes: any[] = []

    // Fetch lab information
    const { data: lab } = await supabaseClient
      .from('labs')
      .select('name, settings')
      .eq('id', lab_id)
      .single()

    if (lab) {
      labContext = {
        lab_name: lab.name,
        lab_settings: lab.settings
      }
    }

    // Fetch test group and analytes if provided
    if (test_group_id) {
      const { data: testGroup } = await supabaseClient
        .from('test_groups')
        .select(`
          *,
          test_group_analytes(
            analyte_id,
            analytes(
              id,
              name,
              unit,
              reference_range,
              ai_processing_type
            )
          )
        `)
        .eq('id', test_group_id)
        .single()

      if (testGroup) {
        testGroupContext = {
          test_name: testGroup.name,
          test_code: testGroup.code,
          category: testGroup.category,
          sample_type: testGroup.sample_type
        }
        analytes = testGroup.test_group_analytes?.map((tga: any) => tga.analytes) || []
      }
    }

    // Get Gemini API key
    const geminiApiKey = Deno.env.get('ALLGOOGLE_KEY')
    if (!geminiApiKey) {
      throw new Error('Gemini API key not configured')
    }

    // Build contextualization prompt
    const systemPrompt = getContextualizationPrompt()
    const contextData = {
      lab_context: labContext,
      test_group_context: testGroupContext,
      available_analytes: analytes,
      technician_flow_draft,
      ai_spec_draft
    }

    const fullPrompt = `${systemPrompt}

CONTEXT DATA:
${JSON.stringify(contextData, null, 2)}

TASK: Contextualize and finalize the draft workflows using the lab and test group context. Ensure analyte mappings are accurate and workflow steps align with lab practices.

Return ONLY valid JSON matching the ContextualizerResponse interface.`

    // Call Gemini API
    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${geminiApiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: fullPrompt
                }
              ]
            }
          ],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 8192,
            responseMimeType: "application/json"
          }
        })
      }
    )

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text()
      throw new Error(`Gemini API error: ${errorText}`)
    }

    const geminiData = await geminiResponse.json()
    
    if (!geminiData.candidates?.[0]?.content?.parts?.[0]?.text) {
      throw new Error('Invalid response format from Gemini API')
    }

    const responseText = geminiData.candidates[0].content.parts[0].text
    let parsedResponse: ContextualizerResponse

    try {
      parsedResponse = JSON.parse(responseText)
    } catch (parseError) {
      // Fallback response if parsing fails
      const testCode = (testGroupContext as any).test_code || 'UNKNOWN'
      parsedResponse = {
        technician_flow_final: technician_flow_draft,
        ai_spec_final: ai_spec_draft,
        version_metadata: {
          version_hint: "1.0.0",
          test_code: testCode,
          display_name: `${testCode} Workflow`,
          analyte_names: analytes.map((a: any) => a.name)
        },
        final_validation: {
          needs_attention: [
            {
              description: "Contextualization failed - using draft workflows as-is. Please review manually.",
              severity: "warning" as const
            }
          ]
        }
      }
    }

    // Log usage for analytics
    await supabaseClient
      .from('ai_usage_logs')
      .insert({
        user_id: user.id,
        lab_id: lab_id,
        processing_type: 'contextualizer',
        input_data: { protocol_id, test_group_id },
        confidence: 0.9,
        created_at: new Date().toISOString()
      })

    return new Response(
      JSON.stringify(parsedResponse),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      },
    )

  } catch (error) {
    console.error('Error in contextualizer:', error)
    
    return new Response(
      JSON.stringify({
        error: error.message,
        technician_flow_final: null,
        ai_spec_final: null,
        version_metadata: null,
        final_validation: {
          needs_attention: [
            {
              description: `Contextualization error: ${error.message}`,
              severity: 'error'
            }
          ]
        }
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      },
    )
  }
})

function getContextualizationPrompt(): string {
  return `You are an AI agent responsible for contextualizing and finalizing laboratory workflow drafts. Your task is to integrate lab-specific context, test group information, and available analytes to create production-ready workflows.

OUTPUT FORMAT:
{
  "technician_flow_final": {
    "title": "string",
    "description": "string",
    "pages": [
      {
        "name": "string", 
        "title": "string",
        "elements": [
          {
            "type": "html|text|radiogroup|checkbox|dropdown|rating|matrix|file",
            "name": "string",
            "title": "string",
            "isRequired": boolean,
            "choices": ["option1", "option2"],
            "validators": [
              {
                "type": "numeric|regex|expression",
                "text": "validation error message"
              }
            ]
          }
        ]
      }
    ]
  },
  "ai_spec_final": {
    "steps": [
      {
        "step_type": "extract_values|validate_range|calculate_result|flag_abnormal|map_to_analyte",
        "description": "string",
        "parameters": {
          "target_analyte_id": "uuid_if_mapping_to_existing",
          "target_fields": ["field1", "field2"],
          "validation_rules": ["numeric", "range_check"],
          "reference_ranges": {"analyte_name": "range"},
          "calculations": "formula if applicable",
          "units": "mg/dL, mmol/L, etc."
        }
      }
    ]
  },
  "version_metadata": {
    "version_hint": "1.0.0",
    "test_code": "string",
    "display_name": "string", 
    "analyte_names": ["analyte1", "analyte2"],
    "created_by": "contextualizer_agent",
    "contextualization_timestamp": "ISO_timestamp"
  },
  "final_validation": {
    "needs_attention": [
      {
        "description": "string",
        "severity": "info|warning|error"
      }
    ]
  }
}

CONTEXTUALIZATION REQUIREMENTS:

1. ANALYTE MAPPING:
   - Map workflow result fields to existing lab analytes where possible
   - Use analyte IDs for direct mapping
   - Ensure units and reference ranges align
   - Flag unmapped results for manual review

2. LAB CUSTOMIZATION:
   - Incorporate lab-specific settings and preferences
   - Adjust workflow steps for lab equipment and procedures  
   - Apply lab's quality control requirements
   - Use lab's standard terminology and formats

3. VALIDATION ENHANCEMENT:
   - Add appropriate input validation to form elements
   - Include range checks based on analyte reference ranges
   - Add calculated fields where test requires computations
   - Flag critical values that need immediate attention

4. WORKFLOW OPTIMIZATION:
   - Ensure logical flow between pages/steps
   - Add conditional navigation where appropriate
   - Include progress indicators and help text
   - Optimize for mobile/tablet use in lab environments

5. QUALITY ASSURANCE:
   - Validate all required fields are present
   - Check for consistency between technician workflow and AI spec
   - Ensure all analytes can be processed by the AI specification
   - Flag any ambiguities or missing information

Focus on creating production-ready workflows that integrate seamlessly with the existing lab's processes and analyte configurations.`
}