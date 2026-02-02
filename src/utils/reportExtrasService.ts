/**
 * reportExtrasService.ts
 * 
 * Manages report extras (trend charts, clinical summaries) for inclusion in final PDF reports.
 * Stores data in the `results` table's `report_extras` JSONB column.
 */

import { supabase } from './supabase';
import { 
  TrendChartResult, 
  generateTrendChart, 
  generateTrendSectionHtml 
} from './trendChartGenerator';

// ============ Helper Functions ============

/**
 * Clean and format clinical summary text
 * - Removes duplicate headers
 * - Converts markdown bold (**text**) to HTML
 * - Preserves line breaks
 */
const formatClinicalSummaryText = (text: string, forHtml: boolean = true): string => {
  if (!text) return '';
  
  let cleaned = text;
  
  // Remove duplicate "**Executive Summary**" headers (keep only the first occurrence's content)
  // Pattern: multiple consecutive **Executive Summary** lines
  cleaned = cleaned.replace(/(\*\*Executive Summary\*\*\s*\n?){2,}/gi, '**Executive Summary**\n');
  
  // Remove standalone duplicate headers at the start
  cleaned = cleaned.replace(/^(\*\*Executive Summary\*\*\s*\n)+/gi, '');
  
  if (forHtml) {
    // Convert markdown bold to HTML bold
    cleaned = cleaned.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    
    // Convert bullet points to HTML list items
    cleaned = cleaned.replace(/^[•\-]\s*(.+)$/gm, '<li>$1</li>');
    
    // Wrap consecutive <li> items in <ul>
    cleaned = cleaned.replace(/(<li>[\s\S]*?<\/li>\s*)+/g, (match) => `<ul style="margin: 8px 0; padding-left: 20px;">${match}</ul>`);
    
    // Convert line breaks to <br> for remaining text
    cleaned = cleaned.replace(/\n/g, '<br>');
  } else {
    // For plain text (jsPDF), just remove markdown markers
    cleaned = cleaned.replace(/\*\*([^*]+)\*\*/g, '$1');
  }
  
  return cleaned.trim();
};

// ============ Types ============

export interface ClinicalSummaryData {
  text: string;
  recommendation?: string;
  generated_at: string;
  generated_by?: 'ai' | 'manual';
}

export interface ReportExtras {
  // Trend charts
  trend_charts?: TrendChartResult[];
  include_trends_in_report?: boolean;
  
  // Clinical summary for doctor
  clinical_summary?: ClinicalSummaryData;
  include_summary_in_report?: boolean;
  
  // Metadata
  generated_at?: string;
  last_updated?: string;
}

export interface SaveReportExtrasOptions {
  resultId: string;
  orderId: string;
  patientId: string;
  
  // Analytes with flags for trend generation
  analytesToIncludeTrends?: { name: string; flag?: string | null }[];
  includeTrendsInReport?: boolean;
  
  // Clinical summary
  clinicalSummary?: ClinicalSummaryData;
  includeSummaryInReport?: boolean;
}

// ============ Database Operations ============

/**
 * Get report extras for a result
 */
export const getReportExtras = async (resultId: string): Promise<ReportExtras | null> => {
  try {
    const { data, error } = await supabase
      .from('results')
      .select('report_extras')
      .eq('id', resultId)
      .single();

    if (error) {
      console.error('Error fetching report extras:', error);
      return null;
    }

    return data?.report_extras as ReportExtras || null;
  } catch (error) {
    console.error('Error in getReportExtras:', error);
    return null;
  }
};

/**
 * Update report extras for a result (merge with existing)
 */
