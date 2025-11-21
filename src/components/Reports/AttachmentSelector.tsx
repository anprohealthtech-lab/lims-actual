import React, { useState, useEffect } from 'react';
import { X, Image as ImageIcon, FileText, Check } from 'lucide-react';
import { supabase } from '../../utils/supabase';

interface Attachment {
  id: string;
  file_url: string;
  file_name: string;
  file_type: string;
  tag: string | null;
  description: string | null;
  order_test_id: string | null;
  created_at: string;
  test_name?: string;
}

interface AttachmentSelectorProps {
  orderId: string;
  onClose: () => void;
  onSave: () => void;
}

const AttachmentSelector: React.FC<AttachmentSelectorProps> = ({
  orderId,
  onClose,
  onSave,
}) => {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [selectedAttachments, setSelectedAttachments] = useState<Set<string>>(new Set());
  const [headings, setHeadings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchAttachments();
  }, [orderId]);

  const fetchAttachments = async () => {
    try {
      setLoading(true);
      
      // Fetch attachments for this order with test names
      const { data, error } = await supabase
        .from('attachments')
        .select(`
          id,
          file_url,
          file_name,
          file_type,
          tag,
          description,
          order_test_id,
          created_at,
          order_tests(
            test_groups(name)
          )
        `)
        .eq('order_id', orderId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Transform data and extract test names
      const transformedData = data.map((att: any) => ({
        ...att,
        test_name: att.order_tests?.test_groups?.name || 'General',
      }));

      setAttachments(transformedData);

      // Pre-select attachments already marked for report inclusion
      const preSelected = new Set<string>();
      const preHeadings: Record<string, string> = {};
      
      transformedData.forEach((att: Attachment) => {
        if (att.tag === 'include_in_report') {
          preSelected.add(att.id);
          if (att.description) {
            preHeadings[att.id] = att.description;
          }
        }
      });

      setSelectedAttachments(preSelected);
      setHeadings(preHeadings);
    } catch (error) {
      console.error('Error fetching attachments:', error);
      alert('Failed to load attachments');
    } finally {
      setLoading(false);
    }
  };

  const toggleAttachment = (id: string) => {
    const newSelected = new Set(selectedAttachments);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedAttachments(newSelected);
  };

  const updateHeading = (id: string, heading: string) => {
    setHeadings((prev) => ({
      ...prev,
      [id]: heading,
    }));
  };

  const handleSave = async () => {
    try {
      setSaving(true);

      // Update all attachments: mark selected ones, unmark others
      const updates = attachments.map((att) => {
        const isSelected = selectedAttachments.has(att.id);
        return supabase
          .from('attachments')
          .update({
            tag: isSelected ? 'include_in_report' : null,
            description: isSelected ? (headings[att.id] || null) : null,
          })
          .eq('id', att.id);
      });

      await Promise.all(updates);

      alert(`Successfully updated ${selectedAttachments.size} attachment(s) for report inclusion`);
      onSave();
      onClose();
    } catch (error) {
      console.error('Error saving attachment selections:', error);
      alert('Failed to save attachment selections');
    } finally {
      setSaving(false);
    }
  };

  const groupedAttachments = attachments.reduce((acc, att) => {
    const testName = att.test_name || 'General';
    if (!acc[testName]) {
      acc[testName] = [];
    }
    acc[testName].push(att);
    return acc;
  }, {} as Record<string, Attachment[]>);

  const isImageFile = (fileType: string) => {
    return fileType.startsWith('image/');
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-8">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading attachments...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex justify-between items-center p-6 border-b">
          <div>
            <h2 className="text-2xl font-bold text-gray-800">
              Manage Report Attachments
            </h2>
            <p className="text-sm text-gray-600 mt-1">
              Select attachments to include in the final PDF report. Add optional headings for context.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 transition-colors"
          >
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {attachments.length === 0 ? (
            <div className="text-center py-12">
              <FileText size={48} className="mx-auto text-gray-400 mb-4" />
              <p className="text-gray-600">No attachments found for this order</p>
            </div>
          ) : (
            <div className="space-y-6">
              {Object.entries(groupedAttachments).map(([testName, testAttachments]) => (
                <div key={testName} className="border rounded-lg p-4 bg-gray-50">
                  <h3 className="font-semibold text-lg text-gray-800 mb-3 flex items-center">
                    <FileText size={20} className="mr-2 text-blue-600" />
                    {testName}
                  </h3>
                  <div className="space-y-3">
                    {testAttachments.map((att) => {
                      const isSelected = selectedAttachments.has(att.id);
                      return (
                        <div
                          key={att.id}
                          className={`border rounded-lg p-4 transition-all ${
                            isSelected
                              ? 'border-blue-500 bg-blue-50'
                              : 'border-gray-200 bg-white'
                          }`}
                        >
                          <div className="flex items-start gap-4">
                            {/* Checkbox */}
                            <div className="flex-shrink-0 pt-1">
                              <button
                                onClick={() => toggleAttachment(att.id)}
                                className={`w-6 h-6 rounded border-2 flex items-center justify-center transition-colors ${
                                  isSelected
                                    ? 'bg-blue-600 border-blue-600'
                                    : 'border-gray-300 hover:border-blue-400'
                                }`}
                              >
                                {isSelected && <Check size={16} className="text-white" />}
                              </button>
                            </div>

                            {/* Preview */}
                            <div className="flex-shrink-0">
                              {isImageFile(att.file_type) ? (
                                <img
                                  src={att.file_url}
                                  alt={att.file_name}
                                  className="w-20 h-20 object-cover rounded border"
                                />
                              ) : (
                                <div className="w-20 h-20 bg-gray-200 rounded border flex items-center justify-center">
                                  <ImageIcon size={32} className="text-gray-400" />
                                </div>
                              )}
                            </div>

                            {/* Details */}
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-gray-800 truncate">
                                {att.file_name}
                              </p>
                              <p className="text-sm text-gray-500">
                                {new Date(att.created_at).toLocaleDateString()}
                              </p>

                              {/* Heading Input (only show when selected) */}
                              {isSelected && (
                                <div className="mt-3">
                                  <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Heading (optional)
                                  </label>
                                  <input
                                    type="text"
                                    value={headings[att.id] || ''}
                                    onChange={(e) => updateHeading(att.id, e.target.value)}
                                    placeholder="e.g., Blood Smear Analysis, X-Ray Result"
                                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                  />
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t p-6 bg-gray-50">
          <div className="flex justify-between items-center">
            <p className="text-sm text-gray-600">
              {selectedAttachments.size} attachment(s) selected for report
            </p>
            <div className="flex gap-3">
              <button
                onClick={onClose}
                disabled={saving}
                className="px-6 py-2 border border-gray-300 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {saving ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    Saving...
                  </>
                ) : (
                  'Save Selection'
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AttachmentSelector;
