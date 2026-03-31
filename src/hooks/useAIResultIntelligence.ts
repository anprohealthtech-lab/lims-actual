/**
 * useAIResultIntelligence Hook
 * 
 * Provides AI-powered clinical intelligence utilities for laboratory results:
 * 1. Generate missing interpretations for analytes
 * 2. Generate verifier summary for test groups
 * 3. Generate clinical summary for referring doctors
 */

import { useState, useCallback } from 'react';
import { database } from '../utils/supabase';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// Types matching the Netlify function
export interface AnalyteData {
  id: string;
  name: string;
  unit: string;
  reference_range: string;
  interpretation_low?: string | null;
  interpretation_normal?: string | null;
  interpretation_high?: string | null;
}

export interface ResultValue {
  id?: string; // result_value ID for updating
  analyte_id?: string;
  analyte_name: string;
  value: string;
  unit: string;
  reference_range: string;
  // Flag can be any string - AI handles all variations (H, L, C, high, low, critical_h, critical_l, etc.)
  flag: string | null;
  interpretation?: string | null;
  ai_suggested_flag?: string | null;
  ai_suggested_interpretation?: string | null;
  trend_interpretation?: string | null;
  /** Historical values from past orders and external reports */
  historical_values?: Array<{
    date: string;
    value: string;
    flag?: string | null;
    source: 'internal' | 'external';
    lab_name?: string; // For external reports
  }>;
}

export interface TestGroupContext {
  test_group_name: string;
  test_group_code: string;
  category?: string;
  clinical_purpose?: string;
}

export interface PatientContext {
  age?: number;
  gender?: string;
  clinical_notes?: string;
}

// Response types
export interface GeneratedInterpretation {
  analyte_id: string;
  analyte_name: string;
  interpretation_low: string;
  interpretation_normal: string;
  interpretation_high: string;
}

export interface InterpretationsResponse {
  interpretations: GeneratedInterpretation[];
}

export interface VerifierSummaryResponse {
  overall_assessment: string;
  abnormal_findings: string[];
  critical_alerts: string[];
  recommendation: 'approve' | 'needs_clarification' | 'reject';
  recommendation_reason: string;
  verifier_notes?: string;
}

export interface SignificantFinding {
  finding: string;
  clinical_significance: string;
  test_group: string;
}

export interface ClinicalSummaryResponse {
  executive_summary: string;
  significant_findings: SignificantFinding[];
  suggested_followup: string[];
  urgent_findings: string[];
  clinical_interpretation: string;
  overall_impression?: string;
  // Flags for saved summaries loaded from database
  _savedFromDb?: boolean;
  _generatedAt?: string;
}

/**
 * Delta Check Issue - Individual issue identified by the delta check
 */
export interface DeltaCheckIssue {
  /** Type of issue identified */
  issue_type: 'input_error' | 'sample_issue' | 'conflicting_result' | 'unusual_change' | 'quality_concern';
  /** Severity of the issue */
  severity: 'critical' | 'warning' | 'info';
  /** Which analyte(s) are affected */
  affected_analytes: string[];
  /** Description of the issue */
  description: string;
  /** Suggested action to resolve */
  suggested_action: string;
  /** Evidence supporting this issue */
  evidence: string;
}

/**
 * Delta Check Response - AI-powered quality control check
 * Compares current results with historical data to identify potential issues
 */
export interface DeltaCheckResponse {
  /** Overall confidence in the report (0-100) */
  confidence_score: number;
  /** Confidence level description */
  confidence_level: 'high' | 'medium' | 'low';
  /** Summary of the delta check */
  summary: string;
  /** List of issues identified */
  issues: DeltaCheckIssue[];
  /** Results that passed all checks */
  validated_results: string[];
  /** Recommendation for the verifier */
  recommendation: 'approve' | 'review_required' | 'reject';
  /** Detailed notes for the verifier */
  verifier_notes: string;
}

/**
 * Patient Summary Response - Patient-friendly summary in selected language
 * Medical/pathology terms remain in English for accuracy
 */