export const updateReportExtras = async (
  resultId: string, 
  extras: Partial<ReportExtras>
): Promise<boolean> => {
  try {
    // Get existing extras to merge
    const existing = await getReportExtras(resultId);
    
    const merged: ReportExtras = {
      ...existing,
      ...extras,
      last_updated: new Date().toISOString(),
    };

    const { error } = await supabase
      .from('results')
      .update({ report_extras: merged })
      .eq('id', resultId);

    if (error) {
      console.error('Error updating report extras:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error in updateReportExtras:', error);
    return false;
  }
};

/**
 * Generate and save trend charts for specified analytes
 */
export const generateAndSaveTrendCharts = async (
  resultId: string,
  orderId: string,
  patientId: string,
  analytes: { name: string; flag?: string | null }[],
  includeInReport: boolean = true
): Promise<TrendChartResult[]> => {
  const trendCharts: TrendChartResult[] = [];

  // Filter to flagged analytes that would benefit from trend analysis
  const flaggedAnalytes = analytes.filter(a => a.flag && ['H', 'L', 'C'].includes(a.flag));
  
  if (flaggedAnalytes.length === 0) {
    console.log('No flagged analytes to generate trends for');
    return [];
  }

  console.log(`Generating trend charts for ${flaggedAnalytes.length} flagged analyte(s)...`);

  for (const analyte of flaggedAnalytes) {
    try {
      const result = await generateTrendChart(patientId, analyte.name, orderId);
      if (result.data.length >= 2) {
        trendCharts.push(result);
      }
    } catch (error) {
      console.error(`Error generating trend for ${analyte.name}:`, error);
    }
  }

  if (trendCharts.length > 0) {
    await updateReportExtras(resultId, {
      trend_charts: trendCharts,
      include_trends_in_report: includeInReport,
      generated_at: new Date().toISOString(),
    });
  }

  return trendCharts;
};

/**
 * Save clinical summary for a result
 */
export const saveClinicalSummary = async (
  resultId: string,
  summary: ClinicalSummaryData,
  includeInReport: boolean = true
): Promise<boolean> => {
  return updateReportExtras(resultId, {
    clinical_summary: summary,
    include_summary_in_report: includeInReport,
  });
};

/**
 * Toggle inclusion of trends in report
 */
export const toggleTrendsInReport = async (
  resultId: string,
  include: boolean
): Promise<boolean> => {
  return updateReportExtras(resultId, {
    include_trends_in_report: include,
  });
};

/**
 * Toggle inclusion of clinical summary in report
 */
export const toggleSummaryInReport = async (
  resultId: string,
  include: boolean
): Promise<boolean> => {
  return updateReportExtras(resultId, {
    include_summary_in_report: include,
  });
};

/**
 * Toggle inclusion of clinical summary in report at order level
 * Stores the flag in orders.trend_graph_data JSONB
 */
export const toggleOrderSummaryInReport = async (
  orderId: string,
  include: boolean
): Promise<{ success: boolean; error?: string }> => {
  try {
    // Update the dedicated column for include_clinical_summary_in_report
    // Also update trend_graph_data for backward compatibility
    const { data: orderData, error: fetchError } = await supabase
      .from('orders')
      .select('trend_graph_data')
      .eq('id', orderId)
      .single();

    if (fetchError) {
      console.error('Error fetching order data:', fetchError);
      return { success: false, error: fetchError.message };
    }

    // Merge the include flag with existing trend_graph_data for backward compatibility
    const existingData = (orderData?.trend_graph_data || {}) as Record<string, any>;
    const updatedData = {
      ...existingData,
      include_summary_in_report: include,
    };

    // Update both the new dedicated column AND trend_graph_data for backward compatibility
    const { error: updateError } = await supabase
      .from('orders')
      .update({ 
        include_clinical_summary_in_report: include,
        trend_graph_data: updatedData 
      })
      .eq('id', orderId);

    if (updateError) {
      console.error('Error updating order include flag:', updateError);
      return { success: false, error: updateError.message };
    }

    console.log(`✅ Order ${orderId}: include_clinical_summary_in_report = ${include}`);
    return { success: true };
  } catch (error) {
    console.error('Error toggling summary in report:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
};

/**
 * Save clinical summary options (both PDF inclusion and send-to-doctor flags)
 * This handles both checkboxes in the Clinical Summary modal
 */
export const saveClinicalSummaryOptions = async (
  orderId: string,
  options: {
    includeInReport: boolean;
    sendToDoctor: boolean;
  }
): Promise<{ success: boolean; error?: string }> => {
  try {
    // Get existing trend_graph_data for backward compatibility
    const { data: orderData, error: fetchError } = await supabase
      .from('orders')
      .select('trend_graph_data')
      .eq('id', orderId)
      .single();

    if (fetchError) {
      console.error('Error fetching order data:', fetchError);
      return { success: false, error: fetchError.message };
    }

    // Merge with existing data
    const existingData = (orderData?.trend_graph_data || {}) as Record<string, any>;
    const updatedData = {
      ...existingData,
      include_summary_in_report: options.includeInReport,
      send_summary_to_doctor: options.sendToDoctor,
    };

    // Update both dedicated columns AND trend_graph_data
    const { error: updateError } = await supabase
      .from('orders')
      .update({ 
        include_clinical_summary_in_report: options.includeInReport,
        send_clinical_summary_to_doctor: options.sendToDoctor,
        trend_graph_data: updatedData 
      })
      .eq('id', orderId);

    if (updateError) {
      console.error('Error updating clinical summary options:', updateError);
      return { success: false, error: updateError.message };
    }

    console.log(`✅ Order ${orderId}: include_in_report=${options.includeInReport}, send_to_doctor=${options.sendToDoctor}`);
    return { success: true };
  } catch (error) {
    console.error('Error saving clinical summary options:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
};

// ============ HTML Generation for PDF ============

/**
 * Generate clinical summary HTML section
 * Uses CSS classes - no inline styles for layout control
 */
export const generateClinicalSummaryHtml = (summary: ClinicalSummaryData): string => {
  if (!summary?.text) {
    return '';
  }

  // Format the text - convert markdown to HTML
  const formattedText = formatClinicalSummaryText(summary.text, true);

  const recommendationHtml = summary.recommendation ? `
    <div class="clinical-recommendation">
      <strong>Recommendation:</strong>
      <p>${summary.recommendation}</p>
    </div>
  ` : '';

  return `
    <div class="clinical-summary-section">
      <h3 class="clinical-summary-title">
        🩺 Clinical Summary for Referring Physician
      </h3>
      <div class="clinical-summary-content">
        <div class="clinical-summary-text">${formattedText}</div>
        ${recommendationHtml}
      </div>
      <p class="clinical-summary-meta">
        Generated: ${new Date(summary.generated_at).toLocaleString('en-IN')}
        ${summary.generated_by === 'ai' ? ' (AI-Assisted)' : ''}
      </p>
    </div>
  `;
};

/**
 * Generate print-friendly clinical summary (no background colors)
 */
export const generateClinicalSummaryHtmlPrint = (summary: ClinicalSummaryData): string => {
  if (!summary?.text) {
    return '';
  }

  // Format the text - convert markdown to HTML
  const formattedText = formatClinicalSummaryText(summary.text, true);

  const recommendationHtml = summary.recommendation ? `
    <div class="clinical-recommendation">
      <strong>Recommendation:</strong>
      <p>${summary.recommendation}</p>
    </div>
  ` : '';

  return `
    <div class="clinical-summary-section clinical-summary-section--print">
      <h3 class="clinical-summary-title">
        Clinical Summary for Referring Physician
      </h3>
      <div class="clinical-summary-content">
        <div class="clinical-summary-text">${formattedText}</div>
        ${recommendationHtml}
      </div>
    </div>
  `;
};

/**
 * Generate complete report extras section HTML
 * Combines trends and clinical summary based on inclusion flags
 */
export const generateReportExtrasHtml = (
  extras: ReportExtras,
  forPrint: boolean = false
): string => {
  if (!extras) {
    return '';
  }

  const parts: string[] = [];
  
  // Track what content we have for intelligent page break decisions
  const hasTrendCharts = extras.include_trends_in_report && extras.trend_charts && extras.trend_charts.length > 0;
  const hasClinicalSummary = extras.include_summary_in_report && extras.clinical_summary?.text;
  const trendChartCount = extras.trend_charts?.length || 0;
  
  // Estimate if content will fit on one page (rough heuristic)
  // Each trend chart ~200px, clinical summary ~300-400px, page height ~900px usable
  const estimatedTrendHeight = trendChartCount * 220;
  const estimatedSummaryHeight = hasClinicalSummary ? Math.min(400, (extras.clinical_summary?.text?.length || 0) / 3) : 0;
  const totalEstimatedHeight = estimatedTrendHeight + estimatedSummaryHeight;
  const needsPageBreakBetween = totalEstimatedHeight > 600; // Leave room for header + title

  // Add trend charts FIRST (before clinical summary)
  if (hasTrendCharts) {
    parts.push(generateTrendSectionHtml(extras.trend_charts!, forPrint));
  }

  // Add clinical summary
  if (hasClinicalSummary) {
    const summaryHtml = forPrint 
      ? generateClinicalSummaryHtmlPrint(extras.clinical_summary!)
      : generateClinicalSummaryHtml(extras.clinical_summary!);
    
    // Only force page break if BOTH trend charts AND summary exist AND content is large
    if (hasTrendCharts && needsPageBreakBetween) {
      // Large content - put summary on new page with minimal padding
      parts.push(`<div style="page-break-before: always; padding-top: 15px;">${summaryHtml}</div>`);
    } else if (hasTrendCharts) {
      // Small content - keep on same page with some spacing, allow natural page break if needed
      parts.push(`<div style="page-break-inside: avoid; margin-top: 30px;">${summaryHtml}</div>`);
    } else {
      // No trend charts - just add summary directly
      parts.push(summaryHtml);
    }
  }

  if (parts.length === 0) {
    return '';
  }

  // Wrap in section for extras content
  // Use CSS classes instead of inline styles - let PDF.co control layout
  
  if (forPrint) {
    return `
      <div class="report-extras-section">
        <h2 class="report-extras-title">
          Additional Analysis & Summary
        </h2>
        ${parts.join('\n')}
      </div>
    `;
  }

  return `
    <div class="report-extras-section">
      <h2 class="report-extras-title">
        Additional Analysis & Summary
      </h2>
      ${parts.join('\n')}
    </div>
  `;
};

/**
 * Fetch report extras for an order (across all results + order-level data)
 * Used during PDF generation
 * 
 * Sources checked:
 * 1. orders.trend_graph_data - Trend graphs generated from TrendGraphPanel
 * 2. reports.ai_doctor_summary - Clinical summary for doctor
 * 3. results.report_extras - Legacy per-result extras
 */
export const getReportExtrasForOrder = async (orderId: string): Promise<ReportExtras | null> => {
  try {
    // 1. Check order-level trend graph data AND clinical summary (from TrendGraphPanel and Clinical Summary)
    const { data: orderData, error: orderError } = await supabase
      .from('orders')
      .select('trend_graph_data, ai_clinical_summary, ai_clinical_summary_generated_at, include_clinical_summary_in_report')
      .eq('id', orderId)
      .single();

    if (orderError && orderError.code !== 'PGRST116') {
      console.error('Error fetching order trend data:', orderError);
    }

    // 2. Check reports table for AI doctor summary (fallback for older data)
    const { data: reportData, error: reportError } = await supabase
      .from('reports')
      .select('ai_doctor_summary, ai_summary_generated_at, include_trend_graphs')
      .eq('order_id', orderId)
      .order('generated_date', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (reportError && reportError.code !== 'PGRST116') {
      console.error('Error fetching report data:', reportError);
    }

    // 3. Also check results table for legacy report_extras
    const { data: resultsData, error: resultsError } = await supabase
      .from('results')
      .select('id, report_extras')
      .eq('order_id', orderId)
      .not('report_extras', 'is', null);

    if (resultsError) {
      console.error('Error fetching report extras:', resultsError);
    }

    // Build merged result
    const merged: ReportExtras = {
      trend_charts: [],
      include_trends_in_report: false,
      include_summary_in_report: false,
    };

    // Process order-level trend graph data (new system via TrendGraphPanel)
    if (orderData?.trend_graph_data) {
      console.log('📊 Raw trend_graph_data from database:', JSON.stringify(orderData.trend_graph_data, null, 2).substring(0, 500));
      
      const trendData = orderData.trend_graph_data as {
        analytes?: Array<{
          analyte_id: string;
          analyte_name: string;
          unit: string;
          reference_range: { min: number; max: number };
          dataPoints: Array<{ date: string; value: number; flag?: string; timestamp?: string }>;
          trend: string;
          image_url?: string;  // Pre-generated image URL
          image_generated_at?: string;
        }>;
        include_in_report?: boolean;
        images_generated_at?: string;
      };

      console.log('📊 Trend data parsed:', {
        include_in_report: trendData.include_in_report,
        analytesCount: trendData.analytes?.length || 0,
        analytesWithImageUrl: trendData.analytes?.filter(a => a.image_url).length || 0,
        firstAnalyteImageUrl: trendData.analytes?.[0]?.image_url || 'NONE',
      });

      // Only include if flag is true
      if (trendData.include_in_report && trendData.analytes && trendData.analytes.length > 0) {
        const analytesWithImages = trendData.analytes.filter(a => a.image_url);
        console.log(`📊 Found ${trendData.analytes.length} trend analytes, ${analytesWithImages.length} with pre-generated images`);
        
        // Convert to TrendChartResult format for HTML generation
        merged.trend_charts = trendData.analytes.map(analyte => ({
          analyte_name: analyte.analyte_name,
          image_url: analyte.image_url || null,  // Use pre-generated image URL
          image_base64: null,
          data: analyte.dataPoints.map(dp => ({
            order_date: dp.date || dp.timestamp || '',
            value: dp.value,
            unit: analyte.unit,
            reference_range: `${analyte.reference_range.min}-${analyte.reference_range.max}`,
            flag: dp.flag || null,
          })),
          reference_range: `${analyte.reference_range.min}-${analyte.reference_range.max}`,
          unit: analyte.unit,
          generated_at: analyte.image_generated_at || new Date().toISOString(),
        }));
        
        merged.include_trends_in_report = true;
      }
    }

    // Process clinical summary - check orders table first (new system), then reports table (legacy)
    if (orderData?.ai_clinical_summary) {
      merged.clinical_summary = {
        text: orderData.ai_clinical_summary,
        generated_at: orderData.ai_clinical_summary_generated_at || new Date().toISOString(),
        generated_by: 'ai',
      };
      // Use the dedicated column for include flag
      merged.include_summary_in_report = orderData.include_clinical_summary_in_report === true;
      console.log('📝 Using clinical summary from orders table');
    } else if (reportData?.ai_doctor_summary) {
      // Fallback to reports table for older data
      merged.clinical_summary = {
        text: reportData.ai_doctor_summary,
        generated_at: reportData.ai_summary_generated_at || new Date().toISOString(),
        generated_by: 'ai',
      };
      // Check if user explicitly opted to include summary from trend_graph_data
      const trendData = orderData?.trend_graph_data as { include_summary_in_report?: boolean } | null;
      merged.include_summary_in_report = trendData?.include_summary_in_report === true;
      console.log('📝 Using clinical summary from reports table (legacy)');
    }

    // Process legacy results.report_extras
    if (resultsData && resultsData.length > 0) {
      for (const result of resultsData) {
        const extras = result.report_extras as ReportExtras;
        if (!extras) continue;

        // Merge trend charts (if not already from order-level)
        if (!merged.include_trends_in_report && extras.trend_charts && extras.trend_charts.length > 0) {
          merged.trend_charts = [...(merged.trend_charts || []), ...extras.trend_charts];
          if (extras.include_trends_in_report) {
            merged.include_trends_in_report = true;
          }
        }

        // Use clinical summary from results if not found at report level
        if (!merged.clinical_summary && extras.clinical_summary) {
          merged.clinical_summary = extras.clinical_summary;
          merged.include_summary_in_report = extras.include_summary_in_report;
        }
      }
    }

    const hasData = merged.trend_charts?.length || merged.clinical_summary;
    console.log(`📋 Report extras for order ${orderId}:`, {
      trendCount: merged.trend_charts?.length || 0,
      includeTrends: merged.include_trends_in_report,
      hasSummary: !!merged.clinical_summary,
      includeSummary: merged.include_summary_in_report,
    });

    return hasData ? merged : null;
  } catch (error) {
    console.error('Error in getReportExtrasForOrder:', error);
    return null;
  }
};

export default {
  getReportExtras,
  updateReportExtras,
  generateAndSaveTrendCharts,
  saveClinicalSummary,
  toggleTrendsInReport,
  toggleSummaryInReport,
  generateClinicalSummaryHtml,
  generateClinicalSummaryHtmlPrint,
  generateReportExtrasHtml,
  getReportExtrasForOrder,
};
