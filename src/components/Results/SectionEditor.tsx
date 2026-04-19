/**
 * SectionEditor - Component for editing pre-defined report sections
 * 
 * Used in result entry for PBS, Radiology, and other manual report types
 * that require findings, impressions, recommendations, etc.
 */

import React, { useState, useEffect, useCallback, useImperativeHandle, forwardRef } from 'react';
import {
  FileText,
  CheckSquare,
  Save,
  Loader2,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  Lock,
  Sparkles,
  X,
  Wand2,
  ImagePlus,
  Trash2
} from 'lucide-react';
import { attachments, database } from '../../utils/supabase';
import { generateSectionContent, getQuickPromptsForSection, SectionGeneratorResponse } from '../../utils/aiSectionService';

// ── Cascade types (mirrors ManageReportSections) ──────────────────────────

interface CascadeOption {
  id: string;
  value: string;
  sub_levels?: CascadeLevel[];
}

interface CascadeLevel {
  id: string;
  label: string;
  multi_select: boolean;
  options: CascadeOption[];
}

interface MatrixConfig {
  rows: string[];
  columns: string[];
  cellOptions?: string[]; // if set, cells render as dropdowns (e.g. ["S","I","R"])
}

interface SectionConfig {
  mode: 'flat' | 'cascading' | 'matrix';
  cascade_levels: CascadeLevel[];
  matrix: MatrixConfig;
}

// ── Cascade helpers ────────────────────────────────────────────────────────

function buildCascadeContent(levels: CascadeLevel[], selections: Record<string, string[]>): string {
  const lines: string[] = [];
  function traverse(levs: CascadeLevel[]) {
    for (const level of levs) {
      const selectedIds = selections[level.id] || [];
      if (selectedIds.length === 0) continue;
      const selectedOpts = level.options.filter(o => selectedIds.includes(o.id));
      const values = selectedOpts.map(o => o.value).join(', ');
      if (values) lines.push(level.label ? `${level.label}: ${values}` : values);
      for (const opt of selectedOpts) {
        if (opt.sub_levels) traverse(opt.sub_levels);
      }
    }
  }
  traverse(levels);
  return lines.join('\n');
}

function getVisibleLevels(levels: CascadeLevel[], selections: Record<string, string[]>): CascadeLevel[] {
  const visible: CascadeLevel[] = [];
  function traverse(levs: CascadeLevel[]) {
    for (const level of levs) {
      visible.push(level);
      const selectedIds = selections[level.id] || [];
      for (const optId of selectedIds) {
        const opt = level.options.find(o => o.id === optId);
        if (opt?.sub_levels) traverse(opt.sub_levels);
      }
    }
  }
  traverse(levels);
  return visible;
}

const MATRIX_CELL_PREFIX = 'matrix:';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const MATRIX_COL_LABEL_PREFIX = 'col_label:';
const MATRIX_COL_ORDER_KEY = 'matrix_col_order';

function matrixCellKey(row: string, column: string): string {
  return `${MATRIX_CELL_PREFIX}${row}::${column}`;
}

function matrixColLabelKey(column: string): string {
  return `${MATRIX_COL_LABEL_PREFIX}${column}`;
}

function getMatrixCellValue(selections: Record<string, unknown> | undefined, row: string, column: string): string {
  const raw = selections?.[matrixCellKey(row, column)];
  if (Array.isArray(raw)) return String(raw[0] || '');
  return typeof raw === 'string' ? raw : '';
}

function getColLabel(selections: Record<string, unknown> | undefined, column: string): string {
  const raw = selections?.[matrixColLabelKey(column)];
  return typeof raw === 'string' && raw.trim() ? raw.trim() : column;
}

// Returns the active column key list for this result (may differ from template if user added/removed)
function getActiveColumns(selections: Record<string, unknown> | undefined, templateColumns: string[]): string[] {
  const raw = selections?.[MATRIX_COL_ORDER_KEY];
  if (Array.isArray(raw) && raw.length > 0) return raw as string[];
  return templateColumns;
}

function cellOptionColor(value: string, cellOptions: string[]): string {
  if (!cellOptions.length) return '';
  const idx = cellOptions.findIndex(o => o.trim().toUpperCase() === value.trim().toUpperCase());
  if (idx === -1) return '';
  // first option = green (sensitive), last option = red (resistant), middle = orange (intermediate)
  if (cellOptions.length === 1) return 'background:#d1fae5;color:#065f46;font-weight:600;';
  if (idx === 0) return 'background:#d1fae5;color:#065f46;font-weight:600;';
  if (idx === cellOptions.length - 1) return 'background:#fee2e2;color:#991b1b;font-weight:600;';
  return 'background:#fff3cd;color:#92400e;font-weight:600;';
}

