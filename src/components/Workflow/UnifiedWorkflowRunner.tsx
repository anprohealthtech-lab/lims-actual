/**
 * UnifiedWorkflowRunner
 *
 * Consolidated workflow runner that replaces:
 * - WorkflowRunner.tsx (full-featured)
 * - SimpleWorkflowRunner.tsx (simplified)
 * - ModularWorkflowExecutor.tsx (AI-hooked)
 *
 * Features:
 * - Automatic order context pre-population
 * - File upload handling with storage integration
 * - AI processing hooks
 * - Configurable modes for different use cases
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Model } from 'survey-core';
import { Survey } from 'survey-react-ui';
import 'survey-core/defaultV2.min.css';

import { supabase, uploadFile, generateFilePath } from '../../utils/supabase';
import {
  fetchWorkflowContext,
  applyContextToSurvey,
  fetchAnalyteCatalog,
  validateWorkflowContext,
  type WorkflowContext
} from '../../utils/workflowContextService';

// ============================================================================
// Types
// ============================================================================

export type WorkflowMode = 'full' | 'simple' | 'modular';
export type WorkflowStatus = 'idle' | 'loading' | 'context_loading' | 'ready' | 'running' | 'submitting' | 'completed' | 'error';

export interface WorkflowFeatures {
  autoContext: boolean;          // Auto-fetch and pre-populate order context
  fileUploads: boolean;          // Enable file upload handling
  aiAnalysis: boolean;           // Enable AI processing after submission
  readOnlyContext: boolean;      // Make pre-populated fields read-only
  showContextIndicator: boolean; // Show [Auto-filled] indicator on pre-populated fields
}

export interface UnifiedWorkflowRunnerProps {
  // Required
  workflowDefinition: any;
  orderId: string;

  // Optional - will be fetched automatically if autoContext enabled
  testGroupId?: string;
  patientId?: string;
  patientName?: string;
  testName?: string;
  sampleId?: string;
  labId?: string;
  testCode?: string;

  // Workflow management
  workflowVersionId?: string;
  workflowMapId?: string;
  instanceId?: string;

  // Configuration
  mode?: WorkflowMode;
  features?: Partial<WorkflowFeatures>;

  // Callbacks
  onComplete?: (results: any) => void;
  onError?: (error: Error) => void;
  onContextLoaded?: (context: WorkflowContext) => void;

  // Styling
  className?: string;
}

interface AttachmentRecord {
  attachment_id: string;
  file_url: string;
  file_path: string;
  file_name: string;
  file_type: string;
  question_id: string;
  uploaded_at: string;
  metadata?: Record<string, unknown>;
}

interface AnalyteCatalogEntry {
  id: string | null;
  name: string;
  unit: string | null;
  reference_range: string | null;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_FEATURES: WorkflowFeatures = {
  autoContext: true,
  fileUploads: true,
  aiAnalysis: true,
  readOnlyContext: true,
  showContextIndicator: true
};

// ============================================================================
// Component
// ============================================================================

const UnifiedWorkflowRunner: React.FC<UnifiedWorkflowRunnerProps> = ({
  workflowDefinition,
  orderId,
  testGroupId: propTestGroupId,
  patientId: propPatientId,
  patientName: propPatientName,
  testName: propTestName,
  sampleId: propSampleId,
  labId: propLabId,
  testCode: propTestCode,
  workflowVersionId,
  workflowMapId,
  instanceId: providedInstanceId,
  mode = 'full',
  features: propFeatures,
  onComplete,
  onError,
  onContextLoaded,
  className = ''
}) => {
  // Merge features with defaults
  const features = { ...DEFAULT_FEATURES, ...propFeatures };

  // State
  const [survey, setSurvey] = useState<Model | null>(null);
  const [status, setStatus] = useState<WorkflowStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [context, setContext] = useState<WorkflowContext | null>(null);
  const [instanceId, setInstanceId] = useState<string | null>(providedInstanceId || null);
  const [analyteCatalog, setAnalyteCatalog] = useState<AnalyteCatalogEntry[]>([]);
  const [completionData, setCompletionData] = useState<any>(null);

  // Refs
  const attachmentsRef = useRef<Record<string, AttachmentRecord[]>>({});

  // Derived values (from context or props)
  const testGroupId = context?.testGroupId || propTestGroupId;
  const patientId = context?.patientId || propPatientId;
  const patientName = context?.patientName || propPatientName;
  const testName = context?.testName || propTestName;
  const sampleId = context?.sampleId || propSampleId;
  const labId = context?.labId || propLabId;
  const testCode = context?.testCode || propTestCode;

  // ============================================================================
  // Context Loading
  // ============================================================================

  useEffect(() => {
    if (!features.autoContext || !orderId) return;

    let isMounted = true;

    const loadContext = async () => {
      setStatus('context_loading');

      try {
        const fetchedContext = await fetchWorkflowContext({
          orderId,
          testGroupId: propTestGroupId,
          includeAnalytes: true
        });

        if (!isMounted) return;

        if (fetchedContext) {
          const validation = validateWorkflowContext(fetchedContext);
          if (!validation.valid) {
            console.warn('Workflow context validation warnings:', validation.errors);
          }

          setContext(fetchedContext);
          onContextLoaded?.(fetchedContext);

          console.log('Workflow context loaded:', {
            orderId: fetchedContext.orderId,
            sampleId: fetchedContext.sampleId,
            patientName: fetchedContext.patientName,
            testName: fetchedContext.testName
          });
        }
      } catch (err) {
        console.error('Failed to load workflow context:', err);
        // Continue without context - fields won't be pre-populated
      }

      if (isMounted) {
        setStatus('loading');
      }
    };

    loadContext();

    return () => { isMounted = false; };
  }, [orderId, propTestGroupId, features.autoContext]);

  // ============================================================================
  // Analyte Catalog Loading
  // ============================================================================

  useEffect(() => {
    if (!testGroupId) return;

    let isMounted = true;

    const loadCatalog = async () => {
      const catalog = await fetchAnalyteCatalog(testGroupId);
      if (isMounted) {
        setAnalyteCatalog(catalog);
      }
    };

    loadCatalog();

    return () => { isMounted = false; };
  }, [testGroupId]);

  // ============================================================================
  // Survey Initialization
  // ============================================================================

  useEffect(() => {
    if (!workflowDefinition) return;
    if (features.autoContext && status === 'context_loading') return;

    try {
      setStatus('loading');

      // Create survey model from workflow definition
      const surveyModel = new Model(workflowDefinition.ui?.template || workflowDefinition);

      // Configure survey theme
      surveyModel.applyTheme({
        colorPalette: 'light',
        isPanelless: false
      });

      // Configure file upload questions to use upload handler
      if (features.fileUploads) {
        surveyModel.getAllQuestions().forEach((question: any) => {
          if (question.getType() === 'file') {
            question.storeDataAsText = false;
          }
        });
      }

      // Apply context pre-population
      if (context && features.autoContext) {
        applyContextToSurvey(surveyModel, context, {
          makeReadOnly: features.readOnlyContext,
          showAsVerification: features.showContextIndicator
        });
      } else if (!features.autoContext) {
        // Manual context from props
        surveyModel.data = {
          orderId,
          testGroupId: propTestGroupId,
          patientId: propPatientId,
          patientName: propPatientName,
          testName: propTestName,
          sampleId: propSampleId,
          labId: propLabId,
          testCode: propTestCode,
          ...surveyModel.data
        };
      }

      setSurvey(surveyModel);
      setStatus('ready');
      setError(null);

    } catch (err) {
      console.error('Error initializing workflow:', err);
      setError('Failed to initialize workflow');
      setStatus('error');
      onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  }, [workflowDefinition, context, features.autoContext, status]);

  // ============================================================================
  // Instance Management
  // ============================================================================

  useEffect(() => {
    if (!orderId || !workflowVersionId || providedInstanceId) return;

    let isMounted = true;

    const ensureInstance = async () => {
      try {
        // Check for existing instance
        const { data: existing, error: fetchError } = await supabase
          .from('order_workflow_instances')
          .select('id, workflow_version_id, status')
          .eq('order_id', orderId)
          .order('started_at', { ascending: false })
          .limit(1);

        if (fetchError) throw fetchError;

        const existingInstance = existing?.[0];

        if (existingInstance?.id) {
          // Update if different version
          if (existingInstance.workflow_version_id !== workflowVersionId) {
            await supabase
              .from('order_workflow_instances')
              .update({
                workflow_version_id: workflowVersionId,
                status: 'in_progress',
                completed_at: null,
              })
              .eq('id', existingInstance.id);
          }

          if (isMounted) setInstanceId(existingInstance.id);
          return;
        }

        // Create new instance
        const newId = crypto.randomUUID();
        const { data: created, error: insertError } = await supabase
          .from('order_workflow_instances')
          .insert({
            id: newId,
            order_id: orderId,
            workflow_version_id: workflowVersionId,
            current_step_id: 'survey_capture',
            status: 'in_progress',
            started_at: new Date().toISOString(),
          })
          .select()
          .single();

        if (insertError) throw insertError;

        if (isMounted) setInstanceId(created.id);

      } catch (err) {
        console.error('Failed to initialize workflow instance:', err);
        if (isMounted) {
          setError('Failed to initialize workflow instance');
          setStatus('error');
        }
      }
    };

    ensureInstance();

    return () => { isMounted = false; };
  }, [orderId, workflowVersionId, providedInstanceId]);

  // ============================================================================
  // File Upload Handler
  // ============================================================================

  useEffect(() => {
    if (!survey || !instanceId || !features.fileUploads) return;

    const handleUploadFiles = async (_: Model, options: any) => {
      if (!labId || !orderId || !patientId) {
        console.error('Missing context for workflow file upload');
        options.callback('error');
        return;
      }

      try {
        const { data: { user } } = await supabase.auth.getUser();
        const uploadedBy = user?.id ?? null;
        const questionName = options.question?.name as string | undefined;

        const uploadedPayload = [];
        const attachmentRecords: AttachmentRecord[] = [];

        for (const file of options.files ?? []) {
          const filePath = generateFilePath(file.name, patientId, labId, 'workflow');
          const { path, publicUrl } = await uploadFile(file, filePath, { upsert: false });

          const { data: attachment, error: attachmentError } = await supabase
            .from('attachments')
            .insert({
              related_table: 'order_workflow_instances',
              related_id: instanceId,
              order_id: orderId,
              patient_id: patientId,
              lab_id: labId,
              uploaded_by: uploadedBy,
              file_path: path,
              file_url: publicUrl,
              original_filename: file.name,
              file_type: file.type,
              file_size: file.size,
              description: `Workflow upload for ${questionName ?? 'workflow'}`,
              metadata: JSON.stringify({
                question_id: questionName,
                workflow_version_id: workflowVersionId,
                workflow_map_id: workflowMapId,
                test_group_id: testGroupId,
              }),
            })
            .select()
            .single();

          if (attachmentError || !attachment) {
            throw attachmentError ?? new Error('Failed to save attachment record');
          }

          attachmentRecords.push({
            attachment_id: attachment.id,
            file_url: attachment.file_url,
            file_path: attachment.file_path,
            file_name: attachment.original_filename,
            file_type: attachment.file_type,
            question_id: questionName ?? 'workflow_upload',
            uploaded_at: attachment.created_at ?? new Date().toISOString(),
            metadata: attachment.metadata ?? undefined,
          });

          uploadedPayload.push({
            file: file,
            content: publicUrl,
            name: file.name,
            type: file.type,
          });
        }

        // Store attachment records
        if (questionName) {
          const existing = attachmentsRef.current[questionName] ?? [];
          attachmentsRef.current[questionName] = [...existing, ...attachmentRecords];
        }

        options.callback('success', uploadedPayload);
      } catch (uploadError) {
        console.error('Workflow file upload failed:', uploadError);
        options.callback('error');
      }
    };

    survey.onUploadFiles.add(handleUploadFiles);

    return () => {
      survey.onUploadFiles.remove(handleUploadFiles);
    };
  }, [survey, instanceId, labId, orderId, patientId, workflowVersionId, workflowMapId, testGroupId, features.fileUploads]);

  // ============================================================================
  // Completion Handler
  // ============================================================================

  const handleComplete = useCallback(async (sender: Model) => {
    // Gate: Require order ID
    if (!orderId) {
      setError('No order ID provided. Please create an order first.');
      setStatus('error');
      return;
    }

    if (!instanceId) {
      setError('Workflow instance not initialized. Please try again.');
      setStatus('error');
      return;
    }

    try {
      setStatus('submitting');

      const surveyResults = sender.data;
      const attachmentMap = attachmentsRef.current;
      const flattenedAttachments = Object.values(attachmentMap).flat();

      // Build serialized attachments
      const serializedAttachments: Record<string, any> = {};
      for (const [questionId, records] of Object.entries(attachmentMap)) {
        serializedAttachments[questionId] = records.map((record) => ({
          attachment_id: record.attachment_id,
          url: record.file_url,
          file_name: record.file_name,
          file_type: record.file_type,
          uploaded_at: record.uploaded_at,
        }));
      }

      const combinedResults = { ...surveyResults, ...serializedAttachments };

      // Build workflow_results record
      const workflowResult = {
        workflow_instance_id: instanceId,
        step_id: 'final_results',
        order_id: orderId,
        patient_id: patientId,
        lab_id: labId,
        test_group_id: testGroupId,
        test_name: testName,
        test_code: testCode,
        review_status: 'completed',
        sample_id: sampleId,
        status: 'done',
        payload: {
          orderId,
          testGroupId,
          patientId,
          patientName,
          testName,
          sampleId,
          labId,
          testCode,
          context: context ? {
            collectionDate: context.collectionDate,
            collectionTime: context.collectionTime,
            collectorName: context.collectorName,
            technicianId: context.technicianId,
            technicianName: context.technicianName,
          } : null,
          results: {
            ...combinedResults,
            attachments: flattenedAttachments.map((record) => ({
              question_id: record.question_id,
              attachment_id: record.attachment_id,
              file_name: record.file_name,
              url: record.file_url,
            })),
          },
        },
      };

      // Submit to database
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/workflow_results?on_conflict=workflow_instance_id,step_id&select=*`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
            'Prefer': 'resolution=merge-duplicates,return=representation'
          },
          body: JSON.stringify([workflowResult])
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to submit workflow results');
      }

      // Update instance status
      await supabase
        .from('order_workflow_instances')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          current_step_id: null,
        })
        .eq('id', instanceId);

      // AI Processing (if enabled)
      if (features.aiAnalysis && testGroupId) {
        try {
          await supabase.functions.invoke('process-workflow-results', {
            body: {
              workflow_instance_id: instanceId,
              order_id: orderId,
              test_group_id: testGroupId,
              lab_id: labId,
              analyteCatalog,
              analytesToExtract: analyteCatalog
                .filter((entry) => entry.name)
                .map((entry) => entry.name),
            },
          });
        } catch (aiError) {
          console.error('AI processing failed:', aiError);
          // Don't fail the workflow - results are saved
        }
      }

      setCompletionData(combinedResults);
      setStatus('completed');
      onComplete?.(combinedResults);

    } catch (err) {
      console.error('Error submitting workflow results:', err);
      setError(err instanceof Error ? err.message : 'Failed to submit results');
      setStatus('error');
      onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  }, [instanceId, orderId, testGroupId, patientId, patientName, testName, sampleId, labId, testCode, context, analyteCatalog, features.aiAnalysis, onComplete, onError]);

  // Attach completion handler to survey
  useEffect(() => {
    if (!survey) return;

    survey.onComplete.add(handleComplete);
    return () => survey.onComplete.remove(handleComplete);
  }, [survey, handleComplete]);

  // ============================================================================
  // Render
  // ============================================================================

  // Loading states
  if (status === 'idle' || status === 'context_loading' || status === 'loading') {
    return (
      <div className={`bg-white rounded-lg border border-gray-200 p-6 ${className}`}>
        <div className="flex items-center justify-center">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 mr-3"></div>
          <span className="text-gray-600">
            {status === 'context_loading' ? 'Loading order context...' : 'Initializing workflow...'}
          </span>
        </div>
      </div>
    );
  }

  // Error state
  if (status === 'error') {
    return (
      <div className={`bg-white rounded-lg border border-red-200 p-6 ${className}`}>
        <div className="flex items-start text-red-600 mb-4">
          <svg className="h-6 w-6 mr-3 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
          </svg>
          <div>
            <h3 className="font-semibold">Workflow Error</h3>
            <p className="text-sm mt-1">{error}</p>
          </div>
        </div>
        <button
          onClick={() => {
            setStatus('idle');
            setError(null);
            setContext(null);
          }}
          className="px-4 py-2 bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
        >
          Retry
        </button>
      </div>
    );
  }

  // Completed state
  if (status === 'completed') {
    return (
      <div className={`bg-white rounded-lg border border-green-200 p-6 ${className}`}>
        <div className="flex items-center text-green-600 mb-4">
          <svg className="h-6 w-6 mr-3" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
          <h3 className="text-lg font-semibold">Workflow Completed Successfully</h3>
        </div>

        <p className="text-sm text-gray-600 mb-4">
          Results have been saved and linked to order {context?.orderNumber || orderId.slice(0, 8)}.
        </p>

        {completionData && (
          <details className="mb-4">
            <summary className="cursor-pointer text-sm text-blue-600 hover:text-blue-800">
              View Results Summary
            </summary>
            <div className="mt-2 bg-gray-50 p-4 rounded-lg">
              <pre className="text-xs overflow-auto max-h-40">
                {JSON.stringify(completionData, null, 2)}
              </pre>
            </div>
          </details>
        )}

        <button
          onClick={() => {
            setStatus('idle');
            setCompletionData(null);
            attachmentsRef.current = {};
            survey?.clear();
          }}
          className="px-4 py-2 bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
        >
          Run Again
        </button>
      </div>
    );
  }

  // Ready/Running state - Show survey
  return (
    <div className={`bg-white rounded-lg border border-gray-200 ${className}`}>
      {/* Header with context summary */}
      <div className="p-4 border-b border-gray-200 bg-gray-50">
        <h3 className="text-lg font-semibold">
          {workflowDefinition?.title || workflowDefinition?.meta?.title || workflowDefinition?.meta?.display_name || 'Workflow'}
        </h3>
        {context && (
          <div className="mt-2 flex flex-wrap gap-3 text-sm text-gray-600">
            {context.sampleId && (
              <span className="inline-flex items-center px-2 py-1 bg-blue-100 text-blue-800 rounded">
                Sample: {context.sampleId}
              </span>
            )}
            {context.patientName && (
              <span className="inline-flex items-center px-2 py-1 bg-green-100 text-green-800 rounded">
                Patient: {context.patientName}
              </span>
            )}
            {context.testName && (
              <span className="inline-flex items-center px-2 py-1 bg-purple-100 text-purple-800 rounded">
                Test: {context.testName}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Survey */}
      <div className="p-4">
        {status === 'submitting' && (
          <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex items-center">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mr-2"></div>
              <span className="text-sm">Submitting results...</span>
            </div>
          </div>
        )}

        {survey && <Survey model={survey} />}
      </div>
    </div>
  );
};

export default UnifiedWorkflowRunner;
