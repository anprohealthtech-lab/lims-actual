// src/pages/WhatsAppTemplates.tsx
import React, { useState, useEffect } from 'react';
import {
  MessageSquare,
  Plus,
  Edit2,
  Trash2,
  Copy,
  Star,
  StarOff,
  Search,
  FileText,
  User,
  TestTube,
  Building,
  CreditCard,
  Calendar,
  X,
  Eye,
  Save,
  AlertCircle,
} from 'lucide-react';
import { database } from '../utils/supabase';
import {
  replacePlaceholders,
  extractPlaceholders,
  previewTemplate,
  STANDARD_PLACEHOLDERS,
  TemplateData,
} from '../utils/whatsappTemplates';

interface WhatsAppTemplate {
  id: string;
  lab_id: string;
  name: string;
  category: string;
  message_content: string;
  requires_attachment: boolean;
  placeholders: string[];
  is_active: boolean;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

const CATEGORY_LABELS: Record<string, { label: string; icon: any; color: string }> = {
  report_ready: { label: 'Report Ready', icon: FileText, color: 'blue' },
  appointment_reminder: { label: 'Appointment', icon: Calendar, color: 'purple' },
  test_results: { label: 'Test Results', icon: TestTube, color: 'green' },
  doctor_notification: { label: 'Doctor Notification', icon: User, color: 'indigo' },
  payment_reminder: { label: 'Payment Reminder', icon: CreditCard, color: 'yellow' },
  custom: { label: 'Custom', icon: MessageSquare, color: 'gray' },
};

const WhatsAppTemplates: React.FC = () => {
  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [showModal, setShowModal] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<Partial<WhatsAppTemplate> | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    loadTemplates();
  }, []);

  const loadTemplates = async () => {
    setLoading(true);
    try {
      // Try to load templates
      const { data, error } = await database.whatsappTemplates.list();
      
      if (error) {
        console.error('Error loading templates:', error);
      }

      // If no templates exist, seed defaults
      if (!data || data.length === 0) {
        await database.whatsappTemplates.seedDefaults();
        const { data: seededData } = await database.whatsappTemplates.list();
        setTemplates((seededData || []) as WhatsAppTemplate[]);
      } else {
        setTemplates(data as WhatsAppTemplate[]);
      }
    } catch (error) {
      console.error('Failed to load templates:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = () => {
    setEditingTemplate({
      name: '',
      category: 'custom',
      message_content: '',
      requires_attachment: false,
      is_active: true,
      is_default: false,
      placeholders: [],
    });
    setShowModal(true);
  };

  const handleEdit = (template: WhatsAppTemplate) => {
    setEditingTemplate(template);
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!editingTemplate) return;

    try {
      // Extract placeholders from content
      const placeholders = extractPlaceholders(editingTemplate.message_content || '');

      const templateData = {
        ...editingTemplate,
        placeholders,
      };

      if (editingTemplate.id) {
        // Update existing
        const { error } = await database.whatsappTemplates.update(
          editingTemplate.id,
          templateData
        );
        if (error) throw error;
      } else {
        // Create new
        const { error } = await database.whatsappTemplates.create(templateData as any);
        if (error) throw error;
      }

      await loadTemplates();
      setShowModal(false);
      setEditingTemplate(null);
    } catch (error) {
      console.error('Failed to save template:', error);
      alert('Failed to save template. Please try again.');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this template?')) return;

    try {
      const { error } = await database.whatsappTemplates.delete(id);
      if (error) throw error;
      await loadTemplates();
    } catch (error) {
      console.error('Failed to delete template:', error);
      alert('Failed to delete template. Please try again.');
    }
  };

  const handleDuplicate = async (template: WhatsAppTemplate) => {
    setEditingTemplate({
      ...template,
      id: undefined,
      name: `${template.name} (Copy)`,
      is_default: false,
    });
    setShowModal(true);
  };

  const handleToggleDefault = async (template: WhatsAppTemplate) => {
    try {
      const { error } = await database.whatsappTemplates.update(template.id, {
        is_default: !template.is_default,
      });
      if (error) throw error;
      await loadTemplates();
    } catch (error) {
      console.error('Failed to toggle default:', error);
      alert('Failed to update template. Please try again.');
    }
  };

  const insertPlaceholder = (placeholderName: string) => {
    if (!editingTemplate) return;
    const placeholder = `[${placeholderName}]`;
    const currentContent = editingTemplate.message_content || '';
    setEditingTemplate({
      ...editingTemplate,
      message_content: currentContent + placeholder,
    });
  };

  const filteredTemplates = templates.filter((t) => {
    const matchesSearch =
      t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.message_content.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === 'all' || t.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const groupedPlaceholders = STANDARD_PLACEHOLDERS.reduce((acc, p) => {
    if (!acc[p.category]) acc[p.category] = [];
    acc[p.category].push(p);
    return acc;
  }, {} as Record<string, typeof STANDARD_PLACEHOLDERS>);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading templates...</div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">WhatsApp Message Templates</h1>
          <p className="text-gray-600 mt-1">
            Manage reusable message templates with dynamic placeholders
          </p>
        </div>
        <button
          onClick={handleCreate}
          className="inline-flex items-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
        >
          <Plus className="h-5 w-5 mr-2" />
          New Template
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 mb-6">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
              <input
                type="text"
                placeholder="Search templates..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
              />
            </div>
          </div>
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
          >
            <option value="all">All Categories</option>
            {Object.entries(CATEGORY_LABELS).map(([key, { label }]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Templates Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredTemplates.map((template) => {
          const categoryInfo = CATEGORY_LABELS[template.category] || CATEGORY_LABELS.custom;
          const Icon = categoryInfo.icon;

          return (
            <div
              key={template.id}
              className="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-md transition-shadow"
            >
              {/* Header */}
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center space-x-2">
                  <div className={`p-2 rounded-lg bg-${categoryInfo.color}-100`}>
                    <Icon className={`h-5 w-5 text-${categoryInfo.color}-600`} />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">{template.name}</h3>
                    <span className="text-xs text-gray-500">{categoryInfo.label}</span>
                  </div>
                </div>
                <button
                  onClick={() => handleToggleDefault(template)}
                  className="p-1 hover:bg-gray-100 rounded"
                  title={template.is_default ? 'Remove as default' : 'Set as default'}
                >
                  {template.is_default ? (
                    <Star className="h-5 w-5 text-yellow-500 fill-yellow-500" />
                  ) : (
                    <StarOff className="h-5 w-5 text-gray-400" />
                  )}
                </button>
              </div>

              {/* Message Preview */}
              <div className="mb-4">
                <p className="text-sm text-gray-600 line-clamp-3">
                  {template.message_content}
                </p>
              </div>

              {/* Metadata */}
              <div className="flex items-center gap-2 mb-4 text-xs text-gray-500">
                {template.requires_attachment && (
                  <span className="inline-flex items-center px-2 py-1 bg-blue-100 text-blue-700 rounded">
                    📎 Attachment
                  </span>
                )}
                {template.placeholders.length > 0 && (
                  <span className="inline-flex items-center px-2 py-1 bg-gray-100 text-gray-700 rounded">
                    {template.placeholders.length} placeholders
                  </span>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleEdit(template)}
                  className="flex-1 inline-flex items-center justify-center px-3 py-2 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
                >
                  <Edit2 className="h-4 w-4 mr-1" />
                  Edit
                </button>
                <button
                  onClick={() => handleDuplicate(template)}
                  className="inline-flex items-center justify-center px-3 py-2 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
                  title="Duplicate"
                >
                  <Copy className="h-4 w-4" />
                </button>
                <button
                  onClick={() => handleDelete(template.id)}
                  className="inline-flex items-center justify-center px-3 py-2 text-sm bg-red-100 text-red-700 rounded hover:bg-red-200"
                  title="Delete"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {filteredTemplates.length === 0 && (
        <div className="text-center py-12">
          <MessageSquare className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-500">No templates found</p>
        </div>
      )}

      {/* Edit/Create Modal */}
      {showModal && editingTemplate && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-6 border-b">
              <h2 className="text-2xl font-bold text-gray-900">
                {editingTemplate.id ? 'Edit Template' : 'New Template'}
              </h2>
              <button
                onClick={() => {
                  setShowModal(false);
                  setEditingTemplate(null);
                }}
                className="p-2 hover:bg-gray-100 rounded"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Left Column: Form Fields */}
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Template Name *
                    </label>
                    <input
                      type="text"
                      value={editingTemplate.name || ''}
                      onChange={(e) =>
                        setEditingTemplate({ ...editingTemplate, name: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                      placeholder="e.g., Report Ready"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Category *
                    </label>
                    <select
                      value={editingTemplate.category || 'custom'}
                      onChange={(e) =>
                        setEditingTemplate({ ...editingTemplate, category: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                    >
                      {Object.entries(CATEGORY_LABELS).map(([key, { label }]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Message Content *
                    </label>
                    <textarea
                      value={editingTemplate.message_content || ''}
                      onChange={(e) =>
                        setEditingTemplate({
                          ...editingTemplate,
                          message_content: e.target.value,
                        })
                      }
                      rows={8}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 font-mono text-sm"
                      placeholder="Hello [PatientName], your [TestName] report is ready..."
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Use [PlaceholderName] format for dynamic content
                    </p>
                  </div>

                  <div className="flex items-center gap-4">
                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        checked={editingTemplate.requires_attachment || false}
                        onChange={(e) =>
                          setEditingTemplate({
                            ...editingTemplate,
                            requires_attachment: e.target.checked,
                          })
                        }
                        className="mr-2"
                      />
                      <span className="text-sm text-gray-700">Requires Attachment</span>
                    </label>
                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        checked={editingTemplate.is_default || false}
                        onChange={(e) =>
                          setEditingTemplate({
                            ...editingTemplate,
                            is_default: e.target.checked,
                          })
                        }
                        className="mr-2"
                      />
                      <span className="text-sm text-gray-700">Set as Default</span>
                    </label>
                  </div>

                  {/* Preview Button */}
                  <button
                    onClick={() => setShowPreview(!showPreview)}
                    className="inline-flex items-center px-4 py-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200"
                  >
                    <Eye className="h-4 w-4 mr-2" />
                    {showPreview ? 'Hide' : 'Show'} Preview
                  </button>

                  {showPreview && (
                    <div className="border border-blue-200 bg-blue-50 rounded-lg p-4">
                      <div className="text-sm font-medium text-blue-900 mb-2">
                        Preview with Sample Data:
                      </div>
                      <div className="text-sm text-blue-800 whitespace-pre-wrap">
                        {previewTemplate(editingTemplate.message_content || '')}
                      </div>
                    </div>
                  )}
                </div>

                {/* Right Column: Placeholder Picker */}
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-3">
                    Available Placeholders
                  </h3>
                  <div className="space-y-3 max-h-[500px] overflow-y-auto">
                    {Object.entries(groupedPlaceholders).map(([category, placeholders]) => (
                      <div key={category} className="border border-gray-200 rounded-lg p-3">
                        <h4 className="text-xs font-semibold text-gray-600 uppercase mb-2">
                          {category}
                        </h4>
                        <div className="space-y-1">
                          {placeholders.map((p) => (
                            <button
                              key={p.name}
                              onClick={() => insertPlaceholder(p.name)}
                              className="w-full text-left px-3 py-2 text-sm bg-gray-50 hover:bg-gray-100 rounded flex items-center justify-between group"
                            >
                              <div>
                                <div className="font-medium text-gray-900">[{p.name}]</div>
                                <div className="text-xs text-gray-500">{p.description}</div>
                              </div>
                              <Plus className="h-4 w-4 text-gray-400 group-hover:text-gray-600" />
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end gap-3 p-6 border-t bg-gray-50">
              <button
                onClick={() => {
                  setShowModal(false);
                  setEditingTemplate(null);
                }}
                className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={!editingTemplate.name || !editingTemplate.message_content}
                className="inline-flex items-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Save className="h-4 w-4 mr-2" />
                Save Template
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default WhatsAppTemplates;
