/**
 * ManageReportSections - Admin page for configuring pre-defined report sections
 * 
 * Used to create section templates for PBS, Radiology, etc. with predefined options
 * that doctors can select during result verification.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Plus,
  Edit2,
  Trash2,
  X,
  FileText,
  CheckSquare,
  AlertCircle,
  Loader2,
  GripVertical,
  Sparkles,
  Send,
  Lightbulb
} from 'lucide-react';
import { database } from '../../utils/supabase';
import { generateSectionContent, getQuickPromptsForSection } from '../../utils/aiSectionService';

// Types
interface TemplateSection {
  id: string;
  lab_id: string;
  template_id?: string;
  test_group_id?: string;
  section_type: string;
  section_name: string;
  display_order: number;
  default_content?: string;
  predefined_options: string[];
  is_required: boolean;
  is_editable: boolean;
  allow_images?: boolean;
  allow_technician_entry?: boolean;
  placeholder_key?: string;
  created_at: string;
  test_groups?: { id: string; name: string };
  lab_templates?: { id: string; template_name: string };
}

interface TestGroup {
  id: string;
  name: string;
  category: string;
}

const SECTION_TYPES = [
  { value: 'findings', label: 'Findings', icon: '🔍' },
  { value: 'impression', label: 'Impression', icon: '💡' },
  { value: 'recommendation', label: 'Recommendation', icon: '📋' },
  { value: 'technique', label: 'Technique', icon: '⚙️' },
  { value: 'clinical_history', label: 'Clinical History', icon: '📜' },
  { value: 'conclusion', label: 'Conclusion', icon: '✅' },
  { value: 'custom', label: 'Custom', icon: '📝' },
];

// ============================================
// CASCADE TYPES
// ============================================

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

// ============================================
// CASCADE TREE HELPERS (immutable updates)
// ============================================

const genId = () => Math.random().toString(36).slice(2, 11);
const DEFAULT_MATRIX_CONFIG: MatrixConfig = {
  rows: ['RE', 'LE'],
  columns: ['SPH', 'CYL', 'AXIS', 'ADD'],
};

function updateLevelLabelInTree(levels: CascadeLevel[], levelId: string, label: string): CascadeLevel[] {
  return levels.map(lvl =>
    lvl.id === levelId
      ? { ...lvl, label }
      : { ...lvl, options: lvl.options.map(opt => ({ ...opt, sub_levels: opt.sub_levels ? updateLevelLabelInTree(opt.sub_levels, levelId, label) : undefined })) }
  );
}

function toggleMultiSelectInTree(levels: CascadeLevel[], levelId: string): CascadeLevel[] {
  return levels.map(lvl =>
    lvl.id === levelId
      ? { ...lvl, multi_select: !lvl.multi_select }
      : { ...lvl, options: lvl.options.map(opt => ({ ...opt, sub_levels: opt.sub_levels ? toggleMultiSelectInTree(opt.sub_levels, levelId) : undefined })) }
  );
}

function removeLevelFromTree(levels: CascadeLevel[], levelId: string): CascadeLevel[] {
  return levels
    .filter(lvl => lvl.id !== levelId)
    .map(lvl => ({ ...lvl, options: lvl.options.map(opt => ({ ...opt, sub_levels: opt.sub_levels ? removeLevelFromTree(opt.sub_levels, levelId) : undefined })) }));
}

function addOptionToLevelInTree(levels: CascadeLevel[], levelId: string, option: CascadeOption): CascadeLevel[] {
  return levels.map(lvl =>
    lvl.id === levelId
      ? { ...lvl, options: [...lvl.options, option] }
      : { ...lvl, options: lvl.options.map(opt => ({ ...opt, sub_levels: opt.sub_levels ? addOptionToLevelInTree(opt.sub_levels, levelId, option) : undefined })) }
  );
}

function updateOptionValueInTree(levels: CascadeLevel[], optionId: string, value: string): CascadeLevel[] {
  return levels.map(lvl => ({
    ...lvl,
    options: lvl.options.map(opt => {
      if (opt.id === optionId) return { ...opt, value };
      return { ...opt, sub_levels: opt.sub_levels ? updateOptionValueInTree(opt.sub_levels, optionId, value) : undefined };
    }),
  }));
}

function removeOptionFromTree(levels: CascadeLevel[], optionId: string): CascadeLevel[] {
  return levels.map(lvl => ({
    ...lvl,
    options: lvl.options
      .filter(opt => opt.id !== optionId)
      .map(opt => ({ ...opt, sub_levels: opt.sub_levels ? removeOptionFromTree(opt.sub_levels, optionId) : undefined })),
  }));
}

function addSubLevelToOptionInTree(levels: CascadeLevel[], optionId: string, newLevel: CascadeLevel): CascadeLevel[] {
  return levels.map(lvl => ({
    ...lvl,
    options: lvl.options.map(opt => {
      if (opt.id === optionId) return { ...opt, sub_levels: [...(opt.sub_levels || []), newLevel] };
      return { ...opt, sub_levels: opt.sub_levels ? addSubLevelToOptionInTree(opt.sub_levels, optionId, newLevel) : undefined };
    }),
  }));
}

function clearSubLevelsInTree(levels: CascadeLevel[], optionId: string): CascadeLevel[] {
  return levels.map(lvl => ({
    ...lvl,
    options: lvl.options.map(opt => {
      if (opt.id === optionId) return { ...opt, sub_levels: undefined };
      return { ...opt, sub_levels: opt.sub_levels ? clearSubLevelsInTree(opt.sub_levels, optionId) : undefined };
    }),
  }));
}

// ============================================
// CASCADE LEVEL BUILDER COMPONENT
// ============================================

const DEPTH_STYLES = [
  { bg: 'bg-blue-50', border: 'border-blue-200', dot: 'bg-blue-400' },
  { bg: 'bg-green-50', border: 'border-green-200', dot: 'bg-green-400' },
  { bg: 'bg-purple-50', border: 'border-purple-200', dot: 'bg-purple-400' },
  { bg: 'bg-orange-50', border: 'border-orange-200', dot: 'bg-orange-400' },
  { bg: 'bg-gray-50', border: 'border-gray-200', dot: 'bg-gray-400' },
];

interface CascadeLevelBuilderProps {
  levels: CascadeLevel[];
  onChange: (levels: CascadeLevel[]) => void;
  depth?: number;
}

const CascadeLevelBuilder: React.FC<CascadeLevelBuilderProps> = ({ levels, onChange, depth = 0 }) => {
  const style = DEPTH_STYLES[depth % DEPTH_STYLES.length];

  return (
    <div className="space-y-3">
      {levels.map(level => (
        <div key={level.id} className={`border rounded-lg p-3 ${style.bg} ${style.border}`}>
          {/* Level header row */}
          <div className="flex items-center gap-2 mb-3">
            <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${style.dot}`} />
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex-shrink-0">Level</span>
            <input
              type="text"
              value={level.label}
              onChange={e => onChange(updateLevelLabelInTree(levels, level.id, e.target.value))}
              placeholder="e.g. Specimen Type, Gross Examination..."
              className="flex-1 px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-400 bg-white"
            />
            <label className="flex items-center gap-1 text-xs text-gray-600 whitespace-nowrap cursor-pointer select-none">
              <input
                type="checkbox"
                checked={level.multi_select}
                onChange={() => onChange(toggleMultiSelectInTree(levels, level.id))}
                className="w-3 h-3"
              />
              Multi-select
            </label>
            <button
              type="button"
              onClick={() => onChange(removeLevelFromTree(levels, level.id))}
              className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded flex-shrink-0"
              title="Remove this level"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Options list */}
          <div className="space-y-2 ml-4">
            {level.options.map(option => (
              <div key={option.id}>
                <div className="flex items-center gap-2">
                  <GripVertical className="w-4 h-4 text-gray-300 flex-shrink-0" />
                  <input
                    type="text"
                    value={option.value}
                    onChange={e => onChange(updateOptionValueInTree(levels, option.id, e.target.value))}
                    placeholder={`Option ${level.options.indexOf(option) + 1}`}
                    className="flex-1 px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-400 bg-white"
                  />
                  {option.sub_levels && option.sub_levels.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => onChange(clearSubLevelsInTree(levels, option.id))}
                      className="px-2 py-1 text-xs text-orange-600 border border-orange-200 rounded hover:bg-orange-50 whitespace-nowrap"
                      title="Remove sub-levels for this option"
                    >
                      ↳ Clear
                    </button>
	                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        const newLevel: CascadeLevel = {
                          id: genId(),
                          label: '',
                          multi_select: false,
                          options: [{ id: genId(), value: '' }],
                        };
                        onChange(addSubLevelToOptionInTree(levels, option.id, newLevel));
                      }}
                      className="px-2 py-1 text-xs text-blue-600 border border-blue-200 rounded hover:bg-blue-50 whitespace-nowrap"
                      title="Add a sub-level revealed when this option is selected"
                    >
                      ↳ Sub-level
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onChange(removeOptionFromTree(levels, option.id))}
                    className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded flex-shrink-0"
                    title="Remove this option"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>

                {/* Recursive sub-levels under this option */}
                {option.sub_levels && option.sub_levels.length > 0 && (
                  <div className="ml-8 mt-2">
                    <CascadeLevelBuilder
                      levels={option.sub_levels}
                      onChange={newSubLevels => {
                        const updatedLevels = levels.map(lvl => ({
                          ...lvl,
                          options: lvl.options.map(opt =>
                            opt.id === option.id ? { ...opt, sub_levels: newSubLevels } : opt
                          ),
                        }));
                        onChange(updatedLevels);
                      }}
                      depth={depth + 1}
                    />
                  </div>
                )}
              </div>
            ))}

            <button
              type="button"
              onClick={() => onChange(addOptionToLevelInTree(levels, level.id, { id: genId(), value: '' }))}
              className="text-sm text-blue-600 hover:text-blue-700 hover:underline"
            >
              + Add Option
            </button>
          </div>
        </div>
      ))}

      {/* Add a new root-level level */}
      <button
        type="button"
        onClick={() => {
          const newLevel: CascadeLevel = {
            id: genId(),
            label: '',
            multi_select: false,
            options: [{ id: genId(), value: '' }],
          };
          onChange([...levels, newLevel]);
        }}
        className="w-full py-2 text-sm text-blue-600 border-2 border-dashed border-blue-200 rounded-lg hover:bg-blue-50 transition-colors"
      >
        + Add Level
      </button>
    </div>
  );
};

interface MatrixBuilderProps {
  config: MatrixConfig;
  onChange: (config: MatrixConfig) => void;
}

const MatrixBuilder: React.FC<MatrixBuilderProps> = ({ config, onChange }) => {
  const updateRow = (index: number, value: string) => {
    onChange({
      ...config,
      rows: config.rows.map((row, idx) => idx === index ? value : row),
    });
  };

  const updateColumn = (index: number, value: string) => {
    onChange({
      ...config,
      columns: config.columns.map((column, idx) => idx === index ? value : column),
    });
  };

  const addRow = () => onChange({ ...config, rows: [...config.rows, `Row ${config.rows.length + 1}`] });
  const addColumn = () => onChange({ ...config, columns: [...config.columns, `Col ${config.columns.length + 1}`] });

  const removeRow = (index: number) => {
    if (config.rows.length <= 1) return;
    onChange({ ...config, rows: config.rows.filter((_, idx) => idx !== index) });
  };

  const removeColumn = (index: number) => {
    if (config.columns.length <= 1) return;
    onChange({ ...config, columns: config.columns.filter((_, idx) => idx !== index) });
  };

  return (
    <div className="space-y-4">
      <div className="text-xs text-gray-500 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
        Configure the table headers and row labels. Users will get a grid input UI and the report will render as a real table.
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">Rows</span>
            <button type="button" onClick={addRow} className="text-sm text-blue-600 hover:text-blue-700">
              + Add Row
            </button>
          </div>
          <div className="space-y-2">
            {config.rows.map((row, index) => (
              <div key={`row-${index}`} className="flex items-center gap-2">
                <input
                  type="text"
                  value={row}
                  onChange={(e) => updateRow(index, e.target.value)}
                  className="flex-1 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                  placeholder={`Row ${index + 1}`}
                />
                {config.rows.length > 1 && (
                  <button type="button" onClick={() => removeRow(index)} className="p-1 text-gray-400 hover:text-red-600">
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">Columns</span>
            <button type="button" onClick={addColumn} className="text-sm text-blue-600 hover:text-blue-700">
              + Add Column
            </button>
          </div>
          <div className="space-y-2">
            {config.columns.map((column, index) => (
              <div key={`col-${index}`} className="flex items-center gap-2">
                <input
                  type="text"
                  value={column}
                  onChange={(e) => updateColumn(index, e.target.value)}
                  className="flex-1 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                  placeholder={`Column ${index + 1}`}
                />
                {config.columns.length > 1 && (
                  <button type="button" onClick={() => removeColumn(index)} className="p-1 text-gray-400 hover:text-red-600">
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-700">Cell Options (dropdown)</span>
          <span className="text-xs text-gray-400">Leave empty for free-text. Add options for dropdowns (e.g. S, I, R).</span>
        </div>
        <input
          type="text"
          value={(config.cellOptions || []).join(', ')}
          onChange={(e) => {
            const opts = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
            onChange({ ...config, cellOptions: opts });
          }}
          className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
          placeholder="e.g.  S, I, R  — comma-separated"
        />
        {(config.cellOptions || []).length > 0 && (
          <p className="text-xs text-gray-500 mt-1">
            First option = green (sensitive), last = red (resistant), middle = orange.
          </p>
        )}
      </div>
    </div>
  );
};

const ManageReportSections: React.FC = () => {
  // State
  const [sections, setSections] = useState<TemplateSection[]>([]);
  const [testGroups, setTestGroups] = useState<TestGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [editingSection, setEditingSection] = useState<TemplateSection | null>(null);
  const [formData, setFormData] = useState<{
    test_group_id: string;
    section_type: string;
    section_name: string;
    display_order: number;
    default_content: string;
    predefined_options: string[];
    is_required: boolean;
    is_editable: boolean;
    allow_images: boolean;
    allow_technician_entry: boolean;
    placeholder_key: string;
    section_config: SectionConfig;
  }>({
    test_group_id: '',
    section_type: 'findings',
    section_name: '',
    display_order: 0,
    default_content: '',
    predefined_options: [''],
    is_required: false,
    is_editable: true,
    allow_images: false,
    allow_technician_entry: false,
    placeholder_key: '',
    section_config: { mode: 'flat', cascade_levels: [], matrix: DEFAULT_MATRIX_CONFIG },
  });

  // AI Assistant state
  const [showAIPanel, setShowAIPanel] = useState(false);
  const [aiPrompt, setAIPrompt] = useState('');
  const [aiLoading, setAILoading] = useState(false);
  const [aiError, setAIError] = useState<string | null>(null);

  // Filter state
  const [filterTestGroup, setFilterTestGroup] = useState<string>('');

  // Load data
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      // Load sections
      const { data: sectionsData, error: sectionsErr } = await database.templateSections.getAll();
      if (sectionsErr) throw sectionsErr;
      setSections(sectionsData || []);

      // Load test groups for dropdown
      const { data: groupsData, error: groupsErr } = await database.testGroups.getAll();
      if (groupsErr) throw groupsErr;
      setTestGroups(groupsData || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Reset form
  const resetForm = () => {
    setFormData({
      test_group_id: '',
      section_type: 'findings',
      section_name: '',
      display_order: 0,
      default_content: '',
      predefined_options: [''],
      is_required: false,
      is_editable: true,
      allow_images: false,
      allow_technician_entry: false,
      placeholder_key: '',
      section_config: { mode: 'flat', cascade_levels: [], matrix: DEFAULT_MATRIX_CONFIG },
    });
    setEditingSection(null);
    setShowAIPanel(false);
    setAIPrompt('');
    setAIError(null);
  };

  // Handle AI generation
  const handleAIGenerate = async () => {
    if (!aiPrompt.trim()) {
      setAIError('Please enter instructions for the AI');
      return;
    }

    const selectedTestGroup = testGroups.find(tg => tg.id === formData.test_group_id);

    setAILoading(true);
    setAIError(null);

    try {
      const result = await generateSectionContent({
        sectionType: formData.section_type,
        sectionName: formData.section_name || `${selectedTestGroup?.name || 'Unknown'} ${SECTION_TYPES.find(t => t.value === formData.section_type)?.label || 'Section'}`,
        testGroupName: selectedTestGroup?.name,
        userPrompt: aiPrompt,
        existingOptions: formData.predefined_options.filter(o => o.trim())
      });

      if (result.error) {
        setAIError(result.error);
        return;
      }

      if (result.data) {
        // Update form with AI-generated content
        const aiData = result.data!;
        setFormData(prev => ({
          ...prev,
          section_name: aiData.sectionHeading || prev.section_name,
          default_content: aiData.generatedContent || prev.default_content,
          predefined_options: aiData.suggestedOptions?.length
            ? aiData.suggestedOptions
            : prev.predefined_options,
          section_config: aiData.section_config
            ? (aiData.section_config as SectionConfig)
            : prev.section_config,
        }));

        setSuccess('AI generated section content successfully!');
        setTimeout(() => setSuccess(null), 3000);
      }
    } catch (err: any) {
      setAIError(err.message || 'Failed to generate content');
    } finally {
      setAILoading(false);
    }
  };

  // Get quick prompts based on section type and test group
  const getQuickPrompts = () => {
    const selectedTestGroup = testGroups.find(tg => tg.id === formData.test_group_id);
    const testName = selectedTestGroup?.name?.toLowerCase() || '';

    // Combine section type prompts with test-specific hints
    const basePrompts = getQuickPromptsForSection(formData.section_type);

    if (testName.includes('peripheral') || testName.includes('smear') || testName.includes('pbs')) {
      return [
        'Generate normal PBS findings template',
        'Create findings for iron deficiency anemia',
        'Generate PBS findings for leukemia workup',
        ...basePrompts.slice(0, 2)
      ];
    }

    if (testName.includes('urine') || testName.includes('urinalysis')) {
      return [
        'Generate normal urinalysis findings',
        'Create findings for UTI',
        'Generate findings for kidney disease workup',
        ...basePrompts.slice(0, 2)
      ];
    }

    // Cascading prompts for biopsy/histopathology
    if (testName.includes('biopsy') || testName.includes('histopath')) {
      return [
        'Create a cascading form for biopsy: Specimen Type → Gross Examination → Microscopic Examination → Anatomical Site',
        'Create a cascading smart form for histopathology findings',
        ...basePrompts.slice(0, 1)
      ];
    }

    // Cascading prompts for microbiology/culture
    if (testName.includes('micro') || testName.includes('culture') || testName.includes('sensitivity')) {
      return [
        'Create a cascading form for microbiology: Organism Found → Sensitivity Pattern → Antibiotics Tested',
        'Create a cascading smart form for culture & sensitivity report',
        ...basePrompts.slice(0, 1)
      ];
    }

    return basePrompts;
  };

  // Open form for editing
  const handleEdit = (section: TemplateSection) => {
    setEditingSection(section);
    setFormData({
      test_group_id: section.test_group_id || '',
      section_type: section.section_type,
      section_name: section.section_name,
      display_order: section.display_order,
      default_content: section.default_content || '',
      predefined_options: section.predefined_options?.length > 0 ? section.predefined_options : [''],
      is_required: section.is_required,
      is_editable: section.is_editable,
      allow_images: section.allow_images ?? false,
      allow_technician_entry: section.allow_technician_entry ?? false,
      placeholder_key: section.placeholder_key || '',
      section_config: {
        mode: ((section as any).section_config?.mode || 'flat'),
        cascade_levels: (section as any).section_config?.cascade_levels || [],
        matrix: (section as any).section_config?.matrix || DEFAULT_MATRIX_CONFIG,
      },
    });
    setShowForm(true);
  };

  // Handle form submit
  const getBlankSectionForm = (testGroupId = '') => ({
    test_group_id: testGroupId,
    section_type: 'findings',
    section_name: '',
    display_order: 0,
    default_content: '',
    predefined_options: [''],
    is_required: false,
    is_editable: true,
    allow_images: false,
    allow_technician_entry: false,
    placeholder_key: '',
    section_config: { mode: 'flat' as const, cascade_levels: [], matrix: DEFAULT_MATRIX_CONFIG },
  });

  const handleSubmit = async (
    e: React.FormEvent,
    options?: { addAnother?: boolean }
  ) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    try {
      // Validate
      if (!formData.test_group_id) {
        throw new Error('Please select a test group');
      }
      if (!formData.section_name.trim()) {
        throw new Error('Section name is required');
      }

      // Filter out empty options (only used in flat mode)
      const usesStructuredConfig = formData.section_config.mode === 'cascading' || formData.section_config.mode === 'matrix';
      const cleanedOptions = usesStructuredConfig
        ? []
        : formData.predefined_options.filter(opt => opt.trim() !== '');

      const sectionData = {
        test_group_id: formData.test_group_id,
        section_type: formData.section_type,
        section_name: formData.section_name.trim(),
        display_order: formData.display_order,
        default_content: formData.default_content.trim(),
        predefined_options: cleanedOptions,
        is_required: formData.is_required,
        is_editable: formData.is_editable,
        allow_images: formData.allow_images,
        allow_technician_entry: formData.allow_technician_entry,
        placeholder_key: formData.placeholder_key.trim() || formData.section_type,
        section_config: formData.section_config,
      };

      if (editingSection) {
        // Update
        const { error: updateErr } = await database.templateSections.update(editingSection.id, sectionData);
        if (updateErr) throw updateErr;
        setSuccess('Section updated successfully');
      } else {
        // Create
        const { error: createErr } = await database.templateSections.create(sectionData);
        if (createErr) throw createErr;
        setSuccess('Section created successfully');
      }

      await loadData();

      if (options?.addAnother) {
        const preservedTestGroupId = formData.test_group_id;
        setEditingSection(null);
        setFormData(getBlankSectionForm(preservedTestGroupId));
      } else {
        setShowForm(false);
        resetForm();
      }
    } catch (err: any) {
      setError(err.message || 'Failed to save section');
    } finally {
      setSaving(false);
    }
  };

  // Handle delete
  const handleDelete = async (id: string) => {
    if (!confirm('Delete this section? All result content entered for this section across all orders will also be permanently deleted.')) return;

    try {
      const { error: deleteErr } = await database.templateSections.delete(id);
      if (deleteErr) throw deleteErr;
      setSuccess('Section deleted');
      loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to delete section');
    }
  };

  // Add predefined option
  const addOption = () => {
    setFormData(prev => ({
      ...prev,
      predefined_options: [...prev.predefined_options, '']
    }));
  };

  // Remove predefined option
  const removeOption = (index: number) => {
    setFormData(prev => ({
      ...prev,
      predefined_options: prev.predefined_options.filter((_, i) => i !== index)
    }));
  };

  // Update predefined option
  const updateOption = (index: number, value: string) => {
    setFormData(prev => ({
      ...prev,
      predefined_options: prev.predefined_options.map((opt, i) => i === index ? value : opt)
    }));
  };

  // Filter sections by test group
  const filteredSections = filterTestGroup
    ? sections.filter(s => s.test_group_id === filterTestGroup)
    : sections;

  // Group sections by test group for display
  const groupedSections = filteredSections.reduce((acc, section) => {
    const groupName = section.test_groups?.name || 'Unassigned';
    if (!acc[groupName]) acc[groupName] = [];
    acc[groupName].push(section);
    return acc;
  }, {} as Record<string, TemplateSection[]>);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        <span className="ml-2 text-gray-600">Loading sections...</span>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Report Sections</h1>
          <p className="text-gray-600 mt-1">
            Configure pre-defined sections for PBS, Radiology, and other reports
          </p>
        </div>
        <button
          onClick={() => { resetForm(); setShowForm(true); }}
          className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-5 h-5 mr-2" />
          Add Section
        </button>
      </div>

      {/* Alerts */}
      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center">
          <AlertCircle className="w-5 h-5 text-red-600 mr-2" />
          <span className="text-red-700">{error}</span>
          <button onClick={() => setError(null)} className="ml-auto">
            <X className="w-4 h-4 text-red-600" />
          </button>
        </div>
      )}
      {success && (
        <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg flex items-center">
          <CheckSquare className="w-5 h-5 text-green-600 mr-2" />
          <span className="text-green-700">{success}</span>
          <button onClick={() => setSuccess(null)} className="ml-auto">
            <X className="w-4 h-4 text-green-600" />
          </button>
        </div>
      )}

      {/* Filter */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-1">Filter by Test Group</label>
        <select
          value={filterTestGroup}
          onChange={(e) => setFilterTestGroup(e.target.value)}
          className="w-64 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All Test Groups</option>
          {testGroups.map(tg => (
            <option key={tg.id} value={tg.id}>{tg.name}</option>
          ))}
        </select>
      </div>

      {/* Sections List */}
      {Object.keys(groupedSections).length === 0 ? (
        <div className="text-center py-12 bg-gray-50 rounded-lg">
          <FileText className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900">No sections configured</h3>
          <p className="text-gray-600 mt-1">Create your first report section template</p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(groupedSections).map(([groupName, groupSections]) => (
            <div key={groupName} className="bg-white rounded-lg border shadow-sm">
              <div className="px-4 py-3 bg-gray-50 border-b rounded-t-lg">
                <h3 className="font-semibold text-gray-900">{groupName}</h3>
                <span className="text-sm text-gray-500">{groupSections.length} section(s)</span>
              </div>
              <div className="divide-y">
                {groupSections
                  .sort((a, b) => a.display_order - b.display_order)
                  .map(section => (
                    <div key={section.id} className="p-4 hover:bg-gray-50">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center space-x-2">
                            <span className="text-lg">
                              {SECTION_TYPES.find(t => t.value === section.section_type)?.icon || '📝'}
                            </span>
                            <h4 className="font-medium text-gray-900">{section.section_name}</h4>
                            <span className="px-2 py-0.5 text-xs bg-blue-100 text-blue-700 rounded-full">
                              {section.section_type}
                            </span>
                            {section.is_required && (
                              <span className="px-2 py-0.5 text-xs bg-red-100 text-red-700 rounded-full">
                                Required
                              </span>
                            )}
                            {section.allow_technician_entry && (
                              <span className="px-2 py-0.5 text-xs bg-amber-100 text-amber-700 rounded-full">
                                Technician Entry
                              </span>
                            )}
                            {section.allow_images && (
                              <span className="px-2 py-0.5 text-xs bg-purple-100 text-purple-700 rounded-full">
                                Images
                              </span>
                            )}
                          </div>

                          {section.default_content && (
                            <p className="text-sm text-gray-600 mt-1">
                              Default: {section.default_content.substring(0, 100)}...
                            </p>
                          )}

                          {section.predefined_options?.length > 0 && (
                            <div className="mt-2">
                              <span className="text-xs text-gray-500">
                                {section.predefined_options.length} predefined options
                              </span>
                              <div className="flex flex-wrap gap-1 mt-1">
                                {section.predefined_options.slice(0, 3).map((opt, i) => (
                                  <span key={i} className="px-2 py-0.5 text-xs bg-gray-100 text-gray-700 rounded">
                                    {opt.substring(0, 30)}{opt.length > 30 ? '...' : ''}
                                  </span>
                                ))}
                                {section.predefined_options.length > 3 && (
                                  <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-500 rounded">
                                    +{section.predefined_options.length - 3} more
                                  </span>
                                )}
                              </div>
                            </div>
                          )}

                          <div className="mt-2 text-xs text-gray-400">
                            Placeholder: <code className="bg-gray-100 px-1 rounded">{'{{section:' + (section.placeholder_key || section.section_type) + '}}'}</code>
                          </div>
                        </div>

                        <div className="flex items-center space-x-2">
                          <button
                            onClick={() => handleEdit(section)}
                            className="p-2 text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(section.id)}
                            className="p-2 text-gray-600 hover:text-red-600 hover:bg-red-50 rounded"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b flex items-center justify-between">
              <h2 className="text-xl font-semibold">
                {editingSection ? 'Edit Section' : 'Create Section'}
              </h2>
              <button onClick={() => { setShowForm(false); resetForm(); }}>
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {/* Test Group */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Test Group <span className="text-red-500">*</span>
                </label>
                <select
                  value={formData.test_group_id}
                  onChange={(e) => setFormData(prev => ({ ...prev, test_group_id: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                  required
                >
                  <option value="">Select test group...</option>
                  {testGroups.map(tg => (
                    <option key={tg.id} value={tg.id}>{tg.name} ({tg.category})</option>
                  ))}
                </select>
              </div>

              {/* AI Assistant Toggle - only show when test group is selected */}
              {formData.test_group_id && (
                <div className="border rounded-lg overflow-hidden bg-gradient-to-r from-purple-50 to-indigo-50">
                  <button
                    type="button"
                    onClick={() => setShowAIPanel(!showAIPanel)}
                    className="w-full px-4 py-3 flex items-center justify-between hover:bg-purple-100/50 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-5 h-5 text-purple-600" />
                      <span className="font-medium text-purple-800">AI Assistant</span>
                      <span className="text-xs text-purple-600 bg-purple-100 px-2 py-0.5 rounded-full">
                        Generate Content
                      </span>
                    </div>
                    <span className="text-purple-600 text-sm">
                      {showAIPanel ? '▲ Hide' : '▼ Expand'}
                    </span>
                  </button>

                  {showAIPanel && (
                    <div className="p-4 border-t border-purple-200 space-y-3">
                      {/* Quick Prompts */}
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <Lightbulb className="w-4 h-4 text-amber-500" />
                          <span className="text-sm font-medium text-gray-700">Quick Prompts</span>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {getQuickPrompts().map((prompt, idx) => (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => setAIPrompt(prompt)}
                              className="text-xs px-2 py-1 bg-white border border-purple-200 rounded-full hover:bg-purple-100 text-purple-700 transition-colors"
                            >
                              {prompt}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Custom Prompt Input */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Your Instructions
                        </label>
                        <textarea
                          value={aiPrompt}
                          onChange={(e) => setAIPrompt(e.target.value)}
                          className="w-full px-3 py-2 border border-purple-200 rounded-lg focus:ring-2 focus:ring-purple-500 text-sm"
                          rows={3}
                          placeholder="Describe what you want in this section... e.g., 'Generate a Peripheral Smear findings template with normal values and common abnormal findings options'"
                        />
                      </div>

                      {/* AI Error */}
                      {aiError && (
                        <div className="p-2 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-center gap-2">
                          <AlertCircle className="w-4 h-4" />
                          {aiError}
                        </div>
                      )}

                      {/* Generate Button */}
                      <button
                        type="button"
                        onClick={handleAIGenerate}
                        disabled={aiLoading || !aiPrompt.trim()}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-lg hover:from-purple-700 hover:to-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                      >
                        {aiLoading ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Generating...
                          </>
                        ) : (
                          <>
                            <Send className="w-4 h-4" />
                            Generate Section Content
                          </>
                        )}
                      </button>

                      <p className="text-xs text-gray-500 text-center">
                        AI generates Section Name, Default Content, and Options — say "cascading" or "smart form" to get a decision-tree form
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Section Type & Name */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Section Type <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={formData.section_type}
                    onChange={(e) => setFormData(prev => ({
                      ...prev,
                      section_type: e.target.value,
                      placeholder_key: e.target.value
                    }))}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                  >
                    {SECTION_TYPES.map(type => (
                      <option key={type.value} value={type.value}>
                        {type.icon} {type.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Section Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.section_name}
                    onChange={(e) => setFormData(prev => ({ ...prev, section_name: e.target.value }))}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="e.g., Peripheral Smear Findings"
                    required
                  />
                </div>
              </div>

              {/* Display Order & Placeholder */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Display Order</label>
                  <input
                    type="number"
                    value={formData.display_order}
                    onChange={(e) => setFormData(prev => ({ ...prev, display_order: parseInt(e.target.value) || 0 }))}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                    min="0"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Placeholder Key</label>
                  <input
                    type="text"
                    value={formData.placeholder_key}
                    onChange={(e) => setFormData(prev => ({ ...prev, placeholder_key: e.target.value }))}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="e.g., findings"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Use in template as: {'{{section:' + (formData.placeholder_key || formData.section_type) + '}}'}
                  </p>
                </div>
              </div>

              {/* Default Content */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Default Content</label>
                <textarea
                  value={formData.default_content}
                  onChange={(e) => setFormData(prev => ({ ...prev, default_content: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                  rows={2}
                  placeholder="Pre-filled text that appears when section is initialized..."
                />
              </div>

              {/* Options Mode Toggle + Builder */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Options Mode</label>
                <div className="flex rounded-lg border border-gray-300 overflow-hidden mb-4">
                  <button
                    type="button"
                    onClick={() => setFormData(prev => ({ ...prev, section_config: { ...prev.section_config, mode: 'flat' } }))}
                    className={`flex-1 py-2 text-sm font-medium transition-colors ${
                      formData.section_config.mode === 'flat'
                        ? 'bg-blue-600 text-white'
                        : 'bg-white text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    Flat Options
                  </button>
	                  <button
	                    type="button"
	                    onClick={() => setFormData(prev => ({ ...prev, section_config: { ...prev.section_config, mode: 'cascading' } }))}
                    className={`flex-1 py-2 text-sm font-medium transition-colors border-l ${
                      formData.section_config.mode === 'cascading'
                        ? 'bg-blue-600 text-white'
                        : 'bg-white text-gray-600 hover:bg-gray-50'
                    }`}
	                  >
	                    Cascading (Smart Form)
	                  </button>
	                  <button
	                    type="button"
	                    onClick={() => setFormData(prev => ({
	                      ...prev,
	                      section_config: {
	                        ...prev.section_config,
	                        mode: 'matrix',
	                        matrix: prev.section_config.matrix || DEFAULT_MATRIX_CONFIG,
	                      },
	                    }))}
	                    className={`flex-1 py-2 text-sm font-medium transition-colors border-l ${
	                      formData.section_config.mode === 'matrix'
	                        ? 'bg-blue-600 text-white'
	                        : 'bg-white text-gray-600 hover:bg-gray-50'
	                    }`}
	                  >
	                    Matrix Table
	                  </button>
	                </div>

                {formData.section_config.mode === 'flat' ? (
                  /* ── FLAT options ── */
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-gray-600">Click-to-select sentences for the doctor</span>
                      <button type="button" onClick={addOption} className="text-sm text-blue-600 hover:text-blue-700">
                        + Add Option
                      </button>
                    </div>
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {formData.predefined_options.map((option, index) => (
                        <div key={index} className="flex items-center space-x-2">
                          <GripVertical className="w-4 h-4 text-gray-400" />
                          <input
                            type="text"
                            value={option}
                            onChange={(e) => updateOption(index, e.target.value)}
                            className="flex-1 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                            placeholder={`Option ${index + 1}`}
                          />
                          {formData.predefined_options.length > 1 && (
                            <button type="button" onClick={() => removeOption(index)} className="p-1 text-gray-400 hover:text-red-600">
                              <X className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-gray-500 mt-2">
                      Doctors will click to select these sentences when filling the section.
                    </p>
                  </div>
                ) : formData.section_config.mode === 'cascading' ? (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <div className="flex-1 text-xs text-gray-500 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
                        <strong>How it works:</strong> Each Level is a question (e.g. "Specimen Type"). Each option inside it can reveal a sub-level when selected, creating a guided form that narrows down based on prior answers.
                      </div>
                    </div>
                    <div className="max-h-96 overflow-y-auto pr-1">
                      <CascadeLevelBuilder
                        levels={formData.section_config.cascade_levels}
                        onChange={newLevels =>
                          setFormData(prev => ({
                            ...prev,
                            section_config: { ...prev.section_config, cascade_levels: newLevels },
                          }))
                        }
                      />
                    </div>
                  </div>
                ) : (
                  <div>
                    <MatrixBuilder
                      config={formData.section_config.matrix || DEFAULT_MATRIX_CONFIG}
                      onChange={(matrix) =>
                        setFormData(prev => ({
                          ...prev,
                          section_config: { ...prev.section_config, matrix },
                        }))
                      }
                    />
                  </div>
                )}
              </div>

              {/* Flags */}
              <div className="flex items-center space-x-6">
                <label className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    checked={formData.is_required}
                    onChange={(e) => setFormData(prev => ({ ...prev, is_required: e.target.checked }))}
                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">Required for verification</span>
                </label>
                <label className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    checked={formData.is_editable}
                    onChange={(e) => setFormData(prev => ({ ...prev, is_editable: e.target.checked }))}
                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">Editable by doctor</span>
                </label>
                <label className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    checked={formData.allow_technician_entry}
                    onChange={(e) => setFormData(prev => ({ ...prev, allow_technician_entry: e.target.checked }))}
                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">Editable by technician</span>
                </label>
                <label className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    checked={formData.allow_images}
                    onChange={(e) => setFormData(prev => ({ ...prev, allow_images: e.target.checked }))}
                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">Allow images</span>
                </label>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end space-x-3 pt-4 border-t">
                <button
                  type="button"
                  onClick={() => { setShowForm(false); resetForm(); }}
                  className="px-4 py-2 text-gray-700 border rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={(e) => handleSubmit(e as unknown as React.FormEvent, { addAnother: true })}
                  className="px-4 py-2 border border-blue-200 text-blue-700 rounded-lg hover:bg-blue-50 disabled:opacity-50 flex items-center"
                >
                  {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  {editingSection ? 'Update & Add New Section' : 'Create & Add Another'}
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center"
                >
                  {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  {editingSection ? 'Update Section' : 'Create Section'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default ManageReportSections;
