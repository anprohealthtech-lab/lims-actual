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
}

interface SectionContent {
  id?: string;
  section_id: string;
  selected_options: number[]; // Indices of selected predefined options
  custom_text: string;
  final_content: string;
  image_urls?: string[];
  is_finalized: boolean;
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

      // Find the first expanded section that has an option at this index and is not locked
      for (const section of sections) {
        if (!expandedSections.has(section.id)) continue;
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
      const selectedTexts = content.selected_options
        .sort((a, b) => a - b)
        .map(i => section?.predefined_options[i])
        .filter(Boolean);

      // Append AI content to custom text
      const newCustomText = content.custom_text
        ? `${content.custom_text}\n\n${aiResult.generatedContent}`
        : aiResult.generatedContent;

      const finalContent = [
        ...selectedTexts,
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
                  {/* Predefined Options */}
                  {section.predefined_options && section.predefined_options.length > 0 && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Select from predefined options:
                      </label>
                      <div className="space-y-2">
                        {section.predefined_options.map((option, idx) => {
                          const isSelected = content?.selected_options.includes(idx);
                          const shortcutKey = idx < 26 ? String.fromCharCode(97 + idx) : null; // a, b, c...
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
                  )}

                  {/* Custom Text */}
                  {section.is_editable && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        {section.predefined_options?.length > 0 ? 'Add custom text (optional):' : 'Enter content:'}
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

                  {/* Preview */}
                  {(content?.final_content || (content?.image_urls && content.image_urls.length > 0)) && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Preview (will appear in report):
                      </label>
                      <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg space-y-3">
                        {content?.final_content && (
                          <div className="text-sm text-gray-800 whitespace-pre-wrap">
                            {content.final_content}
                          </div>
                        )}
                        {content?.image_urls && content.image_urls.length > 0 && (
                          <div className="grid grid-cols-2 gap-3">
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
    </div>
  );
});

export default SectionEditor;
