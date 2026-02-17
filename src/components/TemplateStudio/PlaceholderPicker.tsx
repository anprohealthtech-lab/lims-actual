import React, { useEffect, useMemo, useState } from 'react';

type PlaceholderGroup = 'lab' | 'test' | 'patient' | 'branding' | 'signature' | 'section';
type BrandingAssetType = 'header' | 'footer' | 'watermark' | 'logo' | 'letterhead';

interface PlaceholderOption {
  id: string;
  label: string;
  placeholder: string;
  unit?: string | null;
  referenceRange?: string | null;
  group?: PlaceholderGroup;
  assetType?: BrandingAssetType | 'signature';
  variantKey?: string | null;
  preferredWidth?: number | null;
  preferredHeight?: number | null;
  removeBackground?: boolean;
}

// Grouped analyte structure for analyte-centric view
interface AnalyteGroup {
  baseName: string;
  baseLabel: string;
  value?: PlaceholderOption;
  unit?: PlaceholderOption;
  reference?: PlaceholderOption;
  flag?: PlaceholderOption;
  note?: PlaceholderOption;
  method?: PlaceholderOption;
}

interface PlaceholderPickerProps {
  options: PlaceholderOption[];
  onInsert: (option: PlaceholderOption) => void;
  onClose: () => void;
  onRefresh?: () => void;
  loading?: boolean;
  errorMessage?: string | null;
}

