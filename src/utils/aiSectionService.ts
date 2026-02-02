/**
 * AI Section Generator Service
 *
 * Utility for generating report section content using AI
 */

import { supabase } from './supabase';

export interface SectionGeneratorParams {
  sectionType: string;
  sectionName: string;
  testGroupName?: string;
  userPrompt: string;
  existingOptions?: string[];
  labContext?: {
    labName?: string;
    patientInfo?: {
      age?: number;
      gender?: string;
    };
    testResults?: Record<string, string>;
    styleHints?: string;
  };
}

export interface SectionGeneratorResponse {
  generatedContent: string;
  suggestedOptions?: string[];
  sectionHeading?: string;
}

export interface SectionGeneratorResult {
  data: SectionGeneratorResponse | null;
  error: string | null;
}

/**
 * Generate section content using AI
 *
 * @param params - Parameters for section generation
 * @returns Generated content and suggested options
 */
export async function generateSectionContent(params: SectionGeneratorParams): Promise<SectionGeneratorResult> {
  try {
    const { data, error } = await supabase.functions.invoke('ai-section-generator', {
      body: params
    });

    if (error) {
      console.error('AI Section Generator error:', error);
      return {
        data: null,
        error: error.message || 'Failed to generate section content'
      };
    }

    if (!data?.success) {
      return {
        data: null,
        error: data?.error || 'AI generation failed'
      };
    }

    return {
      data: data.data as SectionGeneratorResponse,
      error: null
    };
  } catch (err) {
    console.error('AI Section Generator exception:', err);
    return {
      data: null,
      error: err instanceof Error ? err.message : 'Unknown error occurred'
    };
  }
}

/**
 * Quick generation prompts for common section types
 */
export const QUICK_PROMPTS = {
  'peripheral_smear': [
    'Generate normal peripheral blood smear findings',
    'Generate findings for anemia workup',
    'Generate findings suggesting infection (leukocytosis)',
    'Generate findings for thrombocytopenia',
  ],
  'radiology': [
    'Generate normal chest X-ray findings',
    'Generate findings for pneumonia',
    'Generate normal abdominal ultrasound findings',
  ],
  'findings': [
    'Generate normal findings section',
    'Generate findings with mild abnormalities',
  ],
  'impression': [
    'Generate impression based on findings above',
    'Generate differential diagnosis section',
  ],
  'recommendation': [
    'Generate follow-up recommendations',
    'Generate lifestyle modification recommendations',
  ],
};

/**
 * Get quick prompts for a section type
 */
export function getQuickPromptsForSection(sectionType: string): string[] {
  const normalizedType = sectionType.toLowerCase();

  if (normalizedType.includes('peripheral') || normalizedType.includes('smear') || normalizedType.includes('pbs')) {
    return QUICK_PROMPTS.peripheral_smear;
  }
  if (normalizedType.includes('radiology') || normalizedType.includes('xray') || normalizedType.includes('imaging')) {
    return QUICK_PROMPTS.radiology;
  }
  if (normalizedType.includes('finding')) {
    return QUICK_PROMPTS.findings;
  }
  if (normalizedType.includes('impression') || normalizedType.includes('conclusion')) {
    return QUICK_PROMPTS.impression;
  }
  if (normalizedType.includes('recommend')) {
    return QUICK_PROMPTS.recommendation;
  }

  return QUICK_PROMPTS.findings;
}
