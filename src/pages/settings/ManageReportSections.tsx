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
  GripVertical
} from 'lucide-react';
import { database } from '../../utils/supabase';

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
  const [formData, setFormData] = useState({
    test_group_id: '',
    section_type: 'findings',
    section_name: '',
    display_order: 0,
    default_content: '',
    predefined_options: [''],
    is_required: false,
    is_editable: true,
    placeholder_key: ''
  });

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
      placeholder_key: ''
    });
    setEditingSection(null);
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
      placeholder_key: section.placeholder_key || ''
    });
    setShowForm(true);
  };

  // Handle form submit
  const handleSubmit = async (e: React.FormEvent) => {
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

      // Filter out empty options
      const cleanedOptions = formData.predefined_options.filter(opt => opt.trim() !== '');

      const sectionData = {
        test_group_id: formData.test_group_id,
        section_type: formData.section_type,
        section_name: formData.section_name.trim(),
        display_order: formData.display_order,
        default_content: formData.default_content.trim(),
        predefined_options: cleanedOptions,
        is_required: formData.is_required,
        is_editable: formData.is_editable,
        placeholder_key: formData.placeholder_key.trim() || formData.section_type
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

      setShowForm(false);
      resetForm();
      loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to save section');
    } finally {
      setSaving(false);
    }
  };

  // Handle delete
  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this section? This cannot be undone.')) return;

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

              {/* Predefined Options */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-gray-700">
                    Predefined Options
                  </label>
                  <button
                    type="button"
                    onClick={addOption}
                    className="text-sm text-blue-600 hover:text-blue-700"
                  >
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
                        <button
                          type="button"
                          onClick={() => removeOption(index)}
                          className="p-1 text-gray-400 hover:text-red-600"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  Doctors will be able to select these options when filling the section
                </p>
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
