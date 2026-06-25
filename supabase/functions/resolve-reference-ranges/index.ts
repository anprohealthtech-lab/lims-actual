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
  lab_analyte_id?: string | null;
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

interface RangeSelectionResult {
  analyte_id: string;
  lab_analyte_id?: string | null;
  analyte_name: string;
  used_reference_range: string;
  applied_rule?: string;
  confidence?: number;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const startedAt = Date.now()
    const mark = (label: string, extra: Record<string, unknown> = {}) => {
      console.log('[resolve-reference-ranges:timing]', JSON.stringify({
        label,
        elapsed_ms: Date.now() - startedAt,
        ...extra,
      }))
    }

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
    mark('request_parsed', { analyte_count: analytes?.length || 0 })

    // 1. Fetch order with patient context (Fallback to patient record if context missing)
    // 1. Fetch order with patient context (Fallback to patient record if context missing)
    const { data: order } = await supabase
      .from('orders')
      .select('patient_context, patient_id, lab_id')
      .eq('id', orderId)
      .single()

    if (!order) throw new Error('Order not found');
    mark('order_loaded')

    let patientContext = order.patient_context || {};

    const { data: patient } = order.patient_id
      ? await supabase.from('patients').select('*').eq('id', order.patient_id).maybeSingle()
      : { data: null };

    if (patient) {
      const calculateAgeInDays = (p: any) => {
        if (p.dob || p.date_of_birth) {
          const d = new Date(p.dob || p.date_of_birth);
          const diff = new Date().getTime() - d.getTime();
          return Math.floor(diff / (1000 * 60 * 60 * 24));
        }
        const age = Number(p.age);
        if (!Number.isFinite(age)) return null;
        const unit = p.age_unit || 'years';
        if (unit === 'years') return age * 365;
        if (unit === 'months') return age * 30;
        return age;
      };

      const ageInDays = calculateAgeInDays(patient);
      patientContext = {
        age: patientContext.age ?? patient.age,
        age_unit: patientContext.age_unit ?? patient.age_unit ?? 'years',
        ...(ageInDays !== null ? {
          age_in_days: patientContext.age_in_days ?? ageInDays,
          age_in_months: patientContext.age_in_months ?? Math.floor(ageInDays / 30),
        } : {}),
        gender: patientContext.gender ?? patient.gender,
        date_of_birth: patientContext.date_of_birth ?? patient.dob ?? patient.date_of_birth ?? null,
        conditions: patientContext.conditions ?? patient.conditions ?? [],
        pregnancy: patientContext.pregnancy ?? patient.pregnancy_status ?? null,
        medications: patientContext.medications ?? patient.medications ?? [],
        bmi: patientContext.bmi ?? patient.bmi ?? null,
        ethnicity: patientContext.ethnicity ?? patient.ethnicity ?? null,
        additional_inputs: patientContext.additional_inputs ?? {},
        ...patientContext,
      };

      const { data: aiPatientFields } = await supabase
        .from('lab_patient_field_configs')
        .select('field_key, label')
        .eq('lab_id', order.lab_id)
        .eq('use_for_ai_ref_range', true)
        .order('sort_order', { ascending: true });

      const customFields = parseJsonObject(patient.custom_fields);
      const configuredCustomData: Record<string, unknown> = {};
      for (const field of aiPatientFields || []) {
        const value = customFields[field.field_key];
        if (value !== undefined && value !== null && String(value).trim() !== '') {
          configuredCustomData[field.label || field.field_key] = value;
        }
      }

      patientContext.custom_patient_data = {
        ...(parseJsonObject(patientContext.custom_patient_data)),
        ...configuredCustomData,
      };

      if (Object.keys(patientContext.custom_patient_data).length === 0) {
        delete patientContext.custom_patient_data;
      }
    }
    mark('patient_context_ready')

    // 2. Fetch test group AI config
    const { data: testGroup } = await supabase
      .from('test_groups')
      .select('ref_range_ai_config')
      .eq('id', testGroupId)
      .single()
    mark('test_group_loaded')

    // 3. Resolve the exact lab_analyte rows attached to this test group.
    // The same global analyte_id can exist in multiple lab-specific rows; never
    // choose a lab_analyte only by analyte_id.
    const analyteIds = [...new Set(analytes.map(a => a.id))]
    const { data: tgaRows } = await supabase
      .from('test_group_analytes')
      .select('analyte_id, lab_analyte_id')
      .eq('test_group_id', testGroupId)
      .in('analyte_id', analyteIds)

    const attachedLabAnalyteByAnalyteId = new Map<string, string>()
    for (const row of tgaRows || []) {
      if (row.analyte_id && row.lab_analyte_id && !attachedLabAnalyteByAnalyteId.has(row.analyte_id)) {
        attachedLabAnalyteByAnalyteId.set(row.analyte_id, row.lab_analyte_id)
      }
    }