const PlaceholderPicker: React.FC<PlaceholderPickerProps> = ({ options, onInsert, onClose, onRefresh, loading = false, errorMessage = null }) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [selectedPlaceholders, setSelectedPlaceholders] = useState<Set<string>>(new Set());
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  
  // Group options by category
  const grouped = useMemo(() => {
    const result: Record<PlaceholderGroup, PlaceholderOption[]> = {
      lab: [],
      test: [],
      patient: [],
      branding: [],
      signature: [],
      section: [],
    };
    options.forEach((option) => {
      const bucket = option.group ?? 'lab';
      if (!result[bucket]) {
        result[bucket as PlaceholderGroup] = [];
      }
      result[bucket as PlaceholderGroup].push(option);
    });
    return result;
  }, [options]);

  // Create analyte-centric groups for test placeholders
  const analyteGroups = useMemo(() => {
    const testOptions = grouped.test;
    const groups: Map<string, AnalyteGroup> = new Map();

    testOptions.forEach((option) => {
      const placeholder = option.placeholder;
      // Detect if this is a variation (_UNIT, _REFERENCE, _REF_RANGE, _FLAG, _NOTE)
      // Support both _REFERENCE (new) and _REF_RANGE (legacy) for backwards compatibility
      const suffixes = ['_UNIT', '_REFERENCE', '_REF_RANGE', '_FLAG', '_NOTE', '_METHOD'];
      let basePlaceholder = placeholder;
      let variationType: 'value' | 'unit' | 'reference' | 'flag' | 'note' | 'method' = 'value';

      for (const suffix of suffixes) {
        if (placeholder.endsWith(suffix + '}}')) {
          basePlaceholder = placeholder.replace(suffix + '}}', '}}');
          if (suffix === '_UNIT') variationType = 'unit';
          else if (suffix === '_REFERENCE' || suffix === '_REF_RANGE') variationType = 'reference';
          else if (suffix === '_FLAG') variationType = 'flag';
          else if (suffix === '_NOTE') variationType = 'note';
          else if (suffix === '_METHOD') variationType = 'method';
          break;
        }
      }

      // Also check for _VALUE suffix (new pattern: ANALYTE_CODE_VALUE)
      if (placeholder.endsWith('_VALUE}}')) {
        basePlaceholder = placeholder.replace('_VALUE}}', '}}');
        variationType = 'value';
      }

      // Get or create the analyte group
      if (!groups.has(basePlaceholder)) {
        // Extract base label (remove suffix like " (Unit)", " (Reference)", etc.)
        let baseLabel = option.label;
        if (variationType !== 'value') {
          baseLabel = option.label
            .replace(/ \(Unit\)$/i, '')
            .replace(/ \(Reference\)$/i, '')
            .replace(/ \(Flag\)$/i, '')
            .replace(/ \(Note\)$/i, '')
            .replace(/ \(Method\)$/i, '');
        }
        groups.set(basePlaceholder, {
          baseName: basePlaceholder,
          baseLabel: baseLabel,
        });
      }

      const group = groups.get(basePlaceholder)!;
      group[variationType] = option;

      // Update base label if we found the value option (most accurate label)
      if (variationType === 'value') {
        group.baseLabel = option.label;
      }
    });

    return Array.from(groups.values());
  }, [grouped.test]);

  const [activeOption, setActiveOption] = useState<PlaceholderOption | null>(null);
  const [copyState, setCopyState] = useState<'success' | 'error' | null>(null);
  const [activeTab, setActiveTab] = useState<'test' | 'other'>('test');
  const [expandedAnalytes, setExpandedAnalytes] = useState<Set<string>>(new Set());
  const [lastAction, setLastAction] = useState<{ type: 'copy' | 'insert'; placeholder: string } | null>(null);

  useEffect(() => {
    setActiveOption(options.length ? options[0] : null);
    setCopyState(null);
  }, [options]);

  const handleSelect = (option: PlaceholderOption) => {
    setActiveOption(option);
    setCopyState(null);
  };

  const handleCopy = async () => {
    if (!activeOption) {
      return;
    }

    try {
      if (!navigator?.clipboard) {
        throw new Error('Clipboard API unavailable');
      }
      await navigator.clipboard.writeText(activeOption.placeholder);
      setCopyState('success');
      window.setTimeout(() => setCopyState(null), 2000);
    } catch (err) {
      console.warn('Failed to copy placeholder:', err);
      setCopyState('error');
      window.setTimeout(() => setCopyState(null), 3000);
    }
  };

  const handleInsert = () => {
    if (!activeOption) {
      return;
    }
    onInsert(activeOption);
  };

  const handleToggleSelection = (placeholder: string) => {
    setSelectedPlaceholders((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(placeholder)) {
        newSet.delete(placeholder);
      } else {
        newSet.add(placeholder);
      }
      return newSet;
    });
  };

  const handleCopySelected = async () => {
    if (selectedPlaceholders.size === 0) return;

    try {
      const selectedText = Array.from(selectedPlaceholders).join('\n');
      if (!navigator?.clipboard) {
        throw new Error('Clipboard API unavailable');
      }
      await navigator.clipboard.writeText(selectedText);
      setCopyState('success');
      window.setTimeout(() => setCopyState(null), 2000);
    } catch (err) {
      console.warn('Failed to copy placeholders:', err);
      setCopyState('error');
      window.setTimeout(() => setCopyState(null), 3000);
    }
  };

  const handleClearSelection = () => {
    setSelectedPlaceholders(new Set());
  };

  // Quick copy a placeholder directly
  const handleQuickCopy = async (option: PlaceholderOption) => {
    try {
      if (!navigator?.clipboard) {
        throw new Error('Clipboard API unavailable');
      }
      await navigator.clipboard.writeText(option.placeholder);
      setLastAction({ type: 'copy', placeholder: option.placeholder });
      window.setTimeout(() => setLastAction(null), 1500);
    } catch (err) {
      console.warn('Failed to copy placeholder:', err);
    }
  };

  // Quick insert a placeholder directly
  const handleQuickInsert = (option: PlaceholderOption) => {
    onInsert(option);
    setLastAction({ type: 'insert', placeholder: option.placeholder });
    window.setTimeout(() => setLastAction(null), 1500);
  };

  // Toggle analyte expansion
  const toggleAnalyteExpand = (baseName: string) => {
    setExpandedAnalytes((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(baseName)) {
        newSet.delete(baseName);
      } else {
        newSet.add(baseName);
      }
      return newSet;
    });
  };

  const renderGroup = (groupKey: PlaceholderGroup, emptyText: string) => {
    const bucket = grouped[groupKey];
    if (!bucket.length) {
      return (
        <div className="rounded-md border border-dashed border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500">
          {emptyText}
        </div>
      );
    }

    return (
      <ul className="max-h-48 space-y-2 overflow-y-auto">
        {bucket.map((option) => {
          const isActive = activeOption?.placeholder === option.placeholder;
          const isSelected = selectedPlaceholders.has(option.placeholder);
          return (
            <li key={`${groupKey}-${option.id}`}>
              <div
                className={`w-full rounded-md border px-3 py-2 text-xs transition ${
                  isActive
                    ? 'border-blue-400 bg-blue-50 text-blue-900'
                    : 'border-gray-200 bg-white text-gray-700 hover:border-blue-300 hover:bg-blue-50'
                }`}
              >
                <div className="flex items-start gap-2">
                  {multiSelectMode && (
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => handleToggleSelection(option.placeholder)}
                      className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => handleSelect(option)}
                    className="flex-1 text-left focus:outline-none"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{option.label}</span>
                      <code className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600">{option.placeholder}</code>
                    </div>
                    {(option.unit || option.referenceRange) && (
                      <p className="mt-1 text-[11px] text-gray-500">
                        {option.unit ? `Unit: ${option.unit}` : ''}
                        {option.unit && option.referenceRange ? ' · ' : ''}
                        {option.referenceRange ? `Reference: ${option.referenceRange}` : ''}
                      </p>
                    )}
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    );
  };

  const GROUP_META: Array<{ key: PlaceholderGroup; title: string; empty: string }> = [
    { key: 'lab', title: 'Lab', empty: 'No lab-level analytes available.' },
    { key: 'test', title: 'Test Group', empty: 'Select a test group to view analytes.' },
    { key: 'patient', title: 'Patient', empty: 'Patient-specific placeholders appear here.' },
    { key: 'section', title: 'Report Sections', empty: 'Doctor-filled content sections (findings, impressions, etc.).' },
    { key: 'signature', title: 'Signatures', empty: 'Approver signature and details.' },
    { key: 'branding', title: 'Branding Assets', empty: 'Upload and set a default branding asset to surface it here.' },
  ];

  // Render a quick-action button for analyte placeholder types
  const renderQuickButton = (
    option: PlaceholderOption | undefined,
    label: string,
    colorClass: string,
    hoverClass: string
  ) => {
    if (!option) return null;
    const isJustActioned = lastAction?.placeholder === option.placeholder;
    return (
      <div className="relative">
        <button
          type="button"
          onClick={() => handleQuickInsert(option)}
          onContextMenu={(e) => {
            e.preventDefault();
            handleQuickCopy(option);
          }}
          className={`rounded px-2 py-1 text-[10px] font-medium transition ${colorClass} ${hoverClass} ${
            isJustActioned ? 'ring-2 ring-green-400 ring-offset-1' : ''
          }`}
          title={`Click to insert, Right-click to copy\n${option.placeholder}`}
        >
          {label}
        </button>
        {isJustActioned && (
          <span className="absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-green-600 px-1.5 py-0.5 text-[9px] text-white">
            {lastAction?.type === 'copy' ? 'Copied!' : 'Inserted!'}
          </span>
        )}
      </div>
    );
  };

  // Render analyte-centric view for test group placeholders
  const renderAnalyteCentricView = () => {
    if (analyteGroups.length === 0) {
      return (
        <div className="rounded-md border border-dashed border-gray-200 bg-gray-50 px-4 py-8 text-center text-sm text-gray-500">
          Select a test group to view analyte placeholders.
        </div>
      );
    }

    return (
      <div className="space-y-2 max-h-[400px] overflow-y-auto">
        {analyteGroups.map((analyte) => {
          const isExpanded = expandedAnalytes.has(analyte.baseName);
          return (
            <div
              key={analyte.baseName}
              className="rounded-lg border border-gray-200 bg-white overflow-hidden"
            >
              {/* Analyte header row with quick buttons */}
              <div className="flex items-center gap-2 px-3 py-2 bg-gray-50">
                <button
                  type="button"
                  onClick={() => toggleAnalyteExpand(analyte.baseName)}
                  className="text-gray-400 hover:text-gray-600 flex-shrink-0"
                >
                  {isExpanded ? '▼' : '▶'}
                </button>
                <span className="font-medium text-sm text-gray-900 flex-1 min-w-0 truncate">
                  {analyte.baseLabel}
                </span>
                {/* Quick action buttons */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  {renderQuickButton(
                    analyte.value,
                    'Value',
                    'bg-blue-100 text-blue-700',
                    'hover:bg-blue-200'
                  )}
                  {renderQuickButton(
                    analyte.unit,
                    'Unit',
                    'bg-purple-100 text-purple-700',
                    'hover:bg-purple-200'
                  )}
                  {renderQuickButton(
                    analyte.reference,
                    'Ref',
                    'bg-amber-100 text-amber-700',
                    'hover:bg-amber-200'
                  )}
                  {renderQuickButton(
                    analyte.flag,
                    'Flag',
                    'bg-rose-100 text-rose-700',
                    'hover:bg-rose-200'
                  )}
                  {renderQuickButton(
                    analyte.method,
                    'Method',
                    'bg-teal-100 text-teal-700',
                    'hover:bg-teal-200'
                  )}
                </div>
              </div>

              {/* Expanded details */}
              {isExpanded && (
                <div className="px-3 py-2 border-t border-gray-100 bg-white space-y-2">
                  {analyte.value && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-gray-600">Result Value:</span>
                      <code className="bg-blue-50 text-blue-800 px-2 py-0.5 rounded text-[10px]">
                        {analyte.value.placeholder}
                      </code>
                    </div>
                  )}
                  {analyte.unit && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-gray-600">Unit:</span>
                      <code className="bg-purple-50 text-purple-800 px-2 py-0.5 rounded text-[10px]">
                        {analyte.unit.placeholder}
                      </code>
                    </div>
                  )}
                  {analyte.reference && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-gray-600">Reference Range:</span>
                      <code className="bg-amber-50 text-amber-800 px-2 py-0.5 rounded text-[10px]">
                        {analyte.reference.placeholder}
                      </code>
                    </div>
                  )}
                  {analyte.flag && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-gray-600">Flag (H/L):</span>
                      <code className="bg-rose-50 text-rose-800 px-2 py-0.5 rounded text-[10px]">
                        {analyte.flag.placeholder}
                      </code>
                    </div>
                  )}
                  {analyte.note && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-gray-600">Note:</span>
                      <code className="bg-gray-100 text-gray-800 px-2 py-0.5 rounded text-[10px]">
                        {analyte.note.placeholder}
                      </code>
                    </div>
                  )}
                  {analyte.method && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-gray-600">Methodology:</span>
                      <code className="bg-teal-50 text-teal-800 px-2 py-0.5 rounded text-[10px]">
                        {analyte.method.placeholder}
                      </code>
                    </div>
                  )}
                  {analyte.value?.unit && (
                    <div className="text-[11px] text-gray-500 pt-1 border-t border-gray-100">
                      Default Unit: {analyte.value.unit}
                      {analyte.value.referenceRange && ` · Reference: ${analyte.value.referenceRange}`}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  // Render other placeholders (non-test) in a cleaner layout
  const renderOtherPlaceholders = () => {
    const otherGroups: Array<{ key: PlaceholderGroup; title: string; empty: string }> = [
      { key: 'patient', title: 'Patient Info', empty: 'No patient placeholders available.' },
      { key: 'lab', title: 'Lab Info', empty: 'No lab placeholders available.' },
      { key: 'section', title: 'Report Sections', empty: 'No section placeholders available.' },
      { key: 'signature', title: 'Signatures', empty: 'No signatures configured.' },
      { key: 'branding', title: 'Branding Assets', empty: 'No branding assets configured.' },
    ];

    return (
      <div className="space-y-4 max-h-[400px] overflow-y-auto">
        {otherGroups.map(({ key, title, empty }) => {
          const items = grouped[key];
          if (items.length === 0) return null;

          return (
            <div key={key}>
              <h4 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-2">
                {title}
              </h4>
              <div className="grid grid-cols-2 gap-2">
                {items.map((option) => {
                  const isJustActioned = lastAction?.placeholder === option.placeholder;
                  return (
                    <div
                      key={option.id}
                      className={`relative rounded-md border px-3 py-2 text-xs transition cursor-pointer ${
                        isJustActioned
                          ? 'border-green-400 bg-green-50'
                          : 'border-gray-200 bg-white hover:border-blue-300 hover:bg-blue-50'
                      }`}
                      onClick={() => handleQuickInsert(option)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        handleQuickCopy(option);
                      }}
                      title={`Click to insert, Right-click to copy\n${option.placeholder}`}
                    >
                      <div className="font-medium text-gray-900 truncate">{option.label}</div>
                      <code className="text-[9px] text-gray-500 block truncate">
                        {option.placeholder}
                      </code>
                      {isJustActioned && (
                        <span className="absolute -top-2 right-2 rounded bg-green-600 px-1.5 py-0.5 text-[9px] text-white">
                          {lastAction?.type === 'copy' ? 'Copied!' : 'Inserted!'}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className={`fixed ${isCollapsed ? 'bottom-4 right-4' : 'inset-0'} z-40 flex items-center justify-center ${isCollapsed ? '' : 'bg-black/40 px-4'}`}>
      <div className={`${isCollapsed ? 'w-auto' : 'w-full max-w-xl'} rounded-lg border border-gray-200 bg-white shadow-xl`}>
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <div className={isCollapsed ? 'hidden' : ''}>
            <h2 className="text-sm font-semibold text-gray-900">Insert Placeholder</h2>
            <p className="text-[11px] text-gray-500">Click any button to insert, right-click to copy</p>
          </div>
          {isCollapsed && (
            <span className="text-sm font-semibold text-gray-900">Placeholders</span>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-600 hover:bg-gray-100"
              title={isCollapsed ? 'Expand' : 'Minimize'}
            >
              {isCollapsed ? 'Expand' : 'Minimize'}
            </button>
            {onRefresh && !isCollapsed && (
              <button
                onClick={onRefresh}
                disabled={loading}
                className="rounded-md border border-blue-300 bg-blue-50 px-2 py-1 text-xs text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                title="Refresh placeholder data"
              >
                {loading ? 'Loading...' : 'Refresh'}
              </button>
            )}
            <button
              onClick={onClose}
              className="rounded-md border border-red-300 bg-red-50 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-100"
              title="Close placeholder picker"
            >
              Close
            </button>
          </div>
        </div>
        {!isCollapsed && (
          <>
            {loading && (
              <div className="border-b border-dashed border-gray-200 bg-gray-50 px-4 py-2 text-[11px] text-gray-500">
                Loading lab and test placeholders…
              </div>
            )}
            {errorMessage && (
              <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-[11px] text-red-600">
                {errorMessage}
              </div>
            )}

            {/* Tab navigation */}
            <div className="flex border-b border-gray-200">
              <button
                type="button"
                onClick={() => setActiveTab('test')}
                className={`flex-1 px-4 py-2.5 text-sm font-medium transition ${
                  activeTab === 'test'
                    ? 'border-b-2 border-blue-500 text-blue-600 bg-blue-50/50'
                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                }`}
              >
                Test Results
                {analyteGroups.length > 0 && (
                  <span className="ml-1.5 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] text-blue-700">
                    {analyteGroups.length}
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('other')}
                className={`flex-1 px-4 py-2.5 text-sm font-medium transition ${
                  activeTab === 'other'
                    ? 'border-b-2 border-blue-500 text-blue-600 bg-blue-50/50'
                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                }`}
              >
                Patient / Lab / Assets
              </button>
            </div>

            {/* Tab content */}
            <div className="px-4 py-4">
              {activeTab === 'test' ? renderAnalyteCentricView() : renderOtherPlaceholders()}
            </div>

            {/* Help text footer */}
            <div className="border-t border-gray-200 bg-gray-50 px-4 py-3">
              <div className="flex items-center gap-4 text-[11px] text-gray-500">
                <span className="flex items-center gap-1">
                  <span className="inline-block w-2 h-2 rounded-full bg-blue-400"></span>
                  Click = Insert
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block w-2 h-2 rounded-full bg-purple-400"></span>
                  Right-click = Copy
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block w-2 h-2 rounded-full bg-gray-400"></span>
                  Click arrow to expand details
                </span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export type { PlaceholderOption };
export default PlaceholderPicker;
