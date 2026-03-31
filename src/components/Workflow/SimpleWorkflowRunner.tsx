import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Model } from 'survey-core'
import { Survey } from 'survey-react-ui'
import 'survey-core/defaultV2.min.css'
import { supabase, database, uploadFile, generateFilePath } from '../../utils/supabase'

interface SimpleWorkflowRunnerProps {
  workflowDefinition: any
  onComplete?: (results: any) => void
  orderId?: string
  testGroupId?: string
  patientId?: string
  patientName?: string
  testName?: string
  sampleId?: string
  labId?: string
  testCode?: string
  workflowVersionId?: string
  workflowMapId?: string
}

type WorkflowStatus = 'loading' | 'ready' | 'running' | 'completed' | 'error'

interface AnalyteCatalogEntry {
  id: string | null
  name: string | null
  unit?: string | null
  reference_range?: string | null
  code?: string | null
}

type WorkflowAttachmentRecord = {
  attachment_id: string
  file_url: string
  file_path: string
  file_name: string
  file_type: string
  question_id: string
  uploaded_at: string
  metadata?: Record<string, unknown>
}

const SimpleWorkflowRunner: React.FC<SimpleWorkflowRunnerProps> = ({
  workflowDefinition,
  onComplete,
  orderId,
  testGroupId,
  patientId,
  patientName,
  testName,
  sampleId,
  labId,
  testCode,
  workflowVersionId,
  workflowMapId
}) => {
  const [survey, setSurvey] = useState<Model | null>(null)
  const [status, setStatus] = useState<WorkflowStatus>('loading')
  const [error, setError] = useState<string | null>(null)
  const [completionData, setCompletionData] = useState<any>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [instanceId, setInstanceId] = useState<string | null>(null)
  const [initializingInstance, setInitializingInstance] = useState(false)
  const [analyteCatalog, setAnalyteCatalog] = useState<AnalyteCatalogEntry[]>([])
  const attachmentsRef = useRef<Record<string, WorkflowAttachmentRecord[]>>({})

  // Initialize Survey.js model
  useEffect(() => {
    if (!workflowDefinition) return

    try {
      const surveyModel = new Model(workflowDefinition.ui?.template || workflowDefinition)
      
      // Configure survey theme and behavior
      surveyModel.applyTheme({
        colorPalette: 'light',
        isPanelless: false
      })

      // CRITICAL: Configure all file upload questions to NOT store base64
      // This ensures files are uploaded to storage via onUploadFiles handler
      surveyModel.getAllQuestions().forEach((question: any) => {
        if (question.getType() === 'file') {
          question.storeDataAsText = false // Force upload handler usage
          console.log(`Configured file question "${question.name}" to use upload handler (storeDataAsText=false)`)
        }
      })

      setSurvey(surveyModel)
    } catch (err) {
      console.error('Error initializing survey:', err)
      setError('Failed to initialize workflow')
      setStatus('error')
    }
  }, [workflowDefinition])

  // Set survey data with context information
  useEffect(() => {
    if (survey && orderId) {
      survey.data = {
        orderId,
        testGroupId,
        patientId,
        patientName,
        testName,
        sampleId,
        labId,
        testCode,
        ...survey.data
      };
    }
  }, [survey, orderId, testGroupId, patientId, patientName, testName, sampleId, labId, testCode]);

  useEffect(() => {
    if (!orderId || !workflowVersionId) {
      return
    }

    let isActive = true

    const ensureInstance = async () => {
      setInitializingInstance(true)
      try {
        const { data: existingList, error: fetchError } = await supabase
          .from('order_workflow_instances')
          .select('id, workflow_version_id, status')
          .eq('order_id', orderId)
          .order('started_at', { ascending: false })
          .limit(1)

        if (fetchError) {
          throw fetchError
        }

        const existing = existingList?.[0] || null

        if (existing?.id) {
          if (existing.workflow_version_id !== workflowVersionId) {
            await supabase
              .from('order_workflow_instances')
              .update({
                workflow_version_id: workflowVersionId,
                status: 'in_progress',
                completed_at: null,
              })
              .eq('id', existing.id)
          }

          if (isActive) {
            setInstanceId(existing.id)
          }
          return
        }

        const generatedId = crypto.randomUUID()
        const { data: created, error: insertError } = await supabase
          .from('order_workflow_instances')
          .insert({
            id: generatedId,
            order_id: orderId,
            workflow_version_id: workflowVersionId,
            current_step_id: 'survey_capture',
            status: 'in_progress',
            started_at: new Date().toISOString(),
          })
          .select()
          .single()

        if (insertError) {
          throw insertError
        }

        if (isActive) {
          setInstanceId(created.id)
        }
      } catch (instanceError) {
        console.error('Failed to initialize workflow instance:', instanceError)
        if (isActive) {
          setError('Failed to initialize workflow instance')
          setStatus('error')
        }
      } finally {
        if (isActive) {
          setInitializingInstance(false)
        }
      }
    }

    ensureInstance()

    return () => {
      isActive = false
    }
  }, [orderId, workflowVersionId])

  useEffect(() => {
    attachmentsRef.current = {}
  }, [orderId, workflowVersionId])

  useEffect(() => {
    let isActive = true

    const loadAnalyteCatalog = async () => {
      console.log('Loading analyte catalog for testGroupId:', testGroupId)
      
      if (!testGroupId) {
        console.warn('⚠️ No testGroupId provided - analyte catalog will be empty')
        if (isActive) setAnalyteCatalog([])
        return
      }

      try {
        const { data, error } = await supabase
          .from('test_group_analytes')
          .select(`
            analyte_id,
            lab_analyte_id,
            analytes (
              id,
              name,
              unit,
              reference_range
            ),
            lab_analytes (
              id,
              name,
              unit,
              reference_range,
              lab_specific_reference_range
            )
          `)
          .eq('test_group_id', testGroupId)

        if (error) throw error

        console.log('Raw analyte catalog data from DB:', data)

        const catalog = (data ?? [])
          .map((row: any) => {
            const analyte = row.analytes ?? {}
            const la = row.lab_analyte_id ? row.lab_analytes : null
            const name: string | null = la?.name || analyte?.name || null
            if (!name || typeof name !== 'string' || name.trim().length === 0) {
              return null
            }
            return {
              id: (row.analyte_id ?? analyte?.id ?? null) as string | null,
              name,
              unit: la?.unit ?? analyte?.unit ?? null,
              reference_range: la?.lab_specific_reference_range ?? la?.reference_range ?? analyte?.reference_range ?? null,
              code: null,
            } satisfies AnalyteCatalogEntry
          })
          .filter((entry): entry is AnalyteCatalogEntry => entry !== null)

        console.log('✅ Loaded analyte catalog:', catalog.length, 'entries', catalog)

        if (isActive) {
          setAnalyteCatalog(catalog)
        }
      } catch (catalogError) {
        console.error('❌ Failed to load workflow analyte catalog:', catalogError)
        if (isActive) setAnalyteCatalog([])
      }
    }

    loadAnalyteCatalog()

    return () => {
      isActive = false
    }
  }, [testGroupId])

  useEffect(() => {
    if (!survey || !instanceId) {
      return
    }

    const handleUploadFiles = async (_: Model, options: any) => {
      if (!labId || !orderId || !patientId) {
        console.error('Missing context for workflow file upload')
        options.callback('error')
        return
      }

      try {
        const { data: { user } } = await supabase.auth.getUser()
        const uploadedBy = user?.id ?? null
        const questionName = options.question?.name as string | undefined

        const uploadedPayload = []
        const attachmentRecords: WorkflowAttachmentRecord[] = []

        for (const file of options.files ?? []) {
          const filePath = generateFilePath(file.name, patientId, labId, 'workflow')
          const { path, publicUrl } = await uploadFile(file, filePath, { upsert: false })

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
            .single()

          if (attachmentError || !attachment) {
            throw attachmentError ?? new Error('Failed to save attachment record')
          }

          const attachmentRecord: WorkflowAttachmentRecord = {
            attachment_id: attachment.id,
            file_url: attachment.file_url,
            file_path: attachment.file_path,
            file_name: attachment.original_filename,
            file_type: attachment.file_type,
            question_id: questionName ?? 'workflow_upload',
            uploaded_at: attachment.created_at ?? new Date().toISOString(),
            metadata: attachment.metadata ?? undefined,
          }

          attachmentRecords.push(attachmentRecord)

          // Survey.js expects this specific format in the callback
          uploadedPayload.push({
            file: file,
            content: publicUrl,
            name: file.name,
            type: file.type,
          })
        }

        // Store attachment records for later reference
        if (questionName) {
          const existing = attachmentsRef.current[questionName] ?? []
          attachmentsRef.current[questionName] = [...existing, ...attachmentRecords]
        }

        // Call callback with the correct format Survey.js expects
        options.callback('success', uploadedPayload)
      } catch (uploadError) {
        console.error('Workflow file upload failed:', uploadError)
        options.callback('error')
      }
    }

    survey.onUploadFiles.add(handleUploadFiles)

    return () => {
      survey.onUploadFiles.remove(handleUploadFiles)
    }
  }, [survey, instanceId, labId, orderId, patientId, workflowVersionId, workflowMapId, testGroupId])

  useEffect(() => {
    if (survey && instanceId && status === 'loading' && !initializingInstance) {
      setStatus('ready')
    }
  }, [survey, instanceId, status, initializingInstance])

  // Extract measurement data from survey results
  const extractMeasurements = (results: any) => {
    const measurements: Record<string, any> = {}
    
    // Look for numeric fields that could be measurements
    Object.entries(results).forEach(([key, value]) => {
      if (typeof value === 'number' || (typeof value === 'string' && !isNaN(Number(value)))) {
        measurements[key] = value
      }
    })
    
    return measurements
  }

  // Extract QC data from survey results
  const extractQCData = (results: any) => {
    if (results.smear_quality) {
      return {
        type: 'smear_quality',
        value: results.smear_quality,
        status: results.smear_quality === 'Good' ? 'pass' : 'fail',
        notes: results.observations || ''
      }
    }
    return null
  }

  // Handle workflow completion with database submission
  const handleComplete = useCallback(async (sender: any) => {
    try {
      setIsSubmitting(true)
      
      // HARD GATE: Block if no order ID - as specified in requirements
      if (!orderId) {
        alert('Create an order and collect sample first.')
        setStatus('error')
        setError('No order ID provided. Please create an order first.')
        return
      }

      if (!instanceId) {
        setStatus('error')
        setError('Workflow instance not initialized. Please try again.')
        return
      }
      
      // Get final results from survey
      const surveyResults = sender.data
      const attachmentMap = attachmentsRef.current
      const flattenedAttachments = Object.values(attachmentMap).flat()

      const serializedAttachments: Record<string, any> = {}
      for (const [questionId, records] of Object.entries(attachmentMap)) {
        serializedAttachments[questionId] = records.map((record) => ({
          attachment_id: record.attachment_id,
          url: record.file_url,
          file_name: record.file_name,
          file_type: record.file_type,
          uploaded_at: record.uploaded_at,
        }))
      }

      const combinedResults = {
        ...surveyResults,
        ...serializedAttachments,
      }
      
      // Build workflow_results record for direct API submission
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
          orderId: orderId,
          testGroupId: testGroupId,
          patientId: patientId,
          patientName: patientName,
          testName: testName,
          sampleId: sampleId,
          labId: labId,
          testCode: testCode,
          results: {
            patient_id: patientId,
            patient_name: patientName,
            sample_id: sampleId,
            review_status: 'completed',
            ...combinedResults,
            test_name: testName || workflowDefinition?.title || workflowDefinition?.meta?.title || 'Workflow Test',
            measurements: extractMeasurements(combinedResults),
            qc_data: extractQCData(combinedResults),
            attachments: flattenedAttachments.map((record) => ({
              question_id: record.question_id,
              attachment_id: record.attachment_id,
              file_name: record.file_name,
              url: record.file_url,
            })),
          },
        },
      }

      // Submit to Supabase REST API with correct conflict resolution using column names
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
      )

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.message || 'Failed to submit workflow results')
      }

  const result = await response.json()
  console.log('Workflow submitted successfully:', result)
      
      try {
        const instanceUpdate = supabase
          .from('order_workflow_instances')
          .update({
            status: 'completed',
            completed_at: new Date().toISOString(),
            current_step_id: null,
          })
          .eq('id', instanceId)

        if (labId) {
          instanceUpdate.eq('lab_id', labId)
        }

        await instanceUpdate
      } catch (instanceUpdateError) {
        console.error('Failed to update workflow instance status:', instanceUpdateError)
      }

      try {
        await database.workflowAI.queueProcessing({
          workflow_instance_id: instanceId,
          order_id: orderId,
          test_group_id: testGroupId,
          lab_id: labId,
          workflow_data: {
            ...combinedResults,
            analyte_catalog: analyteCatalog,
          },
          image_attachments: flattenedAttachments,
          reference_images: [],
        })
      } catch (queueError) {
        console.error('Failed to queue workflow AI processing:', queueError)
      }

      try {
        console.log('📊 About to call process-workflow-results with:', {
          workflow_instance_id: instanceId,
          order_id: orderId,
          test_group_id: testGroupId,
          lab_id: labId,
          analyteCatalog_length: analyteCatalog?.length || 0,
          analyteCatalog_first_3: analyteCatalog?.slice(0, 3),
          has_testGroupId: !!testGroupId,
        })

        const { data: functionData, error: functionError } = await supabase.functions.invoke('process-workflow-results', {
          body: {
            workflow_instance_id: instanceId,
            order_id: orderId,
            test_group_id: testGroupId,
            lab_id: labId,
            analyteCatalog,
            analytesToExtract: analyteCatalog
              .filter((entry) => entry.name != null && typeof entry.name === 'string')
              .map((entry) => entry.name as string)
              .filter((name) => name.trim().length > 0),
          },
        })

        if (functionError) {
          console.error('AI processing function error:', functionError)
          throw functionError
        }

        console.log('AI processing function succeeded:', functionData)
      } catch (functionError) {
        console.error('AI processing function invocation failed:', functionError)
        // Show error to user
        alert(`Warning: AI result processing failed. Results saved but may need manual review.\n\nError: ${functionError instanceof Error ? functionError.message : String(functionError)}`)
      }
      
      // Update local state
  setCompletionData(combinedResults)
      setStatus('completed')
      
      // Notify parent component
  onComplete?.(combinedResults)
      
    } catch (error) {
      console.error('Error submitting workflow results:', error)
      setStatus('error')
      setError(error instanceof Error ? error.message : 'Failed to submit results')
    } finally {
      setIsSubmitting(false)
    }
  }, [instanceId, orderId, testGroupId, patientId, patientName, testName, sampleId, labId, testCode, onComplete, workflowDefinition])

  // Attach completion handler
  useEffect(() => {
    if (survey) {
      survey.onComplete.add(handleComplete)
      return () => survey.onComplete.remove(handleComplete)
    }
  }, [survey, handleComplete])

  if (status === 'loading') {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="flex items-center justify-center">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 mr-2"></div>
          Loading workflow...
        </div>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="flex items-center text-red-600 mb-4">
          <svg className="h-6 w-6 mr-2" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
          </svg>
          <div>
            <h3 className="font-semibold">Error</h3>
            <p className="text-sm">{error}</p>
          </div>
        </div>
        <button 
          onClick={() => {
            setStatus('ready')
            setError(null)
          }}
          className="px-4 py-2 bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
        >
          Try Again
        </button>
      </div>
    )
  }

  if (status === 'completed') {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="flex items-center text-green-600 mb-4">
          <svg className="h-6 w-6 mr-2" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
          <h3 className="text-lg font-semibold">Workflow Completed Successfully</h3>
        </div>
        
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Your workflow has been completed and results have been saved to the database.
          </p>
          
          {completionData && (
            <div className="bg-gray-50 p-4 rounded-lg">
              <h4 className="font-semibold mb-2">Results Summary:</h4>
              <pre className="text-xs overflow-auto max-h-40">
                {JSON.stringify(completionData, null, 2)}
              </pre>
            </div>
          )}
          
          <button 
            onClick={() => {
              setStatus('ready')
              setCompletionData(null)
              attachmentsRef.current = {}
              survey?.clear()
            }}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
          >
            Run Again
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200">
      <div className="p-6 border-b border-gray-200">
        <h3 className="text-lg font-semibold">
          {workflowDefinition?.title || workflowDefinition?.meta?.title || 'Workflow'}
        </h3>
        {(workflowDefinition?.meta?.owner || workflowDefinition?.description) && (
          <p className="text-sm text-gray-600 mt-1">
            {workflowDefinition?.meta?.owner || workflowDefinition?.description}
          </p>
        )}
      </div>
      
      <div className="p-6">
        {isSubmitting && (
          <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex items-center">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mr-2"></div>
              <span className="text-sm">Submitting results to database...</span>
            </div>
          </div>
        )}
        
        {survey && <Survey model={survey} />}
      </div>
    </div>
  )
}

export default SimpleWorkflowRunner

