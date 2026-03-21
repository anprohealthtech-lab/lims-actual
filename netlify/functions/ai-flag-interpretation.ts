import { Handler } from '@netlify/functions';
import Anthropic from '@anthropic-ai/sdk';

// Initialize Claude AI (API key stored in Netlify environment variables)
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
});

interface ResultValueInput {
  id: string;
  parameter: string;
  value: string;
  unit?: string;
  reference_range?: string;
  reference_range_male?: string;
  reference_range_female?: string;
  low_critical?: string;
  high_critical?: string;
  current_flag?: string;
}

interface PatientContext {
  gender?: string;
  age?: number;
  clinical_notes?: string;
}

interface FlagInterpretationResult {
  id: string;
  parameter: string;
  flag: string | null;
  flag_confidence: number;
  interpretation: string;
  clinical_significance?: string;
  suggested_action?: string;
}

interface RequestBody {
  action: 'analyze_flags' | 'interpret_single';
  result_values?: ResultValueInput[];
  result_value?: ResultValueInput;
  patient?: PatientContext;
  test_group_name?: string;
}

const handler: Handler = async (event) => {
  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    const body: RequestBody = JSON.parse(event.body || '{}');
    const { action, result_values, result_value, patient, test_group_name } = body;

    if (!process.env.ANTHROPIC_API_KEY) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'AI service not configured (ANTHROPIC_API_KEY missing)' }),
      };
    }

    if (action === 'analyze_flags' && result_values?.length) {
      const results = await analyzeBatchFlags(result_values, patient, test_group_name);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, data: results }),
      };
    }

    if (action === 'interpret_single' && result_value) {
      const result = await interpretSingleFlag(result_value, patient);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, data: result }),
      };
    }

    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Invalid action or missing data' }),
    };
  } catch (error) {
    console.error('AI Flag Interpretation Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'AI interpretation failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      }),
    };
  }
};

async function analyzeBatchFlags(
  resultValues: ResultValueInput[],
  patient?: PatientContext,
  testGroupName?: string
): Promise<FlagInterpretationResult[]> {
  const prompt = buildBatchPrompt(resultValues, patient, testGroupName);
  
  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    messages: [
      {
        role: 'user',
        content: prompt
      }
    ]
  });

  // Extract text content from response
  const textContent = message.content.find(c => c.type === 'text');
  const text = textContent?.type === 'text' ? textContent.text : '';
  
  // Parse JSON from response
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    // Return rule-based flags as fallback
    return resultValues.map(rv => ({
      id: rv.id,
      parameter: rv.parameter,
      flag: determineRuleBasedFlag(rv, patient),
      flag_confidence: 0.7,
      interpretation: 'AI parsing failed, using rule-based flag',
    }));
  }
  
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    
    // Map back to our result format
    return resultValues.map((rv, index) => {
      const aiResult = parsed[index] || {};
      return {
        id: rv.id,
        parameter: rv.parameter,
        flag: aiResult.flag || determineRuleBasedFlag(rv, patient),
        flag_confidence: aiResult.confidence || 0.85,
        interpretation: aiResult.interpretation || '',
        clinical_significance: aiResult.clinical_significance,
        suggested_action: aiResult.suggested_action,
      };
    });
  } catch (parseError) {
    console.error('JSON parse error:', parseError);
    return resultValues.map(rv => ({
      id: rv.id,
      parameter: rv.parameter,
      flag: determineRuleBasedFlag(rv, patient),
      flag_confidence: 0.7,
      interpretation: 'AI response parsing failed',
    }));
  }
}

async function interpretSingleFlag(
  resultValue: ResultValueInput,
  patient?: PatientContext
): Promise<FlagInterpretationResult> {
  const prompt = buildSinglePrompt(resultValue, patient);
  
  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    messages: [
      {
        role: 'user',
        content: prompt
      }
    ]
  });

  // Extract text content from response
  const textContent = message.content.find(c => c.type === 'text');
  const text = textContent?.type === 'text' ? textContent.text : '';
  
  // Parse JSON from response
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    // Fallback to rule-based
    return {
      id: resultValue.id,
      parameter: resultValue.parameter,
      flag: determineRuleBasedFlag(resultValue, patient),
      flag_confidence: 0.7,
      interpretation: 'AI interpretation unavailable, using rule-based flag',
    };
  }
  
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    
    return {
      id: resultValue.id,
      parameter: resultValue.parameter,
      flag: parsed.flag || determineRuleBasedFlag(resultValue, patient),
      flag_confidence: parsed.confidence || 0.85,
      interpretation: parsed.interpretation || '',
      clinical_significance: parsed.clinical_significance,
      suggested_action: parsed.suggested_action,
    };
  } catch (parseError) {
    return {
      id: resultValue.id,
      parameter: resultValue.parameter,
      flag: determineRuleBasedFlag(resultValue, patient),
      flag_confidence: 0.7,
      interpretation: 'AI response parsing failed',
    };
  }
}

