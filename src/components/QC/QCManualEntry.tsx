/**
 * QCManualEntry Component
 *
 * Manual QC data entry form with:
 * - Run information (date, time, analyzer, operator, run type)
 * - Lot selection
 * - Multiple analyte result entries
 * - Target value display
 * - Validation and auto-calculation of Z-scores
 */

import React, { useState, useEffect } from 'react';
import {
  X,
  Plus,
  Trash2,
  Save,
  Loader2,
  FlaskConical,
  Calendar,
  Clock,
  User,
  Package,
  AlertCircle
} from 'lucide-react';
import { useQualityControl } from '../../hooks/useQualityControl';
import { supabase } from '../../utils/supabase';
import type { QCLot, QCResult } from '../../types/qc';

interface QCManualEntryProps {
  labId: string;
  onComplete?: (runId: string) => void;
  onCancel?: () => void;
}

interface AnalyteOption {
  id: string;
  name: string;
  code: string;
  unit: string;
}

interface TargetValue {
  analyte_id: string;
  target_mean: number;
  target_sd: number;
  unit: string;
}

interface ResultEntry {
  id: string;
  analyte_id: string;
  analyte_name: string;
  observed_value: string;
  unit: string;
  target_mean: number | null;
  target_sd: number | null;
}

export const QCManualEntry: React.FC<QCManualEntryProps> = ({
  labId,
  onComplete,
  onCancel
}) => {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lots, setLots] = useState<QCLot[]>([]);
  const [analytes, setAnalytes] = useState<AnalyteOption[]>([]);
  const [targetValues, setTargetValues] = useState<TargetValue[]>([]);
  
  // Run information
  const [runDate, setRunDate] = useState(new Date().toISOString().split('T')[0]);
  const [runTime, setRunTime] = useState(new Date().toTimeString().slice(0, 5));
  const [runNumber, setRunNumber] = useState('1');
  const [analyzerName, setAnalyzerName] = useState('');
  const [operatorId, setOperatorId] = useState<string>('');
  const [runType, setRunType] = useState('routine');
  const [selectedLotId, setSelectedLotId] = useState<string>('');
  
  // Results entries
  const [results, setResults] = useState<ResultEntry[]>([]);
  
  // Users for operator selection
  const [users, setUsers] = useState<Array<{ id: string; name: string }>>([]);
  
  const qc = useQualityControl();

  // Load initial data
  useEffect(() => {
    loadInitialData();
  }, [labId]);

  // Load target values when lot is selected
  useEffect(() => {
    if (selectedLotId) {
      loadTargetValues(selectedLotId);
    }
  }, [selectedLotId]);

  const loadInitialData = async () => {
    setLoading(true);
    try {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setOperatorId(user.id);
      }

      // Load active QC lots
      const lotsData = await qc.getLots({ labId, isActive: true });
      setLots(lotsData);

      // Load lab analytes
      const { data: labAnalytesData } = await supabase
        .from('lab_analytes')
        .select('analyte_id, analytes(id, name, code, unit)')
        .eq('lab_id', labId);

      if (labAnalytesData) {
        const analytesOptions = labAnalytesData
          .filter((la: any) => la.analytes)
          .map((la: any) => ({
            id: la.analytes.id,
            name: la.analytes.name,
            code: la.analytes.code,
            unit: la.analytes.unit || ''
          }));
        setAnalytes(analytesOptions);
      }

      // Load users for operator selection
      const { data: usersData } = await supabase
        .from('users')
        .select('id, name')
        .eq('lab_id', labId)
        .eq('status', 'Active')
        .order('name');

      if (usersData) {
        setUsers(usersData);
      }
    } catch (error) {
      console.error('Error loading initial data:', error);
    }
    setLoading(false);
  };

  const loadTargetValues = async (lotId: string) => {
    try {
      const { data } = await supabase
        .from('qc_target_values')
        .select('analyte_id, target_mean, target_sd, unit')
        .eq('qc_lot_id', lotId);

      if (data) {
        setTargetValues(data);
      }
    } catch (error) {
      console.error('Error loading target values:', error);
    }
  };

  const addResultEntry = () => {
    const newEntry: ResultEntry = {
      id: `entry-${Date.now()}`,
      analyte_id: '',
      analyte_name: '',
      observed_value: '',
      unit: '',
      target_mean: null,
      target_sd: null
    };
    setResults([...results, newEntry]);
  };

  const removeResultEntry = (id: string) => {
    setResults(results.filter(r => r.id !== id));
  };

  const updateResultEntry = (id: string, field: string, value: any) => {
    setResults(results.map(r => {
      if (r.id === id) {
        const updated = { ...r, [field]: value };
        
        // If analyte changed, update target values
        if (field === 'analyte_id') {
          const analyte = analytes.find(a => a.id === value);
          const target = targetValues.find(tv => tv.analyte_id === value);
          
          updated.analyte_name = analyte?.name || '';
          updated.unit = target?.unit || analyte?.unit || '';
          updated.target_mean = target?.target_mean || null;
          updated.target_sd = target?.target_sd || null;
        }
        
        return updated;
      }
      return r;
    }));
  };

  const validateForm = (): boolean => {
    if (!runDate || !runTime || !analyzerName || !operatorId || !selectedLotId) {
      alert('Please fill in all run information');
      return false;
    }
    
    if (results.length === 0) {
      alert('Please add at least one result');
      return false;
    }
    
    for (const result of results) {
      if (!result.analyte_id || !result.observed_value) {
        alert('Please complete all result entries');
        return false;
      }
      
      // Check if target values are available
      if (result.target_mean === null || result.target_sd === null) {
        const analyteName = analytes.find(a => a.id === result.analyte_id)?.name || 'Unknown';
        alert(`Target values are missing for ${analyteName}. Please set target values for this analyte in the selected QC lot before entering results.`);
        return false;
      }
    }
    
    return true;
  };

  const handleSave = async () => {
    if (!validateForm()) return;

    setSaving(true);
    try {
      // Create QC run
      const run = await qc.createQCRun({
        lab_id: labId,
        run_date: runDate,
        run_time: runTime,
        run_number: parseInt(runNumber),
        analyzer_name: analyzerName,
        operator_id: operatorId,
        run_type: runType as any,
        status: 'completed',
        created_by: operatorId
      });

      if (!run) {
        throw new Error('Failed to create QC run');
      }

      // Add all results
      const resultsToAdd = results.map(r => ({
        qc_run_id: run.id,
        qc_lot_id: selectedLotId,
        analyte_id: r.analyte_id,
        observed_value: parseFloat(r.observed_value),
        unit: r.unit,
        target_mean: r.target_mean,
        target_sd: r.target_sd
      }));

      await qc.bulkAddResults(run.id, resultsToAdd as any);

      // Update run status to reviewed
      await qc.reviewQCRun(run.id, { status: 'reviewed' });

      onComplete?.(run.id);
    } catch (error) {
      console.error('Error saving QC run:', error);
      alert('Failed to save QC run. Please try again.');
    }
    setSaving(false);
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-xl p-6">
          <Loader2 className="h-8 w-8 animate-spin text-indigo-600 mx-auto" />
          <p className="mt-2 text-sm text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-indigo-600 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <FlaskConical className="h-6 w-6 text-white" />
            <h2 className="text-xl font-bold text-white">Manual QC Entry</h2>
          </div>
          <button
            onClick={onCancel}
            className="text-white hover:text-gray-200"
            disabled={saving}
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Run Information */}
          <div className="bg-gray-50 rounded-lg p-4 space-y-4">
            <h3 className="font-semibold text-gray-900 flex items-center">
              <Calendar className="h-4 w-4 mr-2" />
              Run Information
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Date <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  value={runDate}
                  onChange={(e) => setRunDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Time <span className="text-red-500">*</span>
                </label>
                <input
                  type="time"
                  value={runTime}
                  onChange={(e) => setRunTime(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Run Number
                </label>
                <input
                  type="number"
                  value={runNumber}
                  onChange={(e) => setRunNumber(e.target.value)}
                  min="1"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
              </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Analyzer Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={analyzerName}
                  onChange={(e) => setAnalyzerName(e.target.value)}
                  placeholder="e.g., Sysmex XN-1000"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Operator <span className="text-red-500">*</span>
                </label>
                <select
                  value={operatorId}
                  onChange={(e) => setOperatorId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                >
                  <option value="">Select operator...</option>
                  {users.map(user => (
                    <option key={user.id} value={user.id}>{user.name}</option>
                  ))}
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Run Type <span className="text-red-500">*</span>
                </label>
                <select
                  value={runType}
                  onChange={(e) => setRunType(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                >
                  <option value="routine">Routine</option>
                  <option value="calibration">Calibration</option>
                  <option value="verification">Verification</option>
                  <option value="maintenance">Maintenance</option>
                </select>
              </div>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                QC Lot <span className="text-red-500">*</span>
              </label>
              <select
                value={selectedLotId}
                onChange={(e) => setSelectedLotId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              >
                <option value="">Select QC lot...</option>
                {lots.map(lot => (
                  <option key={lot.id} value={lot.id}>
                    {lot.lot_number} - {lot.material_name} ({lot.level})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Results Entries */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-900 flex items-center">
                <Package className="h-4 w-4 mr-2" />
                QC Results
              </h3>
              <button
                onClick={addResultEntry}
                disabled={!selectedLotId}
                className="inline-flex items-center px-3 py-1.5 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Plus className="h-4 w-4 mr-1" />
                Add Result
              </button>
            </div>

            {!selectedLotId && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex items-start space-x-2">
                <AlertCircle className="h-5 w-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-yellow-700">
                  Please select a QC lot first before adding results
                </p>
              </div>
            )}

            {results.length === 0 && selectedLotId && (
              <div className="text-center py-8 text-gray-500">
                <Package className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                <p className="text-sm">No results added yet</p>
                <button
                  onClick={addResultEntry}
                  className="mt-2 text-indigo-600 text-sm hover:text-indigo-700"
                >
                  Click "Add Result" to start
                </button>
              </div>
            )}

            {results.map((result, index) => (
              <div key={result.id} className="bg-gray-50 rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700">Result #{index + 1}</span>
                  <button
                    onClick={() => removeResultEntry(result.id)}
                    className="text-red-600 hover:text-red-700"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Analyte <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={result.analyte_id}
                      onChange={(e) => updateResultEntry(result.id, 'analyte_id', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    >
                      <option value="">Select analyte...</option>
                      {analytes.map(analyte => (
                        <option key={analyte.id} value={analyte.id}>
                          {analyte.name} ({analyte.code})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Observed Value <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={result.observed_value}
                      onChange={(e) => updateResultEntry(result.id, 'observed_value', e.target.value)}
                      placeholder="0.00"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Unit
                    </label>
                    <input
                      type="text"
                      value={result.unit}
                      onChange={(e) => updateResultEntry(result.id, 'unit', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-gray-100"
                      readOnly
                    />
                  </div>

                  {result.target_mean !== null && result.target_sd !== null && (
                    <div className="md:col-span-2 bg-blue-50 border border-blue-200 rounded p-2 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-gray-700">Target:</span>
                        <span className="font-medium text-gray-900">
                          {result.target_mean} ± {result.target_sd} {result.unit}
                        </span>
                      </div>
                      {result.observed_value && (
                        <div className="flex items-center justify-between mt-1">
                          <span className="text-gray-700">Z-Score:</span>
                          <span className={`font-medium ${
                            Math.abs((parseFloat(result.observed_value) - result.target_mean) / result.target_sd) > 2
                              ? 'text-red-600'
                              : 'text-green-600'
                          }`}>
                            {((parseFloat(result.observed_value) - result.target_mean) / result.target_sd).toFixed(2)}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                  
                  {result.analyte_id && (result.target_mean === null || result.target_sd === null) && (
                    <div className="md:col-span-2 bg-red-50 border border-red-200 rounded p-2 flex items-start space-x-2">
                      <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0 mt-0.5" />
                      <div className="text-sm text-red-700">
                        <p className="font-medium">Target values missing</p>
                        <p className="mt-0.5">Please set target values for this analyte in the QC lot before saving.</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 px-6 py-4 flex items-center justify-end space-x-3 bg-gray-50">
          <button
            onClick={onCancel}
            disabled={saving}
            className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || results.length === 0}
            className="inline-flex items-center px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                Save QC Run
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default QCManualEntry;
