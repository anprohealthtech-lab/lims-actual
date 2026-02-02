/**
 * QCRunDetails Component
 *
 * Detailed view of a QC run with:
 * - Run metadata (date, time, analyzer, operator)
 * - All results with pass/fail status
 * - Levey-Jennings charts for each analyte
 * - Westgard rule violations
 * - Export and print options
 */

import React, { useState, useEffect } from 'react';
import {
  X,
  Calendar,
  Clock,
  User,
  FlaskConical,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Download,
  Printer,
  Loader2,
  TrendingUp,
  Package,
  Activity
} from 'lucide-react';
import { useQualityControl } from '../../hooks/useQualityControl';
import { LeveyJenningsChart } from './LeveyJenningsChart';
import type { QCRun, QCResult, LeveyJenningsChartData } from '../../types/qc';
import { supabase, database } from '../../utils/supabase';

interface QCRunDetailsProps {
  runId: string;
  labId: string;
  onClose?: () => void;
}

interface AnalyteChartData {
  analyte_id: string;
  analyte_name: string;
  chartData: LeveyJenningsChartData;
}

export const QCRunDetails: React.FC<QCRunDetailsProps> = ({
  runId,
  labId,
  onClose
}) => {
  const [run, setRun] = useState<QCRun | null>(null);
  const [results, setResults] = useState<QCResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [chartData, setChartData] = useState<AnalyteChartData[]>([]);
  const [selectedAnalyteId, setSelectedAnalyteId] = useState<string | null>(null);
  const [operatorName, setOperatorName] = useState<string>('');
  const [lotInfo, setLotInfo] = useState<any>(null);

  const qc = useQualityControl();

  useEffect(() => {
    loadRunDetails();
  }, [runId]);

  const loadRunDetails = async () => {
    setLoading(true);
    try {
      console.log('🔍 QC RUN DETAILS - Loading run:', runId);
      
      // Load run details using database
      const { data: runData, error: runError } = await supabase
        .from('qc_runs')
        .select('*')
        .eq('id', runId)
        .single();
      
      console.log('📋 Run data:', runData);
      console.log('❌ Run error:', runError);
      
      if (runError || !runData) {
        console.error('❌ Error loading run:', runError);
        throw new Error('Run not found');
      }
      setRun(runData);

      // Load operator name
      if (runData.operator_id) {
        const { data: userData } = await supabase
          .from('users')
          .select('name')
          .eq('id', runData.operator_id)
          .single();
        if (userData) {
          setOperatorName(userData.name);
        }
      }

      // Load results - fetch basic data first
      console.log('🔍 QC RUN DETAILS - Starting data load for run:', runId);
      console.log('🔍 Lab ID:', labId);
      
      // First, let's check if ANY qc_results exist
      const { data: allResults, error: allError } = await supabase
        .from('qc_results')
        .select('*')
        .limit(5);
      
      console.log('🧪 Sample of ALL qc_results in database:', allResults);
      console.log('🧪 Total sample count:', allResults?.length);
      
      // Now fetch for this specific run
      const { data: resultsData, error: resultsError } = await supabase
        .from('qc_results')
        .select('*')
        .eq('qc_run_id', runId)
        .order('created_at');

      console.log('📊 Raw results data for this run:', resultsData);
      console.log('📊 Results count:', resultsData?.length);
      console.log('❌ Results error:', resultsError);
      
      // If no results, try checking with lab_id filter
      if (!resultsData || resultsData.length === 0) {
        console.log('🔍 Trying with lab_id filter...');
        const { data: labFilteredResults, error: labError } = await supabase
          .from('qc_results')
          .select('*')
          .eq('lab_id', labId)
          .limit(10);
        
        console.log('📊 Results with lab_id filter:', labFilteredResults);
        console.log('📊 Lab-filtered count:', labFilteredResults?.length);
      }

      if (resultsError) {
        console.error('❌ CRITICAL ERROR loading results:', resultsError);
        throw resultsError;
      }

      if (!resultsData || resultsData.length === 0) {
        console.warn('⚠️ No results data found for run:', runId);
      }

      if (resultsData && resultsData.length > 0) {
        // Enrich each result with analyte and lot information
        console.log('🔄 Starting enrichment for', resultsData.length, 'results');
        
        const enrichedResults = await Promise.all(
          resultsData.map(async (result: any, index: number) => {
            console.log(`🧪 Enriching result ${index + 1}/${resultsData.length}:`, {
              analyte_id: result.analyte_id,
              qc_lot_id: result.qc_lot_id,
              observed_value: result.observed_value
            });
            
            // Fetch analyte details
            const { data: analyteData, error: analyteError } = await supabase
              .from('analytes')
              .select('id, name, code, unit')
              .eq('id', result.analyte_id)
              .single();
            
            console.log(`  ✅ Analyte ${index + 1}:`, analyteData);
            if (analyteError) console.error(`  ❌ Analyte error ${index + 1}:`, analyteError);
            
            // Fetch lot details
            const { data: lotData, error: lotError } = await supabase
              .from('qc_lots')
              .select('lot_number, material_name, level')
              .eq('id', result.qc_lot_id)
              .single();
            
            console.log(`  📦 Lot ${index + 1}:`, lotData);
            if (lotError) console.error(`  ❌ Lot error ${index + 1}:`, lotError);
            
            return {
              ...result,
              analytes: analyteData,
              qc_lots: lotData
            };
          })
        );
        
        console.log('✨ FINAL Enriched results:', enrichedResults);
        console.log('✨ Enriched results structure check:', {
          count: enrichedResults?.length,
          firstResult: enrichedResults[0],
          hasAnalytes: !!enrichedResults[0]?.analytes,
          analyteName: enrichedResults[0]?.analytes?.name
        });
        
        console.log('💾 Setting results state with', enrichedResults.length, 'items');
        setResults(enrichedResults);
        console.log('✅ Results state updated');
        
        // Get lot info from first result
        if (enrichedResults[0]?.qc_lots) {
          console.log('📦 Setting lot info from enriched result:', enrichedResults[0].qc_lots);
          setLotInfo(enrichedResults[0].qc_lots);
        } else {
          console.warn('⚠️ No lot info in enriched results, checking raw data');
          if (resultsData[0].qc_lots) {
            setLotInfo(resultsData[0].qc_lots);
          }
        }

        // Load historical data for charts (last 30 days)
        await loadChartData(resultsData[0].qc_lot_id, runData.run_date);
      }
    } catch (error) {
      console.error('❌ CRITICAL ERROR loading run details:', error);
    } finally {
      setLoading(false);
      console.log('🏁 Run details loading complete');
    }
  };

  const loadChartData = async (lotId: string, currentRunDate: string) => {
    try {
      console.log('📈 Loading chart data for lot:', lotId, 'date:', currentRunDate);
      // Get date 30 days ago
      const date30DaysAgo = new Date(currentRunDate);
      date30DaysAgo.setDate(date30DaysAgo.getDate() - 30);
      const dateFrom = date30DaysAgo.toISOString().split('T')[0];

      // Get all runs for this lot in the last 30 days
      const { data: historicalResults, error: chartError } = await supabase
        .from('qc_results')
        .select(`
          *,
          qc_runs!inner(run_date, run_time, status)
        `)
        .eq('qc_lot_id', lotId)
        .gte('qc_runs.run_date', dateFrom)
        .lte('qc_runs.run_date', currentRunDate)
        .order('run_date', { referencedTable: 'qc_runs', ascending: true });

      if (chartError) {
        console.error('Error loading chart data:', chartError);
      }

      if (!historicalResults || historicalResults.length === 0) return;

      // Enrich with analyte names
      const enrichedHistorical = await Promise.all(
        historicalResults.map(async (result: any) => {
          const { data: analyteData } = await supabase
            .from('analytes')
            .select('name')
            .eq('id', result.analyte_id)
            .single();
          
          return {
            ...result,
            analytes: analyteData
          };
        })
      );

      // Group by analyte
      const analyteGroups = enrichedHistorical.reduce((acc: any, result: any) => {
        if (!acc[result.analyte_id]) {
          acc[result.analyte_id] = {
            analyte_id: result.analyte_id,
            analyte_name: result.analytes?.name || 'Unknown',
            results: []
          };
        }
        acc[result.analyte_id].results.push(result);
        return acc;
      }, {});

      // Build chart data for each analyte
      const charts: AnalyteChartData[] = Object.values(analyteGroups).map((group: any) => {
        const dataPoints = group.results.map((r: any, index: number) => ({
          date: `${r.qc_runs.run_date} ${r.qc_runs.run_time || ''}`.trim(),
          value: r.observed_value,
          mean: r.target_mean,
          sd: r.target_sd,
          zScore: r.z_score,
          pass: r.pass_fail === 'pass',
          flags: r.westgard_flags || [],
          runId: r.qc_run_id,
          pointIndex: index
        }));

        return {
          analyte_id: group.analyte_id,
          analyte_name: group.analyte_name,
          chartData: {
            analyte: group.analyte_name,
            unit: group.results[0]?.unit || '',
            targetMean: group.results[0]?.target_mean || 0,
            targetSD: group.results[0]?.target_sd || 1,
            dataPoints
          }
        };
      });

      setChartData(charts);
      
      // Auto-select first analyte
      if (charts.length > 0) {
        setSelectedAnalyteId(charts[0].analyte_id);
      }
    } catch (error) {
      console.error('Error loading chart data:', error);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const handleExport = () => {
    // TODO: Implement CSV export
    alert('Export feature coming soon');
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-xl p-6">
          <Loader2 className="h-8 w-8 animate-spin text-indigo-600 mx-auto" />
          <p className="mt-2 text-sm text-gray-600">Loading run details...</p>
        </div>
      </div>
    );
  }

  if (!run) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-xl p-6">
          <p className="text-red-600">Run not found</p>
          <button
            onClick={onClose}
            className="mt-4 px-4 py-2 bg-gray-200 rounded-lg hover:bg-gray-300"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  const selectedChart = chartData.find(c => c.analyte_id === selectedAnalyteId);
  const passCount = results.filter(r => r.pass_fail === 'pass').length;
  const failCount = results.filter(r => r.pass_fail === 'fail').length;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-6xl w-full max-h-[95vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-indigo-600 px-6 py-4 flex items-center justify-between print:bg-white print:text-gray-900">
          <div className="flex items-center space-x-3">
            <FlaskConical className="h-6 w-6 text-white print:text-indigo-600" />
            <div>
              <h2 className="text-xl font-bold text-white print:text-gray-900">
                QC Run Details
              </h2>
              <p className="text-indigo-100 text-sm print:text-gray-600">
                {run.run_date} {run.run_time || ''} - Run #{run.run_number || 1}
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-2 print:hidden">
            <button
              onClick={handleExport}
              className="p-2 text-white hover:text-indigo-100"
              title="Export"
            >
              <Download className="h-5 w-5" />
            </button>
            <button
              onClick={handlePrint}
              className="p-2 text-white hover:text-indigo-100"
              title="Print"
            >
              <Printer className="h-5 w-5" />
            </button>
            <button
              onClick={onClose}
              className="p-2 text-white hover:text-indigo-100"
            >
              <X className="h-6 w-6" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Run Summary */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="flex items-center text-gray-600 mb-1">
                <Calendar className="h-4 w-4 mr-2" />
                <span className="text-xs font-medium">Date & Time</span>
              </div>
              <p className="text-sm font-semibold text-gray-900">
                {run.run_date}<br />{run.run_time || 'N/A'}
              </p>
            </div>

            <div className="bg-gray-50 rounded-lg p-4">
              <div className="flex items-center text-gray-600 mb-1">
                <Activity className="h-4 w-4 mr-2" />
                <span className="text-xs font-medium">Analyzer</span>
              </div>
              <p className="text-sm font-semibold text-gray-900">
                {run.analyzer_name}
              </p>
            </div>

            <div className="bg-gray-50 rounded-lg p-4">
              <div className="flex items-center text-gray-600 mb-1">
                <User className="h-4 w-4 mr-2" />
                <span className="text-xs font-medium">Operator</span>
              </div>
              <p className="text-sm font-semibold text-gray-900">
                {operatorName || 'N/A'}
              </p>
            </div>

            <div className="bg-gray-50 rounded-lg p-4">
              <div className="flex items-center text-gray-600 mb-1">
                <Package className="h-4 w-4 mr-2" />
                <span className="text-xs font-medium">QC Lot</span>
              </div>
              <p className="text-sm font-semibold text-gray-900">
                {lotInfo?.lot_number || 'N/A'}
              </p>
              {lotInfo?.level && (
                <p className="text-xs text-gray-600">{lotInfo.level}</p>
              )}
            </div>
          </div>

          {/* Status Summary */}
          <div className="flex items-center space-x-4 p-4 bg-gray-50 rounded-lg">
            <div className="flex items-center space-x-2">
              <CheckCircle className="h-5 w-5 text-green-600" />
              <span className="text-sm font-medium text-gray-900">
                {passCount} Passed
              </span>
            </div>
            <div className="flex items-center space-x-2">
              <XCircle className="h-5 w-5 text-red-600" />
              <span className="text-sm font-medium text-gray-900">
                {failCount} Failed
              </span>
            </div>
            <div className="ml-auto">
              <span className={`px-3 py-1 text-xs font-medium rounded-full ${
                run.overall_pass
                  ? 'bg-green-100 text-green-700'
                  : 'bg-red-100 text-red-700'
              }`}>
                {run.overall_pass ? 'All Pass' : 'Has Failures'}
              </span>
            </div>
          </div>

          {/* Results Table */}
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
              <h3 className="font-semibold text-gray-900">QC Results</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Analyte
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Observed
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Target Mean
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Target SD
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Z-Score
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Status
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Flags
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {results.map((result: any) => (
                    <tr
                      key={result.id}
                      className={`hover:bg-gray-50 cursor-pointer ${
                        selectedAnalyteId === result.analyte_id ? 'bg-indigo-50' : ''
                      }`}
                      onClick={() => setSelectedAnalyteId(result.analyte_id)}
                    >
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">
                        {result.analytes?.name || 'Unknown'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900">
                        {result.observed_value} {result.unit}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {result.target_mean || 'N/A'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {result.target_sd || 'N/A'}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <span className={`font-medium ${
                          result.z_score && Math.abs(result.z_score) > 2
                            ? 'text-red-600'
                            : result.z_score && Math.abs(result.z_score) > 1
                            ? 'text-yellow-600'
                            : 'text-green-600'
                        }`}>
                          {result.z_score?.toFixed(2) || 'N/A'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {result.pass_fail === 'pass' ? (
                          <span className="inline-flex items-center px-2 py-1 text-xs font-medium rounded-full bg-green-100 text-green-700">
                            <CheckCircle className="h-3 w-3 mr-1" />
                            Pass
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-1 text-xs font-medium rounded-full bg-red-100 text-red-700">
                            <XCircle className="h-3 w-3 mr-1" />
                            Fail
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {result.westgard_flags && result.westgard_flags.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {result.westgard_flags.map((flag: string, i: number) => (
                              <span
                                key={i}
                                className="px-2 py-0.5 text-xs bg-orange-100 text-orange-700 rounded"
                              >
                                {flag}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Levey-Jennings Chart */}
          {selectedChart && (
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-gray-900">
                    Levey-Jennings Chart
                  </h3>
                  <p className="text-sm text-gray-600">
                    {selectedChart.analyte_name} - Last 30 Days
                  </p>
                </div>
                <TrendingUp className="h-5 w-5 text-indigo-600" />
              </div>
              <div className="p-4">
                <LeveyJenningsChart
                  data={selectedChart.chartData}
                  height={400}
                  showSDLines={true}
                  showTrendLine={true}
                  highlightViolations={true}
                />
              </div>
            </div>
          )}

          {/* Analyte Selector */}
          {chartData.length > 1 && (
            <div className="flex flex-wrap gap-2">
              <span className="text-sm font-medium text-gray-700 self-center">
                View chart for:
              </span>
              {chartData.map(chart => (
                <button
                  key={chart.analyte_id}
                  onClick={() => setSelectedAnalyteId(chart.analyte_id)}
                  className={`px-3 py-1.5 text-sm rounded-lg border ${
                    selectedAnalyteId === chart.analyte_id
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  {chart.analyte_name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 px-6 py-4 bg-gray-50 print:hidden">
          <div className="flex items-center justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default QCRunDetails;
