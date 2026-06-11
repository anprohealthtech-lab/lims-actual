import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-service-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface ResolveRequest {
  orderId: string;
  testGroupId: string;
  analytes: Array<{
    id: string;
    lab_analyte_id?: string | null;
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
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const supabase = createClient(supabaseUrl, serviceRoleKey!)
    const internalServiceKey = req.headers.get('x-internal-service-key')
    const authorization = req.headers.get('authorization') || ''
    const bearerToken = authorization.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : ''
    const hasInternalAccess = Boolean(
      serviceRoleKey && (
        internalServiceKey === serviceRoleKey ||
        authorization === `Bearer ${serviceRoleKey}`
      )
    )
    let hasAuthenticatedUser = false

    if (!hasInternalAccess && bearerToken) {
      const { data: authData } = await supabase.auth.getUser(bearerToken)
      hasAuthenticatedUser = Boolean(authData.user)
    }

    if (!hasInternalAccess && !hasAuthenticatedUser) {
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { orderId, testGroupId, analytes }: ResolveRequest = await req.json()

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
    const analyteIds = [...new Set(analytes.map(a => a.id))]
    const { data: analyteData } = await supabase
      .from('analytes')
      .select('id, name, ref_range_knowledge, reference_range, unit')
      .in('id', analyteIds)

    // 3b. Fetch exact lab-specific rows when the caller supplies lab_analyte_id.
    // Fall back to lab_id + analyte_id only for legacy/manual callers.
    const exactLabAnalyteIds = [...new Set(
      analytes.map(a => a.lab_analyte_id).filter(Boolean) as string[]
    )]
    const exactLabAnalytesMap = new Map<string, any>()
    const fallbackLabAnalytesMap = new Map<string, any>()

    if (order.lab_id) {
      if (exactLabAnalyteIds.length > 0) {
        const { data: exactRows } = await supabase
          .from('lab_analytes')
          .select('id, analyte_id, name, ref_range_knowledge, reference_range, lab_specific_reference_range, unit')
          .eq('lab_id', order.lab_id)
          .in('id', exactLabAnalyteIds)

        for (const row of exactRows || []) exactLabAnalytesMap.set(row.id, row)
      }

      const fallbackAnalyteIds = analytes
        .filter(a => !a.lab_analyte_id || !exactLabAnalytesMap.has(a.lab_analyte_id))
        .map(a => a.id)

      if (fallbackAnalyteIds.length > 0) {
        const { data: fallbackRows } = await supabase
          .from('lab_analytes')
          .select('id, analyte_id, name, ref_range_knowledge, reference_range, lab_specific_reference_range, unit')
          .eq('lab_id', order.lab_id)
          .in('analyte_id', [...new Set(fallbackAnalyteIds)])
          .order('created_at', { ascending: true })

        for (const row of fallbackRows || []) {
          if (!fallbackLabAnalytesMap.has(row.analyte_id)) {
            fallbackLabAnalytesMap.set(row.analyte_id, row)
          }
        }
      }
    }

    const globalAnalytesMap = new Map((analyteData || []).map((a: any) => [a.id, a]))
    const mergedAnalyteKnowledge = analytes.map((requested) => {
      const global = globalAnalytesMap.get(requested.id) as any
      const labAnalyte = requested.lab_analyte_id
        ? exactLabAnalytesMap.get(requested.lab_analyte_id)
        : fallbackLabAnalytesMap.get(requested.id)
      const labKnowledge = labAnalyte?.ref_range_knowledge
      const hasLabKnowledge = labKnowledge && typeof labKnowledge === 'object'
        ? Object.keys(labKnowledge).length > 0
        : Boolean(labKnowledge)

      return {
        id: requested.id,
        lab_analyte_id: labAnalyte?.id || requested.lab_analyte_id || null,
        name: labAnalyte?.name || global?.name || requested.name,
        unit: labAnalyte?.unit || global?.unit || requested.unit,
        reference_range:
          labAnalyte?.lab_specific_reference_range ||
          labAnalyte?.reference_range ||
          global?.reference_range ||
          null,
        ref_range_knowledge: hasLabKnowledge
          ? labKnowledge
          : global?.ref_range_knowledge,
      }
    })

    console.log('[ai-ref-range] lab_analyte_resolution', JSON.stringify({
      order_id: orderId,
      test_group_id: testGroupId,
      requested_exact_ids: exactLabAnalyteIds,
      exact_rows_found: exactLabAnalytesMap.size,
      fallback_rows_used: analytes.filter(a =>
        !a.lab_analyte_id || !exactLabAnalytesMap.has(a.lab_analyte_id)
      ).map(a => a.id),
    }))

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
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 15000,
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
    const message = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({ success: false, error: message }),
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
  const customPatientData = patientContext?.custom_patient_data;
  const customPatientDataSection = customPatientData && Object.keys(customPatientData).length > 0
    ? `\nCUSTOM PATIENT ATTRIBUTES (use these for species/breed/condition-specific ranges):\n${Object.entries(customPatientData).map(([k, v]) => `- ${k}: ${v}`).join('\n')}\n`
    : '';

  const considerExactAge = testGroupConfig?.consider_age === true;

  return `You are a clinical laboratory AI assistant. Determine appropriate reference ranges and flags for the following test results.

PATIENT CONTEXT:
${JSON.stringify({ ...patientContext, custom_patient_data: undefined }, null, 2)}${customPatientDataSection}
${considerExactAge ? 'NOTE: Use EXACT age in days/months (provided above) for pediatric range selection. Do NOT round to nearest year bracket.' : ''}

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