    const resolvedRequests = analytes.map(a => ({
      ...a,
      lab_analyte_id: a.lab_analyte_id || attachedLabAnalyteByAnalyteId.get(a.id) || null,
    }))

    const exactLabAnalyteIds = [...new Set(
      resolvedRequests.map(a => a.lab_analyte_id).filter(Boolean) as string[]
    )]
    const exactLabAnalytesMap = new Map<string, any>()

    if (order.lab_id && exactLabAnalyteIds.length > 0) {
      const { data: exactRows } = await supabase
        .from('lab_analytes')
        .select('id, analyte_id, name, ref_range_knowledge, reference_range, lab_specific_reference_range, unit')
        .eq('lab_id', order.lab_id)
        .in('id', exactLabAnalyteIds)

      for (const row of exactRows || []) exactLabAnalytesMap.set(row.id, row)
    }

    mark('lab_analytes_loaded', {
      attached_rows_found: attachedLabAnalyteByAnalyteId.size,
      exact_rows_found: exactLabAnalytesMap.size,
    })

    const mergedAnalyteKnowledge = resolvedRequests.map((requested) => {
      const labAnalyte = requested.lab_analyte_id
        ? exactLabAnalytesMap.get(requested.lab_analyte_id)
        : null
      const labKnowledge = labAnalyte?.ref_range_knowledge

      return {
        id: requested.id,
        lab_analyte_id: labAnalyte?.id || requested.lab_analyte_id || null,
        name: labAnalyte?.name || requested.name,
        unit: labAnalyte?.unit || requested.unit,
        reference_range:
          labAnalyte?.lab_specific_reference_range ||
          labAnalyte?.reference_range ||
          null,
        ref_range_knowledge: labKnowledge || null,
      }
    })

    console.log('[ai-ref-range] lab_analyte_resolution', JSON.stringify({
      order_id: orderId,
      test_group_id: testGroupId,
      requested_exact_ids: exactLabAnalyteIds,
      attached_rows_found: attachedLabAnalyteByAnalyteId.size,
      exact_rows_found: exactLabAnalytesMap.size,
      unresolved_analyte_ids: mergedAnalyteKnowledge
        .filter(a => !a.lab_analyte_id)
        .map(a => a.id),
    }))

    const deterministicResults = resolveStructuredKnowledgeRanges(mergedAnalyteKnowledge, patientContext)
    if (deterministicResults.length > 0) {
      mark('structured_ranges_resolved', { result_count: deterministicResults.length })
      const results = deterministicResults.map(toReferenceRangeResult)

      await supabase.from('ai_usage_logs').insert({
        processing_type: 'reference_range_resolution',
        input_data: { orderId, testGroupId, patient_context: patientContext, mode: 'structured_knowledge' },
        confidence: results[0]?.confidence || 0,
        created_at: new Date().toISOString()
      })
      mark('audit_logged')

      return new Response(
        JSON.stringify({ success: true, results }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 4. Build AI prompt
    const prompt = buildReferenceRangePrompt(
      patientContext || {},
      testGroup?.ref_range_ai_config || {},
      mergedAnalyteKnowledge,
      resolvedRequests
    )

    // 5. Call Anthropic only for unstructured/ambiguous reference range rules.
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!anthropicKey) throw new Error('ANTHROPIC_API_KEY not set');

    console.log('Calling Anthropic Claude Haiku 4.5 for reference range selection...');
    const aiStartedAt = Date.now()
    const aiResponse = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'x-api-key': anthropicKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json'
        },
        body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: Math.min(5000, Math.max(1500, analytes.length * 180)),
            messages: [{ role: 'user', content: prompt }]
        })
    });
    mark('anthropic_response_received', {
      status: aiResponse.status,
      ai_elapsed_ms: Date.now() - aiStartedAt,
    })

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
    const rawSelections: RangeSelectionResult[] = JSON.parse(cleanJson(responseText));
    const normalizeName = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
    const results = rawSelections.map((selection) => {
      const result = toReferenceRangeResult(selection);
      if (result.lab_analyte_id) return result;
      const matchedInput =
        resolvedRequests.find((a) => a.id === result.analyte_id && a.lab_analyte_id) ||
        resolvedRequests.find((a) => normalizeName(a.name) === normalizeName(result.analyte_name || '') && a.lab_analyte_id);
      return {
        ...result,
        lab_analyte_id: matchedInput?.lab_analyte_id || null,
      };
    });
    mark('ai_json_parsed', { result_count: results.length })

    // 6. Log AI decision for audit
    await supabase.from('ai_usage_logs').insert({
      processing_type: 'reference_range_resolution',
      input_data: { orderId, testGroupId, patient_context: patientContext },
      confidence: results[0]?.confidence || 0,
      created_at: new Date().toISOString()
    })
    mark('audit_logged')

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

