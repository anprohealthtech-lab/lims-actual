import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface TestConfigurationRequest {
  testName: string;
  description?: string;
  labContext?: string;
  existingTests?: string[];
  sampleType?: string;
  requiresFasting?: boolean;
  insert?: boolean;
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

    // Get user's lab_id for context
    const { data: userData } = await supabaseClient
      .from('users')
      .select('lab_id, role')
      .eq('id', user.id)
      .single()

    // Parse request body
    const {
      testName,
      description,
      labContext,
      existingTests,
      sampleType,
      requiresFasting,
      insert
    }: TestConfigurationRequest = await req.json()

    if (!testName?.trim()) {
      throw new Error('Test name is required')
    }

    // Get AI prompt from database with fallbacks
    const { data: promptData } = await supabaseClient.rpc('resolve_ai_prompt', {
      p_processing_type: 'test_suggestion',
      p_test_id: null,
      p_analyte_id: null,
      p_lab_id: userData?.lab_id || null
    })

    const resolvedPrompt = Array.isArray(promptData) && promptData.length > 0
      ? promptData[0]?.prompt
      : null

    const systemPrompt = (typeof resolvedPrompt === 'string' && resolvedPrompt.trim().length > 0)
      ? resolvedPrompt
      : getDefaultTestConfigurationPrompt()

    // Build the complete prompt
    const fullPrompt = `${systemPrompt}

${existingTests ? `EXISTING TESTS TO AVOID DUPLICATING: ${existingTests.join(', ')}` : ''}

TEST TO ANALYZE: ${testName}
${description ? `DESCRIPTION: ${description}` : ''}
${sampleType ? `SAMPLE TYPE OVERRIDE (STRICT): ${sampleType}` : ''}
${typeof requiresFasting === 'boolean' ? `REQUIRES FASTING OVERRIDE (STRICT): ${requiresFasting}` : ''}
LAB CONTEXT: ${labContext || `User: ${user.email}, Lab: ${userData?.lab_id || 'Default'}`}
REQUEST MODE: ${insert ? 'INSERT' : 'PREVIEW'}

Return ONLY valid JSON with no additional text.`

    // Call Anthropic API (switched from Gemini)
    const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!anthropicApiKey) {
      throw new Error('ANTHROPIC_API_KEY not configured')
    }

    // Prepare prompt
    const messages = [
      { role: 'user', content: fullPrompt }
    ]

    const aiResponse = await fetch(
      'https://api.anthropic.com/v1/messages',
      {
        method: 'POST',
        headers: {
          'x-api-key': anthropicApiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 15000,
          messages: messages,
          temperature: 0.7
        })
      }
    )

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text()
      throw new Error(`Anthropic API error: ${errorText}`)
    }

    const aiData = await aiResponse.json()
    
    if (!aiData.content?.[0]?.text) {
      throw new Error('Invalid response format from Anthropic API')
    }

    const responseText = aiData.content[0].text
    let parsedResponse

    try {
      // Find JSON blob if wrapped in markdown
      const jsonStart = responseText.indexOf('{')
      const jsonEnd = responseText.lastIndexOf('}')
      const jsonStr = (jsonStart !== -1 && jsonEnd !== -1) 
        ? responseText.substring(jsonStart, jsonEnd + 1)
        : responseText

      parsedResponse = JSON.parse(jsonStr)
    } catch (parseError) {
      console.error('Failed to parse AI response. Raw text:', responseText)
      const snippet = responseText.length > 200 ? responseText.slice(responseText.length - 200) : responseText
      throw new Error(`Failed to parse AI response: ${parseError}. End of response: "...${snippet}"`)
    }

    // Log usage for analytics (optional)
    await supabaseClient
      .from('ai_usage_logs')
      .insert({
        user_id: user.id,
        lab_id: userData?.lab_id,
        processing_type: 'test_suggestion',
        input_data: { testName, description },
        confidence: parsedResponse.confidence || 0,
        created_at: new Date().toISOString()
      })

    return new Response(
      JSON.stringify({
        success: true,
        data: parsedResponse,
        inserted: false
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      },
    )

  } catch (error) {
    console.error('Error in AI test configurator:', error)
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      },
    )
  }
})

