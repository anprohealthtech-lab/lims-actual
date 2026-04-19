import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Building2, CheckCircle2, ChevronRight, Loader2, Pencil, Plus, Search, Trash2, Upload, Users, X } from 'lucide-react';
import { supabase, database } from '../../utils/supabase';
import ExcelImportPanel, { ImportedPatient } from './ExcelImportPanel';

interface Account { id: string; name: string; type: string; default_discount_percent: number | null; }
interface Package { id: string; name: string; price: number; description: string; lab_id?: string | null; package_test_groups?: { test_group_id: string }[]; }
interface TestGroup { id: string; name: string; price: number; lab_id?: string | null; }
interface SelectionBundle { packageIds: string[]; testIds: string[]; }
export interface PatientRow { id: string; salutation: string; name: string; age: string; age_unit: 'years' | 'months' | 'days'; gender: 'Male' | 'Female' | 'Other'; phone: string; email: string; sample_id: string; corporate_employee_id: string; }
interface SubmitResult { patient_name: string; order_id?: string; sample_id?: string; order_display?: string; error?: string; }
interface BulkRegistrationModalProps { onClose: () => void; onSuccess: (batchId: string) => void; }

const SALUTATIONS = ['Mr.', 'Mrs.', 'Ms.', 'Dr.', 'M/s'];
const STEPS = ['Account & Tests', 'Patient Roster', 'Review & Submit'];
const normalizeName = (v: string) => v.trim().toLowerCase().replace(/\s+/g, ' ');
const toggleInArray = (values: string[], id: string) => values.includes(id) ? values.filter((value) => value !== id) : [...values, id];
const dedupeByName = <T extends { id: string; name: string; lab_id?: string | null }>(items: T[], preferredLabId?: string | null) => {
  const map = new Map<string, T>();
  items.forEach((item) => {
    const key = normalizeName(item.name);
    const existing = map.get(key);
    if (!existing || (item.lab_id === preferredLabId && existing.lab_id !== preferredLabId)) map.set(key, item);
  });
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
};
const makeEmptyRow = (): PatientRow => ({ id: crypto.randomUUID(), salutation: 'Mr.', name: '', age: '', age_unit: 'years', gender: 'Male', phone: '', email: '', sample_id: '', corporate_employee_id: '' });