export interface PatientSummaryResponse {
  /** Overall health status in simple terms */
  health_status: string;
  /** Brief summary of normal findings (legacy - for backward compatibility) */
  normal_findings_summary?: string;
  /** Detailed explanation of each normal finding */
  normal_findings_detailed?: Array<{
    test_name: string; // In English (e.g., "Hemoglobin", "Blood Sugar")
    value: string;
    what_it_measures: string; // Simple explanation of what the test checks
    your_result_means: string; // What normal result means for patient
  }>;
  /** List of abnormal findings with simple explanations */
  abnormal_findings: Array<{
    test_name: string; // In English (e.g., "Hemoglobin", "LDL Cholesterol")
    value: string;
    status: 'high' | 'low' | 'abnormal' | 'critical';
    what_it_measures?: string; // Simple explanation of what the test checks
    explanation: string; // In selected language
    what_to_do?: string; // Actionable advice
    trend?: 'improving' | 'worsening' | 'stable' | 'new';
  }>;
  /** Whether any findings need doctor consultation */
  needs_consultation: boolean;
  /** Consultation recommendation message (in selected language) */
  consultation_message?: string;
  /** Consultation recommendation (new field) */
  consultation_recommendation?: string;
  /** Name of the referring doctor if available */
  referring_doctor_name?: string;
  /** General health tips based on results (in selected language) */
  health_tips: string[];
  /** Warm closing message for the patient */
  summary_message?: string;
  /** The language this summary was generated in */
  language: string;
  /** Raw AI response for debugging/fallback display */
  _raw_response?: Record<string, any>;
  /** Any extra fields returned by AI that weren't explicitly parsed */
  _extra_fields?: Record<string, any>;
  /** Flags for saved summaries loaded from database */
  _savedFromDb?: boolean;
  _generatedAt?: string;
}

/** Supported languages for patient summary */
export type SupportedLanguage = 
  | 'english' 
  | 'hindi' 
  | 'marathi' 
  | 'gujarati' 
  | 'tamil' 
  | 'telugu' 
  | 'kannada' 
  | 'bengali' 
  | 'punjabi' 
  | 'malayalam'
  | 'odia'
  | 'assamese';

/** Language display names for UI */
export const LANGUAGE_DISPLAY_NAMES: Record<SupportedLanguage, string> = {
  english: 'English',
  hindi: 'हिन्दी (Hindi)',
  marathi: 'मराठी (Marathi)',
  gujarati: 'ગુજરાતી (Gujarati)',
  tamil: 'தமிழ் (Tamil)',
  telugu: 'తెలుగు (Telugu)',
  kannada: 'ಕನ್ನಡ (Kannada)',
  bengali: 'বাংলা (Bengali)',
  punjabi: 'ਪੰਜਾਬੀ (Punjabi)',
  malayalam: 'മലയാളം (Malayalam)',
  odia: 'ଓଡ଼ିଆ (Odia)',
  assamese: 'অসমীয়া (Assamese)',
};

interface AIResultIntelligenceState {
  loading: boolean;
  error: string | null;
}

