import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface SectionGeneratorRequest {
  sectionType: string;
  sectionName: string;
  testGroupName?: string;
  userPrompt: string;
  existingOptions?: string[];
  labContext?: {
    labName?: string;
    patientInfo?: {
      age?: number;
      gender?: string;
    };
    testResults?: Record<string, string>;
    styleHints?: string;
  };
}

interface SectionGeneratorResponse {
  generatedContent: string;
  suggestedOptions?: string[];
  sectionHeading?: string;
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
      sectionType,
      sectionName,
      testGroupName,
      userPrompt,
      existingOptions,
      labContext
    }: SectionGeneratorRequest = await req.json()

    if (!userPrompt?.trim()) {
      throw new Error('User prompt is required')
    }

    // Build the AI prompt based on section type
    const systemPrompt = getSectionGeneratorPrompt(sectionType, sectionName, testGroupName)

    // Build the complete prompt
    const fullPrompt = `${systemPrompt}

${existingOptions?.length ? `EXISTING PREDEFINED OPTIONS (for reference): ${existingOptions.join(', ')}` : ''}

  ${labContext?.labName ? `LAB: ${labContext.labName}` : ''}

  ${labContext?.styleHints ? `LAB STYLE HINTS: ${labContext.styleHints}` : ''}

${labContext?.patientInfo ? `PATIENT INFO: Age: ${labContext.patientInfo.age || 'Unknown'}, Gender: ${labContext.patientInfo.gender || 'Unknown'}` : ''}

${labContext?.testResults ? `TEST RESULTS CONTEXT:\n${Object.entries(labContext.testResults).map(([k, v]) => `- ${k}: ${v}`).join('\n')}` : ''}

USER REQUEST: ${userPrompt}

Return ONLY valid JSON with no additional text or markdown code blocks.`

    // Call Anthropic API
    const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!anthropicApiKey) {
      throw new Error('ANTHROPIC_API_KEY not configured')
    }

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
          max_tokens: 4000,
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
    let parsedResponse: SectionGeneratorResponse

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
      // If parsing fails, return the raw text as generated content
      parsedResponse = {
        generatedContent: responseText,
        suggestedOptions: [],
        sectionHeading: sectionName
      }
    }

    // Log usage for analytics
    await supabaseClient
      .from('ai_usage_logs')
      .insert({
        user_id: user.id,
        lab_id: userData?.lab_id,
        processing_type: 'section_generator',
        input_data: { sectionType, sectionName, userPrompt },
        confidence: 0.8,
        created_at: new Date().toISOString()
      })

    return new Response(
      JSON.stringify({
        success: true,
        data: parsedResponse
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      },
    )

  } catch (error) {
    console.error('Error in AI section generator:', error)

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

function getSectionGeneratorPrompt(sectionType: string, sectionName: string, testGroupName?: string): string {
  const basePrompt = `You are a medical laboratory AI assistant specialized in generating clinical report sections. You help create professional, accurate medical report content.

SECTION TYPE: ${sectionType}
SECTION NAME: ${sectionName}
${testGroupName ? `TEST GROUP: ${testGroupName}` : ''}

REQUIREMENTS:
1. Return valid JSON matching this exact interface:
{
  "generatedContent": "string (the generated report section text, can include formatting with line breaks)",
  "suggestedOptions": ["array of predefined option strings that could be added to this section"],
  "sectionHeading": "string (formatted section title)"
}

2. Content Guidelines:
   - Use professional medical terminology
   - Be concise but thorough
   - Include relevant clinical observations
   - Use proper formatting (bold markers with **, line breaks with \\n)
   - Be factually accurate based on common medical patterns
  - If patient info or test results are missing, keep content generic and avoid definitive diagnoses or invented values
  - Do not fabricate patient-specific details or numeric results

3. For FINDINGS sections (like Peripheral Smear):
   - Describe morphological observations
   - Include RBC, WBC, and platelet assessments
   - Note any abnormalities or normal findings
   - Use standard medical descriptors

4. For IMPRESSION/CONCLUSION sections:
   - Summarize key findings
   - Provide clinical correlation suggestions
   - List differential diagnoses if applicable

5. For RECOMMENDATIONS sections:
   - Suggest follow-up tests if relevant
   - Include clinical advice
   - Be actionable and specific

6. Suggested Options:
   - Provide 5-10 common predefined options that could be checkboxes/quick-picks
   - Make them specific to the section type
   - Include both normal and abnormal findings`

  // Add specific guidance based on section type
  if (sectionType.toLowerCase().includes('peripheral') || sectionType.toLowerCase().includes('smear') || sectionType.toLowerCase().includes('pbs')) {
    return basePrompt + `

PERIPHERAL BLOOD SMEAR SPECIFIC GUIDANCE:
- Include RBC morphology (normocytic, microcytic, macrocytic, normochromic, hypochromic)
- Mention RBC abnormalities if relevant (anisocytosis, poikilocytosis, target cells, etc.)
- Describe WBC differential observations
- Include platelet adequacy and morphology
- Note presence of any inclusions or abnormal cells

Example suggested options for PBS:
- "Normocytic normochromic RBCs"
- "Microcytic hypochromic RBCs"
- "Anisocytosis present"
- "Poikilocytosis noted"
- "WBC within normal limits"
- "Neutrophilia"
- "Lymphocytosis"
- "Platelets adequate"
- "Thrombocytopenia"
- "No abnormal cells seen"`
  }

  if (sectionType.toLowerCase().includes('radiology') || sectionType.toLowerCase().includes('xray') || sectionType.toLowerCase().includes('imaging')) {
    return basePrompt + `

RADIOLOGY SPECIFIC GUIDANCE:
- Use standard radiological terminology
- Describe anatomical structures systematically
- Note normal vs abnormal findings
- Include measurements where relevant
- Provide clinical correlation

Example suggested options for Radiology:
- "No acute cardiopulmonary findings"
- "Clear lung fields bilaterally"
- "Normal cardiac silhouette"
- "No pleural effusion"
- "No bony abnormalities"
- "Soft tissue normal"`
  }

  return basePrompt
}