function parseJsonObject(value: unknown): Record<string, any> {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, any>;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, any>
      : {};
  } catch {
    return {};
  }
}

function normalizeKey(value: unknown): string {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function collectPatientContextValues(patientContext: any): string[] {
  const values: string[] = [];
  const customData = parseJsonObject(patientContext?.custom_patient_data);
  const additionalInputs = parseJsonObject(patientContext?.additional_inputs);

  for (const key of ['species', 'animal', 'breed']) {
    if (patientContext?.[key]) values.push(String(patientContext[key]));
    if (additionalInputs[key]) values.push(String(additionalInputs[key]));
  }

  for (const [key, value] of Object.entries(customData)) {
    const normalizedKey = normalizeKey(key);
    if (
      normalizedKey.includes('species') ||
      normalizedKey.includes('animal') ||
      normalizedKey.includes('breed')
    ) {
      values.push(String(value));
    }
  }

  return [...new Set(values.map(v => v.trim()).filter(Boolean))];
}

function resolveStructuredKnowledgeRanges(
  analyteKnowledge: any[],
  patientContext: any,
): RangeSelectionResult[] {
  const contextValues = collectPatientContextValues(patientContext);
  const normalizedContextValues = contextValues.map(normalizeKey).filter(Boolean);
  const results: RangeSelectionResult[] = [];

  for (const analyte of analyteKnowledge) {
    const knowledge = parseJsonObject(analyte.ref_range_knowledge);
    const matchedEntry = normalizedContextValues.length > 0
      ? Object.entries(knowledge).find(([key, value]) => {
        if (value === null || value === undefined || typeof value === 'object') return false;
        const normalizedKey = normalizeKey(key);
        return normalizedContextValues.some(context =>
          context === normalizedKey ||
          context.includes(normalizedKey) ||
          normalizedKey.includes(context)
        );
      })
      : null;

    const selectedRange = matchedEntry?.[1] ?? analyte.reference_range;
    if (selectedRange === null || selectedRange === undefined || String(selectedRange).trim() === '') {
      continue;
    }

    results.push({
      analyte_id: analyte.id,
      lab_analyte_id: analyte.lab_analyte_id || null,
      analyte_name: analyte.name,
      used_reference_range: String(selectedRange).trim(),
      applied_rule: matchedEntry ? String(matchedEntry[0]) : 'Lab Range',
      confidence: matchedEntry ? 1 : 0.7,
    });
  }

  return results;
}

function toReferenceRangeResult(selection: RangeSelectionResult): ReferenceRangeResult {
  return {
    analyte_id: selection.analyte_id,
    lab_analyte_id: selection.lab_analyte_id || null,
    analyte_name: selection.analyte_name,
    ref_low: null,
    ref_high: null,
    critical_low: null,
    critical_high: null,
    flag: null,
    used_reference_range: selection.used_reference_range,
    applied_rule: selection.applied_rule || 'AI reference range selection',
    reasoning: '',
    confidence: selection.confidence ?? 0.8,
  };
}

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

  return `You are a clinical laboratory AI assistant. Select the correct reference range for each lab analyte.

PATIENT CONTEXT:
${JSON.stringify({ ...patientContext, custom_patient_data: undefined }, null, 2)}${customPatientDataSection}
${considerExactAge ? 'NOTE: Use EXACT age in days/months (provided above) for pediatric range selection. Do NOT round to nearest year bracket.' : ''}

LAB ANALYTE RANGE RULES:
${analyteKnowledge.map(a => `
${a.name}:
- Lab Range: ${a.reference_range}
- Unit: ${a.unit}
- Knowledge: ${JSON.stringify(a.ref_range_knowledge, null, 2)}
`).join('\n')}

LAB ANALYTES TO RESOLVE:
${analyteValues.map(a => `
- ${a.name}
  analyte_id: ${a.id}
  lab_analyte_id: ${a.lab_analyte_id || 'null'}
`).join('\n')}

INSTRUCTIONS:
1. For each lab analyte, return only the best reference range string based on:
   - Patient age (consider pediatric in months/days, adult, geriatric ranges)
   - Patient gender
   - Custom patient attributes such as species and breed
   - Patient conditions (pregnancy, lactation, chronic diseases)
   - The provided lab analyte range rules
2. Do not calculate flags, interpretations, critical ranges, or numeric parsing.
3. Preserve the selected range text exactly as a report-friendly string.
4. If no rule applies, return the Lab Range.

Return JSON array with this structure:
[{
  "analyte_id": "uuid (match from input)",
  "lab_analyte_id": "uuid or null (match from input)",
  "analyte_name": "string",
  "used_reference_range": "string (e.g. '10-20' or '< 50')",
  "applied_rule": "string",
  "confidence": number (0-1)
}]`;
}
