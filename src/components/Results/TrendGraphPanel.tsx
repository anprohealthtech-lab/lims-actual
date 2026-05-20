import React, { useState, useEffect, useMemo } from 'react';
import { TrendingUp, TrendingDown, Minus, Save, AlertCircle, Loader2, FileText, CheckCircle } from 'lucide-react';
import { useTrendGraphs, type TrendGraphData, type TrendAnalyte, type TrendDataPoint } from '../../hooks/useTrendGraphs';
import { aiAnalysis } from '../../utils/supabase';

interface TrendGraphPanelProps {
  orderId: string;
  patientId: string;
  analyteIds: string[];
  analyteNames?: string[]; // Optional: analyte names for better matching
  onSaved?: () => void;
  includeInReport?: boolean;
  onIncludeInReportChange?: (include: boolean) => void;
}

const getAnalyteKey = (analyteId?: string | null, analyteName?: string | null) =>
  (analyteId || analyteName || '').toString().trim().toLowerCase();

const getPointStatus = (
  point: TrendDataPoint,
  referenceRange: TrendAnalyte['reference_range']
): 'high' | 'low' | 'normal' => {
  const flag = point.flag?.toString().trim().toLowerCase();
  if (flag && ['h', 'high', 'c', 'critical', 'critical_h', 'critical_high'].includes(flag)) {
    return 'high';
  }
  if (flag && ['l', 'low', 'critical_l', 'critical_low'].includes(flag)) {
    return 'low';
  }
  if (Number.isFinite(referenceRange.max) && referenceRange.max > 0 && point.value > referenceRange.max) {
    return 'high';
  }
  if (Number.isFinite(referenceRange.min) && point.value < referenceRange.min) {
    return 'low';
  }
  return 'normal';
};

const getPointColor = (status: 'high' | 'low' | 'normal') => {
  if (status === 'high') return '#ef4444';
  if (status === 'low') return '#3b82f6';
  return '#22c55e';
};

