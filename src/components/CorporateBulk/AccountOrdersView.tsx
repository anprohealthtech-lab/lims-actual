import React, { useState, useEffect, useCallback } from 'react';
import { supabase, database } from '../../utils/supabase';
import { Download, FileDown, RefreshCw, Loader2, CheckCircle2, Clock, AlertCircle, ExternalLink, Filter, ClipboardEdit, Printer } from 'lucide-react';
import QuickResultModal from './QuickResultModal';
import QuickSendReport from '../WhatsApp/QuickSendReport';

interface Account {
  id: string;
  name: string;
  type: string;
}

interface Batch {
  id: string;
  created_at: string;
  total_patients: number;
  created_orders: number;
  status: string;
}

interface OrderRow {
  id: string;
  order_display: string | null;
  order_date: string;
  patient_name: string;
  patient_phone: string | null;
  status: string;
  total_amount: number;
  final_amount: number | null;
  account_id: string;
  bulk_batch_id: string | null;
  report_generation_status: string | null;
  smart_report_url: string | null;
  report_pdf_url: string | null;
  report_print_pdf_url: string | null;
  has_report: boolean;
}

interface DownloadRequest {
  id: string;
  status: string;
  zip_url: string | null;
  total_orders: number;
  processed_orders: number;
  error_message: string | null;
}

interface AccountOrdersViewProps {
  initialAccountId?: string;
  initialBatchId?: string;
}

