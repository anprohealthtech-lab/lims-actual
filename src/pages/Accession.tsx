import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle, Loader, RefreshCcw, Search, TestTube, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { collectSample } from '../services/sampleService';
import { database, supabase } from '../utils/supabase';

type AccessionSample = {
  id: string;
  order_id: string;
  barcode: string | null;
  sample_type: string | null;
  status: string;
  created_at: string;
  pre_barcoded?: boolean | null;
  patient_name?: string | null;
  order_display?: string | null;
  order_number?: number | null;
  doctor?: string | null;
  tests: string[];
};

const collectableStatuses = new Set(['created']);

const Accession: React.FC = () => {
  const { user } = useAuth();
  const [samples, setSamples] = useState<AccessionSample[]>([]);
  const [query, setQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSamples = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const labId = await database.getCurrentUserLabId();
      if (!labId) throw new Error('Lab context unavailable');

      const { data: sampleRows, error: sampleError } = await supabase
        .from('samples')
        .select('id, order_id, barcode, sample_type, status, created_at, pre_barcoded')
        .eq('lab_id', labId)
        .in('status', ['created', 'collected'])
        .order('created_at', { ascending: false })
        .limit(200);

      if (sampleError) throw sampleError;

      const orderIds = Array.from(new Set((sampleRows || []).map((sample: any) => sample.order_id).filter(Boolean)));
      const [ordersResult, testsResult] = await Promise.all([
        orderIds.length
          ? supabase
              .from('orders')
              .select('id, patient_name, order_display, order_number, doctor')
              .in('id', orderIds)
          : Promise.resolve({ data: [], error: null } as any),
        orderIds.length
          ? supabase
              .from('order_test_groups')
              .select('order_id, sample_id, test_name')
              .in('order_id', orderIds)
          : Promise.resolve({ data: [], error: null } as any),
      ]);

      if (ordersResult.error) throw ordersResult.error;
      if (testsResult.error) throw testsResult.error;

      const ordersById = new Map((ordersResult.data || []).map((order: any) => [order.id, order]));
      const testsBySampleId = new Map<string, string[]>();
      (testsResult.data || []).forEach((row: any) => {
        if (!row.sample_id) return;
        const existing = testsBySampleId.get(row.sample_id) || [];
        existing.push(row.test_name);
        testsBySampleId.set(row.sample_id, existing);
      });

      setSamples((sampleRows || []).map((sample: any) => {
        const order = ordersById.get(sample.order_id) as any;
        return {
          ...sample,
          patient_name: order?.patient_name || null,
          order_display: order?.order_display || null,
          order_number: order?.order_number || null,
          doctor: order?.doctor || null,
          tests: testsBySampleId.get(sample.id) || [],
        };
      }));
    } catch (err: any) {
      setError(err.message || 'Failed to load accession samples');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSamples();
  }, [fetchSamples]);

  const filteredSamples = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return samples;
    return samples.filter((sample) => {
      const haystack = [
        sample.id,
        sample.barcode,
        sample.patient_name,
        sample.order_display,
        sample.order_number,
        sample.sample_type,
        ...sample.tests,
      ].join(' ').toLowerCase();
      return haystack.includes(term);
    });
  }, [query, samples]);

  const selectedSamples = filteredSamples.filter((sample) => selectedIds.has(sample.id));
  const canCollectSelected = selectedSamples.some((sample) => collectableStatuses.has(sample.status));

  const toggleSample = (sampleId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(sampleId)) next.delete(sampleId);
      else next.add(sampleId);
      return next;
    });
  };

  const collectSelected = async () => {
    const collectorId = user?.id;
    if (!collectorId) {
      setError('User not authenticated');
      return;
    }

    const pending = samples.filter((sample) => selectedIds.has(sample.id) && collectableStatuses.has(sample.status));
    if (pending.length === 0) return;

    try {
      setCollecting(true);
      setError(null);
      for (const sample of pending) {
        await collectSample(sample.id, collectorId);
      }
      setSelectedIds(new Set());
      await fetchSamples();
    } catch (err: any) {
      setError(err.message || 'Failed to mark selected samples collected');
    } finally {
      setCollecting(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Accession</h1>
          <p className="text-sm text-gray-500">Scan pre-barcoded tubes, verify order details, and mark samples collected.</p>
        </div>
        <button
          type="button"
          onClick={fetchSamples}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
        >
          <RefreshCcw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-4 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            autoFocus
            placeholder="Scan barcode or search patient, order, sample..."
            className="w-full rounded-md border border-gray-300 py-2 pl-9 pr-9 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={collectSelected}
          disabled={collecting || !canCollectSelected}
          className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {collecting ? <Loader className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
          Mark Collected ({selectedSamples.length})
        </button>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <div className="border-b border-gray-200 px-4 py-3 text-sm text-gray-600">
          Showing {filteredSamples.length} samples. Select rows and mark collected in bulk.
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="w-10 px-4 py-3"></th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Barcode</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Patient</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Sample</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Tests</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-gray-500">
                    <Loader className="mx-auto mb-2 h-5 w-5 animate-spin text-blue-600" />
                    Loading samples...
                  </td>
                </tr>
              ) : filteredSamples.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-gray-500">No samples found.</td>
                </tr>
              ) : (
                filteredSamples.map((sample) => (
                  <tr key={sample.id} className={selectedIds.has(sample.id) ? 'bg-blue-50' : 'hover:bg-gray-50'}>
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(sample.id)}
                        onChange={() => toggleSample(sample.id)}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-mono text-sm font-medium text-gray-900">{sample.barcode || sample.id}</div>
                      {sample.pre_barcoded && <div className="text-xs text-blue-600">Pre-barcoded</div>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium text-gray-900">{sample.patient_name || 'Unknown patient'}</div>
                      <div className="text-xs text-gray-500">{sample.order_display || (sample.order_number ? `Order #${sample.order_number}` : sample.order_id)}</div>
                      {sample.doctor && sample.doctor !== 'Self' && <div className="text-xs text-gray-500">Dr. {sample.doctor}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 text-sm text-gray-700">
                        <TestTube className="h-4 w-4 text-gray-400" />
                        {sample.sample_type || 'Sample'}
                      </div>
                      <div className="font-mono text-xs text-gray-400">{sample.id}</div>
                    </td>
                    <td className="max-w-sm px-4 py-3 text-sm text-gray-600">
                      {sample.tests.length > 0 ? sample.tests.join(', ') : 'No linked tests'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${
                        sample.status === 'collected'
                          ? 'bg-green-100 text-green-700'
                          : 'bg-amber-100 text-amber-700'
                      }`}>
                        {sample.status === 'collected' ? 'Collected' : 'Pending'}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default Accession;
