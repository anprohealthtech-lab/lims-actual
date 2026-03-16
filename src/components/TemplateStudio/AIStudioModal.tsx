import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Loader2,
  RefreshCcw,
  Send,
  Sparkles,
  Upload,
  X,
  Wand2,
  PenLine,
} from 'lucide-react';
import clsx from 'clsx';
import { supabase } from '../../utils/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

type StudioTab = 'create' | 'edit' | 'upload';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  ts: number;
}

interface AIEditResponse {
  html?: string;
  css?: string;
  summary?: string;
  warnings?: string[];
}

interface Analyte {
  id: string;
  name: string;
  code: string;
  unit?: string | null;
  reference_range?: string | null;
}

interface TestGroup {
  id: string;
  name: string;
  category?: string | null;
}

type UploadStep = 'select-group' | 'upload' | 'processing' | 'result';

// ─── Security helpers ─────────────────────────────────────────────────────────

const RISKY_PATTERNS = [/<script/i, /onload\s*=/i, /onerror\s*=/i, /javascript:/i, /<iframe/i];
function isRisky(html?: string) {
  return html ? RISKY_PATTERNS.some((r) => r.test(html)) : false;
}
function missingPlaceholders(original: string, candidate: string): string[] {
  const re = /{{\s*[\w.]+\s*}}/g;
  const orig = new Set<string>(original.match(re) || []);
  const cand = new Set<string>(candidate.match(re) || []);
  return [...orig].filter((p) => !cand.has(p));
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface AIStudioModalProps {
  open: boolean;
  onClose: () => void;
  editor: any | null;
  templateName: string;
  labId: string;
  testGroupId?: string;
  onApplied?: () => void;
  onHtmlGenerated: (html: string, matchedAnalytes: string[], notes: string) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

const AI_ENDPOINT =
  (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_TEMPLATE_AI_ENDPOINT) ||
  '/.netlify/functions/template-editor';

const AIStudioModal: React.FC<AIStudioModalProps> = ({
  open,
  onClose,
  editor,
  templateName,
  labId,
  testGroupId,
  onApplied,
  onHtmlGenerated,
}) => {
  const [activeTab, setActiveTab] = useState<StudioTab>('edit');

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="relative flex w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3 shrink-0">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-indigo-500" />
            <h2 className="text-sm font-semibold text-gray-900">AI Studio</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 bg-gray-50 shrink-0">
          {([
            { key: 'create' as StudioTab, label: 'Create New', icon: <Wand2 className="h-3.5 w-3.5" /> },
            { key: 'edit' as StudioTab, label: 'Edit / Style', icon: <PenLine className="h-3.5 w-3.5" /> },
            { key: 'upload' as StudioTab, label: 'From Report', icon: <Upload className="h-3.5 w-3.5" /> },
          ] as const).map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={clsx(
                'flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors',
                activeTab === tab.key
                  ? 'border-indigo-500 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              )}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-hidden">
          {activeTab === 'create' && (
            <CreateNewTab
              editor={editor}
              templateName={templateName}
              labId={labId}
              testGroupId={testGroupId}
              onApplied={onApplied}
            />
          )}
          {activeTab === 'edit' && (
            <EditStyleTab
              editor={editor}
              templateName={templateName}
              labId={labId}
              onApplied={onApplied}
            />
          )}
          {activeTab === 'upload' && (
            <FromReportTab
              labId={labId}
              onHtmlGenerated={(html, matched, notes) => {
                onHtmlGenerated(html, matched, notes);
                onClose();
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
};

// ─── Tab: Create New ──────────────────────────────────────────────────────────

const CreateNewTab: React.FC<{
  editor: any;
  templateName: string;
  labId: string;
  testGroupId?: string;
  onApplied?: () => void;
}> = ({ editor, templateName, labId, testGroupId, onApplied }) => {
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generated, setGenerated] = useState<AIEditResponse | null>(null);

  // Fetch analyte list for context
  const [analyteSummary, setAnalyteSummary] = useState<string>('');
  useEffect(() => {
    if (!testGroupId) return;
    supabase
      .from('test_group_analytes')
      .select('analytes(name, code)')
      .eq('test_group_id', testGroupId)
      .then(({ data }) => {
        if (data && data.length) {
          const names = (data as any[])
            .map((r) => r.analytes?.name)
            .filter(Boolean)
            .join(', ');
          setAnalyteSummary(names);
        }
      });
  }, [testGroupId]);

  const handleGenerate = async () => {
    if (!description.trim()) return;
    setLoading(true);
    setError(null);
    setGenerated(null);

    const instruction = [
      `Create a complete new HTML lab report template called "${templateName}" from scratch.`,
      analyteSummary ? `The test group contains these analytes: ${analyteSummary}.` : '',
      `Use ANALYTE_[CODE]_VALUE, ANALYTE_[CODE]_UNIT, ANALYTE_[CODE]_REFERENCE, ANALYTE_[CODE]_FLAG placeholders for results.`,
      `Additional requirements from user: ${description.trim()}`,
    ]
      .filter(Boolean)
      .join(' ');

    try {
      const res = await fetch(AI_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateName,
          labId,
          instruction,
          prompt: instruction,
          currentHtml: '',
          currentCss: '',
          html: '',
          css: '',
          history: [],
        }),
      });
      const text = await res.text();
      const data: AIEditResponse = text ? JSON.parse(text) : {};
      if (!res.ok) throw new Error((data as any)?.error || 'AI request failed');
      if (!data.html) throw new Error('AI did not return any HTML.');
      setGenerated(data);
    } catch (err: any) {
      setError(err.message || 'Unexpected error');
    } finally {
      setLoading(false);
    }
  };

  const handleApply = () => {
    if (!editor || !generated?.html) return;
    if (isRisky(generated.html)) {
      setError('Blocked: generated HTML contains risky markup.');
      return;
    }
    editor.setComponents?.(generated.html);
    if (generated.css && typeof editor.setStyle === 'function') {
      editor.setStyle(generated.css);
    }
    setGenerated(null);
    setDescription('');
    onApplied?.();
  };

  return (
    <div className="flex flex-col gap-4 p-5 overflow-y-auto max-h-[calc(90vh-120px)]">
      <p className="text-xs text-gray-500">
        Describe the template you want. AI will generate a complete layout with correct analyte
        placeholders for this test group.
      </p>

      {analyteSummary && (
        <div className="rounded-md bg-gray-50 border border-gray-200 px-3 py-2 text-[11px] text-gray-600">
          <span className="font-medium">Analytes available:</span> {analyteSummary}
        </div>
      )}

      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="e.g. A clean CBC report with a header, patient info table, results table with flag colors, and a signature section at the bottom."
        rows={4}
        className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-xs focus:border-indigo-400 focus:outline-none"
      />

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {error}
        </div>
      )}

      {generated?.summary && (
        <div className="rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-800">
          <p className="font-medium">AI summary</p>
          <p className="mt-1">{generated.summary}</p>
          {generated.warnings?.map((w, i) => (
            <p key={i} className="mt-1 text-amber-700">⚠ {w}</p>
          ))}
        </div>
      )}

      <div className="flex justify-end gap-2">
        {generated?.html && (
          <button
            onClick={handleApply}
            className="rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
          >
            Apply to Editor
          </button>
        )}
        <button
          onClick={handleGenerate}
          disabled={loading || !description.trim()}
          className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {loading ? 'Generating…' : generated ? 'Regenerate' : 'Generate Template'}
        </button>
      </div>
    </div>
  );
};

// ─── Tab: Edit / Style ────────────────────────────────────────────────────────

const EditStyleTab: React.FC<{
  editor: any;
  templateName: string;
  labId: string;
  onApplied?: () => void;
}> = ({ editor, templateName, labId, onApplied }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<AIEditResponse | null>(null);
  const [snapshotHtml, setSnapshotHtml] = useState<string | null>(null);
  const [snapshotCss, setSnapshotCss] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !editor || loading) return;

    const prompt = input.trim();
    setInput('');
    setError(null);

    const currentHtml = editor.getHtml?.() || '';
    const currentCss = editor.getCss?.() || '';
    setSnapshotHtml(currentHtml);
    setSnapshotCss(currentCss);

    const userMsg: ChatMessage = { id: `u-${Date.now()}`, role: 'user', content: prompt, ts: Date.now() };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    try {
      const res = await fetch(AI_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateName,
          labId,
          instruction: prompt,
          prompt,
          currentHtml,
          currentCss,
          html: currentHtml,
          css: currentCss,
          history: [...messages, userMsg].slice(-6).map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      const text = await res.text();
      const data: AIEditResponse = text ? JSON.parse(text) : {};
      if (!res.ok) throw new Error((data as any)?.error || 'AI request failed');
      if (!data.html && !data.summary) throw new Error('AI returned no content.');
      setPending(data);
      const aiContent = data.summary || 'Preview ready. Apply when satisfied.';
      setMessages((prev) => [
        ...prev,
        { id: `a-${Date.now()}`, role: 'assistant', content: aiContent, ts: Date.now() },
      ]);
    } catch (err: any) {
      setError(err.message || 'Unexpected error');
    } finally {
      setLoading(false);
    }
  };

  const handleApply = () => {
    if (!editor || !pending) return;
    if (isRisky(pending.html)) {
      setError('Blocked: HTML contains risky markup.');
      return;
    }
    const missing = missingPlaceholders(snapshotHtml || '', pending.html || '');
    if (missing.length) {
      setError(`⚠ Warning: these placeholders were removed: ${missing.join(', ')}. Applied anyway.`);
    }
    if (pending.html) editor.setComponents?.(pending.html);
    if (typeof editor.setStyle === 'function') editor.setStyle(pending.css || '');
    setPending(null);
    onApplied?.();
  };

  const handleRevert = () => {
    if (!editor || snapshotHtml === null) return;
    editor.setComponents?.(snapshotHtml);
    if (typeof editor.setStyle === 'function') editor.setStyle(snapshotCss || '');
    setPending(null);
    setError(null);
  };

  return (
    <div className="flex flex-col h-full max-h-[calc(90vh-120px)]">
      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-3 px-4 py-3">
        {messages.length === 0 && (
          <p className="text-xs text-gray-400 text-center py-4">
            Describe a styling or layout change. AI will modify the current template.
          </p>
        )}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={clsx(
              'max-w-[88%] rounded-lg px-3 py-2 text-xs',
              msg.role === 'user' ? 'ml-auto bg-indigo-600 text-white' : 'bg-gray-100 text-gray-800'
            )}
          >
            <div className="whitespace-pre-wrap leading-relaxed">{msg.content}</div>
          </div>
        ))}
        {pending?.html && (
          <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-800">
            <Sparkles className="inline h-3 w-3 mr-1" /> Preview ready — apply or revert below.
            {pending.warnings?.map((w, i) => (
              <p key={i} className="mt-1 text-amber-700">⚠ {w}</p>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-gray-200 px-4 py-3 shrink-0">
        {error && (
          <div className="mb-2 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {error}
          </div>
        )}
        <form onSubmit={handleSend} className="space-y-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="e.g. Make the header background dark blue with white text"
            rows={2}
            className="w-full resize-none rounded-md border border-gray-300 px-3 py-2 text-xs focus:border-indigo-400 focus:outline-none"
          />
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={handleRevert}
              disabled={snapshotHtml === null || loading}
              className="rounded-md border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:bg-gray-100 disabled:opacity-40"
            >
              <RefreshCcw className="inline h-3 w-3 mr-1" />Revert
            </button>
            {pending?.html && (
              <button
                type="button"
                onClick={handleApply}
                disabled={loading}
                className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                Apply
              </button>
            )}
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="flex items-center gap-1 rounded-md bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              {loading ? 'Thinking…' : 'Send'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ─── Tab: From Report (Upload) ────────────────────────────────────────────────

const FromReportTab: React.FC<{
  labId: string;
  onHtmlGenerated: (html: string, matchedAnalytes: string[], notes: string) => void;
}> = ({ labId, onHtmlGenerated }) => {
  const [step, setStep] = useState<UploadStep>('select-group');
  const [testGroups, setTestGroups] = useState<TestGroup[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [selectedGroup, setSelectedGroup] = useState<TestGroup | null>(null);
  const [analytes, setAnalytes] = useState<Analyte[]>([]);
  const [analytesLoading, setAnalytesLoading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    html: string; matchedAnalytes: string[]; unmatchedTests: string[]; notes: string;
  } | null>(null);

  useEffect(() => {
    if (!labId) return;
    setGroupsLoading(true);
    supabase
      .from('test_groups')
      .select('id, name, category')
      .eq('lab_id', labId)
      .eq('is_active', true)
      .order('name')
      .then(({ data, error: err }) => {
        if (!err) setTestGroups(data || []);
        setGroupsLoading(false);
      });
  }, [labId]);

  useEffect(() => {
    if (!selectedGroupId) { setAnalytes([]); return; }
    setAnalytesLoading(true);
    supabase
      .from('test_group_analytes')
      .select('analytes(id, name, code, unit, reference_range)')
      .eq('test_group_id', selectedGroupId)
      .then(({ data }) => {
        const list: Analyte[] = (data || [])
          .map((r: any) => r.analytes)
          .filter((a: any) => a?.id)
          .map((a: any) => ({
            id: a.id, name: a.name,
            code: a.code || a.name.replace(/\s+/g, '_').toUpperCase(),
            unit: a.unit, reference_range: a.reference_range,
          }));
        setAnalytes(list);
        setAnalytesLoading(false);
      });
  }, [selectedGroupId]);

  const handleFile = useCallback((f: File) => {
    const valid = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'application/pdf'];
    if (!valid.includes(f.type)) { setError('PNG, JPEG, WebP or PDF only'); return; }
    if (f.size > 10 * 1024 * 1024) { setError('Max 10MB'); return; }
    setFile(f); setError(null);
    if (f.type.startsWith('image/')) {
      const r = new FileReader();
      r.onload = (e) => setPreview(e.target?.result as string);
      r.readAsDataURL(f);
    } else {
      setPreview(null);
    }
  }, []);

  const handleProcess = async () => {
    if (!file || !selectedGroup || !analytes.length) return;
    setStep('processing'); setProcessing(true); setError(null);
    try {
      const base64 = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res((r.result as string).split(',')[1]);
        r.onerror = rej;
        r.readAsDataURL(file);
      });
      const resp = await fetch('/.netlify/functions/report-to-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: base64, mimeType: file.type, analytes, testGroupName: selectedGroup.name }),
      });
      if (!resp.ok) {
        const d = await resp.json().catch(() => ({}));
        throw new Error(d.error || `Server error ${resp.status}`);
      }
      const data = await resp.json();
      if (!data.success) throw new Error(data.error || 'Failed to process');
      setResult({ html: data.html, matchedAnalytes: data.matchedAnalytes || [], unmatchedTests: data.unmatchedTests || [], notes: data.notes || '' });
      setStep('result');
    } catch (err: any) {
      setError(err.message || 'Failed'); setStep('upload');
    } finally {
      setProcessing(false);
    }
  };

  const STEPS: UploadStep[] = ['select-group', 'upload', 'processing', 'result'];

  return (
    <div className="flex flex-col max-h-[calc(90vh-120px)] overflow-y-auto">
      {/* Step bar */}
      <div className="flex items-center gap-2 px-5 py-3 border-b border-gray-100 shrink-0">
        {STEPS.map((s, i) => (
          <React.Fragment key={s}>
            <div className={clsx(
              'flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-medium',
              step === s ? 'bg-indigo-600 text-white'
                : i < STEPS.indexOf(step) ? 'bg-emerald-500 text-white'
                : 'bg-gray-200 text-gray-500'
            )}>
              {i < STEPS.indexOf(step) ? <CheckCircle2 className="h-3.5 w-3.5" /> : i + 1}
            </div>
            {i < 3 && <div className={clsx('h-px flex-1', i < STEPS.indexOf(step) ? 'bg-emerald-400' : 'bg-gray-200')} />}
          </React.Fragment>
        ))}
      </div>

      <div className="flex-1 p-5 space-y-4">
        {error && (
          <div className="flex items-center gap-2 rounded-lg bg-red-50 p-3 text-xs text-red-700">
            <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
          </div>
        )}

        {/* Step 1: Select group */}
        {step === 'select-group' && (
          <div className="space-y-3">
            <p className="text-xs text-gray-500">Choose the test group to map analyte placeholders.</p>
            {groupsLoading ? (
              <div className="flex items-center gap-2 py-4 text-xs text-gray-500"><Loader2 className="h-4 w-4 animate-spin text-indigo-500" /> Loading…</div>
            ) : (
              <select
                value={selectedGroupId}
                onChange={(e) => { setSelectedGroupId(e.target.value); setSelectedGroup(testGroups.find((g) => g.id === e.target.value) || null); }}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-indigo-400 focus:outline-none"
              >
                <option value="">Select a test group…</option>
                {testGroups.map((g) => <option key={g.id} value={g.id}>{g.name}{g.category ? ` (${g.category})` : ''}</option>)}
              </select>
            )}
            {selectedGroupId && (
              analytesLoading
                ? <p className="text-xs text-gray-400">Loading analytes…</p>
                : analytes.length === 0
                ? <p className="text-xs text-amber-600">No analytes found for this group.</p>
                : (
                  <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto rounded-lg border border-gray-200 bg-gray-50 p-3">
                    {analytes.map((a) => (
                      <span key={a.id} className="rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-medium text-indigo-700" title={`Code: ${a.code}`}>{a.name}</span>
                    ))}
                  </div>
                )
            )}
          </div>
        )}

        {/* Step 2: Upload */}
        {step === 'upload' && (
          <div className="space-y-3">
            <div
              onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) handleFile(f); }}
              onDragOver={(e) => e.preventDefault()}
              className={clsx(
                'relative rounded-xl border-2 border-dashed p-8 text-center transition-colors',
                file ? 'border-emerald-300 bg-emerald-50' : 'border-gray-300 bg-gray-50 hover:border-indigo-400'
              )}
            >
              <input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} className="absolute inset-0 cursor-pointer opacity-0" />
              {file ? (
                <div className="space-y-2">
                  {preview ? <img src={preview} alt="preview" className="mx-auto max-h-40 rounded object-contain shadow" /> : <FileText className="mx-auto h-12 w-12 text-indigo-400" />}
                  <p className="text-sm font-medium text-gray-800">{file.name}</p>
                  <p className="text-xs text-gray-400">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                  <button onClick={(e) => { e.stopPropagation(); setFile(null); setPreview(null); }} className="text-xs text-red-500 hover:text-red-700"><X className="inline h-3 w-3" /> Remove</button>
                </div>
              ) : (
                <>
                  <Upload className="mx-auto h-10 w-10 text-gray-300" />
                  <p className="mt-3 text-sm text-gray-600"><span className="font-medium text-indigo-600">Click to upload</span> or drag & drop</p>
                  <p className="text-xs text-gray-400 mt-1">PNG, JPEG, WebP, PDF — max 10MB</p>
                </>
              )}
            </div>
            <div className="rounded-lg bg-gray-100 px-3 py-2 text-xs text-gray-700">
              <span className="font-medium">Group:</span> {selectedGroup?.name} &nbsp;·&nbsp; <span className="font-medium">Analytes:</span> {analytes.length}
            </div>
          </div>
        )}

        {/* Step 3: Processing */}
        {step === 'processing' && (
          <div className="flex flex-col items-center py-10 gap-4">
            <div className="relative h-16 w-16">
              <div className="absolute inset-0 rounded-full border-4 border-indigo-200" />
              <div className="absolute inset-0 animate-spin rounded-full border-4 border-transparent border-t-indigo-600" />
              <Sparkles className="absolute inset-0 m-auto h-7 w-7 text-indigo-500" />
            </div>
            <p className="text-sm font-medium text-gray-800">Analyzing Report…</p>
            <p className="text-xs text-gray-500 text-center max-w-xs">AI is examining the layout and mapping analytes to generate placeholders.</p>
          </div>
        )}

        {/* Step 4: Result */}
        {step === 'result' && result && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
              <CheckCircle2 className="h-4 w-4" />
              <span className="font-medium">Template generated.</span>
              {result.notes && <span className="text-emerald-700">{result.notes}</span>}
            </div>
            {result.matchedAnalytes.length > 0 && (
              <div>
                <p className="text-xs font-medium text-gray-700 mb-1.5">Matched ({result.matchedAnalytes.length})</p>
                <div className="flex flex-wrap gap-1.5">
                  {result.matchedAnalytes.map((c) => <span key={c} className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">{c}</span>)}
                </div>
              </div>
            )}
            {result.unmatchedTests.length > 0 && (
              <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-700">
                <p className="font-medium mb-1">Unmatched tests (no analyte code found):</p>
                <div className="flex flex-wrap gap-1.5">
                  {result.unmatchedTests.map((t, i) => <span key={i} className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px]">{t}</span>)}
                </div>
              </div>
            )}
            <div>
              <p className="text-xs font-medium text-gray-700 mb-1">Generated HTML (preview)</p>
              <div className="rounded-lg border border-gray-200 bg-gray-900 p-3 max-h-48 overflow-auto">
                <pre className="text-[10px] text-gray-300 whitespace-pre-wrap font-mono">
                  {result.html.slice(0, 2000)}{result.html.length > 2000 ? '…' : ''}
                </pre>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer nav */}
      <div className="flex justify-between border-t border-gray-200 px-5 py-3 bg-gray-50 shrink-0">
        <button
          onClick={() => {
            if (step === 'upload') setStep('select-group');
            else if (step === 'result') setStep('upload');
          }}
          disabled={step === 'select-group' || processing}
          className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
        >
          Back
        </button>
        <button
          onClick={() => {
            if (step === 'select-group') {
              if (!selectedGroupId || !analytes.length) { setError('Select a group with analytes'); return; }
              setError(null); setStep('upload');
            } else if (step === 'upload') {
              handleProcess();
            } else if (step === 'result' && result) {
              onHtmlGenerated(result.html, result.matchedAnalytes, result.notes);
            }
          }}
          disabled={
            processing ||
            (step === 'select-group' && (!selectedGroupId || analytesLoading)) ||
            (step === 'upload' && !file)
          }
          className={clsx(
            'rounded-lg px-4 py-1.5 text-xs font-medium text-white transition-colors disabled:opacity-50',
            step === 'result' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-indigo-600 hover:bg-indigo-700'
          )}
        >
          {step === 'select-group' && 'Continue'}
          {step === 'upload' && <><Sparkles className="inline h-3 w-3 mr-1" />Generate</>}
          {step === 'processing' && <><Loader2 className="inline h-3 w-3 mr-1 animate-spin" />Processing…</>}
          {step === 'result' && 'Apply to Editor'}
        </button>
      </div>
    </div>
  );
};

export default AIStudioModal;