function buildBatchPrompt(
  resultValues: ResultValueInput[],
  patient?: PatientContext,
  testGroupName?: string
): string {
  const patientInfo = patient 
    ? `Patient: ${patient.gender || 'Unknown'} gender, ${patient.age || 'Unknown'} years old.${patient.clinical_notes ? ` Notes: ${patient.clinical_notes}` : ''}`
    : 'No patient context provided.';

  const results = resultValues.map(rv => 
    `- ${rv.parameter}: ${rv.value} ${rv.unit || ''} (Ref: ${rv.reference_range || 'N/A'}${rv.low_critical ? `, Critical Low: ${rv.low_critical}` : ''}${rv.high_critical ? `, Critical High: ${rv.high_critical}` : ''})`
  ).join('\n');

  return `You are a clinical laboratory AI assistant. Analyze these lab results and determine flags.

${testGroupName ? `Test Panel: ${testGroupName}` : ''}
${patientInfo}

Results to analyze:
${results}

For each result, determine:
1. flag: "normal", "high", "low", "critical_high", "critical_low", or "abnormal" (for qualitative)
2. confidence: 0-1 score
3. interpretation: A short, NEUTRAL, factual observation about the result value relative to the reference range (1 sentence max)
4. clinical_significance: "routine", "attention", "urgent", or "critical"
5. suggested_action: Any recommended follow-up (optional)

Respond with a JSON array in this exact format:
[
  {
    "flag": "high",
    "confidence": 0.95,
    "interpretation": "Value is above the reference range.",
    "clinical_significance": "attention",
    "suggested_action": "Correlate with clinical findings"
  }
]

CRITICAL RULES for interpretation text:
- NEVER suggest, name, or imply specific diseases, conditions, or diagnoses (e.g. do NOT say "malnutrition", "liver disease", "atherosclerosis", "malignancy", "diabetes", "infection")
- NEVER use phrases like "may indicate", "suggests", "risk of", "consistent with", or "potential" followed by a disease name
- ONLY describe the observed value relative to the reference range in neutral, objective language
- Good examples: "Value is within normal limits.", "Result is above the upper reference limit.", "Value is below the expected range.", "Mildly elevated compared to reference range.", "Result is at the upper boundary of normal."
- Diagnosis and clinical correlation is the physician's responsibility, NOT the lab report's
- Use gender-specific reference ranges when applicable
- Flag critical values appropriately
- For qualitative tests (Positive/Negative), use "abnormal" for positive findings
- Be concise and factual`;
}

function buildSinglePrompt(resultValue: ResultValueInput, patient?: PatientContext): string {
  const patientInfo = patient 
    ? `Patient: ${patient.gender || 'Unknown'} gender, ${patient.age || 'Unknown'} years old.`
    : '';

  const refRange = patient?.gender?.toLowerCase() === 'male' && resultValue.reference_range_male
    ? resultValue.reference_range_male
    : patient?.gender?.toLowerCase() === 'female' && resultValue.reference_range_female
    ? resultValue.reference_range_female
    : resultValue.reference_range;

  return `Analyze this single lab result:

${patientInfo}

Parameter: ${resultValue.parameter}
Value: ${resultValue.value} ${resultValue.unit || ''}
Reference Range: ${refRange || 'Not specified'}
${resultValue.low_critical ? `Critical Low: ${resultValue.low_critical}` : ''}
${resultValue.high_critical ? `Critical High: ${resultValue.high_critical}` : ''}
${resultValue.current_flag ? `Current Flag: ${resultValue.current_flag}` : ''}

Respond with JSON:
{
  "flag": "normal|high|low|critical_high|critical_low|abnormal",
  "confidence": 0.0-1.0,
  "interpretation": "Short neutral factual observation about value vs reference range. NEVER suggest or name specific diseases or conditions.",
  "clinical_significance": "routine|attention|urgent|critical",
  "suggested_action": "Optional follow-up recommendation"
}`;
}

// Fallback rule-based flag determination
function determineRuleBasedFlag(rv: ResultValueInput, patient?: PatientContext): string | null {
  if (!rv.value) return null;
  
  const refRange = patient?.gender?.toLowerCase() === 'male' && rv.reference_range_male
    ? rv.reference_range_male
    : patient?.gender?.toLowerCase() === 'female' && rv.reference_range_female
    ? rv.reference_range_female
    : rv.reference_range;

  if (!refRange) return null;

  const numValue = parseFloat(rv.value);
  
  if (isNaN(numValue)) {
    // Text-based
    const valLower = rv.value.toLowerCase().trim();
    if (['positive', 'reactive', 'detected', 'present'].includes(valLower)) return 'abnormal';
    if (['negative', 'non-reactive', 'not detected', 'absent', 'normal'].includes(valLower)) return 'normal';
    return null;
  }

  // Check critical values first
  if (rv.low_critical && numValue <= parseFloat(rv.low_critical)) return 'critical_low';
  if (rv.high_critical && numValue >= parseFloat(rv.high_critical)) return 'critical_high';

  // Parse range
  const rangeMatch = refRange.match(/([\d.]+)\s*[-–]\s*([\d.]+)/);
  if (rangeMatch) {
    const low = parseFloat(rangeMatch[1]);
    const high = parseFloat(rangeMatch[2]);
    if (numValue < low) return 'low';
    if (numValue > high) return 'high';
    return 'normal';
  }

  // Less than pattern
  const ltMatch = refRange.match(/[<≤]\s*([\d.]+)/);
  if (ltMatch) {
    return numValue <= parseFloat(ltMatch[1]) ? 'normal' : 'high';
  }

  // Greater than pattern
  const gtMatch = refRange.match(/[>≥]\s*([\d.]+)/);
  if (gtMatch) {
    return numValue >= parseFloat(gtMatch[1]) ? 'normal' : 'low';
  }

  return null;
}

export { handler };
