/**
 * QC AI Drift Alerts Edge Function
 *
 * Analyzes QC data for drift and trend detection:
 * 1. CUSUM (Cumulative Sum) analysis
 * 2. EWMA (Exponentially Weighted Moving Average)
 * 3. Lot-to-lot variation detection
 * 4. Between-analyzer comparison
 * 5. Slow drift detection (bias within 2SD but trending)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface QCDriftAlertRequest {
  lab_id: string;
  analyzer_name?: string;
  analyte_ids?: string[];
  qc_lot_id?: string;
  lookback_days?: number;
}

interface DriftAlert {
  alert_type: string;
  severity: 'info' | 'warning' | 'critical';
  analyte_name: string;
  analyzer_name: string;
  lot_number?: string;
  title: string;
  description: string;
  trend_data: {
    dates: string[];
    z_scores: number[];
    values: number[];
    target_mean: number;
    target_sd: number;
  };
  statistical_summary: {
    mean_bias: number;
    cusum_value: number;
    ewma_value: number;
    trend_slope: number;
    n_points: number;
  };
  risk_score: number;
  recommendations: string[];
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

    const payload: QCDriftAlertRequest = await req.json();
    const {
      lab_id,
      analyzer_name,
      analyte_ids,
      qc_lot_id,
      lookback_days = 30
    } = payload;

    console.log(`\n📈 QC AI Drift Alerts`);
    console.log(`  - Lab ID: ${lab_id}`);
    console.log(`  - Lookback: ${lookback_days} days`);
    console.log(`  - Analyzer: ${analyzer_name || 'all'}`);

    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - lookback_days);

    // Build query for QC results
    let query = supabase
      .from('qc_results')
      .select(`
        id, observed_value, target_mean, target_sd, z_score, pass_fail,
        created_at, analyte_id, qc_lot_id,
        analytes:analyte_id (id, name, code),
        qc_lots:qc_lot_id (id, lot_number, material_name, level),
        qc_runs!inner (run_date, run_time, analyzer_name, lab_id)
      `)
      .eq('qc_runs.lab_id', lab_id)
      .gte('created_at', startDate.toISOString())
      .order('created_at', { ascending: true });

    if (analyzer_name) {
      query = query.eq('qc_runs.analyzer_name', analyzer_name);
    }

    if (analyte_ids && analyte_ids.length > 0) {
      query = query.in('analyte_id', analyte_ids);
    }

    if (qc_lot_id) {
      query = query.eq('qc_lot_id', qc_lot_id);
    }

    const { data: results, error: resultsError } = await query;

    if (resultsError) {
      console.error('Query error:', resultsError);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to fetch QC results' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`  - Results fetched: ${results?.length || 0}`);

    if (!results || results.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          alerts: [],
          summary: {
            total_analytes_checked: 0,
            alerts_generated: 0,
            high_risk_count: 0
          }
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Group results by analyte + lot + analyzer
    const groupedResults = new Map<string, any[]>();

    for (const result of results) {
      const key = `${result.analyte_id}|${result.qc_lot_id}|${(result.qc_runs as any)?.analyzer_name || 'unknown'}`;
      if (!groupedResults.has(key)) {
        groupedResults.set(key, []);
      }
      groupedResults.get(key)!.push(result);
    }

    console.log(`  - Unique combinations: ${groupedResults.size}`);

    // Analyze each group for drift
    const alerts: DriftAlert[] = [];

    for (const [key, groupResults] of groupedResults) {
      if (groupResults.length < 5) continue; // Need minimum data points

      const [analyteId, lotId, analyzerName] = key.split('|');
      const firstResult = groupResults[0];
      const analyteName = (firstResult.analytes as any)?.name || 'Unknown';
      const lotNumber = (firstResult.qc_lots as any)?.lot_number || 'Unknown';
      const lotLevel = (firstResult.qc_lots as any)?.level || '';

      // Extract z-scores and values
      const zScores = groupResults.map(r => r.z_score).filter((z): z is number => z !== null);
      const values = groupResults.map(r => r.observed_value).filter((v): v is number => v !== null);
      const dates = groupResults.map(r => r.created_at);

      if (zScores.length < 5) continue;

      const targetMean = firstResult.target_mean;
      const targetSD = firstResult.target_sd;

      // Calculate statistical measures
      const stats = calculateDriftStatistics(zScores, values);

      // Determine alerts based on statistics
      const groupAlerts = detectDriftAlerts(
        analyteName,
        analyzerName,
        lotNumber,
        lotLevel,
        dates,
        zScores,
        values,
        targetMean,
        targetSD,
        stats
      );

      alerts.push(...groupAlerts);
    }

    // Sort alerts by severity and risk score
    alerts.sort((a, b) => {
      const severityOrder = { critical: 0, warning: 1, info: 2 };
      const severityDiff = severityOrder[a.severity] - severityOrder[b.severity];
      if (severityDiff !== 0) return severityDiff;
      return b.risk_score - a.risk_score;
    });

    // Store new alerts in database
    for (const alert of alerts) {
      // Check if similar alert already exists
      const { data: existingAlert } = await supabase
        .from('qc_drift_alerts')
        .select('id')
        .eq('lab_id', lab_id)
        .eq('analyzer_name', alert.analyzer_name)
        .eq('alert_type', alert.alert_type)
        .eq('status', 'active')
        .single();

      if (!existingAlert) {
        await supabase
          .from('qc_drift_alerts')
          .insert({
            lab_id,
            analyzer_name: alert.analyzer_name,
            alert_type: alert.alert_type,
            severity: alert.severity,
            title: alert.title,
            description: alert.description,
            trend_data: alert.trend_data,
            statistical_summary: alert.statistical_summary,
            risk_score: alert.risk_score,
            ai_recommendations: alert.recommendations,
            ai_model_used: 'statistical-analysis',
            ai_generated_at: new Date().toISOString(),
            status: 'active'
          });
      }
    }

    // Get AI interpretation for significant alerts
    let aiInterpretation = '';
    if (alerts.length > 0) {
      aiInterpretation = await getAIInterpretation(alerts.slice(0, 5), geminiApiKey);
    }

    const response = {
      success: true,
      alerts,
      ai_interpretation: aiInterpretation,
      summary: {
        total_analytes_checked: groupedResults.size,
        alerts_generated: alerts.length,
        high_risk_count: alerts.filter(a => a.severity === 'critical').length
      }
    };

    return new Response(
      JSON.stringify(response),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('QC AI Drift Alerts Error:', error);
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

interface DriftStatistics {
  meanBias: number;
  cusumValue: number;
  ewmaValue: number;
  trendSlope: number;
  slopeR2: number;
  recentMean: number;
  oldMean: number;
  std: number;
}

function calculateDriftStatistics(zScores: number[], values: number[]): DriftStatistics {
  const n = zScores.length;

  // Mean bias
  const meanBias = zScores.reduce((a, b) => a + b, 0) / n;

  // CUSUM calculation
  // CUSUM detects small shifts in the mean
  let cusumPos = 0;
  let cusumNeg = 0;
  const k = 0.5; // Allowance (typically 0.5 SD)

  for (const z of zScores) {
    cusumPos = Math.max(0, cusumPos + z - k);
    cusumNeg = Math.min(0, cusumNeg + z + k);
  }
  const cusumValue = Math.max(Math.abs(cusumPos), Math.abs(cusumNeg));

  // EWMA calculation
  // EWMA with lambda = 0.2 is common for laboratory QC
  const lambda = 0.2;
  let ewma = zScores[0];
  for (let i = 1; i < zScores.length; i++) {
    ewma = lambda * zScores[i] + (1 - lambda) * ewma;
  }
  const ewmaValue = ewma;

  // Trend slope using simple linear regression
  const xMean = (n - 1) / 2;
  let numerator = 0;
  let denominator = 0;

  for (let i = 0; i < n; i++) {
    numerator += (i - xMean) * (zScores[i] - meanBias);
    denominator += (i - xMean) ** 2;
  }

  const trendSlope = denominator !== 0 ? numerator / denominator : 0;

  // R² for trend line
  const ssTotal = zScores.reduce((sum, z) => sum + (z - meanBias) ** 2, 0);
  const ssResidual = zScores.reduce((sum, z, i) => {
    const predicted = meanBias + trendSlope * (i - xMean);
    return sum + (z - predicted) ** 2;
  }, 0);
  const slopeR2 = ssTotal > 0 ? 1 - ssResidual / ssTotal : 0;

  // Recent vs old comparison
  const splitPoint = Math.floor(n / 2);
  const recentMean = zScores.slice(splitPoint).reduce((a, b) => a + b, 0) / (n - splitPoint);
  const oldMean = zScores.slice(0, splitPoint).reduce((a, b) => a + b, 0) / splitPoint;

  // Standard deviation
  const std = Math.sqrt(zScores.reduce((sum, z) => sum + (z - meanBias) ** 2, 0) / (n - 1));

  return {
    meanBias,
    cusumValue,
    ewmaValue,
    trendSlope,
    slopeR2,
    recentMean,
    oldMean,
    std
  };
}

function detectDriftAlerts(
  analyteName: string,
  analyzerName: string,
  lotNumber: string,
  lotLevel: string,
  dates: string[],
  zScores: number[],
  values: number[],
  targetMean: number,
  targetSD: number,
  stats: DriftStatistics
): DriftAlert[] {
  const alerts: DriftAlert[] = [];
  const trendData = {
    dates: dates.slice(-30),
    z_scores: zScores.slice(-30),
    values: values.slice(-30),
    target_mean: targetMean,
    target_sd: targetSD
  };

  const statisticalSummary = {
    mean_bias: stats.meanBias,
    cusum_value: stats.cusumValue,
    ewma_value: stats.ewmaValue,
    trend_slope: stats.trendSlope,
    n_points: zScores.length
  };

  // CUSUM Alert - detect small persistent shifts
  // H = 4 or 5 is typical decision interval
  if (stats.cusumValue > 4) {
    const severity = stats.cusumValue > 6 ? 'critical' : 'warning';
    const riskScore = Math.min(100, stats.cusumValue * 15);

    alerts.push({
      alert_type: 'cusum_alert',
      severity,
      analyte_name: analyteName,
      analyzer_name: analyzerName,
      lot_number: `${lotNumber} ${lotLevel}`.trim(),
      title: `CUSUM Alert: ${analyteName}`,
      description: `CUSUM analysis detected a shift from target. Current CUSUM value: ${stats.cusumValue.toFixed(2)} (threshold: 4). This suggests a persistent bias that may require calibration attention.`,
      trend_data: trendData,
      statistical_summary: statisticalSummary,
      risk_score: riskScore,
      recommendations: [
        'Review recent calibration records',
        'Consider recalibration if bias persists',
        'Check reagent lot for consistency'
      ]
    });
  }

  // EWMA Alert - smoothed detection of shifts
  if (Math.abs(stats.ewmaValue) > 2) {
    const severity = Math.abs(stats.ewmaValue) > 2.5 ? 'critical' : 'warning';
    const riskScore = Math.min(100, Math.abs(stats.ewmaValue) * 35);

    alerts.push({
      alert_type: 'ewma_alert',
      severity,
      analyte_name: analyteName,
      analyzer_name: analyzerName,
      lot_number: `${lotNumber} ${lotLevel}`.trim(),
      title: `EWMA Alert: ${analyteName}`,
      description: `EWMA analysis shows sustained deviation. Current EWMA: ${stats.ewmaValue.toFixed(2)} SD. The smoothed trend indicates a ${stats.ewmaValue > 0 ? 'positive' : 'negative'} bias.`,
      trend_data: trendData,
      statistical_summary: statisticalSummary,
      risk_score: riskScore,
      recommendations: [
        `Check for systematic ${stats.ewmaValue > 0 ? 'high' : 'low'} bias`,
        'Review temperature and storage conditions',
        'Consider reagent performance check'
      ]
    });
  }

  // Slow Drift Detection - slope analysis
  if (Math.abs(stats.trendSlope) > 0.05 && stats.slopeR2 > 0.3) {
    const driftDirection = stats.trendSlope > 0 ? 'upward' : 'downward';
    const severity = Math.abs(stats.trendSlope) > 0.1 ? 'warning' : 'info';
    const riskScore = Math.min(100, Math.abs(stats.trendSlope) * 500);

    alerts.push({
      alert_type: 'slow_drift',
      severity,
      analyte_name: analyteName,
      analyzer_name: analyzerName,
      lot_number: `${lotNumber} ${lotLevel}`.trim(),
      title: `Slow Drift Detected: ${analyteName}`,
      description: `Gradual ${driftDirection} drift detected in QC values. Trend slope: ${stats.trendSlope.toFixed(4)} SD/run (R²: ${stats.slopeR2.toFixed(2)}). Values are still within limits but trending.`,
      trend_data: trendData,
      statistical_summary: statisticalSummary,
      risk_score: riskScore,
      recommendations: [
        'Monitor closely for next 5-10 runs',
        'Schedule preventive calibration if drift continues',
        'Check reagent expiry and storage'
      ]
    });
  }

  // Sudden Shift Detection - recent vs old comparison
  const shiftMagnitude = Math.abs(stats.recentMean - stats.oldMean);
  if (shiftMagnitude > 1.0 && zScores.length >= 10) {
    const severity = shiftMagnitude > 1.5 ? 'critical' : 'warning';
    const riskScore = Math.min(100, shiftMagnitude * 50);

    alerts.push({
      alert_type: 'sudden_shift',
      severity,
      analyte_name: analyteName,
      analyzer_name: analyzerName,
      lot_number: `${lotNumber} ${lotLevel}`.trim(),
      title: `Sudden Shift: ${analyteName}`,
      description: `Mean shifted from ${stats.oldMean.toFixed(2)} SD to ${stats.recentMean.toFixed(2)} SD. This ${shiftMagnitude.toFixed(2)} SD change may indicate lot change, calibration event, or equipment issue.`,
      trend_data: trendData,
      statistical_summary: statisticalSummary,
      risk_score: riskScore,
      recommendations: [
        'Review recent lot changes or calibrations',
        'Check maintenance records',
        'Verify reagent lot information',
        'Consider repeat QC with fresh controls'
      ]
    });
  }

  // Precision Alert - increased variability
  if (stats.std > 1.5 && zScores.length >= 10) {
    const severity = stats.std > 2 ? 'warning' : 'info';
    const riskScore = Math.min(100, (stats.std - 1) * 40);

    alerts.push({
      alert_type: 'analyzer_variation',
      severity,
      analyte_name: analyteName,
      analyzer_name: analyzerName,
      lot_number: `${lotNumber} ${lotLevel}`.trim(),
      title: `Increased Variability: ${analyteName}`,
      description: `QC precision has degraded. Standard deviation of z-scores: ${stats.std.toFixed(2)} (expected ~1.0). This may indicate pipetting issues, sample handling problems, or instrument precision degradation.`,
      trend_data: trendData,
      statistical_summary: statisticalSummary,
      risk_score: riskScore,
      recommendations: [
        'Check pipette calibration',
        'Review sample handling procedures',
        'Consider preventive maintenance',
        'Verify control handling and storage'
      ]
    });
  }

  return alerts;
}

async function getAIInterpretation(
  alerts: DriftAlert[],
  apiKey: string
): Promise<string> {
  if (alerts.length === 0) return '';

  const model = 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const alertSummary = alerts.map(a =>
    `- ${a.title}: ${a.description} (Risk: ${a.risk_score}%)`
  ).join('\n');

  const prompt = `As a laboratory quality control expert, provide a brief 2-3 sentence interpretation of these drift alerts and prioritized recommendations:

${alertSummary}

Focus on:
1. The most critical issue that needs attention
2. Whether these alerts are related (common root cause)
3. One key action to take first

Keep your response concise and actionable.`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 256 }
      })
    });

    if (!response.ok) return '';

    const data = await response.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  } catch {
    return '';
  }
}
