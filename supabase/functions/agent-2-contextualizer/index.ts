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
      .select('name')
      .eq('id', lab_id)
      .single()

    if (lab) {
      labContext = {
        lab_name: lab.name
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
            lab_analyte_id,
            analytes(
              id,
              name,
              unit,
              reference_range,
              ai_processing_type
            ),
            lab_analytes(
              id,
              name,
              unit,
              reference_range,
              lab_specific_reference_range
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
        analytes = testGroup.test_group_analytes?.map((tga: any) => {
          const a = tga.analytes;
          const la = tga.lab_analyte_id ? tga.lab_analytes : null;
          return {
            ...a,
            name: la?.name || a?.name,
            unit: la?.unit || a?.unit,
            reference_range: la?.lab_specific_reference_range ?? la?.reference_range ?? a?.reference_range,
          };
        }) || []
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
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`,
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
  return `You are an AI agent responsible for contextualizing laboratory workflows for NABL/ISO 15189:2022 compliance. Your task is to finalize workflows with proper order context integration, QC target values, and analyte mappings.

=== ORDER CONTEXT INTEGRATION ===

The workflow will receive these pre-populated fields from the order system. Map workflow fields to use these exact names:

AUTO-POPULATED CONTEXT (mark as readOnly: true or use HTML display):
| Workflow Field | Context Source | Description |
|----------------|----------------|-------------|
| sampleId | order.sample_id | Sample identifier |
| patientId | order.patient_id | Patient UUID |
| patientName | order.patient_name | Full name |
| patientAge | patient.age | Age in years |
| patientGender | patient.gender | Male/Female/Other |
| collectionDate | order.sample_collected_at (date part) | YYYY-MM-DD |
| collectionTime | order.sample_collected_at (time part) | HH:MM |
| collectorName | order.sample_collected_by | Phlebotomist |
| orderId | order.id | Order UUID |
| testGroupId | order_test.test_group_id | Test UUID |
| testName | test_group.name | Test display name |
| testCode | test_group.code | Test code |
| labId | order.lab_id | Lab UUID |
| labName | lab.name | Lab name |
| technicianId | current_user.id | Logged-in user |
| technicianName | current_user.full_name | User name |
| workingDate | NOW() | Today YYYY-MM-DD |
| workingTime | NOW() | Current HH:MM |

=== OUTPUT FORMAT ===
{
  "technician_flow_final": {
    "ui": {
      "engine": "surveyjs",
      "template": {
        "title": "string",
        "description": "string",
        "pages": [...]
      }
    },
    "meta": {
      "owner": "lab_name",
      "title": "Test Name - Lab Workflow",
      "context_fields": {
        "auto_populated": ["sampleId", "patientId", "patientName", "collectionDate", ...],
        "technician_entry": ["iqcLevel1", "iqcLevel2", "resultValue", ...]
      },
      "qc_requirements": {
        "requires_iqc": true,
        "iqc_levels": 2,
        "westgard_rules_enabled": true
      },
      "nabl_compliant": true
    },
    "rules": {
      "mode": "ADVANCED",
      "steps": [...]
    }
  },
  "ai_spec_final": {
    "steps": [
      {
        "step_type": "validate_qc",
        "description": "Validate IQC results against target values",
        "parameters": {
          "qc_lot_table": "qc_lots",
          "qc_targets_table": "qc_target_values",
          "westgard_rules": ["1_2s", "1_3s", "2_2s", "R_4s"],
          "fields": {
            "iqcLevel1": {"level": "low", "analyte_id": "uuid"},
            "iqcLevel2": {"level": "normal", "analyte_id": "uuid"}
          }
        }
      },
      {
        "step_type": "extract_values",
        "description": "Extract test results",
        "parameters": {
          "target_fields": ["resultValue"],
          "validation_rules": ["numeric"]
        }
      },
      {
        "step_type": "validate_range",
        "description": "Check against reference ranges",
        "parameters": {
          "target_fields": ["resultValue"],
          "reference_ranges": {"analyte_name": "range"},
          "age_gender_specific": true
        }
      },
      {
        "step_type": "flag_critical",
        "description": "Flag critical values",
        "parameters": {
          "critical_low": "value",
          "critical_high": "value",
          "notification_required": true
        }
      },
      {
        "step_type": "map_to_analyte",
        "description": "Map to analyte for result storage",
        "parameters": {
          "field": "resultValue",
          "target_analyte_id": "uuid",
          "units": "unit"
        }
      }
    ]
  },
  "qc_integration": {
    "iqc_lot_fields": {
      "iqcLotNumber": "qc_lots.lot_number",
      "iqcExpiryDate": "qc_lots.expiry_date"
    },
    "iqc_target_mapping": {
      "iqcLevel1": {
        "analyte_id": "uuid",
        "level": "low",
        "target_mean": "from qc_target_values",
        "target_sd": "from qc_target_values"
      },
      "iqcLevel2": {
        "analyte_id": "uuid",
        "level": "normal",
        "target_mean": "from qc_target_values",
        "target_sd": "from qc_target_values"
      }
    },
    "auto_westgard_evaluation": true,
    "record_to_qc_results": true
  },
  "version_metadata": {
    "version_hint": "1.0.0",
    "test_code": "string",
    "display_name": "string",
    "analyte_names": ["analyte1"],
    "analyte_ids": ["uuid1"],
    "created_by": "contextualizer_agent",
    "contextualization_timestamp": "ISO_timestamp"
  },
  "final_validation": {
    "needs_attention": [...],
    "accreditation_ready": true,
    "missing_requirements": []
  }
}

=== CONTEXTUALIZATION TASKS ===

1. FIELD NAME STANDARDIZATION:
   - Rename draft field names to match context field names
   - Example: "patient_id" → "patientId", "sample_id" → "sampleId"
   - Mark context fields with "readOnly": true or display as HTML

2. ANALYTE MAPPING:
   - Map each result field to an existing analyte from available_analytes
   - Use the exact analyte_id for database storage
   - Include unit and reference_range from analyte config
   - For age/gender-specific ranges, add conditional logic

3. QC INTEGRATION:
   - Link QC fields to qc_lots and qc_target_values tables
   - Configure Westgard rule parameters
   - Set up automatic qc_results recording
   - Include lot tracking (lot number, expiry)

4. CRITICAL VALUES:
   - Extract critical high/low from analyte or test group config
   - Add critical value notification step
   - Include "whom notified" field if critical

5. VALIDATION RULES:
   - Add numeric validators for all result fields
   - Add date validators for date fields
   - Add required validators for NABL-mandatory fields

6. AUDIT TRAIL:
   - Ensure technicianId and technicianName captured
   - Ensure timestamps for key steps
   - Include verification checkboxes

=== NABL MANDATORY CHECKS ===

Verify these are present (flag as error if missing):
□ Sample identification verification step
□ IQC verification before patient testing
□ IQC lot number and expiry tracking
□ At least 2 levels of IQC
□ Result entry with numeric validation
□ Reference range display
□ Critical value protocol (if applicable)
□ Technician identification
□ Verification/authorization step

=== QUALITY CONTROL DATABASE INTEGRATION ===

QC fields should integrate with:
- qc_lots: Lot tracking (lot_number, expiry_date, material_name)
- qc_target_values: Target mean/SD per lot per analyte
- qc_runs: Daily QC run tracking
- qc_results: Individual QC measurements with Westgard evaluation
- westgard_rules: Lab's configured rules

When QC is submitted:
1. Create/update qc_run record
2. Insert qc_results for each level
3. Trigger Westgard evaluation
4. Block patient testing if QC fails

Focus on creating production-ready workflows that pass NABL audit and integrate with the existing database schema for QC and results tracking.`
}