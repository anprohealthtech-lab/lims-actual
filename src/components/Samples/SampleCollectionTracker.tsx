// components/Samples/SampleCollectionTracker.tsx
import React, { useEffect, useState, useCallback } from 'react';
import { CheckCircle, AlertCircle, Clock, Loader, Printer, User, ChevronDown } from 'lucide-react';
import { getSamplesForOrder, collectSample, Sample } from '../../services/sampleService';
import { SampleTypeIndicator } from '../Common/SampleTypeIndicator';
import { useAuth } from '../../contexts/AuthContext';
import { useQZTray } from '../../contexts/QZTrayContext';
import { SampleLabelPrinter } from './SampleLabelPrinter';
import { database, supabase } from '../../utils/supabase';

interface Phlebotomist {
  id: string;
  name: string;
  email: string;
}

interface ChecklistItem {
  label: string;
  checked: boolean;
}

interface SampleCollectionTrackerProps {
  orderId: string;
  onSampleCollected?: (sample: Sample) => void;
  onAllCollected?: () => void;
  showTitle?: boolean;
  collectedById?: string;
  showFinishButton?: boolean;
}

export const SampleCollectionTracker: React.FC<SampleCollectionTrackerProps> = ({
  orderId,
  onSampleCollected,
  onAllCollected,
  showTitle = true,
  collectedById,
  showFinishButton = true,
}) => {
  const { user } = useAuth();
  const { autoPrintBarcode } = useQZTray();

  const [samples, setSamples] = useState<Sample[]>([]);
  const [loading, setLoading] = useState(true);
  const [collectingId, setCollectingId] = useState<string | null>(null);
  const [printingSampleId, setPrintingSampleId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Per-sample phlebotomist: Map<sampleId, userId>
  const [sampleCollectors, setSampleCollectors] = useState<Map<string, string>>(new Map());
  const [phlebotomists, setPhlebotomists] = useState<Phlebotomist[]>([]);

  // Per-sample checklist: Map<sampleId, ChecklistItem[]>
  const [sampleChecklists, setSampleChecklists] = useState<Map<string, ChecklistItem[]>>(new Map());

  // Patient name for barcode label
  const [patientName, setPatientName] = useState('');

  const defaultCollectorId = collectedById || user?.id || '';

  // Load phlebotomists; fall back to all lab users if none are flagged
  useEffect(() => {
    database.users.getPhlebotomists().then(async (list: any[]) => {
      if (list && list.length > 0) {
        setPhlebotomists(list.map((u: any) => ({ id: u.id, name: u.name || u.email, email: u.email })));
      } else {
        // No dedicated phlebotomists — use all lab users so selector still appears
        const { data } = await supabase.from('users').select('id, name, email').order('name');
        setPhlebotomists((data || []).map((u: any) => ({ id: u.id, name: u.name || u.email, email: u.email })));
      }
    }).catch(() => {});
  }, []);

  // Load samples + patient name + checklists
  const fetchSamples = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getSamplesForOrder(orderId);
      setSamples(data);

      // Default collector for any uncollected sample
      const collectors = new Map<string, string>();
      data.forEach(s => {
        if (s.status === 'created') collectors.set(s.id, defaultCollectorId);
      });
      setSampleCollectors(prev => {
        const merged = new Map(prev);
        collectors.forEach((v, k) => { if (!merged.has(k)) merged.set(k, v); });
        return merged;
      });

      // Load checklist items from test_groups for each sample
      // samples → order_test_groups → test_groups.collection_checklist
      if (data.length > 0) {
        const { data: otgRows } = await supabase
          .from('order_test_groups')
          .select('sample_id, test_groups(collection_checklist)')
          .eq('order_id', orderId);

        const checklistMap = new Map<string, ChecklistItem[]>();
        (otgRows || []).forEach((row: any) => {
          const sid = row.sample_id;
          if (!sid) return;
          const items: string[] = row.test_groups?.collection_checklist || [];
          if (items.length === 0) return;
          const existing = checklistMap.get(sid) || [];
          // Deduplicate items
          const existingLabels = new Set(existing.map(i => i.label));
          items.forEach(label => {
            if (!existingLabels.has(label)) existing.push({ label, checked: false });
          });
          checklistMap.set(sid, existing);
        });
        setSampleChecklists(checklistMap);
      }

      // Load patient name
      const { data: orderRow } = await supabase
        .from('orders')
        .select('patient_name')
        .eq('id', orderId)
        .single();
      if (orderRow?.patient_name) setPatientName(orderRow.patient_name);
    } catch (err) {
      console.error('Error fetching samples:', err);
      setError('Failed to load samples');
    } finally {
      setLoading(false);
    }
  }, [orderId, defaultCollectorId]);

  useEffect(() => { fetchSamples(); }, [orderId]);

  useEffect(() => {
    if (!collectedById) return;

    setSampleCollectors(prev => {
      const next = new Map(prev);
      samples.forEach(sample => {
        if (sample.status === 'created') next.set(sample.id, collectedById);
      });
      return next;
    });
  }, [collectedById, samples]);

  const handleCollect = async (sampleId: string) => {
    const collectorId = sampleCollectors.get(sampleId) || defaultCollectorId;
    if (!collectorId) { alert('User not authenticated'); return; }

    // Validate checklist — all items must be checked
    const checklist = sampleChecklists.get(sampleId) || [];
    const unchecked = checklist.filter(i => !i.checked);
    if (unchecked.length > 0) {
      alert(`Please confirm all checklist items before collecting:\n• ${unchecked.map(i => i.label).join('\n• ')}`);
      return;
    }

    try {
      setCollectingId(sampleId);
      setError(null);
      await collectSample(sampleId, collectorId);

      // Save checklist_completed to samples
      if (checklist.length > 0) {
        const completed: Record<string, boolean> = {};
        checklist.forEach(i => { completed[i.label] = i.checked; });
        await supabase.from('samples').update({ checklist_completed: completed }).eq('id', sampleId);
      }

      // Auto-print barcode via LIMS Utility queue
      const sample = samples.find(s => s.id === sampleId);
      if (sample) {
        console.debug('[PrintBridge][BarcodeLabel] auto-print after sample collection requested', {
          sampleId: sample.id,
          barcode: sample.barcode,
          sampleType: sample.sample_type,
          patientName,
        });
        autoPrintBarcode({
          sampleId: sample.barcode || sample.id,
          labelId: sample.id,
          patientName,
          sampleType: sample.sample_type,
        });
      }

      await fetchSamples();

      if (sample && onSampleCollected) {
        onSampleCollected({ ...sample, status: 'collected' });
      }
    } catch (err: any) {
      setError(err.message || 'Failed to mark sample as collected');
    } finally {
      setCollectingId(null);
    }
  };

  const toggleChecklistItem = (sampleId: string, label: string) => {
    setSampleChecklists(prev => {
      const map = new Map(prev);
      const items = (map.get(sampleId) || []).map(i =>
        i.label === label ? { ...i, checked: !i.checked } : i
      );
      map.set(sampleId, items);
      return map;
    });
  };

  const allCollected = samples.length > 0 &&
    samples.every(s => ['collected', 'received', 'processing', 'processed'].includes(s.status));

  const getStatusBadge = (status: Sample['status']) => {
    switch (status) {
      case 'created':
        return <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-gray-100 text-gray-700 rounded-full"><Clock className="h-3 w-3" />Pending</span>;
      case 'collected':
        return <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-green-100 text-green-700 rounded-full"><CheckCircle className="h-3 w-3" />Collected</span>;
      case 'received':
        return <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-blue-100 text-blue-700 rounded-full"><CheckCircle className="h-3 w-3" />Received</span>;
      case 'processing':
        return <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-purple-100 text-purple-700 rounded-full"><Loader className="h-3 w-3 animate-spin" />Processing</span>;
      case 'rejected':
        return <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-red-100 text-red-700 rounded-full"><AlertCircle className="h-3 w-3" />Rejected</span>;
      default:
        return <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-gray-100 text-gray-700 rounded-full">{status}</span>;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader className="h-6 w-6 text-blue-600 animate-spin" />
        <span className="ml-2 text-sm text-gray-600">Loading samples...</span>
      </div>
    );
  }

  if (samples.length === 0) {
    return (
      <div className="bg-gray-50 rounded-lg p-4 text-center">
        <p className="text-sm text-gray-600">No samples required for this order</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {showTitle && (
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">
            Sample Collection ({samples.filter(s => s.status === 'collected').length}/{samples.length})
          </h3>
          {allCollected && (
            <span className="text-xs font-medium text-green-600">✓ All samples collected</span>
          )}
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{error}</div>
      )}

      <div className="space-y-3">
        {samples.map((sample) => {
          const checklist = sampleChecklists.get(sample.id) || [];
          const allChecked = checklist.every(i => i.checked);
          const isPending = sample.status === 'created';
          const currentCollector = sampleCollectors.get(sample.id) || defaultCollectorId;

          return (
            <div key={sample.id} className="border border-gray-200 rounded-lg overflow-hidden">
              {/* Main row */}
              <div className="flex items-center gap-3 p-3 bg-white">
                <div className="flex-shrink-0">
                  <SampleTypeIndicator sampleType={sample.sample_type} size="md" showLabel={false} />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="font-mono font-bold text-sm text-gray-900 truncate">{sample.id}</div>
                  <div className="text-xs text-gray-500">{sample.sample_type} • {sample.container_type}</div>
                </div>

                <div className="flex-shrink-0">{getStatusBadge(sample.status)}</div>

                <div className="flex-shrink-0 flex items-center gap-2">
                  {/* Print label */}
                  <button
                    onClick={() => setPrintingSampleId(printingSampleId === sample.id ? null : sample.id)}
                    className={`p-1.5 rounded-lg transition-colors ${printingSampleId === sample.id ? 'bg-blue-100 text-blue-700' : 'text-gray-500 hover:bg-gray-100'}`}
                    title="Print label"
                  >
                    <Printer className="h-4 w-4" />
                  </button>

                  {isPending ? (
                    <button
                      onClick={() => handleCollect(sample.id)}
                      disabled={collectingId === sample.id || (checklist.length > 0 && !allChecked)}
                      className="px-3 py-1.5 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:bg-green-300 disabled:cursor-not-allowed transition-colors"
                      title={checklist.length > 0 && !allChecked ? 'Complete checklist first' : ''}
                    >
                      {collectingId === sample.id ? (
                        <span className="flex items-center gap-1"><Loader className="h-3 w-3 animate-spin" />Collecting...</span>
                      ) : 'Mark Collected'}
                    </button>
                  ) : (
                    <span className="text-xs text-gray-400 font-medium px-2">
                      {sample.collected_at
                        ? new Date(sample.collected_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                        : ''}
                    </span>
                  )}
                </div>
              </div>

              {/* Per-sample phlebotomist selector (only when pending) */}
              {isPending && phlebotomists.length > 0 && (
                <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border-t border-gray-100">
                  <User className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                  <label className="text-xs text-gray-500 shrink-0">Collected by:</label>
                  <div className="relative flex-1">
                    <select
                      value={currentCollector}
                      onChange={(e) => setSampleCollectors(prev => new Map(prev).set(sample.id, e.target.value))}
                      className="w-full text-xs pl-2 pr-6 py-1 border border-gray-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 appearance-none"
                    >
                      {user && (
                        <option value={user.id}>{user.user_metadata?.name || user.email} (me)</option>
                      )}
                      {phlebotomists
                        .filter(p => p.id !== user?.id)
                        .map(p => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                    </select>
                    <ChevronDown className="h-3 w-3 text-gray-400 absolute right-1.5 top-1.5 pointer-events-none" />
                  </div>
                </div>
              )}

              {/* Checklist */}
              {isPending && checklist.length > 0 && (
                <div className="px-3 py-2 bg-amber-50 border-t border-amber-100 space-y-1.5">
                  <p className="text-xs font-medium text-amber-800">Pre-collection checklist</p>
                  {checklist.map(item => (
                    <label key={item.label} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={item.checked}
                        onChange={() => toggleChecklistItem(sample.id, item.label)}
                        className="h-3.5 w-3.5 rounded border-gray-300 text-green-600 focus:ring-green-500"
                      />
                      <span className={`text-xs ${item.checked ? 'line-through text-gray-400' : 'text-amber-900'}`}>
                        {item.label}
                      </span>
                    </label>
                  ))}
                </div>
              )}

              {/* Label printer expansion */}
              {printingSampleId === sample.id && (
                <div className="px-3 pb-3 pt-1 bg-gray-50 border-t border-gray-100">
                  <SampleLabelPrinter sample={sample} patientName={patientName} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Save & Finish button when all collected */}
      {allCollected && showFinishButton ? (
        <button
          onClick={() => onAllCollected?.()}
          className="w-full py-2.5 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
        >
          <CheckCircle className="h-4 w-4" />
          Save &amp; Finish
        </button>
      ) : !allCollected ? (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <p className="text-xs text-blue-800">
            💡 <strong>Tip:</strong> Select collector per sample if different phlebotomists are involved.
            Complete the checklist (if any) before marking collected.
          </p>
        </div>
      ) : null}
    </div>
  );
};

export default SampleCollectionTracker;
