import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { GoogleGenerativeAI } from "npm:@google/generative-ai@0.1.3"

const genAI = new GoogleGenerativeAI(Deno.env.get('GOOGLE_AI_API_KEY')!)

serve(async (req) => {
  try {
    const { file_content, file_type, test_metadata } = await req.json()
    
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" })
    
    const systemPrompt = `You are an expert LIMS workflow builder creating modular, AI-powered testing workflows.

CRITICAL: Generate a fully modular workflow where ALL AI logic is defined in the ai_spec section.

STRUCTURE REQUIREMENTS:

1. UI Section (ui.template):
   - Use SurveyJS components for user interaction
   - Include file upload elements for image capture
   - Add timers using maxTimeToFinish property
   - Keep UI logic separate from AI logic

2. AI Spec Section (ai_spec):
   - Define ALL prompts, analysis parameters, and processing rules
   - Each step must be self-contained with its own configuration
   - Include custom prompts for each analysis type
   - Define expected output schemas
   - Specify post-processing rules

OUTPUT FORMAT:
{
  "ui": {
    "engine": "surveyjs",
    "template": {
      "title": "Test Name",
      "pages": [/* SurveyJS pages */]
    }
  },
  "ai_spec": {
    "version": "2.0",
    "steps": [
      {
        "id": "unique_step_id",
        "step_id": "unique_step_id",
        "name": "Step Name",
        "type": "image_analysis",
        "trigger": {
          "page": "page_name",
          "element": "element_name",
          "event": "file_uploaded"
        },
        "model": "gemini-2.0-flash-exp",
        "temperature": 0.1,
        "custom_prompt": "Detailed prompt with {{variables}}",
        "analysis_targets": [
          {
            "name": "target_name",
            "description": "What to analyze",
            "extraction_method": "color_matching|text_ocr|pattern_recognition"
          }
        ],
        "expected_output_schema": {
          "field_name": {
            "type": "string|number|boolean|object",
            "required": true,
            "default": null,
            "range": {"min": 0, "max": 100}
          }
        },
        "validation_rules": [
          {
            "type": "range_check|format_check|consistency_check",
            "description": "Rule description",
            "parameters": {}
          }
        ],
        "post_processing": [
          {
            "type": "normalize_units|apply_reference_ranges|flag_abnormal",
            "config": {}
          }
        ],
        "consensus_method": {
          "type": "majority_vote|average|weighted",
          "config": {
            "min_agreement": 0.8
          }
        },
        "review_criteria": {
          "min_confidence": 0.85,
          "abnormal_values": true,
          "flags_requiring_review": ["quality_issue", "out_of_range"]
        },
        "image_processing": {
          "strip_data_url": true,
          "mime_type": "image/jpeg"
        }
      }
    ]
  },
  "meta": {
    "test_code": "TEST_CODE",
    "version": "1.0.0",
    "created_by": "manual-builder-v2",
    "modular": true
  }
}

Example for Urine Strip Test:

For pre-analytical phase:
{
  "id": "pre_analytical_qc",
  "name": "Sample Quality Check",
  "type": "image_analysis",
  "custom_prompt": "Analyze this urine sample container image for quality control.\\n\\nCheck the following aspects:\\n1. Sample Volume: Estimate volume in ml (minimum required: 10ml)\\n2. Sample Color: Classify as (pale yellow|yellow|dark yellow|amber|red|brown|other)\\n3. Turbidity: Rate as (clear|slightly cloudy|cloudy|very turbid)\\n4. Container Condition: Check for (clean|contaminated|damaged|unlabeled)\\n5. Label Quality: Verify (clearly visible|partially visible|not visible)\\n\\nReturn JSON with these exact fields:\\n{\\\"volume_ml\\\": number, \\\"color\\\": string, \\\"turbidity\\\": string, \\\"container_status\\\": string, \\\"label_quality\\\": string, \\\"quality_passed\\\": boolean, \\\"issues\\\": [], \\\"confidence\\\": 0-1}",
  "expected_output_schema": {
    "volume_ml": {"type": "number", "required": true, "range": {"min": 0, "max": 100}},
    "color": {"type": "string", "required": true},
    "turbidity": {"type": "string", "required": true},
    "container_status": {"type": "string", "required": true},
    "label_quality": {"type": "string", "required": true},
    "quality_passed": {"type": "boolean", "required": true},
    "issues": {"type": "array", "required": false, "default": []},
    "confidence": {"type": "number", "required": true, "range": {"min": 0, "max": 1}}
  }
}

For result extraction:
{
  "id": "extract_strip_results",
  "name": "Extract Test Strip Results",
  "type": "image_analysis",
  "custom_prompt": "Analyze these urine test strip images to extract results for all parameters.\\n\\nTest strip type: {{test_type}}\\nTime since dipping: {{time_elapsed}} seconds\\n\\nFor each pad on the strip, compare the color to the reference chart and determine:\\n\\n1. Glucose: (Negative|Trace|1+|2+|3+|4+) or mg/dL value\\n2. Bilirubin: (Negative|Small|Moderate|Large)\\n3. Ketone: (Negative|Trace|Small|Moderate|Large) or mg/dL\\n4. Specific Gravity: Numeric value (1.000-1.040)\\n5. Blood: (Negative|Trace|Small|Moderate|Large)\\n6. pH: Numeric value (5.0-9.0)\\n7. Protein: (Negative|Trace|1+|2+|3+|4+) or mg/dL\\n8. Urobilinogen: Numeric mg/dL\\n9. Nitrite: (Negative|Positive)\\n10. Leukocytes: (Negative|Trace|Small|Moderate|Large)\\n\\nConsider:\\n- Color intensity and uniformity\\n- Edge bleeding between pads\\n- Timing accuracy (optimal read time: 60s)\\n- Lighting conditions in image\\n\\nReturn comprehensive JSON with confidence scores for each parameter.",
  "analysis_targets": [
    {"name": "glucose", "description": "Glucose detection pad", "extraction_method": "color_matching"},
    {"name": "protein", "description": "Protein detection pad", "extraction_method": "color_matching"},
    {"name": "ph", "description": "pH indicator pad", "extraction_method": "color_matching"},
    {"name": "blood", "description": "Blood/hemoglobin detection", "extraction_method": "color_matching"},
    {"name": "ketone", "description": "Ketone bodies detection", "extraction_method": "color_matching"},
    {"name": "nitrite", "description": "Nitrite detection for bacteria", "extraction_method": "color_matching"},
    {"name": "leukocytes", "description": "White blood cells detection", "extraction_method": "color_matching"},
    {"name": "specific_gravity", "description": "Urine concentration", "extraction_method": "color_matching"},
    {"name": "urobilinogen", "description": "Urobilinogen levels", "extraction_method": "color_matching"},
    {"name": "bilirubin", "description": "Bilirubin detection", "extraction_method": "color_matching"}
  ],
  "post_processing": [
    {
      "type": "apply_reference_ranges",
      "config": {
        "ranges": {
          "ph": {"min": 5.0, "max": 8.0, "normal": [6.0, 7.0]},
          "specific_gravity": {"min": 1.003, "max": 1.030, "normal": [1.010, 1.025]},
          "urobilinogen": {"min": 0.1, "max": 1.0, "normal": [0.2, 1.0]}
        }
      }
    },
    {
      "type": "flag_abnormal",
      "config": {
        "criteria": {
          "glucose": ["1+", "2+", "3+", "4+"],
          "protein": ["1+", "2+", "3+", "4+"],
          "blood": ["Trace", "Small", "Moderate", "Large"],
          "ketone": ["Small", "Moderate", "Large"],
          "nitrite": ["Positive"],
          "leukocytes": ["Small", "Moderate", "Large"],
          "bilirubin": ["Small", "Moderate", "Large"]
        }
      }
    }
  ],
  "consensus_method": {
    "type": "weighted",
    "config": {
      "weights": {
        "front_view": 0.5,
        "angle_view": 0.3,
        "reference_view": 0.2
      },
      "min_agreement": 0.75
    }
  },
  "review_criteria": {
    "min_confidence": 0.85,
    "abnormal_values": true,
    "flags_requiring_review": ["multiple_abnormal", "critical_value", "low_confidence"]
  }
}

Parse the manual and generate a complete modular workflow.`

    const prompt = `Manual content:\n${file_content}\n\nTest metadata:\n${JSON.stringify(test_metadata)}\n\nGenerate a modular workflow with all AI logic in the ai_spec section.`
    
    const result = await model.generateContent(prompt)
    const response = result.response.text()
    
    // Parse and validate the response
    let workflowData
    try {
      const cleanedResponse = response.replace(/```json\n?|\n?```/g, '').trim()
      workflowData = JSON.parse(cleanedResponse)
    } catch (e) {
      const jsonMatch = response.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        workflowData = JSON.parse(jsonMatch[0])
      } else {
        throw new Error('Failed to parse AI response')
      }
    }
    
    // Ensure modular structure
    if (!workflowData.ai_spec || !workflowData.ai_spec.steps) {
      console.warn('AI spec missing or incomplete, adding default structure')
      workflowData.ai_spec = workflowData.ai_spec || {}
      workflowData.ai_spec.version = "2.0"
      workflowData.ai_spec.steps = workflowData.ai_spec.steps || []
    }
    
    // Mark as modular workflow
    workflowData.meta = workflowData.meta || {}
    workflowData.meta.modular = true
    workflowData.meta.created_by = "manual-builder-v2"
    
    return new Response(
      JSON.stringify({
        success: true,
        workflow: workflowData,
        message: "Modular workflow created with complete AI specifications"
      }),
      { headers: { "Content-Type": "application/json" } }
    )
    
  } catch (error) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message
      }),
      { 
        status: 500,
        headers: { "Content-Type": "application/json" }
      }
    )
  }
})