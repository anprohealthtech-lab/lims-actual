import React, { useState, useEffect } from 'react';
import { Building2, Plus, ClipboardList, Receipt, RefreshCw } from 'lucide-react';
import { supabase, database } from '../utils/supabase';
import BulkRegistrationModal from '../components/CorporateBulk/BulkRegistrationModal';
import AccountOrdersView from '../components/CorporateBulk/AccountOrdersView';
import MonthlyAccountBilling from '../components/Billing/MonthlyAccountBilling';

type TabId = 'register' | 'orders' | 'invoicing';

interface BatchSummary {
  id: string;
  created_at: string;
  status: string;
  total_patients: number;
  created_orders: number;
  failed_orders: number;
  excel_filename: string | null;
  accounts: { name: string } | null;
}

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'register', label: 'Register Patients', icon: <Plus className="w-4 h-4" /> },
  { id: 'orders', label: 'Account Orders', icon: <ClipboardList className="w-4 h-4" /> },
  { id: 'invoicing', label: 'Account Invoicing', icon: <Receipt className="w-4 h-4" /> },
];

const CorporateBulkRegistration: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabId>('register');
  const [showModal, setShowModal] = useState(false);
  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [loadingBatches, setLoadingBatches] = useState(true);
  const [jumpToBatchId, setJumpToBatchId] = useState<string | undefined>();

  const loadBatches = async () => {
    setLoadingBatches(true);
    const labId = await database.getCurrentUserLabId();
    let query = supabase
      .from('bulk_registration_batches')
      .select('id, created_at, status, total_patients, created_orders, failed_orders, excel_filename, accounts(name)')
      .order('created_at', { ascending: false })
      .limit(20);
    if (labId) query = query.eq('lab_id', labId);
    const { data } = await query;
    setBatches((data as BatchSummary[]) || []);
    setLoadingBatches(false);
  };

  useEffect(() => { loadBatches(); }, []);

  const handleBatchSuccess = (batchId: string) => {
    setShowModal(false);
    setJumpToBatchId(batchId);
    setActiveTab('orders');
    loadBatches();
  };

  const statusColor = (status: string) => {
    const map: Record<string, string> = {
      completed: 'bg-green-100 text-green-700',
      partial: 'bg-amber-100 text-amber-700',
      failed: 'bg-red-100 text-red-700',
      processing: 'bg-blue-100 text-blue-700',
      pending: 'bg-gray-100 text-gray-600',
    };
    return map[status] || 'bg-gray-100 text-gray-600';
  };

  return (
    <div className="space-y-4">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-100 rounded-xl">
            <Building2 className="w-6 h-6 text-blue-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Corporate Bulk Registration</h1>
            <p className="text-sm text-gray-500">Register multiple patients under a corporate account</p>
          </div>
        </div>
        {activeTab === 'register' && (
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
          >
            <Plus className="w-4 h-4" /> New Bulk Registration
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'bg-white text-blue-700 shadow-sm'
                : 'text-gray-600 hover:text-gray-800'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab: Register Patients */}
      {activeTab === 'register' && (
        <div className="space-y-4">
          {/* Batch history */}
          <div className="bg-white rounded-xl border border-gray-200">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <h2 className="text-sm font-semibold text-gray-800">Recent Batches</h2>
              <button onClick={loadBatches} className="text-gray-400 hover:text-gray-600">
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>

            {loadingBatches ? (
              <div className="px-4 py-6 text-center text-gray-400 text-sm">Loading...</div>
            ) : batches.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <Building2 className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                <p className="text-gray-500 text-sm">No bulk batches yet.</p>
                <p className="text-gray-400 text-xs mt-1">Click "New Bulk Registration" to get started.</p>
              </div>
            ) : (
              <div className="divide-y">
                {batches.map((b) => (
                  <div key={b.id} className="flex items-center justify-between px-4 py-3 hover:bg-gray-50">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {(b.accounts as { name: string } | null)?.name || 'Unknown Account'}
                        {b.excel_filename && (
                          <span className="ml-2 text-xs text-gray-400">· {b.excel_filename}</span>
                        )}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {new Date(b.created_at).toLocaleString()} ·{' '}
                        {b.created_orders}/{b.total_patients} orders created
                        {b.failed_orders > 0 && (
                          <span className="text-red-500 ml-1">· {b.failed_orders} failed</span>
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 ml-4">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColor(b.status)}`}>
                        {b.status}
                      </span>
                      <button
                        onClick={() => { setJumpToBatchId(b.id); setActiveTab('orders'); }}
                        className="text-xs text-blue-600 hover:text-blue-800 whitespace-nowrap"
                      >
                        View orders →
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Quick how-to */}
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-blue-800 mb-2">How it works</h3>
            <ol className="space-y-1 text-sm text-blue-700 list-decimal list-inside">
              <li>Select the corporate account and test package (or individual tests)</li>
              <li>Add patients manually or upload an Excel file</li>
              <li>Review and submit — all patients get the same tests under the same account</li>
              <li>Use <strong>Account Orders</strong> tab to track results and download bulk PDFs</li>
              <li>Use <strong>Account Invoicing</strong> tab to generate the monthly consolidated invoice</li>
            </ol>
          </div>
        </div>
      )}

      {/* Tab: Account Orders */}
      {activeTab === 'orders' && (
        <AccountOrdersView
          initialBatchId={jumpToBatchId}
          key={jumpToBatchId || 'all'} // re-mount when batch changes to trigger load
        />
      )}

      {/* Tab: Account Invoicing */}
      {activeTab === 'invoicing' && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <MonthlyAccountBilling />
        </div>
      )}

      {/* New Bulk Registration Modal */}
      {showModal && (
        <BulkRegistrationModal
          onClose={() => setShowModal(false)}
          onSuccess={handleBatchSuccess}
        />
      )}
    </div>
  );
};

export default CorporateBulkRegistration;
