import React, { useState, useEffect, useCallback } from 'react';
import { supabase, database } from '../../utils/supabase';
import { Download, FileDown, RefreshCw, Loader2, CheckCircle2, Clock, AlertCircle, ExternalLink, Filter, ClipboardEdit, Printer, Layers, FileSpreadsheet } from 'lucide-react';
import QuickResultModal from './QuickResultModal';
import QuickSendReport from '../WhatsApp/QuickSendReport';
import BulkResultExcelModal from './BulkResultExcelModal';

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

interface PackageOption {
  id: string;
  name: string;
  package_test_groups?: {
    test_group_id: string;
    test_groups?: {
      id: string;
      name: string;
    } | null;
  }[];
}

interface OrderRow {
  id: string;
  order_display: string | null;
  order_number: number | null;
  order_date: string;
  patient_id: string | null;
  patient_name: string;
  patient_phone: string | null;
  status: string;
  total_amount: number;
  final_amount: number | null;
  account_id: string;
  bulk_batch_id: string | null;
  billing_status: string | null;
  sample_id: string | null;
  report_generation_status: string | null;
  smart_report_url: string | null;
  report_pdf_url: string | null;
  report_print_pdf_url: string | null;
  draft_report_pdf_url: string | null;
  draft_report_print_pdf_url: string | null;
  has_report: boolean;
}

interface DownloadRequest {
  id: string;
  status: string;
  zip_url: string | null;
  total_orders: number;
  processed_orders: number;
  error_message: string | null;
  download_type: 'zip' | 'merged';
}

interface AccountOrdersViewProps {
  initialAccountId?: string;
  initialBatchId?: string;
}

