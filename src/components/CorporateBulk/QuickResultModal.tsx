import React, { useState, useEffect, useCallback } from 'react';
import { X, Loader2, AlertCircle } from 'lucide-react';
import { supabase } from '../../utils/supabase';
import { ResultIntake } from '../Orders/ResultIntake';

interface TestGroup {
  test_group_id: string;
  test_group_name: string;
  order_test_group_id: string | null;
  order_test_id: string | null;
  analytes: any[];
}

interface OrderData {
  id: string;
  lab_id: string;
  patient_id: string;
  patient_name: string;
  test_groups: TestGroup[];
  sample_id?: string;
  status: string;
  order_display?: string | null;
}

interface QuickResultModalProps {
  orderId: string;
  onClose: () => void;
  onSaved?: () => void;
}

const QuickResultModal: React.FC<QuickResultModalProps> = ({ orderId, onClose, onSaved }) => {
  const [order, setOrder] = useState<OrderData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadOrder = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from('orders')
        .select(`
          id, lab_id, patient_id, patient_name, status, order_display,
          patients!inner(id, name),
          order_test_groups(
            id, test_group_id, test_name,
            test_groups(
              id, name, code,
              test_group_analytes(
                analyte_id, lab_analyte_id,
                analytes(id, name, unit, reference_range, ai_processing_type, is_calculated, formula, formula_variables),
                lab_analytes(id, name, unit, reference_range, lab_specific_reference_range, is_calculated, formula, formula_variables)
              )
            )
          ),
          order_tests(
            id, test_group_id, sample_id,
            test_groups(
              id, name, code,
              test_group_analytes(
                analyte_id, lab_analyte_id,
                analytes(id, name, unit, reference_range, ai_processing_type, is_calculated, formula, formula_variables),
                lab_analytes(id, name, unit, reference_range, lab_specific_reference_range, is_calculated, formula, formula_variables)
              )
            )
          ),
          samples(id, barcode),
          results(
            id, order_test_group_id, order_test_id,
            result_values(id, analyte_id, value, unit, reference_range, flag)
          )
        `)
        .eq('id', orderId)
        .single();

      if (err) throw err;

      const buildAnalytes = (tga: any, results: any[], otgId: string | null, otId: string | null) => {
        const a = tga.analytes;
        const la = tga.lab_analyte_id ? tga.lab_analytes : null;
        const result = results?.find((r: any) =>
          (otgId && r.order_test_group_id === otgId) ||
          (otId && r.order_test_id === otId)
        );
        return {
          ...a,
          lab_analyte_id: tga.lab_analyte_id || la?.id || null,
          name: la?.name || a.name,
          unit: la?.unit || a.unit,
          units: la?.unit || a.unit,
          reference_range: la?.lab_specific_reference_range ?? la?.reference_range ?? a.reference_range,
          is_calculated: la?.is_calculated ?? a.is_calculated,
          formula: la?.formula ?? a.formula,
          formula_variables: la?.formula_variables ?? a.formula_variables,
          existing_result: result?.result_values?.find((rv: any) => rv.analyte_id === a.id) || null,
        };
      };

      const fromOTG: TestGroup[] = (data.order_test_groups || [])
        .filter((otg: any) => otg.test_groups)
        .map((otg: any) => ({
          test_group_id: otg.test_groups.id,
          test_group_name: otg.test_groups.name,
          order_test_group_id: otg.id,
          order_test_id: null,
          analytes: (otg.test_groups.test_group_analytes || []).map((tga: any) =>
            buildAnalytes(tga, data.results || [], otg.id, null)
          ),
        }));

      const fromOT: TestGroup[] = (data.order_tests || [])
        .filter((ot: any) => ot.test_groups && ot.test_group_id)
        .map((ot: any) => ({
          test_group_id: ot.test_groups.id,
          test_group_name: ot.test_groups.name,
          order_test_group_id: null,
          order_test_id: ot.id,
          analytes: (ot.test_groups.test_group_analytes || []).map((tga: any) =>
            buildAnalytes(tga, data.results || [], null, ot.id)
          ),
        }));

      // Merge by test_group_id
      const merged: TestGroup[] = [...fromOTG, ...fromOT].reduce((acc: TestGroup[], cur) => {
        const idx = acc.findIndex((t) => t.test_group_id === cur.test_group_id);
        if (idx === -1) { acc.push(cur); }
        else {
          const existing = acc[idx];
          const mergedAnalytes = [...existing.analytes];
          cur.analytes.forEach((a) => { if (!mergedAnalytes.find((m) => m.id === a.id)) mergedAnalytes.push(a); });
          acc[idx] = { ...existing, analytes: mergedAnalytes, order_test_group_id: existing.order_test_group_id || cur.order_test_group_id, order_test_id: existing.order_test_id || cur.order_test_id };
        }
        return acc;
      }, []);

      setOrder({
        id: data.id,
        lab_id: data.lab_id,
        patient_id: data.patient_id,
        patient_name: data.patients?.name || data.patient_name,
        test_groups: merged,
        sample_id: data.samples?.[0]?.barcode || data.samples?.[0]?.id,
        status: data.status,
        order_display: data.order_display,
      });
    } catch (e) {
      setError('Failed to load order. Please try again.');
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => { loadOrder(); }, [loadOrder]);

  const handleResultProcessed = (resultId: string) => {
    loadOrder(); // reload so existing_result fields refresh
    onSaved?.();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b">
          <div>
            <h2 className="text-base font-semibold text-gray-900">
              Result Entry
              {order && (
                <span className="ml-2 text-sm font-normal text-gray-500">
                  — {order.order_display || orderId.slice(-8)} · {order.patient_name}
                </span>
              )}
            </h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading && (
            <div className="flex items-center justify-center py-16 text-gray-400">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading order...
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 text-red-600 bg-red-50 rounded-lg p-4">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          {!loading && !error && order && (
            <ResultIntake
              order={order}
              onResultProcessed={handleResultProcessed}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default QuickResultModal;