const TrendGraphPanel: React.FC<TrendGraphPanelProps> = ({
  orderId,
  patientId,
  analyteIds,
  analyteNames,
  onSaved,
  includeInReport = false,
  onIncludeInReportChange
}) => {
  const { generateAndSaveTrends, loadTrendData, error, clearError } = useTrendGraphs();
  const [trendData, setTrendData] = useState<TrendGraphData | null>(null);
  const [hasExisting, setHasExisting] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true); // Separate loading state for initial fetch
  const [generating, setGenerating] = useState(false); // Separate state for generating new data
  const [localIncludeInReport, setLocalIncludeInReport] = useState(includeInReport);
  const [savingReportFlag, setSavingReportFlag] = useState(false);
  const [savedReportFlag, setSavedReportFlag] = useState(false);

  const selectableAnalytes = useMemo(() => {
    const byKey = new Map<string, { key: string; analyteId?: string; name: string }>();

    analyteNames?.forEach((name, index) => {
      const analyteId = analyteIds[index];
      const key = getAnalyteKey(analyteId, name);
      if (key && !byKey.has(key)) {
        byKey.set(key, { key, analyteId, name });
      }
    });

    analyteIds.forEach((analyteId, index) => {
      const name = analyteNames?.[index] || analyteId;
      const key = getAnalyteKey(analyteId, name);
      if (key && !byKey.has(key)) {
        byKey.set(key, { key, analyteId, name });
      }
    });

    trendData?.analytes?.forEach((analyte) => {
      const key = getAnalyteKey(analyte.analyte_id, analyte.analyte_name);
      if (key && !byKey.has(key)) {
        byKey.set(key, {
          key,
          analyteId: analyte.analyte_id,
          name: analyte.analyte_name,
        });
      }
    });

    return Array.from(byKey.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [analyteIds, analyteNames, trendData]);

  const [selectedAnalyteKeys, setSelectedAnalyteKeys] = useState<string[]>([]);
  const [hasInitializedSelection, setHasInitializedSelection] = useState(false);

  // Load existing trend data on mount and whenever the order changes
  useEffect(() => {
    let isMounted = true;
    const loadExisting = async () => {
      setInitialLoading(true);
      try {
        const result = await loadTrendData(orderId);
        if (!isMounted) return;
        
        if (result.success && result.data) {
          setTrendData(result.data);
          setHasExisting(true);
          // Load the include_in_report flag from saved data
          if (result.data.include_in_report !== undefined) {
            setLocalIncludeInReport(result.data.include_in_report);
          }
          const savedSelectedKeys = result.data.selected_analyte_keys;
          if (Array.isArray(savedSelectedKeys)) {
            setSelectedAnalyteKeys(savedSelectedKeys);
            setHasInitializedSelection(true);
          }
        }
      } catch (err) {
        console.error('Error loading trend data:', err);
      } finally {
        if (isMounted) {
          setInitialLoading(false);
        }
      }
    };
    loadExisting();
    
    return () => {
      isMounted = false;
    };
  }, [orderId]); // Only depend on orderId, not on loadTrendData function

  // Reset order-scoped UI state when orderId changes
  useEffect(() => {
    setTrendData(null);
    setHasExisting(false);
    setSelectedAnalyteKeys([]);
    setHasInitializedSelection(false);
  }, [orderId]);

  // Sync with parent state
  useEffect(() => {
    setLocalIncludeInReport(includeInReport);
  }, [includeInReport]);

  useEffect(() => {
    if (hasInitializedSelection || selectableAnalytes.length === 0) return;
    setSelectedAnalyteKeys(selectableAnalytes.map((analyte) => analyte.key));
    setHasInitializedSelection(true);
  }, [selectableAnalytes, hasInitializedSelection]);

  const selectedAnalytes = useMemo(
    () => selectableAnalytes.filter((analyte) => selectedAnalyteKeys.includes(analyte.key)),
    [selectableAnalytes, selectedAnalyteKeys]
  );

  const generatedSelectedKeys = useMemo(() => {
    const generatedKeys = new Set(
      trendData?.analytes?.map((analyte) => getAnalyteKey(analyte.analyte_id, analyte.analyte_name)) || []
    );
    return selectedAnalyteKeys.filter((key) => generatedKeys.has(key));
  }, [selectedAnalyteKeys, trendData]);

  const toggleAnalyteSelection = (key: string) => {
    setHasInitializedSelection(true);
    setSelectedAnalyteKeys((prev) =>
      prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]
    );
  };

  const setAllAnalytesSelected = (selected: boolean) => {
    setHasInitializedSelection(true);
    setSelectedAnalyteKeys(selected ? selectableAnalytes.map((analyte) => analyte.key) : []);
  };

  const handleIncludeInReportChange = async (include: boolean) => {
    setLocalIncludeInReport(include);
    onIncludeInReportChange?.(include);
    
    // Save to database (this also generates images when including in report)
    setSavingReportFlag(true);
    setSavedReportFlag(false);
    try {
      const keysForReport = generatedSelectedKeys.length > 0 ? generatedSelectedKeys : selectedAnalyteKeys;
      const { error: saveError } = await aiAnalysis.updateTrendIncludeInReport(orderId, include, keysForReport);
      if (saveError) {
        console.error('Failed to save include in report flag:', saveError);
      } else {
        setSavedReportFlag(true);
        // Reload trend data to get the new image URLs
        if (include) {
          const result = await loadTrendData(orderId);
          if (result.success && result.data) {
            setTrendData(result.data);
          }
        }
        setTimeout(() => setSavedReportFlag(false), 2000);
      }
    } catch (err) {
      console.error('Error saving include in report flag:', err);
    } finally {
      setSavingReportFlag(false);
    }
  };

  const handleGenerateAndSave = async () => {
    clearError();
    if (selectedAnalytes.length === 0) {
      return;
    }
    setGenerating(true);
    const result = await generateAndSaveTrends(
      orderId,
      patientId,
      selectedAnalytes.map((analyte) => analyte.analyteId).filter(Boolean) as string[],
      selectedAnalytes.map((analyte) => analyte.name),
      selectedAnalytes.map((analyte) => analyte.key)
    );

    if (result.success && result.data) {
      setTrendData(result.data);
      setHasExisting(true);
      onSaved?.();
    }
    setGenerating(false);
  };

  const getTrendIcon = (trend: TrendAnalyte['trend']) => {
    switch (trend) {
      case 'increasing':
        return <TrendingUp className="w-4 h-4 text-red-600" />;
      case 'decreasing':
        return <TrendingDown className="w-4 h-4 text-blue-600" />;
      case 'stable':
        return <Minus className="w-4 h-4 text-green-600" />;
      default:
        return <Minus className="w-4 h-4 text-gray-400" />;
    }
  };

  const getTrendBadgeColor = (trend: TrendAnalyte['trend']) => {
    switch (trend) {
      case 'increasing':
        return 'bg-red-100 text-red-700';
      case 'decreasing':
        return 'bg-blue-100 text-blue-700';
      case 'stable':
        return 'bg-green-100 text-green-700';
      default:
        return 'bg-gray-100 text-gray-600';
    }
  };

  // Show loading state while fetching existing data
  if (initialLoading) {
    return (
      <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-blue-600" />
          <h3 className="text-lg font-semibold text-gray-900">Historical Trends</h3>
        </div>
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 text-blue-600 animate-spin" />
          <span className="ml-2 text-gray-600">Loading trends...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-blue-600" />
          <h3 className="text-lg font-semibold text-gray-900">Historical Trends</h3>
          {hasExisting && (
            <span className="px-2 py-0.5 text-xs bg-blue-100 text-blue-700 rounded-full">
              Saved
            </span>
          )}
        </div>
        
        <div className="flex items-center gap-4">
          {/* Include in Report Checkbox - only show when trends exist */}
          {hasExisting && (
            <label className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
              localIncludeInReport 
                ? 'bg-green-100 border-2 border-green-400' 
                : 'bg-gray-50 border border-gray-200 hover:bg-gray-100'
            }`}>
              <input
                type="checkbox"
                checked={localIncludeInReport}
                onChange={(e) => handleIncludeInReportChange(e.target.checked)}
                disabled={savingReportFlag}
                className="w-4 h-4 text-green-600 rounded border-green-300 focus:ring-green-500"
              />
              {savingReportFlag ? (
                <Loader2 className="w-4 h-4 text-green-600 animate-spin" />
              ) : savedReportFlag ? (
                <CheckCircle className="w-4 h-4 text-green-600" />
              ) : (
                <FileText className={`w-4 h-4 ${localIncludeInReport ? 'text-green-600' : 'text-gray-500'}`} />
              )}
              <span className={`text-sm font-medium ${localIncludeInReport ? 'text-green-700' : 'text-gray-600'}`}>
                {savingReportFlag ? 'Generating images...' : savedReportFlag ? 'Saved!' : 'Add to Final Report'}
              </span>
            </label>
          )}
          
          <button
            onClick={handleGenerateAndSave}
            disabled={generating || selectedAnalytes.length === 0}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {generating ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            {generating ? 'Generating...' : hasExisting ? 'Regenerate Trends' : 'Generate & Save Trends'}
          </button>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg mb-4">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {selectableAnalytes.length > 0 && (
        <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <div>
              <p className="text-sm font-semibold text-gray-800">Select analytes for trend</p>
              <p className="text-xs text-gray-500">
                {selectedAnalytes.length} of {selectableAnalytes.length} selected
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setAllAnalytesSelected(true)}
                className="text-xs font-medium text-blue-700 hover:text-blue-800"
              >
                Select all
              </button>
              <span className="text-gray-300">|</span>
              <button
                type="button"
                onClick={() => setAllAnalytesSelected(false)}
                className="text-xs font-medium text-gray-600 hover:text-gray-800"
              >
                Clear
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {selectableAnalytes.map((analyte) => (
              <label
                key={analyte.key}
                className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm cursor-pointer transition-colors ${
                  selectedAnalyteKeys.includes(analyte.key)
                    ? 'border-blue-300 bg-blue-50 text-blue-800'
                    : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-100'
                }`}
              >
                <input
                  type="checkbox"
                  checked={selectedAnalyteKeys.includes(analyte.key)}
                  onChange={() => toggleAnalyteSelection(analyte.key)}
                  className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                />
                <span className="truncate">{analyte.name}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Trend Visualization */}
      {trendData && trendData.analytes && trendData.analytes.length > 0 ? (
        <div className="space-y-6">
          {trendData.analytes.map((analyte) => (
            <TrendLineChart 
              key={analyte.analyte_id} 
              analyte={analyte} 
              getTrendIcon={getTrendIcon}
              getTrendBadgeColor={getTrendBadgeColor}
            />
          ))}
        </div>
      ) : !generating && !error ? (
        <div className="text-center py-12 text-gray-500">
          <TrendingUp className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-sm">Click "Generate & Save Trends" to analyze historical data</p>
          {analyteIds.length === 0 && (
            <p className="text-xs text-red-600 mt-1">No analytes available for trend analysis</p>
          )}
        </div>
      ) : null}
    </div>
  );
};