const BulkRegistrationModal: React.FC<BulkRegistrationModalProps> = ({ onClose, onSuccess }) => {
  const [step, setStep] = useState(0);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [packages, setPackages] = useState<Package[]>([]);
  const [testGroups, setTestGroups] = useState<TestGroup[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [selectionMode, setSelectionMode] = useState<'package' | 'tests'>('package');
  const [selectedPackageIds, setSelectedPackageIds] = useState<string[]>([]);
  const [selectedTestIds, setSelectedTestIds] = useState<string[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [step1Error, setStep1Error] = useState('');
  const [currentLabId, setCurrentLabId] = useState<string | null>(null);
  const [rows, setRows] = useState<PatientRow[]>([makeEmptyRow()]);
  const [showExcelPanel, setShowExcelPanel] = useState(false);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [rowExtras, setRowExtras] = useState<Record<string, SelectionBundle>>({});
  const [editingExtrasRowId, setEditingExtrasRowId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitProgress, setSubmitProgress] = useState<SubmitResult[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [batchId, setBatchId] = useState('');
  const [packageSearch, setPackageSearch] = useState('');
  const [testSearch, setTestSearch] = useState('');
  const [extrasPackageSearch, setExtrasPackageSearch] = useState('');
  const [extrasTestSearch, setExtrasTestSearch] = useState('');
  const nameInputRefs = useRef<Map<string, HTMLInputElement>>(new Map());

  const selectedAccount = accounts.find((a) => a.id === selectedAccountId);
  const selectedPackages = useMemo(() => packages.filter((p) => selectedPackageIds.includes(p.id)), [packages, selectedPackageIds]);
  const selectedTests = useMemo(() => testGroups.filter((t) => selectedTestIds.includes(t.id)), [testGroups, selectedTestIds]);
  const filteredPackages = useMemo(() => packageSearch.trim() ? packages.filter((p) => p.name.toLowerCase().includes(packageSearch.toLowerCase())) : packages, [packages, packageSearch]);
  const filteredTestGroups = useMemo(() => testSearch.trim() ? testGroups.filter((t) => t.name.toLowerCase().includes(testSearch.toLowerCase())) : testGroups, [testGroups, testSearch]);
  const filteredExtrasPackages = useMemo(() => extrasPackageSearch.trim() ? packages.filter((p) => p.name.toLowerCase().includes(extrasPackageSearch.toLowerCase())) : packages, [packages, extrasPackageSearch]);
  const filteredExtrasTestGroups = useMemo(() => extrasTestSearch.trim() ? testGroups.filter((t) => t.name.toLowerCase().includes(extrasTestSearch.toLowerCase())) : testGroups, [testGroups, extrasTestSearch]);
  const editingExtras = editingExtrasRowId ? (rowExtras[editingExtrasRowId] || { packageIds: [], testIds: [] }) : null;
  const discountFrac = (selectedAccount?.default_discount_percent || 0) / 100;
  const perPatientBase = selectionMode === 'package' ? selectedPackages.reduce((sum, pkg) => sum + (pkg.price || 0), 0) : selectedTests.reduce((sum, tg) => sum + (tg.price || 0), 0);
  const perPatientFinal = perPatientBase * (1 - discountFrac);
  const totalWithExtras = rows.reduce((sum, row) => {
    const extras = rowExtras[row.id];
    const extraBase = packages.filter((pkg) => extras?.packageIds?.includes(pkg.id)).reduce((v, pkg) => v + (pkg.price || 0), 0)
      + testGroups.filter((tg) => extras?.testIds?.includes(tg.id)).reduce((v, tg) => v + (tg.price || 0), 0);
    return sum + perPatientFinal + (extraBase * (1 - discountFrac));
  }, 0);

  useEffect(() => {
    const loadData = async () => {
      setLoadingAccounts(true);
      const labId = await database.getCurrentUserLabId();
      setCurrentLabId(labId);
      let accsQuery = supabase.from('accounts').select('id, name, type, default_discount_percent').in('type', ['corporate', 'hospital', 'insurer', 'clinic']).eq('is_active', true).order('name');
      if (labId) accsQuery = accsQuery.eq('lab_id', labId);
      const [{ data: accs }, { data: pkgs, error: pkgError }, { data: tgs, error: tgError }] = await Promise.all([accsQuery, database.packages.getAll(), database.testGroups.getAll()]);
      if (pkgError) console.error('Failed to load lab packages for bulk registration:', pkgError);
      if (tgError) console.error('Failed to load lab tests for bulk registration:', tgError);
      setAccounts(accs || []);
      setPackages(dedupeByName((pkgs as Package[]) || [], labId));
      setTestGroups(dedupeByName((tgs as TestGroup[]) || [], labId));
      setLoadingAccounts(false);
    };
    loadData();
  }, []);

  const getExtraSummary = (rowId: string) => {
    const extras = rowExtras[rowId];
    const packageCount = extras?.packageIds?.length || 0;
    const testCount = extras?.testIds?.length || 0;
    return { packageCount, testCount, total: packageCount + testCount };
  };

  const validateStep1 = () => {
    if (!selectedAccountId) return setStep1Error('Please select an account'), false;
    if (selectionMode === 'package' && selectedPackageIds.length === 0) return setStep1Error('Please select at least one package'), false;
    if (selectionMode === 'tests' && selectedTestIds.length === 0) return setStep1Error('Please select at least one test'), false;
    setStep1Error(''); return true;
  };
  const updateRow = (id: string, field: keyof PatientRow, value: string) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
    if (rowErrors[id]) setRowErrors((prev) => { const next = { ...prev }; delete next[id]; return next; });
  };
  const addRow = (focusNew = false) => {
    const newRow = makeEmptyRow();
    setRows((prev) => [...prev, newRow]);
    if (focusNew) setTimeout(() => nameInputRefs.current.get(newRow.id)?.focus(), 30);
  };
  const removeRow = (id: string) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
    setRowExtras((prev) => { const next = { ...prev }; delete next[id]; return next; });
  };
  const handleTabOnLastField = (e: React.KeyboardEvent, rowIndex: number) => {
    if (e.key === 'Tab' && !e.shiftKey && rowIndex === rows.length - 1) { e.preventDefault(); addRow(true); }
  };
  const updateEditingExtras = (field: keyof SelectionBundle, id: string) => {
    if (!editingExtrasRowId) return;
    setRowExtras((prev) => {
      const current = prev[editingExtrasRowId] || { packageIds: [], testIds: [] };
      return { ...prev, [editingExtrasRowId]: { ...current, [field]: toggleInArray(current[field], id) } };
    });
  };
  const handleExcelImport = (imported: ImportedPatient[]) => {
    const newRows: PatientRow[] = imported.map((p) => ({ id: crypto.randomUUID(), salutation: p.salutation || 'Mr.', name: p.name, age: String(p.age), age_unit: p.age_unit, gender: p.gender, phone: p.phone, email: p.email, sample_id: p.sample_id, corporate_employee_id: p.corporate_employee_id }));
    setRows((prev) => [...prev.filter((r) => r.name.trim()), ...newRows]);
    setShowExcelPanel(false);
  };
  const validateStep2 = () => {
    const errors: Record<string, string> = {};
    rows.forEach((r) => { if (!r.name.trim()) errors[r.id] = 'Name required'; else if (!r.age || parseInt(r.age, 10) <= 0) errors[r.id] = 'Valid age required'; });
    setRowErrors(errors); return Object.keys(errors).length === 0 && rows.length > 0;
  };
  const handleSubmit = async () => {
    setSubmitting(true); setSubmitProgress([]);
    try {
      const payload = {
        account_id: selectedAccountId,
        ...(selectionMode === 'package' ? { package_ids: selectedPackageIds } : { test_group_ids: selectedTestIds }),
        patients: rows.map((r) => ({ name: `${r.salutation} ${r.name.trim()}`.trim(), age: parseInt(r.age, 10) || 0, age_unit: r.age_unit, gender: r.gender, phone: r.phone.trim() || undefined, email: r.email.trim() || undefined, sample_id: r.sample_id.trim() || undefined, corporate_employee_id: r.corporate_employee_id.trim() || undefined, additional_package_ids: rowExtras[r.id]?.packageIds || [], additional_test_group_ids: rowExtras[r.id]?.testIds || [] })),
      };
      const { data, error } = await supabase.functions.invoke('bulk-create-corporate-orders', { body: payload });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || 'Unknown error');
      setSubmitProgress(data.results || []); setBatchId(data.batch_id); setSubmitted(true);
    } catch (err) {
      setSubmitProgress([{ patient_name: 'Submission failed', error: (err as Error).message }]);
    } finally { setSubmitting(false); }
  };

  const successCount = submitProgress.filter((r) => !r.error).length;
  const failCount = submitProgress.filter((r) => !!r.error).length;

  return <>
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[96vh] w-full max-w-6xl flex-col rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b p-4">
          <div className="flex items-center gap-2"><Building2 className="h-5 w-5 text-blue-600" /><h2 className="text-lg font-semibold">New Bulk Registration</h2></div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
        </div>
        <div className="flex items-center gap-2 px-6 pb-2 pt-4">
          {STEPS.map((label, i) => <React.Fragment key={label}>
            <div className="flex items-center gap-1.5">
              <div className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${i < step ? 'bg-green-500 text-white' : i === step ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-500'}`}>{i < step ? 'OK' : i + 1}</div>
              <span className={`text-sm ${i === step ? 'font-medium text-blue-600' : 'text-gray-500'}`}>{label}</span>
            </div>
            {i < STEPS.length - 1 && <div className="mx-1 h-px flex-1 bg-gray-200" />}
          </React.Fragment>)}
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          {step === 0 && <div className="space-y-5">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Corporate Account *</label>
              {loadingAccounts ? <div className="flex items-center gap-2 text-sm text-gray-400"><Loader2 className="h-4 w-4 animate-spin" /> Loading accounts...</div> : (
                <select value={selectedAccountId} onChange={(e) => { setSelectedAccountId(e.target.value); setStep1Error(''); }} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">Select account...</option>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.type})</option>)}
                </select>
              )}
              {selectedAccount?.default_discount_percent ? <p className="mt-1 text-xs text-green-600">Account discount: {selectedAccount.default_discount_percent}% will be applied</p> : null}
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">Tests / Package *</label>
              <div className="mb-3 flex gap-3">
                {(['package', 'tests'] as const).map((m) => <button key={m} onClick={() => setSelectionMode(m)} className={`rounded-lg border px-4 py-1.5 text-sm transition-colors ${selectionMode === m ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 text-gray-600 hover:border-blue-300'}`}>{m === 'package' ? 'By Package' : 'Select Tests'}</button>)}
              </div>
              {selectionMode === 'package' ? <div className="space-y-2">
                <div className="relative"><Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" /><input type="text" value={packageSearch} onChange={(e) => setPackageSearch(e.target.value)} placeholder="Search packages..." className="w-full rounded-lg border border-gray-300 py-1.5 pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
                <div className="grid max-h-48 grid-cols-1 gap-2 overflow-y-auto rounded-lg border border-gray-200 p-2 md:grid-cols-2">
                  {filteredPackages.length === 0 ? <p className="col-span-2 py-3 text-center text-sm text-gray-400">No packages match "{packageSearch}"</p> : filteredPackages.map((pkg) => <label key={pkg.id} className="flex items-start gap-2 rounded p-2 text-sm hover:bg-gray-50">
                    <input type="checkbox" checked={selectedPackageIds.includes(pkg.id)} onChange={() => { setSelectedPackageIds((prev) => toggleInArray(prev, pkg.id)); setStep1Error(''); }} className="mt-0.5 rounded" />
                    <div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><span className="truncate font-medium text-gray-900">{pkg.name}</span><span className="whitespace-nowrap text-xs text-gray-500">Rs {pkg.price}</span></div>{pkg.description ? <p className="mt-0.5 line-clamp-2 text-xs text-gray-500">{pkg.description}</p> : null}</div>
                  </label>)}
                </div>
                <p className="text-xs text-gray-500">Loaded from the current lab{currentLabId ? '' : ' context'} only. Duplicate names are collapsed.</p>
              </div> : <div className="space-y-2">
                <div className="relative"><Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" /><input type="text" value={testSearch} onChange={(e) => setTestSearch(e.target.value)} placeholder="Search tests..." className="w-full rounded-lg border border-gray-300 py-1.5 pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
                <div className="grid max-h-44 grid-cols-2 gap-2 overflow-y-auto rounded-lg border border-gray-200 p-2 md:grid-cols-3">
                  {filteredTestGroups.length === 0 ? <p className="col-span-3 py-3 text-center text-sm text-gray-400">No tests match "{testSearch}"</p> : filteredTestGroups.map((tg) => <label key={tg.id} className="flex items-center gap-2 rounded p-1 text-sm hover:bg-gray-50">
                    <input type="checkbox" checked={selectedTestIds.includes(tg.id)} onChange={() => { setSelectedTestIds((prev) => toggleInArray(prev, tg.id)); setStep1Error(''); }} className="rounded" />
                    <span className="truncate">{tg.name}</span><span className="ml-auto text-xs text-gray-400">Rs {tg.price}</span>
                  </label>)}
                </div>
              </div>}
            </div>
            {selectedAccountId && (selectionMode === 'package' ? selectedPackageIds.length > 0 : selectedTestIds.length > 0) && <div className="rounded-lg bg-blue-50 p-3 text-sm">
              <p className="font-medium text-blue-800">Per patient: Rs {perPatientFinal.toFixed(2)}</p>
              {discountFrac > 0 && <p className="mt-0.5 text-xs text-blue-600">After {selectedAccount?.default_discount_percent}% account discount on Rs {perPatientBase.toFixed(2)}</p>}
              <p className="mt-1 text-xs text-blue-600">In the next step, you can add extra tests or packages only for selected patients.</p>
            </div>}
            {step1Error && <p className="flex items-center gap-1 text-sm text-red-600"><AlertCircle className="h-4 w-4" /> {step1Error}</p>}
          </div>}
          {step === 1 && <div className="space-y-4">
            <div className="flex items-center justify-between"><p className="text-sm text-gray-600">{rows.length} patient(s)</p><button onClick={() => setShowExcelPanel(true)} className="flex items-center gap-1.5 rounded-lg border border-green-300 px-3 py-1.5 text-sm text-green-600 hover:text-green-700"><Upload className="h-4 w-4" /> Import Excel</button></div>
            <div className="rounded-xl border border-gray-200 bg-gray-50/40 p-3">
              <p className="mb-3 text-sm text-gray-600">Add patients here. This table is wider now so registration is easier on desktop, and you can still scroll horizontally if needed.</p>
              <div className="overflow-x-auto"><table className="min-w-[1180px] w-full text-sm"><thead><tr className="border-b">{['Sal.', 'Name *', 'Age *', 'Unit', 'Gender *', 'Phone', 'Emp ID', 'Sample ID', 'Extras', ''].map((h) => <th key={h} className="whitespace-nowrap px-3 py-2 text-left text-xs font-medium text-gray-600">{h}</th>)}</tr></thead><tbody>
              {rows.map((row, rowIndex) => { const extraSummary = getExtraSummary(row.id); return <tr key={row.id} className={`border-b ${rowErrors[row.id] ? 'bg-red-50' : ''}`}>
                <td className="px-2 py-2"><select value={row.salutation} onChange={(e) => updateRow(row.id, 'salutation', e.target.value)} className="rounded border border-gray-300 px-2 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500">{SALUTATIONS.map((s) => <option key={s}>{s}</option>)}</select></td>
                <td className="px-2 py-2"><input ref={(el) => { if (el) nameInputRefs.current.set(row.id, el); else nameInputRefs.current.delete(row.id); }} value={row.name} onChange={(e) => updateRow(row.id, 'name', e.target.value)} placeholder="Full name" className={`w-56 rounded border px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 ${rowErrors[row.id] ? 'border-red-400' : 'border-gray-300'}`} /></td>
                <td className="px-2 py-2"><input value={row.age} onChange={(e) => updateRow(row.id, 'age', e.target.value)} placeholder="0" type="number" min="0" className="w-20 rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" /></td>
                <td className="px-2 py-2"><select value={row.age_unit} onChange={(e) => updateRow(row.id, 'age_unit', e.target.value)} className="rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none"><option value="years">Yrs</option><option value="months">Mos</option><option value="days">Days</option></select></td>
                <td className="px-2 py-2"><select value={row.gender} onChange={(e) => updateRow(row.id, 'gender', e.target.value)} className="rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none"><option>Male</option><option>Female</option><option>Other</option></select></td>
                <td className="px-2 py-2"><input value={row.phone} onChange={(e) => updateRow(row.id, 'phone', e.target.value)} placeholder="Phone" className="w-36 rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none" /></td>
                <td className="px-2 py-2"><input value={row.corporate_employee_id} onChange={(e) => updateRow(row.id, 'corporate_employee_id', e.target.value)} placeholder="Emp ID" className="w-32 rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none" /></td>
                <td className="px-2 py-2"><input value={row.sample_id} onChange={(e) => updateRow(row.id, 'sample_id', e.target.value)} onKeyDown={(e) => handleTabOnLastField(e, rowIndex)} placeholder="Sample ID" className="w-36 rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none" /></td>
                <td className="px-2 py-2"><button type="button" onClick={() => { setExtrasPackageSearch(''); setExtrasTestSearch(''); setEditingExtrasRowId(row.id); }} className="inline-flex items-center gap-1 rounded border border-blue-200 px-3 py-2 text-xs text-blue-700 hover:bg-blue-50"><Pencil className="h-3 w-3" />{extraSummary.total > 0 ? `${extraSummary.total} selected` : 'Add extras'}</button></td>
                <td className="px-2 py-2"><button onClick={() => removeRow(row.id)} className="text-red-400 hover:text-red-600"><Trash2 className="h-4 w-4" /></button></td>
              </tr>; })}
            </tbody></table></div>
            </div>
            <button onClick={() => addRow(true)} className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700"><Plus className="h-4 w-4" /> Add Patient</button>
            {Object.keys(rowErrors).length > 0 && <p className="flex items-center gap-1 text-sm text-red-600"><AlertCircle className="h-4 w-4" /> Please fix validation errors above</p>}
          </div>}
          {step === 2 && !submitted && <div className="space-y-4">
            <div className="space-y-2 rounded-xl bg-gray-50 p-4">
              <div className="flex justify-between text-sm"><span className="text-gray-600">Account</span><span className="font-medium">{selectedAccount?.name}</span></div>
              <div className="flex justify-between text-sm"><span className="text-gray-600">{selectionMode === 'package' ? 'Packages' : 'Tests'}</span><span className="font-medium">{selectionMode === 'package' ? `${selectedPackageIds.length} package${selectedPackageIds.length === 1 ? '' : 's'} selected` : `${selectedTestIds.length} tests selected`}</span></div>
              <div className="flex justify-between text-sm"><span className="text-gray-600">Patients</span><span className="font-medium">{rows.length}</span></div>
              <div className="flex justify-between border-t pt-2 text-sm"><span className="text-gray-600">Per patient</span><span className="font-semibold text-green-700">Rs {perPatientFinal.toFixed(2)}</span></div>
              <div className="flex justify-between text-sm font-semibold"><span>Total Invoice Value</span><span className="text-blue-700">Rs {totalWithExtras.toFixed(2)}</span></div>
            </div>
            <div className="overflow-hidden rounded-lg border"><table className="w-full text-sm"><thead className="bg-gray-50"><tr><th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Patient</th><th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Age / Gender</th><th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Emp ID</th><th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Extra Add-ons</th></tr></thead><tbody>
              {rows.map((r) => { const extraSummary = getExtraSummary(r.id); return <tr key={r.id} className="border-t"><td className="px-3 py-2">{r.salutation} {r.name}</td><td className="px-3 py-2 text-gray-500">{r.age} {r.age_unit} / {r.gender}</td><td className="px-3 py-2 text-gray-500">{r.corporate_employee_id || '-'}</td><td className="px-3 py-2 text-gray-500">{extraSummary.total > 0 ? `${extraSummary.packageCount} pkg, ${extraSummary.testCount} test` : '-'}</td></tr>; })}
            </tbody></table></div>
          </div>}
          {submitted && <div className="space-y-4">
            <div className={`flex items-center gap-3 rounded-lg p-4 ${failCount === 0 ? 'bg-green-50' : 'bg-amber-50'}`}>{failCount === 0 ? <CheckCircle2 className="h-6 w-6 text-green-600" /> : <AlertCircle className="h-6 w-6 text-amber-600" />}<div><p className="font-medium">{successCount} orders created{failCount > 0 ? `, ${failCount} failed` : ''}</p><p className="text-sm text-gray-500">Batch ID: {batchId?.slice(-8)}</p></div></div>
            <div className="max-h-60 overflow-y-auto rounded-lg border">{submitProgress.map((r, i) => <div key={`${r.patient_name}-${i}`} className={`flex items-center justify-between px-3 py-2 text-sm ${i > 0 ? 'border-t' : ''} ${r.error ? 'bg-red-50' : ''}`}><span className={r.error ? 'text-red-700' : ''}>{r.patient_name}</span>{r.error ? <span className="text-xs text-red-500">{r.error}</span> : <span className="flex items-center gap-1 text-xs text-green-600"><CheckCircle2 className="h-3 w-3" /> {r.sample_id || r.order_display}</span>}</div>)}</div>
          </div>}
        </div>
        <div className="flex items-center justify-between gap-3 border-t p-4">
          {!submitted ? <>
            <button onClick={() => step > 0 ? setStep(step - 1) : onClose()} className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50">{step === 0 ? 'Cancel' : 'Back'}</button>
            <div className="flex gap-2">
              {step < 2 && <button onClick={() => { if (step === 0 && validateStep1()) setStep(1); else if (step === 1 && validateStep2()) setStep(2); }} className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-5 py-2 text-sm text-white hover:bg-blue-700">Next <ChevronRight className="h-4 w-4" /></button>}
              {step === 2 && <button onClick={handleSubmit} disabled={submitting} className="flex items-center gap-1.5 rounded-lg bg-green-600 px-5 py-2 text-sm text-white hover:bg-green-700 disabled:opacity-60">{submitting ? <><Loader2 className="h-4 w-4 animate-spin" /> Creating orders...</> : <><Users className="h-4 w-4" /> Create {rows.length} Orders</>}</button>}
            </div>
          </> : <>
            <button onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50">Close</button>
            <button onClick={() => onSuccess(batchId)} className="rounded-lg bg-blue-600 px-5 py-2 text-sm text-white hover:bg-blue-700">View Batch Orders</button>
          </>}
        </div>
      </div>
    </div>
    {editingExtrasRowId && editingExtras && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"><div className="w-full max-w-3xl rounded-xl bg-white shadow-xl"><div className="flex items-center justify-between border-b px-4 py-3"><div><h3 className="text-base font-semibold text-gray-900">Patient-specific add-ons</h3><p className="text-sm text-gray-500">Add extra packages or tests only for this patient.</p></div><button onClick={() => { setEditingExtrasRowId(null); setExtrasPackageSearch(''); setExtrasTestSearch(''); }} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button></div><div className="grid gap-4 p-4 md:grid-cols-2"><div className="space-y-2"><h4 className="text-sm font-medium text-gray-800">Extra packages</h4><div className="relative mb-1"><Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" /><input type="text" value={extrasPackageSearch} onChange={(e) => setExtrasPackageSearch(e.target.value)} placeholder="Search packages..." className="w-full rounded-lg border border-gray-300 py-1.5 pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" /></div><div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-gray-200 p-2">{filteredExtrasPackages.length === 0 ? <p className="py-3 text-center text-sm text-gray-400">No packages match "{extrasPackageSearch}"</p> : filteredExtrasPackages.map((pkg) => <label key={pkg.id} className="flex items-start gap-2 rounded p-2 hover:bg-gray-50"><input type="checkbox" checked={editingExtras.packageIds.includes(pkg.id)} onChange={() => updateEditingExtras('packageIds', pkg.id)} className="mt-0.5 rounded" /><div className="min-w-0"><div className="text-sm font-medium text-gray-900">{pkg.name}</div><div className="text-xs text-gray-500">Rs {pkg.price}</div></div></label>)}</div></div><div className="space-y-2"><h4 className="text-sm font-medium text-gray-800">Extra tests</h4><div className="relative mb-1"><Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" /><input type="text" value={extrasTestSearch} onChange={(e) => setExtrasTestSearch(e.target.value)} placeholder="Search tests..." className="w-full rounded-lg border border-gray-300 py-1.5 pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" /></div><div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-gray-200 p-2">{filteredExtrasTestGroups.length === 0 ? <p className="py-3 text-center text-sm text-gray-400">No tests match "{extrasTestSearch}"</p> : filteredExtrasTestGroups.map((tg) => <label key={tg.id} className="flex items-start gap-2 rounded p-2 hover:bg-gray-50"><input type="checkbox" checked={editingExtras.testIds.includes(tg.id)} onChange={() => updateEditingExtras('testIds', tg.id)} className="mt-0.5 rounded" /><div className="min-w-0"><div className="text-sm font-medium text-gray-900">{tg.name}</div><div className="text-xs text-gray-500">Rs {tg.price}</div></div></label>)}</div></div></div><div className="flex justify-end border-t px-4 py-3"><button onClick={() => { setEditingExtrasRowId(null); setExtrasPackageSearch(''); setExtrasTestSearch(''); }} className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700">Done</button></div></div></div>}
    {showExcelPanel && <ExcelImportPanel onImport={handleExcelImport} onClose={() => setShowExcelPanel(false)} />}
  </>;
};

export default BulkRegistrationModal;
