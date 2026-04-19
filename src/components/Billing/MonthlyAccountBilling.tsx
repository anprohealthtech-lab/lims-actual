import React, { useState, useEffect } from 'react';
import { Search, Plus, Building, Eye, CreditCard, Download, History, FileText, AlertCircle } from 'lucide-react';
import { database, supabase } from '../../utils/supabase';
import type { ConsolidatedInvoice } from '../../types';
import ReceivePaymentModal from './ReceivePaymentModal';
import { generateConsolidatedInvoicePDF } from '../../utils/invoicePdfService';

interface MonthlyAccountBillingProps {
  onClose?: () => void;
}

interface OrderSummary {
  id: string;
  order_number: string;
  order_date: string;
  patient_id: string | null;
  patient_name: string;
  total_amount: number;
  billing_status: string | null;
  consolidated_invoice_id: string | null;
}

interface AccountBillingSummary {
  account: any;
  orders: OrderSummary[];          // Only unbilled orders for selected period
  totalAmount: number;
  orderCount: number;
  patientCount: number;
  hasConsolidated: boolean;
  consolidatedInvoice?: ConsolidatedInvoice;
  allConsolidated: ConsolidatedInvoice[]; // Full history for this account
}

const STATUS_COLORS: Record<string, string> = {
  sent:      'bg-blue-100 text-blue-800',
  paid:      'bg-green-100 text-green-800',
  partial:   'bg-yellow-100 text-yellow-800',
  overdue:   'bg-red-100 text-red-800',
  draft:     'bg-gray-100 text-gray-600',
  cancelled: 'bg-gray-100 text-gray-400',
};