const AI_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/ai-result-intelligence`;

/**
 * Hook for AI-powered result intelligence
 */
export function useAIResultIntelligence() {
  const [state, setState] = useState<AIResultIntelligenceState>({
    loading: false,
    error: null,
  });

  /**
   * Make API call to the Netlify function
   */
  const callAIFunction = useCallback(async <T>(body: object): Promise<T> => {
    setState({ loading: true, error: null });
    
    try {
      const response = await fetch(AI_FUNCTION_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'apikey': SUPABASE_ANON_KEY,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Request failed: ${response.status}`);
      }

      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.error || 'AI request failed');
      }

      setState({ loading: false, error: null });
      return result.data as T;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setState({ loading: false, error: errorMessage });
      throw error;
    }
  }, []);

  /**
   * Generate missing interpretations for analytes
   * Call at TEST GROUP level
   */
  const generateMissingInterpretations = useCallback(async (
    analytes: AnalyteData[],
    testGroup: TestGroupContext
  ): Promise<InterpretationsResponse> => {
    // Filter to only analytes missing interpretations
    const analytesNeedingInterpretations = analytes.filter(a => 
      !a.interpretation_low || 
      !a.interpretation_normal || 
      !a.interpretation_high
    );

    if (analytesNeedingInterpretations.length === 0) {
      return { interpretations: [] };
    }

    return callAIFunction<InterpretationsResponse>({
      action: 'generate_interpretations',
      analytes: analytesNeedingInterpretations,
      test_group: testGroup,
    });
  }, [callAIFunction]);

  /**
   * Generate AI suggestions for result values (flag, interpretation, trend)
   * Saves to result_values.ai_suggested_flag, ai_suggested_interpretation
   * @param resultValues - Array of result values to analyze
   * @param patient - Patient context for personalized interpretation
   * @param trendData - Optional historical trend data
   */
  const generateResultValueSuggestions = useCallback(async (
    resultValues: ResultValue[],
    patient?: PatientContext,
    trendData?: any
  ): Promise<ResultValue[]> => {
    const aiResponse = await callAIFunction<ResultValue[]>({
      action: 'analyze_result_values',
      result_values: resultValues,
      patient,
      trend_data: trendData,
    });

    // Merge AI response with original input to preserve IDs
    // Match by analyte_name since AI may not return the original ID
    return aiResponse.map((aiSuggestion) => {
      const original = resultValues.find(
        rv => rv.analyte_name === aiSuggestion.analyte_name
      );
      return {
        ...aiSuggestion,
        // Preserve the original result_value ID for database update
        id: original?.id || aiSuggestion.id,
        analyte_id: original?.analyte_id || aiSuggestion.analyte_id,
        // Keep original values that may not be in AI response
        value: original?.value || aiSuggestion.value || '',
        unit: original?.unit || aiSuggestion.unit || '',
        reference_range: original?.reference_range || aiSuggestion.reference_range || '',
      };
    });
  }, [callAIFunction]);

  /**
   * Save AI suggestions to result_values table
   * Updates BOTH the ai_suggested fields AND the actual flag field
   * @param suggestions - AI-generated suggestions with result_value IDs
   * @param applyToActualFlag - If true, also updates the actual 'flag' column (default: true)
   */
  const saveResultValueSuggestions = useCallback(async (
    suggestions: ResultValue[],
    applyToActualFlag: boolean = true
  ): Promise<{ success: number; failed: number }> => {
    setState({ loading: true, error: null });
    
    try {
      let successCount = 0;
      let failedCount = 0;

      for (const suggestion of suggestions) {
        if (!suggestion.id) {
          failedCount++;
          continue;
        }

        // Build update object
        const updateData: Record<string, any> = {
          ai_suggested_flag: suggestion.ai_suggested_flag,
          ai_suggested_interpretation: suggestion.ai_suggested_interpretation,
          updated_at: new Date().toISOString(),
        };

        // Also update the actual flag if requested
        if (applyToActualFlag && suggestion.ai_suggested_flag) {
          updateData.flag = suggestion.ai_suggested_flag;
        }

        const { error } = await database.supabase
          .from('result_values')
          .update(updateData)
          .eq('id', suggestion.id);

        if (error) {
          console.error(`Failed to save AI suggestion for ${suggestion.id}:`, error);
          failedCount++;
        } else {
          successCount++;
        }
      }

      setState({ loading: false, error: null });
      return { success: successCount, failed: failedCount };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to save AI suggestions';
      setState({ loading: false, error: errorMessage });
      throw error;
    }
  }, []);

  /**
   * Get verifier summary for a test group
   * Call at TEST GROUP level before approval
   */
  const getVerifierSummary = useCallback(async (
    testGroup: TestGroupContext,
    resultValues: ResultValue[],
    patient?: PatientContext
  ): Promise<VerifierSummaryResponse> => {
    return callAIFunction<VerifierSummaryResponse>({
      action: 'verifier_summary',
      test_group: testGroup,
      result_values: resultValues,
      patient,
    });
  }, [callAIFunction]);

  /**
   * Get clinical summary for referring doctor
   * Call at ORDER level after all results are verified
   * @param testGroups - Array of test groups with their result values (including historical_values)
   * @param patient - Optional patient context for personalized summary
   */
  const getClinicalSummary = useCallback(async (
    testGroups: Array<{
      name: string;
      category: string;
      result_values: ResultValue[];
    }>,
    patient?: PatientContext
  ): Promise<ClinicalSummaryResponse> => {
    return callAIFunction<ClinicalSummaryResponse>({
      action: 'clinical_summary',
      test_groups: testGroups,
      patient,
    });
  }, [callAIFunction]);

  /**
   * Get patient-friendly summary in selected language
   * Call at ORDER level - generates easy-to-understand summary for patients
   * 
   * @param testGroups - Array of test groups with their result values
   * @param language - Target language for the summary (medical terms stay in English)
   * @param referringDoctorName - Name of referring doctor for consultation recommendation
   * @param patient - Optional patient context for personalized summary
   */
  const getPatientSummary = useCallback(async (
    testGroups: Array<{
      name: string;
      category: string;
      result_values: ResultValue[];
    }>,
    language: SupportedLanguage = 'english',
    referringDoctorName?: string,
    patient?: PatientContext
  ): Promise<PatientSummaryResponse> => {
    const rawResponse = await callAIFunction<Record<string, any>>({
      action: 'patient_summary',
      test_groups: testGroups,
      language,
      referring_doctor_name: referringDoctorName || 'your doctor',
      patient,
    });

    // Known fields that we explicitly handle in UI
    const knownFields = [
      'health_status',
      'normal_findings_summary',
      'normal_findings_detailed',
      'abnormal_findings',
      'needs_consultation',
      'consultation_message',
      'consultation_recommendation',
      'referring_doctor_name',
      'health_tips',
      'summary_message',
      'language',
      '_savedFromDb',
      '_generatedAt',
      '_raw_response',
      '_extra_fields'
    ];

    // Extract any extra fields not in our known list
    const extraFields: Record<string, any> = {};
    for (const key of Object.keys(rawResponse)) {
      if (!knownFields.includes(key)) {
        extraFields[key] = rawResponse[key];
      }
    }

    // Build the typed response with fallbacks
    const typedResponse: PatientSummaryResponse = {
      health_status: rawResponse.health_status || 'Unable to generate health status summary.',
      normal_findings_summary: rawResponse.normal_findings_summary,
      normal_findings_detailed: rawResponse.normal_findings_detailed,
      abnormal_findings: rawResponse.abnormal_findings || [],
      needs_consultation: rawResponse.needs_consultation ?? false,
      consultation_message: rawResponse.consultation_message,
      consultation_recommendation: rawResponse.consultation_recommendation,
      referring_doctor_name: rawResponse.referring_doctor_name,
      health_tips: rawResponse.health_tips || [],
      summary_message: rawResponse.summary_message,
      language: rawResponse.language || language,
      _raw_response: rawResponse,
      _extra_fields: Object.keys(extraFields).length > 0 ? extraFields : undefined,
    };

    return typedResponse;
  }, [callAIFunction]);

  /**
   * Perform AI Delta Check - Quality control check for laboratory results
   * Compares current results with historical data to identify:
   * - Potential input errors
   * - Sample issues (hemolysis, lipemia, etc.)
   * - Conflicting results between related tests
   * - Unusual changes from previous results
   *
   * @param testGroup - Test group context
   * @param resultValues - Current result values with historical data
   * @param patient - Optional patient context
   * @param relatedTestResults - Optional results from related tests in the same order
   */
  const performDeltaCheck = useCallback(async (
    testGroup: TestGroupContext,
    resultValues: ResultValue[],
    patient?: PatientContext,
    relatedTestResults?: Array<{
      test_name: string;
      analyte_name: string;
      value: string;
      unit: string;
      flag?: string | null;
    }>
  ): Promise<DeltaCheckResponse> => {
    return callAIFunction<DeltaCheckResponse>({
      action: 'delta_check',
      test_group: testGroup,
      result_values: resultValues,
      patient,
      related_test_results: relatedTestResults,
    });
  }, [callAIFunction]);

  return {
    // State
    loading: state.loading,
    error: state.error,

    // Actions
    generateMissingInterpretations,
    generateResultValueSuggestions,
    saveResultValueSuggestions,
    getVerifierSummary,
    getClinicalSummary,
    getPatientSummary,
    performDeltaCheck,

    // Clear error utility
    clearError: useCallback(() => {
      setState(prev => ({ ...prev, error: null }));
    }, []),
  };
}

export default useAIResultIntelligence;
