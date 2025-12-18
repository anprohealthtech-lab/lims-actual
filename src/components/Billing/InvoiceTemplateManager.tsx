import React, { useState, useEffect } from 'react';
import { FileText, Plus, Edit, Star, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { database } from '../../utils/supabase';
import InvoiceTemplateEditor from './InvoiceTemplateEditor';

interface InvoiceTemplate {
  id: string;
  template_name: string;
  template_description: string;
  category: string;
  is_default: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

const InvoiceTemplateManager: React.FC = () => {
  const [templates, setTemplates] = useState<InvoiceTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [editingTemplate, setEditingTemplate] = useState<string | null>(null);

  useEffect(() => {
    fetchTemplates();
  }, []);

  const fetchTemplates = async () => {
    try {
      setLoading(true);
      setError(null);

      const { data, error: err } = await database.invoiceTemplates.getAll();

      if (err) {
        throw new Error(err.message);
      }

      setTemplates(data || []);
    } catch (err: any) {
      console.error('Error fetching templates:', err);
      setError(err.message || 'Failed to load templates');
    } finally {
      setLoading(false);
    }
  };

  const handleSetDefault = async (templateId: string) => {
    try {
      setError(null);

      const { error: err } = await database.invoiceTemplates.setDefault(templateId);

      if (err) {
        throw new Error(err.message);
      }

      setSuccessMessage('Default template updated');
      setTimeout(() => setSuccessMessage(null), 3000);
      fetchTemplates();
    } catch (err: any) {
      console.error('Error setting default:', err);
      setError(err.message || 'Failed to set default template');
    }
  };

  const handleToggleActive = async (templateId: string, isActive: boolean) => {
    try {
      setError(null);

      const { error: err } = await database.invoiceTemplates.update(templateId, { is_active: !isActive });

      if (err) {
        throw new Error(err.message);
      }

      setSuccessMessage(`Template ${!isActive ? 'activated' : 'deactivated'}`);
      setTimeout(() => setSuccessMessage(null), 3000);
      fetchTemplates();
    } catch (err: any) {
      console.error('Error toggling active status:', err);
      setError(err.message || 'Failed to update template');
    }
  };

  const getCategoryBadgeColor = (category: string) => {
    const colors: Record<string, string> = {
      standard: 'bg-blue-100 text-blue-700',
      minimal: 'bg-gray-100 text-gray-700',
      professional: 'bg-purple-100 text-purple-700',
      b2b: 'bg-emerald-100 text-emerald-700',
      modern: 'bg-pink-100 text-pink-700',
    };
    return colors[category] || 'bg-gray-100 text-gray-700';
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  if (loading) {
    return (
      <div className="py-12 text-center">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin mx-auto mb-3" />
        <p className="text-gray-600">Loading templates...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Invoice Templates</h2>
          <p className="text-gray-600 mt-1">Manage invoice PDF templates for your lab</p>
        </div>
        <button
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center space-x-2"
          disabled
          title="Template creation coming soon"
        >
          <Plus className="w-4 h-4" />
          <span>New Template</span>
        </button>
      </div>

      {/* Alerts */}
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-start space-x-3">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div>
            <h4 className="font-medium text-red-900">Error</h4>
            <p className="text-sm text-red-700 mt-1">{error}</p>
          </div>
        </div>
      )}

      {successMessage && (
        <div className="p-4 bg-green-50 border border-green-200 rounded-lg flex items-start space-x-3">
          <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-green-900">{successMessage}</p>
        </div>
      )}

      {/* Templates List */}
      {templates.length === 0 ? (
        <div className="py-12 text-center border-2 border-dashed border-gray-300 rounded-lg">
          <FileText className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-600">No templates available</p>
          <p className="text-sm text-gray-500 mt-2">Run the seed migration to create default templates</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {templates.map((template) => (
            <div
              key={template.id}
              className={`border-2 rounded-lg p-5 transition-all ${
                template.is_active
                  ? 'border-gray-200 bg-white hover:border-gray-300'
                  : 'border-gray-100 bg-gray-50 opacity-60'
              }`}
            >
              {/* Template Header */}
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center space-x-2">
                  <FileText className={`w-5 h-5 ${template.is_active ? 'text-blue-600' : 'text-gray-400'}`} />
                  {template.is_default && (
                    <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />
                  )}
                </div>
                <span className={`text-xs px-2 py-1 rounded font-medium ${getCategoryBadgeColor(template.category)}`}>
                  {template.category}
                </span>
              </div>

              {/* Template Info */}
              <h3 className="font-semibold text-gray-900 mb-2">{template.template_name}</h3>
              <p className="text-sm text-gray-600 mb-4 line-clamp-2">{template.template_description}</p>

              {/* Status Badges */}
              <div className="flex items-center space-x-2 mb-4">
                {template.is_default && (
                  <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-1 rounded font-medium">
                    Default
                  </span>
                )}
                <span className={`text-xs px-2 py-1 rounded font-medium ${
                  template.is_active
                    ? 'bg-green-100 text-green-700'
                    : 'bg-gray-100 text-gray-700'
                }`}>
                  {template.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>

              {/* Metadata */}
              <div className="text-xs text-gray-500 mb-4">
                <p>Created: {formatDate(template.created_at)}</p>
                <p>Updated: {formatDate(template.updated_at)}</p>
              </div>

              {/* Actions */}
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setEditingTemplate(template.id)}
                  className="flex-1 px-3 py-2 text-sm border border-blue-300 text-blue-700 rounded hover:bg-blue-50 transition-colors flex items-center justify-center space-x-1"
                  title="Edit template"
                >
                  <Edit className="w-3 h-3" />
                  <span>Edit</span>
                </button>
                {!template.is_default && template.is_active && (
                  <button
                    onClick={() => handleSetDefault(template.id)}
                    className="flex-1 px-3 py-2 text-sm border border-yellow-300 text-yellow-700 rounded hover:bg-yellow-50 transition-colors flex items-center justify-center space-x-1"
                    title="Set as default"
                  >
                    <Star className="w-3 h-3" />
                    <span>Set Default</span>
                  </button>
                )}
                <button
                  onClick={() => handleToggleActive(template.id, template.is_active)}
                  className={`flex-1 px-3 py-2 text-sm rounded transition-colors ${
                    template.is_active
                      ? 'border border-gray-300 text-gray-700 hover:bg-gray-50'
                      : 'border border-green-300 text-green-700 hover:bg-green-50'
                  }`}
                >
                  {template.is_active ? 'Deactivate' : 'Activate'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Info Box */}
      <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg flex items-start space-x-3">
        <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-blue-900">
          <p className="font-medium mb-2">About Invoice Templates</p>
          <ul className="list-disc list-inside space-y-1 text-blue-800">
            <li><strong>Default Template:</strong> Used automatically when generating PDFs</li>
            <li><strong>Active Templates:</strong> Available for selection during PDF generation</li>
            <li><strong>Categories:</strong> Standard, Minimal, Professional, B2B, Modern</li>
            <li>Click <strong>Edit</strong> to customize template HTML and CSS</li>
          </ul>
        </div>
      </div>

      {/* Template Editor Modal */}
      {editingTemplate && (
        <InvoiceTemplateEditor
          templateId={editingTemplate}
          onClose={() => setEditingTemplate(null)}
          onSave={() => {
            setEditingTemplate(null);
            fetchTemplates();
          }}
        />
      )}
    </div>
  );
};

export default InvoiceTemplateManager;
