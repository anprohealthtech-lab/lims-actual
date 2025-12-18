/**
 * SectionEditor - Component for editing pre-defined report sections
 * 
 * Used in result entry for PBS, Radiology, and other manual report types
 * that require findings, impressions, recommendations, etc.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { 
  FileText, 
  CheckSquare, 
  Save,
  Loader2,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  Lock
} from 'lucide-react';
import { database } from '../../utils/supabase';

interface TemplateSection {
  id: string;
  section_type: string;
  section_name: string;
  display_order: number;
  default_content: string | null;
  predefined_options: string[];
  is_required: boolean;
  is_editable: boolean;
  placeholder_key: string | null;
}

interface SectionContent {
  id?: string;
  section_id: string;
  selected_options: number[]; // Indices of selected predefined options
  custom_text: string;
  final_content: string;
  is_finalized: boolean;
}

interface SectionEditorProps {
  resultId: string;
  testGroupId: string;
  onSave?: (sections: SectionContent[]) => void;
  readOnly?: boolean;
  className?: string;
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

const SectionEditor: React.FC<SectionEditorProps> = ({
  resultId,
  testGroupId,
  onSave,
  readOnly = false,
  className = '',
}) => {
  const [sections, setSections] = useState<TemplateSection[]>([]);
  const [contents, setContents] = useState<Map<string, SectionContent>>(new Map());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

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

      setSections(templateSections);
      
      // Expand all sections by default
      setExpandedSections(new Set(templateSections.map((s: TemplateSection) => s.id)));

      // Load existing content for this result
      const { data: existingContent, error: contentErr } = await database.resultSectionContent.getByResult(resultId);
      if (contentErr) throw contentErr;

      // Build content map
      const contentMap = new Map<string, SectionContent>();
      for (const section of templateSections) {
        const existing = existingContent?.find((c: any) => c.section_id === section.id);
        if (existing) {
          contentMap.set(section.id, {
            id: existing.id,
            section_id: existing.section_id,
            selected_options: existing.selected_options || [],
            custom_text: existing.custom_text || '',
            final_content: existing.final_content || '',
            is_finalized: existing.is_finalized || false,
          });
        } else {
          // Initialize with defaults
          contentMap.set(section.id, {
            section_id: section.id,
            selected_options: [],
            custom_text: '',
            final_content: section.default_content || '',
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
  }, [resultId, testGroupId]);

  useEffect(() => {
    if (resultId && testGroupId) {
      loadData();
    }
  }, [resultId, testGroupId, loadData]);

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

  // Update custom text
  const updateCustomText = (sectionId: string, text: string) => {
    setContents(prev => {
      const newMap = new Map(prev);
      const content = newMap.get(sectionId);
      if (!content || content.is_finalized) return prev;

      const section = sections.find(s => s.id === sectionId);
      const selectedTexts = content.selected_options
        .sort((a, b) => a - b)
        .map(i => section?.predefined_options[i])
        .filter(Boolean);
      
      const finalContent = [
        ...selectedTexts,
        text.trim(),
      ].filter(Boolean).join('\n\n');

      newMap.set(sectionId, {
        ...content,
        custom_text: text,
        final_content: finalContent,
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

  // Save all section contents
  const saveAll = async () => {
    setSaving(true);
    setError(null);

    try {
      const savePromises: Promise<any>[] = [];
      
      for (const [sectionId, content] of contents.entries()) {
        if (content.id) {
          // Update existing
          savePromises.push(
            database.resultSectionContent.update(content.id, {
              selected_options: content.selected_options,
              custom_text: content.custom_text,
              final_content: content.final_content,
            })
          );
        } else {
          // Create new
          savePromises.push(
            database.resultSectionContent.create({
              result_id: resultId,
              section_id: sectionId,
              selected_options: content.selected_options,
              custom_text: content.custom_text,
              final_content: content.final_content,
            })
          );
        }
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
          const isLocked = content?.is_finalized || readOnly;

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
                  {content?.final_content && (
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
                  {/* Predefined Options */}
                  {section.predefined_options && section.predefined_options.length > 0 && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Select from predefined options:
                      </label>
                      <div className="space-y-2">
                        {section.predefined_options.map((option, idx) => {
                          const isSelected = content?.selected_options.includes(idx);
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
                                <span className="text-sm">{option}</span>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Custom Text */}
                  {section.is_editable && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        {section.predefined_options?.length > 0 ? 'Add custom text (optional):' : 'Enter content:'}
                      </label>
                      <textarea
                        value={content?.custom_text || ''}
                        onChange={(e) => !isLocked && updateCustomText(section.id, e.target.value)}
                        disabled={isLocked}
                        rows={4}
                        placeholder={section.default_content || 'Enter your findings, observations, or notes...'}
                        className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                          isLocked ? 'bg-gray-100 cursor-not-allowed' : 'bg-white'
                        }`}
                      />
                    </div>
                  )}

                  {/* Preview */}
                  {content?.final_content && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Preview (will appear in report):
                      </label>
                      <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
                        <div className="text-sm text-gray-800 whitespace-pre-wrap">
                          {content.final_content}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default SectionEditor;
