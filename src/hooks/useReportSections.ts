/**
 * Hook for managing editable report sections in result verification
 * 
 * Provides pre-defined sections with selectable options for doctors
 * to fill during verification (PBS findings, Radiology impressions, etc.)
 */

import { useState, useCallback, useEffect } from 'react';
import { database } from '../utils/supabase';

// ============================================
// TYPES
// ============================================

export interface TemplateSection {
  id: string;
  lab_id: string;
  template_id?: string;
  test_group_id?: string;
  section_type: 'findings' | 'impression' | 'recommendation' | 'technique' | 'clinical_history' | 'conclusion' | 'custom';
  section_name: string;
  display_order: number;
  default_content?: string;
  predefined_options: string[]; // Array of selectable sentences
  is_required: boolean;
  is_editable: boolean;
  placeholder_key?: string; // For template injection: {{section:findings}}
}

export interface SectionContent {
  id?: string;
  result_id: string;
  section_id: string;
  selected_options: number[]; // Indices of selected predefined options
  custom_text: string;
  final_content: string;
  is_finalized: boolean;
  edited_by?: string;
  edited_at?: string;
  finalized_at?: string;
  
  // Joined data
  section?: TemplateSection;
}

interface UseReportSectionsOptions {
  testGroupId?: string;
  templateId?: string;
  resultId?: string;
  userId: string;
  autoInitialize?: boolean; // Auto-create section content from defaults
}

interface UseReportSectionsReturn {
  // State
  sections: TemplateSection[];
  sectionContents: SectionContent[];
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  
  // Actions
  loadSections: () => Promise<void>;
  loadContent: () => Promise<void>;
  updateSectionContent: (sectionId: string, updates: Partial<SectionContent>) => void;
  toggleOption: (sectionId: string, optionIndex: number) => void;
  setCustomText: (sectionId: string, text: string) => void;
  saveSectionContent: (sectionId: string) => Promise<{ success: boolean; error?: string }>;
  saveAllSections: () => Promise<{ success: boolean; failed: string[] }>;
  finalizeSections: () => Promise<{ success: boolean; error?: string }>;
  initializeSections: () => Promise<void>;
  
  // Helpers
  getSectionContent: (sectionId: string) => SectionContent | undefined;
  buildFinalContent: (sectionId: string) => string;
  hasUnsavedChanges: () => boolean;
  getRequiredSections: () => TemplateSection[];
  getMissingSections: () => TemplateSection[]; // Required sections without content
}

// ============================================
// HOOK
// ============================================

