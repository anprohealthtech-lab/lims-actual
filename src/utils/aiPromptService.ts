import { supabase } from './supabase';

export interface PromptOptions {
  labId?: string;
  testGroupId?: string;
  analyteId?: string;
  processingType:
    | 'nlp_extraction'
    | 'ocr_report'
    | 'vision_card'
    | 'vision_color'
    | 'THERMAL_SLIP_OCR'
    | 'INSTRUMENT_SCREEN_OCR'
    | 'RAPID_CARD_LFA'
    | 'COLOR_STRIP_MULTIPARAM'
    | 'SINGLE_WELL_COLORIMETRIC'
    | 'AGGLUTINATION_CARD'
    | 'MICROSCOPY_MORPHOLOGY'
    | 'ZONE_OF_INHIBITION'
    | 'MANUAL_ENTRY_NO_VISION'
    | 'UNKNOWN_NEEDS_REVIEW';
}

function normalizePromptType(type: string): string {
  const normalized = type.trim().toUpperCase();
  const map: Record<string, string> = {
    THERMAL_SLIP_OCR: 'ocr_report',
    INSTRUMENT_SCREEN_OCR: 'ocr_report',
    RAPID_CARD_LFA: 'vision_card',
    AGGLUTINATION_CARD: 'vision_card',
    COLOR_STRIP_MULTIPARAM: 'vision_color',
    SINGLE_WELL_COLORIMETRIC: 'vision_color',
    MANUAL_ENTRY_NO_VISION: 'nlp_extraction',
    UNKNOWN_NEEDS_REVIEW: 'nlp_extraction',
    MICROSCOPY_MORPHOLOGY: 'vision_card',
    ZONE_OF_INHIBITION: 'vision_card',
  };

  if (normalized === 'OCR_REPORT' || normalized === 'VISION_CARD' || normalized === 'VISION_COLOR' || normalized === 'NLP_EXTRACTION') {
    return normalized.toLowerCase();
  }

  return map[normalized] || 'nlp_extraction';
}

/**
 * Fetch AI prompt with hierarchical fallback:
 * 1. Lab + Test + Analyte specific (ai_prompts table)
 * 2. Lab + Test specific (ai_prompts table)
 * 3. Test specific (ai_prompts table)
 * 4. Test group level prompt (test_groups.group_level_prompt)
 * 5. Default prompt (ai_prompts table with default=true)
 * 6. Hardcoded default prompt
 */
export async function getAIPrompt(options: PromptOptions): Promise<string> {
  const { labId, testGroupId, analyteId } = options;
  const processingType = normalizePromptType(options.processingType);

  console.log('🔍 Fetching AI prompt:', { labId, testGroupId, analyteId, processingType });

  try {
    // Try: Lab + Test + Analyte specific
    if (labId && testGroupId && analyteId) {
      const { data: labTestAnalytePrompt, error } = await supabase
        .from('ai_prompts')
        .select('prompt')
        .eq('lab_id', labId)
        .eq('test_id', testGroupId)
        .eq('analyte_id', analyteId)
        .eq('ai_processing_type', processingType)
        .maybeSingle();
      
      if (labTestAnalytePrompt?.prompt) {
        console.log('✓ Using Lab + Test + Analyte specific prompt');
        return labTestAnalytePrompt.prompt;
      }
    }

    // Try: Lab + Test specific
    if (labId && testGroupId) {
      const { data: labTestPrompt } = await supabase
        .from('ai_prompts')
        .select('prompt')
        .eq('lab_id', labId)
        .eq('test_id', testGroupId)
        .eq('ai_processing_type', processingType)
        .is('analyte_id', null)
        .maybeSingle();
      
      if (labTestPrompt?.prompt) {
        console.log('✓ Using Lab + Test specific prompt');
        return labTestPrompt.prompt;
      }
    }

    // Try: Test-specific (no lab override)
    if (testGroupId) {
      const { data: testPrompt } = await supabase
        .from('ai_prompts')
        .select('prompt')
        .eq('test_id', testGroupId)
        .eq('ai_processing_type', processingType)
        .is('lab_id', null)
        .is('analyte_id', null)
        .maybeSingle();
      
      if (testPrompt?.prompt) {
        console.log('✓ Using Test-specific prompt');
        return testPrompt.prompt;
      }
    }

    // Try: Test group level prompt
    if (testGroupId) {
      const { data: testGroup } = await supabase
        .from('test_groups')
        .select('group_level_prompt')
        .eq('id', testGroupId)
        .maybeSingle();
      
      if (testGroup?.group_level_prompt) {
        console.log('✓ Using Test Group level prompt');
        return testGroup.group_level_prompt;
      }
    }

    // Try: Default prompt for this processing type
    const { data: defaultPrompt } = await supabase
      .from('ai_prompts')
      .select('prompt')
      .eq('ai_processing_type', processingType)
      .eq('default', true)
      .is('lab_id', null)
      .is('test_id', null)
      .is('analyte_id', null)
      .maybeSingle();

    if (defaultPrompt?.prompt) {
      console.log('✓ Using default prompt from database');
      return defaultPrompt.prompt;
    }

    // Fallback: Hardcoded default prompt
    console.log('⚠ Using hardcoded default prompt (no database prompts found)');
    return getHardcodedDefaultPrompt(processingType);

  } catch (error) {
    console.error('❌ Error fetching AI prompt:', error);
    console.log('⚠ Falling back to hardcoded default prompt');
    return getHardcodedDefaultPrompt(processingType);
  }
}

