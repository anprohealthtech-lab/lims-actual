/**
 * CompletenessModal
 *
 * On-demand (no polling) check of:
 *   - Analyte coverage: per-analyte VALUE / UNIT / REFERENCE / FLAG / METHOD presence
 *   - Patient/order info placeholder coverage
 *   - Signature placeholder coverage
 *
 * Each missing item shows the exact placeholder string + Copy button.
 * Optional "Ask AI to insert missing" sends only the gap list to the AI endpoint.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ClipboardCopy,
  Loader2,
  RefreshCcw,
  Sparkles,
  X,
  XCircle,
} from 'lucide-react';
import clsx from 'clsx';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface PlaceholderOption {
  id: string;
  label: string;
  placeholder: string;
  group?: 'lab' | 'test' | 'patient' | 'branding' | 'signature' | 'section';
}

interface AnalyteGroup {
  code: string;       // e.g. ANALYTE_WBC
  label: string;
  value?: string;     // {{ANALYTE_WBC_VALUE}}
  unit?: string;
  reference?: string;
  flag?: string;
  method?: string;
}

interface CoverageResult {
  analyteGroups: AnalyteCoverage[];
  patientMissing: string[];
  patientPresent: string[];
  signatureMissing: string[];
  signaturePresent: string[];
  totalPresent: number;
  totalPossible: number;
}

interface AnalyteCoverage {
  label: string;
  code: string;
  variants: {
    key: 'value' | 'unit' | 'reference' | 'flag' | 'method';
    label: string;
    placeholder: string;
    present: boolean;
  }[];
}

export interface CompletenessModalProps {
  open: boolean;
  onClose: () => void;
  editor: any | null;
  placeholderOptions: PlaceholderOption[];
  labId: string;
  templateName?: string;
  onInsert?: (placeholder: string) => void;
}

// ─── Static placeholder groups ─────────────────────────────────────────────────

const PATIENT_PLACEHOLDERS = [
  { key: 'patientName', label: 'Patient Name' },
  { key: 'patientAge', label: 'Age' },
  { key: 'patientGender', label: 'Gender' },
  { key: 'patientPhone', label: 'Phone' },
  { key: 'patientDOB', label: 'Date of Birth' },
  { key: 'patientDisplayId', label: 'Patient ID' },
  { key: 'orderNumber', label: 'Order Number' },
  { key: 'sampleCollectedAtFormatted', label: 'Collection Date' },
  { key: 'referringDoctorName', label: 'Referring Doctor' },
];

const SIGNATURE_PLACEHOLDERS = [
  { key: 'approverName', label: 'Approver Name', required: true },
  { key: 'approverSignature', label: 'Signature Image', required: false },
  { key: 'approverRole', label: 'Approver Role', required: false },
  { key: 'approvedAtFormatted', label: 'Approved At', required: false },
];

const VARIANT_LABELS: Record<string, string> = {
  value: 'Value',
  unit: 'Unit',
  reference: 'Ref Range',
  flag: 'Flag',
  method: 'Method',
};

const AI_ENDPOINT =
  (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_TEMPLATE_AI_ENDPOINT) ||
  '/.netlify/functions/template-editor';

// ─── Helpers ───────────────────────────────────────────────────────────────────

function extractPlaceholdersFromHtml(html: string): Set<string> {
  const re = /{{\s*([\w.]+)\s*}}/g;
  const found = new Set<string>();
  let m;
  while ((m = re.exec(html)) !== null) {
    found.add(m[1].trim());
  }
  return found;
}

function buildAnalyteGroups(options: PlaceholderOption[]): AnalyteGroup[] {
  const testOptions = options.filter((o) => o.group === 'test');
  const map = new Map<string, AnalyteGroup>();

  const SUFFIXES = ['_VALUE', '_UNIT', '_REFERENCE', '_REF_RANGE', '_FLAG', '_METHOD'] as const;
  type Suffix = typeof SUFFIXES[number];
  const SUFFIX_TO_KEY: Record<Suffix, keyof Omit<AnalyteGroup, 'code' | 'label'>> = {
    '_VALUE': 'value',
    '_UNIT': 'unit',
    '_REFERENCE': 'reference',
    '_REF_RANGE': 'reference',
    '_FLAG': 'flag',
    '_METHOD': 'method',
  };

  testOptions.forEach((opt) => {
    // Extract inner key from {{ANALYTE_WBC_VALUE}}
    const inner = opt.placeholder.replace(/^\{\{|\}\}$/g, '').trim();
    let base = inner;
    let variantKey: keyof Omit<AnalyteGroup, 'code' | 'label'> | null = null;

    for (const suf of SUFFIXES) {
      if (inner.endsWith(suf)) {
        base = inner.slice(0, inner.length - suf.length);
        variantKey = SUFFIX_TO_KEY[suf];
        break;
      }
    }

    if (!map.has(base)) {
      let label = opt.label;
      // Strip variant suffix from label
      label = label
        .replace(/ \(Value\)$/i, '').replace(/ \(Unit\)$/i, '').replace(/ \(Reference\)$/i, '')
        .replace(/ \(Flag\)$/i, '').replace(/ \(Method\)$/i, '').replace(/ \(Ref.*\)$/i, '');
      map.set(base, { code: base, label, value: undefined, unit: undefined, reference: undefined, flag: undefined, method: undefined });
    }

    const g = map.get(base)!;
    if (variantKey === null) {
      g.value = opt.placeholder;
      g.label = opt.label; // value option has best label
    } else {
      (g as any)[variantKey] = opt.placeholder;
    }
  });

  return Array.from(map.values());
}

// ─── Main ──────────────────────────────────────────────────────────────────────

const CompletenessModal: React.FC<CompletenessModalProps> = ({
  open,
  onClose,
  editor,
  placeholderOptions,
  labId,
  templateName = 'Template',
  onInsert,
}) => {
  const [coverage, setCoverage] = useState<CoverageResult | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiApplied, setAiApplied] = useState(false);
  const [pendingHtml, setPendingHtml] = useState<string | null>(null);
  const [pendingCss, setPendingCss] = useState<string | null>(null);

  const analyteGroups = useMemo(() => buildAnalyteGroups(placeholderOptions), [placeholderOptions]);

  const runCheck = useCallback(() => {
    setCoverage(null);
    setAiError(null);
    setAiSummary(null);
    setPendingHtml(null);
    setPendingCss(null);
    setAiApplied(false);

    const html = editor?.getHtml?.() || '';
    const found = extractPlaceholdersFromHtml(html);

    // Analyte coverage
    const analyteCoverage: AnalyteCoverage[] = analyteGroups.map((ag) => {
      const variants = (
        [
          { key: 'value' as const, placeholder: ag.value },
          { key: 'unit' as const, placeholder: ag.unit },
          { key: 'reference' as const, placeholder: ag.reference },
          { key: 'flag' as const, placeholder: ag.flag },
          { key: 'method' as const, placeholder: ag.method },
        ] as Array<{ key: 'value' | 'unit' | 'reference' | 'flag' | 'method'; placeholder?: string }>
      )
        .filter((v) => v.placeholder !== undefined)
        .map((v) => {
          const inner = v.placeholder!.replace(/^\{\{|\}\}$/g, '').trim();
          return {
            key: v.key,
            label: VARIANT_LABELS[v.key],
            placeholder: v.placeholder!,
            present: found.has(inner),
          };
        });

      return { label: ag.label, code: ag.code, variants };
    });

    // Patient coverage
    const patientPresent: string[] = [];
    const patientMissing: string[] = [];
    PATIENT_PLACEHOLDERS.forEach(({ key, label }) => {
      if (found.has(key)) patientPresent.push(label);
      else patientMissing.push(`{{${key}}}`);
    });

    // Signature coverage
    const signaturePresent: string[] = [];
    const signatureMissing: string[] = [];
    SIGNATURE_PLACEHOLDERS.forEach(({ key, label }) => {
      if (found.has(key)) signaturePresent.push(label);
      else signatureMissing.push(`{{${key}}}`);
    });

    // Totals
    let totalPresent = 0;
    let totalPossible = 0;
    analyteCoverage.forEach((a) => {
      totalPresent += a.variants.filter((v) => v.present).length;
      totalPossible += a.variants.length;
    });
    totalPresent += patientPresent.length + signaturePresent.length;
    totalPossible += PATIENT_PLACEHOLDERS.length + SIGNATURE_PLACEHOLDERS.length;

    setCoverage({ analyteGroups: analyteCoverage, patientMissing, patientPresent, signatureMissing, signaturePresent, totalPresent, totalPossible });
  }, [editor, analyteGroups]);

  useEffect(() => {
    if (open) runCheck();
  }, [open, runCheck]);

  const copyPlaceholder = async (ph: string) => {
    try {
      await navigator.clipboard.writeText(ph);
      setCopiedKey(ph);
      setTimeout(() => setCopiedKey(null), 1500);
    } catch { /* ignore */ }
  };

  const handleAskAI = async () => {
    if (!coverage || !editor) return;
    setAiLoading(true);
    setAiError(null);
    setAiSummary(null);

    const missingAnalytes = coverage.analyteGroups
      .flatMap((a) => a.variants.filter((v) => !v.present).map((v) => v.placeholder))
      .join(', ');
    const missingPatient = coverage.patientMissing.join(', ');
    const missingSig = coverage.signatureMissing.join(', ');

    const missingList = [missingAnalytes, missingPatient, missingSig].filter(Boolean).join(', ');
    if (!missingList) { setAiLoading(false); return; }

    const instruction = `Insert the following missing placeholders into the template at appropriate locations. Do not remove any existing placeholders. Missing: ${missingList}`;
    const currentHtml = editor.getHtml?.() || '';
    const currentCss = editor.getCss?.() || '';

    try {
      const res = await fetch(AI_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateName,
          labId,
          instruction,
          prompt: instruction,
          currentHtml,
          currentCss,
          html: currentHtml,
          css: currentCss,
          history: [],
        }),
      });
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (!res.ok) throw new Error(data?.error || 'AI request failed');
      if (!data.html) throw new Error('AI returned no HTML');
      setPendingHtml(data.html);
      setPendingCss(data.css || null);
      setAiSummary(data.summary || `AI added ${missingList}`);
    } catch (err: any) {
      setAiError(err.message || 'Unexpected error');
    } finally {
      setAiLoading(false);
    }
  };

  const handleApplyAI = () => {
    if (!editor || !pendingHtml) return;
    editor.setComponents?.(pendingHtml);
    if (pendingCss !== null && typeof editor.setStyle === 'function') editor.setStyle(pendingCss);
    setAiApplied(true);
    setPendingHtml(null);
    setPendingCss(null);
    runCheck(); // re-run coverage after apply
  };

  if (!open) return null;

  const pct = coverage ? Math.round((coverage.totalPresent / Math.max(coverage.totalPossible, 1)) * 100) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="relative flex w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3 shrink-0">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-indigo-500" />
            <h2 className="text-sm font-semibold text-gray-900">Check Completeness</h2>
            {coverage && (
              <span className={clsx(
                'ml-2 rounded-full px-2 py-0.5 text-[11px] font-medium',
                pct >= 80 ? 'bg-emerald-100 text-emerald-700' : pct >= 50 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'
              )}>
                {coverage.totalPresent}/{coverage.totalPossible} placeholders ({pct}%)
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={runCheck} className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors" title="Re-run check">
              <RefreshCcw className="h-3.5 w-3.5" />
            </button>
            <button onClick={onClose} className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {!coverage && (
            <div className="flex items-center justify-center py-12 text-sm text-gray-400">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Analyzing template…
            </div>
          )}

          {coverage && (
            <>
              {/* AI Actions */}
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                <p className="text-xs text-gray-600 flex-1 min-w-0">
                  {coverage.totalPresent === coverage.totalPossible
                    ? '✓ Template is complete — all expected placeholders are present.'
                    : `${coverage.totalPossible - coverage.totalPresent} placeholder(s) missing.`}
                </p>
                {coverage.totalPresent < coverage.totalPossible && (
                  <button
                    onClick={handleAskAI}
                    disabled={aiLoading}
                    className="flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {aiLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                    {aiLoading ? 'Asking AI…' : 'Ask AI to insert missing'}
                  </button>
                )}
                {pendingHtml && (
                  <button
                    onClick={handleApplyAI}
                    className="flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
                  >
                    <Check className="h-3.5 w-3.5" /> Apply AI fix
                  </button>
                )}
              </div>

              {aiError && (
                <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {aiError}
                </div>
              )}
              {aiSummary && !pendingHtml && (
                <div className="rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-800">
                  {aiApplied ? '✓ AI changes applied. ' : ''}{aiSummary}
                </div>
              )}
              {pendingHtml && aiSummary && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  AI preview ready: {aiSummary} — click "Apply AI fix" above to apply.
                </div>
              )}

              {/* Analyte Coverage */}
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Analyte Coverage ({coverage.analyteGroups.length} analytes)
                </h3>
                {coverage.analyteGroups.length === 0 ? (
                  <p className="text-xs text-gray-400">No analyte placeholders available for this template's test group.</p>
                ) : (
                  <div className="space-y-2">
                    {coverage.analyteGroups.map((ag) => {
                      const allPresent = ag.variants.every((v) => v.present);
                      const missing = ag.variants.filter((v) => !v.present);
                      return (
                        <div key={ag.code} className={clsx(
                          'rounded-lg border px-3 py-2',
                          allPresent ? 'border-emerald-200 bg-emerald-50' : missing.length === ag.variants.length ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'
                        )}>
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <span className={clsx('text-xs font-medium', allPresent ? 'text-emerald-800' : 'text-gray-800')}>
                              {ag.label}
                            </span>
                            <div className="flex items-center gap-1 flex-wrap">
                              {ag.variants.map((v) => (
                                <span
                                  key={v.key}
                                  className={clsx(
                                    'rounded px-1.5 py-0.5 text-[10px] font-medium',
                                    v.key === 'value' ? v.present ? 'bg-blue-200 text-blue-800' : 'bg-blue-100 text-blue-400 line-through opacity-60' :
                                    v.key === 'unit' ? v.present ? 'bg-purple-200 text-purple-800' : 'bg-purple-100 text-purple-400 line-through opacity-60' :
                                    v.key === 'reference' ? v.present ? 'bg-amber-200 text-amber-800' : 'bg-amber-100 text-amber-400 line-through opacity-60' :
                                    v.key === 'flag' ? v.present ? 'bg-rose-200 text-rose-800' : 'bg-rose-100 text-rose-400 line-through opacity-60' :
                                    v.present ? 'bg-teal-200 text-teal-800' : 'bg-teal-100 text-teal-400 line-through opacity-60'
                                  )}
                                  title={v.present ? `${v.placeholder} — present` : `${v.placeholder} — missing`}
                                >
                                  {v.present ? '✓' : '✗'} {v.label}
                                </span>
                              ))}
                            </div>
                          </div>
                          {/* Missing placeholder chips with copy */}
                          {missing.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {missing.map((v) => (
                                <button
                                  key={v.key}
                                  onClick={() => copyPlaceholder(v.placeholder)}
                                  className="flex items-center gap-1 rounded border border-gray-300 bg-white px-2 py-0.5 text-[10px] text-gray-700 hover:bg-gray-50 transition-colors"
                                  title="Click to copy"
                                >
                                  {copiedKey === v.placeholder
                                    ? <Check className="h-2.5 w-2.5 text-emerald-500" />
                                    : <ClipboardCopy className="h-2.5 w-2.5 text-gray-400" />}
                                  <code>{v.placeholder}</code>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* Patient / Order */}
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Patient &amp; Order Info</h3>
                <div className={clsx('rounded-lg border px-3 py-2', coverage.patientMissing.length === 0 ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50')}>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {PATIENT_PLACEHOLDERS.map(({ key, label }) => {
                      const present = coverage.patientPresent.includes(label);
                      return (
                        <span key={key} className={clsx('rounded px-1.5 py-0.5 text-[10px] font-medium', present ? 'bg-emerald-200 text-emerald-800' : 'bg-gray-100 text-gray-400')}>
                          {present ? '✓' : '✗'} {label}
                        </span>
                      );
                    })}
                  </div>
                  {coverage.patientMissing.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {coverage.patientMissing.map((ph) => (
                        <button
                          key={ph}
                          onClick={() => copyPlaceholder(ph)}
                          className="flex items-center gap-1 rounded border border-gray-300 bg-white px-2 py-0.5 text-[10px] text-gray-700 hover:bg-gray-50"
                          title="Click to copy"
                        >
                          {copiedKey === ph ? <Check className="h-2.5 w-2.5 text-emerald-500" /> : <ClipboardCopy className="h-2.5 w-2.5 text-gray-400" />}
                          <code>{ph}</code>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </section>

              {/* Signature */}
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Signature &amp; Approval</h3>
                <div className={clsx('rounded-lg border px-3 py-2', coverage.signatureMissing.length === 0 ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50')}>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {SIGNATURE_PLACEHOLDERS.map(({ key, label, required }) => {
                      const present = coverage.signaturePresent.includes(label);
                      return (
                        <span key={key} className={clsx('rounded px-1.5 py-0.5 text-[10px] font-medium', present ? 'bg-emerald-200 text-emerald-800' : required ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-400')}>
                          {present ? '✓' : required ? '✗' : '–'} {label}{required ? '' : ' (optional)'}
                        </span>
                      );
                    })}
                  </div>
                  {coverage.signatureMissing.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {coverage.signatureMissing.map((ph) => (
                        <button
                          key={ph}
                          onClick={() => copyPlaceholder(ph)}
                          className="flex items-center gap-1 rounded border border-gray-300 bg-white px-2 py-0.5 text-[10px] text-gray-700 hover:bg-gray-50"
                          title="Click to copy"
                        >
                          {copiedKey === ph ? <Check className="h-2.5 w-2.5 text-emerald-500" /> : <ClipboardCopy className="h-2.5 w-2.5 text-gray-400" />}
                          <code>{ph}</code>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-gray-200 bg-gray-50 px-5 py-3 shrink-0">
          <p className="text-[11px] text-gray-400">Click any missing placeholder to copy it. Right-click → paste in editor.</p>
          <button onClick={onClose} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">Close</button>
        </div>
      </div>
    </div>
  );
};

export default CompletenessModal;