export function useReportSections(options: UseReportSectionsOptions): UseReportSectionsReturn {
  const { testGroupId, templateId, resultId, userId, autoInitialize = false } = options;

  const [sections, setSections] = useState<TemplateSection[]>([]);
  const [sectionContents, setSectionContents] = useState<SectionContent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Load section definitions for the test group or template
   */
  const loadSections = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      let data;
      if (testGroupId) {
        const result = await database.templateSections.getByTestGroup(testGroupId);
        data = result.data;
        if (result.error) throw result.error;
      } else if (templateId) {
        const result = await database.templateSections.getByTemplate(templateId);
        data = result.data;
        if (result.error) throw result.error;
      } else {
        throw new Error('Either testGroupId or templateId is required');
      }

      setSections((data || []).map((s: any) => ({
        ...s,
        predefined_options: s.predefined_options || []
      })));
    } catch (err: any) {
      setError(err.message || 'Failed to load sections');
    } finally {
      setIsLoading(false);
    }
  }, [testGroupId, templateId]);

  /**
   * Load existing content for this result
   */
  const loadContent = useCallback(async () => {
    if (!resultId) return;

    setIsLoading(true);
    try {
      const { data, error: fetchError } = await database.resultSectionContent.getByResult(resultId);
      if (fetchError) throw fetchError;

      setSectionContents((data || []).map((c: any) => ({
        id: c.id,
        result_id: c.result_id,
        section_id: c.section_id,
        selected_options: c.selected_options || [],
        custom_text: c.custom_text || '',
        final_content: c.final_content || '',
        is_finalized: c.is_finalized || false,
        edited_by: c.edited_by,
        edited_at: c.edited_at,
        finalized_at: c.finalized_at,
        section: c.lab_template_sections
      })));
    } catch (err: any) {
      setError(err.message || 'Failed to load content');
    } finally {
      setIsLoading(false);
    }
  }, [resultId]);

  /**
   * Initialize sections with default content
   */
  const initializeSections = useCallback(async () => {
    if (!resultId || !testGroupId) return;

    setIsLoading(true);
    try {
      const { data, error: initError } = await database.resultSectionContent.initializeFromTemplate(
        resultId,
        testGroupId,
        userId
      );
      if (initError) throw initError;
      
      // Reload content after initialization
      await loadContent();
    } catch (err: any) {
      setError(err.message || 'Failed to initialize sections');
    } finally {
      setIsLoading(false);
    }
  }, [resultId, testGroupId, userId, loadContent]);

  // Auto-load sections on mount
  useEffect(() => {
    if (testGroupId || templateId) {
      loadSections();
    }
  }, [testGroupId, templateId, loadSections]);

  // Auto-load content when resultId is available
  useEffect(() => {
    if (resultId) {
      loadContent();
    }
  }, [resultId, loadContent]);

  // Auto-initialize if enabled and no content exists
  useEffect(() => {
    if (autoInitialize && resultId && sections.length > 0 && sectionContents.length === 0) {
      initializeSections();
    }
  }, [autoInitialize, resultId, sections.length, sectionContents.length, initializeSections]);

  /**
   * Build final content from selected options and custom text
   */
  const buildFinalContent = useCallback((sectionId: string): string => {
    const section = sections.find(s => s.id === sectionId);
    const content = sectionContents.find(c => c.section_id === sectionId);
    
    if (!section || !content) return '';

    const selectedTexts = (content.selected_options || [])
      .filter(idx => idx >= 0 && idx < section.predefined_options.length)
      .map(idx => section.predefined_options[idx]);

    const parts = [...selectedTexts];
    if (content.custom_text?.trim()) {
      parts.push(content.custom_text.trim());
    }

    return parts.join(' ');
  }, [sections, sectionContents]);

  /**
   * Update section content locally
   */
  const updateSectionContent = useCallback((sectionId: string, updates: Partial<SectionContent>) => {
    setSectionContents(prev => {
      const existing = prev.find(c => c.section_id === sectionId);
      
      if (existing) {
        return prev.map(c => c.section_id === sectionId ? { ...c, ...updates } : c);
      } else if (resultId) {
        // Create new entry
        return [...prev, {
          result_id: resultId,
          section_id: sectionId,
          selected_options: [],
          custom_text: '',
          final_content: '',
          is_finalized: false,
          ...updates
        }];
      }
      return prev;
    });
  }, [resultId]);

  /**
   * Toggle a predefined option selection
   */
  const toggleOption = useCallback((sectionId: string, optionIndex: number) => {
    const content = sectionContents.find(c => c.section_id === sectionId);
    if (content?.is_finalized) return; // Can't edit finalized content

    const currentSelected = content?.selected_options || [];
    const newSelected = currentSelected.includes(optionIndex)
      ? currentSelected.filter(i => i !== optionIndex)
      : [...currentSelected, optionIndex].sort((a, b) => a - b);

    updateSectionContent(sectionId, { selected_options: newSelected });
  }, [sectionContents, updateSectionContent]);

  /**
   * Set custom text for a section
   */
  const setCustomText = useCallback((sectionId: string, text: string) => {
    const content = sectionContents.find(c => c.section_id === sectionId);
    if (content?.is_finalized) return; // Can't edit finalized content

    updateSectionContent(sectionId, { custom_text: text });
  }, [sectionContents, updateSectionContent]);

  /**
   * Save a single section's content
   */
  const saveSectionContent = useCallback(async (sectionId: string): Promise<{ success: boolean; error?: string }> => {
    if (!resultId) return { success: false, error: 'No result ID' };

    const content = sectionContents.find(c => c.section_id === sectionId);
    if (!content) return { success: false, error: 'No content found' };
    if (content.is_finalized) return { success: false, error: 'Section is finalized' };

    setIsSaving(true);
    try {
      const finalContent = buildFinalContent(sectionId);
      
      const { error: saveError } = await database.resultSectionContent.upsert({
        result_id: resultId,
        section_id: sectionId,
        selected_options: content.selected_options,
        custom_text: content.custom_text,
        final_content: finalContent
      }, userId);

      if (saveError) throw saveError;

      // Update local state with final content
      updateSectionContent(sectionId, { final_content: finalContent });

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Save failed' };
    } finally {
      setIsSaving(false);
    }
  }, [resultId, sectionContents, buildFinalContent, userId, updateSectionContent]);

  /**
   * Save all sections
   */
  const saveAllSections = useCallback(async (): Promise<{ success: boolean; failed: string[] }> => {
    const failed: string[] = [];
    
    for (const section of sections) {
      const result = await saveSectionContent(section.id);
      if (!result.success) {
        failed.push(section.section_name);
      }
    }

    return { success: failed.length === 0, failed };
  }, [sections, saveSectionContent]);

  /**
   * Finalize all sections (makes them immutable)
   */
  const finalizeSections = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
    if (!resultId) return { success: false, error: 'No result ID' };

    // First save all
    const saveResult = await saveAllSections();
    if (!saveResult.success) {
      return { success: false, error: `Failed to save: ${saveResult.failed.join(', ')}` };
    }

    setIsSaving(true);
    try {
      const { error: finalizeError } = await database.resultSectionContent.finalizeAllForResult(resultId, userId);
      if (finalizeError) throw finalizeError;

      // Update local state
      setSectionContents(prev => prev.map(c => ({ ...c, is_finalized: true })));

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Finalization failed' };
    } finally {
      setIsSaving(false);
    }
  }, [resultId, userId, saveAllSections]);

  /**
   * Get content for a specific section
   */
  const getSectionContent = useCallback((sectionId: string): SectionContent | undefined => {
    return sectionContents.find(c => c.section_id === sectionId);
  }, [sectionContents]);

  /**
   * Check if there are unsaved changes
   */
  const hasUnsavedChanges = useCallback((): boolean => {
    return sectionContents.some(content => {
      const currentFinal = buildFinalContent(content.section_id);
      return currentFinal !== content.final_content;
    });
  }, [sectionContents, buildFinalContent]);

  /**
   * Get required sections
   */
  const getRequiredSections = useCallback((): TemplateSection[] => {
    return sections.filter(s => s.is_required);
  }, [sections]);

  /**
   * Get required sections without content
   */
  const getMissingSections = useCallback((): TemplateSection[] => {
    const required = getRequiredSections();
    return required.filter(section => {
      const content = sectionContents.find(c => c.section_id === section.id);
      return !content || !content.final_content?.trim();
    });
  }, [getRequiredSections, sectionContents]);

  return {
    sections,
    sectionContents,
    isLoading,
    isSaving,
    error,
    loadSections,
    loadContent,
    updateSectionContent,
    toggleOption,
    setCustomText,
    saveSectionContent,
    saveAllSections,
    finalizeSections,
    initializeSections,
    getSectionContent,
    buildFinalContent,
    hasUnsavedChanges,
    getRequiredSections,
    getMissingSections
  };
}

export default useReportSections;
