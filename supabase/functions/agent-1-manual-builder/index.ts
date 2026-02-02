import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface ManualBuilderRequest {
  protocol_id: string;
  manual_uri: string | null;
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

    if (!protocol_id) {
      throw new Error('Protocol ID is required')
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
    // Build the prompt based on whether a manual is provided
    let fullPrompt = '';
    
    if (manual_uri) {
      const systemPrompt = getManualProcessingPrompt();
      fullPrompt = `${systemPrompt}

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

Return ONLY valid JSON with no additional text.`;
    } else {
      // No manual provided - generate based on NABL standards
      const systemPrompt = getManualProcessingPrompt(); // Reuse structure definition
      fullPrompt = `${systemPrompt}

NO MANUAL PROVIDED - GENERATE FROM STANDARDS
TASK: Generate a compliant laboratory workflow based on NABL ISO 15189:2022 standards.

TEST METADATA:
- Test Code: ${test_meta.testCode}
- Vendor: ${test_meta.vendor}
- Model: ${test_meta.model}
- Sample Type: ${test_meta.sampleType}
- Lab ID: ${org_id}

SPECIFIC INSTRUCTIONS:
1. Create a workflow that strictly follows the Pre-analytical, Analytical, and Post-analytical phases.
2. PRE-ANALYTICAL: Include steps for patient preparation, sample collection, labeling, and transportation/storage conditions appropriate for ${test_meta.sampleType}.
3. ANALYTICAL: Define the testing procedure steps for ${test_meta.vendor} ${test_meta.model}, including calibration and quality control (IQC) checks.
4. POST-ANALYTICAL: Include result verification, critical value reporting, and waste disposal.
5. Generate the SurveyJS structure and AI specs as defined in the system prompt.
6. Ensure all safety warnings and PPE requirements are included.

Return ONLY valid JSON with no additional text.`;
    }

    // Call Gemini API to process the manual
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
  return `You are an AI agent specialized in creating NABL/ISO 15189:2022 compliant laboratory workflows. Your task is to generate structured workflows that meet accreditation requirements.

=== CRITICAL: ORDER CONTEXT FIELDS ===
The workflow will receive pre-populated context from the order. Use these EXACT field names for auto-population:

PRE-POPULATED FROM ORDER (mark as readOnly or display-only):
- sampleId / sampleID: Sample identifier (e.g., "XXX-001")
- patientId / patientID: Patient UUID
- patientName: Full patient name
- patientAge: Patient age in years
- patientGender: "Male" / "Female" / "Other"
- collectionDate: Sample collection date (YYYY-MM-DD)
- collectionTime: Sample collection time (HH:MM)
- collectorName: Name of phlebotomist/collector
- orderId: Order UUID
- orderNumber: Display order number
- testGroupId: Test group UUID
- testName: Name of the test
- testCode: Test code
- labId: Lab UUID
- labName: Lab name
- technicianId: Current user UUID
- technicianName: Current user name
- workingDate: Today's date (YYYY-MM-DD)
- workingTime: Current time (HH:MM)

FIELDS TECHNICIAN MUST ENTER (NEW DATA):
- QC values (IQC low/normal/high results)
- Calibration verification
- Test results / measurements
- Observations / morphology notes
- Equipment readings
- Lot numbers (if not tracked)
- Verification confirmations

=== OUTPUT FORMAT ===
{
  "technician_flow_draft": {
    "ui": {
      "engine": "surveyjs",
      "template": {
        "title": "string",
        "description": "string",
        "pages": [
          {
            "name": "preAnalytical",
            "title": "Pre-Analytical Phase",
            "elements": [...]
          },
          {
            "name": "qcVerification",
            "title": "Quality Control Verification",
            "elements": [...]
          },
          {
            "name": "analytical",
            "title": "Analytical Phase",
            "elements": [...]
          },
          {
            "name": "postAnalytical",
            "title": "Post-Analytical Phase",
            "elements": [...]
          }
        ]
      }
    },
    "meta": {
      "owner": "string",
      "title": "string",
      "nabl_compliant": true,
      "iso_15189_version": "2022",
      "requires_qc": true,
      "context_fields": ["sampleId", "patientId", "collectionDate", ...]
    },
    "rules": {
      "mode": "ADVANCED",
      "steps": [...]
    }
  },
  "ai_spec_draft": {
    "steps": [...]
  },
  "builder_validation": {
    "needs_attention": [...]
  },
  "accreditation_checklist": {
    "pre_analytical_documented": true,
    "qc_verification_included": true,
    "calibration_check_included": true,
    "critical_value_protocol": true,
    "result_verification_step": true,
    "technician_signature": true,
    "timestamp_recorded": true
  }
}

=== NABL/ISO 15189:2022 MANDATORY REQUIREMENTS ===

1. PRE-ANALYTICAL PHASE (Page 1):
   DISPLAY (from order context - readOnly):
   - Sample ID verification (sampleId)
   - Patient identification (patientName, patientId)
   - Collection date/time (collectionDate, collectionTime)
   - Sample collector (collectorName)

   VERIFY (technician confirms):
   - Sample adequacy check (checkbox)
   - Sample condition acceptable (dropdown: Good/Hemolyzed/Lipemic/Clotted/Insufficient)
   - Labeling matches patient (checkbox)
   - Storage conditions verified (checkbox)
   - Sample received within stability window (checkbox)

2. QUALITY CONTROL VERIFICATION (Page 2):
   MANDATORY for accreditation:
   - IQC run date (default to workingDate)
   - IQC lot number (text, required)
   - IQC Level 1 (Low) result (numeric, required)
   - IQC Level 2 (Normal) result (numeric, required)
   - IQC Level 3 (High) result (numeric, optional)
   - IQC Pass/Fail for each level (auto-calculate or manual)
   - Westgard rule violations (if any)
   - QC accepted by (technicianName - readOnly)
   - Calibration verified today (checkbox)
   - Last calibration date (date field)

3. ANALYTICAL PHASE (Page 3):
   CAPTURE:
   - Test start time (auto-populate workingTime)
   - Analyzer/Equipment used (dropdown or text)
   - Reagent lot number (text)
   - Reagent expiry verified (checkbox)
   - Test result value(s) (numeric, required)
   - Units (display from test config)
   - Any observations during testing (textarea)
   - Test completion time (time field)

4. POST-ANALYTICAL PHASE (Page 4):
   VERIFICATION:
   - Result within expected range (auto-flag based on reference)
   - Critical value check (if applicable)
   - If critical: immediate notification required (checkbox + whom notified)
   - Previous patient result (if available, display)
   - Delta check passed (if configured)
   - Result reviewed by (technicianName)
   - Ready for authorization (checkbox)
   - Additional comments (textarea)

=== ELEMENT TYPE GUIDELINES ===

For DISPLAY fields (from context):
{
  "type": "html",
  "name": "sampleInfo",
  "html": "<div class='context-display'><strong>Sample ID:</strong> {sampleId}<br/><strong>Patient:</strong> {patientName}</div>"
}

For VERIFICATION checkpoints:
{
  "type": "checkbox",
  "name": "sampleAdequate",
  "title": "Sample Adequacy Verified",
  "choices": [{"value": "verified", "text": "I confirm sample is adequate for testing"}],
  "isRequired": true
}

For NUMERIC results:
{
  "type": "text",
  "name": "resultValue",
  "title": "Test Result",
  "inputType": "number",
  "isRequired": true,
  "validators": [{"type": "numeric", "text": "Must be a valid number"}]
}

For QC entries:
{
  "type": "text",
  "name": "iqcLevel1",
  "title": "IQC Level 1 (Low) Result",
  "inputType": "number",
  "isRequired": true,
  "validators": [{"type": "numeric"}]
}

=== AI SPEC FOR RESULT PROCESSING ===

Include steps for:
1. extract_values: Pull numeric results from workflow
2. validate_qc: Check IQC values against targets
3. apply_westgard: Evaluate Westgard rules
4. validate_range: Check patient result against reference range
5. flag_critical: Flag critical values for immediate action
6. calculate_result: Any derived calculations (e.g., eGFR from creatinine)
7. map_to_analyte: Map to lab's analyte IDs

=== VALIDATION REQUIREMENTS ===

Flag as ERRORS:
- Missing QC verification step
- No sample identification verification
- No result entry field
- No technician signature/confirmation

Flag as WARNINGS:
- Missing critical value protocol
- No calibration verification
- Missing lot number tracking
- No previous result comparison

Flag as INFO:
- Optional fields not included
- Default values used

Focus on creating workflows that will pass NABL/ISO 15189:2022 audit requirements while being practical for daily lab use.`
}