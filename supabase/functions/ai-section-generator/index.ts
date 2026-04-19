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

interface CascadeOption { id: string; value: string; sub_levels?: CascadeLevel[]; }
interface CascadeLevel  { id: string; label: string; multi_select: boolean; options: CascadeOption[]; }

interface MatrixConfig {
  rows: string[];
  columns: string[];
}

interface SectionGeneratorResponse {
  generatedContent: string;
  suggestedOptions?: string[];
  sectionHeading?: string;
  section_config?: {
    mode: 'flat' | 'cascading' | 'matrix';
    cascade_levels: CascadeLevel[];
    matrix?: MatrixConfig;
  } | null;
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
      // Strip markdown code fences, then extract the FIRST complete JSON object
      const stripped = responseText
        .replace(/```json\s*/gi, '')
        .replace(/```\s*/g, '')
        .trim()

      // Find the first balanced JSON object
      let depth = 0, start = -1, end = -1
      for (let i = 0; i < stripped.length; i++) {
        if (stripped[i] === '{') {
          if (depth === 0) start = i
          depth++
        } else if (stripped[i] === '}') {
          depth--
          if (depth === 0 && start !== -1) { end = i; break }
        }
      }
      const jsonStr = (start !== -1 && end !== -1) ? stripped.slice(start, end + 1) : stripped
      parsedResponse = JSON.parse(jsonStr)
    } catch (parseError) {
      console.error('Failed to parse AI response. Raw text:', responseText)
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
0. CRITICAL OUTPUT RULE: Return ONLY a single valid JSON object. Do NOT wrap it in markdown code fences (no \`\`\`json). Do NOT include any explanation text before or after. Your entire response must be parseable by JSON.parse().

1. Return valid JSON matching this exact interface:
{
  "generatedContent": "string (the generated report section text, can include formatting with line breaks)",
  "suggestedOptions": ["array of predefined option strings — used only for FLAT mode sections"],
  "sectionHeading": "string (formatted section title)",
  "section_config": null  // OR a cascading or matrix config object — see below
}

2. Content Guidelines:
   - Use professional medical terminology
   - Be concise but thorough
   - Include relevant clinical observations
   - Use proper formatting (bold markers with **, line breaks with \\n)
   - Be factually accurate based on common medical patterns
   - If patient info or test results are missing, keep content generic and avoid definitive diagnoses or invented values
   - Do not fabricate patient-specific details or numeric results

3. CASCADING SMART FORM — when the user asks for a "cascading", "smart form", "decision tree", or step-by-step guided form:
   Return section_config as:
   {
     "mode": "cascading",
     "cascade_levels": [
       {
         "id": "lvl_<short_snake_case>",
         "label": "Level Label (e.g. Specimen Type)",
         "multi_select": false,
         "options": [
           {
             "id": "opt_<short_snake_case>",
             "value": "Option Text",
             "sub_levels": []
           }
         ]
       }
     ]
   }

   *** CRITICAL SIZE RULES — violating these causes broken JSON ***
   - TOTAL nodes (levels + options combined) must be UNDER 60. Count carefully.
   - MAXIMUM nesting depth: 2 levels deep (root level → one child level only).
   - DO NOT nest the same sub-level under every option. If two levels are independent of each other (e.g. Gram Smear does not depend on Methodology), make them BOTH root levels — not sub-levels.
   - PREFER FLAT DESIGN: when in doubt, add a level as a root level rather than nesting it.
   - Specimen info sections (Specimen Type, Collection Site, Methodology, Gram Smear, Incubation) MUST all be independent root levels — never nest one inside another.
   - Only use sub_levels when an option truly gates unique child choices (e.g. "No Growth" → stop; "Growth Present" → show organism list).
   - Keep option lists short: max 6 options per level.

   Rules for cascading:
   - Each top-level entry in cascade_levels is a root question (always visible)
   - Each option's sub_levels only appears when that option is selected
   - Use multi_select: true for levels where multiple answers apply (e.g. gross findings)
   - Use multi_select: false for levels where only one answer applies (e.g. specimen type)
   - IDs must be unique, short, snake_case strings (e.g. "lvl_specimen", "opt_skin_punch")
   - Provide realistic medical options for the test type
   - Set suggestedOptions to [] when using cascading mode
   - Set generatedContent to "" when using cascading mode (content is built from selections)

4. MATRIX TABLE — when the user asks for a "matrix", "matrix table", "matrix format", "antibiotic matrix", "sensitivity matrix", or grid-style table with rows and columns:
   Return section_config as:
   {
     "mode": "matrix",
     "cascade_levels": [],
     "matrix": {
       "rows": ["Row label 1", "Row label 2", ...],
       "columns": ["Column header 1", "Column header 2", ...],
       "cellOptions": []
     }
   }
   Rules for matrix:
   - rows = the Y-axis items (e.g. antibiotic names for sensitivity, parameters for eye refraction, analyte names for panels)
   - columns = the X-axis headers (e.g. organism names for sensitivity, RE/LE for eye exams)
   - cellOptions = predefined dropdown values for each cell. Use ["S", "I", "R"] for antibiotic sensitivity. Leave as [] for free-text cells (e.g. eye refraction SPH/CYL values).
   - Keep row and column labels short and clear
   - For antibiotic sensitivity: rows = antibiotics, columns = organism placeholders ("Organism 1", "Organism 2") since organisms vary per patient, cellOptions = ["S", "I", "R"]
   - Set generatedContent to "" when using matrix mode (content is built from cell entries at report time)
   - Set suggestedOptions to [] when using matrix mode
   - Limit to at most 20 rows and 6 columns to stay compact

5. For FLAT sections (no cascading/matrix keyword):
   - Set section_config to null
   - Provide suggestedOptions as normal

6. For FINDINGS sections (like Peripheral Smear):
   - Describe morphological observations
   - Include RBC, WBC, and platelet assessments
   - Note any abnormalities or normal findings
   - Use standard medical descriptors

7. For IMPRESSION/CONCLUSION sections:
   - Summarize key findings
   - Provide clinical correlation suggestions
   - List differential diagnoses if applicable

8. For RECOMMENDATIONS sections:
   - Suggest follow-up tests if relevant
   - Include clinical advice
   - Be actionable and specific`

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

  // Biopsy / histopathology cascading
  if (sectionType.toLowerCase().includes('biopsy') || sectionType.toLowerCase().includes('histopath') || testGroupName?.toLowerCase().includes('biopsy') || testGroupName?.toLowerCase().includes('histopath')) {
    return basePrompt + `

BIOPSY / HISTOPATHOLOGY CASCADING GUIDANCE:
If the user asks for a cascading/smart form, build a tree like:
  Level 1 (Specimen Type, single-select): Skin Punch Biopsy, Endoscopic Biopsy, Excision Biopsy, Trucut/Core Biopsy, FNAC, etc.
  → Each specimen type reveals its own Level 2 (Gross Examination, multi-select): size, shape, surface, cut surface, color, consistency
  → Level 2 selections reveal Level 3 (Microscopic Examination, multi-select): epithelium findings, dermis findings, inflammation, necrosis, etc.
  → Level 3 may reveal Level 4 (Anatomical Site / Diagnosis hints)`
  }

  // Microbiology — cascading or matrix
  if (sectionType.toLowerCase().includes('micro') || sectionType.toLowerCase().includes('culture') || testGroupName?.toLowerCase().includes('micro') || testGroupName?.toLowerCase().includes('culture')) {
    return basePrompt + `

MICROBIOLOGY GUIDANCE:

If the user asks for a MATRIX / antibiotic sensitivity:
  Return section_config with mode "matrix":
  - rows = antibiotics list (max 17)
  - columns = ["Organism 1", "Organism 2", "Organism 3"]
  - cellOptions = ["S", "I", "R"]
  - generatedContent = "", suggestedOptions = []

If the user asks for a cascading form for SPECIMEN INFORMATION (specimen type, site, methodology, gram smear, incubation):
  *** ALL levels must be ROOT levels (flat cascade) — do NOT nest one inside another ***
  Build exactly 5 root levels, each with sub_levels: [] on every option:
  {
    "mode": "cascading",
    "cascade_levels": [
      { "id": "lvl_specimen", "label": "Specimen Type", "multi_select": false,
        "options": [
          { "id": "opt_wound_swab", "value": "Wound Swab", "sub_levels": [] },
          { "id": "opt_pus_swab", "value": "Pus Swab", "sub_levels": [] },
          { "id": "opt_tissue", "value": "Tissue Biopsy", "sub_levels": [] },
          { "id": "opt_fluid", "value": "Body Fluid", "sub_levels": [] }
        ]
      },
      { "id": "lvl_site", "label": "Collection Site", "multi_select": false,
        "options": [
          { "id": "opt_wound", "value": "Wound", "sub_levels": [] },
          { "id": "opt_abscess", "value": "Abscess", "sub_levels": [] },
          { "id": "opt_surgical", "value": "Surgical Site", "sub_levels": [] },
          { "id": "opt_burn", "value": "Burn", "sub_levels": [] }
        ]
      },
      { "id": "lvl_method", "label": "Methodology", "multi_select": false,
        "options": [
          { "id": "opt_aerobic", "value": "Aerobic Culture", "sub_levels": [] },
          { "id": "opt_anaerobic", "value": "Anaerobic Culture", "sub_levels": [] },
          { "id": "opt_both", "value": "Aerobic + Anaerobic", "sub_levels": [] }
        ]
      },
      { "id": "lvl_gram", "label": "Gram Smear Result", "multi_select": true,
        "options": [
          { "id": "opt_gpc", "value": "Gram +ve cocci", "sub_levels": [] },
          { "id": "opt_gnb", "value": "Gram -ve bacilli", "sub_levels": [] },
          { "id": "opt_none", "value": "No organisms seen", "sub_levels": [] },
          { "id": "opt_pus", "value": "Pus cells present", "sub_levels": [] },
          { "id": "opt_mixed", "value": "Mixed flora", "sub_levels": [] }
        ]
      },
      { "id": "lvl_incubation", "label": "Incubation Period", "multi_select": false,
        "options": [
          { "id": "opt_24h", "value": "24 hours", "sub_levels": [] },
          { "id": "opt_48h", "value": "48 hours", "sub_levels": [] },
          { "id": "opt_72h", "value": "72 hours", "sub_levels": [] },
          { "id": "opt_5d", "value": "5 days", "sub_levels": [] }
        ]
      }
    ]
  }

If the user asks for a cascading form for CULTURE RESULT / ORGANISMS:
  Use minimal nesting — only "No Growth" vs "Growth Present" at root, with organisms as sub-level of "Growth Present":
  Level 1 root (single): Culture Result → "No Growth" (sub_levels:[]) | "Growth Present" (sub_levels: organism level)
  Organism level (multi): E. coli, Klebsiella pneumoniae, Staphylococcus aureus, Pseudomonas aeruginosa, Enterococcus, Candida albicans
  Each organism: sub_levels with Colony Count level (Heavy, Moderate, Light, Scanty)
  TOTAL nodes must stay under 40.`
  }

  return basePrompt
}
