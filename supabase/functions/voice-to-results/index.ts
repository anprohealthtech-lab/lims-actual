/**
 * Voice-to-Results Edge Function
 *
 * Converts voice recordings to lab test results using:
 * 1. Gemini 2.5 Flash for audio transcription and initial result extraction
 * 2. Anthropic Claude for validation and enhancement
 *
 * Flow:
 * Voice Audio → Gemini (transcribe + extract) → Anthropic (validate) → Structured Results
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface VoiceToResultsRequest {
  audioBase64: string;           // Base64 encoded audio (webm or mp4)
  mimeType: string;              // audio/webm or audio/mp4
  analyteCatalog?: Array<{       // Available analytes to match against
    id?: string;
    name?: string | null;
    unit?: string | null;
    reference_range?: string | null;
    code?: string | null;
  }>;
  analytesToExtract?: string[];  // Specific analytes to focus on
  orderId?: string;
  testGroupId?: string;
  labId?: string;
}

interface ExtractedParameter {
  parameter: string;
  value: string;
  unit: string;
  reference_range?: string;
  flag?: 'Normal' | 'High' | 'Low' | 'Abnormal' | null;
  matched: boolean;
  analyte_id?: string | null;
  confidence: number;
}

// Common lab parameter abbreviation mappings
const ABBREVIATION_MAP: Record<string, string[]> = {
  // CBC / Hematology
  'wbc': ['white blood cell', 'white blood cells', 'leukocyte', 'leukocytes', 'total wbc', 'tlc'],
  'rbc': ['red blood cell', 'red blood cells', 'erythrocyte', 'erythrocytes', 'total rbc'],
  'hemoglobin': ['hgb', 'hb', 'haemoglobin'],
  'hematocrit': ['hct', 'pcv', 'packed cell volume'],
  'platelet': ['plt', 'platelets', 'platelet count', 'thrombocyte'],
  'mcv': ['mean corpuscular volume'],
  'mch': ['mean corpuscular hemoglobin', 'mean corpuscular haemoglobin'],
  'mchc': ['mean corpuscular hemoglobin concentration'],
  'rdw': ['red cell distribution width', 'rdw-cv', 'rdw cv'],
  'mpv': ['mean platelet volume'],

  // Differential
  'neutrophil': ['neu', 'neut', 'neutrophils', 'polymorphs', 'pmn'],
  'lymphocyte': ['lymph', 'lym', 'lymphocytes'],
  'monocyte': ['mono', 'monocytes'],
  'eosinophil': ['eos', 'eosinophils'],
  'basophil': ['baso', 'basophils'],

  // Chemistry
  'glucose': ['glu', 'blood sugar', 'fbs', 'fasting blood sugar', 'rbs', 'random blood sugar', 'ppbs'],
  'creatinine': ['cr', 'crea', 'serum creatinine'],
  'urea': ['bun', 'blood urea nitrogen', 'blood urea'],
  'sodium': ['na', 'na+', 'serum sodium'],
  'potassium': ['k', 'k+', 'serum potassium'],
  'chloride': ['cl', 'cl-', 'serum chloride'],
  'calcium': ['ca', 'ca++', 'serum calcium', 'total calcium'],
  'magnesium': ['mg', 'mg++', 'serum magnesium'],

  // Liver
  'alt': ['sgpt', 'alanine transaminase', 'alanine aminotransferase'],
  'ast': ['sgot', 'aspartate transaminase', 'aspartate aminotransferase'],
  'alp': ['alkaline phosphatase'],
  'bilirubin': ['tbil', 'total bilirubin', 'serum bilirubin'],
  'direct bilirubin': ['dbil', 'conjugated bilirubin'],
  'indirect bilirubin': ['ibil', 'unconjugated bilirubin'],
  'albumin': ['alb', 'serum albumin'],
  'total protein': ['tp', 'serum protein'],
  'ggt': ['gamma gt', 'gamma glutamyl transferase'],

  // Thyroid
  'tsh': ['thyroid stimulating hormone', 'thyrotropin'],
  't3': ['triiodothyronine', 'total t3'],
  't4': ['thyroxine', 'total t4'],
  'ft3': ['free t3', 'free triiodothyronine'],
  'ft4': ['free t4', 'free thyroxine'],

  // Lipid
  'cholesterol': ['total cholesterol', 'tc', 'serum cholesterol'],
  'triglyceride': ['tg', 'triglycerides', 'trigs'],
  'hdl': ['hdl cholesterol', 'hdl-c', 'good cholesterol'],
  'ldl': ['ldl cholesterol', 'ldl-c', 'bad cholesterol'],
  'vldl': ['vldl cholesterol', 'vldl-c'],

  // Urine
  'specific gravity': ['sp gravity', 'urine specific gravity', 'sg'],
  'ph': ['urine ph', 'acidity'],
  'protein': ['urine protein', 'proteinuria'],
  'glucose urine': ['urine glucose', 'glycosuria'],
  'ketone': ['ketones', 'ketonuria'],
  'blood': ['urine blood', 'hematuria', 'occult blood'],
  'nitrite': ['nitrites'],
  'leukocyte esterase': ['wbc esterase', 'le'],
  'urobilinogen': ['urine urobilinogen'],

  // Cardiac
  'troponin': ['troponin i', 'troponin t', 'cardiac troponin', 'trop'],
  'ck': ['creatine kinase', 'cpk'],
  'ck-mb': ['creatine kinase mb', 'cpk-mb'],
  'bnp': ['brain natriuretic peptide', 'pro-bnp', 'nt-probnp'],

  // Others
  'esr': ['sed rate', 'erythrocyte sedimentation rate', 'sedimentation rate'],
  'crp': ['c-reactive protein', 'c reactive protein'],
  'hba1c': ['glycated hemoglobin', 'glycosylated hemoglobin', 'a1c', 'hemoglobin a1c'],
  'psa': ['prostate specific antigen'],
  'vitamin d': ['vit d', '25-oh vitamin d', '25 hydroxy vitamin d', 'vitamin d3'],
  'vitamin b12': ['vit b12', 'cobalamin', 'b12'],
  'ferritin': ['serum ferritin'],
  'iron': ['serum iron', 'fe'],
  'tibc': ['total iron binding capacity'],
};

// Gemini API call for audio transcription and extraction
async function callGeminiWithAudio(
  audioBase64: string,
  mimeType: string,
  analyteCatalog: any[],
  analytesToExtract: string[],
  apiKey: string
): Promise<{ transcript: string; parameters: ExtractedParameter[] }> {
  const analyteList = analyteCatalog
    .filter(a => a.name)
    .map(a => `- ${a.name}${a.unit ? ` (${a.unit})` : ''}${a.reference_range ? ` [Ref: ${a.reference_range}]` : ''}`)
    .join('\n');

  const focusAnalytes = analytesToExtract?.length > 0
    ? `\n\nFOCUS ON THESE ANALYTES: ${analytesToExtract.join(', ')}`
    : '';

  const prompt = `You are a medical lab technician assistant. Listen to this audio recording of test results being spoken and extract the lab parameters.

AVAILABLE ANALYTES IN THIS TEST:
${analyteList || 'No specific analytes provided'}${focusAnalytes}

INSTRUCTIONS:
1. First, transcribe EXACTLY what was spoken in the audio
2. Then extract each lab parameter mentioned with its value
3. Match each parameter to the most appropriate analyte from the list above
4. Be flexible with spoken variations (e.g., "WBC" = "White Blood Cell", "hemoglobin" = "HGB")
5. Handle numbers spoken as words (e.g., "seven point five" = 7.5)
6. Extract units if mentioned, otherwise use default units from the analyte list
7. Determine flags (High/Low/Normal) based on reference ranges if available

RESPONSE FORMAT (JSON only, no markdown):
{
  "transcript": "exact transcription of what was spoken",
  "parameters": [
    {
      "parameter": "matched analyte name",
      "spoken_as": "what was actually said",
      "value": "numeric value",
      "unit": "unit",
      "reference_range": "range if known",
      "flag": "Normal|High|Low|null",
      "matched": true,
      "analyte_id": "id from catalog if matched",
      "confidence": 0.95
    }
  ]
}

If you cannot understand the audio or extract any parameters, return:
{
  "transcript": "could not transcribe or audio unclear",
  "parameters": [],
  "error": "description of the issue"
}`;

  // Call Gemini 2.5 Flash with audio
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: mimeType,
                  data: audioBase64,
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 8192,
          responseMimeType: 'application/json',
        },
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Gemini API error:', errorText);
    throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  const textContent = data.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!textContent) {
    throw new Error('Gemini returned empty response');
  }

  // Parse JSON response
  try {
    const parsed = JSON.parse(textContent);
    return {
      transcript: parsed.transcript || '',
      parameters: parsed.parameters || [],
    };
  } catch (e) {
    console.error('Failed to parse Gemini response:', textContent);
    throw new Error('Failed to parse Gemini response as JSON');
  }
}

// Anthropic validation
async function validateWithAnthropic(
  transcript: string,
  parameters: ExtractedParameter[],
  analyteCatalog: any[],
  analytesToExtract: string[],
  apiKey: string
): Promise<ExtractedParameter[]> {
  const analyteList = analyteCatalog
    .filter(a => a.name)
    .map(a => ({
      id: a.id,
      name: a.name,
      unit: a.unit,
      reference_range: a.reference_range,
    }));

  const prompt = `You are a medical lab quality control specialist. Validate and enhance these voice-extracted lab results.

ORIGINAL TRANSCRIPT:
"${transcript}"

EXTRACTED PARAMETERS (from Gemini):
${JSON.stringify(parameters, null, 2)}

AVAILABLE ANALYTES TO MATCH:
${JSON.stringify(analyteList, null, 2)}

${analytesToExtract?.length > 0 ? `FOCUS ONLY ON: ${analytesToExtract.join(', ')}` : ''}

VALIDATION TASKS:
1. VERIFY each extracted value is medically plausible
2. CORRECT any obvious transcription errors (e.g., "seventy five" should be "7.5" not "75" for hemoglobin)
3. MATCH parameters to the correct analyte from the catalog (use analyte_id)
4. NORMALIZE units to standard format
5. REMOVE any parameters that don't match the focus list (if provided)
6. SET appropriate flags (Normal/High/Low) based on reference ranges
7. FILTER OUT any garbage or non-lab-result speech

Return ONLY a JSON array of validated parameters:
[
  {
    "parameter": "exact analyte name from catalog",
    "value": "corrected numeric value",
    "unit": "standardized unit",
    "reference_range": "from catalog",
    "flag": "Normal|High|Low|null",
    "matched": true,
    "analyte_id": "exact id from catalog",
    "confidence": 0.0-1.0
  }
]

If the transcript appears to be nonsense or non-medical speech, return an empty array: []`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      temperature: 0.2,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Anthropic API error:', errorText);
    throw new Error(`Anthropic API error: ${response.status}`);
  }

  const data = await response.json();
  const content = data.content?.[0]?.text;

  if (!content) {
    console.warn('Anthropic returned empty response, using original parameters');
    return parameters;
  }

  try {
    // Extract JSON from response (might have markdown code blocks)
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return JSON.parse(content);
  } catch (e) {
    console.warn('Failed to parse Anthropic response, using original parameters');
    return parameters;
  }
}

// Match parameters to analyte catalog using fuzzy matching
function matchToAnalyteCatalog(
  parameters: ExtractedParameter[],
  analyteCatalog: any[]
): ExtractedParameter[] {
  return parameters.map(param => {
    if (param.analyte_id && param.matched) {
      return param; // Already matched
    }

    const paramLower = param.parameter.toLowerCase().trim();

    // Try exact match first
    let match = analyteCatalog.find(a =>
      a.name?.toLowerCase().trim() === paramLower
    );

    // Try abbreviation matching
    if (!match) {
      for (const [canonical, variations] of Object.entries(ABBREVIATION_MAP)) {
        if (paramLower === canonical || variations.some(v => paramLower.includes(v) || v.includes(paramLower))) {
          match = analyteCatalog.find(a => {
            const aName = a.name?.toLowerCase().trim() || '';
            return aName === canonical ||
                   aName.includes(canonical) ||
                   variations.some(v => aName.includes(v));
          });
          if (match) break;
        }
      }
    }

    // Try partial match
    if (!match) {
      match = analyteCatalog.find(a => {
        const aName = a.name?.toLowerCase().trim() || '';
        return aName.includes(paramLower) || paramLower.includes(aName);
      });
    }

    if (match) {
      return {
        ...param,
        parameter: match.name,
        analyte_id: match.id,
        matched: true,
        unit: param.unit || match.unit || '',
        reference_range: param.reference_range || match.reference_range || '',
      };
    }

    return { ...param, matched: false };
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const geminiApiKey = Deno.env.get('ALLGOOGLE_KEY') || Deno.env.get('GEMINI_API_KEY');
    const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY');

    if (!geminiApiKey) {
      return new Response(
        JSON.stringify({ error: 'Google API key not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const payload: VoiceToResultsRequest = await req.json();
    const {
      audioBase64,
      mimeType,
      analyteCatalog = [],
      analytesToExtract = [],
      orderId,
      testGroupId,
      labId,
    } = payload;

    if (!audioBase64) {
      return new Response(
        JSON.stringify({ error: 'Missing audioBase64' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('\n🎤 Voice-to-Results Request:');
    console.log(`  - Audio MIME type: ${mimeType}`);
    console.log(`  - Audio size: ${Math.round(audioBase64.length / 1024)} KB`);
    console.log(`  - Analyte catalog size: ${analyteCatalog.length}`);
    console.log(`  - Focus analytes: ${analytesToExtract.length}`);
    console.log(`  - Order ID: ${orderId || 'not provided'}`);
    console.log(`  - Test Group ID: ${testGroupId || 'not provided'}`);

    // Step 1: Call Gemini for transcription and initial extraction
    console.log('\n📝 Step 1: Gemini transcription and extraction...');
    const geminiResult = await callGeminiWithAudio(
      audioBase64,
      mimeType || 'audio/webm',
      analyteCatalog,
      analytesToExtract,
      geminiApiKey
    );

    console.log(`  - Transcript: "${geminiResult.transcript.slice(0, 100)}..."`);
    console.log(`  - Parameters extracted: ${geminiResult.parameters.length}`);

    // Step 2: Match to analyte catalog
    console.log('\n🔗 Step 2: Matching to analyte catalog...');
    let matchedParameters = matchToAnalyteCatalog(geminiResult.parameters, analyteCatalog);
    console.log(`  - Matched parameters: ${matchedParameters.filter(p => p.matched).length}`);

    // Step 3: Validate with Anthropic (if available)
    let validationApplied = false;
    if (anthropicApiKey && geminiResult.parameters.length > 0) {
      console.log('\n✅ Step 3: Anthropic validation...');
      try {
        const validatedParams = await validateWithAnthropic(
          geminiResult.transcript,
          matchedParameters,
          analyteCatalog,
          analytesToExtract,
          anthropicApiKey
        );
        if (validatedParams && validatedParams.length > 0) {
          matchedParameters = validatedParams;
          validationApplied = true;
          console.log(`  - Validated parameters: ${validatedParams.length}`);
        }
      } catch (error) {
        console.warn('Anthropic validation failed, using Gemini results:', error);
      }
    }

    // Final matching pass
    matchedParameters = matchToAnalyteCatalog(matchedParameters, analyteCatalog);

    // Filter to focus analytes if specified
    if (analytesToExtract.length > 0) {
      const focusLower = analytesToExtract.map(a => a.toLowerCase());
      matchedParameters = matchedParameters.filter(p => {
        const paramLower = p.parameter.toLowerCase();
        return focusLower.some(f =>
          paramLower.includes(f) || f.includes(paramLower)
        );
      });
    }

    console.log('\n✅ Voice-to-Results Complete:');
    console.log(`  - Final parameters: ${matchedParameters.length}`);
    console.log(`  - Validation applied: ${validationApplied}`);

    return new Response(
      JSON.stringify({
        success: true,
        transcript: geminiResult.transcript,
        extractedParameters: matchedParameters,
        metadata: {
          processingMethod: validationApplied ? 'Gemini + Anthropic' : 'Gemini Only',
          totalExtracted: geminiResult.parameters.length,
          matchedCount: matchedParameters.filter(p => p.matched).length,
          validationApplied,
          orderId,
          testGroupId,
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Voice-to-Results error:', error);
    return new Response(
      JSON.stringify({
        error: 'Voice processing failed',
        details: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
