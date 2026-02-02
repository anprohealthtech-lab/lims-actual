/**
 * QC Scan Intake Edge Function
 *
 * Processes QC analyzer screenshots/photos using Gemini Vision to:
 * 1. Extract QC data (analyzer, lot, level, analytes, values)
 * 2. Auto-match to existing lots and analytes
 * 3. Create QC runs and results
 * 4. Store evidence for NABL audit trail
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface QCScanIntakeRequest {
  attachmentId?: string;
  base64Image?: string;
  documentType: 'analyzer_screen' | 'thermal_printout' | 'pdf_report';
  labId: string;
  analyzerId?: string;
  analyzerName?: string;
  runDate?: string;
  runTime?: string;
  lotNumber?: string;
  operatorId?: string;
  runType?: 'routine' | 'calibration_verification' | 'new_lot' | 'maintenance' | 'troubleshooting';
}

interface ExtractedResult {
  analyte_name: string;
  observed_value: number;
  unit?: string;
  level?: string;
  raw_text?: string;
  confidence: number;
}

interface ExtractedQCData {
  analyzer_name?: string;
  lot_number?: string;
  level?: string;
  run_date?: string;
  run_time?: string;
  manufacturer?: string;
  material_name?: string;
  results: ExtractedResult[];
}

interface MatchingSuggestion {
  id: string;
  name: string;
  confidence: number;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get Gemini API key
    const geminiApiKey = Deno.env.get('ALLGOOGLE_KEY') || Deno.env.get('GEMINI_API_KEY');
    if (!geminiApiKey) {
      return new Response(
        JSON.stringify({ success: false, error: 'Google API key not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const payload: QCScanIntakeRequest = await req.json();
    const {
      attachmentId,
      base64Image,
      documentType,
      labId,
      analyzerId,
      analyzerName: providedAnalyzerName,
      runDate: providedRunDate,
      runTime: providedRunTime,
      lotNumber: providedLotNumber,
      operatorId,
      runType = 'routine'
    } = payload;

    console.log(`\n📸 QC Scan Intake Request:`);
    console.log(`  - Lab ID: ${labId}`);
    console.log(`  - Document Type: ${documentType}`);
    console.log(`  - Has base64Image: ${!!base64Image}`);
    console.log(`  - Attachment ID: ${attachmentId || 'none'}`);

    // Get image data
    let imageData = base64Image;
    let originalFilename: string | undefined;
    let fileUrl: string | undefined;

    if (attachmentId && !imageData) {
      // Fetch image from attachment
      const { data: attachment, error: attachmentError } = await supabase
        .from('order_attachments')
        .select('file_url, original_filename')
        .eq('id', attachmentId)
        .single();

      if (attachmentError || !attachment) {
        return new Response(
          JSON.stringify({ success: false, error: 'Attachment not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      fileUrl = attachment.file_url;
      originalFilename = attachment.original_filename;

      // Fetch and convert to base64
      const imageResponse = await fetch(attachment.file_url);
      const imageBlob = await imageResponse.blob();
      const arrayBuffer = await imageBlob.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);
      let binary = '';
      for (let i = 0; i < uint8Array.length; i++) {
        binary += String.fromCharCode(uint8Array[i]);
      }
      imageData = btoa(binary);
    }

    if (!imageData) {
      return new Response(
        JSON.stringify({ success: false, error: 'No image data provided' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch existing lots and analytes for matching
    const [lotsResult, analytesResult] = await Promise.all([
      supabase
        .from('qc_lots')
        .select('id, lot_number, material_name, manufacturer, level, is_active')
        .eq('lab_id', labId)
        .eq('is_active', true),
      supabase
        .from('analytes')
        .select('id, name, code, unit')
        .eq('lab_id', labId)
    ]);

    const lots = lotsResult.data || [];
    const analytes = analytesResult.data || [];

    console.log(`  - Available lots: ${lots.length}`);
    console.log(`  - Available analytes: ${analytes.length}`);

    // Build analyte name mapping for Gemini context
    const analyteNamesList = analytes.map(a => `${a.name}${a.code ? ` (${a.code})` : ''}`).join(', ');
    const lotNumbersList = lots.map(l => `${l.lot_number} - ${l.material_name} ${l.level || ''}`).join(', ');

    // Call Gemini Vision to extract QC data
    const prompt = buildQCExtractionPrompt(documentType, analyteNamesList, lotNumbersList);
    const extractedData = await callGeminiVision(prompt, imageData, geminiApiKey);

    console.log(`\n📊 Extracted QC Data:`);
    console.log(`  - Analyzer: ${extractedData.analyzer_name || 'not detected'}`);
    console.log(`  - Lot: ${extractedData.lot_number || 'not detected'}`);
    console.log(`  - Level: ${extractedData.level || 'not detected'}`);
    console.log(`  - Results count: ${extractedData.results?.length || 0}`);

    // Match lot number
    let matchedLotId: string | undefined;
    let lotSuggestions: MatchingSuggestion[] = [];
    const lotToMatch = providedLotNumber || extractedData.lot_number;

    if (lotToMatch) {
      const lotMatch = findBestLotMatch(lotToMatch, lots);
      if (lotMatch.match) {
        matchedLotId = lotMatch.match.id;
      }
      lotSuggestions = lotMatch.suggestions;
    }

    // Match analytes
    const analyteMatches: Record<string, { matched: boolean; id?: string; suggestions?: MatchingSuggestion[] }> = {};

    for (const result of extractedData.results || []) {
      const match = findBestAnalyteMatch(result.analyte_name, analytes);
      analyteMatches[result.analyte_name] = {
        matched: !!match.match,
        id: match.match?.id,
        suggestions: match.suggestions
      };
    }

    // Create QC Run
    const runDate = providedRunDate || extractedData.run_date || new Date().toISOString().split('T')[0];
    const runTime = providedRunTime || extractedData.run_time;
    const analyzerName = providedAnalyzerName || extractedData.analyzer_name || 'Unknown Analyzer';

    const { data: qcRun, error: runError } = await supabase
      .from('qc_runs')
      .insert({
        lab_id: labId,
        run_date: runDate,
        run_time: runTime,
        analyzer_id: analyzerId,
        analyzer_name: analyzerName,
        operator_id: operatorId,
        run_type: runType,
        status: 'pending',
        notes: `Created from ${documentType} scan`
      })
      .select()
      .single();

    if (runError) {
      console.error('Error creating QC run:', runError);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to create QC run', details: runError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`  - Created QC Run: ${qcRun.id}`);

    // Store evidence
    const processingTime = Date.now() - startTime;
    const { data: evidence, error: evidenceError } = await supabase
      .from('qc_evidence')
      .insert({
        qc_run_id: qcRun.id,
        lab_id: labId,
        source_type: documentType === 'analyzer_screen' ? 'analyzer_screenshot' :
                     documentType === 'thermal_printout' ? 'pdf_upload' : documentType,
        file_url: fileUrl,
        original_filename: originalFilename,
        ocr_json: extractedData,
        extraction_confidence: calculateOverallConfidence(extractedData.results || []),
        extracted_values: extractedData,
        matched_lot_id: matchedLotId,
        matched_analyte_ids: Object.values(analyteMatches)
          .filter(m => m.matched && m.id)
          .map(m => m.id!),
        matching_suggestions: {
          lot: lotSuggestions,
          analytes: analyteMatches
        },
        ai_model_used: 'gemini-2.5-flash',
        ai_processing_time_ms: processingTime
      })
      .select()
      .single();

    if (evidenceError) {
      console.error('Error storing evidence:', evidenceError);
    }

    // Create QC Results (only for matched analytes with matched lot)
    const createdResults: any[] = [];

    if (matchedLotId && extractedData.results) {
      // Fetch target values for the matched lot
      const { data: targetValues } = await supabase
        .from('qc_target_values')
        .select('analyte_id, target_mean, target_sd, unit')
        .eq('qc_lot_id', matchedLotId);

      const targetMap = new Map(
        (targetValues || []).map(tv => [tv.analyte_id, tv])
      );

      for (const result of extractedData.results) {
        const analyteMatch = analyteMatches[result.analyte_name];
        if (!analyteMatch?.matched || !analyteMatch.id) continue;

        const target = targetMap.get(analyteMatch.id);
        if (!target) {
          console.log(`  - No target value for analyte ${result.analyte_name}, skipping`);
          continue;
        }

        const { data: qcResult, error: resultError } = await supabase
          .from('qc_results')
          .insert({
            qc_run_id: qcRun.id,
            qc_lot_id: matchedLotId,
            analyte_id: analyteMatch.id,
            observed_value: result.observed_value,
            unit: result.unit || target.unit,
            target_mean: target.target_mean,
            target_sd: target.target_sd,
            pass_fail: 'pending' // Will be evaluated by Westgard trigger
          })
          .select()
          .single();

        if (!resultError && qcResult) {
          createdResults.push(qcResult);
        }
      }
    }

    console.log(`  - Created ${createdResults.length} QC results`);

    // Calculate warnings
    const warnings: string[] = [];
    if (!matchedLotId) {
      warnings.push(`Lot number "${lotToMatch || 'not detected'}" could not be matched. Please select manually.`);
    }

    const unmatchedAnalytes = Object.entries(analyteMatches)
      .filter(([_, m]) => !m.matched)
      .map(([name, _]) => name);

    if (unmatchedAnalytes.length > 0) {
      warnings.push(`${unmatchedAnalytes.length} analyte(s) could not be matched: ${unmatchedAnalytes.join(', ')}`);
    }

    const response = {
      success: true,
      qc_run_id: qcRun.id,
      evidence_id: evidence?.id,
      extracted_data: extractedData,
      extraction_confidence: calculateOverallConfidence(extractedData.results || []),
      matching_results: {
        lot_matched: !!matchedLotId,
        lot_id: matchedLotId,
        lot_suggestions: lotSuggestions,
        analyte_matches: analyteMatches
      },
      warnings: warnings.length > 0 ? warnings : undefined,
      created_results: createdResults,
      processing_time_ms: Date.now() - startTime
    };

    return new Response(
      JSON.stringify(response),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('QC Scan Intake Error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

function buildQCExtractionPrompt(
  documentType: string,
  analyteNames: string,
  lotNumbers: string
): string {
  return `You are an expert at reading Quality Control (QC) data from laboratory analyzer screens and printouts.

Analyze this ${documentType.replace(/_/g, ' ')} image and extract all QC-related information.

CONTEXT:
- Known analyte names in this lab: ${analyteNames || 'Not provided'}
- Known lot numbers: ${lotNumbers || 'Not provided'}

EXTRACT THE FOLLOWING (return as JSON):

1. analyzer_name: The analyzer/instrument name shown
2. lot_number: The control lot number (may appear as "Lot:", "Lot No:", "Control Lot:")
3. level: The control level (L1, L2, L3, Level 1, Level 2, Normal, Abnormal, etc.)
4. run_date: Date of the QC run (format: YYYY-MM-DD if possible)
5. run_time: Time of the run if visible
6. manufacturer: Control material manufacturer if visible
7. material_name: Control material name if visible
8. results: An array of extracted QC values with:
   - analyte_name: The test/analyte name (match to known names if possible)
   - observed_value: The measured/observed value (numeric only)
   - unit: The unit of measurement
   - level: Control level for this specific result if different from global
   - raw_text: The exact text as it appears on screen
   - confidence: Your confidence in this extraction (0-1)

IMPORTANT RULES:
1. Extract ALL visible QC values, even if some fields are unclear
2. For analyte names, try to match to the known names provided
3. If a value looks like a QC result with target/SD info, extract the observed value only
4. Handle common abbreviations: Na=Sodium, K=Potassium, Cl=Chloride, Glu=Glucose, Crea=Creatinine, etc.
5. If you see "Target:", "Mean:", or "Expected:" values, those are reference values - extract the "Observed:" or "Result:" value
6. confidence should be 1.0 for clearly readable values, lower for uncertain readings

Return ONLY valid JSON, no markdown formatting.

Example response:
{
  "analyzer_name": "Roche Cobas 6000",
  "lot_number": "24A1234",
  "level": "L2",
  "run_date": "2024-01-15",
  "run_time": "09:30",
  "manufacturer": "Roche",
  "material_name": "PreciControl ClinChem",
  "results": [
    {
      "analyte_name": "Glucose",
      "observed_value": 95.3,
      "unit": "mg/dL",
      "level": "L2",
      "raw_text": "GLU: 95.3 mg/dL",
      "confidence": 0.95
    }
  ]
}`;
}

async function callGeminiVision(
  prompt: string,
  imageData: string,
  apiKey: string
): Promise<ExtractedQCData> {
  const model = 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  // Clean base64 data
  const cleanBase64 = imageData.replace(/^data:image\/[a-z]+;base64,/, '');

  const requestBody = {
    contents: [
      {
        parts: [
          { text: prompt },
          {
            inline_data: {
              mime_type: 'image/jpeg',
              data: cleanBase64
            }
          }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.1,
      topK: 32,
      topP: 1,
      maxOutputTokens: 4096,
    },
    safetySettings: [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" }
    ]
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Gemini API error:', errorText);
    throw new Error(`Gemini API error: ${response.status}`);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

  // Parse JSON response
  try {
    // Remove markdown code blocks if present
    const cleanJson = text
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();

    return JSON.parse(cleanJson);
  } catch (e) {
    console.error('Failed to parse Gemini response:', text);
    return {
      results: [],
      analyzer_name: undefined,
      lot_number: undefined
    };
  }
}

function findBestLotMatch(
  lotNumber: string,
  lots: Array<{ id: string; lot_number: string; material_name: string; manufacturer?: string; level?: string }>
): { match: typeof lots[0] | null; suggestions: MatchingSuggestion[] } {
  const normalizedSearch = lotNumber.toLowerCase().replace(/[^a-z0-9]/g, '');

  const scored = lots.map(lot => {
    const normalizedLot = lot.lot_number.toLowerCase().replace(/[^a-z0-9]/g, '');

    // Exact match
    if (normalizedLot === normalizedSearch) {
      return { lot, score: 1.0 };
    }

    // Contains match
    if (normalizedLot.includes(normalizedSearch) || normalizedSearch.includes(normalizedLot)) {
      return { lot, score: 0.8 };
    }

    // Levenshtein-like similarity
    const similarity = calculateSimilarity(normalizedSearch, normalizedLot);
    return { lot, score: similarity };
  });

  scored.sort((a, b) => b.score - a.score);

  const suggestions: MatchingSuggestion[] = scored
    .filter(s => s.score > 0.3)
    .slice(0, 5)
    .map(s => ({
      id: s.lot.id,
      name: `${s.lot.lot_number} - ${s.lot.material_name} ${s.lot.level || ''}`.trim(),
      confidence: s.score
    }));

  const bestMatch = scored[0]?.score >= 0.8 ? scored[0].lot : null;

  return { match: bestMatch, suggestions };
}

function findBestAnalyteMatch(
  analyteName: string,
  analytes: Array<{ id: string; name: string; code?: string; unit?: string }>
): { match: typeof analytes[0] | null; suggestions: MatchingSuggestion[] } {
  const normalizedSearch = analyteName.toLowerCase().replace(/[^a-z0-9]/g, '');

  // Common abbreviation mappings
  const abbreviations: Record<string, string[]> = {
    'sodium': ['na', 'sod'],
    'potassium': ['k', 'pot'],
    'chloride': ['cl', 'chl'],
    'glucose': ['glu', 'gluc', 'glc'],
    'creatinine': ['crea', 'creat', 'cr'],
    'urea': ['bun', 'ur'],
    'hemoglobin': ['hb', 'hgb', 'haemoglobin'],
    'hematocrit': ['hct', 'haematocrit'],
    'calcium': ['ca', 'calc'],
    'phosphorus': ['phos', 'p', 'phosphate'],
    'magnesium': ['mg', 'mag'],
    'albumin': ['alb'],
    'bilirubin': ['bil', 'tbil', 'dbil'],
    'alkalinephosphatase': ['alp', 'alkphos'],
    'aspartateaminotransferase': ['ast', 'sgot', 'got'],
    'alanineaminotransferase': ['alt', 'sgpt', 'gpt'],
    'lactatedehydrogenase': ['ldh', 'ld'],
    'cholesterol': ['chol', 'tc'],
    'triglycerides': ['tg', 'trig'],
    'hdlcholesterol': ['hdl', 'hdlc'],
    'ldlcholesterol': ['ldl', 'ldlc'],
    'uricacid': ['ua', 'uricac'],
    'protein': ['prot', 'tp'],
    'amylase': ['amy', 'amyl'],
    'lipase': ['lip'],
  };

  const scored = analytes.map(analyte => {
    const normalizedName = analyte.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    const normalizedCode = analyte.code?.toLowerCase().replace(/[^a-z0-9]/g, '') || '';

    // Exact match
    if (normalizedName === normalizedSearch || normalizedCode === normalizedSearch) {
      return { analyte, score: 1.0 };
    }

    // Check abbreviation match
    for (const [full, abbrevs] of Object.entries(abbreviations)) {
      if (normalizedName.includes(full) || full.includes(normalizedName)) {
        if (abbrevs.includes(normalizedSearch)) {
          return { analyte, score: 0.95 };
        }
      }
      if (abbrevs.includes(normalizedSearch) && (normalizedName.includes(full) || normalizedCode.includes(abbrevs[0]))) {
        return { analyte, score: 0.95 };
      }
    }

    // Contains match
    if (normalizedName.includes(normalizedSearch) || normalizedSearch.includes(normalizedName)) {
      return { analyte, score: 0.8 };
    }

    // Code contains match
    if (normalizedCode && (normalizedCode.includes(normalizedSearch) || normalizedSearch.includes(normalizedCode))) {
      return { analyte, score: 0.75 };
    }

    // Similarity score
    const similarity = Math.max(
      calculateSimilarity(normalizedSearch, normalizedName),
      normalizedCode ? calculateSimilarity(normalizedSearch, normalizedCode) : 0
    );
    return { analyte, score: similarity };
  });

  scored.sort((a, b) => b.score - a.score);

  const suggestions: MatchingSuggestion[] = scored
    .filter(s => s.score > 0.3)
    .slice(0, 5)
    .map(s => ({
      id: s.analyte.id,
      name: s.analyte.name,
      confidence: s.score
    }));

  const bestMatch = scored[0]?.score >= 0.7 ? scored[0].analyte : null;

  return { match: bestMatch, suggestions };
}

function calculateSimilarity(s1: string, s2: string): number {
  if (s1 === s2) return 1;
  if (s1.length === 0 || s2.length === 0) return 0;

  const longer = s1.length > s2.length ? s1 : s2;
  const shorter = s1.length > s2.length ? s2 : s1;

  // Simple substring match score
  let matchCount = 0;
  for (let i = 0; i < shorter.length; i++) {
    if (longer.includes(shorter[i])) matchCount++;
  }

  return matchCount / longer.length;
}

function calculateOverallConfidence(results: ExtractedResult[]): number {
  if (results.length === 0) return 0;
  const sum = results.reduce((acc, r) => acc + (r.confidence || 0), 0);
  return sum / results.length;
}
