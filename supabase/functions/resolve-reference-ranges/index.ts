import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface ResolveRequest {
  orderId: string;
  testGroupId: string;
  analytes: Array<{
    id: string;
    name: string;
    value: string;
    unit: string;
  }>;
}

interface ReferenceRangeResult {
  analyte_id: string;
  analyte_name: string;
  ref_low: number | null;
  ref_high: number | null;
  critical_low: number | null;
  critical_high: number | null;
  flag: 'N' | 'L' | 'H' | 'LL' | 'HH' | null;
  used_reference_range: string;
  applied_rule: string;
  reasoning: string;
  confidence: number;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { orderId, testGroupId, analytes }: ResolveRequest = await req.json()
    
    // Create Supabase Client (Service Role for data access)
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    console.log(`Resolving ranges for Order: ${orderId}, TestGroup: ${testGroupId}`);

    // 1. Fetch order with patient context (Fallback to patient record if context missing)
    // 1. Fetch order with patient context (Fallback to patient record if context missing)
    const { data: order } = await supabase
      .from('orders')
      .select('patient_context, patient_id, lab_id')
      .eq('id', orderId)
      .single()

    if (!order) throw new Error('Order not found');

    let patientContext = order.patient_context;

    // Fallback: Build context from Patients table if missing in Order (Legacy support / Manual Migration)
    if (!patientContext || Object.keys(patientContext).length === 0) {
       console.log('Patient context missing on order, buidling from patient record...');
       const { data: patient } = await supabase.from('patients').select('*').eq('id', order.patient_id).single();
       if (patient) {
          const calculateAgeInDays = (p: any) => {
            if (p.dob || p.date_of_birth) { // Check dob or date_of_birth
               const d = new Date(p.dob || p.date_of_birth);
               const diff = new Date().getTime() - d.getTime();
               return Math.floor(diff / (1000 * 60 * 60 * 24));
            }
            const unit = p.age_unit || 'years';
            if (unit === 'years') return p.age * 365;
            if (unit === 'months') return p.age * 30;
            return p.age; // days
          };

          const ageInDays = calculateAgeInDays(patient);
          
          patientContext = {
             age: patient.age,
             age_unit: patient.age_unit || 'years',
             age_in_days: ageInDays,
             age_in_months: Math.floor(ageInDays / 30),
             gender: patient.gender,
             conditions: patient.conditions || [], 
             pregnancy: patient.pregnancy_status || null,
             medications: patient.medications || [],
             bmi: patient.bmi || null,
             ethnicity: patient.ethnicity || null
          };
       }
    }

    // 2. Fetch test group AI config
    const { data: testGroup } = await supabase
      .from('test_groups')
      .select('ref_range_ai_config')
      .eq('id', testGroupId)
      .single()

    // 3. Fetch analyte knowledge bases
    const analyteIds = analytes.map(a => a.id)
    const { data: analyteData } = await supabase
      .from('analytes')
      .select('id, name, ref_range_knowledge, reference_range, unit')
      .in('id', analyteIds)

    // 3b. Fetch lab specific overrides
    let labOverridesMap: Record<string, any> = {};
    if (order.lab_id) {
      const { data: labAnalytes } = await supabase
        .from('lab_analytes')
        .select('analyte_id, ref_range_knowledge')
        .eq('lab_id', order.lab_id)
        .in('analyte_id', analyteIds);
      
      if (labAnalytes) {
        labOverridesMap = Object.fromEntries(
          labAnalytes.map((la: any) => [la.analyte_id, la.ref_range_knowledge])
        );
      }
    }

    // Merge knowledge
    const mergedAnalyteKnowledge = (analyteData || []).map((a: any) => ({
      ...a,
      ref_range_knowledge: labOverridesMap[a.id] && Object.keys(labOverridesMap[a.id]).length > 0
        ? labOverridesMap[a.id] 
        : a.ref_range_knowledge
    }));

    // 4. Build AI prompt
    const prompt = buildReferenceRangePrompt(
      patientContext || {},
      testGroup?.ref_range_ai_config || {},
      mergedAnalyteKnowledge,
      analytes
    )