/**
 * Get hardcoded default prompts (fallback when database has none)
 */
function getHardcodedDefaultPrompt(processingType: string): string {
  const defaults: Record<string, string> = {
    'nlp_extraction': `You are an expert medical document analyzer specializing in Test Request Forms (TRF) from Indian medical laboratories.

TASK: Extract structured information from the provided text with high accuracy.

EXTRACT THE FOLLOWING:

1. PATIENT INFORMATION:
   - name: Full patient name
   - age: Numeric age with unit (years/months/days)
   - gender: Male/Female/Other
   - phone: 10-digit mobile number
   - email: Email address if present
   - address: Full address if present

2. REQUESTED TESTS:
   - Extract all test names EXACTLY as written
   - Mark each test as "isSelected: true" if it should be performed
   - Provide confidence score (0.0 to 1.0) for each test
   - Common test variations:
     * CBC / Complete Blood Count / Hemogram
     * LFT / Liver Function Test
     * KFT / RFT / Kidney Function Test
     * Lipid Profile / Cholesterol Panel
     * Thyroid Profile / TFT
     * HbA1c / Glycated Hemoglobin
     * Blood Sugar / Glucose (Fasting/PP/Random)

3. DOCTOR INFORMATION:
   - name: Doctor's full name (include titles like Dr./Prof.)
   - specialization: Medical specialty if mentioned
   - registrationNumber: Medical registration number if present

4. ADDITIONAL DETAILS:
   - clinicalNotes: Any clinical history or symptoms
   - location: Collection location if specified
   - sampleCollectionDate: Date if specified (format: YYYY-MM-DD)
   - urgency: "Normal" / "Urgent" / "STAT"

OUTPUT FORMAT (JSON):
{
  "patientInfo": {
    "name": "string",
    "age": number,
    "gender": "Male" | "Female" | "Other",
    "phone": "string (10 digits)",
    "email": "string or null",
    "address": "string or null",
    "confidence": 0.9
  },
  "requestedTests": [
    {
      "testName": "string (exact name from document)",
      "isSelected": true,
      "confidence": 0.9
    }
  ],
  "doctorInfo": {
    "name": "string",
    "specialization": "string or null",
    "registrationNumber": "string or null",
    "confidence": 0.8
  },
  "clinicalNotes": "string or null",
  "location": "string or null",
  "sampleCollectionDate": "YYYY-MM-DD or null",
  "urgency": "Normal" | "Urgent" | "STAT"
}

IMPORTANT GUIDELINES:
- Use confidence scores based on text clarity (clear: 0.9, moderate: 0.7, unclear: 0.5)
- Return null for missing fields
- Preserve original test names exactly
- Include all tests mentioned, even if handwritten
- For phone numbers, extract only digits (remove spaces/dashes)
- Default urgency to "Normal" if not specified`,

    'ocr_report': `You are an expert at extracting medical test results from laboratory reports.

TASK: Extract all test results with their values and reference ranges.

EXTRACT:
- Test/Analyte names
- Test values (numeric or categorical)
- Units of measurement
- Reference ranges (normal ranges)
- Abnormal flags (High/Low/Critical)

OUTPUT FORMAT (JSON):
{
  "results": [
    {
      "analyteName": "Hemoglobin",
      "value": "12.5",
      "unit": "g/dL",
      "referenceRange": "12.0-15.0",
      "flag": "Normal",
      "confidence": 0.9
    }
  ]
}`,

    'vision_card': `You are an expert at analyzing medical sample cards and identifying visual characteristics.

TASK: Analyze the image and extract visual information about the medical sample.

IDENTIFY:
- Sample type (blood, urine, etc.)
- Visual characteristics (color, clarity, consistency)
- Any visible abnormalities
- Sample quality indicators

OUTPUT FORMAT (JSON):
{
  "sampleType": "string",
  "characteristics": {
    "color": "string",
    "clarity": "clear/turbid/cloudy",
    "consistency": "string"
  },
  "abnormalities": ["list of observed abnormalities"],
  "quality": "good/acceptable/poor",
  "confidence": 0.9
}`,

    'vision_color': `You are an expert at detecting and analyzing colors in medical samples.

TASK: Identify the primary color and any color variations in the sample.

ANALYZE:
- Primary color
- Secondary colors if present
- Color intensity
- Any color-based abnormalities

OUTPUT FORMAT (JSON):
{
  "primaryColor": "string",
  "secondaryColors": ["array of colors"],
  "intensity": "light/medium/dark",
  "abnormalColors": ["list if any"],
  "confidence": 0.9
}`
  };
  
  return defaults[processingType] || 'Extract information from the medical document and return as structured JSON.';
}

