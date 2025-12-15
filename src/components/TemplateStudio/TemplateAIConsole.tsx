import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Sparkles, Send, RefreshCcw, AlertTriangle } from 'lucide-react';
import clsx from 'clsx';

interface TemplateAIConsoleProps {
  open: boolean;
  onClose: () => void;
  editor: any | null;
  templateName: string;
  labId: string;
  onApplied?: () => void;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  ts: number;
}

interface GeminiTemplateEditResponse {
  html?: string;
  css?: string;
  summary?: string;
  warnings?: string[];
}

interface TemplateAIRequestPayload {
  templateName: string;
  instruction: string;
  currentHtml: string;
  currentCss: string;
  labContext: string;
  prompt: string;
  html: string;
  css: string;
  labId: string;
  history: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;
}

const initialSystemMessage: ChatMessage = {
  id: 'system-intro',
  role: 'system',
  ts: Date.now(),
  content: `You are the Template Studio AI assistant. You help refine lab report HTML templates.
- Always return HTML that is safe for GrapesJS (no scripts, inline event handlers, or external assets).
- Keep existing double-curly variables like {{patientName}} intact.
- Preserve the semantic layout and only adjust what the user requests.
- If the request is ambiguous, ask for clarification instead of guessing.`,
};

const formatTimestamp = (ts: number) => new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
}).format(ts);

const STOP_GUARD_RISKY_PATTERNS: RegExp[] = [
  /<script/i,
  /onload\s*=/i,
  /onerror\s*=/i,
  /javascript:/i,
  /<iframe/i,
];

function containsRiskyMarkup(html?: string): boolean {
  if (!html) return false;
  return STOP_GUARD_RISKY_PATTERNS.some((regex) => regex.test(html));
}

function validatePlaceholders(originalHtml: string, candidateHtml: string): { ok: boolean; missing: string[] } {
  if (!originalHtml) {
    return { ok: true, missing: [] };
  }

  const placeholderRegex = /{{\s*[\w.]+\s*}}/g;
  const originalPlaceholders = new Set<string>(originalHtml.match(placeholderRegex) || []);

  if (!originalPlaceholders.size) {
    return { ok: true, missing: [] };
  }

  const candidatePlaceholders = new Set<string>(candidateHtml.match(placeholderRegex) || []);
  const missing: string[] = [];

  originalPlaceholders.forEach((ph) => {
    if (!candidatePlaceholders.has(ph)) {
      missing.push(ph);
    }
  });

  return { ok: missing.length === 0, missing };
}