    // 5. Call Gemini AI
    // 5. Call Anthropic Claude 3.5 Haiku
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!anthropicKey) throw new Error('ANTHROPIC_API_KEY not set');

    console.log('Calling Anthropic Claude 3.5 Haiku...');
    const aiResponse = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'x-api-key': anthropicKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json'
        },
        body: JSON.stringify({
            model: 'claude-3-5-haiku-latest', // or specifically claude-3-5-haiku-20241022
            max_tokens: 2000,
            messages: [{ role: 'user', content: prompt }]
        })
    });

    if (!aiResponse.ok) {
        const errText = await aiResponse.text();
        throw new Error(`Anthropic API Error: ${aiResponse.status} ${errText}`);
    }

    const aiData = await aiResponse.json()
    
    if (!aiData.content || !aiData.content[0] || !aiData.content[0].text) {
        throw new Error('Invalid AI Response format');
    }

    const cleanJson = (text: string) => {
      // Robust JSON extraction
      const start = text.indexOf('[');
      const end = text.lastIndexOf(']');
      if (start !== -1 && end !== -1) {
          return text.substring(start, end + 1);
      }
      return text.replace(/```json/g, '').replace(/```/g, '').trim();
    };

    const responseText = aiData.content[0].text;
    const results: ReferenceRangeResult[] = JSON.parse(cleanJson(responseText));

    // 6. Log AI decision for audit
    await supabase.from('ai_usage_logs').insert({
      processing_type: 'reference_range_resolution',
      input_data: { orderId, testGroupId, patient_context: patientContext },
      confidence: results[0]?.confidence || 0,
      created_at: new Date().toISOString()
    })

    return new Response(
      JSON.stringify({ success: true, results }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error in resolve-reference-ranges:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

function buildReferenceRangePrompt(
  patientContext: any,
  testGroupConfig: any,
  analyteKnowledge: any[],
  analyteValues: any[]
): string {
  return `You are a clinical laboratory AI assistant. Determine appropriate reference ranges and flags for the following test results.

PATIENT CONTEXT:
${JSON.stringify(patientContext, null, 2)}

TEST GROUP CONFIGURATION:
${JSON.stringify(testGroupConfig, null, 2)}

ANALYTE KNOWLEDGE BASE:
${analyteKnowledge.map(a => `
${a.name}:
- Default Range: ${a.reference_range}
- Unit: ${a.unit}
- Knowledge: ${JSON.stringify(a.ref_range_knowledge, null, 2)}
`).join('\n')}

TEST RESULTS TO EVALUATE:
${analyteValues.map(a => `
- ${a.name}: ${a.value} ${a.unit}
`).join('\n')}

INSTRUCTIONS:
1. For each analyte, determine the most appropriate reference range based on:
   - Patient age (consider pediatric in months/days, adult, geriatric ranges)
   - Patient gender
   - Patient conditions (pregnancy, lactation, chronic diseases)
   - Test group specific overrides (if any)

2. Apply flags:
   - N (Normal): Within reference range
   - L (Low): Below reference range but above critical
   - H (High): Above reference range but below critical
   - LL (Critical Low): Below critical low threshold
   - HH (Critical High): Above critical high threshold

3. For pregnant patients:
   - Use trimester-specific ranges when available
   - Consider physiological changes during pregnancy

4. For pediatric patients:
   - Use age-specific ranges (newborn, infant, child)
   - Consider developmental stage by AGE IN MONTHS/DAYS provided in context.

6. Determine the specific "used_reference_range" string.
   - This should be the exact text representation of the applied range (e.g., "13.5 - 17.5" or "< 200" or "Negative").
   - This string will be displayed on the final report, so ensure it is user-friendly and accurate.

Return JSON array with this structure:
[{
  "analyte_id": "uuid (match from input)",
  "analyte_name": "string",
  "ref_low": number | null,
  "ref_high": number | null,
  "critical_low": number | null,
  "critical_high": number | null,
  "used_reference_range": "string (e.g. '10-20' or '< 50')",
  "flag": "N" | "L" | "H" | "LL" | "HH" | null,
  "applied_rule": "string (e.g., 'Pregnant Trimester 2', 'Adult Female', 'Pediatric 5y')",
  "reasoning": "string (brief clinical reasoning)",
  "confidence": number (0-1)
}]`;
}