function buildMatrixHtml(config: MatrixConfig | undefined, selections: Record<string, unknown> | undefined, customText: string): string {
  const rows = (config?.rows || []).map((row) => row.trim()).filter(Boolean);
  const templateCols = (config?.columns || []).map((c) => c.trim()).filter(Boolean);
  const columns = getActiveColumns(selections, templateCols);
  if (rows.length === 0 || columns.length === 0) {
    return customText.trim();
  }
  const cellOptions = config?.cellOptions || [];

  const headerHtml = columns
    .map((column) => `<th style="border:1px solid #9ca3af;padding:8px;text-align:left;background:#f8fafc;">${escapeHtml(getColLabel(selections, column))}</th>`)
    .join('');

  const bodyHtml = rows
    .map((row) => {
      const cells = columns
        .map((column) => {
          const val = getMatrixCellValue(selections, row, column);
          const colorStyle = val ? cellOptionColor(val, cellOptions) : '';
          return `<td style="border:1px solid #9ca3af;padding:8px;min-width:80px;text-align:center;${colorStyle}">${escapeHtml(val)}</td>`;
        })
        .join('');
      return `<tr><th style="border:1px solid #9ca3af;padding:8px;text-align:left;background:#f8fafc;">${escapeHtml(row)}</th>${cells}</tr>`;
    })
    .join('');

  const notesHtml = customText.trim()
    ? `<div style="margin-top:12px;white-space:pre-wrap;">${escapeHtml(customText.trim()).replace(/\n/g, '<br/>')}</div>`
    : '';

  return `<table style="width:100%;border-collapse:collapse;font-size:13px;"><thead><tr><th style="border:1px solid #9ca3af;padding:8px;background:#f8fafc;"></th>${headerHtml}</tr></thead><tbody>${bodyHtml}</tbody></table>${notesHtml}`;
}

// ── CascadeSelector component ──────────────────────────────────────────────

interface CascadeSelectorProps {
  section: TemplateSection;
  selections: Record<string, string[]>;
  onChange: (newSelections: Record<string, string[]>, finalContent: string) => void;
  disabled?: boolean;
}

