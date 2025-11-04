import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface ManualBuilderRequest {
  protocol_id: string;
  manual_uri: string;
  org_id: string;
  test_meta: {
    testCode: string;
    vendor: string;
    model: string;
    sampleType: string;
  };
}

interface ManualBuilderResponse {
  technician_flow_draft: any;
  ai_spec_draft: any;
  builder_validation: {
    needs_attention: Array<{
      description: string;
      severity: 'info' | 'warning' | 'error';
    }>;
  };
  sections_provenance?: any;
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
    const { protocol_id, manual_uri, org_id, test_meta }: ManualBuilderRequest = await req.json()

    if (!protocol_id || !manual_uri) {
      throw new Error('Protocol ID and manual URI are required')
    }

    // Verify protocol exists and user has access
    const { data: protocol, error: protocolError } = await supabaseClient
      .from('ai_protocols')
      .select('id, lab_id, category, status')
      .eq('id', protocol_id)
      .single()

    if (protocolError || !protocol) {
      throw new Error('Protocol not found or access denied')
    }

    // Get Gemini API key
    const geminiApiKey = Deno.env.get('ALLGOOGLE_KEY')
    if (!geminiApiKey) {
      throw new Error('Gemini API key not configured')
    }

    // Build the system prompt for manual processing
    const systemPrompt = getManualProcessingPrompt()

    const fullPrompt = `${systemPrompt}

MANUAL URI TO PROCESS: ${manual_uri}
TEST METADATA:
- Test Code: ${test_meta.testCode}
- Vendor: ${test_meta.vendor}
- Model: ${test_meta.model}
- Sample Type: ${test_meta.sampleType}
- Lab ID: ${org_id}

INSTRUCTIONS:
1. Generate a SurveyJS workflow for technicians to follow the test procedure
2. Create an AI processing specification for result extraction and validation
3. Identify any sections that need human review or clarification
4. Return structured JSON as specified

Return ONLY valid JSON with no additional text.`

    // Call Gemini API to process the manual
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
            temperature: 0.3,
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
    let parsedResponse: ManualBuilderResponse

    try {
      parsedResponse = JSON.parse(responseText)
    } catch (parseError) {
      // Fallback response if parsing fails
      parsedResponse = {
        technician_flow_draft: {
          ui: {
            engine: "surveyjs",
            template: {
              title: `${test_meta.testCode} Workflow`,
              pages: [
                {
                  name: "preparation",
                  elements: [
                    {
                      type: "html",
                      name: "prep_instructions",
                      html: `<h3>Sample Preparation</h3><p>Prepare ${test_meta.sampleType} sample according to ${test_meta.vendor} ${test_meta.model} instructions.</p>`
                    }
                  ]
                },
                {
                  name: "testing",
                  elements: [
                    {
                      type: "text",
                      name: "result_value",
                      title: "Enter test result:",
                      isRequired: true
                    }
                  ]
                }
              ],
              showPrevButton: false,
              showProgressBar: "off",
              completedHtml: "<h3>Test completed</h3><p>Results have been recorded.</p>"
            }
          },
          meta: {
            owner: "AI Generated",
            title: `${test_meta.testCode} - ${test_meta.vendor} ${test_meta.model}`
          },
          rules: {
            mode: "ADVANCED",
            steps: [
              { id: "preparation", no: 0 },
              { id: "testing", no: 1 }
            ]
          }
        },
        ai_spec_draft: {
          steps: [
            {
              step_type: "extract_values",
              description: "Extract numeric values from test results",
              parameters: {
                target_fields: ["result_value"],
                validation_rules: ["numeric"]
              }
            }
          ]
        },
        builder_validation: {
          needs_attention: [
            {
              description: "Manual parsing failed - workflow generated from template. Please review and customize.",
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
        lab_id: protocol.lab_id,
        processing_type: 'manual_builder',
        input_data: { protocol_id, test_meta },
        confidence: 0.8,
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
    console.error('Error in manual builder:', error)
    
    return new Response(
      JSON.stringify({
        error: error.message,
        technician_flow_draft: null,
        ai_spec_draft: null,
        builder_validation: {
          needs_attention: [
            {
              description: `Processing error: ${error.message}`,
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

function getManualProcessingPrompt(): string {
  return `You are an AI agent specialized in converting laboratory test manuals/IFUs into structured workflows. Your task is to analyze the provided manual URI and generate two outputs:

1. A SurveyJS workflow definition for technicians
2. An AI processing specification for result extraction

OUTPUT FORMAT:
{
  "technician_flow_draft": {
    "ui": {
      "engine": "surveyjs",
      "template": {
        "title": "string",
        "pages": [
          {
            "name": "string",
            "elements": [
              {
                "type": "html|text|radiogroup|checkbox|dropdown|rating|matrix|file",
                "name": "string",
                "title": "string",
                "isRequired": boolean,
                "choices": ["option1", "option2"],
                "html": "content for html type"
              }
            ]
          }
        ],
        "showPrevButton": false,
        "showProgressBar": "off",
        "completedHtml": "<h3>Test completed</h3>"
      }
    },
    "meta": {
      "owner": "string",
      "title": "string"
    },
    "rules": {
      "mode": "ADVANCED",
      "steps": [
        {"id": "page_name", "no": 0}
      ]
    }
  },
  "ai_spec_draft": {
    "steps": [
      {
        "step_type": "extract_values|validate_range|calculate_result|flag_abnormal",
        "description": "string",
        "parameters": {
          "target_fields": ["field1", "field2"],
          "validation_rules": ["numeric", "range_check"],
          "calculations": "formula if applicable"
        }
      }
    ]
  },
  "builder_validation": {
    "needs_attention": [
      {
        "description": "string",
        "severity": "info|warning|error"
      }
    ]
  },
  "sections_provenance": {
    "preparation_section": "page_numbers_or_sections",
    "procedure_section": "page_numbers_or_sections", 
    "results_section": "page_numbers_or_sections",
    "quality_control": "page_numbers_or_sections"
  }
}

TECHNICIAN WORKFLOW REQUIREMENTS:
- Break down test procedure into logical steps/pages
- Include sample preparation, quality control, measurement, and result entry
- Use appropriate SurveyJS element types (html for instructions, text for data entry, etc.)
- Make critical steps required
- Include visual aids and safety warnings where applicable
- CRITICAL: Structure must match the working format with ui.engine, ui.template, meta, and rules sections
- Use html elements for instructions/titles within page elements
- Each page should have elements array, not separate title property

AI SPEC REQUIREMENTS:
- Define steps for automated result processing
- Include validation rules for extracted values
- Specify calculations if the test requires computed results
- Define abnormal value flagging criteria
- Map to standard units and reference ranges when possible

VALIDATION REQUIREMENTS:
- Flag sections that need human review
- Identify missing critical information
- Note any ambiguities in the manual
- Highlight regulatory compliance concerns

Focus on accuracy, safety, and regulatory compliance. The workflow will be used in a production laboratory environment.`
}