function getDefaultTestConfigurationPrompt(): string {
  return `You are a medical laboratory AI assistant. Given a test name, suggest a complete test group configuration with analytes that matches the database schema.

REQUIREMENTS:
1. Return valid JSON matching this exact interface:
{
  "test_group": {
    "name": "string",
    "code": "string (unique 3-8 char code)",
    "category": "string",
    "clinical_purpose": "string",
    "price": "string (decimal format like '45.00')",
    "turnaround_time": "string (e.g., '24 hours', '2-3 days')",
    "sample_type": "string (MUST be one of the valid types below)",
    "requires_fasting": boolean,
    "is_active": true,
    "default_ai_processing_type": "string (MUST be one of the VALID AI PROCESSING TYPES below)",
    "group_level_prompt": "string (MANDATORY: concise but specific extraction guidance for this test group)",
    "to_be_copied": false
  },
  "analytes": [{
    "name": "string",
    "unit": "string",
    "reference_range": "string (e.g., '3.5-5.0' or 'Low: <3.5 | Optimal: 3.5-5.0 | High: >5.0' when user asks for low/optimal/high)",
    "low_critical": "string or null",
    "high_critical": "string or null", 
    "interpretation_low": "string",
    "interpretation_normal": "string",
    "interpretation_high": "string",
    "category": "string",
    "is_active": true,
    "ai_processing_type": "string (MUST be one of the VALID AI PROCESSING TYPES below)",
    "ai_prompt_override": null,
    "group_ai_mode": "individual",
    "is_global": false,
    "to_be_copied": false,
    "is_calculated": "boolean",
    "formula": "string or null (required when is_calculated=true; example: 'LDL/5')",
    "formula_variables": "array of strings (required when is_calculated=true; example: ['LDL'])",
    "formula_description": "string or null",
    "value_type": "string (one of: numeric, qualitative, semi_quantitative, descriptive)",
    "expected_normal_values": "array of strings for qualitative or semi-quantitative analytes; empty array for numeric/descriptive"
  }],
  "test_group_analytes": [{
    "test_group_code": "string (matches test_group.code)",
    "analyte_name": "string (matches analyte.name)"
  }],
  "confidence": number,
  "reasoning": "string"
}

2. VALID SAMPLE TYPES (choose the most appropriate):
   Laboratory Specimens:
   - "Serum", "Plasma", "Whole Blood", "EDTA Blood", "Citrated Blood"
   - "Urine", "Urine (Random)", "Urine (24hr)"
   - "Stool", "CSF", "Sputum", "Swab", "Aspirate", "Biopsy"
   
   Imaging/Radiology:
   - "X-Ray", "CT Scan", "MRI", "Ultrasound", "Mammography"
   - "PET Scan", "Fluoroscopy", "Angiography", "DEXA Scan"
   
   Diagnostic Procedures:
   - "ECG", "EEG", "Endoscopy", "Colonoscopy", "Bronchoscopy"
   - "No Sample Required"
   
   Other:
   - "Other" (use only if none of the above fit)

2b. VALID AI PROCESSING TYPES (choose the closest fit):
   - "MANUAL_ENTRY_NO_VISION"
   - "THERMAL_SLIP_OCR"
   - "INSTRUMENT_SCREEN_OCR"
   - "RAPID_CARD_LFA"
   - "COLOR_STRIP_MULTIPARAM"
   - "SINGLE_WELL_COLORIMETRIC"
   - "AGGLUTINATION_CARD"
   - "MICROSCOPY_MORPHOLOGY"
   - "ZONE_OF_INHIBITION"
   - "MENISCUS_SCALE_READING"
   - "SAMPLE_QUALITY_TUBE_CHECK"
   - "UNKNOWN_NEEDS_REVIEW"

3. Use medically accurate reference ranges and units
4. Provide realistic prices in decimal format ($15.00-$500.00)
5. Include relevant analytes for the test type
6. Always include confidence score (0-1) and reasoning
7. Generate unique, meaningful codes for test groups (3-8 characters)
8. Create test_group_analytes mapping for each analyte
9. group_level_prompt must be present and actionable (never null)
10. If an analyte is derived (e.g., VLDL from LDL/5), mark it as calculated and provide formula/formula_variables.
11. If user prompt specifies low/optimal/high style ranges, encode that in reference_range text and keep interpretation_low/normal/high clinically meaningful.
12. Set analyte.value_type carefully:
   - numeric: measurable numbers like Hemoglobin, Glucose
   - qualitative: Positive/Negative, Reactive/Non-Reactive, Present/Absent
   - semi_quantitative: Trace/1+/2+/3+/4+ or Mild/Moderate/Severe
   - descriptive: microscopy comments, morphology, culture remarks, narrative observations
13. If value_type is qualitative or semi_quantitative, populate expected_normal_values with the valid choices.
14. For qualitative, semi_quantitative, or descriptive analytes, unit should usually be an empty string unless a real measurement unit truly applies.

CONTEXT:
- This is for a clinical laboratory information system
- Test names may be abbreviated or colloquial
- Base suggestions on standard medical laboratory practices
- Ensure all analytes have proper clinical interpretations
- For imaging tests (X-Ray, CT, MRI, etc.), use appropriate imaging sample types
- For procedures (ECG, EEG, etc.), use procedure-specific sample types`
}
