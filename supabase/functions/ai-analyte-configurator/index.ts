import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface AnalyteConfigurationRequest {
  analyteName: string;
  description?: string;
  category?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      throw new Error('No authorization header')
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser()
    if (authError || !user) {
      throw new Error('Invalid authentication')
    }

    const { data: userData } = await supabaseClient
      .from('users')
      .select('lab_id')
      .eq('id', user.id)
      .single()

    const { analyteName, description, category }: AnalyteConfigurationRequest = await req.json()

    if (!analyteName?.trim()) {
      throw new Error('Analyte name is required')
    }

    const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!anthropicApiKey) {
      throw new Error('ANTHROPIC_API_KEY not configured')
    }

    const systemPrompt = getAnalyteConfigurationPrompt()

    const fullPrompt = `${systemPrompt}

ANALYTE TO CONFIGURE: ${analyteName}
${description ? `DESCRIPTION / CONTEXT: ${description}` : ''}
${category ? `CATEGORY HINT: ${category}` : ''}
LAB CONTEXT: User: ${user.email}, Lab: ${userData?.lab_id || 'Default'}

Return ONLY valid JSON with no additional text.`

    const aiResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': anthropicApiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4000,
        messages: [{ role: 'user', content: fullPrompt }],
        temperature: 0.3,
      }),
    })

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text()
      throw new Error(`Anthropic API error: ${errorText}`)
    }

    const aiData = await aiResponse.json()
    if (!aiData.content?.[0]?.text) {
      throw new Error('Invalid response format from Anthropic API')
    }

    const responseText = aiData.content[0].text
    let parsedResponse: any

    try {
      const jsonStart = responseText.indexOf('{')
      const jsonEnd = responseText.lastIndexOf('}')
      const jsonStr = jsonStart !== -1 && jsonEnd !== -1
        ? responseText.substring(jsonStart, jsonEnd + 1)
        : responseText
      parsedResponse = JSON.parse(jsonStr)
    } catch (parseError) {
      throw new Error(`Failed to parse AI response: ${parseError}`)
    }

    // Log usage
    await supabaseClient.from('ai_usage_logs').insert({
      user_id: user.id,
      lab_id: userData?.lab_id,
      processing_type: 'analyte_suggestion',
      input_data: { analyteName, description },
      confidence: parsedResponse.confidence || 0,
      created_at: new Date().toISOString(),
    }).then(() => {}) // fire and forget

    return new Response(
      JSON.stringify({ success: true, data: parsedResponse }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  } catch (error) {
    console.error('Error in AI analyte configurator:', error)
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
})

function getAnalyteConfigurationPrompt(): string {
  return `You are a medical laboratory AI assistant. Given an analyte name and optional context, generate a complete analyte configuration matching the LIMS database schema.

Return ONLY a valid JSON object with this exact structure:
{
  "name": "string (proper clinical name)",
  "code": "string (3-6 char uppercase code, e.g. HGB, GLU, WBC)",
  "unit": "string (standard clinical unit, e.g. g/dL, mg/dL, /μL, IU/L)",
  "reference_range": "string (e.g. '13.5-17.5' or 'M: 13.5-17.5, F: 12.0-16.0' for sex-split)",
  "low_critical": "string or null (panic low value)",
  "high_critical": "string or null (panic high value)",
  "interpretation_low": "string (brief clinical interpretation when below range)",
  "interpretation_normal": "string (brief clinical interpretation when in range)",
  "interpretation_high": "string (brief clinical interpretation when above range)",
  "category": "string (one of: Hematology, Biochemistry, Serology, Endocrinology, Coagulation, Urinalysis, Microbiology, Immunology, Molecular Biology, Histopathology, Cytology, Allergy, Tumor Markers, Vitamins & Minerals, Cardiac, Lipid Profile, Liver Function, Kidney Function, Thyroid, Diabetes, Drug Monitoring, Hormones, Electrolytes, Blood Gas, General)",
  "value_type": "string (one of: numeric, qualitative, semi_quantitative, descriptive)",
  "expected_normal_values": ["array of strings for qualitative analytes, e.g. ['Positive', 'Negative'] or ['Reactive', 'Non-Reactive']. Empty array for numeric."],
  "description": "string (1-2 sentences on clinical significance)",
  "ai_processing_type": "string (one of: MANUAL_ENTRY_NO_VISION, THERMAL_SLIP_OCR, INSTRUMENT_SCREEN_OCR, RAPID_CARD_LFA, COLOR_STRIP_MULTIPARAM, SINGLE_WELL_COLORIMETRIC, AGGLUTINATION_CARD, MICROSCOPY_MORPHOLOGY)",
  "group_ai_mode": "string (one of: individual, group_only, both) - use 'individual' unless the analyte only makes sense in a panel",
  "ai_prompt_override": "string or null (specific AI extraction instructions if needed, otherwise null)",
  "is_calculated": false,
  "formula": null,
  "formula_variables": [],
  "formula_description": null,
  "confidence": number (0-1),
  "reasoning": "string (brief explanation of your choices)"
}

AI PROCESSING TYPE GUIDE:
- THERMAL_SLIP_OCR: printed report slips, biochemistry analyzers
- INSTRUMENT_SCREEN_OCR: digital displays, LCD instrument screens
- RAPID_CARD_LFA: lateral flow assay cards (pregnancy, troponin, dengue rapid tests)
- COLOR_STRIP_MULTIPARAM: urine dipstick strips, multi-parameter color strips
- SINGLE_WELL_COLORIMETRIC: single-well color reactions
- AGGLUTINATION_CARD: blood grouping cards, agglutination patterns
- MICROSCOPY_MORPHOLOGY: CBC differentials, urine microscopy, smear review
- MANUAL_ENTRY_NO_VISION: values entered manually, no image capture

VALUE TYPE GUIDE:
- numeric: measurable quantity with a number (e.g. Hemoglobin, Glucose)
- qualitative: categorical result (e.g. Positive/Negative, Reactive/Non-Reactive)
- semi_quantitative: graded result (e.g. 1+/2+/3+, Trace/Mild/Moderate/Severe)
- descriptive: free text (e.g. morphology comments, culture results)

Be clinically accurate. Use standard SI or conventional units as appropriate for the analyte.`
}
