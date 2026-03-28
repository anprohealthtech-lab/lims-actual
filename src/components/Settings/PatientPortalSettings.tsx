// PatientPortalSettings.tsx
// Drop this component into any lab settings page.
// Requires: supabase client, lab_id, SUPABASE_URL env for edge function calls.
// Edge functions needed: create-patient-portal-user, bulk-create-patient-portal-users

import React, { useState, useEffect } from 'react';
import { supabase } from '../../utils/supabase';
import {
  Smartphone, Users, CheckCircle, AlertCircle,
  Download, RefreshCw, Loader2, PhoneOff, KeyRound, Copy, Check
} from 'lucide-react';

interface PortalStats {
  total: number;
  activated: number;
  noPhone: number;
  pending: number;
}

interface BulkResult {
  patient_id: string;
  name: string;
  phone: string;
  pin?: string;
  error?: string;
}

interface PatientPortalSettingsProps {
  labId: string;
}

const PatientPortalSettings: React.FC<PatientPortalSettingsProps> = ({ labId }) => {
  const [stats, setStats] = useState<PortalStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkResults, setBulkResults] = useState<BulkResult[] | null>(null);
  const [bulkSummary, setBulkSummary] = useState<{ total: number; created: number; failed: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    if (labId) loadStats();
  }, [labId]);

  const loadStats = async () => {
    setStatsLoading(true);
    try {
      const { data: all } = await supabase
        .from('patients')
        .select('id, phone, portal_access_enabled', { count: 'exact' })
        .eq('lab_id', labId)
        .eq('is_active', true);

      if (!all) return;

      const total = all.length;
      const activated = all.filter((p) => p.portal_access_enabled).length;
      const noPhone = all.filter((p) => !p.phone).length;
      const pending = total - activated - noPhone;

      setStats({ total, activated, noPhone, pending: Math.max(pending, 0) });
    } catch (err) {
      console.error('PatientPortalSettings: loadStats error', err);
    } finally {
      setStatsLoading(false);
    }
  };

  const callBulkFunction = async (forceReset: boolean) => {
    setBulkLoading(true);
    setBulkResults(null);
    setBulkSummary(null);
    setError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const supabaseUrl = (supabase as any).supabaseUrl as string;

      const res = await fetch(`${supabaseUrl}/functions/v1/bulk-create-patient-portal-users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
          'apikey': (supabase as any).supabaseKey as string,
        },
        body: JSON.stringify({ lab_id: labId, force_reset: forceReset }),
      });

      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error || 'Bulk operation failed');

      const results: BulkResult[] = json.results || [];
      setBulkResults(results);
      setBulkSummary({ total: json.total, created: json.created, failed: json.failed });
      await loadStats();

      // Auto-download CSV immediately so PINs are not lost
      const successRows = results.filter((r) => r.pin);
      if (successRows.length > 0) {
        const csvContent = [
          'Patient Name,Phone,PIN',
          ...successRows.map((r) => `"${r.name}","${r.phone}","${r.pin}"`),
        ].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `patient_portal_pins_${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setBulkLoading(false);
    }
  };

  const handleBulkCreate = async () => {
    if (!window.confirm(
      `This will generate portal access for all active patients who have a phone number and don't already have access.\n\nA CSV with PINs will auto-download. Continue?`
    )) return;
    await callBulkFunction(false);
  };

  const handleResetAll = async () => {
    if (!window.confirm(
      `This will reset PINs for ALL ${stats?.activated ?? ''} activated patients.\n\nAll existing PINs will stop working immediately.\nA new CSV will auto-download with the new PINs.\n\nContinue?`
    )) return;
    await callBulkFunction(true);
  };

  const reDownloadCSV = () => {
    if (!bulkResults) return;
    const successRows = bulkResults.filter((r) => r.pin);
    const csvContent = [
      'Patient Name,Phone,PIN',
      ...successRows.map((r) => `"${r.name}","${r.phone}","${r.pin}"`),
    ].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `patient_portal_pins_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyPin = (patientId: string, pin: string) => {
    navigator.clipboard.writeText(pin);
    setCopiedId(patientId);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
            <Smartphone className="h-5 w-5 text-teal-600" />
            Patient Portal Access
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Generate PINs for patients to access their reports online. PINs are shared via WhatsApp/SMS by your staff.
          </p>
        </div>
        <button
          onClick={loadStats}
          disabled={statsLoading}
          className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${statsLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Stats Cards */}
      {statsLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-20 bg-gray-100 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : stats ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Patients', value: stats.total, color: 'text-gray-700', bg: 'bg-gray-50 border-gray-200', icon: <Users className="h-5 w-5 text-gray-500" /> },
            { label: 'Portal Activated', value: stats.activated, color: 'text-teal-700', bg: 'bg-teal-50 border-teal-200', icon: <CheckCircle className="h-5 w-5 text-teal-500" /> },
            { label: 'Pending Access', value: stats.pending, color: 'text-orange-700', bg: 'bg-orange-50 border-orange-200', icon: <Smartphone className="h-5 w-5 text-orange-500" /> },
            { label: 'No Phone Number', value: stats.noPhone, color: 'text-red-600', bg: 'bg-red-50 border-red-200', icon: <PhoneOff className="h-5 w-5 text-red-400" /> },
          ].map(({ label, value, color, bg, icon }) => (
            <div key={label} className={`rounded-xl border p-4 ${bg}`}>
              <div className="flex items-center justify-between mb-1">{icon}</div>
              <p className={`text-2xl font-bold ${color}`}>{value}</p>
              <p className="text-xs text-gray-500 mt-0.5">{label}</p>
            </div>
          ))}
        </div>
      ) : null}

      {/* Progress bar */}
      {stats && stats.total > 0 && (
        <div>
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            <span>Portal adoption</span>
            <span>{Math.round((stats.activated / stats.total) * 100)}% activated</span>
          </div>
          <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-teal-500 rounded-full transition-all duration-500"
              style={{ width: `${Math.min((stats.activated / stats.total) * 100, 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-800">
          <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      {/* Bulk Action */}
      <div className="border border-dashed border-teal-300 bg-teal-50/50 rounded-xl p-5 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-teal-800 flex items-center gap-2">
              <KeyRound className="h-4 w-4" />
              Generate Access for All Patients
            </h3>
            <ul className="text-xs text-teal-700 mt-2 space-y-1">
              <li>• Skips patients already activated (safe to re-run)</li>
              <li>• Skips patients without a phone number</li>
              <li>• CSV auto-downloads immediately with all PINs</li>
            </ul>
          </div>
          <button
            onClick={handleBulkCreate}
            disabled={bulkLoading || (stats?.pending === 0)}
            className="flex-shrink-0 flex items-center gap-2 px-4 py-2.5 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 disabled:bg-teal-300 disabled:cursor-not-allowed transition-colors"
          >
            {bulkLoading ? (
              <><Loader2 className="h-4 w-4 animate-spin" />Generating...</>
            ) : (
              <><Smartphone className="h-4 w-4" />Generate Access</>
            )}
          </button>
        </div>

        {/* Reset All PINs — shown when all patients are already activated */}
        {stats && stats.activated > 0 && (
          <div className="flex items-center justify-between pt-3 border-t border-teal-200">
            <div>
              <p className="text-xs font-medium text-orange-700">Reset All PINs</p>
              <p className="text-xs text-orange-600">Generates new PINs for all {stats.activated} activated patients. Old PINs stop working immediately. CSV auto-downloads.</p>
            </div>
            <button
              onClick={handleResetAll}
              disabled={bulkLoading}
              className="flex-shrink-0 flex items-center gap-2 px-3 py-2 bg-orange-100 text-orange-700 border border-orange-300 text-xs font-medium rounded-lg hover:bg-orange-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Reset All PINs
            </button>
          </div>
        )}
      </div>

      {/* Bulk Results */}
      {bulkSummary && (
        <div className="space-y-4">
          {/* Summary */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-4 text-sm">
              <span className="flex items-center gap-1.5 text-teal-700 font-medium">
                <CheckCircle className="h-4 w-4" />
                {bulkSummary.created} created
              </span>
              {bulkSummary.failed > 0 && (
                <span className="flex items-center gap-1.5 text-red-600">
                  <AlertCircle className="h-4 w-4" />
                  {bulkSummary.failed} failed
                </span>
              )}
              <span className="text-gray-500">(of {bulkSummary.total} processed)</span>
            </div>
            {bulkResults && bulkResults.some((r) => r.pin) && (
              <button
                onClick={reDownloadCSV}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <Download className="h-4 w-4" />
                Download PINs CSV
              </button>
            )}
          </div>

          {/* Results Table */}
          {bulkResults && bulkResults.length > 0 && (
            <div className="border border-gray-200 rounded-xl overflow-hidden">
              <div className="max-h-72 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
                    <tr>
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Patient</th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Phone</th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">PIN</th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {bulkResults.map((r) => (
                      <tr key={r.patient_id} className="hover:bg-gray-50">
                        <td className="px-4 py-2.5 font-medium text-gray-900">{r.name}</td>
                        <td className="px-4 py-2.5 text-gray-600 font-mono">{r.phone}</td>
                        <td className="px-4 py-2.5">
                          {r.pin ? (
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-bold text-teal-700 tracking-widest">{r.pin}</span>
                              <button
                                onClick={() => copyPin(r.patient_id, r.pin!)}
                                className="text-gray-400 hover:text-teal-600 transition-colors"
                                title="Copy PIN"
                              >
                                {copiedId === r.patient_id
                                  ? <Check className="h-3.5 w-3.5 text-teal-500" />
                                  : <Copy className="h-3.5 w-3.5" />}
                              </button>
                            </div>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          {r.error ? (
                            <span className="text-xs text-red-600" title={r.error}>Failed</span>
                          ) : (
                            <span className="text-xs text-teal-600 font-medium">Created</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <p className="text-xs text-gray-500">
            Share each patient's PIN via WhatsApp or SMS. Patients log in at{' '}
            <span className="font-mono text-gray-700">/patient/login</span> using their registered mobile number + PIN.
          </p>
        </div>
      )}
    </div>
  );
};

export default PatientPortalSettings;