/**
 * Save or update an AI prompt
 */
export async function saveAIPrompt(params: {
  prompt: string;
  processingType: string;
  labId?: string;
  testGroupId?: string;
  analyteId?: string;
  isDefault?: boolean;
}): Promise<{ success: boolean; error?: string }> {
  const { prompt, processingType, labId, testGroupId, analyteId, isDefault } = params;

  try {
    // Check if prompt already exists
    let query = supabase
      .from('ai_prompts')
      .select('id')
      .eq('ai_processing_type', processingType);

    if (labId) query = query.eq('lab_id', labId);
    else query = query.is('lab_id', null);

    if (testGroupId) query = query.eq('test_id', testGroupId);
    else query = query.is('test_id', null);

    if (analyteId) query = query.eq('analyte_id', analyteId);
    else query = query.is('analyte_id', null);

    const { data: existing } = await query.maybeSingle();

    if (existing) {
      // Update existing prompt
      const { error } = await supabase
        .from('ai_prompts')
        .update({
          prompt,
          default: isDefault || false,
          updated_at: new Date().toISOString()
        })
        .eq('id', existing.id);

      if (error) throw error;
      console.log('✓ Prompt updated successfully');
    } else {
      // Insert new prompt
      const { error } = await supabase
        .from('ai_prompts')
        .insert({
          prompt,
          ai_processing_type: processingType,
          lab_id: labId || null,
          test_id: testGroupId || null,
          analyte_id: analyteId || null,
          default: isDefault || false
        });

      if (error) throw error;
      console.log('✓ Prompt created successfully');
    }

    return { success: true };
  } catch (error: any) {
    console.error('❌ Error saving prompt:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Delete an AI prompt
 */
export async function deleteAIPrompt(promptId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabase
      .from('ai_prompts')
      .delete()
      .eq('id', promptId);

    if (error) throw error;
    console.log('✓ Prompt deleted successfully');
    return { success: true };
  } catch (error: any) {
    console.error('❌ Error deleting prompt:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get all prompts for a specific context
 */
export async function getAIPrompts(options?: {
  labId?: string;
  testGroupId?: string;
  analyteId?: string;
  processingType?: string;
}): Promise<any[]> {
  try {
    let query = supabase
      .from('ai_prompts')
      .select(`
        *,
        test_groups:test_id(name),
        analytes:analyte_id(name),
        labs:lab_id(name)
      `)
      .order('created_at', { ascending: false });

    if (options?.labId) query = query.eq('lab_id', options.labId);
    if (options?.testGroupId) query = query.eq('test_id', options.testGroupId);
    if (options?.analyteId) query = query.eq('analyte_id', options.analyteId);
    if (options?.processingType) query = query.eq('ai_processing_type', options.processingType);

    const { data, error } = await query;

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('❌ Error fetching prompts:', error);
    return [];
  }
}