const MonthlyAccountBilling: React.FC<MonthlyAccountBillingProps> = ({ onClose }) => {
  const [loading, setLoading] = useState(true);
  const [selectedPeriod, setSelectedPeriod] = useState('');
  const [accountSummaries, setAccountSummaries] = useState<AccountBillingSummary[]>([]);
  const [previewAccount, setPreviewAccount] = useState<AccountBillingSummary | null>(null);
  const [historyAccount, setHistoryAccount] = useState<AccountBillingSummary | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [consolidating, setConsolidating] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState<string | null>(null);
  const [showPaymentModal, setShowPaymentModal] = useState<string | null>(null);

  // Last 6 months always available
  const periods = React.useMemo(() => {
    const now = new Date();
    return Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    });
  }, []);

  useEffect(() => {
    const now = new Date();
    setSelectedPeriod(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  }, []);

  useEffect(() => {
    if (selectedPeriod) loadPeriodData();
  }, [selectedPeriod]);

  const loadPeriodData = async () => {
    try {
      setLoading(true);
      const [{ data: accounts, error: accErr }, { data: consolidatedAll }] = await Promise.all([
        (database as any).accounts.getAll(),
        database.consolidatedInvoices.getAll().catch(() => ({ data: [], error: null })),
      ]);
      if (accErr) throw accErr;

      const monthlyAccounts = (accounts || []).filter(
        (a: any) => a.billing_mode === 'monthly' && a.is_active !== false
      );

      const periodStart = `${selectedPeriod}-01`;
      const allConsolidated: ConsolidatedInvoice[] = consolidatedAll || [];

      const summaries: AccountBillingSummary[] = await Promise.all(
        monthlyAccounts.map(async (account: any) => {
          const { data: orders } = await (database as any).orders.getByAccountAndPeriod(account.id, selectedPeriod);

          const orderList: OrderSummary[] = (orders || []).map((o: any) => ({
            id: o.id,
            order_number: o.order_number,
            order_date: o.order_date,
            patient_id: o.patient_id || null,
            patient_name: o.patients?.name || 'Unknown',
            total_amount: o.final_amount || o.total_amount || 0,
            billing_status: o.billing_status,
            consolidated_invoice_id: o.consolidated_invoice_items?.[0]?.consolidated_invoice_id || null,
          }));

          // Only count unbilled orders toward totals
          const unbilledOrders = orderList.filter(o => o.billing_status !== 'billed' && !o.consolidated_invoice_id);
          const totalAmount = unbilledOrders.reduce((s, o) => s + o.total_amount, 0);
          const patientNames = new Set(unbilledOrders.map(o => o.patient_name));

          const thisConsolidated = allConsolidated.find(
            (ci: any) => ci.account_id === account.id && ci.billing_period_start === periodStart
          );
          const accountHistory = allConsolidated
            .filter((ci: any) => ci.account_id === account.id)
            .sort((a: any, b: any) => b.billing_period_start.localeCompare(a.billing_period_start));

          return {
            account,
            orders: orderList,
            totalAmount,
            orderCount: unbilledOrders.length,
            patientCount: patientNames.size,
            hasConsolidated: !!thisConsolidated,
            consolidatedInvoice: thisConsolidated,
            allConsolidated: accountHistory,
          };
        })
      );

      setAccountSummaries(summaries.sort((a, b) => a.account.name.localeCompare(b.account.name)));
    } catch (err) {
      console.error('Error loading period data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateConsolidatedInvoice = async (accountId: string) => {
    const summary = accountSummaries.find(s => s.account.id === accountId);
    if (!summary || summary.orderCount === 0) {
      alert('No unbilled orders found for this account in the selected period.');
      return;
    }

    setConsolidating(accountId);
    try {
      const [year, month] = selectedPeriod.split('-').map(Number);
      const periodStart = `${selectedPeriod}-01`;
      const lastDay = new Date(year, month, 0).getDate();
      const periodEnd = `${selectedPeriod}-${String(lastDay).padStart(2, '0')}`;
      const dueDate = new Date(
        Date.now() + (summary.account.payment_terms || 30) * 24 * 60 * 60 * 1000
      ).toISOString().split('T')[0];
      const invoiceNumber = `CI-${selectedPeriod.replace('-', '')}-${accountId.slice(0, 6).toUpperCase()}`;
      const lab_id = await database.getCurrentUserLabId();

      const unbilledOrders = summary.orders.filter(
        o => o.billing_status !== 'billed' && !o.consolidated_invoice_id
      );

      // Step 1: Create individual account invoices per order
      const createdInvoiceIds: string[] = [];
      for (const order of unbilledOrders) {
        const { data: inv, error: invErr } = await database.invoices.create({
          lab_id,
          patient_id: order.patient_id,
          order_id: order.id,
          patient_name: order.patient_name,
          subtotal: order.total_amount,
          total_before_discount: order.total_amount,
          total_discount: 0,
          total_after_discount: order.total_amount,
          discount: 0,
          tax: 0,
          total: order.total_amount,
          status: 'Sent',
          invoice_date: new Date().toISOString(),
          due_date: new Date(Date.now() + (summary.account.payment_terms || 30) * 24 * 60 * 60 * 1000).toISOString(),
          account_id: accountId,
          invoice_type: 'account',
          billing_period: selectedPeriod,
          consolidated_invoice_id: null,
        });
        if (invErr) console.warn('Invoice create failed for order', order.id, invErr);
        else if (inv) createdInvoiceIds.push(inv.id);
      }

      // Step 2: Create consolidated invoice
      const { data: consolidated, error: ciErr } = await database.consolidatedInvoices.create({
        account_id: accountId,
        invoice_number: invoiceNumber,
        billing_period_start: periodStart,
        billing_period_end: periodEnd,
        subtotal: summary.totalAmount,
        discount_amount: 0,
        tax_amount: 0,
        total_amount: summary.totalAmount,
        status: 'sent' as const,
        due_date: dueDate,
        notes: `${summary.orderCount} orders · ${summary.patientCount} patients`,
      });
      if (ciErr) throw ciErr;

      // Step 3: Link individual invoices → consolidated
      if (createdInvoiceIds.length > 0) {
        await database.invoices.markAsConsolidated(createdInvoiceIds, consolidated.id);
      }

      // Step 4: Insert consolidated_invoice_items (order → consolidated link)
      await supabase.from('consolidated_invoice_items').insert(
        unbilledOrders.map(o => ({
          consolidated_invoice_id: consolidated.id,
          order_id: o.id,
          amount: o.total_amount,
        }))
      );

      // Step 5: Mark orders as billed so they never appear again
      const orderIds = unbilledOrders.map(o => o.id);
      await supabase
        .from('orders')
        .update({ billing_status: 'billed', is_billed: true })
        .in('id', orderIds);

      await loadPeriodData();
      alert(`✓ Consolidated invoice ${invoiceNumber} generated for ${summary.account.name}`);
    } catch (err) {
      console.error('Error creating consolidated invoice:', err);
      alert('Failed to create consolidated invoice. Please try again.');
    } finally {
      setConsolidating(null);
    }
  };

  const handleDownloadPDF = async (consolidatedInvoice: ConsolidatedInvoice, accountName: string) => {
    setPdfLoading(consolidatedInvoice.id);
    try {
      const labId = await database.getCurrentUserLabId();
      const url = await generateConsolidatedInvoicePDF(consolidatedInvoice.id, labId);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Invoice_${(consolidatedInvoice as any).invoice_number || consolidatedInvoice.id}_${accountName}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (e) {
      console.error('PDF error:', e);
      alert('Failed to generate PDF. Check console for details.');
    } finally {
      setPdfLoading(null);
    }
  };

  const formatCurrency = (amount: number) => `₹${(amount || 0).toFixed(2)}`;
  const formatPeriod = (period: string) => {
    const [year, month] = period.split('-');
    return new Date(parseInt(year), parseInt(month) - 1).toLocaleDateString('en-IN', { year: 'numeric', month: 'long' });
  };
  const formatDate = (d: string) => new Date(d).toLocaleDateString('en-IN');

  const filteredSummaries = accountSummaries.filter(s =>
    s.account.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    s.account.type?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Monthly Account Billing</h2>
          <p className="text-gray-600">Generate consolidated invoices for B2B accounts</p>
        </div>
        {onClose && (
          <button onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50">
            Close
          </button>
        )}
      </div>

      {/* Period + Summary bar */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Billing Period</label>
            <select
              value={selectedPeriod}
              onChange={(e) => setSelectedPeriod(e.target.value)}
              className="w-48 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {periods.map(p => (
                <option key={p} value={p}>{formatPeriod(p)}</option>
              ))}
            </select>
          </div>
          {!loading && accountSummaries.length > 0 && (
            <div className="flex gap-8 text-sm mt-1">
              <div>
                <div className="text-gray-500">Accounts</div>
                <div className="font-bold text-lg">{accountSummaries.length}</div>
              </div>
              <div>
                <div className="text-gray-500">Unbilled Orders</div>
                <div className="font-bold text-lg">{accountSummaries.reduce((s, a) => s + a.orderCount, 0)}</div>
              </div>
              <div>
                <div className="text-gray-500">Pending Amount</div>
                <div className="font-bold text-lg text-orange-600">
                  {formatCurrency(accountSummaries.filter(a => !a.hasConsolidated).reduce((s, a) => s + a.totalAmount, 0))}
                </div>
              </div>
              <div>
                <div className="text-gray-500">Already Billed</div>
                <div className="font-bold text-lg text-green-600">
                  {accountSummaries.filter(a => a.hasConsolidated).length} accounts
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Search */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
          <input
            type="text"
            placeholder="Search accounts..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Account list */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="px-6 py-3 border-b border-gray-200 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">{formatPeriod(selectedPeriod)}</h3>
          <span className="text-xs text-gray-400">Orders with billing_status = billed are excluded</span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center p-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
          </div>
        ) : filteredSummaries.length === 0 ? (
          <div className="p-10 text-center">
            {searchTerm ? (
              <p className="text-gray-500">No accounts match your search</p>
            ) : (
              <div>
                <p className="font-semibold text-gray-700 mb-1">No B2B monthly accounts configured</p>
                <p className="text-sm text-gray-500">
                  Go to <strong>Masters → Accounts</strong>, create an account and set
                  <strong> Billing Mode = Monthly</strong>. Orders linked to that account
                  will appear here automatically each month.
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {filteredSummaries.map(summary => (
              <div key={summary.account.id} className="p-5">
                <div className="flex items-start justify-between gap-4">
                  {/* Left: account info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Building className="w-4 h-4 text-gray-400 shrink-0" />
                      <span className="font-semibold text-gray-900">{summary.account.name}</span>
                      <span className="text-xs text-gray-400 capitalize">{summary.account.type}</span>
                      {summary.hasConsolidated && (
                        <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700">
                          ✓ Billed
                        </span>
                      )}
                      {summary.allConsolidated.length > 0 && (
                        <button
                          onClick={() => setHistoryAccount(summary)}
                          className="flex items-center gap-1 text-xs text-blue-600 hover:underline"
                        >
                          <History className="w-3 h-3" />
                          {summary.allConsolidated.length} invoice{summary.allConsolidated.length !== 1 ? 's' : ''}
                        </button>
                      )}
                    </div>

                    <div className="mt-2 flex flex-wrap gap-5 text-sm">
                      <div>
                        <span className="text-gray-500">Unbilled orders:</span>
                        <span className={`ml-1 font-semibold ${summary.orderCount === 0 ? 'text-gray-400' : 'text-gray-900'}`}>
                          {summary.orderCount}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-500">Patients:</span>
                        <span className="ml-1 font-semibold">{summary.patientCount}</span>
                      </div>
                      <div>
                        <span className="text-gray-500">Amount:</span>
                        <span className={`ml-1 font-semibold ${summary.totalAmount > 0 ? 'text-orange-600' : 'text-gray-400'}`}>
                          {formatCurrency(summary.totalAmount)}
                        </span>
                      </div>
                      {summary.hasConsolidated && summary.consolidatedInvoice && (
                        <div>
                          <span className="text-gray-500">Invoice:</span>
                          <span className="ml-1 font-mono text-xs text-gray-700">
                            {(summary.consolidatedInvoice as any).invoice_number}
                          </span>
                        </div>
                      )}
                    </div>

                    {summary.orderCount === 0 && !summary.hasConsolidated && (
                      <p className="mt-2 text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded px-2 py-1 inline-flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" /> No orders in this period yet
                      </p>
                    )}
                  </div>

                  {/* Right: action buttons */}
                  <div className="flex items-center gap-2 shrink-0">
                    {summary.orderCount > 0 && (
                      <button
                        onClick={() => setPreviewAccount(summary)}
                        className="px-3 py-1.5 text-sm border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 flex items-center gap-1"
                      >
                        <Eye className="w-4 h-4" />
                        Preview
                      </button>
                    )}

                    {summary.hasConsolidated && summary.consolidatedInvoice ? (
                      <>
                        <button
                          onClick={() => handleDownloadPDF(summary.consolidatedInvoice!, summary.account.name)}
                          disabled={pdfLoading === summary.consolidatedInvoice.id}
                          className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-md flex items-center gap-1 disabled:opacity-50"
                        >
                          <Download className="w-4 h-4" />
                          {pdfLoading === summary.consolidatedInvoice.id ? 'Generating...' : 'PDF'}
                        </button>
                        <button
                          onClick={() => setShowPaymentModal(summary.account.id)}
                          className="px-3 py-1.5 text-sm border border-green-200 text-green-700 bg-green-50 hover:bg-green-100 rounded-md flex items-center gap-1"
                        >
                          <CreditCard className="w-4 h-4" />
                          Payment
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => handleCreateConsolidatedInvoice(summary.account.id)}
                        disabled={consolidating === summary.account.id || summary.orderCount === 0}
                        className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-40 flex items-center gap-1"
                      >
                        <Plus className="w-4 h-4" />
                        {consolidating === summary.account.id ? 'Generating...' : 'Generate Monthly Bill'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Order Preview Modal ── */}
      {previewAccount && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col">
            <div className="flex justify-between items-start p-5 border-b border-gray-200">
              <div>
                <h3 className="text-lg font-bold text-gray-900">{previewAccount.account.name}</h3>
                <p className="text-sm text-gray-500">{formatPeriod(selectedPeriod)} — {previewAccount.orderCount} unbilled orders</p>
              </div>
              <button onClick={() => setPreviewAccount(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>

            <div className="overflow-y-auto flex-1 p-5">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-xs text-gray-500 uppercase">
                    <th className="pb-2">Order #</th>
                    <th className="pb-2">Patient</th>
                    <th className="pb-2">Date</th>
                    <th className="pb-2 text-right">Amount</th>
                    <th className="pb-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {previewAccount.orders.map(o => (
                    <tr key={o.id} className={o.billing_status === 'billed' || o.consolidated_invoice_id ? 'opacity-40' : ''}>
                      <td className="py-2 font-mono text-xs">{o.order_number || o.id.slice(0, 8)}</td>
                      <td className="py-2">{o.patient_name}</td>
                      <td className="py-2 text-gray-500">{formatDate(o.order_date)}</td>
                      <td className="py-2 text-right font-medium text-green-700">{formatCurrency(o.total_amount)}</td>
                      <td className="py-2">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          o.consolidated_invoice_id ? 'bg-green-100 text-green-700' :
                          o.billing_status === 'billed' ? 'bg-blue-100 text-blue-700' :
                          'bg-yellow-100 text-yellow-700'
                        }`}>
                          {o.consolidated_invoice_id ? 'Consolidated' : o.billing_status || 'Pending'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-300">
                    <td colSpan={3} className="pt-3 font-semibold text-right pr-4 text-sm">Unbilled Total</td>
                    <td className="pt-3 font-bold text-right text-green-700">{formatCurrency(previewAccount.totalAmount)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="flex justify-end gap-3 p-4 border-t border-gray-100">
              <button onClick={() => setPreviewAccount(null)} className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 text-sm">
                Close
              </button>
              {!previewAccount.hasConsolidated && previewAccount.orderCount > 0 && (
                <button
                  onClick={() => { setPreviewAccount(null); handleCreateConsolidatedInvoice(previewAccount.account.id); }}
                  disabled={consolidating === previewAccount.account.id}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2 text-sm"
                >
                  <Plus className="w-4 h-4" />
                  Generate Monthly Bill
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Invoice History Modal ── */}
      {historyAccount && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
            <div className="flex justify-between items-center p-5 border-b border-gray-200">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-blue-600" />
                <div>
                  <h3 className="font-bold text-gray-900">{historyAccount.account.name}</h3>
                  <p className="text-xs text-gray-500">Consolidated Invoice History</p>
                </div>
              </div>
              <button onClick={() => setHistoryAccount(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>

            <div className="overflow-y-auto flex-1 p-5">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-xs text-gray-500 uppercase text-left">
                    <th className="pb-2">Invoice #</th>
                    <th className="pb-2">Period</th>
                    <th className="pb-2">Due Date</th>
                    <th className="pb-2 text-right">Amount</th>
                    <th className="pb-2">Status</th>
                    <th className="pb-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {historyAccount.allConsolidated.map((ci: any) => (
                    <tr key={ci.id}>
                      <td className="py-3 font-mono text-xs font-medium">{ci.invoice_number}</td>
                      <td className="py-3">
                        {formatDate(ci.billing_period_start)} – {formatDate(ci.billing_period_end)}
                      </td>
                      <td className="py-3 text-gray-500">{ci.due_date ? formatDate(ci.due_date) : '—'}</td>
                      <td className="py-3 text-right font-semibold">{formatCurrency(ci.total_amount)}</td>
                      <td className="py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[ci.status] || 'bg-gray-100 text-gray-600'}`}>
                          {ci.status}
                        </span>
                      </td>
                      <td className="py-3">
                        <button
                          onClick={() => handleDownloadPDF(ci, historyAccount.account.name)}
                          disabled={pdfLoading === ci.id}
                          className="text-blue-600 hover:text-blue-800 text-xs flex items-center gap-1 disabled:opacity-50"
                        >
                          <Download className="w-3 h-3" />
                          {pdfLoading === ci.id ? '...' : 'PDF'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-between items-center px-5 py-3 border-t border-gray-100 text-sm">
              <span className="text-gray-500">
                Total billed: <strong>{formatCurrency(historyAccount.allConsolidated.reduce((s: number, ci: any) => s + ci.total_amount, 0))}</strong>
              </span>
              <button onClick={() => setHistoryAccount(null)} className="px-4 py-1.5 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Payment Modal ── */}
      {showPaymentModal && (() => {
        const summary = accountSummaries.find(s => s.account.id === showPaymentModal);
        return summary ? (
          <ReceivePaymentModal
            accountId={summary.account.id}
            accountName={summary.account.name}
            currentBalance={summary.consolidatedInvoice ? (summary.consolidatedInvoice as any).total_amount : summary.totalAmount}
            consolidatedInvoiceId={summary.consolidatedInvoice?.id}
            onClose={() => setShowPaymentModal(null)}
            onSuccess={() => { loadPeriodData(); setShowPaymentModal(null); }}
          />
        ) : null;
      })()}
    </div>
  );
};

export default MonthlyAccountBilling;