// Proper Line Chart Component with X/Y axes
const TrendLineChart: React.FC<{
  analyte: TrendAnalyte;
  getTrendIcon: (trend: TrendAnalyte['trend']) => React.ReactNode;
  getTrendBadgeColor: (trend: TrendAnalyte['trend']) => string;
}> = ({ analyte, getTrendIcon, getTrendBadgeColor }) => {
  const chartHeight = 180;
  const paddingLeft = 50;
  const paddingRight = 20;
  const paddingTop = 20;
  const paddingBottom = 40;
  
  const { dataPoints, yAxisLabels, yMin, yMax, refMinY, refMaxY } = useMemo(() => {
    const points = analyte.dataPoints || [];
    if (points.length === 0) {
      return { dataPoints: [], yAxisLabels: [], yMin: 0, yMax: 100, refMinY: 0, refMaxY: 0 };
    }
    
    const values = points.map(p => p.value);
    const allValues = [...values, analyte.reference_range.min, analyte.reference_range.max];
    const minVal = Math.min(...allValues);
    const maxVal = Math.max(...allValues);
    
    // Add 20% padding to range
    const range = maxVal - minVal || 1;
    const yMin = Math.max(0, minVal - range * 0.1);
    const yMax = maxVal + range * 0.2;
    
    // Generate Y axis labels
    const stepCount = 5;
    const step = (yMax - yMin) / stepCount;
    const yAxisLabels = Array.from({ length: stepCount + 1 }, (_, i) => 
      Math.round((yMin + step * i) * 10) / 10
    );
    
    // Calculate reference range Y positions as percentages
    const refMinY = ((analyte.reference_range.min - yMin) / (yMax - yMin)) * 100;
    const refMaxY = ((analyte.reference_range.max - yMin) / (yMax - yMin)) * 100;
    
    return { dataPoints: points, yAxisLabels, yMin, yMax, refMinY, refMaxY };
  }, [analyte]);

  if (dataPoints.length === 0) {
    return (
      <div className="border rounded-lg p-4 bg-gray-50 text-center text-gray-500">
        No data points for {analyte.analyte_name}
      </div>
    );
  }

  // Calculate point positions
  const getPointPosition = (point: TrendDataPoint, index: number) => {
    const xPercent = dataPoints.length === 1 ? 50 : (index / (dataPoints.length - 1)) * 100;
    const yPercent = ((point.value - yMin) / (yMax - yMin)) * 100;
    return { x: xPercent, y: 100 - yPercent }; // Invert Y for SVG
  };

  // Generate SVG path for line
  const linePath = dataPoints.map((point, idx) => {
    const { x, y } = getPointPosition(point, idx);
    return `${idx === 0 ? 'M' : 'L'} ${x} ${y}`;
  }).join(' ');

  return (
    <div className="border rounded-lg p-4 bg-gray-50">
      {/* Analyte Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h4 className="font-semibold text-gray-900">{analyte.analyte_name}</h4>
          <p className="text-xs text-gray-500 mt-0.5">
            Reference: {analyte.reference_range.min} - {analyte.reference_range.max} {analyte.unit}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {getTrendIcon(analyte.trend)}
          <span className={`px-2 py-1 rounded-full text-xs font-medium ${getTrendBadgeColor(analyte.trend)}`}>
            {analyte.trend === 'insufficient_data' ? 'Limited Data' : analyte.trend.charAt(0).toUpperCase() + analyte.trend.slice(1)}
          </span>
        </div>
      </div>

      {/* Chart Container */}
      <div className="relative bg-white rounded-lg border border-gray-200 p-2" style={{ height: chartHeight }}>
        {/* Y-Axis Labels */}
        <div 
          className="absolute left-0 top-0 bottom-0 flex flex-col justify-between text-xs text-gray-500 pr-2"
          style={{ width: paddingLeft - 8, paddingTop: paddingTop - 10, paddingBottom: paddingBottom - 10 }}
        >
          {[...yAxisLabels].reverse().map((label, idx) => (
            <span key={idx} className="text-right">{label}</span>
          ))}
        </div>

        {/* Chart Area */}
        <div 
          className="absolute"
          style={{ 
            left: paddingLeft, 
            right: paddingRight, 
            top: paddingTop, 
            bottom: paddingBottom 
          }}
        >
          {/* Reference Range Shading */}
          <div 
            className="absolute left-0 right-0 bg-green-100 opacity-50 border-y border-green-300 border-dashed"
            style={{ 
              bottom: `${refMinY}%`, 
              height: `${refMaxY - refMinY}%`
            }}
          />
          
          {/* Grid Lines */}
          {yAxisLabels.map((_, idx) => (
            <div 
              key={idx}
              className="absolute left-0 right-0 border-t border-gray-100"
              style={{ bottom: `${(idx / (yAxisLabels.length - 1)) * 100}%` }}
            />
          ))}

          {/* SVG Line Chart */}
          <svg 
            className="absolute inset-0 w-full h-full" 
            viewBox="0 0 100 100" 
            preserveAspectRatio="none"
          >
            {/* Reference range lines */}
            <line 
              x1="0" y1={100 - refMaxY} 
              x2="100" y2={100 - refMaxY} 
              stroke="#16a34a" 
              strokeWidth="0.5" 
              strokeDasharray="2,2"
            />
            <line 
              x1="0" y1={100 - refMinY} 
              x2="100" y2={100 - refMinY} 
              stroke="#16a34a" 
              strokeWidth="0.5" 
              strokeDasharray="2,2"
            />
            
            {/* Trend Line */}
            <path 
              d={linePath} 
              fill="none" 
              stroke="#3b82f6" 
              strokeWidth="2" 
              vectorEffect="non-scaling-stroke"
            />
            
	            {/* Data Points */}
	            {dataPoints.map((point, idx) => {
	              const { x, y } = getPointPosition(point, idx);
	              const status = getPointStatus(point, analyte.reference_range);
	              const color = getPointColor(status);

	              return (
	                <g key={idx}>
	                  <ellipse
	                    cx={x}
	                    cy={y}
	                    rx="0.75"
	                    ry="2.4"
	                    fill={color}
	                    stroke="white"
	                    strokeWidth="0.8"
	                    vectorEffect="non-scaling-stroke"
	                    className="cursor-pointer"
	                  />
                </g>
              );
            })}
          </svg>

          {/* Hover Tooltips - positioned outside SVG for proper sizing */}
          {dataPoints.map((point, idx) => {
            const { x, y } = getPointPosition(point, idx);
            const displayDate = point.timestamp 
              ? new Date(point.timestamp)
              : new Date(point.date);
            return (
              <div 
                key={`tooltip-${idx}`}
                className="absolute w-3 h-3 cursor-pointer group"
                style={{ 
                  left: `calc(${x}% - 6px)`, 
                  top: `calc(${y}% - 6px)`
                }}
                title={`${displayDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} ${point.timestamp ? displayDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : ''}: ${point.value} ${analyte.unit}${point.flag ? ` (${point.flag})` : ''}`}
              >
                <div className="hidden group-hover:block absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-gray-900 text-white text-xs rounded whitespace-nowrap z-10">
                  <div className="font-medium">{point.value} {analyte.unit}</div>
	                  <div className="text-gray-300">
	                    {displayDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
	                    {point.timestamp && ` ${displayDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`}
	                  </div>
	                  <div className={getPointStatus(point, analyte.reference_range) === 'high' ? 'text-red-300' : getPointStatus(point, analyte.reference_range) === 'low' ? 'text-blue-300' : 'text-green-300'}>
	                    {getPointStatus(point, analyte.reference_range) === 'high' ? 'High' : getPointStatus(point, analyte.reference_range) === 'low' ? 'Low' : 'Normal'}
	                    {point.flag ? ` (${point.flag})` : ''}
	                  </div>
	                </div>
	              </div>
            );
          })}
        </div>

        {/* X-Axis Labels */}
        <div 
          className="absolute left-0 right-0 bottom-0 flex justify-between text-xs text-gray-500"
          style={{ 
            left: paddingLeft, 
            right: paddingRight, 
            height: paddingBottom - 5,
            paddingTop: 5 
          }}
        >
          {dataPoints.map((point, idx) => {
            // Use timestamp if available for better distinction, fallback to date
            const displayDate = point.timestamp 
              ? new Date(point.timestamp)
              : new Date(point.date);
            // For same-day entries, show time as well
            const sameDayEntries = dataPoints.filter(p => p.date === point.date).length;
            const showTime = sameDayEntries > 1 && point.timestamp;
            
            return (
              <span 
                key={idx} 
                className="text-center whitespace-nowrap"
                style={{ 
                  position: 'absolute',
                  left: `${dataPoints.length === 1 ? 50 : (idx / (dataPoints.length - 1)) * 100}%`,
                  transform: 'translateX(-50%)',
                  fontSize: dataPoints.length > 5 ? '9px' : '11px'
                }}
              >
                {displayDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                {showTime && (
                  <span className="block text-gray-400" style={{ fontSize: '8px' }}>
                    {displayDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </span>
            );
          })}
        </div>

        {/* Y-Axis Title */}
        <div 
          className="absolute text-xs text-gray-500 font-medium"
          style={{ 
            left: 2, 
            top: '50%', 
            transform: 'rotate(-90deg) translateX(-50%)',
            transformOrigin: 'left center'
          }}
        >
          {analyte.unit}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-4 mt-3 text-xs">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-full bg-green-500"></div>
          <span className="text-gray-600">Normal</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-full bg-red-500"></div>
          <span className="text-gray-600">High</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-full bg-blue-500"></div>
          <span className="text-gray-600">Low</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-8 h-2 bg-green-100 border border-green-300"></div>
          <span className="text-gray-600">Reference Range</span>
        </div>
      </div>

      {/* Data point count */}
      <p className="text-xs text-gray-500 mt-2 text-center">
        {dataPoints.length} data point{dataPoints.length !== 1 ? 's' : ''} over 12 months
      </p>
    </div>
  );
};

export default TrendGraphPanel;