const TemplateAIConsole: React.FC<TemplateAIConsoleProps> = ({
  open,
  onClose,
  editor,
  templateName,
  labId,
  onApplied,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([initialSystemMessage]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appliedHtmlSnapshot, setAppliedHtmlSnapshot] = useState<string | null>(null);
  const [appliedCssSnapshot, setAppliedCssSnapshot] = useState<string | null>(null);
  const [pendingResponse, setPendingResponse] = useState<GeminiTemplateEditResponse | null>(null);

  const [lastHtmlBeforeAI, setLastHtmlBeforeAI] = useState<string | null>(null);
  const [lastCssBeforeAI, setLastCssBeforeAI] = useState<string | null>(null);

  const contentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open) {
      setTimeout(() => {
        contentRef.current?.scrollTo({ top: contentRef.current.scrollHeight, behavior: 'smooth' });
      }, 100);
    }
  }, [open, messages.length]);

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!input.trim() || !editor || isLoading) {
        return;
      }

  const prompt = input.trim();
      setInput('');
      setError(null);

      const currentHtml = editor?.getHtml?.() || '';
      const currentCss = editor?.getCss?.() || '';

      setLastHtmlBeforeAI(currentHtml);
      setLastCssBeforeAI(currentCss);

      const userMessage: ChatMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: prompt,
        ts: Date.now(),
      };

      setMessages((prev) => [...prev, userMessage]);
      setIsLoading(true);

      try {
        const endpoint = import.meta.env.VITE_TEMPLATE_AI_ENDPOINT || '/.netlify/functions/template-editor';
        const conversationHistory = [...messages.filter((msg) => msg.role !== 'system'), userMessage];
        const requestPayload: TemplateAIRequestPayload = {
          templateName,
          instruction: prompt,
          currentHtml,
          currentCss,
          labContext: labId,
          prompt,
          html: currentHtml,
          css: currentCss,
          labId,
          history: conversationHistory.slice(-6).map((msg) => ({
            role: msg.role,
            content: msg.content,
          })),
        };
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestPayload),
        });

        const responseText = await res.text();
        let data: GeminiTemplateEditResponse;
        try {
          data = responseText ? (JSON.parse(responseText) as GeminiTemplateEditResponse) : {};
        } catch (parseErr) {
          throw new Error(`AI service returned invalid JSON (${(parseErr as Error).message})`);
        }
        if (!res.ok) {
          if (res.status === 404) {
            throw new Error('AI endpoint not found. Run `netlify dev` or set VITE_TEMPLATE_AI_ENDPOINT to a reachable service.');
          }
          throw new Error((data as any)?.error || responseText || 'AI request failed');
        }

        if (!data || (!data.html && !data.summary)) {
          throw new Error('AI response did not include any content.');
        }

        const aiData: GeminiTemplateEditResponse = data;
        setPendingResponse(aiData);

        const assistantContent = aiData.summary
          ? `${aiData.summary}${aiData.warnings?.length ? `\n\nWarnings:\n- ${aiData.warnings.join('\n- ')}` : ''}`
          : 'Preview generated. Review and apply if satisfied.';

        const assistantMessage: ChatMessage = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: assistantContent,
          ts: Date.now(),
        };
        setMessages((prev) => [...prev, assistantMessage]);
      } catch (err) {
        console.error('AI template edit failed:', err);
        setError(err instanceof Error ? err.message : 'Unexpected error communicating with AI service');
      } finally {
        setIsLoading(false);
      }
    },
    [editor, input, isLoading, labId, messages, templateName]
  );

  const handleApply = useCallback(() => {
    if (!editor || !pendingResponse) {
      return;
    }

    const nextHtml = pendingResponse.html ?? '';
    const nextCss = pendingResponse.css ?? '';

    if (containsRiskyMarkup(nextHtml)) {
      setError('AI response blocked: HTML contains risky markup (scripts or inline handlers).');
      return;
    }

    const placeholderCheck = validatePlaceholders(lastHtmlBeforeAI || '', nextHtml);
    if (!placeholderCheck.ok) {
      // Show warning but don't block - user can decide whether to apply
      setError(`⚠️ Warning: AI response missing placeholders: ${placeholderCheck.missing.join(', ')}. Changes will be applied anyway.`);
      // Continue with application instead of returning
    }

    try {
      if (nextHtml) {
        editor.setComponents(nextHtml);
      }
      if (typeof editor.setStyle === 'function') {
        editor.setStyle(nextCss || '');
      }

      setAppliedHtmlSnapshot(nextHtml);
      setAppliedCssSnapshot(nextCss);
      setPendingResponse(null);
      setError(null);

      if (typeof onApplied === 'function') {
        onApplied();
      }
    } catch (applyErr) {
      console.error('Failed to inject AI HTML into editor:', applyErr);
      setError('Unable to apply AI changes to the editor. Please try again.');
    }
  }, [editor, lastHtmlBeforeAI, onApplied, pendingResponse]);

  const handleRevert = useCallback(() => {
    if (!editor) {
      return;
    }

    try {
      if (lastHtmlBeforeAI !== null) {
        editor.setComponents(lastHtmlBeforeAI);
      }
      if (typeof editor.setStyle === 'function') {
        editor.setStyle(lastCssBeforeAI || '');
      }

      setAppliedHtmlSnapshot(null);
      setAppliedCssSnapshot(null);
      setPendingResponse(null);
      setError(null);
    } catch (revertErr) {
      console.error('Failed to revert AI changes:', revertErr);
      setError('Unable to revert AI changes.');
    }
  }, [editor, lastCssBeforeAI, lastHtmlBeforeAI]);

  const aiEnabled = useMemo(() => !!editor, [editor]);

  return (
    <aside
      className={clsx(
        'fixed right-0 top-0 z-[9999] h-full w-full max-w-md transform bg-white shadow-xl transition-transform duration-300 ease-out',
        open ? 'translate-x-0' : 'translate-x-full'
      )}
      style={{ pointerEvents: open ? 'auto' : 'none' }}
    >
      <div className="flex h-full max-h-screen flex-col border-l border-gray-200">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-gray-50 px-4 py-3 shrink-0">
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-gray-900 truncate">Template Assistant</h2>
            <p className="text-xs text-gray-600 truncate">AI editing for {templateName}</p>
          </div>
          <button
            onClick={onClose}
            className="ml-3 shrink-0 rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 hover:border-gray-400 transition-colors"
            aria-label="Close assistant"
          >
            Close
          </button>
        </header>

        {!aiEnabled && (
          <div className="flex flex-1 items-center justify-center px-4">
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-center text-xs text-amber-700">
              AI editing is unavailable because the editor is not ready yet.
            </div>
          </div>
        )}

        {aiEnabled && (
          <>
            <div ref={contentRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3 max-h-[calc(100vh-280px)]">
                  {messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={clsx('max-w-[90%] rounded-lg px-3 py-2 text-xs shadow-sm', {
                        'ml-auto bg-blue-600 text-white': msg.role === 'user',
                        'bg-gray-100 text-gray-800': msg.role !== 'user',
                      })}
                    >
                      <div className="flex justify-between gap-2">
                        <span className="font-medium capitalize">{msg.role}</span>
                        <span className="text-[10px] opacity-70">{formatTimestamp(msg.ts)}</span>
                      </div>
                      <div className="mt-1 whitespace-pre-wrap leading-relaxed">{msg.content}</div>
                    </div>
                  ))}

                  {pendingResponse?.html && (
                    <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800">
                      <div className="flex items-center gap-2 font-medium">
                        <Sparkles className="h-3 w-3" /> AI preview ready
                      </div>
                      <p className="mt-2 text-[11px] text-blue-700">
                        Review the preview by applying it to the canvas. You can revert if needed.
                      </p>
                      {pendingResponse.warnings?.length ? (
                        <ul className="mt-2 list-disc space-y-1 pl-4 text-[11px] text-amber-700">
                          {pendingResponse.warnings.map((warning, idx) => (
                            <li key={idx}>{warning}</li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  )}

                  {appliedHtmlSnapshot && (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700">
                      <div className="flex items-center gap-2 font-medium">
                        <RefreshCcw className="h-3 w-3" /> AI changes applied
                      </div>
                      <p className="mt-2 text-[11px]">
                        The AI edits are now on the canvas. Continue editing or revert if something looks off.
                      </p>
                    </div>
                  )}
                </div>

                <footer className="border-t border-gray-200 bg-white px-4 py-3">
                  {error && (
                    <div className="mb-2 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5" />
                      <span>{error}</span>
                    </div>
                  )}
                  <form onSubmit={handleSubmit} className="space-y-2">
                    <textarea
                      value={input}
                      onChange={(event) => setInput(event.target.value)}
                      placeholder="Describe the update you want (e.g., 'Add hospital logo placeholder at the top')"
                      className="h-20 w-full resize-none rounded-md border border-gray-300 px-3 py-2 text-xs focus:border-blue-500 focus:outline-none focus:ring-0"
                    />
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-[11px] text-gray-500">
                        <Sparkles className="h-3 w-3" /> Gemini empowered
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={handleRevert}
                          disabled={lastHtmlBeforeAI === null || isLoading}
                          className="rounded-md border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Revert
                        </button>
                        <button
                          type="button"
                          onClick={handleApply}
                          disabled={!pendingResponse?.html || isLoading}
                          className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-emerald-400"
                        >
                          Apply Preview
                        </button>
                        <button
                          type="submit"
                          disabled={isLoading || !input.trim()}
                          className="flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-400"
                        >
                          {isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                          <span>{isLoading ? 'Thinking…' : 'Send'}</span>
                        </button>
                      </div>
                    </div>
                  </form>
                </footer>
              </>
            )}
      </div>
    </aside>
  );
};

export default TemplateAIConsole;
