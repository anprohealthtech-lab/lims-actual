import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Sparkles,
  Send,
  Loader2,
  ChevronRight,
  ChevronDown,
  LayoutTemplate,
  User,
  Table2,
  FileText,
  PenTool,
  Plus,
  Copy,
  Wand2,
  RefreshCw,
  X,
} from 'lucide-react';
import clsx from 'clsx';
import {
  TemplateBlock,
  AnalyteInfo,
  QUICK_ACTIONS,
  BLOCKS_BY_CATEGORY,
  generateAnalyteRowBlock,
  generateAllAnalyteRows,
  extractPlaceholders,
} from './templateBlocks';

// ============================================
// TYPES
// ============================================

type PlaceholderGroup = 'lab' | 'test' | 'patient' | 'branding' | 'signature' | 'section';

interface PlaceholderOption {
  id: string;
  label: string;
  placeholder: string;
  unit?: string | null;
  referenceRange?: string | null;
  group?: PlaceholderGroup;
  placeholderBase?: string;
}

interface AnalyteGroup {
  baseName: string;
  baseLabel: string;
  code: string;
  value?: PlaceholderOption;
  unit?: PlaceholderOption;
  reference?: PlaceholderOption;
  flag?: PlaceholderOption;
  note?: PlaceholderOption;
}


interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  ts: number;
  actions?: AIAction[];
}

interface AIAction {
  type: 'insert_html' | 'insert_row' | 'modify_css';
  target?: string;
  html?: string;
  css?: string;
  description: string;
  placeholders?: string[];
}

interface TemplateBuilderSidebarProps {
  open: boolean;
  onClose: () => void;
  editor: any | null;
  templateName: string;
  labId: string;
  testGroupId?: string;
  placeholderOptions: PlaceholderOption[];
  onRefreshPlaceholders?: () => void;
  placeholderLoading?: boolean;
}

// ============================================
// HELPER FUNCTIONS
// ============================================


// ============================================
// COMPONENT
// ============================================

