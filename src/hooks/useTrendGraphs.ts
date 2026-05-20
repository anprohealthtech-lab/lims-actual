import { useState, useCallback } from 'react';
import { database, aiAnalysis } from '../utils/supabase';

export interface TrendDataPoint {
  date: string;
  timestamp: string; // Full timestamp for uniqueness
  value: number;
  flag?: string | null;
  resultValueId?: string; // For debugging/tracking
}

export interface TrendAnalyte {
  analyte_id: string;
  analyte_name: string;
  unit: string;
  dataPoints: TrendDataPoint[];
  reference_range: {
    min: number;
    max: number;
  };
  trend: 'increasing' | 'decreasing' | 'stable' | 'insufficient_data';
  selected_for_report?: boolean;
}

export interface TrendGraphData {
  analytes: TrendAnalyte[];
  patient_id: string;
  generated_at: string;
  selected_analyte_keys?: string[];
  include_in_report?: boolean;
  include_in_report_updated_at?: string;
  images_generated_at?: string;
}

// Input type for generating trends - supports both ID and name matching
export interface AnalyteInput {
  analyte_id?: string;
  parameter: string; // analyte name for fallback matching
}

export const useTrendGraphs = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Calculate trend direction from data points
   */
  const calculateTrend = useCallback((dataPoints: TrendDataPoint[]): TrendAnalyte['trend'] => {
    if (dataPoints.length < 2) return 'insufficient_data';
    
    const recent = dataPoints.slice(-3); // Last 3 points
    const older = dataPoints.slice(Math.max(0, dataPoints.length - 6), Math.max(0, dataPoints.length - 3));
    
    if (older.length === 0) return 'insufficient_data';
    
    const recentAvg = recent.reduce((sum, p) => sum + p.value, 0) / recent.length;
    const olderAvg = older.reduce((sum, p) => sum + p.value, 0) / older.length;
    
    const percentChange = ((recentAvg - olderAvg) / olderAvg) * 100;
    
    if (Math.abs(percentChange) < 5) return 'stable';
    if (percentChange > 0) return 'increasing';
    return 'decreasing';
  }, []);

  /**
   * Generate and save trend data for an order
   * Uses v_report_template_context view for consistency with TrendModal
   */
  const generateAndSaveTrends = useCallback(async (
    orderId: string,
    patientId: string,
    analyteIds: string[],
    analyteNames?: string[], // Optional: analyte names for better matching
    selectedAnalyteKeys?: string[]
  ) => {
    setLoading(true);
    setError(null);

    try {
      console.log('[TrendGraphs] Generating trends for:', {
        orderId,
        patientId,
        analyteIds,
        analyteNames
      });

      // 1. Fetch historical data from view_patient_history (Internal + External)
      // We fetch by patient_id only and filter in memory to handle cases where 
      // analyte_id might be null (external results) but name matches
      const { data: historyData, error: fetchError } = await database.supabase
        .from('view_patient_history')
        .select(`
          analyte_id,
          analyte_name,
          value,
          unit,
          result_date,
          source,
          reference_range,
          source_id
        `)
        .eq('patient_id', patientId)
        .order('result_date', { ascending: true })
        .limit(500); // Increased limit since we filter in-memory

      if (fetchError) {
        console.error('[TrendGraphs] Fetch error:', fetchError);
        throw fetchError;
      }

      console.log('[TrendGraphs] Fetched history points:', historyData?.length || 0);

      if (!historyData || historyData.length === 0) {
        throw new Error('No historical data found for trend analysis');
      }

      // 2. Group by analyte ID/name
      const analyteMap = new Map<string, {
        analyte_id: string;
        analyte_name: string;
        unit: string;
        reference_range: string;
        dataPoints: Array<{
          date: string;
          timestamp: string;
          resultValueId: string;
          value: number;
          flag: string | null;
          source: 'internal' | 'external';
        }>;
      }>();

      historyData.forEach((row: any) => {
        // Filter: Must match requested IDs or Names
        const matchesId = row.analyte_id && analyteIds.includes(row.analyte_id);
        const matchesName = analyteNames && row.analyte_name && analyteNames.some(n => 
            n.toLowerCase().trim() === row.analyte_name.toLowerCase().trim()
        );

        if (!matchesId && !matchesName) return;

        if (!row.value) return;
        const analyteName = row.analyte_name || 'Unknown';
        const key = row.analyte_id || analyteName;
        
        if (!analyteMap.has(key)) {
          analyteMap.set(key, {
            analyte_id: row.analyte_id || '',
            analyte_name: analyteName,
            unit: row.unit || '',
            reference_range: row.reference_range || '',
            dataPoints: []
          });
        }

        const numericValue = parseFloat(row.value);
        if (isNaN(numericValue)) return;

        analyteMap.get(key)!.dataPoints.push({
          date: row.result_date,
          timestamp: row.result_date,
          resultValueId: row.source_id || '',
          value: numericValue,
          flag: null, // Basic view doesn't have flags yet
          source: row.source
        });
      });

      console.log('[TrendGraphs] Grouped analytes:', analyteMap.size);

      if (analyteMap.size === 0) {
        throw new Error('No matching analyte data found for trend analysis');
      }

      // 3. Build trend graph data structure
      const parseReferenceRange = (rangeText: string): { min: number; max: number } => {
        if (!rangeText) return { min: 0, max: 0 };
        const rangeMatch = rangeText.match(/([\d.]+)\s*[-–]\s*([\d.]+)/);
        if (rangeMatch) {
          return { min: parseFloat(rangeMatch[1]), max: parseFloat(rangeMatch[2]) };
        }
        const lessThanMatch = rangeText.match(/<\s*([\d.]+)/);
        if (lessThanMatch) {
          return { min: 0, max: parseFloat(lessThanMatch[1]) };
        }
        const greaterThanMatch = rangeText.match(/>\s*([\d.]+)/);
        if (greaterThanMatch) {
          return { min: parseFloat(greaterThanMatch[1]), max: Number.MAX_VALUE };
        }
        return { min: 0, max: 0 };
      };

      const getAnalyteKey = (analyteId?: string | null, analyteName?: string | null) =>
        (analyteId || analyteName || '').toString().trim().toLowerCase();

      const selectedKeys = selectedAnalyteKeys && selectedAnalyteKeys.length > 0
        ? selectedAnalyteKeys
        : [
          ...analyteIds.map(id => getAnalyteKey(id, null)),
          ...(analyteNames || []).map(name => getAnalyteKey(null, name)),
        ];

      const trendData: TrendGraphData = {
        analytes: Array.from(analyteMap.values()).map((data) => {
          // Sort by date
          const sortedPoints = data.dataPoints.sort(
            (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
          );

          const analyteKey = getAnalyteKey(data.analyte_id, data.analyte_name);

          return {
            analyte_id: data.analyte_id,
            analyte_name: data.analyte_name,
            unit: data.unit,
            dataPoints: sortedPoints,
            reference_range: parseReferenceRange(data.reference_range),
            trend: calculateTrend(sortedPoints),
            selected_for_report: selectedKeys.includes(analyteKey),
          };
        }),
        patient_id: patientId,
        generated_at: new Date().toISOString(),
        selected_analyte_keys: selectedKeys,
      };

      console.log('[TrendGraphs] Built trend data:', {
        analytesCount: trendData.analytes.length,
        dataPointsByAnalyte: trendData.analytes.map(a => ({
          name: a.analyte_name,
          points: a.dataPoints.length
        }))
      });

      // 4. Save to database via RPC
      const { error: saveError } = await aiAnalysis.saveTrendData(
        orderId,
        trendData
      );

      if (saveError) throw saveError;

      setLoading(false);
      return { success: true, data: trendData };

    } catch (err: any) {
      const errorMsg = err.message || 'Failed to generate trend graphs';
      setError(errorMsg);
      console.error('Trend generation error:', err);
      setLoading(false);
      return { success: false, error: errorMsg };
    }
  }, [calculateTrend]);

  /**
   * Load existing trend data for an order
   */
  const loadTrendData = useCallback(async (orderId: string) => {
    setLoading(true);
    setError(null);

    try {
      const { data, error: loadError } = await aiAnalysis.getTrendData(orderId);
      
      if (loadError) throw loadError;

      setLoading(false);
      // Return null data gracefully if order not found or no trend data yet
      return { success: true, data: data?.trend_graph_data || null };
    } catch (err: any) {
      const errorMsg = err.message || 'Failed to load trend data';
      setError(errorMsg);
      setLoading(false);
      // Don't treat "not found" as error - just return null data
      return { success: true, data: null };
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return {
    generateAndSaveTrends,
    loadTrendData,
    loading,
    error,
    clearError
  };
};
