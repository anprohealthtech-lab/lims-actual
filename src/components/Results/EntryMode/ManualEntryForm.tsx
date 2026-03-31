import React, { useState, useEffect } from 'react';
import { Save, CheckCircle, AlertTriangle, PackageX } from 'lucide-react';
import { database, supabase } from '../../../utils/supabase';
import { useAuth } from '../../../contexts/AuthContext';
import { calculateFlagsForResults } from '../../../utils/flagCalculation';
import { toast } from 'react-hot-toast';
import SectionEditor from '../SectionEditor';

interface ManualEntryFormProps {
  order: {
    id: string;
    patient_id: string;
    patient_name: string;
    lab_id: string;
  };
  testGroup: {
    id: string;
    name: string;
    department: string;
  };
  onSubmit: (results: any[]) => void;
}

interface AnalyteData {
  value: string;
  unit: string;
  referenceRange: string;
  flag?: string;
  isApproved?: boolean;
  isVerified?: boolean;
  existingId?: string;
}

const ManualEntryForm: React.FC<ManualEntryFormProps> = ({ order, testGroup, onSubmit }) => {
  const { user } = useAuth();
  const [analytes, setAnalytes] = useState<any[]>([]);
  const [formData, setFormData] = useState<Record<string, AnalyteData>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sectionResultId, setSectionResultId] = useState<string | null>(null);
  const [hasTechnicianSections, setHasTechnicianSections] = useState(false);
  const [sectionLoading, setSectionLoading] = useState(false);
  const [stockWarnings, setStockWarnings] = useState<Array<{
    itemId: string;
    itemName: string;
    currentStock: number;
    minStock: number;
    unit: string;
    status: 'out_of_stock' | 'low_stock';
  }>>([]);

  // Helper to determine if analyte expects categorical values — uses DB config first
  const getCategoricalOptions = (analyte: any): string[] | null => {
    // Priority 1: lab_analytes expected_normal_values from DB
    if (analyte.expected_normal_values && Array.isArray(analyte.expected_normal_values) && analyte.expected_normal_values.length > 0) {
      return analyte.expected_normal_values;
    }
    // Priority 2: value_type explicitly set to qualitative (free-text qualitative, no dropdown)
    if (analyte.value_type === 'qualitative') {
      return null;
    }
    return null;
  };

  // Fetch analytes for the test group
  const fetchAnalytes = async () => {
    try {
      const { data, error } = await supabase
        .from('test_group_analytes')
        .select(`
          analyte_id,
          lab_analyte_id,
          analytes!inner(
            id,
            name,
            unit,
            reference_range,
            low_critical,
            high_critical,
            category
          ),
          lab_analytes(
            id,
            name,
            unit,
            reference_range,
            lab_specific_reference_range,
            low_critical,
            high_critical,
            method,
            expected_normal_values,
            expected_value_flag_map,
            expected_value_codes,
            value_type,
            default_value,
            is_calculated,
            formula,
            formula_variables
          )
        `)
        .eq('test_group_id', testGroup.id);

      if (!error && data) {
        const analyteList = data.map(item => {
          const a = item.analytes;
          const la = item.lab_analyte_id ? item.lab_analytes : null;
          return {
            id: a.id,
            lab_analyte_id: item.lab_analyte_id || la?.id || null,
            name: la?.name || a.name,
            unit: la?.unit || a.unit || '',
            reference_range: la?.lab_specific_reference_range ?? la?.reference_range ?? a.reference_range ?? '',
            low_critical: la?.low_critical ?? a.low_critical,
            high_critical: la?.high_critical ?? a.high_critical,
            category: a.category,
            method: la?.method ?? undefined,
            expected_normal_values: la?.expected_normal_values ?? [],
            expected_value_flag_map: la?.expected_value_flag_map ?? {},
            expected_value_codes: la?.expected_value_codes ?? {},
            value_type: la?.value_type ?? undefined,
            default_value: la?.default_value ?? null,
            is_calculated: la?.is_calculated ?? false,
            formula: la?.formula ?? null,
            formula_variables: la?.formula_variables ?? [],
          };
        });
        setAnalytes(analyteList);
        
        // Initialize form data
        const initialData: Record<string, AnalyteData> = {};
        analyteList.forEach(analyte => {
          initialData[analyte.id] = {
            value: '',
            unit: analyte.unit,
            referenceRange: analyte.reference_range,
            flag: ''
          };
        });
        setFormData(initialData);
      }
    } catch (error) {
      console.error('Error fetching analytes:', error);
    }
  };

  // Fetch existing results
  const fetchExistingResults = async () => {
    try {
      const { data, error } = await supabase
        .from('result_values')
        .select(`
          id,
          analyte_id,
          parameter,
          value,
          unit,
          reference_range,
          flag,
          verify_status,
          verified,
          verified_at,
          verify_note
        `)
        .eq('order_id', order.id)
        .eq('test_group_id', testGroup.id);

      if (!error && data) {
        const updatedFormData = { ...formData };
        data.forEach(rv => {
          if (updatedFormData[rv.analyte_id]) {
            updatedFormData[rv.analyte_id] = {
              value: rv.value || '',
              unit: rv.unit || updatedFormData[rv.analyte_id].unit,
              referenceRange: rv.reference_range || updatedFormData[rv.analyte_id].referenceRange,
              flag: rv.flag || '',
              isApproved: rv.verify_status === 'approved',
              isVerified: rv.verified === true,
              existingId: rv.id
            };
          }
        });
        setFormData(updatedFormData);
      }
    } catch (error) {
      console.error('Error fetching existing results:', error);
    } finally {
      setLoading(false);
    }
  };

  // Fetch stock warnings for this test's mapped inventory items
  const fetchStockWarnings = async () => {
    try {
      const { data } = await database.inventory.getStockWarningsForTest(testGroup.id, order.lab_id);
      if (data && data.length > 0) {
        setStockWarnings(data);
      }
    } catch (err) {
      // Non-blocking - don't break result entry if inventory check fails
      console.warn('Stock warning check failed:', err);
    }
  };

  useEffect(() => {
    fetchAnalytes();
    fetchStockWarnings();
  }, [testGroup.id]);

  useEffect(() => {
    if (analytes.length > 0) {
      fetchExistingResults();
    }
  }, [analytes]);

  const ensureResultRecord = async () => {
    const { data: existing, error: existingError } = await database.results.getByOrderAndTestGroup(
      order.id,
      testGroup.id
    );

    if (existingError) {
      throw existingError;
    }

    if (existing) {
      return existing;
    }

    const { data: created, error: createError } = await database.results.create({
      order_id: order.id,
      patient_id: order.patient_id,
      patient_name: order.patient_name,
      test_name: testGroup.name,
      status: 'pending_verification',
      entered_by: user?.user_metadata?.full_name || user?.email || 'Unknown User',
      entered_date: new Date().toISOString().split('T')[0],
      test_group_id: testGroup.id,
      lab_id: order.lab_id,
    });

    if (createError) {
      throw createError;
    }

    return created;
  };

  useEffect(() => {
    let isActive = true;

    const loadTechnicianSections = async () => {
      setSectionLoading(true);
      try {
        const { data: sections, error } = await database.templateSections.getByTestGroup(testGroup.id);
        if (error) throw error;

        const hasTech = (sections || []).some((section: any) => section.allow_technician_entry);
        if (!isActive) return;

        setHasTechnicianSections(hasTech);

        if (hasTech) {
          const resultRecord = await ensureResultRecord();
          if (isActive && resultRecord?.id) {
            setSectionResultId(resultRecord.id);
          }
        }
      } catch (err) {
        console.error('Failed to load technician sections:', err);
      } finally {
        if (isActive) setSectionLoading(false);
      }
    };

    loadTechnicianSections();

    return () => {
      isActive = false;
    };
  }, [order.id, testGroup.id]);

  const handleAnalyteChange = (analyteId: string, data: Partial<AnalyteData>) => {
    setFormData(prev => ({
      ...prev,
      [analyteId]: { ...prev[analyteId], ...data }
    }));
  };

  const renderValueInput = (analyte: any, currentValue: AnalyteData, isApproved: boolean) => {
    const categoricalOptions = getCategoricalOptions(analyte);
    
    if (categoricalOptions && !isApproved) {
      return (
        <select
          value={currentValue.value || ''}
          onChange={(e) => handleAnalyteChange(analyte.id, { value: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Select...</option>
          {categoricalOptions.map(option => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      );
    }
    
    return (
      <input
        type="text"
        value={currentValue.value || ''}
        onChange={(e) => handleAnalyteChange(analyte.id, { value: e.target.value })}
        placeholder="Enter value"
        disabled={isApproved}
        className={`w-full px-3 py-2 border rounded-md ${
          isApproved 
            ? 'bg-gray-100 text-gray-600 cursor-not-allowed' 
            : 'border-gray-300 focus:ring-2 focus:ring-blue-500'
        }`}
      />
    );
  };

  const handleSubmit = async () => {
    setSaving(true);
    
    try {
      // Filter out empty values and approved results
      const resultsToSubmit = Object.entries(formData)
        .filter(([_, data]) => data.value && data.value.trim() !== '' && !data.isApproved)
        .map(([analyteId, data]) => {
          const analyte = analytes.find(a => a.id === analyteId);
          return {
            analyte_id: analyteId,
            lab_analyte_id: analyte?.lab_analyte_id || null,
            parameter: analyte?.name || '',
            value: data.value,
            unit: data.unit,
            reference_range: data.referenceRange,
            flag: data.flag
          };
        });

      if (resultsToSubmit.length === 0) {
        alert('No new results to submit');
        setSaving(false);
        return;
      }

      // Calculate flags
      const resultsWithFlags = calculateFlagsForResults(resultsToSubmit);

      // Create or update result record
      let resultId = sectionResultId;

      if (!resultId) {
        const resultRecord = await ensureResultRecord();
        resultId = resultRecord?.id || null;
        if (resultId) {
          setSectionResultId(resultId);
        }
      }

      if (!resultId) {
        throw new Error('Failed to create or find result record');
      }

      // Insert result values
      const resultValuesData = resultsWithFlags.map(rv => ({
        result_id: resultId,
        ...rv,
        order_id: order.id,
        test_group_id: testGroup.id,
        lab_id: order.lab_id,
        verify_status: 'pending'
      }));

      const { error: valuesError } = await database.resultValues.createMany(resultValuesData);

      if (valuesError) throw valuesError;

      // Auto-consume inventory for non-outsourced tests
      const { data: orderTest } = await supabase
        .from('order_tests')
        .select('outsourced_lab_id')
        .eq('order_id', order.id)
        .eq('test_group_id', testGroup.id)
        .maybeSingle();

      if (!orderTest?.outsourced_lab_id) {
        try {
          const { data: consumeResult } = await database.inventory.triggerAutoConsume({
            labId: order.lab_id,
            orderId: order.id,
            resultId: resultId,
            testGroupId: testGroup.id,
          });

          if (consumeResult && consumeResult.itemsConsumed > 0) {
            if (consumeResult.alertsGenerated > 0) {
              toast(`Inventory: ${consumeResult.itemsConsumed} items consumed | ${consumeResult.alertsGenerated} low stock alert${consumeResult.alertsGenerated > 1 ? 's' : ''}`, {
                icon: '⚠️',
                style: { background: '#FEF3C7', color: '#92400E' },
                duration: 5000,
              });
            } else {
              toast.success(`Inventory updated: ${consumeResult.itemsConsumed} item${consumeResult.itemsConsumed > 1 ? 's' : ''} consumed`);
            }
          }
        } catch (err) {
          console.warn('Inventory auto-consume failed (non-blocking):', err);
          toast('Inventory update failed (results saved)', {
            icon: '📦',
            style: { background: '#FED7AA', color: '#9A3412' },
          });
        }
      }

      onSubmit(resultsWithFlags);
      
    } catch (error) {
      console.error('Error submitting results:', error);
      alert('Failed to save results. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  const hasEditableResults = Object.values(formData).some(data => !data.isApproved);

  return (
    <div className="space-y-6">
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h4 className="font-medium text-blue-900">{testGroup.name}</h4>
        <p className="text-sm text-blue-700">
          Enter results for {analytes.length} parameters
        </p>
      </div>

      {/* Stock warnings for mapped inventory items */}
      {stockWarnings.length > 0 && (
        <div className="space-y-2">
          {stockWarnings.filter(w => w.status === 'out_of_stock').length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
              <PackageX className="h-5 w-5 text-red-600 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-red-800">Out of Stock</p>
                <p className="text-xs text-red-700 mt-0.5">
                  {stockWarnings.filter(w => w.status === 'out_of_stock').map(w => `${w.itemName} (${w.currentStock} ${w.unit})`).join(', ')}
                </p>
              </div>
            </div>
          )}
          {stockWarnings.filter(w => w.status === 'low_stock').length > 0 && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 flex items-start gap-2">
              <AlertTriangle className="h-5 w-5 text-yellow-600 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-yellow-800">Low Stock</p>
                <p className="text-xs text-yellow-700 mt-0.5">
                  {stockWarnings.filter(w => w.status === 'low_stock').map(w => `${w.itemName} (${w.currentStock} remaining, min: ${w.minStock})`).join(', ')}
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="space-y-4">
        {analytes.map(analyte => {
          const currentValue = formData[analyte.id] || {};
          const isApproved = currentValue.isApproved;
          
          return (
            <div key={analyte.id} className="grid grid-cols-5 gap-4 items-start p-4 border rounded-lg hover:bg-gray-50">
              <div className="col-span-1">
                <label className="text-sm font-medium text-gray-700">
                  {analyte.name}
                  {isApproved && (
                    <div className="flex items-center mt-1 text-xs text-green-600">
                      <CheckCircle className="h-3 w-3 mr-1" />
                      Approved
                    </div>
                  )}
                </label>
              </div>
              
              <div>
                {renderValueInput(analyte, currentValue, isApproved)}
              </div>
              
              <div>
                <input
                  type="text"
                  value={currentValue.unit || ''}
                  onChange={(e) => handleAnalyteChange(analyte.id, { unit: e.target.value })}
                  placeholder="Unit"
                  disabled={isApproved}
                  className={`w-full px-3 py-2 border rounded-md ${
                    isApproved 
                      ? 'bg-gray-100 text-gray-600 cursor-not-allowed' 
                      : 'border-gray-300 focus:ring-2 focus:ring-blue-500'
                  }`}
                />
              </div>
              
              <div>
                <input
                  type="text"
                  value={currentValue.referenceRange || ''}
                  onChange={(e) => handleAnalyteChange(analyte.id, { referenceRange: e.target.value })}
                  placeholder="Reference Range"
                  disabled={isApproved}
                  className={`w-full px-3 py-2 border rounded-md ${
                    isApproved 
                      ? 'bg-gray-100 text-gray-600 cursor-not-allowed' 
                      : 'border-gray-300 focus:ring-2 focus:ring-blue-500'
                  }`}
                />
              </div>
              
              <div>
                <select
                  value={currentValue.flag || ''}
                  onChange={(e) => handleAnalyteChange(analyte.id, { flag: e.target.value })}
                  disabled={isApproved}
                  className={`w-full px-3 py-2 border rounded-md ${
                    isApproved 
                      ? 'bg-gray-100 text-gray-600 cursor-not-allowed' 
                      : 'border-gray-300 focus:ring-2 focus:ring-blue-500'
                  }`}
                >
                  <option value="">Normal</option>
                  <option value="H">High</option>
                  <option value="L">Low</option>
                  <option value="C">Critical</option>
                </select>
              </div>
            </div>
          );
        })}
      </div>

      {sectionLoading && (
        <div className="flex items-center text-sm text-gray-500">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mr-2"></div>
          Loading report sections...
        </div>
      )}

      {hasTechnicianSections && sectionResultId && (
        <div className="mt-6">
          <SectionEditor
            resultId={sectionResultId}
            testGroupId={testGroup.id}
            editorRole="technician"
          />
        </div>
      )}

      {hasEditableResults && (
        <div className="flex justify-end space-x-3">
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            <Save className="h-4 w-4 mr-2" />
            {saving ? 'Saving...' : 'Save Results'}
          </button>
        </div>
      )}

      {!hasEditableResults && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
          <CheckCircle className="h-8 w-8 text-green-600 mx-auto mb-2" />
          <p className="text-green-800">All results for this test group have been approved</p>
        </div>
      )}
    </div>
  );
};

export default ManualEntryForm;
