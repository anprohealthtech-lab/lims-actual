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
    console.log('PlaceholderPicker grouped:', result);
    console.log('Test group count:', result.test.length);
    return result;
  }, [options]);

  const [activeOption, setActiveOption] = useState<PlaceholderOption | null>(null);
  const [copyState, setCopyState] = useState<'success' | 'error' | null>(null);

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

  return (
    <div className={`fixed ${isCollapsed ? 'bottom-4 right-4' : 'inset-0'} z-40 flex items-center justify-center ${isCollapsed ? '' : 'bg-black/40 px-4'}`}>
      <div className={`${isCollapsed ? 'w-auto' : 'w-full max-w-xl'} rounded-lg border border-gray-200 bg-white shadow-xl`}>
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-2">
          <div className={isCollapsed ? 'hidden' : 'flex-1'}>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-gray-900">Insert Placeholder</h2>
                <p className="text-[11px] text-gray-500">Choose a placeholder to insert into the template.</p>
              </div>
              {!isCollapsed && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setMultiSelectMode(!multiSelectMode);
                      if (multiSelectMode) {
                        setSelectedPlaceholders(new Set());
                      }
                    }}
                    className={`rounded-md border px-3 py-1.5 text-xs font-medium transition ${
                      multiSelectMode
                        ? 'border-purple-300 bg-purple-50 text-purple-700 hover:bg-purple-100'
                        : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    {multiSelectMode ? '✓ Multi-Select ON' : '☐ Multi-Select'}
                  </button>
                  {multiSelectMode && selectedPlaceholders.size > 0 && (
                    <>
                      <button
                        onClick={handleCopySelected}
                        className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
                      >
                        📋 Copy {selectedPlaceholders.size} Selected
                      </button>
                      <button
                        onClick={handleClearSelection}
                        className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-100"
                        title="Clear selection"
                      >
                        ✕
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
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
              {isCollapsed ? '⬆️ Expand' : '⬇️ Minimize'}
            </button>
            {onRefresh && !isCollapsed && (
              <button
                onClick={onRefresh}
                disabled={loading}
                className="rounded-md border border-blue-300 bg-blue-50 px-2 py-1 text-xs text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                title="Refresh placeholder data"
              >
                {loading ? 'Loading...' : '↻ Refresh'}
              </button>
            )}
            <button
              onClick={onClose}
              className="rounded-md border border-red-300 bg-red-50 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-100"
              title="Close placeholder picker"
            >
              ✕ Close
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
            <div className="grid gap-4 px-4 py-4 sm:grid-cols-2 lg:grid-cols-3">
              {GROUP_META.map(({ key, title, empty }) => (
                <section key={key} className="sm:col-span-1">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{title}</h3>
                  {renderGroup(key, empty)}
                </section>
              ))}
            </div>
            <div className="border-t border-gray-200 bg-gray-50 px-4 py-4">
              {activeOption ? (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="text-sm font-semibold text-gray-900">{activeOption.label}</div>
                    <code className="mt-1 inline-block rounded bg-gray-200 px-2 py-1 text-xs text-gray-800">
                      {activeOption.placeholder}
                    </code>
                    <div className="mt-2 space-y-1 text-[11px] text-gray-500">
                      {activeOption.unit ? <div>Unit: {activeOption.unit}</div> : null}
                      {activeOption.referenceRange ? <div>Reference: {activeOption.referenceRange}</div> : null}
                      <div>Group: {activeOption.group || 'lab'}</div>
                    </div>
                    <p className="mt-2 text-[11px] text-gray-500">
                      Copy the placeholder and paste it wherever you need inside the template editor.
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 sm:items-end">
                    <button
                      type="button"
                      onClick={handleCopy}
                      className="min-w-[160px] rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-100"
                    >
                      Copy Placeholder
                    </button>
                    <button
                      type="button"
                      onClick={handleInsert}
                      className="min-w-[160px] rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-blue-700"
                    >
                      Insert into Editor
                    </button>
                    {copyState === 'success' && (
                      <span className="text-[11px] text-emerald-600">Copied!</span>
                    )}
                    {copyState === 'error' && (
                      <span className="text-[11px] text-red-600">Copy failed. Copy manually.</span>
                    )}
                  </div>
                </div>
              ) : (
                <div className="text-xs text-gray-500">Select a placeholder to view details.</div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export type { PlaceholderOption };
export default PlaceholderPicker;
