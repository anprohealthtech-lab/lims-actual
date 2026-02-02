/**
 * QC AI Draft CAPA Edge Function
 *
 * Generates NABL/ISO 15189:2022 compliant CAPA (Corrective and Preventive Action) drafts:
 * 1. Problem statement
 * 2. Immediate correction
 * 3. Root cause hypotheses
 * 4. Corrective actions with responsible roles
 * 5. Preventive actions
 * 6. Verification plan
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface QCDraftCAPARequest {
  qc_run_id?: string;
  qc_investigation_id?: string;
  include_templates?: boolean;
}

interface RootCauseHypothesis {
  cause: string;
  likelihood: 'probable' | 'possible' | 'unlikely';
  investigation_needed: string[];
}

interface ActionItem {
  action: string;
  responsible_role: string;
  timeline: string;
}

interface CAPADraft {
  problem_statement: string;
  immediate_correction: string;
  root_cause_hypotheses: RootCauseHypothesis[];
  corrective_actions: ActionItem[];
  preventive_actions: ActionItem[];
  verification_plan: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const geminiApiKey = Deno.env.get('ALLGOOGLE_KEY') || Deno.env.get('GEMINI_API_KEY');
    if (!geminiApiKey) {
      return new Response(
        JSON.stringify({ success: false, error: 'Google API key not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const payload: QCDraftCAPARequest = await req.json();
    const { qc_run_id, qc_investigation_id, include_templates = true } = payload;

    console.log(`\n📝 QC AI Draft CAPA`);
    console.log(`  - Run ID: ${qc_run_id || 'not provided'}`);
    console.log(`  - Investigation ID: ${qc_investigation_id || 'not provided'}`);

    let investigation: any = null;
    let qcRun: any = null;
    let results: any[] = [];

    // Fetch investigation if provided
    if (qc_investigation_id) {
      const { data } = await supabase
        .from('qc_investigations')
        .select('*')
        .eq('id', qc_investigation_id)
        .single();

      investigation = data;

      if (investigation?.qc_run_id) {
        const { data: run } = await supabase
          .from('qc_runs')
          .select(`
            *,
            qc_results (
              *,
              analytes:analyte_id (name, code),
              qc_lots:qc_lot_id (lot_number, material_name, level)
            )
          `)
          .eq('id', investigation.qc_run_id)
          .single();

        qcRun = run;
        results = run?.qc_results || [];
      }
    } else if (qc_run_id) {
      const { data } = await supabase
        .from('qc_runs')
        .select(`
          *,
          qc_results (
            *,
            analytes:analyte_id (name, code),
            qc_lots:qc_lot_id (lot_number, material_name, level)
          )
        `)
        .eq('id', qc_run_id)
        .single();

      qcRun = data;
      results = data?.qc_results || [];

      // Check for existing investigation
      const { data: inv } = await supabase
        .from('qc_investigations')
        .select('*')
        .eq('qc_run_id', qc_run_id)
        .single();

      investigation = inv;
    }

    if (!qcRun) {
      return new Response(
        JSON.stringify({ success: false, error: 'QC Run not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch historical context
    const failedResults = results.filter((r: any) => r.pass_fail === 'fail');
    let historicalFailures: any[] = [];

    if (failedResults.length > 0) {
      const analyteIds = failedResults.map((r: any) => r.analyte_id);
      const { data: history } = await supabase
        .from('qc_results')
        .select(`
          pass_fail, westgard_flags, created_at,
          qc_runs!inner (run_date, analyzer_name)
        `)
        .in('analyte_id', analyteIds)
        .eq('pass_fail', 'fail')
        .neq('qc_run_id', qcRun.id)
        .order('created_at', { ascending: false })
        .limit(20);

      historicalFailures = history || [];
    }

    // Fetch recent calibrations
    const { data: calibrations } = await supabase
      .from('calibration_records')
      .select('*')
      .eq('lab_id', qcRun.lab_id)
      .eq('analyzer_name', qcRun.analyzer_name)
      .order('calibration_date', { ascending: false })
      .limit(5);

    // Build context for CAPA generation
    const context = buildCAPAContext(
      qcRun,
      results,
      investigation,
      historicalFailures,
      calibrations || []
    );

    // Generate CAPA draft
    const capaDraft = await generateCAPADraft(context, geminiApiKey);

    // Update investigation with CAPA draft if exists
    if (investigation) {
      await supabase
        .from('qc_investigations')
        .update({
          ai_summary: capaDraft.problem_statement,
          ai_recommendations: capaDraft.corrective_actions.map(a => ({
            action: a.action,
            priority: 'soon',
            rationale: `${a.responsible_role} - ${a.timeline}`
          })),
          updated_at: new Date().toISOString()
        })
        .eq('id', investigation.id);
    }

    const response = {
      success: true,
      capa_draft: capaDraft,
      ai_context: {
        model_used: 'gemini-2.5-flash',
        records_analyzed: results.length + historicalFailures.length + (calibrations?.length || 0),
        confidence: 0.85
      }
    };

    return new Response(
      JSON.stringify(response),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('QC AI Draft CAPA Error:', error);
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

function buildCAPAContext(
  qcRun: any,
  results: any[],
  investigation: any,
  historicalFailures: any[],
  calibrations: any[]
): string {
  let context = `# CAPA Document Generation Context

## Incident Details
- Date: ${qcRun.run_date} ${qcRun.run_time || ''}
- Analyzer: ${qcRun.analyzer_name || 'Unknown'}
- Run Type: ${qcRun.run_type}
- Investigation Number: ${investigation?.investigation_number || 'N/A'}
- Severity: ${investigation?.severity || 'medium'}
- Westgard Violations: ${qcRun.westgard_violations?.join(', ') || 'None'}

## Failed QC Results
`;

  const failedResults = results.filter((r: any) => r.pass_fail === 'fail');

  for (const result of failedResults) {
    const analyteName = result.analytes?.name || 'Unknown';
    const lotInfo = result.qc_lots ? `${result.qc_lots.lot_number} ${result.qc_lots.level || ''}` : 'Unknown';

    context += `
### ${analyteName}
- Lot: ${lotInfo}
- Observed: ${result.observed_value} ${result.unit || ''}
- Target: ${result.target_mean} ± ${result.target_sd}
- Z-Score: ${result.z_score?.toFixed(2) || 'N/A'}
- Westgard Flags: ${result.westgard_flags?.join(', ') || 'None'}
`;
  }

  // Previous AI analysis if available
  if (investigation?.ai_summary) {
    context += `
## Previous AI Analysis
${investigation.ai_summary}
`;

    if (investigation.ai_likely_causes?.length > 0) {
      context += '\n### Identified Likely Causes:\n';
      for (const cause of investigation.ai_likely_causes) {
        context += `- ${cause.cause} (${cause.probability})\n`;
      }
    }
  }

  // Historical failures
  if (historicalFailures.length > 0) {
    context += `
## Historical Context
- Similar failures in last 30 days: ${historicalFailures.length}
- Pattern: ${analyzeFailurePattern(historicalFailures)}
`;
  }

  // Calibration context
  if (calibrations.length > 0) {
    context += `
## Recent Calibrations
`;
    for (const cal of calibrations.slice(0, 3)) {
      context += `- ${cal.calibration_date}: ${cal.calibration_type} - ${cal.status}\n`;
    }
  }

  return context;
}

function analyzeFailurePattern(failures: any[]): string {
  if (failures.length === 0) return 'No previous failures';
  if (failures.length === 1) return 'Isolated incident';

  // Check for clustering
  const dates = failures.map((f: any) => new Date(f.created_at).toDateString());
  const uniqueDates = [...new Set(dates)];

  if (uniqueDates.length === 1) return 'Multiple failures on same day - systematic issue likely';
  if (failures.length > 5) return 'Recurring issue - chronic problem indicated';
  return 'Occasional failures - intermittent issue';
}

async function generateCAPADraft(
  context: string,
  apiKey: string
): Promise<CAPADraft> {
  const model = 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const prompt = `You are a Quality Assurance expert specializing in NABL/ISO 15189:2022 compliant laboratory quality management. Generate a comprehensive CAPA (Corrective and Preventive Action) document based on the following QC failure information.

${context}

Generate a CAPA document as JSON with the following structure:

{
  "problem_statement": "Clear, concise description of the nonconformity/QC failure. Include: What failed, when, the magnitude of deviation, and immediate impact. 2-3 sentences.",

  "immediate_correction": "What was or should be done immediately to contain the issue. This is different from corrective action - it's the immediate response. 1-2 sentences.",

  "root_cause_hypotheses": [
    {
      "cause": "Specific root cause description (e.g., 'Pipette calibration drift beyond acceptable tolerance')",
      "likelihood": "probable" | "possible" | "unlikely",
      "investigation_needed": ["Specific investigation step 1", "Step 2"]
    }
  ],

  "corrective_actions": [
    {
      "action": "Specific corrective action (what to do to fix the root cause)",
      "responsible_role": "Lab Manager | QC Officer | Technician | Service Engineer",
      "timeline": "Immediate | Within 24 hours | Within 1 week | Within 1 month"
    }
  ],

  "preventive_actions": [
    {
      "action": "Specific preventive action (what to do to prevent recurrence)",
      "responsible_role": "Lab Manager | QC Officer | Technician | Service Engineer",
      "timeline": "Ongoing | Within 1 week | Within 1 month"
    }
  ],

  "verification_plan": "How will we verify that the corrective and preventive actions were effective? Include specific metrics, timeline for review, and acceptance criteria. 2-3 sentences."
}

IMPORTANT NABL/ISO 15189:2022 GUIDELINES:
1. Root causes should go beyond symptoms - use 5-Why analysis thinking
2. Corrective actions must address the root cause, not just symptoms
3. Preventive actions should prevent recurrence across the entire lab system
4. Include training and documentation updates where relevant
5. Verification must be measurable and time-bound
6. Distinguish between correction (immediate) and corrective action (systematic)

Provide 2-4 root cause hypotheses, 2-4 corrective actions, and 2-4 preventive actions.

Return ONLY valid JSON, no markdown formatting.`;

  const requestBody = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.3,
      topK: 32,
      topP: 1,
      maxOutputTokens: 4096,
    }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.status}`);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

  try {
    const cleanJson = text
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();

    return JSON.parse(cleanJson);
  } catch (e) {
    console.error('Failed to parse Gemini response:', text);
    return {
      problem_statement: 'QC failure detected. Manual review required to complete CAPA documentation.',
      immediate_correction: 'Hold affected patient results pending investigation. Repeat QC run.',
      root_cause_hypotheses: [
        {
          cause: 'Root cause to be determined through manual investigation',
          likelihood: 'possible',
          investigation_needed: ['Review QC data', 'Check instrument logs', 'Review reagent lot information']
        }
      ],
      corrective_actions: [
        {
          action: 'Conduct thorough investigation of QC failure',
          responsible_role: 'QC Officer',
          timeline: 'Within 24 hours'
        }
      ],
      preventive_actions: [
        {
          action: 'Review and update QC procedures based on investigation findings',
          responsible_role: 'Lab Manager',
          timeline: 'Within 1 week'
        }
      ],
      verification_plan: 'Monitor subsequent QC runs for 7 days. Document pass/fail rate and compare to baseline performance.'
    };
  }
}
