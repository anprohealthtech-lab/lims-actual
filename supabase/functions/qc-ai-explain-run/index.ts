/**
 * QC AI Explain Run Edge Function
 *
 * Analyzes QC failures and provides:
 * 1. Plain-language explanation of what went wrong
 * 2. Likely causes with probability rankings
 * 3. Recommended actions (tasks)
 * 4. Impact assessment for patient results
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface QCExplainRunRequest {
  qc_run_id: string;
  include_historical?: boolean;
  include_calibration?: boolean;
  historical_count?: number;
}

interface LikelyCause {
  cause: string;
  probability: 'high' | 'medium' | 'low';
  evidence: string[];
}

interface Recommendation {
  action: string;
  priority: 'immediate' | 'soon' | 'scheduled';
  rationale: string;
  task_type: string;
}

interface ImpactAssessment {
  affected_tests: string[];
  orders_to_hold: string[];
  recommendation: 'hold_results' | 'proceed_with_caution' | 'safe_to_release';
  reasoning: string;
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

    const payload: QCExplainRunRequest = await req.json();
    const {
      qc_run_id,
      include_historical = true,
      include_calibration = true,
      historical_count = 20
    } = payload;

    console.log(`\n🔍 QC AI Explain Run: ${qc_run_id}`);

    // Fetch the QC run with results
    const { data: qcRun, error: runError } = await supabase
      .from('qc_runs')
      .select(`
        *,
        qc_results (
          *,
          analytes:analyte_id (name, code),
          qc_lots:qc_lot_id (lot_number, material_name, level, manufacturer)
        )
      `)
      .eq('id', qc_run_id)
      .single();

    if (runError || !qcRun) {
      return new Response(
        JSON.stringify({ success: false, error: 'QC Run not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const labId = qcRun.lab_id;
    const results = qcRun.qc_results || [];
    const failedResults = results.filter((r: any) => r.pass_fail === 'fail');
    const warningResults = results.filter((r: any) => r.pass_fail === 'warning');

    console.log(`  - Total results: ${results.length}`);
    console.log(`  - Failed: ${failedResults.length}, Warnings: ${warningResults.length}`);

    // Gather historical data
    let historicalData: any[] = [];
    if (include_historical && results.length > 0) {
      // Get unique lot/analyte combinations
      const combinations = results.map((r: any) => ({
        lot_id: r.qc_lot_id,
        analyte_id: r.analyte_id
      }));

      // Fetch historical results for same lot/analyte
      for (const combo of combinations) {
        const { data: history } = await supabase
          .from('qc_results')
          .select(`
            observed_value, target_mean, target_sd, z_score, pass_fail,
            westgard_flags, created_at,
            qc_runs!inner (run_date, run_time, analyzer_name)
          `)
          .eq('qc_lot_id', combo.lot_id)
          .eq('analyte_id', combo.analyte_id)
          .neq('qc_run_id', qc_run_id)
          .order('created_at', { ascending: false })
          .limit(historical_count);

        if (history) {
          historicalData.push({
            lot_id: combo.lot_id,
            analyte_id: combo.analyte_id,
            history
          });
        }
      }
    }

    // Gather calibration data
    let calibrationData: any[] = [];
    if (include_calibration) {
      const analyteIds = results.map((r: any) => r.analyte_id).filter(Boolean);

      if (analyteIds.length > 0) {
        const { data: calibrations } = await supabase
          .from('calibration_records')
          .select('*')
          .eq('lab_id', labId)
          .eq('analyzer_name', qcRun.analyzer_name)
          .in('analyte_id', analyteIds)
          .order('calibration_date', { ascending: false })
          .limit(10);

        calibrationData = calibrations || [];
      }
    }

    // Find pending orders that might be affected
    const { data: pendingOrders } = await supabase
      .from('orders')
      .select('id, sample_id, patient:patients(name)')
      .eq('lab_id', labId)
      .gte('created_at', qcRun.run_date)
      .in('status', ['pending', 'in_progress', 'completed'])
      .limit(50);

    // Build context for AI analysis
    const context = buildAnalysisContext(qcRun, results, historicalData, calibrationData);

    // Call Gemini for analysis
    const analysis = await callGeminiAnalysis(context, geminiApiKey);

    // Store the AI analysis in the database (for audit trail)
    if (failedResults.length > 0 || warningResults.length > 0) {
      // Check if investigation already exists
      const { data: existingInv } = await supabase
        .from('qc_investigations')
        .select('id')
        .eq('qc_run_id', qc_run_id)
        .single();

      if (!existingInv) {
        // Create investigation with AI analysis
        await supabase
          .from('qc_investigations')
          .insert({
            lab_id: labId,
            qc_run_id: qc_run_id,
            title: `QC Failure - ${qcRun.analyzer_name} - ${qcRun.run_date}`,
            severity: failedResults.some((r: any) => r.westgard_flags?.includes('1_3s')) ? 'high' : 'medium',
            westgard_violations: qcRun.westgard_violations || [],
            ai_summary: analysis.summary,
            ai_likely_causes: analysis.likely_causes,
            ai_recommendations: analysis.recommended_actions,
            ai_impact_assessment: analysis.impact_assessment,
            ai_context_used: {
              qc_results_count: results.length,
              historical_runs_analyzed: historicalData.reduce((sum, h) => sum + h.history.length, 0),
              calibration_records_checked: calibrationData.length
            },
            ai_model_used: 'gemini-2.5-flash',
            ai_generated_at: new Date().toISOString(),
            status: 'open',
            hold_patient_results: analysis.impact_assessment.recommendation === 'hold_results'
          });
      } else {
        // Update existing investigation with new AI analysis
        await supabase
          .from('qc_investigations')
          .update({
            ai_summary: analysis.summary,
            ai_likely_causes: analysis.likely_causes,
            ai_recommendations: analysis.recommended_actions,
            ai_impact_assessment: analysis.impact_assessment,
            ai_generated_at: new Date().toISOString()
          })
          .eq('id', existingInv.id);
      }
    }

    const response = {
      success: true,
      summary: analysis.summary,
      likely_causes: analysis.likely_causes,
      recommended_actions: analysis.recommended_actions,
      impact_assessment: {
        ...analysis.impact_assessment,
        orders_to_hold: analysis.impact_assessment.recommendation === 'hold_results'
          ? (pendingOrders || []).map((o: any) => o.id)
          : []
      },
      context_used: {
        qc_results_count: results.length,
        historical_runs_analyzed: historicalData.reduce((sum, h) => sum + h.history.length, 0),
        calibration_records_checked: calibrationData.length
      }
    };

    return new Response(
      JSON.stringify(response),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('QC AI Explain Error:', error);
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

function buildAnalysisContext(
  qcRun: any,
  results: any[],
  historicalData: any[],
  calibrationData: any[]
): string {
  let context = `# QC Run Analysis Context

## Run Details
- Date: ${qcRun.run_date} ${qcRun.run_time || ''}
- Analyzer: ${qcRun.analyzer_name || 'Unknown'}
- Run Type: ${qcRun.run_type}
- Status: ${qcRun.status}
- Westgard Violations: ${qcRun.westgard_violations?.join(', ') || 'None detected'}

## Current Results
`;

  for (const result of results) {
    const analyteName = result.analytes?.name || 'Unknown';
    const lotInfo = result.qc_lots ? `${result.qc_lots.lot_number} ${result.qc_lots.level || ''}` : 'Unknown';
    const zScore = result.z_score?.toFixed(2) || 'N/A';

    context += `
### ${analyteName} (Lot: ${lotInfo})
- Observed Value: ${result.observed_value} ${result.unit || ''}
- Target Mean: ${result.target_mean}
- Target SD: ${result.target_sd}
- Z-Score: ${zScore}
- Status: ${result.pass_fail?.toUpperCase()}
- Westgard Flags: ${result.westgard_flags?.join(', ') || 'None'}
`;
  }

  // Add historical context
  if (historicalData.length > 0) {
    context += `\n## Historical Data (Last ${historicalData[0]?.history?.length || 0} runs per analyte)\n`;

    for (const data of historicalData) {
      if (data.history.length > 0) {
        const zScores = data.history.map((h: any) => h.z_score).filter((z: any) => z !== null);
        const avgZ = zScores.length > 0 ? (zScores.reduce((a: number, b: number) => a + b, 0) / zScores.length).toFixed(2) : 'N/A';
        const failCount = data.history.filter((h: any) => h.pass_fail === 'fail').length;

        context += `
- Historical avg Z-score: ${avgZ}
- Historical failures: ${failCount}/${data.history.length}
- Recent trend: ${describeTrend(zScores)}
`;
      }
    }
  }

  // Add calibration context
  if (calibrationData.length > 0) {
    context += `\n## Recent Calibrations\n`;

    for (const cal of calibrationData.slice(0, 5)) {
      context += `- ${cal.calibration_date}: ${cal.calibration_type} - ${cal.status}`;
      if (cal.slope) context += ` (slope: ${cal.slope.toFixed(4)})`;
      context += '\n';
    }
  }

  return context;
}

function describeTrend(zScores: number[]): string {
  if (zScores.length < 3) return 'Insufficient data';

  const recent = zScores.slice(0, 5);
  const older = zScores.slice(5, 10);

  if (older.length === 0) return 'Insufficient data for trend';

  const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
  const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;
  const diff = recentAvg - olderAvg;

  if (Math.abs(diff) < 0.5) return 'Stable';
  if (diff > 1) return 'Significant positive drift';
  if (diff > 0.5) return 'Slight positive drift';
  if (diff < -1) return 'Significant negative drift';
  if (diff < -0.5) return 'Slight negative drift';
  return 'Stable';
}

async function callGeminiAnalysis(
  context: string,
  apiKey: string
): Promise<{
  summary: string;
  likely_causes: LikelyCause[];
  recommended_actions: Recommendation[];
  impact_assessment: ImpactAssessment;
}> {
  const model = 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const prompt = `You are a senior Quality Control officer and clinical laboratory scientist with expertise in NABL/ISO 15189:2022 accreditation. Analyze the following QC run data and provide a comprehensive failure analysis.

${context}

Provide your analysis as JSON with the following structure:

{
  "summary": "A clear, plain-language 2-3 sentence summary of what went wrong and the overall situation. Write as if explaining to a lab technician.",

  "likely_causes": [
    {
      "cause": "Specific cause description",
      "probability": "high" | "medium" | "low",
      "evidence": ["Evidence point 1", "Evidence point 2"]
    }
  ],

  "recommended_actions": [
    {
      "action": "Specific action to take",
      "priority": "immediate" | "soon" | "scheduled",
      "rationale": "Why this action is recommended",
      "task_type": "repeat_qc" | "recalibrate" | "change_reagent" | "change_lot" | "service_call" | "manual_check" | "verify_results"
    }
  ],

  "impact_assessment": {
    "affected_tests": ["List of test names that may be affected"],
    "orders_to_hold": [],
    "recommendation": "hold_results" | "proceed_with_caution" | "safe_to_release",
    "reasoning": "Explanation of the impact assessment"
  }
}

IMPORTANT GUIDELINES:
1. For 1:3s violations (>3SD), this is a serious error - recommend holding results and immediate action
2. For 1:2s warnings, this may be random error - recommend repeat QC before action
3. For 2:2s (systematic) violations, consider calibration or reagent issues
4. For R:4s (range) violations, consider precision problems (pipetting, sample handling)
5. For trends (4:1s, 10x), consider drift - calibration or reagent stability
6. Always consider the historical context - is this a one-time event or part of a pattern?
7. Be specific in recommendations - don't just say "investigate" but specify what to check

Return ONLY valid JSON, no markdown formatting.`;

  const requestBody = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.2,
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
    // Return default response
    return {
      summary: 'Unable to generate automated analysis. Please review the QC results manually.',
      likely_causes: [
        {
          cause: 'Analysis could not be completed automatically',
          probability: 'medium',
          evidence: ['AI processing error']
        }
      ],
      recommended_actions: [
        {
          action: 'Review QC results manually',
          priority: 'immediate',
          rationale: 'Automated analysis was not available',
          task_type: 'manual_check'
        }
      ],
      impact_assessment: {
        affected_tests: [],
        orders_to_hold: [],
        recommendation: 'proceed_with_caution',
        reasoning: 'Manual review recommended due to analysis error'
      }
    };
  }
}
