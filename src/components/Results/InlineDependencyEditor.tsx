// InlineDependencyEditor.tsx
// Lightweight modal for quickly linking missing analyte dependencies during result entry.
// Opens inline when user clicks "Missing: X, Y" in QuickResultEntryModal or OrderDetailsModal.

import React, { useState, useEffect, useMemo } from 'react';
import { X, Link2, Search, Check, Loader2, AlertCircle } from 'lucide-react';
import { database } from '../../utils/supabase';

interface InlineDependencyEditorProps {
  analyte: {
    id: string;
    lab_analyte_id?: string | null;
    name: string;
    formula: string;
    formulaVariables: string[];
  };
  /** Variables that are currently missing values */
  missingVariables: string[];
  /** All analytes available in the current test groups (for quick lookup) */
  availableAnalytes: Array<{
    id: string;
    lab_analyte_id?: string | null;
    name: string;
    unit?: string;
    code?: string;
  }>;
  onClose: () => void;
  onSaved: () => void;
}

interface Dependency {
  id?: string;
  variable_name: string;
  source_analyte_id: string;
  source_lab_analyte_id?: string | null;
  source_analyte?: {
    id: string;
    name: string;
    unit?: string;
  };
}

const InlineDependencyEditor: React.FC<InlineDependencyEditorProps> = ({
  analyte,
  missingVariables,
  availableAnalytes,
  onClose,
  onSaved
}) => {
  const [allAnalytes, setAllAnalytes] = useState<Array<{
    id: string;
    lab_analyte_id?: string | null;
    name: string;
    unit: string;
    category?: string;
  }>>([]);
  const [dependencies, setDependencies] = useState<Dependency[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  // Load existing dependencies
  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        const labId = await database.getCurrentUserLabId();

        // Load existing dependencies
        const { data: existingDeps, error: depsError } = await database.analyteDependencies.getByAnalyte(analyte.id, {
          labId: labId || undefined,
          calculatedLabAnalyteId: analyte.lab_analyte_id || null,
        });
        if (depsError) throw depsError;

        // Load all analytes for complete search
        const { data: analytesData, error: analytesError } = await database.analytes.getAll();
        if (analytesError) throw analytesError;

        // Filter out the current calculated analyte
        const filteredAnalytes = (analytesData || []).filter(a => a.id !== analyte.id);
        setAllAnalytes(filteredAnalytes);

        // Map existing dependencies
        if (existingDeps) {
          setDependencies(existingDeps.map(d => ({
            id: d.id,
            variable_name: d.variable_name,
            source_analyte_id: d.source_analyte_id,
            source_lab_analyte_id: (d as any).source_lab_analyte_id || null,
            source_analyte: (d as any).source_lab_analyte
              ? {
                  id: (d as any).source_lab_analyte.analyte_id || d.source_analyte_id,
                  name: (d as any).source_lab_analyte.name,
                  unit: (d as any).source_lab_analyte.unit,
                }
              : d.source_analyte
          })));
        }
      } catch (err: any) {
        setError(err.message || 'Failed to load dependencies');
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [analyte.id, analyte.lab_analyte_id]);

  // All required variables
  const requiredVariables = useMemo(() => {
    return analyte.formulaVariables || [];
  }, [analyte.formulaVariables]);

  // Check which variables are already linked
  const linkedVariables = useMemo(() => {
    return new Set(dependencies.map(d => d.variable_name));
  }, [dependencies]);

  // Unlinked variables (focus on these)
  const unlinkedVariables = useMemo(() => {
    return requiredVariables.filter(v => !linkedVariables.has(v));
  }, [requiredVariables, linkedVariables]);

  // Combine available analytes (from test groups) with all analytes
  const combinedAnalytes = useMemo(() => {
    const inGroupIds = new Set(availableAnalytes.map(a => a.lab_analyte_id || a.id));
    const inGroup = availableAnalytes.map(a => ({
      ...a,
      unit: a.unit || '',
      inGroup: true
    }));
    const others = allAnalytes
      .filter(a => !inGroupIds.has(a.lab_analyte_id || a.id))
      .map(a => ({ ...a, inGroup: false }));
    return [...inGroup, ...others];
  }, [availableAnalytes, allAnalytes]);

  // Filter analytes based on search
  const filteredAnalytes = useMemo(() => {
    if (!searchTerm.trim()) return combinedAnalytes;
    const search = searchTerm.toLowerCase();
    return combinedAnalytes.filter(a =>
      a.name.toLowerCase().includes(search) ||
      a.code?.toLowerCase().includes(search) ||
      a.category?.toLowerCase().includes(search)
    );
  }, [combinedAnalytes, searchTerm]);

  // Sort: in-group first, then by name
  const sortedAnalytes = useMemo(() => {
    return [...filteredAnalytes].sort((a, b) => {
      if (a.inGroup && !b.inGroup) return -1;
      if (!a.inGroup && b.inGroup) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [filteredAnalytes]);

  // Add a dependency
  const handleAddDependency = (variableName: string, sourceAnalyte: typeof combinedAnalytes[0]) => {
    // Check if variable is already linked
    if (dependencies.some(d => d.variable_name === variableName)) {
      setError(`Variable "${variableName}" is already linked`);
      return;
    }

    // Check if analyte is already used
    if (dependencies.some(d =>
      (d.source_lab_analyte_id && sourceAnalyte.lab_analyte_id && d.source_lab_analyte_id === sourceAnalyte.lab_analyte_id) ||
      d.source_analyte_id === sourceAnalyte.id
    )) {
      setError(`Analyte "${sourceAnalyte.name}" is already linked to another variable`);
      return;
    }

    setDependencies(prev => [...prev, {
      variable_name: variableName,
      source_analyte_id: sourceAnalyte.id,
      source_lab_analyte_id: sourceAnalyte.lab_analyte_id || null,
      source_analyte: {
        id: sourceAnalyte.id,
        name: sourceAnalyte.name,
        unit: sourceAnalyte.unit
      }
    }]);
    setError(null);
  };

  // Remove a dependency
  const handleRemoveDependency = (variableName: string) => {
    setDependencies(prev => prev.filter(d => d.variable_name !== variableName));
  };

  // Save all dependencies
  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      const labId = await database.getCurrentUserLabId();

      // Save dependencies
      const { error: saveError } = await database.analyteDependencies.setDependencies(
        analyte.id,
        dependencies.map(d => ({
          source_analyte_id: d.source_analyte_id,
          source_lab_analyte_id: d.source_lab_analyte_id || null,
          variable_name: d.variable_name
        })),
        labId || undefined,
        analyte.lab_analyte_id || null,
      );

      if (saveError) throw saveError;

      onSaved();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save dependencies');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-gray-600/75 flex items-center justify-center z-[60]">
        <div className="bg-white rounded-lg p-6 flex items-center gap-3 shadow-xl">
          <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
          <span className="text-gray-700">Loading dependencies...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-gray-600/75 flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 flex-shrink-0">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <Link2 className="h-5 w-5 text-amber-600" />
              Link Dependencies
            </h3>
            <p className="text-sm text-gray-500 mt-0.5">
              <span className="font-medium">{analyte.name}</span>
              {missingVariables.length > 0 && (
                <span className="ml-2 text-red-600">
                  — {missingVariables.length} missing
                </span>
              )}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Formula */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
            <div className="text-xs font-medium text-blue-700 mb-1">Formula</div>
            <div className="font-mono text-sm text-blue-900 break-all">{analyte.formula}</div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center gap-2 text-sm text-red-700">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              {error}
            </div>
          )}

          {/* Variable Status */}
          <div>
            <h4 className="text-sm font-medium text-gray-700 mb-2">Variables</h4>
            <div className="space-y-2">
              {requiredVariables.map(variable => {
                const dep = dependencies.find(d => d.variable_name === variable);
                const isMissing = missingVariables.includes(variable);
                return (
                  <div
                    key={variable}
                    className={`flex items-center justify-between p-2.5 rounded-lg border-2 transition-colors ${
                      dep
                        ? 'border-green-200 bg-green-50'
                        : isMissing
                          ? 'border-red-200 bg-red-50'
                          : 'border-gray-200 bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${
                        dep ? 'bg-green-600 text-white' : isMissing ? 'bg-red-500 text-white' : 'bg-gray-300 text-gray-600'
                      }`}>
                        {dep ? <Check className="h-3.5 w-3.5" /> : '?'}
                      </div>
                      <div>
                        <div className="font-mono font-medium text-gray-900 text-sm">{variable}</div>
                        {dep ? (
                          <div className="text-xs text-green-700">
                            → {dep.source_analyte?.name} {dep.source_analyte?.unit && `(${dep.source_analyte.unit})`}
                          </div>
                        ) : (
                          <div className="text-xs text-gray-500">Not linked</div>
                        )}
                      </div>
                    </div>
                    {dep && (
                      <button
                        onClick={() => handleRemoveDependency(variable)}
                        className="text-xs text-red-600 hover:text-red-800 px-2 py-1 hover:bg-red-100 rounded transition-colors"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Link section - only show if there are unlinked variables */}
          {unlinkedVariables.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-gray-700 mb-2">
                Link to Analyte
              </h4>

              {/* Search */}
              <div className="relative mb-3">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search analytes..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 text-sm"
                  autoFocus
                />
              </div>

              {/* Analyte list */}
              <div className="border border-gray-200 rounded-lg max-h-52 overflow-y-auto">
                {sortedAnalytes.length === 0 ? (
                  <div className="p-4 text-center text-gray-500 text-sm">
                    No analytes found
                  </div>
                ) : (
                  <div className="divide-y divide-gray-100">
                    {sortedAnalytes.slice(0, 30).map(a => {
                      const isUsed = dependencies.some(d =>
                        (d.source_lab_analyte_id && a.lab_analyte_id && d.source_lab_analyte_id === a.lab_analyte_id) ||
                        d.source_analyte_id === a.id
                      );
                      return (
                        <div
                          key={a.lab_analyte_id || a.id}
                          className={`p-2.5 flex items-center justify-between ${
                            isUsed ? 'bg-gray-100 opacity-60' : 'hover:bg-gray-50'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <div>
                              <div className="text-sm font-medium text-gray-900 flex items-center gap-1.5">
                                {a.name}
                                {a.inGroup && (
                                  <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded">
                                    in group
                                  </span>
                                )}
                              </div>
                              <div className="text-xs text-gray-500">
                                {a.unit && <span>{a.unit}</span>}
                                {a.code && <span className="ml-1.5 font-mono">[{a.code}]</span>}
                              </div>
                            </div>
                          </div>
                          {!isUsed && (
                            <div className="flex gap-1 flex-wrap justify-end">
                              {unlinkedVariables.map(variable => (
                                <button
                                  key={variable}
                                  onClick={() => handleAddDependency(variable, a)}
                                  className="px-2 py-1 bg-amber-600 text-white text-xs rounded hover:bg-amber-700 transition-colors font-medium"
                                  title={`Link to ${variable}`}
                                >
                                  → {variable}
                                </button>
                              ))}
                            </div>
                          )}
                          {isUsed && (
                            <span className="text-xs text-gray-400 italic">linked</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* All linked message */}
          {unlinkedVariables.length === 0 && requiredVariables.length > 0 && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center gap-3">
              <Check className="h-5 w-5 text-green-600 flex-shrink-0" />
              <div>
                <div className="font-medium text-green-900">All variables linked!</div>
                <div className="text-sm text-green-700">
                  Save to apply and recalculate.
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-gray-200 bg-gray-50 flex-shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-100 transition-colors text-sm font-medium"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors flex items-center gap-2 text-sm font-medium"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {saving ? 'Saving...' : 'Save & Recalculate'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default InlineDependencyEditor;
