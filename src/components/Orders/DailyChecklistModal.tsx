// components/Orders/DailyChecklistModal.tsx
// Date-range / doctor / B2B filters + print/export actions for the Daily
// Checklist (MIS-style barcoded invoice summary with per-investigation status).

import React, { useEffect, useMemo, useState } from 'react';
import { X, Printer, FileSpreadsheet, ClipboardList } from 'lucide-react';
import toast from 'react-hot-toast';
import SearchableSelect from '../ui/SearchableSelect';
import {
  fetchDailyChecklistData,
  fetchChecklistFilterOptions,
  generateDailyChecklistHTML,
  openDailyChecklistWindow,
  exportDailyChecklistCSV,
  ChecklistFilterOptions,
} from '../../utils/dailyChecklistService';

interface DailyChecklistModalProps {
  onClose: () => void;
  labName?: string;
}

const todayISO = () => new Date().toLocaleDateString('en-CA'); // yyyy-mm-dd local

const ALL = '__all__';

const DailyChecklistModal: React.FC<DailyChecklistModalProps> = ({ onClose, labName }) => {
  const [dateFrom, setDateFrom] = useState(todayISO());
  const [dateTo, setDateTo] = useState(todayISO());
  const [doctor, setDoctor] = useState(ALL);
  const [accountId, setAccountId] = useState(ALL);
  const [pendingOnly, setPendingOnly] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [filterOptions, setFilterOptions] = useState<ChecklistFilterOptions>({ doctors: [], accounts: [] });

  useEffect(() => {
    fetchChecklistFilterOptions()
      .then(setFilterOptions)
      .catch((err) => console.error('Checklist filter options error:', err));
  }, []);

  const doctorOptions = useMemo(
    () => [
      { id: ALL, label: 'All doctors' },
      ...filterOptions.doctors.map((d) => ({ id: d, label: d })),
    ],
    [filterOptions.doctors]
  );

  const accountOptions = useMemo(
    () => [
      { id: ALL, label: 'All B2B accounts' },
      ...filterOptions.accounts.map((a) => ({ id: a.id, label: a.name })),
    ],
    [filterOptions.accounts]
  );

  const validate = (): boolean => {
    if (!dateFrom || !dateTo) {
      toast.error('Please select both dates');
      return false;
    }
    if (dateFrom > dateTo) {
      toast.error('"From" date must be on or before "To" date');
      return false;
    }
    return true;
  };

  const buildFilters = () => ({
    dateFrom,
    dateTo,
    pendingOnly,
    doctor: doctor !== ALL ? doctor : undefined,
    accountId: accountId !== ALL ? accountId : undefined,
  });

  const handlePrint = async () => {
    if (!validate()) return;
    setIsLoading(true);
    try {
      const orders = await fetchDailyChecklistData(buildFilters());
      if (orders.length === 0) {
        toast.error('No orders found for the selected filters');
        return;
      }
      const html = generateDailyChecklistHTML(orders, {
        labName,
        dateFrom,
        dateTo,
        pendingOnly,
        doctorLabel: doctor !== ALL ? doctor : undefined,
        accountLabel:
          accountId !== ALL
            ? filterOptions.accounts.find((a) => a.id === accountId)?.name
            : undefined,
      });
      openDailyChecklistWindow(html);
    } catch (err: any) {
      console.error('Daily checklist error:', err);
      toast.error(err?.message || 'Failed to generate daily checklist');
    } finally {
      setIsLoading(false);
    }
  };

  const handleExport = async () => {
    if (!validate()) return;
    setIsLoading(true);
    try {
      const orders = await fetchDailyChecklistData(buildFilters());
      if (orders.length === 0) {
        toast.error('No orders found for the selected filters');
        return;
      }
      exportDailyChecklistCSV(orders, dateFrom, dateTo);
      toast.success('Checklist exported');
    } catch (err: any) {
      console.error('Daily checklist export error:', err);
      toast.error(err?.message || 'Failed to export daily checklist');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <div className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-blue-600" />
            <h2 className="text-lg font-semibold text-gray-900">Daily Checklist</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <p className="text-sm text-gray-600">
            Barcoded list of orders with each investigation and its current status — with space
            to write against every test on the printed sheet.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">From</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">To</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Ref. Doctor</label>
            <SearchableSelect
              options={doctorOptions}
              value={doctor}
              onChange={(v: string) => setDoctor(v || ALL)}
              placeholder="All doctors"
              searchPlaceholder="Search doctor…"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">B2B Account</label>
            <SearchableSelect
              options={accountOptions}
              value={accountId}
              onChange={(v: string) => setAccountId(v || ALL)}
              placeholder="All B2B accounts"
              searchPlaceholder="Search account…"
            />
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={pendingOnly}
              onChange={(e) => setPendingOnly(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            Pending investigations only
          </label>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-5 py-4">
          <button
            type="button"
            onClick={handleExport}
            disabled={isLoading}
            className="inline-flex items-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <FileSpreadsheet className="mr-2 h-4 w-4" />
            Export Excel
          </button>
          <button
            type="button"
            onClick={handlePrint}
            disabled={isLoading}
            className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Printer className="mr-2 h-4 w-4" />
            {isLoading ? 'Preparing…' : 'Preview & Print'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DailyChecklistModal;