const AccountOrdersView: React.FC<AccountOrdersViewProps> = ({ initialAccountId, initialBatchId }) => {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [labId, setLabId] = useState<string | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState(initialAccountId || '');
  const [selectedBatchId, setSelectedBatchId] = useState(initialBatchId || '');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set());
  const [downloadRequest, setDownloadRequest] = useState<DownloadRequest | null>(null);
  const [downloadPollInterval, setDownloadPollInterval] = useState<ReturnType<typeof setInterval> | null>(null);
  const [downloadLoading, setDownloadLoading] = useState(false);
  const [quickResultOrderId, setQuickResultOrderId] = useState<string | null>(null);

  // Load lab_id and accounts on mount
  useEffect(() => {
    const loadLabAndAccounts = async () => {
      const currentLabId = await database.getCurrentUserLabId();
      setLabId(currentLabId);
      if (!currentLabId) return;
      const { data } = await supabase
        .from('accounts')
        .select('id, name, type')
        .eq('lab_id', currentLabId)
        .in('type', ['corporate', 'hospital', 'insurer', 'clinic', 'doctor', 'other'])
        .eq('is_active', true)
        .order('name');
      setAccounts(data || []);
    };
    loadLabAndAccounts();
  }, []);

  // Load batches when account changes
  useEffect(() => {
    if (!selectedAccountId) { setBatches([]); return; }
    supabase
      .from('bulk_registration_batches')
      .select('id, created_at, total_patients, created_orders, status')
      .eq('account_id', selectedAccountId)
      .order('created_at', { ascending: false })
      .limit(50)
      .then(({ data }) => setBatches(data || []));
  }, [selectedAccountId]);

  const loadOrders = useCallback(async () => {
    if (!selectedAccountId && !selectedBatchId) { setOrders([]); return; }
    setLoading(true);
    try {
      let query = supabase
        .from('orders')
        .select(`
          id, order_display, order_date, patient_name, status,
          total_amount, final_amount, account_id, bulk_batch_id,
          report_generation_status, smart_report_url,
          patients(phone),
          reports!reports_order_id_fkey(id, pdf_url, print_pdf_url)
        `)
        .order('order_date', { ascending: false })
        .limit(200);

      if (selectedBatchId) {
        query = query.eq('bulk_batch_id', selectedBatchId);
      } else if (selectedAccountId) {
        query = query.eq('account_id', selectedAccountId);
      }

      if (dateFrom) query = query.gte('order_date', dateFrom);
      if (dateTo) query = query.lte('order_date', dateTo);

      const { data, error } = await query;
      if (error) throw error;

      const mapped = (data || []).map((o: {
        id: string;
        order_display: string | null;
        order_date: string;
        patient_name: string;
        patients: { phone: string | null } | null;
        status: string;
        total_amount: number;
        final_amount: number | null;
        account_id: string;
        bulk_batch_id: string | null;
        report_generation_status: string | null;
        smart_report_url: string | null;
        reports: { id: string; pdf_url: string | null; print_pdf_url: string | null }[] | { id: string; pdf_url: string | null; print_pdf_url: string | null } | null;
      }) => ({
        ...o,
        patient_phone: o.patients?.phone || null,
        report_pdf_url: Array.isArray(o.reports) ? (o.reports[0]?.pdf_url || null) : (o.reports?.pdf_url || null),
        report_print_pdf_url: Array.isArray(o.reports) ? (o.reports[0]?.print_pdf_url || null) : (o.reports?.print_pdf_url || null),
        has_report: !!(
          o.smart_report_url ||
          o.report_generation_status === 'completed' ||
          (Array.isArray(o.reports) ? o.reports.some((r) => !!(r?.pdf_url || r?.print_pdf_url)) : !!(o.reports?.pdf_url || o.reports?.print_pdf_url))
        ),
      }));
      setOrders(mapped);
    } finally {
      setLoading(false);
    }
  }, [selectedAccountId, selectedBatchId, dateFrom, dateTo]);

  useEffect(() => { loadOrders(); }, [loadOrders]);

  // Auto-select batch if initialBatchId provided
  useEffect(() => {
    if (initialBatchId) setSelectedBatchId(initialBatchId);
  }, [initialBatchId]);

  // Poll download request status
  useEffect(() => {
    if (downloadRequest?.status === 'completed' || downloadRequest?.status === 'failed') {
      if (downloadPollInterval) { clearInterval(downloadPollInterval); setDownloadPollInterval(null); }
    }
  }, [downloadRequest, downloadPollInterval]);

  const toggleSelectAll = () => {
    if (selectedOrderIds.size === orders.length) {
      setSelectedOrderIds(new Set());
    } else {
      setSelectedOrderIds(new Set(orders.map((o) => o.id)));
    }
  };

  const toggleOrder = (id: string) => {
    setSelectedOrderIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const startBulkDownload = async () => {
    const orderIds = selectedOrderIds.size > 0
      ? Array.from(selectedOrderIds)
      : orders.filter((o) => o.has_report).map((o) => o.id);

    if (orderIds.length === 0) {
      alert('No orders with generated reports found. Please generate reports first.');
      return;
    }

    setDownloadLoading(true);
    setDownloadRequest(null);

    try {
      // Create the download request record
      const { data: { user } } = await supabase.auth.getUser();
      const { data: userData } = await supabase.from('users').select('lab_id').eq('id', user!.id).single();

      const { data: reqData, error: reqError } = await supabase
        .from('bulk_pdf_download_requests')
        .insert({
          lab_id: userData!.lab_id,
          account_id: selectedAccountId || null,
          bulk_batch_id: selectedBatchId || null,
          order_ids: orderIds,
          date_from: dateFrom || null,
          date_to: dateTo || null,
          total_orders: orderIds.length,
          status: 'pending',
          created_by: user!.id,
        })
        .select()
        .single();

      if (reqError || !reqData) throw new Error(reqError?.message || 'Failed to create download request');

      setDownloadRequest(reqData);

      // Invoke edge function
      const { error: fnError } = await supabase.functions.invoke('bulk-pdf-zip', {
        body: { request_id: reqData.id },
      });

      if (fnError) throw new Error(fnError.message);

      // Poll for completion
      const interval = setInterval(async () => {
        const { data } = await supabase
          .from('bulk_pdf_download_requests')
          .select('id, status, zip_url, total_orders, processed_orders, error_message')
          .eq('id', reqData.id)
          .single();
        if (data) {
          setDownloadRequest(data);
          if (data.status === 'completed' || data.status === 'failed') {
            clearInterval(interval);
            setDownloadPollInterval(null);
          }
        }
      }, 2000);
      setDownloadPollInterval(interval);

    } catch (err) {
      alert(`Download failed: ${(err as Error).message}`);
    } finally {
      setDownloadLoading(false);
    }
  };

  const ordersWithReports = orders.filter((o) => o.has_report).length;
  const effectiveSelectedCount = selectedOrderIds.size > 0 ? selectedOrderIds.size : ordersWithReports;

  const statusBadge = (status: string) => {
    const map: Record<string, string> = {
      'Order Created': 'bg-blue-100 text-blue-700',
      'Sample Collected': 'bg-yellow-100 text-yellow-700',
      'Results Entered': 'bg-orange-100 text-orange-700',
      'Verified': 'bg-purple-100 text-purple-700',
      'Report Generated': 'bg-green-100 text-green-700',
      'Delivered': 'bg-gray-100 text-gray-600',
    };
    return map[status] || 'bg-gray-100 text-gray-600';
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center gap-2 mb-3">
          <Filter className="w-4 h-4 text-gray-500" />
          <span className="text-sm font-medium text-gray-700">Filters</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Account</label>
            <select
              value={selectedAccountId}
              onChange={(e) => { setSelectedAccountId(e.target.value); setSelectedBatchId(''); }}
              className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Accounts</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Batch</label>
            <select
              value={selectedBatchId}
              onChange={(e) => setSelectedBatchId(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={!selectedAccountId}
            >
              <option value="">All Batches</option>
              {batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {new Date(b.created_at).toLocaleDateString()} ({b.created_orders} orders)
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">From Date</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">To Date</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
      </div>

      {/* Actions bar */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <span>{orders.length} orders</span>
          {selectedOrderIds.size > 0 && (
            <span className="text-blue-600 font-medium">· {selectedOrderIds.size} selected</span>
          )}
          <span className="text-gray-400">· {ordersWithReports} with reports</span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={loadOrders}
            className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-500"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={startBulkDownload}
            disabled={downloadLoading || orders.length === 0 || ordersWithReports === 0}
            className="flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {downloadLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Download {effectiveSelectedCount > 0 ? `${effectiveSelectedCount} PDFs` : 'All PDFs'}
          </button>
        </div>
      </div>

      {/* Download progress */}
      {downloadRequest && (
        <div className={`rounded-lg p-3 flex items-center gap-3 text-sm ${
          downloadRequest.status === 'completed' ? 'bg-green-50 border border-green-200' :
          downloadRequest.status === 'failed' ? 'bg-red-50 border border-red-200' :
          'bg-blue-50 border border-blue-200'
        }`}>
          {downloadRequest.status === 'processing' || downloadRequest.status === 'pending'
            ? <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
            : downloadRequest.status === 'completed'
            ? <CheckCircle2 className="w-4 h-4 text-green-600" />
            : <AlertCircle className="w-4 h-4 text-red-600" />
          }
          <div className="flex-1">
            {downloadRequest.status === 'completed' && downloadRequest.zip_url
              ? <span className="text-green-700">ZIP ready — {downloadRequest.processed_orders} PDFs</span>
              : downloadRequest.status === 'failed'
              ? <span className="text-red-700">{downloadRequest.error_message || 'Download failed'}</span>
              : <span className="text-blue-700">Preparing PDFs... {downloadRequest.processed_orders}/{downloadRequest.total_orders}</span>
            }
          </div>
          {downloadRequest.status === 'completed' && downloadRequest.zip_url && (
            <a
              href={downloadRequest.zip_url}
              download
              className="flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs hover:bg-green-700"
            >
              <FileDown className="w-3.5 h-3.5" /> Download ZIP
            </a>
          )}
        </div>
      )}

      {/* Orders table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-gray-400">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading orders...
          </div>
        ) : orders.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <p className="text-sm">No orders found. Select an account or adjust filters.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-3 py-2.5 w-10">
                    <input
                      type="checkbox"
                      checked={selectedOrderIds.size === orders.length && orders.length > 0}
                      onChange={toggleSelectAll}
                      className="rounded"
                    />
                  </th>
                  <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-600">Order #</th>
                  <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-600">Patient</th>
                  <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-600">Date</th>
                  <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-600">Status</th>
                  <th className="text-right px-3 py-2.5 text-xs font-medium text-gray-600">Amount</th>
                  <th className="text-center px-3 py-2.5 text-xs font-medium text-gray-600">Report</th>
                  <th className="px-3 py-2.5 text-xs font-medium text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id} className={`border-b hover:bg-gray-50 ${selectedOrderIds.has(order.id) ? 'bg-blue-50' : ''}`}>
                    <td className="px-3 py-2.5">
                      <input
                        type="checkbox"
                        checked={selectedOrderIds.has(order.id)}
                        onChange={() => toggleOrder(order.id)}
                        className="rounded"
                      />
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs text-gray-600">
                      {order.order_display || order.id.slice(-6)}
                    </td>
                    <td className="px-3 py-2.5 font-medium">{order.patient_name}</td>
                    <td className="px-3 py-2.5 text-gray-500 text-xs">
                      {new Date(order.order_date).toLocaleDateString()}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusBadge(order.status)}`}>
                        {order.status}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      ₹{(order.final_amount ?? order.total_amount).toLocaleString()}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      {order.has_report
                        ? <CheckCircle2 className="w-4 h-4 text-green-500 mx-auto" />
                        : <Clock className="w-4 h-4 text-gray-300 mx-auto" />
                      }
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <button
                          onClick={() => setQuickResultOrderId(order.id)}
                          title="Quick Result Entry"
                          className="p-1 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50"
                        >
                          <ClipboardEdit className="w-3.5 h-3.5" />
                        </button>
                        {order.report_pdf_url && (
                          <>
                            <a
                              href={order.report_pdf_url}
                              target="_blank"
                              rel="noreferrer"
                              title="Open eCopy PDF"
                              className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs bg-green-600 text-white hover:bg-green-700"
                            >
                              <Download className="w-3.5 h-3.5" />
                              <span>eCopy</span>
                            </a>
                            <QuickSendReport
                              reportUrl={order.report_pdf_url}
                              reportName={`${order.patient_name} - Report`}
                              patientName={order.patient_name}
                              patientPhone={order.patient_phone || ''}
                              label="WhatsApp"
                              buttonClassName="inline-flex items-center gap-1 rounded px-2 py-1 text-xs bg-emerald-600 text-white hover:bg-emerald-700"
                              showIcon={false}
                            />
                          </>
                        )}
                        {order.report_print_pdf_url && (
                          <a
                            href={order.report_print_pdf_url}
                            target="_blank"
                            rel="noreferrer"
                            title="Open print PDF"
                            className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs bg-amber-500 text-white hover:bg-amber-600"
                          >
                            <Printer className="w-3.5 h-3.5" />
                            <span>Print</span>
                          </a>
                        )}
                        <a
                          href={`/orders/${order.id}`}
                          target="_blank"
                          rel="noreferrer"
                          title="Open full order page"
                          className="p-1 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Quick Result Entry Modal */}
      {quickResultOrderId && (
        <QuickResultModal
          orderId={quickResultOrderId!}
          onClose={() => setQuickResultOrderId(null)}
          onSaved={loadOrders}
        />
      )}
    </div>
  );
};

export default AccountOrdersView;
