import React, { useState, useEffect } from 'react';
import {
  Building, Download, CreditCard, Search, Filter,
  TrendingUp, AlertCircle, CheckCircle, Clock, FileText,
  ChevronDown, ChevronRight, RefreshCw
} from 'lucide-react';
import { database, supabase } from '../../utils/supabase';
import { generateConsolidatedInvoicePDF } from '../../utils/invoicePdfService';
import ReceivePaymentModal from './ReceivePaymentModal';

/* ─── types ─────────────────────────────────────────────────────────── */
interface ConsolidatedInvoiceRow {
  id: string;
  invoice_number: string;
  account_id: string;
  account_name: string;
  billing_period_start: string;
  billing_period_end: string;
  total_amount: number;
  status: 'draft' | 'sent' | 'paid' | 'partial' | 'overdue' | 'cancelled';
  due_date: string | null;
  created_at: string;
  notes: string | null;
}

interface AccountSummary {
  id: string;
  name: string;
  type: string;
  payment_terms: number;
  totalOutstanding: number;
  totalPaid: number;
  overdueAmount: number;
  invoiceCount: number;
  lastInvoiceDate: string | null;
  oldestUnpaidDue: string | null;
}

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  draft:     { label: 'Draft',     cls: 'bg-gray-100 text-gray-600' },
  sent:      { label: 'Sent',      cls: 'bg-blue-100 text-blue-700' },
  paid:      { label: 'Paid',      cls: 'bg-green-100 text-green-700' },
  partial:   { label: 'Partial',   cls: 'bg-yellow-100 text-yellow-700' },
  overdue:   { label: 'Overdue',   cls: 'bg-red-100 text-red-700' },
  cancelled: { label: 'Cancelled', cls: 'bg-gray-100 text-gray-400' },
};

const AGING_BUCKETS = [
  { label: 'Current',   days: 0,  color: 'text-green-700'  },
  { label: '1–30 days', days: 30, color: 'text-yellow-700' },
  { label: '31–60 days',days: 60, color: 'text-orange-600' },
  { label: '60+ days',  days: 999,color: 'text-red-700'    },
];

