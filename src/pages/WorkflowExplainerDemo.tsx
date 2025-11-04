import React, { useState, useEffect } from 'react';
import WorkflowExplainer from '../components/Workflow/WorkflowConfigurator/WorkflowExplainer';
import ModularWorkflowExecutor from '../components/Workflow/ModularWorkflowExecutor';
import { database } from '../utils/supabase';

interface WorkflowOption {
  id: string;
  name: string;
  test_type: string;
  created_at: string;
  workflow_data: any;
}

const WorkflowExplainerDemo: React.FC = () => {
  const [selectedWorkflow, setSelectedWorkflow] = useState<WorkflowOption | null>(null);
  const [availableWorkflows, setAvailableWorkflows] = useState<WorkflowOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [modifiedWorkflow, setModifiedWorkflow] = useState<any>(null);
  const [viewMode, setViewMode] = useState<'explainer' | 'executor'>('explainer');
  const [executionResults, setExecutionResults] = useState<any>(null);

  useEffect(() => {
    loadAvailableWorkflows();
  }, []);

  const loadAvailableWorkflows = async () => {
    setLoading(true);
    try {
      // Load from workflow_versions table
      const { data: versions, error } = await database.workflowVersions.getAll();
      
      if (!error && versions) {
        const workflows: WorkflowOption[] = versions.map((v: any) => {
          let workflowData = v.definition;
          
          // Parse if string
          if (typeof workflowData === 'string') {
            try {
              workflowData = JSON.parse(workflowData);
            } catch (e) {
              console.error('Failed to parse workflow:', e);
              workflowData = null;
            }
          }
          
          return {
            id: v.id,
            name: workflowData?.ui?.template?.title || workflowData?.technician_flow?.title || `Workflow ${v.version}`,
            test_type: workflowData?.meta?.test_code || 'Unknown',
            created_at: v.created_at,
            workflow_data: workflowData
          };
        }).filter(w => w.workflow_data !== null);
        
        setAvailableWorkflows(workflows);
        
        // Select first workflow by default
        if (workflows.length > 0) {
          setSelectedWorkflow(workflows[0]);
        }
      }
    } catch (error) {
      console.error('Error loading workflows:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleWorkflowModified = (modifiedData: any) => {
    console.log('Workflow modified:', modifiedData);
    setModifiedWorkflow(modifiedData);
    
    // Update the selected workflow with modified data
    if (selectedWorkflow) {
      setSelectedWorkflow({
        ...selectedWorkflow,
        workflow_data: modifiedData
      });
    }
  };

  const saveModifiedWorkflow = async () => {
    if (!modifiedWorkflow || !selectedWorkflow) return;
    
    try {
      // Save to database
      const { error } = await database.workflowVersions.update(selectedWorkflow.id, {
        definition: modifiedWorkflow
      });
      
      if (!error) {
        alert('Workflow saved successfully!');
        // Reload workflows
        loadAvailableWorkflows();
      } else {
        throw error;
      }
    } catch (error) {
      console.error('Error saving workflow:', error);
      alert('Failed to save workflow. Please try again.');
    }
  };

  const handleExecutionComplete = (results: any) => {
    console.log('Workflow execution complete:', results);
    setExecutionResults(results);
  };

  const handleStepComplete = (stepId: string, results: any) => {
    console.log(`Step ${stepId} completed:`, results);
  };

  const deleteWorkflow = async (workflow: WorkflowOption) => {
    const confirmDelete = confirm(
      `Are you sure you want to delete the workflow "${workflow.name}"?\n\nThis action cannot be undone.`
    );
    
    if (!confirmDelete) return;
    
    try {
      const { error } = await database.workflowVersions.delete(workflow.id);
      
      if (!error) {
        alert('Workflow deleted successfully!');
        // Clear selection if deleted workflow was selected
        if (selectedWorkflow?.id === workflow.id) {
          setSelectedWorkflow(null);
        }
        // Reload workflows
        loadAvailableWorkflows();
      } else {
        throw error;
      }
    } catch (error) {
      console.error('Error deleting workflow:', error);
      alert('Failed to delete workflow. Please try again.');
    }
  };

  const generateWorkflowReport = async (workflow: WorkflowOption) => {
    try {
      const reportContent = generateWorkflowReportHTML(workflow);
      
      // Create a new window/tab with the report
      const reportWindow = window.open('', '_blank');
      if (reportWindow) {
        reportWindow.document.write(reportContent);
        reportWindow.document.close();
        
        // Optional: Auto-print the report
        setTimeout(() => {
          reportWindow.print();
        }, 1000);
      }
    } catch (error) {
      console.error('Error generating report:', error);
      alert('Failed to generate workflow report.');
    }
  };

  const generateWorkflowReportHTML = (workflow: WorkflowOption): string => {
    const data = workflow.workflow_data;
    const steps = data?.ai_spec?.steps || [];
    const pages = data?.ui?.template?.pages || [];
    
    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Workflow Report - ${workflow.name}</title>
    <style>
        @page { size: A4; margin: 2cm; }
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .header { border-bottom: 3px solid #2563eb; padding-bottom: 20px; margin-bottom: 30px; }
        .title { color: #2563eb; font-size: 28px; font-weight: bold; margin: 0; }
        .subtitle { color: #6b7280; font-size: 16px; margin: 5px 0; }
        .section { margin: 30px 0; page-break-inside: avoid; }
        .section-title { background: #f3f4f6; padding: 10px 15px; font-weight: bold; font-size: 18px; border-left: 4px solid #2563eb; }
        .metadata { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin: 20px 0; }
        .metadata-item { padding: 15px; background: #f9fafb; border-radius: 8px; }
        .metadata-label { font-weight: bold; color: #374151; }
        .step-card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin: 15px 0; }
        .step-header { font-weight: bold; color: #1f2937; font-size: 16px; margin-bottom: 10px; }
        .ai-spec { background: #ecfdf5; border-left: 4px solid #10b981; }
        .ui-page { background: #eff6ff; border-left: 4px solid #3b82f6; }
        .code-block { background: #f1f5f9; padding: 15px; border-radius: 6px; font-family: monospace; font-size: 12px; white-space: pre-wrap; }
        .badge { display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; }
        .badge-success { background: #dcfce7; color: #166534; }
        .badge-info { background: #dbeafe; color: #1e40af; }
        .badge-warning { background: #fef3c7; color: #92400e; }
        table { width: 100%; border-collapse: collapse; margin: 15px 0; }
        th, td { border: 1px solid #d1d5db; padding: 12px; text-align: left; }
        th { background: #f9fafb; font-weight: bold; }
    </style>
</head>
<body>
    <div class="header">
        <h1 class="title">${workflow.name}</h1>
        <p class="subtitle">Workflow Technical Report</p>
        <p class="subtitle">Generated: ${new Date().toLocaleString()}</p>
    </div>

    <div class="section">
        <div class="section-title">📊 Workflow Overview</div>
        <div class="metadata">
            <div class="metadata-item">
                <div class="metadata-label">Test Type</div>
                <div>${workflow.test_type}</div>
            </div>
            <div class="metadata-item">
                <div class="metadata-label">AI Enhanced</div>
                <div>${data?.meta?.ai_enhanced ? '✅ Yes' : '❌ No'}</div>
            </div>
            <div class="metadata-item">
                <div class="metadata-label">Total Images Required</div>
                <div>${data?.meta?.total_images_required || 'Not specified'}</div>
            </div>
            <div class="metadata-item">
                <div class="metadata-label">Estimated Time</div>
                <div>${data?.meta?.estimated_time || 'Not specified'}</div>
            </div>
        </div>
    </div>

    <div class="section">
        <div class="section-title">🔄 Workflow Steps (${pages.length} pages)</div>
        ${pages.map((page: any, index: number) => `
            <div class="step-card ui-page">
                <div class="step-header">
                    ${index + 1}. ${page.title || page.name}
                    ${page.maxTimeToFinish ? `<span class="badge badge-warning">⏱️ ${page.maxTimeToFinish}s timer</span>` : ''}
                </div>
                <div><strong>Elements:</strong> ${page.elements?.length || 0}</div>
                ${page.elements?.map((el: any) => `
                    <div style="margin: 10px 0; padding: 10px; background: #f8fafc; border-radius: 4px;">
                        <strong>${el.type}</strong> - ${el.name || el.title || 'Unnamed'}
                        ${el.type === 'file' ? '<span class="badge badge-info">📷 Image Capture</span>' : ''}
                        ${el.isRequired ? '<span class="badge badge-warning">Required</span>' : ''}
                    </div>
                `).join('') || ''}
            </div>
        `).join('')}
    </div>

    <div class="section">
        <div class="section-title">🤖 AI Analysis Steps (${steps.length} configured)</div>
        ${steps.map((step: any, index: number) => `
            <div class="step-card ai-spec">
                <div class="step-header">
                    AI Step ${index + 1}: ${step.name || step.id}
                    <span class="badge badge-success">${step.type || 'image_analysis'}</span>
                </div>
                
                <table>
                    <tr><th>Property</th><th>Value</th></tr>
                    <tr><td>Trigger</td><td>${step.trigger?.element || 'Not specified'} (${step.trigger?.event || 'file_uploaded'})</td></tr>
                    <tr><td>AI Model</td><td>${step.model || 'gemini-2.0-flash-exp'}</td></tr>
                    <tr><td>Temperature</td><td>${step.temperature || 0.1}</td></tr>
                    <tr><td>Min Confidence</td><td>${step.review_criteria?.min_confidence || 'Not specified'}</td></tr>
                </table>

                ${step.custom_prompt ? `
                    <div style="margin-top: 15px;">
                        <strong>Custom Prompt:</strong>
                        <div class="code-block">${step.custom_prompt}</div>
                    </div>
                ` : ''}

                ${step.expected_output_schema ? `
                    <div style="margin-top: 15px;">
                        <strong>Expected Output Schema:</strong>
                        <div class="code-block">${JSON.stringify(step.expected_output_schema, null, 2)}</div>
                    </div>
                ` : ''}

                ${step.post_processing?.length ? `
                    <div style="margin-top: 15px;">
                        <strong>Post-Processing Rules:</strong>
                        <ul>
                            ${step.post_processing.map((rule: any) => `<li>${rule.type}</li>`).join('')}
                        </ul>
                    </div>
                ` : ''}
            </div>
        `).join('')}
    </div>

    <div class="section">
        <div class="section-title">📋 Technical Summary</div>
        <table>
            <tr><th>Aspect</th><th>Details</th></tr>
            <tr><td>UI Engine</td><td>${data?.ui?.engine || 'Not specified'}</td></tr>
            <tr><td>Workflow Version</td><td>${data?.meta?.version || 'Not specified'}</td></tr>
            <tr><td>Created By</td><td>${data?.meta?.created_by || 'Manual'}</td></tr>
            <tr><td>Modular Design</td><td>${data?.meta?.modular ? '✅ Yes' : '❌ No'}</td></tr>
            <tr><td>Timer Support</td><td>${pages.some((p: any) => p.maxTimeToFinish) ? '✅ Yes' : '❌ No'}</td></tr>
            <tr><td>Multi-Image Analysis</td><td>${steps.some((s: any) => s.image_fields?.length > 1) ? '✅ Yes' : '❌ No'}</td></tr>
        </table>
    </div>

    <div class="section">
        <div class="section-title">🔧 Integration Information</div>
        <p><strong>Database ID:</strong> ${workflow.id}</p>
        <p><strong>Created:</strong> ${new Date(workflow.created_at).toLocaleString()}</p>
        <p><strong>File Path:</strong> Available in workflow_versions table</p>
        <p><strong>Usage:</strong> This workflow can be executed via ModularWorkflowExecutor component</p>
    </div>
</body>
</html>`;
  };

  // Sample workflow with image analysis phases
  const sampleImageWorkflow = {
    ui: {
      engine: "surveyjs",
      template: {
        title: "Enhanced Urine Strip Test with AI Analysis",
        description: "AI-powered test with image capture at critical phases",
        showTimerPanel: "top",
        showTimerPanelMode: "page",
        pages: [
          {
            name: "pre_analytical",
            title: "Pre-Analytical: Sample Quality Check",
            elements: [
              {
                type: "html",
                name: "pre_instructions",
                html: "<div class='alert alert-info'><h4>📷 AI Quality Verification</h4><p>Capture an image of the urine sample. AI will verify:</p><ul><li>Sample volume (minimum 10ml)</li><li>Color and clarity</li><li>Container cleanliness</li><li>Proper labeling</li></ul></div>"
              },
              {
                type: "text",
                name: "sample_id",
                title: "Sample ID",
                isRequired: true
              },
              {
                type: "file",
                name: "sample_quality_image",
                title: "Capture Sample Container Image",
                isRequired: true,
                acceptedTypes: "image/*",
                capture: "camera",
                description: "Hold container at eye level with label visible"
              },
              {
                type: "panel",
                name: "pre_analytical_qc_feedback",
                title: "AI Quality Check Result",
                state: "collapsed",
                elements: [
                  {
                    type: "html",
                    name: "ai_feedback_html",
                    html: "<p class='text-success'>✅ Waiting for AI analysis...</p>"
                  }
                ]
              }
            ]
          },
          {
            name: "test_preparation",
            title: "Test Preparation",
            elements: [
              {
                type: "html",
                html: "<h4>Prepare for Testing</h4><ol><li>Remove test strip from container</li><li>Close container immediately</li><li>Have timer ready</li></ol>"
              },
              {
                type: "checkbox",
                name: "prep_checklist",
                title: "Preparation Checklist",
                isRequired: true,
                choices: [
                  "Test strip removed",
                  "Container closed",
                  "Timer ready",
                  "Camera positioned"
                ]
              }
            ]
          },
          {
            name: "dip_and_wait",
            title: "Dip Strip and Start Timer",
            maxTimeToFinish: 60,
            elements: [
              {
                type: "html",
                html: "<div class='alert alert-warning'><h4>⏱️ 60-Second Timer Active</h4><p>1. Dip strip completely in urine<br/>2. Remove immediately and tap edge<br/>3. Place on flat surface<br/>4. Capture image at T=0</p></div>"
              },
              {
                type: "file",
                name: "strip_t0_image",
                title: "Capture Strip at T=0 (Immediately after dipping)",
                isRequired: true,
                acceptedTypes: "image/*",
                capture: "camera"
              }
            ]
          },
          {
            name: "result_capture",
            title: "Result Analysis Phase",
            elements: [
              {
                type: "html",
                html: "<div class='alert alert-primary'><h4>📸 Multi-Angle Result Capture</h4><p>AI needs multiple images for accurate analysis</p></div>"
              },
              {
                type: "file",
                name: "result_front",
                title: "1. Front View (Direct overhead)",
                isRequired: true,
                acceptedTypes: "image/*",
                capture: "camera",
                description: "Hold camera directly above strip, parallel to surface"
              },
              {
                type: "file",
                name: "result_angle",
                title: "2. Angled View (45 degrees)",
                isRequired: true,
                acceptedTypes: "image/*",
                capture: "camera",
                description: "Capture at 45° angle to reduce glare"
              },
              {
                type: "file",
                name: "result_reference",
                title: "3. With Reference Chart",
                isRequired: true,
                acceptedTypes: "image/*",
                capture: "camera",
                description: "Include color reference chart in frame"
              },
              {
                type: "panel",
                name: "extract_strip_results_feedback",
                title: "AI Extracted Results",
                elements: [
                  {
                    type: "html",
                    name: "ai_results_html",
                    html: "<div class='ai-results'><h5>🤖 Waiting for AI Analysis...</h5></div>"
                  }
                ]
              },
              // Auto-filled result fields that AI will populate
              {
                type: "text",
                name: "glucose",
                title: "Glucose",
                readOnly: true,
                description: "AI-extracted value"
              },
              {
                type: "text",
                name: "protein",
                title: "Protein",
                readOnly: true,
                description: "AI-extracted value"
              },
              {
                type: "text",
                name: "ph",
                title: "pH",
                readOnly: true,
                description: "AI-extracted value"
              },
              {
                type: "text",
                name: "blood",
                title: "Blood",
                readOnly: true,
                description: "AI-extracted value"
              },
              {
                type: "text",
                name: "ketone",
                title: "Ketone",
                readOnly: true,
                description: "AI-extracted value"
              }
            ]
          }
        ]
      }
    },
    ai_spec: {
      version: "2.0",
      steps: [
        {
          id: "pre_analytical_qc",
          step_id: "pre_analytical_qc",
          name: "Sample Quality Check",
          type: "image_analysis",
          trigger: {
            page: "pre_analytical",
            element: "sample_quality_image",
            event: "file_uploaded"
          },
          model: "gemini-2.0-flash-exp",
          temperature: 0.1,
          custom_prompt: "Analyze this urine sample container image for quality control.\n\nCheck the following aspects:\n1. Sample Volume: Estimate volume in ml (minimum required: 10ml)\n2. Sample Color: Classify as (pale yellow|yellow|dark yellow|amber|red|brown|other)\n3. Turbidity: Rate as (clear|slightly cloudy|cloudy|very turbid)\n4. Container Condition: Check for (clean|contaminated|damaged|unlabeled)\n5. Label Quality: Verify (clearly visible|partially visible|not visible)\n\nReturn JSON with these exact fields:\n{\"volume_ml\": number, \"color\": string, \"turbidity\": string, \"container_status\": string, \"label_quality\": string, \"quality_passed\": boolean, \"issues\": [], \"confidence\": 0-1}",
          expected_output_schema: {
            "volume_ml": {"type": "number", "required": true, "range": {"min": 0, "max": 100}},
            "color": {"type": "string", "required": true},
            "turbidity": {"type": "string", "required": true},
            "container_status": {"type": "string", "required": true},
            "label_quality": {"type": "string", "required": true},
            "quality_passed": {"type": "boolean", "required": true},
            "issues": {"type": "array", "required": false, "default": []},
            "confidence": {"type": "number", "required": true, "range": {"min": 0, "max": 1}}
          },
          show_feedback: true,
          review_criteria: {
            "min_confidence": 0.8,
            "flags_requiring_review": ["quality_issue", "low_volume"]
          },
          image_processing: {
            "strip_data_url": true,
            "mime_type": "image/jpeg"
          }
        },
        {
          id: "extract_strip_results",
          step_id: "extract_strip_results",
          name: "Extract Test Strip Results",
          type: "image_analysis",
          trigger: {
            page: "result_capture",
            element: "result_reference",
            event: "file_uploaded"
          },
          image_fields: ["result_front", "result_angle", "result_reference"],
          model: "gemini-2.0-flash-exp",
          temperature: 0.1,
          custom_prompt: "Analyze these urine test strip images to extract results for all parameters.\n\nTest strip type: {{test_type}}\nTime since dipping: {{time_elapsed}} seconds\n\nFor each pad on the strip, compare the color to the reference chart and determine:\n\n1. Glucose: (Negative|Trace|1+|2+|3+|4+)\n2. Protein: (Negative|Trace|1+|2+|3+|4+)\n3. pH: Numeric value (5.0-9.0)\n4. Blood: (Negative|Trace|Small|Moderate|Large)\n5. Ketone: (Negative|Trace|Small|Moderate|Large)\n\nConsider:\n- Color intensity and uniformity\n- Edge bleeding between pads\n- Timing accuracy (optimal read time: 60s)\n- Lighting conditions in image\n\nReturn JSON: {\"results\": {\"glucose\": \"value\", \"protein\": \"value\", \"ph\": \"value\", \"blood\": \"value\", \"ketone\": \"value\"}, \"confidence\": 0-1, \"issues\": []}",
          expected_output_schema: {
            "results": {"type": "object", "required": true},
            "confidence": {"type": "number", "required": true, "range": {"min": 0, "max": 1}},
            "issues": {"type": "array", "required": false, "default": []}
          },
          update_fields: {
            "auto_fill": true
          },
          show_feedback: true,
          consensus_method: {
            "type": "weighted",
            "config": {
              "weights": {
                "front_view": 0.5,
                "angle_view": 0.3,
                "reference_view": 0.2
              },
              "min_agreement": 0.75
            }
          },
          review_criteria: {
            "min_confidence": 0.85,
            "abnormal_values": true,
            "flags_requiring_review": ["multiple_abnormal", "critical_value", "low_confidence"]
          },
          image_processing: {
            "strip_data_url": true,
            "mime_type": "image/jpeg"
          }
        }
      ]
    },
    meta: {
      test_code: "URINE_STRIP_AI",
      version: "2.0",
      ai_enhanced: true,
      total_images_required: 4,
      estimated_time: "5 minutes",
      modular: true,
      created_by: "demo"
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="bg-white rounded-lg shadow-md p-6 mb-6">
        <h1 className="text-2xl font-bold mb-4">Modular AI Workflow System</h1>
        
        {/* View Mode Toggle */}
        <div className="mb-6 flex space-x-4">
          <button
            onClick={() => setViewMode('explainer')}
            className={`px-4 py-2 rounded-md transition-colors ${
              viewMode === 'explainer'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            🔍 Workflow Explainer
          </button>
          <button
            onClick={() => setViewMode('executor')}
            className={`px-4 py-2 rounded-md transition-colors ${
              viewMode === 'executor'
                ? 'bg-green-600 text-white'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            ▶️ Workflow Executor
          </button>
        </div>

        {/* Workflow Selector */}
        <div className="mb-6 p-4 bg-blue-50 rounded-lg">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Select a Workflow:
          </label>
          <div className="flex gap-4">
            <select
              className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={selectedWorkflow?.id || ''}
              onChange={(e) => {
                const workflow = availableWorkflows.find(w => w.id === e.target.value) || 
                                (e.target.value === 'demo-image' ? {
                                  id: 'demo-image',
                                  name: 'AI Image Analysis Demo',
                                  test_type: 'URINE_STRIP_AI',
                                  created_at: new Date().toISOString(),
                                  workflow_data: sampleImageWorkflow
                                } : null);
                setSelectedWorkflow(workflow);
                setModifiedWorkflow(null);
                setExecutionResults(null);
              }}
            >
              <option value="">-- Select a workflow --</option>
              <optgroup label="Database Workflows">
                {availableWorkflows.map(w => (
                  <option key={w.id} value={w.id}>
                    {w.name} ({w.test_type}) - {new Date(w.created_at).toLocaleDateString()}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Demo Workflows">
                <option value="demo-image">🤖 AI Image Analysis Demo (Urine Strip)</option>
              </optgroup>
            </select>
            
            <div className="flex gap-2">
              {modifiedWorkflow && (
                <button
                  onClick={saveModifiedWorkflow}
                  className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors"
                >
                  💾 Save Changes
                </button>
              )}
              
              {selectedWorkflow && selectedWorkflow.id !== 'demo-image' && (
                <button
                  onClick={() => generateWorkflowReport(selectedWorkflow)}
                  className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 transition-colors"
                >
                  📄 Generate Report
                </button>
              )}
              
              {selectedWorkflow && selectedWorkflow.id !== 'demo-image' && (
                <button
                  onClick={() => deleteWorkflow(selectedWorkflow)}
                  className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors"
                  title="Delete Workflow"
                >
                  🗑️ Delete
                </button>
              )}
            </div>
          </div>
          
          {selectedWorkflow && (
            <div className="mt-2 text-sm text-gray-600">
              <span className="font-medium">Test Type:</span> {selectedWorkflow.test_type} | 
              <span className="font-medium ml-2">AI Enhanced:</span> {selectedWorkflow.workflow_data?.meta?.ai_enhanced ? '✅' : '❌'} |
              <span className="font-medium ml-2">Images Required:</span> {selectedWorkflow.workflow_data?.meta?.total_images_required || 0}
            </div>
          )}
        </div>

        {/* Feature Highlights */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="p-4 bg-green-50 rounded-lg">
            <h3 className="font-semibold text-green-800 mb-2">📷 Pre-Analytical Phase</h3>
            <p className="text-sm text-green-700">AI verifies sample quality before testing begins</p>
          </div>
          <div className="p-4 bg-yellow-50 rounded-lg">
            <h3 className="font-semibold text-yellow-800 mb-2">⏱️ Timed Process Phase</h3>
            <p className="text-sm text-yellow-700">Automatic timers ensure accurate reading intervals</p>
          </div>
          <div className="p-4 bg-purple-50 rounded-lg">
            <h3 className="font-semibold text-purple-800 mb-2">🤖 AI Result Extraction</h3>
            <p className="text-sm text-purple-700">Multiple images analyzed for consensus results</p>
          </div>
        </div>

        {/* Content based on view mode */}
        {selectedWorkflow?.workflow_data && (
          <>
            {viewMode === 'explainer' && (
              <WorkflowExplainer
                technicianWorkflow={selectedWorkflow.workflow_data}
                aiSpec={selectedWorkflow.workflow_data?.ai_spec}
                onWorkflowModified={handleWorkflowModified}
              />
            )}
            
            {viewMode === 'executor' && (
              <div>
                <div className="mb-4 p-4 bg-amber-50 border-l-4 border-amber-500">
                  <h3 className="font-semibold text-amber-800">Demo Mode</h3>
                  <p className="text-amber-700">This is a demo execution. Images will be analyzed but results won't be saved to real orders.</p>
                </div>
                
                <ModularWorkflowExecutor
                  workflow={selectedWorkflow.workflow_data}
                  orderId="demo-order-123"
                  onComplete={handleExecutionComplete}
                  onStepComplete={handleStepComplete}
                />
                
                {executionResults && (
                  <div className="mt-6 p-4 bg-green-50 rounded-lg">
                    <h3 className="font-semibold text-green-800 mb-2">Execution Complete!</h3>
                    <pre className="text-sm text-green-700 overflow-auto max-h-64">
                      {JSON.stringify(executionResults, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </>
        )}
        
        {!selectedWorkflow && (
          <div className="text-center py-12 text-gray-500">
            <p>Select a workflow from the dropdown above to explore its capabilities</p>
          </div>
        )}
      </div>

      {/* Instructions */}
      <div className="bg-gray-50 rounded-lg p-6">
        <h2 className="text-lg font-semibold mb-4">Modular AI System Features:</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h3 className="font-medium mb-2">🔍 Workflow Explainer</h3>
            <ol className="space-y-1 text-sm text-gray-700">
              <li>• View workflow structure and AI specifications</li>
              <li>• Analyze step-by-step AI processing logic</li>
              <li>• Modify AI prompts and parameters</li>
              <li>• Chat with AI to understand workflow behavior</li>
            </ol>
          </div>
          <div>
            <h3 className="font-medium mb-2">▶️ Workflow Executor</h3>
            <ol className="space-y-1 text-sm text-gray-700">
              <li>• Execute workflows with real image capture</li>
              <li>• AI analysis triggered by file uploads</li>
              <li>• Real-time confidence scoring</li>
              <li>• Manual review alerts for low confidence</li>
            </ol>
          </div>
        </div>
        
        <div className="mt-4 p-3 bg-blue-100 rounded">
          <p className="text-sm text-blue-800">
            <strong>Modular Design:</strong> All AI logic (prompts, validation, post-processing) is defined in the workflow's ai_spec JSON. 
            No code changes needed to create new test types - just configure the AI specification!
          </p>
        </div>
      </div>
    </div>
  );
};

export default WorkflowExplainerDemo;