const CascadeSelector: React.FC<CascadeSelectorProps> = ({ section, selections, onChange, disabled }) => {
  const config = section.section_config;
  if (!config || config.cascade_levels.length === 0) {
    return (
      <div className="text-sm text-gray-400 italic py-2">
        No cascading options configured for this section.
      </div>
    );
  }

  const visibleLevels = getVisibleLevels(config.cascade_levels, selections);

  const handleSelect = (levelId: string, optionId: string, multiSelect: boolean) => {
    const current = selections[levelId] || [];
    const newSelected = multiSelect
      ? current.includes(optionId)
        ? current.filter(id => id !== optionId)
        : [...current, optionId]
      : current.includes(optionId) ? [] : [optionId];

    const draft = { ...selections, [levelId]: newSelected };

    // Prune selections for levels that are no longer visible
    const nowVisible = new Set(getVisibleLevels(config.cascade_levels, draft).map(l => l.id));
    const cleaned: Record<string, string[]> = {};
    for (const [id, sel] of Object.entries(draft)) {
      if (nowVisible.has(id)) cleaned[id] = sel;
    }

    onChange(cleaned, buildCascadeContent(config.cascade_levels, cleaned));
  };

  return (
    <div className="space-y-4">
      {visibleLevels.map((level, idx) => {
        const selectedIds = selections[level.id] || [];
        return (
          <div key={level.id}>
            {idx > 0 && <div className="border-t border-gray-100 pt-4" />}
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {level.label || 'Select an option'}
              {level.multi_select && (
                <span className="ml-1 text-xs font-normal text-gray-400">(select multiple)</span>
              )}
            </label>
            <div className="space-y-1.5">
              {level.options.map(option => {
                const isSelected = selectedIds.includes(option.id);
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => !disabled && handleSelect(level.id, option.id, level.multi_select)}
                    disabled={disabled}
                    className={`w-full text-left px-3 py-2.5 rounded-lg border text-sm transition-all ${
                      isSelected
                        ? 'bg-blue-50 border-blue-300 text-blue-900 font-medium'
                        : 'bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100'
                    } ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
                  >
                    <div className="flex items-center gap-2.5">
                      {/* Radio/checkbox indicator */}
                      {level.multi_select ? (
                        <div className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 ${
                          isSelected ? 'bg-blue-500 border-blue-500' : 'border-gray-400 bg-white'
                        }`}>
                          {isSelected && (
                            <CheckSquare className="w-3 h-3 text-white" />
                          )}
                        </div>
                      ) : (
                        <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                          isSelected ? 'border-blue-500' : 'border-gray-400 bg-white'
                        }`}>
                          {isSelected && <div className="w-2 h-2 rounded-full bg-blue-500" />}
                        </div>
                      )}
                      <span>{option.value}</span>
                      {option.sub_levels && option.sub_levels.length > 0 && (
                        <span className="ml-auto text-xs text-gray-400">
                          {isSelected ? '▼ more options' : '▶ has sub-options'}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
};

interface MatrixEditorProps {
  section: TemplateSection;
  values: Record<string, any>;
  customText: string;
  disabled?: boolean;
  onChange: (newSelections: Record<string, any>, finalContent: string) => void;
}

const MatrixEditor: React.FC<MatrixEditorProps> = ({ section, values, customText, disabled, onChange }) => {
  const matrix = section.section_config?.matrix;
  const rows = (matrix?.rows || []).map((row) => row.trim()).filter(Boolean);
  const templateColumns = (matrix?.columns || []).map((c) => c.trim()).filter(Boolean);
  const columns = getActiveColumns(values, templateColumns);

  if (rows.length === 0 || templateColumns.length === 0) {
    return <div className="text-sm text-gray-400 italic py-2">No matrix rows/columns configured for this section.</div>;
  }

  const updateCell = (row: string, column: string, value: string) => {
    const nextSelections = {
      ...(values || {}),
      [matrixCellKey(row, column)]: value ? [value] : [],
    };
    onChange(nextSelections, buildMatrixHtml(matrix, nextSelections, customText));
  };

  const updateColLabel = (column: string, label: string) => {
    const nextSelections = {
      ...(values || {}),
      [matrixColLabelKey(column)]: label,
    };
    onChange(nextSelections, buildMatrixHtml(matrix, nextSelections, customText));
  };

  const addColumn = () => {
    const newKey = `col_extra_${Date.now()}`;
    const nextCols = [...columns, newKey];
    const nextSelections = {
      ...(values || {}),
      [MATRIX_COL_ORDER_KEY]: nextCols,
      [matrixColLabelKey(newKey)]: `Organism ${nextCols.length}`,
    };
    onChange(nextSelections, buildMatrixHtml(matrix, nextSelections, customText));
  };

  const removeColumn = (colKey: string) => {
    if (columns.length <= 1) return;
    const nextCols = columns.filter(c => c !== colKey);
    // clean up cell data for removed column
    const nextSelections: Record<string, unknown> = { ...(values || {}), [MATRIX_COL_ORDER_KEY]: nextCols };
    delete nextSelections[matrixColLabelKey(colKey)];
    rows.forEach(row => delete nextSelections[matrixCellKey(row, colKey)]);
    onChange(nextSelections, buildMatrixHtml(matrix, nextSelections, customText));
  };

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border border-gray-300 rounded-lg overflow-hidden">
        <thead className="bg-gray-50">
          <tr>
            <th className="border border-gray-300 px-3 py-2 text-left text-sm font-medium text-gray-700"></th>
            {columns.map((column) => (
              <th key={column} className="border border-gray-300 px-2 py-1 text-sm font-medium text-gray-700 min-w-[140px]">
                <div className="flex items-center gap-1">
                  <input
                    type="text"
                    value={getColLabel(values, column)}
                    onChange={(e) => updateColLabel(column, e.target.value)}
                    disabled={disabled}
                    placeholder={column}
                    className={`flex-1 min-w-0 px-2 py-1 border border-blue-300 rounded text-sm font-semibold bg-blue-50 focus:ring-2 focus:ring-blue-500 focus:outline-none ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
                  />
                  {!disabled && columns.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeColumn(column)}
                      title="Remove this organism"
                      className="flex-shrink-0 text-gray-400 hover:text-red-500 transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </th>
            ))}
            {!disabled && (
              <th className="border border-gray-300 px-2 py-1">
                <button
                  type="button"
                  onClick={addColumn}
                  title="Add organism column"
                  className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium whitespace-nowrap"
                >
                  <span className="text-base leading-none">+</span> Add
                </button>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row}>
              <th className="border border-gray-300 px-3 py-2 text-left text-sm font-medium text-gray-700 bg-gray-50">
                {row}
              </th>
              {columns.map((column) => {
                const cellVal = getMatrixCellValue(values, row, column);
                const opts = matrix?.cellOptions || [];
                const colorClass = opts.length && cellVal ? (() => {
                  const idx = opts.findIndex(o => o.trim().toUpperCase() === cellVal.trim().toUpperCase());
                  if (idx === -1) return '';
                  if (opts.length === 1 || idx === 0) return 'bg-green-100 text-green-800 font-semibold';
                  if (idx === opts.length - 1) return 'bg-red-100 text-red-800 font-semibold';
                  return 'bg-yellow-100 text-yellow-800 font-semibold';
                })() : '';
                return (
                  <td key={`${row}-${column}`} className="border border-gray-300 p-1.5">
                    {opts.length > 0 ? (
                      <select
                        value={cellVal}
                        onChange={(e) => updateCell(row, column, e.target.value)}
                        disabled={disabled}
                        className={`w-full px-2 py-1.5 border rounded text-sm focus:ring-2 focus:ring-blue-500 text-center ${colorClass} ${
                          disabled ? 'bg-gray-100 cursor-not-allowed' : ''
                        }`}
                      >
                        <option value="">—</option>
                        {opts.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={cellVal}
                        onChange={(e) => updateCell(row, column, e.target.value)}
                        disabled={disabled}
                        className={`w-full px-2 py-1.5 border rounded text-sm focus:ring-2 focus:ring-blue-500 ${
                          disabled ? 'bg-gray-100 cursor-not-allowed' : 'bg-white'
                        }`}
                        placeholder={`${row} ${column}`}
                      />
                    )}
                  </td>
                );
              })}
              {!disabled && <td className="border border-gray-300" />}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// ── Component interfaces ────────────────────────────────────────────────────

interface TemplateSection {
  id: string;
  section_type: string;
  section_name: string;
  display_order: number;
  default_content: string | null;
  predefined_options: string[];
  is_required: boolean;
  is_editable: boolean;
  allow_images?: boolean;
  allow_technician_entry?: boolean;
  placeholder_key: string | null;
  section_config?: SectionConfig;
}

interface SectionContent {
  id?: string;
  section_id: string;
  selected_options: number[]; // Indices of selected predefined options (flat mode)
  custom_text: string;
  final_content: string;
  image_urls?: string[];
  is_finalized: boolean;
  cascading_selections?: Record<string, any>; // levelId → optionId[] or matrix cell payloads
}

interface SectionEditorProps {
  resultId: string;
  testGroupId: string;
  onSave?: (sections: SectionContent[]) => void;
  readOnly?: boolean;
  className?: string;
  editorRole?: 'doctor' | 'technician';
  showAIAssistant?: boolean;
}

const SECTION_TYPE_ICONS: Record<string, string> = {
  findings: '🔍',
  impression: '💡',
  recommendation: '📋',
  technique: '🔬',
  clinical_history: '📜',
  conclusion: '✅',
  custom: '📝',
};

const SECTION_TYPE_LABELS: Record<string, string> = {
  findings: 'Findings',
  impression: 'Impression',
  recommendation: 'Recommendations',
  technique: 'Technique',
  clinical_history: 'Clinical History',
  conclusion: 'Conclusion',
  custom: 'Custom Section',
};

export interface SectionEditorRef {
  save: () => Promise<void>;
}

const SectionEditor = forwardRef<SectionEditorRef, SectionEditorProps>(({
  resultId,
  testGroupId,
  onSave,
  readOnly = false,
  className = '',
  editorRole = 'doctor',
  showAIAssistant = true,
}, ref) => {
  const [sections, setSections] = useState<TemplateSection[]>([]);
  const [contents, setContents] = useState<Map<string, SectionContent>>(new Map());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [uploadingSections, setUploadingSections] = useState<Record<string, boolean>>({});

  // AI Assistant state
  const [showAIPanel, setShowAIPanel] = useState<string | null>(null);
  const [aiPrompt, setAIPrompt] = useState('');
  const [aiGenerating, setAIGenerating] = useState(false);
  const [aiResult, setAIResult] = useState<SectionGeneratorResponse | null>(null);
  const [aiError, setAIError] = useState<string | null>(null);

  const getOptimizedImageUrl = (url?: string | null) => {
    if (!url) return '';
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}tr=w-1200,q-85,sharpen-5`;
  };

  // Load sections and existing content
  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    
    try {
      // Load section templates for this test group
      const { data: templateSections, error: sectionsErr } = await database.templateSections.getByTestGroup(testGroupId);
      if (sectionsErr) throw sectionsErr;
      
      if (!templateSections || templateSections.length === 0) {
        setSections([]);
        setLoading(false);
        return;
      }

      const normalizedSections = (templateSections || []).map((section: TemplateSection) => ({
        ...section,
        predefined_options: section.predefined_options || [],
      }));

      const filteredSections = editorRole === 'technician'
        ? normalizedSections.filter(section => section.allow_technician_entry)
        : normalizedSections;

      setSections(filteredSections);
      
      // Expand all sections by default
      setExpandedSections(new Set(filteredSections.map((s: TemplateSection) => s.id)));

      // Load existing content for this result
      const { data: existingContent, error: contentErr } = await database.resultSectionContent.getByResult(resultId);
      if (contentErr) throw contentErr;

      // Build content map
      const contentMap = new Map<string, SectionContent>();
      for (const section of filteredSections) {
        const existing = existingContent?.find((c: any) => c.section_id === section.id);
        if (existing) {
          contentMap.set(section.id, {
            id: existing.id,
            section_id: existing.section_id,
            selected_options: existing.selected_options || [],
            custom_text: existing.custom_text || '',
            final_content: existing.final_content || '',
            image_urls: existing.image_urls || [],
            is_finalized: existing.is_finalized || false,
            cascading_selections: existing.cascading_selections || {},
          });
        } else {
          // Initialize with defaults
          contentMap.set(section.id, {
            section_id: section.id,
            selected_options: [],
            custom_text: '',
            final_content: section.default_content || '',
            image_urls: [],
            is_finalized: false,
          });
        }
      }
      setContents(contentMap);
    } catch (err: any) {
      console.error('Failed to load section data:', err);
      setError(err.message || 'Failed to load sections');
    } finally {
      setLoading(false);
    }
  }, [resultId, testGroupId, editorRole]);

  useEffect(() => {
    if (resultId && testGroupId) {
      loadData();
    }
  }, [resultId, testGroupId, loadData]);

  // Global keyboard shortcut: press 'a','b','c'... to toggle predefined options
  // Only fires when not typing in an input/textarea and a section with options is expanded
  useEffect(() => {
    if (readOnly) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
      const key = e.key.toLowerCase();
      const charCode = key.charCodeAt(0);
      if (charCode < 97 || charCode > 122) return; // only a-z
      const optionIndex = charCode - 97;

      // Find the first expanded flat section that has an option at this index and is not locked
      for (const section of sections) {
        if (!expandedSections.has(section.id)) continue;
        if (section.section_config?.mode === 'cascading') continue; // skip cascading sections
        if (!section.predefined_options || section.predefined_options.length <= optionIndex) continue;
        const content = contents.get(section.id);
        if (content?.is_finalized) continue;
        const roleAllowed = editorRole === 'doctor' || section.allow_technician_entry;
        if (!roleAllowed) continue;
        e.preventDefault();
        toggleOption(section.id, optionIndex);
        break;
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [readOnly, sections, expandedSections, contents, editorRole]);

  // Toggle predefined option selection
  const toggleOption = (sectionId: string, optionIndex: number) => {
    setContents(prev => {
      const newMap = new Map(prev);
      const content = newMap.get(sectionId);
      if (!content || content.is_finalized) return prev;

      const selectedOptions = [...content.selected_options];
      const idx = selectedOptions.indexOf(optionIndex);
      if (idx >= 0) {
        selectedOptions.splice(idx, 1);
      } else {
        selectedOptions.push(optionIndex);
      }

      // Rebuild final content
      const section = sections.find(s => s.id === sectionId);
      const selectedTexts = selectedOptions
        .sort((a, b) => a - b)
        .map(i => section?.predefined_options[i])
        .filter(Boolean);
      
      const finalContent = [
        ...selectedTexts,
        content.custom_text.trim(),
      ].filter(Boolean).join('\n\n');

      newMap.set(sectionId, {
        ...content,
        selected_options: selectedOptions,
        final_content: finalContent,
      });
      return newMap;
    });
  };

  // Directly edit final content (overrides computed value from options + custom text)
  const updateFinalContent = (sectionId: string, text: string) => {
    setContents(prev => {
      const newMap = new Map(prev);
      const content = newMap.get(sectionId);
      if (!content || content.is_finalized) return prev;
      newMap.set(sectionId, { ...content, final_content: text });
      return newMap;
    });
  };

  // Update custom text
  const updateCustomText = (sectionId: string, text: string) => {
    setContents(prev => {
      const newMap = new Map(prev);
      const content = newMap.get(sectionId);
      if (!content || content.is_finalized) return prev;

      const section = sections.find(s => s.id === sectionId);

      let baseContent: string;
      if (section?.section_config?.mode === 'cascading' && section.section_config.cascade_levels.length > 0) {
        baseContent = buildCascadeContent(section.section_config.cascade_levels, content.cascading_selections || {});
      } else if (section?.section_config?.mode === 'matrix') {
        baseContent = buildMatrixHtml(section.section_config.matrix, content.cascading_selections || {}, text);
        newMap.set(sectionId, {
          ...content,
          custom_text: text,
          final_content: baseContent,
        });
        return newMap;
      } else {
        const selectedTexts = content.selected_options
          .sort((a, b) => a - b)
          .map(i => section?.predefined_options[i])
          .filter(Boolean) as string[];
        baseContent = selectedTexts.join('\n\n');
      }

      const finalContent = [baseContent, text.trim()].filter(Boolean).join('\n\n');

      newMap.set(sectionId, {
        ...content,
        custom_text: text,
        final_content: finalContent,
      });
      return newMap;
    });
  };

  const setUploadingForSection = (sectionId: string, value: boolean) => {
    setUploadingSections(prev => ({ ...prev, [sectionId]: value }));
  };

  const uploadSectionImages = async (sectionId: string, files: FileList | null) => {
    if (!files || files.length === 0) return;

    const content = contents.get(sectionId);
    if (content?.is_finalized || readOnly) return;

    setUploadingForSection(sectionId, true);
    setError(null);

    try {
      const section = sections.find(s => s.id === sectionId);
      const uploadResults = await Promise.all(
        Array.from(files).map(async (file) => {
          const { data, error: uploadError } = await attachments.upload(file, {
            related_table: 'results',
            related_id: resultId,
            description: section ? `Report section: ${section.section_name}` : 'Report section image',
            tag: 'report-section'
          });

          if (uploadError) {
            throw uploadError;
          }

          if (!data?.id) {
            return null;
          }

          // Poll for ImageKit URL so we store the durable URL, not Supabase storage
          const maxAttempts = 6;
          const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
          for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
            const { data: attachment } = await attachments.getById(data.id);
            if (attachment?.imagekit_url) {
              return attachment.imagekit_url;
            }
            if (attachment?.processed_url) {
              return attachment.processed_url;
            }
            await delay(1000);
          }

          return null;
        })
      );

      const newUrls = uploadResults.filter(Boolean) as string[];
      if (newUrls.length === 0) return;

      setContents(prev => {
        const newMap = new Map(prev);
        const current = newMap.get(sectionId);
        if (!current) return prev;

        const existingUrls = current.image_urls || [];
        const mergedUrls = [...existingUrls, ...newUrls.filter(url => !existingUrls.includes(url))];

        newMap.set(sectionId, {
          ...current,
          image_urls: mergedUrls,
        });

        return newMap;
      });
    } catch (err: any) {
      console.error('Failed to upload section images:', err);
      setError(err?.message || 'Failed to upload section images');
    } finally {
      setUploadingForSection(sectionId, false);
    }
  };

  const removeSectionImage = (sectionId: string, url: string) => {
    setContents(prev => {
      const newMap = new Map(prev);
      const content = newMap.get(sectionId);
      if (!content || content.is_finalized) return prev;

      const nextUrls = (content.image_urls || []).filter(existing => existing !== url);
      newMap.set(sectionId, {
        ...content,
        image_urls: nextUrls,
      });

      return newMap;
    });
  };

  // Toggle section expansion
  const toggleExpanded = (sectionId: string) => {
    setExpandedSections(prev => {
      const newSet = new Set(prev);
      if (newSet.has(sectionId)) {
        newSet.delete(sectionId);
      } else {
        newSet.add(sectionId);
      }
      return newSet;
    });
  };

  // AI Assistant functions
  const openAIPanel = (sectionId: string) => {
    setShowAIPanel(sectionId);
    setAIPrompt('');
    setAIResult(null);
    setAIError(null);
  };

  const closeAIPanel = () => {
    setShowAIPanel(null);
    setAIPrompt('');
    setAIResult(null);
    setAIError(null);
  };

  const buildLabContext = async () => {
    const { data: brandingDefaults } = await database.labs.getBrandingDefaults();
    const { data: result } = await database.results.getById(resultId);

    const patientId = result?.patient_id || result?.patientId;
    const { data: patient } = patientId ? await database.patients.getById(patientId) : { data: null };
    const { data: testGroup } = await database.testGroups.getById(testGroupId);

    const resultValues = Array.isArray(result?.result_values) ? result.result_values : [];
    const scopedValues = resultValues.filter((value: any) => {
      if (!value) return false;
      if (value.test_group_id) return value.test_group_id === testGroupId;
      return true;
    });

    const notableValues = scopedValues.filter((value: any) => value.flag && String(value.flag).trim().length > 0);
    const valuesToUse = notableValues.length > 0 ? notableValues : scopedValues.slice(0, 10);

    const testResults = valuesToUse.reduce((acc: Record<string, string>, value: any) => {
      const name = value.parameter || value.analyte_name || 'Result';
      const unit = value.unit ? ` ${value.unit}` : '';
      const flag = value.flag ? ` [${value.flag}]` : '';
      const formattedValue = value.value != null ? `${value.value}${unit}${flag}` : '';
      acc[name] = formattedValue || 'N/A';
      return acc;
    }, {});

    return {
      testGroupName: testGroup?.name,
      labContext: {
        labName: brandingDefaults?.labName || undefined,
        patientInfo: {
          age: typeof patient?.age === 'number' ? patient.age : undefined,
          gender: patient?.gender || undefined,
        },
        testResults,
        styleHints: 'Tone: professional, concise. Use line breaks for readability. If results are absent, keep generic and avoid definitive diagnoses. Use provided units and avoid inventing numeric values.',
      },
    };
  };

  const generateWithAI = async (section: TemplateSection) => {
    if (!aiPrompt.trim()) {
      setAIError('Please enter a prompt');
      return;
    }

    setAIGenerating(true);
    setAIError(null);
    setAIResult(null);

    try {
      const { testGroupName, labContext } = await buildLabContext();
      const { data, error } = await generateSectionContent({
        sectionType: section.section_type,
        sectionName: section.section_name,
        testGroupName,
        userPrompt: aiPrompt,
        existingOptions: section.predefined_options,
        labContext,
      });

      if (error) {
        setAIError(error);
        return;
      }

      if (data) {
        setAIResult(data);
      }
    } catch (err) {
      setAIError(err instanceof Error ? err.message : 'Failed to generate content');
    } finally {
      setAIGenerating(false);
    }
  };

  const applyAIContent = (sectionId: string) => {
    if (!aiResult?.generatedContent) return;

    setContents(prev => {
      const newMap = new Map(prev);
      const content = newMap.get(sectionId);
      if (!content || content.is_finalized) return prev;

      const section = sections.find(s => s.id === sectionId);
      // Append AI content to custom text
      const newCustomText = content.custom_text
        ? `${content.custom_text}\n\n${aiResult.generatedContent}`
        : aiResult.generatedContent;

      const finalContent = section?.section_config?.mode === 'matrix'
        ? buildMatrixHtml(section.section_config.matrix, content.cascading_selections || {}, newCustomText)
        : [
          ...content.selected_options
            .sort((a, b) => a - b)
            .map(i => section?.predefined_options[i])
            .filter(Boolean),
          newCustomText.trim(),
        ].filter(Boolean).join('\n\n');

      newMap.set(sectionId, {
        ...content,
        custom_text: newCustomText,
        final_content: finalContent,
      });
      return newMap;
    });

    closeAIPanel();
  };

  // Save all section contents
  const saveAll = async () => {
    setSaving(true);
    setError(null);

    try {
      const { data: currentUser, error: userError } = await database.auth.getCurrentUser();
      if (userError || !currentUser?.user?.id) {
        throw new Error('Unable to resolve current user');
      }

      const savePromises: Promise<any>[] = [];

      for (const [sectionId, content] of contents.entries()) {
        savePromises.push(
          database.resultSectionContent.upsert({
            result_id: resultId,
            section_id: sectionId,
            selected_options: content.selected_options,
            custom_text: content.custom_text,
            final_content: content.final_content,
            image_urls: content.image_urls || [],
            cascading_selections: content.cascading_selections || {},
          }, currentUser.user.id)
        );
      }

      await Promise.all(savePromises);

      // Reload to get IDs for new records
      await loadData();
      
      if (onSave) {
        onSave(Array.from(contents.values()));
      }
    } catch (err: any) {
      console.error('Failed to save sections:', err);
      setError(err.message || 'Failed to save sections');
    } finally {
      setSaving(false);
    }
  };

  useImperativeHandle(ref, () => ({ save: saveAll }));

  if (loading) {
    return (
      <div className={`flex items-center justify-center p-8 ${className}`}>
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        <span className="ml-2 text-gray-600">Loading sections...</span>
      </div>
    );
  }

  if (sections.length === 0) {
    return null; // No sections configured for this test group
  }

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900 flex items-center">
          <FileText className="h-5 w-5 mr-2 text-blue-600" />
          Report Sections
        </h3>
        {!readOnly && (
          <button
            onClick={saveAll}
            disabled={saving}
            className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            Save Sections
          </button>
        )}
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-center text-red-700">
          <AlertCircle className="h-5 w-5 mr-2" />
          {error}
        </div>
      )}

      {/* Section Cards */}
      <div className="space-y-3">
        {sections.map(section => {
          const content = contents.get(section.id);
          const isExpanded = expandedSections.has(section.id);
          const roleAllowed = editorRole === 'doctor' || section.allow_technician_entry;
          const canEdit = roleAllowed && !readOnly && !content?.is_finalized;
          const isLocked = !canEdit;
          const canEditText = canEdit && section.is_editable;
          const isUploading = uploadingSections[section.id];

          return (
            <div
              key={section.id}
              className={`border rounded-lg overflow-hidden ${
                isLocked ? 'bg-gray-50 border-gray-300' : 'bg-white border-gray-200'
              }`}
            >
              {/* Section Header */}
              <button
                onClick={() => toggleExpanded(section.id)}
                className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center">
                  <span className="text-xl mr-3">{SECTION_TYPE_ICONS[section.section_type] || '📝'}</span>
                  <div className="text-left">
                    <div className="font-medium text-gray-900">
                      {section.section_name}
                      {section.is_required && <span className="text-red-500 ml-1">*</span>}
                    </div>
                    <div className="text-sm text-gray-500">
                      {SECTION_TYPE_LABELS[section.section_type] || section.section_type}
                      {section.placeholder_key && (
                        <span className="ml-2 text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
                          {'{{section:' + section.placeholder_key + '}}'}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  {isLocked && <Lock className="h-4 w-4 text-gray-400" />}
                  {(content?.final_content || (content?.image_urls && content.image_urls.length > 0)) && (
                    <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded">
                      Content Added
                    </span>
                  )}
                  {isExpanded ? (
                    <ChevronUp className="h-5 w-5 text-gray-400" />
                  ) : (
                    <ChevronDown className="h-5 w-5 text-gray-400" />
                  )}
                </div>
              </button>

              {/* Section Body */}
              {isExpanded && (
                <div className="border-t border-gray-200 p-4 space-y-4">
                  {/* Options — cascade or flat depending on section config */}
                  {section.section_config?.mode === 'cascading' ? (
                    <CascadeSelector
                      section={section}
                      selections={content?.cascading_selections || {}}
                      onChange={(newSelections, cascadeContent) => {
                        setContents(prev => {
                          const newMap = new Map(prev);
                          const existing = newMap.get(section.id);
                          if (!existing || existing.is_finalized) return prev;
                          const custom = existing.custom_text?.trim() || '';
                          const combined = [cascadeContent, custom].filter(Boolean).join('\n\n');
                          newMap.set(section.id, {
                            ...existing,
                            cascading_selections: newSelections,
                            final_content: combined,
                          });
                          return newMap;
                        });
                      }}
                      disabled={isLocked}
                    />
                  ) : section.section_config?.mode === 'matrix' ? (
                    <MatrixEditor
                      section={section}
                      values={content?.cascading_selections || {}}
                      customText={content?.custom_text || ''}
                      disabled={isLocked}
                      onChange={(newSelections, finalContent) => {
                        setContents(prev => {
                          const newMap = new Map(prev);
                          const existing = newMap.get(section.id);
                          if (!existing || existing.is_finalized) return prev;
                          newMap.set(section.id, {
                            ...existing,
                            cascading_selections: newSelections,
                            final_content: finalContent,
                          });
                          return newMap;
                        });
                      }}
                    />
                  ) : (
                    /* Flat predefined options */
                    section.predefined_options && section.predefined_options.length > 0 && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Select from predefined options:
                        </label>
                        <div className="space-y-2">
                          {section.predefined_options.map((option, idx) => {
                            const isSelected = content?.selected_options.includes(idx);
                            const shortcutKey = idx < 26 ? String.fromCharCode(97 + idx) : null;
                            return (
                              <button
                                key={idx}
                                onClick={() => !isLocked && toggleOption(section.id, idx)}
                                disabled={isLocked}
                                className={`w-full text-left p-3 rounded-lg border transition-all ${
                                  isSelected
                                    ? 'bg-blue-50 border-blue-300 text-blue-900'
                                    : 'bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100'
                                } ${isLocked ? 'cursor-not-allowed opacity-75' : 'cursor-pointer'}`}
                              >
                                <div className="flex items-start">
                                  <CheckSquare
                                    className={`h-5 w-5 mr-3 mt-0.5 flex-shrink-0 ${
                                      isSelected ? 'text-blue-600' : 'text-gray-400'
                                    }`}
                                  />
                                  {shortcutKey && (
                                    <span className="inline-flex items-center justify-center w-5 h-5 mr-2 text-xs font-bold bg-gray-200 text-gray-600 rounded border border-gray-300 flex-shrink-0 mt-0.5">
                                      {shortcutKey.toUpperCase()}
                                    </span>
                                  )}
                                  <span className="text-sm">{option}</span>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )
                  )}

                  {/* Custom Text */}
                  {section.is_editable && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        {section.section_config?.mode === 'matrix'
                          ? 'Add notes below table (optional):'
                          : section.predefined_options?.length > 0
                            ? 'Add custom text (optional):'
                            : 'Enter content:'}
                      </label>
                      <textarea
                        value={content?.custom_text || ''}
                        onChange={(e) => canEditText && updateCustomText(section.id, e.target.value)}
                        disabled={!canEditText}
                        rows={4}
                        placeholder={section.default_content || 'Enter your findings, observations, or notes...'}
                        className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                          !canEditText ? 'bg-gray-100 cursor-not-allowed' : 'bg-white'
                        }`}
                      />
                    </div>
                  )}

                  {/* Section Attachments */}
                  {section.allow_images && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Section Attachments
                      </label>
                      <div className="flex items-center gap-3">
                        <label className={`inline-flex items-center px-3 py-2 rounded-lg border text-sm cursor-pointer transition-colors ${
                          isLocked ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                        }`}>
                          <ImagePlus className="h-4 w-4 mr-2" />
                          Add Images
                          <input
                            type="file"
                            accept="image/*"
                            multiple
                            disabled={isLocked}
                            onChange={(e) => uploadSectionImages(section.id, e.target.files)}
                            className="hidden"
                          />
                        </label>
                        {isUploading && (
                          <div className="flex items-center text-sm text-gray-500">
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Uploading...
                          </div>
                        )}
                      </div>

                      {content?.image_urls && content.image_urls.length > 0 && (
                        <div className="mt-3 grid grid-cols-2 gap-3">
                          {content.image_urls.map((url) => (
                            <div key={url} className="relative border rounded-lg overflow-hidden bg-gray-50">
                              <img
                                src={getOptimizedImageUrl(url)}
                                alt="Section attachment"
                                className="w-full h-32 object-cover"
                              />
                              {canEdit && (
                                <button
                                  type="button"
                                  onClick={() => removeSectionImage(section.id, url)}
                                  className="absolute top-2 right-2 p-1 bg-white/90 rounded-full shadow hover:bg-white"
                                >
                                  <Trash2 className="h-4 w-4 text-red-600" />
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* AI Assistant Button & Panel */}
                  {showAIAssistant && canEdit && section.is_editable && (
                    <div className="border-t border-gray-100 pt-4">
                      {showAIPanel === section.id ? (
                        <div className="bg-gradient-to-br from-purple-50 to-blue-50 border border-purple-200 rounded-lg p-4 space-y-4">
                          <div className="flex items-center justify-between">
                            <h4 className="font-medium text-purple-900 flex items-center">
                              <Sparkles className="h-5 w-5 mr-2 text-purple-600" />
                              AI Section Generator
                            </h4>
                            <button
                              onClick={closeAIPanel}
                              className="p-1 hover:bg-purple-100 rounded-full transition-colors"
                            >
                              <X className="h-4 w-4 text-purple-600" />
                            </button>
                          </div>

                          {/* Quick Prompts */}
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-2">
                              Quick prompts:
                            </label>
                            <div className="flex flex-wrap gap-2">
                              {getQuickPromptsForSection(section.section_type).map((prompt, idx) => (
                                <button
                                  key={idx}
                                  onClick={() => setAIPrompt(prompt)}
                                  className="text-xs px-3 py-1.5 bg-white border border-purple-200 rounded-full hover:bg-purple-50 hover:border-purple-300 transition-colors text-purple-700"
                                >
                                  {prompt}
                                </button>
                              ))}
                            </div>
                          </div>

                          {/* Custom Prompt Input */}
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-2">
                              Or describe what you need:
                            </label>
                            <textarea
                              value={aiPrompt}
                              onChange={(e) => setAIPrompt(e.target.value)}
                              placeholder="e.g., Generate peripheral smear findings for a patient with suspected anemia"
                              rows={3}
                              className="w-full px-3 py-2 border border-purple-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-sm"
                            />
                          </div>

                          {/* Generate Button */}
                          <button
                            onClick={() => generateWithAI(section)}
                            disabled={aiGenerating || !aiPrompt.trim()}
                            className="w-full flex items-center justify-center px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          >
                            {aiGenerating ? (
                              <>
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                Generating...
                              </>
                            ) : (
                              <>
                                <Wand2 className="h-4 w-4 mr-2" />
                                Generate with AI
                              </>
                            )}
                          </button>

                          {/* Error */}
                          {aiError && (
                            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                              {aiError}
                            </div>
                          )}

                          {/* AI Result Preview */}
                          {aiResult && (
                            <div className="space-y-3">
                              <label className="block text-xs font-medium text-gray-600">
                                Generated Content:
                              </label>
                              <div className="p-4 bg-white border border-purple-200 rounded-lg">
                                <div className="text-sm text-gray-800 whitespace-pre-wrap max-h-48 overflow-y-auto">
                                  {aiResult.generatedContent}
                                </div>
                              </div>

                              {/* Suggested Options */}
                              {aiResult.suggestedOptions && aiResult.suggestedOptions.length > 0 && (
                                <div>
                                  <label className="block text-xs font-medium text-gray-600 mb-2">
                                    Suggested predefined options to add:
                                  </label>
                                  <div className="flex flex-wrap gap-2">
                                    {aiResult.suggestedOptions.map((opt, idx) => (
                                      <span
                                        key={idx}
                                        className="text-xs px-2 py-1 bg-green-50 border border-green-200 rounded text-green-700"
                                      >
                                        {opt}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}

                              <button
                                onClick={() => applyAIContent(section.id)}
                                className="w-full flex items-center justify-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                              >
                                <CheckSquare className="h-4 w-4 mr-2" />
                                Apply to Section
                              </button>
                            </div>
                          )}
                        </div>
                      ) : (
                        <button
                          onClick={() => openAIPanel(section.id)}
                          className="flex items-center px-4 py-2 text-purple-600 bg-purple-50 border border-purple-200 rounded-lg hover:bg-purple-100 transition-colors"
                        >
                          <Sparkles className="h-4 w-4 mr-2" />
                          AI Assistant
                        </button>
                      )}
                    </div>
                  )}

                  {/* Preview — editable so the user can fine-tune the composed content */}
	                  {(content?.final_content || (content?.image_urls && content.image_urls.length > 0)) && (
	                    <div>
	                      <label className="block text-sm font-medium text-gray-700 mb-2">
	                        Preview (will appear in report):
	                      </label>
	                      <div className="bg-gray-50 border border-gray-200 rounded-lg space-y-3 overflow-hidden">
	                        {content?.final_content !== undefined && (
	                          section.section_config?.mode === 'matrix' ? (
	                            <div className="px-4 py-3">
	                              <div
	                                className="text-sm text-gray-800 overflow-x-auto"
	                                dangerouslySetInnerHTML={{ __html: content.final_content }}
	                              />
	                            </div>
	                          ) : (
	                            <textarea
	                              value={content.final_content}
	                              onChange={(e) => !isLocked && updateFinalContent(section.id, e.target.value)}
	                              disabled={isLocked}
	                              rows={6}
	                              className={`w-full px-4 py-3 text-sm text-gray-800 bg-transparent border-0 focus:ring-2 focus:ring-blue-400 focus:outline-none resize-y ${
	                                isLocked ? 'cursor-not-allowed text-gray-500' : ''
	                              }`}
	                            />
	                          )
	                        )}
	                        {content?.image_urls && content.image_urls.length > 0 && (
	                          <div className="grid grid-cols-2 gap-3 px-4 pb-3">
                            {content.image_urls.map((url) => (
                              <img
                                key={url}
                                src={getOptimizedImageUrl(url)}
                                alt="Section attachment"
                                className="w-full h-28 object-cover rounded border"
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {!readOnly && (
        <div className="flex justify-end pt-2">
          <button
            onClick={saveAll}
            disabled={saving}
            className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            Save Sections
          </button>
        </div>
      )}
    </div>
  );
});

export default SectionEditor;