/* ─── helpers ────────────────────────────────────────────────────────── */
const fmt  = (n: number) => `₹${(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
const fmtD = (d: string | null) => d ? new Date(d).toLocaleDateString('en-IN') : '—';
const daysDue = (due: string | null) => {
  if (!due) return 0;
  return Math.floor((Date.now() - new Date(due).getTime()) / 86_400_000);
};

/* ─── component ──────────────────────────────────────────────────────── */
const B2BAccountDashboard: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [invoices, setInvoices]         = useState<ConsolidatedInvoiceRow[]>([]);
  const [accountSummaries, setAccountSummaries] = useState<AccountSummary[]>([]);

  // Filters
  const [search, setSearch]             = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterAccount, setFilterAccount] = useState<string>('all');
  const [expandedAccount, setExpandedAccount] = useState<string | null>(null);

  // Actions
  const [pdfLoading, setPdfLoading]     = useState<string | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState<string | null>(null);
  const [paymentModal, setPaymentModal] = useState<{
    accountId: string;
    accountName: string;
    amount: number;
    consolidatedInvoiceId?: string;
  } | null>(null);

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    try {
      const lab_id = await database.getCurrentUserLabId();

      const [{ data: ciData }, { data: accounts }] = await Promise.all([
        supabase
          .from('consolidated_invoices')
          .select('*, account:accounts!consolidated_invoices_account_id_fkey(name, type, payment_terms)')
          .eq('lab_id', lab_id)
          .order('created_at', { ascending: false }),
        (database as any).accounts.getAll(),
      ]);

      const rows: ConsolidatedInvoiceRow[] = (ciData || []).map((ci: any) => ({
        id:                   ci.id,
        invoice_number:       ci.invoice_number,
        account_id:           ci.account_id,
        account_name:         ci.account?.name || 'Unknown',
        billing_period_start: ci.billing_period_start,
        billing_period_end:   ci.billing_period_end,
        total_amount:         ci.total_amount,
        status:               ci.status,
        due_date:             ci.due_date,
        created_at:           ci.created_at,
        notes:                ci.notes,
      }));
      setInvoices(rows);

      // Build per-account summaries
      const monthlyAccounts = (accounts || []).filter((a: any) => a.billing_mode === 'monthly');
      const summaries: AccountSummary[] = monthlyAccounts.map((acc: any) => {
        const accInvoices = rows.filter(r => r.account_id === acc.id);
        const unpaid = accInvoices.filter(r => !['paid', 'cancelled'].includes(r.status));
        const paid   = accInvoices.filter(r => r.status === 'paid');
        const overdue = unpaid.filter(r => r.due_date && daysDue(r.due_date) > 0);

        return {
          id:               acc.id,
          name:             acc.name,
          type:             acc.type || '',
          payment_terms:    acc.payment_terms || 30,
          totalOutstanding: unpaid.reduce((s, r) => s + r.total_amount, 0),
          totalPaid:        paid.reduce((s, r) => s + r.total_amount, 0),
          overdueAmount:    overdue.reduce((s, r) => s + r.total_amount, 0),
          invoiceCount:     accInvoices.length,
          lastInvoiceDate:  accInvoices[0]?.created_at || null,
          oldestUnpaidDue:  unpaid.reduce((oldest: string | null, r) => {
            if (!r.due_date) return oldest;
            return !oldest || r.due_date < oldest ? r.due_date : oldest;
          }, null),
        };
      });
      setAccountSummaries(summaries.sort((a, b) => b.totalOutstanding - a.totalOutstanding));
    } catch (e) {
      console.error('B2B dashboard load error:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleStatusChange = async (invoiceId: string, newStatus: string) => {
    setUpdatingStatus(invoiceId);
    try {
      await supabase
        .from('consolidated_invoices')
        .update({ status: newStatus, ...(newStatus === 'paid' ? { paid_at: new Date().toISOString() } : {}) })
        .eq('id', invoiceId);
      await load();
    } catch (e) {
      alert('Failed to update status');
    } finally {
      setUpdatingStatus(null);
    }
  };

  const handlePDF = async (inv: ConsolidatedInvoiceRow) => {
    setPdfLoading(inv.id);
    try {
      const labId = await database.getCurrentUserLabId();
      const url = await generateConsolidatedInvoicePDF(inv.id, labId);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${inv.invoice_number}_${inv.account_name}.pdf`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    } catch (e) {
      alert('PDF generation failed. Check console.');
      console.error(e);
    } finally {
      setPdfLoading(null);
    }
  };

  /* ── derived data ── */
  const totalOutstanding = accountSummaries.reduce((s, a) => s + a.totalOutstanding, 0);
  const totalOverdue     = accountSummaries.reduce((s, a) => s + a.overdueAmount, 0);
  const totalPaid        = accountSummaries.reduce((s, a) => s + a.totalPaid, 0);
  const overdueCount     = invoices.filter(i => i.due_date && daysDue(i.due_date) > 0 && !['paid','cancelled'].includes(i.status)).length;

  // Aging buckets (on outstanding invoices only)
  const unpaidInvoices = invoices.filter(i => !['paid', 'cancelled'].includes(i.status));
  const aging = [
    unpaidInvoices.filter(i => !i.due_date || daysDue(i.due_date) <= 0),
    unpaidInvoices.filter(i => i.due_date && daysDue(i.due_date) > 0 && daysDue(i.due_date) <= 30),
    unpaidInvoices.filter(i => i.due_date && daysDue(i.due_date) > 30 && daysDue(i.due_date) <= 60),
    unpaidInvoices.filter(i => i.due_date && daysDue(i.due_date) > 60),
  ];

  const filteredInvoices = invoices.filter(inv => {
    if (filterStatus !== 'all' && inv.status !== filterStatus) return false;
    if (filterAccount !== 'all' && inv.account_id !== filterAccount) return false;
    if (search && !inv.account_name.toLowerCase().includes(search.toLowerCase()) &&
        !inv.invoice_number.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  if (loading) return (
    <div className="flex items-center justify-center p-16">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
    </div>
  );

  return (
    <div className="space-y-6">

      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center gap-2 text-gray-500 text-sm mb-1">
            <TrendingUp className="w-4 h-4" /> Total Outstanding
          </div>
          <div className="text-2xl font-bold text-orange-600">{fmt(totalOutstanding)}</div>
          <div className="text-xs text-gray-400 mt-1">{accountSummaries.filter(a => a.totalOutstanding > 0).length} accounts</div>
        </div>
        <div className="bg-white rounded-lg border border-red-200 p-4">
          <div className="flex items-center gap-2 text-red-500 text-sm mb-1">
            <AlertCircle className="w-4 h-4" /> Overdue
          </div>
          <div className="text-2xl font-bold text-red-600">{fmt(totalOverdue)}</div>
          <div className="text-xs text-gray-400 mt-1">{overdueCount} invoice{overdueCount !== 1 ? 's' : ''} past due</div>
        </div>
        <div className="bg-white rounded-lg border border-green-200 p-4">
          <div className="flex items-center gap-2 text-green-600 text-sm mb-1">
            <CheckCircle className="w-4 h-4" /> Total Collected
          </div>
          <div className="text-2xl font-bold text-green-700">{fmt(totalPaid)}</div>
          <div className="text-xs text-gray-400 mt-1">{invoices.filter(i => i.status === 'paid').length} paid invoices</div>
        </div>
        <div className="bg-white rounded-lg border border-blue-200 p-4">
          <div className="flex items-center gap-2 text-blue-600 text-sm mb-1">
            <FileText className="w-4 h-4" /> Total Invoices
          </div>
          <div className="text-2xl font-bold text-blue-700">{invoices.length}</div>
          <div className="text-xs text-gray-400 mt-1">{accountSummaries.length} B2B accounts</div>
        </div>
      </div>

      {/* ── Aging Report ── */}
      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Clock className="w-4 h-4 text-gray-400" /> Accounts Receivable Aging
        </h3>
        <div className="grid grid-cols-4 gap-4">
          {AGING_BUCKETS.map((bucket, i) => {
            const amount = aging[i].reduce((s, inv) => s + inv.total_amount, 0);
            return (
              <div key={bucket.label} className="border border-gray-100 rounded-lg p-3">
                <div className="text-xs text-gray-500 mb-1">{bucket.label}</div>
                <div className={`text-lg font-bold ${bucket.color}`}>{fmt(amount)}</div>
                <div className="text-xs text-gray-400">{aging[i].length} invoice{aging[i].length !== 1 ? 's' : ''}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Account Summaries (expandable) ── */}
      <div className="bg-white rounded-lg border border-gray-200">
        <div className="px-5 py-3 border-b border-gray-200">
          <h3 className="font-semibold text-gray-900">Account Ledger Summary</h3>
        </div>
        <div className="divide-y divide-gray-100">
          {accountSummaries.map(acc => {
            const isExpanded = expandedAccount === acc.id;
            const accInvoices = filteredInvoices.filter(i => i.account_id === acc.id);
            return (
              <div key={acc.id}>
                <div
                  className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-gray-50 transition-colors"
                  onClick={() => setExpandedAccount(isExpanded ? null : acc.id)}
                >
                  <div className="flex items-center gap-3">
                    {isExpanded ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                    <Building className="w-4 h-4 text-gray-400" />
                    <div>
                      <span className="font-medium text-gray-900">{acc.name}</span>
                      <span className="ml-2 text-xs text-gray-400 capitalize">{acc.type}</span>
                    </div>
                    {acc.overdueAmount > 0 && (
                      <span className="flex items-center gap-1 text-xs text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
                        <AlertCircle className="w-3 h-3" /> Overdue
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-8 text-sm">
                    <div className="text-right">
                      <div className="text-xs text-gray-400">Outstanding</div>
                      <div className={`font-semibold ${acc.totalOutstanding > 0 ? 'text-orange-600' : 'text-gray-400'}`}>
                        {fmt(acc.totalOutstanding)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-gray-400">Overdue</div>
                      <div className={`font-semibold ${acc.overdueAmount > 0 ? 'text-red-600' : 'text-gray-400'}`}>
                        {fmt(acc.overdueAmount)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-gray-400">Total Paid</div>
                      <div className="font-semibold text-green-600">{fmt(acc.totalPaid)}</div>
                    </div>
                    <div className="text-right hidden sm:block">
                      <div className="text-xs text-gray-400">Invoices</div>
                      <div className="font-semibold">{acc.invoiceCount}</div>
                    </div>
                    {acc.totalOutstanding > 0 && (
                      <button
                        onClick={e => { e.stopPropagation(); setPaymentModal({ accountId: acc.id, accountName: acc.name, amount: acc.totalOutstanding }); }}
                        className="px-3 py-1.5 text-xs bg-green-600 text-white rounded-md hover:bg-green-700 flex items-center gap-1 shrink-0"
                      >
                        <CreditCard className="w-3 h-3" /> Receive Payment
                      </button>
                    )}
                  </div>
                </div>

                {/* Expanded invoice list per account */}
                {isExpanded && (
                  <div className="border-t border-gray-100 bg-gray-50 px-8 pb-3">
                    {accInvoices.length === 0 ? (
                      <p className="text-sm text-gray-400 py-3">No invoices match current filters</p>
                    ) : (
                      <table className="w-full text-sm mt-2">
                        <thead>
                          <tr className="text-xs text-gray-500 border-b border-gray-200">
                            <th className="pb-1 text-left font-medium">Invoice #</th>
                            <th className="pb-1 text-left font-medium">Period</th>
                            <th className="pb-1 text-left font-medium">Due</th>
                            <th className="pb-1 text-right font-medium">Amount</th>
                            <th className="pb-1 font-medium">Status</th>
                            <th className="pb-1 font-medium">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {accInvoices.map(inv => {
                            const overdueDays = inv.due_date ? daysDue(inv.due_date) : 0;
                            return (
                              <tr key={inv.id} className="border-b border-gray-100 last:border-0">
                                <td className="py-2 font-mono text-xs">{inv.invoice_number}</td>
                                <td className="py-2 text-gray-600 text-xs">
                                  {fmtD(inv.billing_period_start)} – {fmtD(inv.billing_period_end)}
                                </td>
                                <td className="py-2 text-xs">
                                  {inv.due_date ? (
                                    <span className={overdueDays > 0 && !['paid','cancelled'].includes(inv.status) ? 'text-red-600 font-medium' : 'text-gray-500'}>
                                      {fmtD(inv.due_date)}
                                      {overdueDays > 0 && !['paid','cancelled'].includes(inv.status) && ` (${overdueDays}d)`}
                                    </span>
                                  ) : '—'}
                                </td>
                                <td className="py-2 text-right font-semibold">{fmt(inv.total_amount)}</td>
                                <td className="py-2">
                                  <select
                                    value={inv.status}
                                    disabled={updatingStatus === inv.id}
                                    onChange={e => handleStatusChange(inv.id, e.target.value)}
                                    className={`text-xs px-2 py-0.5 rounded-full border-0 font-medium cursor-pointer focus:ring-1 focus:ring-blue-400 ${STATUS_LABEL[inv.status]?.cls || ''}`}
                                  >
                                    {Object.entries(STATUS_LABEL).map(([val, { label }]) => (
                                      <option key={val} value={val}>{label}</option>
                                    ))}
                                  </select>
                                </td>
                                <td className="py-2">
                                  <div className="flex items-center gap-2">
                                    <button
                                      onClick={() => handlePDF(inv)}
                                      disabled={pdfLoading === inv.id}
                                      className="text-blue-600 hover:text-blue-800 text-xs flex items-center gap-1 disabled:opacity-40"
                                    >
                                      <Download className="w-3 h-3" />
                                      {pdfLoading === inv.id ? '...' : 'PDF'}
                                    </button>
                                    {!['paid','cancelled'].includes(inv.status) && (
                                      <button
                                        onClick={() => setPaymentModal({
                                          accountId: inv.account_id,
                                          accountName: inv.account_name,
                                          amount: inv.total_amount,
                                          consolidatedInvoiceId: inv.id,
                                        })}
                                        className="text-green-600 hover:text-green-800 text-xs flex items-center gap-1"
                                      >
                                        <CreditCard className="w-3 h-3" /> Pay
                                      </button>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {accountSummaries.length === 0 && (
            <div className="p-10 text-center text-gray-400 text-sm">
              No B2B monthly accounts found. Create accounts with Billing Mode = Monthly.
            </div>
          )}
        </div>
      </div>

      {/* ── All Invoices Table ── */}
      <div className="bg-white rounded-lg border border-gray-200">
        <div className="px-5 py-3 border-b border-gray-200 flex flex-wrap items-center gap-3">
          <h3 className="font-semibold text-gray-900 mr-auto">All Consolidated Invoices</h3>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input
              type="text"
              placeholder="Search…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-7 pr-3 py-1.5 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 w-44"
            />
          </div>

          {/* Status filter */}
          <div className="flex items-center gap-1">
            <Filter className="w-3.5 h-3.5 text-gray-400" />
            <select
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value)}
              className="text-sm border border-gray-300 rounded-md px-2 py-1.5 focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All Status</option>
              {Object.entries(STATUS_LABEL).map(([val, { label }]) => (
                <option key={val} value={val}>{label}</option>
              ))}
            </select>
          </div>

          {/* Account filter */}
          <select
            value={filterAccount}
            onChange={e => setFilterAccount(e.target.value)}
            className="text-sm border border-gray-300 rounded-md px-2 py-1.5 focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All Accounts</option>
            {accountSummaries.map(a => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>

          <button onClick={load} className="text-gray-500 hover:text-gray-700 p-1.5 rounded hover:bg-gray-100" title="Refresh">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-xs text-gray-500 uppercase bg-gray-50">
                <th className="px-5 py-3 text-left font-medium">Invoice #</th>
                <th className="px-4 py-3 text-left font-medium">Account</th>
                <th className="px-4 py-3 text-left font-medium">Period</th>
                <th className="px-4 py-3 text-left font-medium">Due Date</th>
                <th className="px-4 py-3 text-right font-medium">Amount</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                <th className="px-4 py-3 text-left font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredInvoices.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-gray-400">
                    No invoices match your filters
                  </td>
                </tr>
              ) : filteredInvoices.map(inv => {
                const overdueDays = inv.due_date ? daysDue(inv.due_date) : 0;
                const isOverdue = overdueDays > 0 && !['paid', 'cancelled'].includes(inv.status);
                return (
                  <tr key={inv.id} className={`hover:bg-gray-50 ${isOverdue ? 'bg-red-50/30' : ''}`}>
                    <td className="px-5 py-3 font-mono text-xs font-medium text-gray-700">{inv.invoice_number}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{inv.account_name}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {fmtD(inv.billing_period_start)} –<br />{fmtD(inv.billing_period_end)}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {inv.due_date ? (
                        <span className={isOverdue ? 'text-red-600 font-semibold' : 'text-gray-600'}>
                          {fmtD(inv.due_date)}
                          {isOverdue && (
                            <span className="block text-red-500">{overdueDays}d overdue</span>
                          )}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold">{fmt(inv.total_amount)}</td>
                    <td className="px-4 py-3">
                      <select
                        value={inv.status}
                        disabled={updatingStatus === inv.id}
                        onChange={e => handleStatusChange(inv.id, e.target.value)}
                        className={`text-xs px-2 py-1 rounded-full border-0 font-medium cursor-pointer focus:ring-1 focus:ring-blue-400 ${STATUS_LABEL[inv.status]?.cls || ''}`}
                      >
                        {Object.entries(STATUS_LABEL).map(([val, { label }]) => (
                          <option key={val} value={val}>{label}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => handlePDF(inv)}
                          disabled={pdfLoading === inv.id}
                          className="text-blue-600 hover:text-blue-800 flex items-center gap-1 text-xs disabled:opacity-40"
                        >
                          <Download className="w-3 h-3" />
                          {pdfLoading === inv.id ? 'Wait…' : 'PDF'}
                        </button>
                        {!['paid', 'cancelled'].includes(inv.status) && (
                          <button
                            onClick={() => setPaymentModal({
                              accountId: inv.account_id,
                              accountName: inv.account_name,
                              amount: inv.total_amount,
                              consolidatedInvoiceId: inv.id,
                            })}
                            className="text-green-600 hover:text-green-800 flex items-center gap-1 text-xs"
                          >
                            <CreditCard className="w-3 h-3" /> Pay
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {filteredInvoices.length > 0 && (
          <div className="px-5 py-3 border-t border-gray-100 flex justify-between text-sm text-gray-500">
            <span>{filteredInvoices.length} invoice{filteredInvoices.length !== 1 ? 's' : ''}</span>
            <span>
              Total: <strong className="text-gray-900">
                {fmt(filteredInvoices.reduce((s, i) => s + i.total_amount, 0))}
              </strong>
            </span>
          </div>
        )}
      </div>

      {/* Payment Modal */}
      {paymentModal && (
        <ReceivePaymentModal
          accountId={paymentModal.accountId}
          accountName={paymentModal.accountName}
          currentBalance={paymentModal.amount}
          consolidatedInvoiceId={paymentModal.consolidatedInvoiceId}
          onClose={() => setPaymentModal(null)}
          onSuccess={() => { load(); setPaymentModal(null); }}
        />
      )}
    </div>
  );
};

export default B2BAccountDashboard;
