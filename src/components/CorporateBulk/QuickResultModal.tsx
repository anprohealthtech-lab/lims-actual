import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { supabase } from '../../utils/supabase';
import QuickResultEntryModal from '../Orders/QuickResultEntryModal';

interface QuickResultModalProps {
  orderId: string;
  onClose: () => void;
  onSaved?: () => void;
}

interface QuickEntryOrder {
  id: string;
  lab_id: string;
  patient_id: string;
  patient_name: string;
  patient?: { age?: string | null; gender?: string | null } | null;
  tests: string[];
  sample_id?: string | null;
}

const QuickResultModal: React.FC<QuickResultModalProps> = ({ orderId, onClose, onSaved }) => {
  const [order, setOrder] = useState<QuickEntryOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadOrder = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from('orders')
        .select(`
          id, lab_id, patient_id, patient_name,
          patients(id, name, age, gender),
          order_test_groups(test_name, test_groups(name)),
          order_tests(test_name, test_groups(name)),
          samples(id, barcode)
        `)
        .eq('id', orderId)
        .single();

      if (err) throw err;

      const tests = [
        ...(data.order_test_groups || []).map((row: any) => row.test_groups?.name || row.test_name),
        ...(data.order_tests || []).map((row: any) => row.test_groups?.name || row.test_name),
      ].filter(Boolean);

      setOrder({
        id: data.id,
        lab_id: data.lab_id,
        patient_id: data.patient_id,
        patient_name: data.patients?.name || data.patient_name,
        patient: {
          age: data.patients?.age ?? null,
          gender: data.patients?.gender ?? null,
        },
        tests: Array.from(new Set(tests)),
        sample_id: data.samples?.[0]?.barcode || data.samples?.[0]?.id || null,
      });
    } catch (e) {
      setError('Failed to load order. Please try again.');
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    loadOrder();
  }, [loadOrder]);

  if (loading || error || !order) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
          {loading && (
            <div className="flex items-center justify-center py-8 text-gray-500">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Loading order...
            </div>
          )}
          {error && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 rounded-lg bg-red-50 p-4 text-red-600">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                {error}
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
                >
                  Close
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <QuickResultEntryModal
      order={order}
      onClose={onClose}
      onSubmitted={() => {
        onSaved?.();
      }}
      showAutoVerifyOption={true}
    />
  );
};

export default QuickResultModal;