const TemplateBuilderSidebar: React.FC<TemplateBuilderSidebarProps> = ({
  open,
  onClose,
  editor,
  templateName,
  labId,
  testGroupId,
  placeholderOptions,
  onRefreshPlaceholders,
  placeholderLoading,
}) => {
  // Tab state
  const [activeTab, setActiveTab] = useState<'builder' | 'placeholders' | 'ai'>('builder');

  // Builder state
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(['results', 'patient'])
  );
  const [lastInsertedBlock, setLastInsertedBlock] = useState<string | null>(null);

  // Placeholder state
  const [expandedAnalytes, setExpandedAnalytes] = useState<Set<string>>(new Set());
  const [lastAction, setLastAction] = useState<{ type: 'copy' | 'insert'; placeholder: string } | null>(null);

  // AI chat state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [aiInput, setAiInput] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  // Group placeholders by type
  const grouped = useMemo(() => {
    const result: Record<PlaceholderGroup, PlaceholderOption[]> = {
      lab: [],
      test: [],
      patient: [],
      branding: [],
      signature: [],
      section: [],
    };
    placeholderOptions.forEach((option) => {
      const bucket = option.group ?? 'lab';
      result[bucket]?.push(option);
    });
    return result;
  }, [placeholderOptions]);

  // Create analyte groups for test placeholders
  const analyteGroups = useMemo(() => {
    const testOptions = grouped.test;
    const groups: Map<string, AnalyteGroup> = new Map();

    testOptions.forEach((option) => {
      const placeholder = option.placeholder;
      const suffixes = ['_UNIT', '_REFERENCE', '_REF_RANGE', '_FLAG', '_NOTE', '_VALUE'];
      let basePlaceholder = placeholder;
      let variationType: 'value' | 'unit' | 'reference' | 'flag' | 'note' = 'value';

      for (const suffix of suffixes) {
        if (placeholder.toUpperCase().endsWith(suffix + '}}')) {
          basePlaceholder = placeholder.replace(new RegExp(suffix + '}}$', 'i'), '}}');
          if (suffix === '_UNIT') variationType = 'unit';
          else if (suffix === '_REFERENCE' || suffix === '_REF_RANGE') variationType = 'reference';
          else if (suffix === '_FLAG') variationType = 'flag';
          else if (suffix === '_NOTE') variationType = 'note';
          else if (suffix === '_VALUE') variationType = 'value';
          break;
        }
      }

      // Extract code from placeholder like {{ANALYTE_WBC_VALUE}} -> WBC
      const codeMatch = basePlaceholder.match(/\{\{ANALYTE_([A-Z0-9]+)/i);
      const code = codeMatch ? codeMatch[1].toUpperCase() : '';

      if (!groups.has(basePlaceholder)) {
        let baseLabel = option.label
          .replace(/ \(Unit\)$/i, '')
          .replace(/ \(Reference\)$/i, '')
          .replace(/ \(Flag\)$/i, '')
          .replace(/ \(Note\)$/i, '');
        groups.set(basePlaceholder, {
          baseName: basePlaceholder,
          baseLabel,
          code,
        });
      }

      const group = groups.get(basePlaceholder)!;
      group[variationType] = option;

      if (variationType === 'value') {
        group.baseLabel = option.label;
      }
    });

    return Array.from(groups.values());
  }, [grouped.test]);

  // Insert HTML into editor
  const insertHtml = useCallback(
    (html: string) => {
      if (!editor) return;
      try {
        // Get current selection or append to end
        const selected = editor.getSelected?.();
        if (selected && typeof selected.append === 'function') {
          // Parse HTML and append components
          const components = editor.addComponents(html);
          if (components && components.length > 0) {
            editor.select(components[0]);
          }
        } else {
          // Append to wrapper
          const wrapper = editor.getWrapper?.();
          if (wrapper) {
            wrapper.append(html);
          }
        }
      } catch (err) {
        console.error('Failed to insert HTML:', err);
      }
    },
    [editor]
  );

  // Insert a template block
  const insertBlock = useCallback(
    (block: TemplateBlock) => {
      insertHtml(block.html);
      setLastInsertedBlock(block.id);
      setTimeout(() => setLastInsertedBlock(null), 2000);
    },
    [insertHtml]
  );

  // Insert all analyte rows
  const insertAllAnalyteRows = useCallback(() => {
    if (analyteGroups.length === 0) return;

    const analytes: AnalyteInfo[] = analyteGroups.map((ag) => ({
      label: ag.baseLabel,
      code: ag.code,
      defaultUnit: ag.value?.unit || undefined,
      defaultReference: ag.value?.referenceRange || undefined,
    }));

    const rowsHtml = generateAllAnalyteRows(analytes);
    insertHtml(rowsHtml);
    setLastInsertedBlock('all-analytes');
    setTimeout(() => setLastInsertedBlock(null), 2000);
  }, [analyteGroups, insertHtml]);

  // Insert single analyte row
  const insertAnalyteRow = useCallback(
    (analyte: AnalyteGroup) => {
      const block = generateAnalyteRowBlock({
        label: analyte.baseLabel,
        code: analyte.code,
      });
      insertHtml(block.html);
      setLastInsertedBlock(`analyte-${analyte.code}`);
      setTimeout(() => setLastInsertedBlock(null), 2000);
    },
    [insertHtml]
  );

  // Insert placeholder into editor
  const insertPlaceholder = useCallback(
    (option: PlaceholderOption) => {
      if (!editor) return;
      try {
        const rte = editor.RichTextEditor;
        if (rte?.getFocused?.() && typeof rte.insertHTML === 'function') {
          rte.insertHTML(option.placeholder);
        } else {
          // Fallback: insert as text component
          const selected = editor.getSelected?.();
          if (selected && typeof selected.append === 'function') {
            selected.append({ type: 'text', content: option.placeholder });
          }
        }
        setLastAction({ type: 'insert', placeholder: option.placeholder });
        setTimeout(() => setLastAction(null), 1500);
      } catch (err) {
        console.warn('Failed to insert placeholder:', err);
      }
    },
    [editor]
  );

  // Copy placeholder to clipboard
  const copyPlaceholder = useCallback(async (option: PlaceholderOption) => {
    try {
      await navigator.clipboard.writeText(option.placeholder);
      setLastAction({ type: 'copy', placeholder: option.placeholder });
      setTimeout(() => setLastAction(null), 1500);
    } catch (err) {
      console.warn('Failed to copy:', err);
    }
  }, []);

  // Handle AI chat submit
  const handleAISubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!aiInput.trim() || !editor || aiLoading) return;

      const prompt = aiInput.trim();
      setAiInput('');
      setAiError(null);

      const userMessage: ChatMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: prompt,
        ts: Date.now(),
      };
      setMessages((prev) => [...prev, userMessage]);
      setAiLoading(true);

      try {
        const currentHtml = editor.getHtml?.() || '';
        const currentCss = editor.getCss?.() || '';

        // Build placeholder catalog for AI context
        const placeholderCatalog = analyteGroups.map((ag) => ({
          label: ag.baseLabel,
          code: ag.code,
          placeholders: {
            value: `{{ANALYTE_${ag.code}_VALUE}}`,
            unit: `{{ANALYTE_${ag.code}_UNIT}}`,
            reference: `{{ANALYTE_${ag.code}_REFERENCE}}`,
            flag: `{{ANALYTE_${ag.code}_FLAG}}`,
          },
        }));

        const endpoint = import.meta.env.VITE_TEMPLATE_AI_ENDPOINT || '/.netlify/functions/template-editor';

        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            templateName,
            labId,
            prompt,
            instruction: prompt,
            html: currentHtml,
            css: currentCss,
            currentHtml,
            currentCss,
            placeholderCatalog, // NEW: Send available placeholders to AI
            history: messages.slice(-6).map((m) => ({ role: m.role, content: m.content })),
          }),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'AI request failed');
        }

        // Create assistant message
        const assistantMessage: ChatMessage = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: data.summary || 'Changes ready to apply.',
          ts: Date.now(),
          actions: data.html
            ? [
                {
                  type: 'insert_html',
                  html: data.html,
                  css: data.css,
                  description: data.summary || 'Apply AI changes',
                  placeholders: extractPlaceholders(data.html || ''),
                },
              ]
            : undefined,
        };

        setMessages((prev) => [...prev, assistantMessage]);

        // Auto-apply if AI returned HTML
        if (data.html) {
          editor.setComponents(data.html);
          if (data.css && typeof editor.setStyle === 'function') {
            editor.setStyle(data.css);
          }
        }
      } catch (err) {
        setAiError(err instanceof Error ? err.message : 'AI request failed');
      } finally {
        setAiLoading(false);
      }
    },
    [aiInput, aiLoading, analyteGroups, editor, labId, messages, templateName]
  );

  // Toggle category expansion
  const toggleCategory = (cat: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) {
        next.delete(cat);
      } else {
        next.add(cat);
      }
      return next;
    });
  };

  // Toggle analyte expansion
  const toggleAnalyte = (name: string) => {
    setExpandedAnalytes((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  };

  if (!open) return null;

  return (
    <aside className="fixed right-0 top-0 z-[9999] h-full w-full max-w-md bg-white shadow-xl border-l border-gray-200 flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-4 py-3 shrink-0">
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold text-gray-900 truncate">Template Builder</h2>
          <p className="text-xs text-gray-600 truncate">{templateName}</p>
        </div>
        <button
          onClick={onClose}
          className="ml-3 shrink-0 rounded-md p-1.5 text-gray-400 hover:bg-gray-200 hover:text-gray-600 transition-colors"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 shrink-0">
        {[
          { id: 'builder', label: 'Builder', icon: LayoutTemplate },
          { id: 'placeholders', label: 'Placeholders', icon: Copy },
          { id: 'ai', label: 'AI Chat', icon: Sparkles },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={clsx(
              'flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-medium transition',
              activeTab === tab.id
                ? 'border-b-2 border-blue-500 text-blue-600 bg-blue-50/50'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            )}
          >
            <tab.icon className="h-3.5 w-3.5" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto">
        {/* BUILDER TAB */}
        {activeTab === 'builder' && (
          <div className="p-4 space-y-4">
            {/* Quick Actions */}
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
                Quick Actions
              </h3>
              <div className="grid grid-cols-2 gap-2">
                {QUICK_ACTIONS.slice(0, 4).map((action) => {
                  const isJustInserted = lastInsertedBlock === action.block?.id;
                  return (
                    <button
                      key={action.id}
                      onClick={() => {
                        if (action.action === 'insert_all_analytes') {
                          insertAllAnalyteRows();
                        } else if (action.block) {
                          insertBlock(action.block);
                        }
                      }}
                      className={clsx(
                        'flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs transition',
                        isJustInserted
                          ? 'border-emerald-400 bg-emerald-50 text-emerald-700'
                          : 'border-gray-200 bg-white hover:border-blue-300 hover:bg-blue-50'
                      )}
                    >
                      <Plus className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{action.label}</span>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Analyte Rows */}
            {analyteGroups.length > 0 && (
              <section>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Test Results ({analyteGroups.length})
                  </h3>
                  <button
                    onClick={insertAllAnalyteRows}
                    className={clsx(
                      'flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium transition',
                      lastInsertedBlock === 'all-analytes'
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                    )}
                  >
                    <Plus className="h-3 w-3" />
                    Add All
                  </button>
                </div>
                <div className="space-y-1.5 max-h-64 overflow-y-auto">
                  {analyteGroups.map((analyte) => {
                    const isInserted = lastInsertedBlock === `analyte-${analyte.code}`;
                    return (
                      <div
                        key={analyte.baseName}
                        className={clsx(
                          'flex items-center gap-2 rounded-lg border px-3 py-2 text-xs',
                          isInserted
                            ? 'border-emerald-400 bg-emerald-50'
                            : 'border-gray-200 bg-white'
                        )}
                      >
                        <span className="flex-1 truncate font-medium text-gray-900">
                          {analyte.baseLabel}
                        </span>
                        <button
                          onClick={() => insertAnalyteRow(analyte)}
                          className="rounded bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700 hover:bg-blue-200"
                          >
                            + Row
                          </button>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* More Blocks */}
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
                More Blocks
              </h3>
              {Object.entries(BLOCKS_BY_CATEGORY).map(([category, blocks]) => (
                <div key={category} className="mb-2">
                  <button
                    onClick={() => toggleCategory(category)}
                    className="flex items-center gap-1 w-full text-left text-[11px] font-medium text-gray-600 hover:text-gray-900 py-1"
                  >
                    {expandedCategories.has(category) ? (
                      <ChevronDown className="h-3 w-3" />
                    ) : (
                      <ChevronRight className="h-3 w-3" />
                    )}
                    {category.charAt(0).toUpperCase() + category.slice(1)}
                  </button>
                  {expandedCategories.has(category) && (
                    <div className="ml-4 space-y-1">
                      {blocks.map((block) => {
                        const isJustInserted = lastInsertedBlock === block.id;
                        return (
                          <button
                            key={block.id}
                            onClick={() => insertBlock(block)}
                            className={clsx(
                              'flex items-center gap-2 w-full rounded border px-2 py-1.5 text-left text-[11px] transition',
                              isJustInserted
                                ? 'border-emerald-400 bg-emerald-50 text-emerald-700'
                                : 'border-gray-200 hover:border-blue-300 hover:bg-blue-50'
                            )}
                          >
                            <Plus className="h-3 w-3 shrink-0 text-gray-400" />
                            <span className="truncate">{block.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </section>
          </div>
        )}

        {/* PLACEHOLDERS TAB */}
        {activeTab === 'placeholders' && (
          <div className="p-4 space-y-4">
            {/* Refresh button */}
            {onRefreshPlaceholders && (
              <button
                onClick={onRefreshPlaceholders}
                disabled={placeholderLoading}
                className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 disabled:opacity-50"
              >
                <RefreshCw className={clsx('h-3 w-3', placeholderLoading && 'animate-spin')} />
                {placeholderLoading ? 'Loading...' : 'Refresh'}
              </button>
            )}

            {/* Test Results */}
            {analyteGroups.length > 0 && (
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
                  Test Results ({analyteGroups.length})
                </h3>
                <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
                  {analyteGroups.map((analyte) => {
                    const isExpanded = expandedAnalytes.has(analyte.baseName);
                    return (
                      <div
                        key={analyte.baseName}
                        className="rounded-lg border border-gray-200 bg-white overflow-hidden"
                      >
                        <div className="flex items-center gap-2 px-3 py-2 bg-gray-50">
                          <button
                            onClick={() => toggleAnalyte(analyte.baseName)}
                            className="text-gray-400 hover:text-gray-600"
                          >
                            {isExpanded ? '▼' : '▶'}
                          </button>
                          <span className="flex-1 text-xs font-medium text-gray-900 truncate">
                            {analyte.baseLabel}
                          </span>
                          <div className="flex items-center gap-1">
                            {['value', 'unit', 'reference', 'flag'].map((type) => {
                              const opt = analyte[type as keyof AnalyteGroup] as PlaceholderOption | undefined;
                              if (!opt) return null;
                              const colors: Record<string, string> = {
                                value: 'bg-blue-100 text-blue-700 hover:bg-blue-200',
                                unit: 'bg-purple-100 text-purple-700 hover:bg-purple-200',
                                reference: 'bg-amber-100 text-amber-700 hover:bg-amber-200',
                                flag: 'bg-rose-100 text-rose-700 hover:bg-rose-200',
                              };
                              const isActioned = lastAction?.placeholder === opt.placeholder;
                              return (
                                <button
                                  key={type}
                                  onClick={() => insertPlaceholder(opt)}
                                  onContextMenu={(e) => {
                                    e.preventDefault();
                                    copyPlaceholder(opt);
                                  }}
                                  className={clsx(
                                    'rounded px-1.5 py-0.5 text-[9px] font-medium transition',
                                    colors[type],
                                    isActioned && 'ring-2 ring-green-400'
                                  )}
                                  title={`Click to insert, Right-click to copy\n${opt.placeholder}`}
                                >
                                  {type.charAt(0).toUpperCase() + type.slice(1, 3)}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                        {isExpanded && (
                          <div className="px-3 py-2 border-t border-gray-100 space-y-1 text-[10px]">
                            {analyte.value && (
                              <div className="flex justify-between">
                                <span className="text-gray-500">Value:</span>
                                <code className="bg-blue-50 px-1 rounded">{analyte.value.placeholder}</code>
                              </div>
                            )}
                            {analyte.unit && (
                              <div className="flex justify-between">
                                <span className="text-gray-500">Unit:</span>
                                <code className="bg-purple-50 px-1 rounded">{analyte.unit.placeholder}</code>
                              </div>
                            )}
                            {analyte.reference && (
                              <div className="flex justify-between">
                                <span className="text-gray-500">Reference:</span>
                                <code className="bg-amber-50 px-1 rounded">{analyte.reference.placeholder}</code>
                              </div>
                            )}
                            {analyte.flag && (
                              <div className="flex justify-between">
                                <span className="text-gray-500">Flag:</span>
                                <code className="bg-rose-50 px-1 rounded">{analyte.flag.placeholder}</code>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Patient Placeholders */}
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
                Patient Info
              </h3>
              <div className="grid grid-cols-2 gap-1.5">
                {grouped.patient.map((opt) => {
                  const isActioned = lastAction?.placeholder === opt.placeholder;
                  return (
                    <button
                      key={opt.id}
                      onClick={() => insertPlaceholder(opt)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        copyPlaceholder(opt);
                      }}
                      className={clsx(
                        'rounded border px-2 py-1.5 text-left text-[10px] transition',
                        isActioned
                          ? 'border-green-400 bg-green-50'
                          : 'border-gray-200 hover:border-blue-300 hover:bg-blue-50'
                      )}
                      title={opt.placeholder}
                    >
                      <div className="font-medium text-gray-900 truncate">{opt.label}</div>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Signature Placeholders */}
            {grouped.signature.length > 0 && (
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
                  Signatures
                </h3>
                <div className="grid grid-cols-2 gap-1.5">
                  {grouped.signature.map((opt) => {
                    const isActioned = lastAction?.placeholder === opt.placeholder;
                    return (
                      <button
                        key={opt.id}
                        onClick={() => insertPlaceholder(opt)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          copyPlaceholder(opt);
                        }}
                        className={clsx(
                          'rounded border px-2 py-1.5 text-left text-[10px] transition',
                          isActioned
                            ? 'border-green-400 bg-green-50'
                            : 'border-gray-200 hover:border-blue-300 hover:bg-blue-50'
                        )}
                        title={opt.placeholder}
                      >
                        <div className="font-medium text-gray-900 truncate">{opt.label}</div>
                      </button>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Section Placeholders */}
            {grouped.section.length > 0 && (
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
                  Clinical Sections
                </h3>
                <div className="grid grid-cols-2 gap-1.5">
                  {grouped.section.map((opt) => {
                    const isActioned = lastAction?.placeholder === opt.placeholder;
                    return (
                      <button
                        key={opt.id}
                        onClick={() => insertPlaceholder(opt)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          copyPlaceholder(opt);
                        }}
                        className={clsx(
                          'rounded border px-2 py-1.5 text-left text-[10px] transition',
                          isActioned
                            ? 'border-green-400 bg-green-50'
                            : 'border-gray-200 hover:border-blue-300 hover:bg-blue-50'
                        )}
                        title={opt.placeholder}
                      >
                        <div className="font-medium text-gray-900 truncate">{opt.label}</div>
                      </button>
                    );
                  })}
                </div>
              </section>
            )}
          </div>
        )}

        {/* AI CHAT TAB */}
        {activeTab === 'ai' && (
          <div className="flex flex-col h-full">
            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.length === 0 && (
                <div className="text-center text-xs text-gray-500 py-8">
                  <Wand2 className="h-8 w-8 mx-auto mb-2 text-gray-300" />
                  <p>Ask AI to help with styling, layout, or adding elements.</p>
                  <p className="mt-1 text-[10px]">Examples:</p>
                  <p className="text-[10px] text-gray-400">"Make the header blue"</p>
                  <p className="text-[10px] text-gray-400">"Add a border around the results table"</p>
                </div>
              )}
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={clsx('max-w-[85%] rounded-lg px-3 py-2 text-xs', {
                    'ml-auto bg-blue-600 text-white': msg.role === 'user',
                    'bg-gray-100 text-gray-800': msg.role !== 'user',
                  })}
                >
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                </div>
              ))}
              {aiLoading && (
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Thinking...
                </div>
              )}
            </div>

            {/* Input */}
            <div className="border-t border-gray-200 p-4 shrink-0">
              {aiError && (
                <div className="mb-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {aiError}
                </div>
              )}
              <form onSubmit={handleAISubmit} className="flex gap-2">
                <input
                  type="text"
                  value={aiInput}
                  onChange={(e) => setAiInput(e.target.value)}
                  placeholder="Describe what you want to change..."
                  className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-xs focus:border-blue-500 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={aiLoading || !aiInput.trim()}
                  className="rounded-lg bg-blue-600 px-3 py-2 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Send className="h-4 w-4" />
                </button>
              </form>
            </div>
          </div>
        )}
      </div>

      {/* Footer Help */}
      <div className="border-t border-gray-200 bg-gray-50 px-4 py-2 shrink-0">
        <div className="flex items-center gap-3 text-[10px] text-gray-500">
          <span>Click = Insert</span>
          <span>Right-click = Copy</span>
        </div>
      </div>
    </aside>
  );
};

export default TemplateBuilderSidebar;