type BulkPdfSortMode = 'sample_desc' | 'sample_asc' | 'order_id_asc' | 'order_id_desc' | 'date_desc' | 'patient_az';
const ORDERS_PAGE_SIZE = 1000;

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
  const [downloadPdfVariant, setDownloadPdfVariant] = useState<'print' | 'ecopy'>('print');
  const [downloadPollInterval, setDownloadPollInterval] = useState<ReturnType<typeof setInterval> | null>(null);
  const [downloadLoading, setDownloadLoading] = useState(false);
  const [ecopyDownloadLoading, setEcopyDownloadLoading] = useState(false);
  const [mergeLoading, setMergeLoading] = useState(false);
  const [bulkPdfSortMode, setBulkPdfSortMode] = useState<BulkPdfSortMode>('sample_desc');
  const [quickResultOrderId, setQuickResultOrderId] = useState<string | null>(null);
  const [showBulkResultModal, setShowBulkResultModal] = useState(false);
  const [packages, setPackages] = useState<PackageOption[]>([]);
  const [showPackageUpdateModal, setShowPackageUpdateModal] = useState(false);
  const [selectedPackageId, setSelectedPackageId] = useState('');
  const [packageUpdateLoading, setPackageUpdateLoading] = useState(false);
  const [packageUpdateMessage, setPackageUpdateMessage] = useState('');

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

  useEffect(() => {
    if (!labId) return;
    database.packages.getAll().then(({ data, error }: any) => {
      if (error) {
        console.error('Failed to load packages for package update:', error);
        setPackages([]);
        return;
      }
      setPackages((data || []) as PackageOption[]);
    });
  }, [labId]);

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
	      const allRows: any[] = [];
	      for (let from = 0; ; from += ORDERS_PAGE_SIZE) {
	        let query = supabase
	          .from('orders')
	          .select(`
	            id, order_display, order_number, order_date, patient_id, patient_name, status,
	            total_amount, final_amount, account_id, bulk_batch_id,
	            billing_status, sample_id,
	            report_generation_status, smart_report_url,
	            patients(phone),
	            reports!reports_order_id_fkey(id, report_type, pdf_url, print_pdf_url)
	          `)
	          .order('order_date', { ascending: false })
	          .range(from, from + ORDERS_PAGE_SIZE - 1);

	        if (selectedBatchId) {
	          query = query.eq('bulk_batch_id', selectedBatchId);
	        } else if (selectedAccountId) {
	          query = query.eq('account_id', selectedAccountId);
	        }

	        if (dateFrom) query = query.gte('order_date', dateFrom);
	        if (dateTo) query = query.lte('order_date', dateTo);

	        const { data, error } = await query;
	        if (error) throw error;
	        allRows.push(...(data || []));
	        if (!data || data.length < ORDERS_PAGE_SIZE) break;
	      }

	      const mapped = allRows.map((o: {
		        id: string;
		        order_display: string | null;
		        order_number: number | null;
		        order_date: string;
        patient_id: string | null;
        patient_name: string;
        patients: { phone: string | null } | null;
        status: string;
        total_amount: number;
        final_amount: number | null;
        account_id: string;
        bulk_batch_id: string | null;
        billing_status: string | null;
        sample_id: string | null;
        report_generation_status: string | null;
        smart_report_url: string | null;
        reports: { id: string; report_type: 'draft' | 'final' | null; pdf_url: string | null; print_pdf_url: string | null }[] | { id: string; report_type: 'draft' | 'final' | null; pdf_url: string | null; print_pdf_url: string | null } | null;
      }) => {
        const reportRows = Array.isArray(o.reports) ? o.reports : o.reports ? [o.reports] : [];
        const finalReports = reportRows.filter((report) => report?.report_type !== 'draft');
        const draftReports = reportRows.filter((report) => report?.report_type === 'draft');
        const finalReportWithEcopyUrl = finalReports.find((report) => !!report?.pdf_url);
        const finalReportWithPrintUrl = finalReports.find((report) => !!report?.print_pdf_url);
        const draftReportWithEcopyUrl = draftReports.find((report) => !!report?.pdf_url);
        const draftReportWithPrintUrl = draftReports.find((report) => !!report?.print_pdf_url);

        return {
          ...o,
          patient_phone: o.patients?.phone || null,
          report_pdf_url: finalReportWithEcopyUrl?.pdf_url || draftReportWithEcopyUrl?.pdf_url || null,
          report_print_pdf_url: finalReportWithPrintUrl?.print_pdf_url || draftReportWithPrintUrl?.print_pdf_url || null,
          draft_report_pdf_url: draftReportWithEcopyUrl?.pdf_url || null,
          draft_report_print_pdf_url: draftReportWithPrintUrl?.print_pdf_url || null,
          has_report: !!(
            o.smart_report_url ||
            finalReportWithEcopyUrl ||
            finalReportWithPrintUrl ||
            draftReportWithEcopyUrl ||
            draftReportWithPrintUrl
          ),
        };
      });
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

  const getGeneratedPrintPdfUrl = (order: OrderRow) =>
    order.report_print_pdf_url;

  const getGeneratedEcopyPdfUrl = (order: OrderRow) =>
    order.report_pdf_url || order.smart_report_url;

	  const getGeneratedPdfUrl = (order: OrderRow, pdfVariant: 'print' | 'ecopy') =>
	    pdfVariant === 'ecopy' ? getGeneratedEcopyPdfUrl(order) : getGeneratedPrintPdfUrl(order);

  const getDailySeq = (order: Pick<OrderRow, 'order_number' | 'sample_id'>) => {
    if (typeof order.order_number === 'number' && Number.isFinite(order.order_number)) return order.order_number;
    const tail = String(order.sample_id || '').match(/(?:^|[/-])(\d+)\s*$/)?.[1] || '';
    const parsed = parseInt(tail, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const compareOrdersForBulkPdf = (a: OrderRow, b: OrderRow) => {
    if (bulkPdfSortMode === 'patient_az') {
      return (a.patient_name || '').localeCompare(b.patient_name || '');
    }

    if (bulkPdfSortMode === 'date_desc') {
      const dateDiff = new Date(b.order_date).getTime() - new Date(a.order_date).getTime();
      if (dateDiff !== 0) return dateDiff;
    }

    if (bulkPdfSortMode === 'order_id_asc' || bulkPdfSortMode === 'order_id_desc') {
      const aRef = a.order_display || a.id;
      const bRef = b.order_display || b.id;
      return bulkPdfSortMode === 'order_id_asc'
        ? aRef.localeCompare(bRef, undefined, { numeric: true })
        : bRef.localeCompare(aRef, undefined, { numeric: true });
    }

    const nA = getDailySeq(a);
    const nB = getDailySeq(b);
    if (nA !== nB) return bulkPdfSortMode === 'sample_asc' ? nA - nB : nB - nA;
    return new Date(b.order_date).getTime() - new Date(a.order_date).getTime();
  };

  const getBulkEligibleOrderIds = (pdfVariant: 'print' | 'ecopy' = 'print') => {
	    const sourceOrders = selectedOrderIds.size > 0
	      ? orders.filter((order) => selectedOrderIds.has(order.id))
	      : orders;
	    const eligibleOrders = sourceOrders
      .filter((order) => !!getGeneratedPdfUrl(order, pdfVariant))
      .sort(compareOrdersForBulkPdf);

    return {
      orderIds: eligibleOrders.map((order) => order.id),
      missingCount: sourceOrders.length - eligibleOrders.length,
    };
  };

  const getPackageUpdateCandidateOrders = () => {
    const sourceOrders = selectedOrderIds.size > 0
      ? orders.filter((order) => selectedOrderIds.has(order.id))
      : orders;
    return sourceOrders.filter((order) => order.billing_status !== 'billed');
  };

  const applyPackageUpdateToOrders = async () => {
    const pkg = packages.find((item) => item.id === selectedPackageId);
    if (!pkg) {
      setPackageUpdateMessage('Select a package first.');
      return;
    }

    const packageTests = (pkg.package_test_groups || [])
      .map((row) => row.test_groups ? {
        id: row.test_groups.id || row.test_group_id,
        name: row.test_groups.name,
      } : null)
      .filter(Boolean) as { id: string; name: string }[];

    if (packageTests.length === 0) {
      setPackageUpdateMessage('Selected package has no tests to apply.');
      return;
    }

    const candidateOrders = getPackageUpdateCandidateOrders();
    if (candidateOrders.length === 0) {
      setPackageUpdateMessage('No unbilled orders found in the current selection/filter.');
      return;
    }

    const confirmed = window.confirm(
      `Apply missing tests from "${pkg.name}" to ${candidateOrders.length} unbilled order${candidateOrders.length === 1 ? '' : 's'}?\n\nNewly added tests will be inserted at price 0 and order totals will not be changed.`
    );
    if (!confirmed) return;

    setPackageUpdateLoading(true);
    setPackageUpdateMessage('');

    try {
      const orderIds = candidateOrders.map((order) => order.id);
      const { data: existingRows, error: existingError } = await supabase
        .from('order_tests')
        .select('order_id, test_group_id, package_id')
        .in('order_id', orderIds);

      if (existingError) throw existingError;

      const existingByOrder = new Map<string, Set<string>>();
      const packagePresentOrders = new Set<string>();
      (existingRows || []).forEach((row: any) => {
        if (!existingByOrder.has(row.order_id)) existingByOrder.set(row.order_id, new Set());
        if (row.test_group_id) existingByOrder.get(row.order_id)!.add(row.test_group_id);
        if (row.package_id === selectedPackageId) packagePresentOrders.add(row.order_id);
      });

      const rowsToInsert = candidateOrders.flatMap((order) => {
        if (!packagePresentOrders.has(order.id)) return [];
        const existingTestIds = existingByOrder.get(order.id) || new Set<string>();
        return packageTests
          .filter((test) => !existingTestIds.has(test.id))
          .map((test) => ({
            order_id: order.id,
            test_group_id: test.id,
            test_name: test.name,
            package_id: selectedPackageId,
            price: 0,
            sample_id: order.sample_id || null,
            lab_id: labId,
            outsourced_lab_id: null,
          }));
      });

      if (rowsToInsert.length === 0) {
        setPackageUpdateMessage('No missing tests found. These orders already match the selected package.');
        return;
      }

      const { error: insertError } = await supabase
        .from('order_tests')
        .insert(rowsToInsert);

      if (insertError) throw insertError;

      const affectedOrderIds = new Set(rowsToInsert.map((row) => row.order_id));
      const activityRows = candidateOrders
        .filter((order) => affectedOrderIds.has(order.id))
        .map((order) => ({
          patient_id: order.patient_id,
          order_id: order.id,
          lab_id: labId,
          activity_type: 'package_update_applied',
          description: `Missing tests from package "${pkg.name}" were added with no billing impact.`,
          metadata: {
            package_id: selectedPackageId,
            package_name: pkg.name,
            added_test_count: rowsToInsert.filter((row) => row.order_id === order.id).length,
            price_policy: 'zero_price_no_total_change',
          },
          performed_by: null,
          performed_at: new Date().toISOString(),
        }));

      if (activityRows.length > 0) {
        const { error: activityError } = await supabase
          .from('patient_activity_log')
          .insert(activityRows);
        if (activityError) console.warn('Package update activity log failed:', activityError);
      }

      setPackageUpdateMessage(
        `Added ${rowsToInsert.length} missing test${rowsToInsert.length === 1 ? '' : 's'} to ${affectedOrderIds.size} order${affectedOrderIds.size === 1 ? '' : 's'}. Prices and totals were not changed.`
      );
      await loadOrders();
      setSelectedOrderIds(new Set());
    } catch (err) {
      setPackageUpdateMessage(`Package update failed: ${(err as Error).message}`);
    } finally {
      setPackageUpdateLoading(false);
    }
  };

  const startBulkDownload = async (pdfVariant: 'print' | 'ecopy' = 'print') => {
    const { orderIds, missingCount } = getBulkEligibleOrderIds(pdfVariant);
    const variantLabel = pdfVariant === 'ecopy' ? 'eCopy' : 'print';

    if (orderIds.length === 0) {
      alert(`No orders with generated ${variantLabel} reports found. Please generate reports first.`);
      return;
    }

    if (missingCount > 0) {
      alert(`${missingCount} selected order${missingCount === 1 ? '' : 's'} do not have a generated ${variantLabel} PDF URL yet and will be skipped.`);
    }

    setDownloadPdfVariant(pdfVariant);
    if (pdfVariant === 'ecopy') {
      setEcopyDownloadLoading(true);
    } else {
      setDownloadLoading(true);
    }
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
          download_type: 'zip',
        })
        .select()
        .single();

      if (reqError || !reqData) throw new Error(reqError?.message || 'Failed to create download request');

      setDownloadRequest({ ...reqData, download_type: 'zip' } as DownloadRequest);

      // Invoke edge function
	      const { error: fnError } = await supabase.functions.invoke('bulk-pdf-zip', {
	        body: { request_id: reqData.id, pdf_variant: pdfVariant, sort_mode: bulkPdfSortMode },
	      });

      if (fnError) throw new Error(fnError.message);

      // Poll for completion
      const interval = setInterval(async () => {
        const { data } = await supabase
          .from('bulk_pdf_download_requests')
          .select('id, status, zip_url, total_orders, processed_orders, error_message, download_type')
          .eq('id', reqData.id)
          .single();
        if (data) {
          setDownloadRequest(data as DownloadRequest);
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
      if (pdfVariant === 'ecopy') {
        setEcopyDownloadLoading(false);
      } else {
        setDownloadLoading(false);
      }
    }
  };

  const startMergeDownload = async () => {
    const { orderIds, missingCount } = getBulkEligibleOrderIds('print');

    if (orderIds.length === 0) {
      alert('No orders with generated print reports found. Please generate print reports first.');
      return;
    }

    if (missingCount > 0) {
      alert(`${missingCount} selected order${missingCount === 1 ? '' : 's'} do not have a generated print PDF URL yet and will be skipped.`);
    }

    setMergeLoading(true);
    setDownloadRequest(null);

    try {
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
          download_type: 'merged',
        })
        .select()
        .single();

      if (reqError || !reqData) throw new Error(reqError?.message || 'Failed to create download request');

      setDownloadRequest({ ...reqData, download_type: 'merged' });

	      const { error: fnError } = await supabase.functions.invoke('bulk-pdf-merge', {
	        body: { request_id: reqData.id, sort_mode: bulkPdfSortMode },
	      });

      if (fnError) throw new Error(fnError.message);

      const interval = setInterval(async () => {
        const { data } = await supabase
          .from('bulk_pdf_download_requests')
          .select('id, status, zip_url, total_orders, processed_orders, error_message, download_type')
          .eq('id', reqData.id)
          .single();
        if (data) {
          setDownloadRequest(data as DownloadRequest);
          if (data.status === 'completed' || data.status === 'failed') {
            clearInterval(interval);
            setDownloadPollInterval(null);
          }
        }
      }, 2000);
      setDownloadPollInterval(interval);

    } catch (err) {
      alert(`Merge failed: ${(err as Error).message}`);
    } finally {
      setMergeLoading(false);
    }
  };

  const ordersWithReports = orders.filter((o) => !!getGeneratedPrintPdfUrl(o)).length;
  const ordersWithEcopyReports = orders.filter((o) => !!getGeneratedEcopyPdfUrl(o)).length;
  const effectiveSelectedCount = selectedOrderIds.size > 0 ? selectedOrderIds.size : ordersWithReports;
  const effectiveEcopySelectedCount = selectedOrderIds.size > 0 ? selectedOrderIds.size : ordersWithEcopyReports;
  const activeDownloadLabel = downloadPdfVariant === 'ecopy' ? 'eCopy ' : '';

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
          <span className="text-gray-400">· {ordersWithReports} with print reports</span>
        </div>

	        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-gray-600">
            PDF sort
            <select
              value={bulkPdfSortMode}
              onChange={(e) => setBulkPdfSortMode(e.target.value as BulkPdfSortMode)}
              className="border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              title="Sort order used for ZIP and merged PDF"
            >
              <option value="sample_desc">Sample ID newest first</option>
              <option value="sample_asc">Sample ID oldest first</option>
              <option value="order_id_asc">Order ID A-Z</option>
              <option value="order_id_desc">Order ID Z-A</option>
              <option value="date_desc">Order date newest first</option>
              <option value="patient_az">Patient A-Z</option>
            </select>
          </label>
	          <button
	            onClick={loadOrders}
            className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-500"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={() => startBulkDownload('print')}
            disabled={downloadLoading || ecopyDownloadLoading || mergeLoading || orders.length === 0 || ordersWithReports === 0}
            className="flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            title="Download stored print PDFs as a ZIP"
          >
            {downloadLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Download {effectiveSelectedCount > 0 ? `${effectiveSelectedCount} PDFs` : 'All PDFs'}
          </button>
          <button
            onClick={() => startBulkDownload('ecopy')}
            disabled={downloadLoading || ecopyDownloadLoading || mergeLoading || orders.length === 0 || ordersWithEcopyReports === 0}
            className="flex items-center gap-1.5 px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
            title="Download stored eCopy PDFs as a ZIP"
          >
            {ecopyDownloadLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Download eCopy {effectiveEcopySelectedCount > 0 ? `${effectiveEcopySelectedCount} PDFs` : 'All PDFs'}
          </button>
          <button
            onClick={startMergeDownload}
            disabled={downloadLoading || ecopyDownloadLoading || mergeLoading || orders.length === 0 || ordersWithReports === 0}
            className="flex items-center gap-1.5 px-4 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
            title="Merge all PDFs into one file for easy printing"
          >
            {mergeLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Layers className="w-4 h-4" />}
            Download & Merge
          </button>
          <button
            onClick={() => setShowBulkResultModal(true)}
            disabled={selectedOrderIds.size === 0}
            className="flex items-center gap-1.5 px-4 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50"
            title="Upload results via Excel for selected orders"
          >
            <FileSpreadsheet className="w-4 h-4" />
            Bulk Result Entry
          </button>
          <button
            onClick={() => { setPackageUpdateMessage(''); setShowPackageUpdateModal(true); }}
            disabled={orders.length === 0 || packages.length === 0}
            className="flex items-center gap-1.5 px-4 py-2 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50"
            title="Add tests newly added to a package into existing unbilled corporate orders at zero price"
          >
            <Layers className="w-4 h-4" />
            Apply Package Update
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
              ? <span className="text-green-700">
                  {downloadRequest.download_type === 'merged' ? 'Merged PDF' : 'ZIP'} ready — {downloadRequest.processed_orders} PDFs
                </span>
              : downloadRequest.status === 'failed'
              ? <span className="text-red-700">{downloadRequest.error_message || 'Download failed'}</span>
              : <span className="text-blue-700">
                  {downloadRequest.download_type === 'merged' ? 'Merging' : 'Preparing'} PDFs... {downloadRequest.processed_orders}/{downloadRequest.total_orders}
                </span>
            }
          </div>
          {downloadRequest.status === 'completed' && downloadRequest.zip_url && (
            <a
              href={downloadRequest.zip_url}
              download
              title={`Download ${activeDownloadLabel}${downloadRequest.download_type === 'merged' ? 'merged PDF' : 'ZIP'}`}
              className="flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs hover:bg-green-700"
            >
              <FileDown className="w-3.5 h-3.5" />
              {downloadRequest.download_type === 'merged' ? 'Download Merged PDF' : 'Download ZIP'}
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
	                              title={order.report_pdf_url === order.draft_report_pdf_url ? 'Open draft eCopy PDF' : 'Open eCopy PDF'}
	                              className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs bg-green-600 text-white hover:bg-green-700"
	                            >
	                              <Download className="w-3.5 h-3.5" />
	                              <span>{order.report_pdf_url === order.draft_report_pdf_url ? 'Draft eCopy' : 'eCopy'}</span>
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
	                            title={order.report_print_pdf_url === order.draft_report_print_pdf_url ? 'Open draft print PDF' : 'Open print PDF'}
	                            className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs bg-amber-500 text-white hover:bg-amber-600"
	                          >
	                            <Printer className="w-3.5 h-3.5" />
	                            <span>{order.report_print_pdf_url === order.draft_report_print_pdf_url ? 'Draft Print' : 'Print'}</span>
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

      {/* Bulk Result Entry via Excel Modal */}
      {showBulkResultModal && labId && (
        <BulkResultExcelModal
          orderIds={Array.from(selectedOrderIds)}
          labId={labId}
          onClose={() => setShowBulkResultModal(false)}
          onSaved={loadOrders}
        />
      )}

      {showPackageUpdateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white shadow-xl">
            <div className="border-b px-5 py-4">
              <h3 className="text-base font-semibold text-gray-900">Apply Package Update</h3>
              <p className="mt-1 text-sm text-gray-500">
                Missing tests from the selected package will be added to unbilled matching orders at price 0.
              </p>
            </div>

            <div className="space-y-4 p-5">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Package</label>
                <select
                  value={selectedPackageId}
                  onChange={(event) => { setSelectedPackageId(event.target.value); setPackageUpdateMessage(''); }}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select package...</option>
                  {packages.map((pkg) => (
                    <option key={pkg.id} value={pkg.id}>
                      {pkg.name} ({pkg.package_test_groups?.length || 0} tests)
                    </option>
                  ))}
                </select>
              </div>

              <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                Target: {getPackageUpdateCandidateOrders().length} unbilled order{getPackageUpdateCandidateOrders().length === 1 ? '' : 's'}
                {selectedOrderIds.size > 0 ? ' from your selection' : ' from the current filters'}.
                Billed orders are skipped. Order totals and invoice amounts are not recalculated.
              </div>

              {packageUpdateMessage && (
                <div className={`rounded-lg p-3 text-sm ${packageUpdateMessage.includes('failed') ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-700'}`}>
                  {packageUpdateMessage}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t px-5 py-4">
              <button
                onClick={() => setShowPackageUpdateModal(false)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                Close
              </button>
              <button
                onClick={applyPackageUpdateToOrders}
                disabled={packageUpdateLoading || !selectedPackageId || getPackageUpdateCandidateOrders().length === 0}
                className="flex items-center gap-1.5 rounded-lg bg-amber-600 px-4 py-2 text-sm text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {packageUpdateLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Layers className="h-4 w-4" />}
                Apply Missing Tests
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AccountOrdersView;
