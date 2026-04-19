import React, { useState, useEffect, useMemo } from 'react';
import { X, Link2, Search, Plus, Trash2, AlertCircle, Check, Loader2 } from 'lucide-react';
import { database } from '../../utils/supabase';

interface AnalyteDependencyManagerProps {
  analyte: {
    id: string;
    lab_analyte_id?: string | null;
    name: string;
    formula: string;
    formulaVariables: string[];
  };
  onClose: () => void;
  onSaved?: () => void;
}

interface Analyte {
  id: string;
  lab_analyte_id?: string | null;
  name: string;
  unit: string;
  category: string;
}

interface Dependency {
  id?: string;
  variable_name: string;
  source_analyte_id: string;
  source_lab_analyte_id?: string | null;
  source_analyte?: {
    id: string;
    name: string;
    unit: string;
  };
}

const AnalyteDependencyManager: React.FC<AnalyteDependencyManagerProps> = ({
  analyte,
  onClose,
  onSaved
}) => {
  const [availableAnalytes, setAvailableAnalytes] = useState<Analyte[]>([]);
  const [dependencies, setDependencies] = useState<Dependency[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  // Load existing dependencies and available analytes
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
        
        // Load all analytes (except the calculated one itself)
        const { data: analytesData, error: analytesError } = await database.analytes.getAll();
        if (analytesError) throw analytesError;
        
        // Filter out the current calculated analyte
        const filteredAnalytes = (analytesData || []).filter(a => a.id !== analyte.id);
        setAvailableAnalytes(filteredAnalytes);
        
        // Map existing dependencies
        if (existingDeps) {
          setDependencies(existingDeps.map(d => ({
            id: d.id,
            variable_name: d.variable_name,
            source_analyte_id: d.source_analyte_id,
            source_lab_analyte_id: (d as any).source_lab_analyte_id || null,
            source_analyte: (d as any).source_lab_analyte
              ? {
                  id: (d as any).source_lab_analyte.analyte_id || (d as any).source_analyte_id,
                  name: (d as any).source_lab_analyte.name,
                  unit: (d as any).source_lab_analyte.unit,
                }
              : d.source_analyte
          })));
        }
      } catch (err: any) {
        setError(err.message || 'Failed to load data');
      } finally {
        setLoading(false);
      }
    };
    
    loadData();
  }, [analyte.id]);

  // Variables from the formula that need to be linked
  const requiredVariables = useMemo(() => {
    return analyte.formulaVariables || [];
  }, [analyte.formulaVariables]);

  // Check which variables are already linked
  const linkedVariables = useMemo(() => {
    return new Set(dependencies.map(d => d.variable_name));
  }, [dependencies]);

  // Filter analytes based on search
  const filteredAnalytes = useMemo(() => {
    if (!searchTerm.trim()) return availableAnalytes;
    const search = searchTerm.toLowerCase();
    return availableAnalytes.filter(a => 
      a.name.toLowerCase().includes(search) ||
      a.category?.toLowerCase().includes(search)
    );
  }, [availableAnalytes, searchTerm]);

  // Add a dependency
  const handleAddDependency = (variableName: string, sourceAnalyte: Analyte) => {
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

      // Validate all required variables are linked
      const missingVariables = requiredVariables.filter(v => !linkedVariables.has(v));
      if (missingVariables.length > 0) {
        setError(`Please link all variables: ${missingVariables.join(', ')}`);
        setSaving(false);
        return;
      }

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

      onSaved?.();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save dependencies');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-gray-600 bg-opacity-75 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-8 flex items-center gap-3">
          <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
          <span>Loading dependencies...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-75 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between p-6 border-b border-gray-200 flex-shrink-0">
          <div>
            <h2 className="text-xl font-semibold text-gray-900 flex items-center">
              <Link2 className="h-6 w-6 mr-2 text-amber-600" />
              Manage Dependencies
            </h2>
            <p className="text-sm text-gray-500 mt-1">
              Link formula variables to source analytes for <strong>{analyte.name}</strong>
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-500 p-1 rounded"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        <div className="p-6 space-y-6 overflow-y-auto flex-1">
          {/* Formula Display */}
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
            <h3 className="text-sm font-medium text-amber-900 mb-2">Formula</h3>
            <div className="font-mono text-amber-800 bg-amber-100 p-2 rounded text-sm">
              {analyte.formula}
            </div>
            <div className="mt-2 text-xs text-amber-700">
              <strong>Variables to link:</strong> {requiredVariables.join(', ') || 'None'}
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center gap-2 text-sm text-red-700">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          )}

          {/* Current Dependencies */}
          <div>
            <h3 className="text-sm font-medium text-gray-900 mb-3">Variable Mappings</h3>
            <div className="space-y-2">
              {requiredVariables.map(variable => {
                const dep = dependencies.find(d => d.variable_name === variable);
                return (
                  <div
                    key={variable}
                    className={`flex items-center justify-between p-3 rounded-lg border-2 ${
                      dep ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                        dep ? 'bg-green-600 text-white' : 'bg-gray-300 text-gray-600'
                      }`}>
                        {dep ? <Check className="h-4 w-4" /> : <Link2 className="h-4 w-4" />}
                      </div>
                      <div>
                        <div className="font-mono font-medium text-gray-900">{variable}</div>
                        {dep ? (
                          <div className="text-sm text-green-700">
                            → {dep.source_analyte?.name} ({dep.source_analyte?.unit})
                          </div>
                        ) : (
                          <div className="text-sm text-gray-500">Not linked yet</div>
                        )}
                      </div>
                    </div>
                    {dep && (
                      <button
                        onClick={() => handleRemoveDependency(variable)}
                        className="text-red-600 hover:text-red-800 p-1"
                        title="Remove link"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Add New Dependency */}
          {requiredVariables.some(v => !linkedVariables.has(v)) && (
            <div>
              <h3 className="text-sm font-medium text-gray-900 mb-3">Link Variable to Analyte</h3>
              
              {/* Variable selector */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Select Variable to Link
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {requiredVariables.filter(v => !linkedVariables.has(v)).map(variable => (
                      <button
                        key={variable}
                        className="px-3 py-1.5 bg-amber-100 text-amber-800 rounded-full text-sm font-mono hover:bg-amber-200 transition-colors"
                        onClick={() => {
                          const selected = document.querySelector('[data-selected-variable]');
                          if (selected) selected.removeAttribute('data-selected-variable');
                        }}
                        data-variable={variable}
                      >
                        {variable}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Search analytes */}
              <div className="relative mb-3">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search analytes by name..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 text-sm"
                />
              </div>

              {/* Analyte list */}
              <div className="border border-gray-200 rounded-lg max-h-48 overflow-y-auto">
                {filteredAnalytes.length === 0 ? (
                  <div className="p-4 text-center text-gray-500 text-sm">
                    No analytes found
                  </div>
                ) : (
                  <div className="divide-y divide-gray-100">
                    {filteredAnalytes.slice(0, 20).map(a => {
                      const isUsed = dependencies.some(d => d.source_analyte_id === a.id);
                      return (
                        <div
                          key={a.id}
                          className={`p-2 flex items-center justify-between ${
                            isUsed ? 'bg-gray-100 opacity-50' : 'hover:bg-gray-50'
                          }`}
                        >
                          <div>
                            <div className="text-sm font-medium text-gray-900">{a.name}</div>
                            <div className="text-xs text-gray-500">{a.unit} • {a.category}</div>
                          </div>
                          {!isUsed && (
                            <div className="flex gap-1">
                              {requiredVariables.filter(v => !linkedVariables.has(v)).map(variable => (
                                <button
                                  key={variable}
                                  onClick={() => handleAddDependency(variable, a)}
                                  className="px-2 py-1 bg-amber-600 text-white text-xs rounded hover:bg-amber-700 transition-colors"
                                  title={`Link to ${variable}`}
                                >
                                  → {variable}
                                </button>
                              ))}
                            </div>
                          )}
                          {isUsed && (
                            <span className="text-xs text-gray-400">Already linked</span>
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
          {requiredVariables.length > 0 && requiredVariables.every(v => linkedVariables.has(v)) && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center gap-3">
              <Check className="h-5 w-5 text-green-600" />
              <div>
                <div className="font-medium text-green-900">All variables linked!</div>
                <div className="text-sm text-green-700">
                  Click Save to apply these dependencies.
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-200 bg-gray-50 flex-shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-100 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || requiredVariables.some(v => !linkedVariables.has(v))}
            className="px-6 py-2 bg-amber-600 text-white rounded-md hover:bg-amber-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {saving ? 'Saving...' : 'Save Dependencies'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AnalyteDependencyManager;
