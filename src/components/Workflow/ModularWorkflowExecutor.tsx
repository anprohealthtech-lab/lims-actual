import React, { useState, useEffect, useCallback } from 'react';
import { Survey } from 'survey-react-ui';
import { Model } from 'survey-core';
import 'survey-core/defaultV2.min.css';

interface ModularWorkflowExecutorProps {
  workflow: any;
  orderId: string;
  onComplete: (results: any) => void;
  onStepComplete?: (stepId: string, results: any) => void;
}

/**
 * Executes workflows with modular AI analysis
 * All AI logic comes from the workflow's ai_spec
 */
const ModularWorkflowExecutor: React.FC<ModularWorkflowExecutorProps> = ({
  workflow,
  orderId,
  onComplete,
  onStepComplete
}) => {
  const [surveyModel, setSurveyModel] = useState<Model | null>(null);
  const [aiProcessing, setAiProcessing] = useState<{ [key: string]: boolean }>({});
  const [aiResults, setAiResults] = useState<{ [key: string]: any }>({});
  const [currentContext, setCurrentContext] = useState<any>({});

  useEffect(() => {
    if (workflow?.ui?.template) {
      const model = new Model(workflow.ui.template);
      
      // Set up event handlers for AI triggers
      setupAITriggers(model);
      
      setSurveyModel(model);
    }
  }, [workflow]);

  /**
   * Set up AI analysis triggers based on workflow spec
   */
  const setupAITriggers = (model: Model) => {
    if (!workflow?.ai_spec?.steps) return;

    workflow.ai_spec.steps.forEach((aiStep: any) => {
      if (aiStep.trigger) {
        const { page, element, event } = aiStep.trigger;
        
        // Listen for file upload events
        if (event === 'file_uploaded') {
          model.onUploadFiles.add((sender, options) => {
            if (options.name === element) {
              handleAIAnalysis(aiStep, options.files);
            }
          });
        }
        
        // Listen for page completion
        if (event === 'page_complete') {
          model.onCurrentPageChanged.add((sender, options) => {
            if (options.oldCurrentPage?.name === page) {
              const pageData = model.getPageByName(page)?.getValue();
              handleAIAnalysis(aiStep, pageData);
            }
          });
        }
      }
    });
  };

  /**
   * Handle AI analysis using the modular spec
   */
  const handleAIAnalysis = async (aiStep: any, data: any) => {
    setAiProcessing(prev => ({ ...prev, [aiStep.id]: true }));

    try {
      // Prepare images if file upload
      let images: string[] = [];
      if (data && Array.isArray(data)) {
        images = await Promise.all(
          data.map(file => convertFileToBase64(file))
        );
      } else if (typeof data === 'object' && aiStep.trigger.element) {
        // Extract specific image fields
        const imageFields = aiStep.image_fields || [aiStep.trigger.element];
        for (const field of imageFields) {
          if (data[field]) {
            const base64 = await convertFileToBase64(data[field]);
            images.push(base64);
          }
        }
      }

      // Call the modular image analyzer
      const response = await fetch('/api/edge-functions/image-analyzer-v2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          images,
          workflow_ai_spec: workflow.ai_spec,
          step_id: aiStep.id,
          order_id: orderId,
          lab_id: getCurrentLabId(),
          context: {
            ...currentContext,
            test_type: workflow.meta?.test_code,
            time_elapsed: calculateTimeElapsed(aiStep),
            ...extractDynamicContext(surveyModel, aiStep)
          }
        })
      });

      const result = await response.json();

      if (result.success) {
        // Store AI results
        setAiResults(prev => ({ ...prev, [aiStep.id]: result.analysis }));
        
        // Update survey with AI results if configured
        if (aiStep.update_fields) {
          updateSurveyWithAIResults(surveyModel, result.analysis, aiStep.update_fields);
        }
        
        // Show AI feedback in UI if configured
        if (aiStep.show_feedback) {
          showAIFeedback(surveyModel, aiStep, result.analysis);
        }
        
        // Trigger callback
        onStepComplete?.(aiStep.id, result.analysis);
        
        // Check if manual review needed
        if (result.manual_review_required) {
          showManualReviewAlert(surveyModel, aiStep, result.analysis);
        }
      } else {
        console.error('AI analysis failed:', result.error);
        showErrorMessage(surveyModel, aiStep, result.error);
      }
    } catch (error) {
      console.error('Error during AI analysis:', error);
      showErrorMessage(surveyModel, aiStep, error.message);
    } finally {
      setAiProcessing(prev => ({ ...prev, [aiStep.id]: false }));
    }
  };

  /**
   * Update survey fields with AI-extracted results
   */
  const updateSurveyWithAIResults = (model: Model, analysis: any, updateConfig: any) => {
    if (!model || !analysis) return;

    // Map AI results to survey fields
    if (updateConfig.mapping) {
      Object.entries(updateConfig.mapping).forEach(([aiField, surveyField]) => {
        const value = getNestedValue(analysis, aiField);
        if (value !== undefined) {
          model.setValue(surveyField as string, value);
        }
      });
    }

    // Auto-fill all matching field names
    if (updateConfig.auto_fill && analysis.results) {
      Object.entries(analysis.results).forEach(([key, value]) => {
        if (model.getQuestionByName(key)) {
          model.setValue(key, value);
        }
      });
    }
  };

  /**
   * Show AI analysis feedback in the UI
   */
  const showAIFeedback = (model: Model, aiStep: any, analysis: any) => {
    if (!model) return;

    const feedbackPanelName = `${aiStep.id}_feedback`;
    const feedbackPanel = model.getQuestionByName(feedbackPanelName);
    
    if (feedbackPanel && feedbackPanel.getType() === 'panel') {
      // Generate feedback HTML
      const feedbackHtml = generateAIFeedbackHtml(aiStep, analysis);
      
      // Update panel with feedback
      const htmlQuestion = feedbackPanel.elements?.find(
        (el: any) => el.getType() === 'html'
      );
      
      if (htmlQuestion) {
        htmlQuestion.html = feedbackHtml;
        feedbackPanel.expand();
      }
    }
  };

  /**
   * Generate HTML for AI feedback display
   */
  const generateAIFeedbackHtml = (aiStep: any, analysis: any): string => {
    const confidence = analysis.confidence || analysis.overall_confidence || 0;
    const confidenceColor = confidence > 0.85 ? 'green' : confidence > 0.7 ? 'orange' : 'red';
    
    let html = `<div class="ai-feedback">`;
    html += `<h4>🤖 AI Analysis Complete</h4>`;
    html += `<div class="confidence">Confidence: <span style="color: ${confidenceColor}">${(confidence * 100).toFixed(1)}%</span></div>`;
    
    if (analysis.results) {
      html += `<table class="results-table">`;
      html += `<thead><tr><th>Parameter</th><th>Value</th><th>Status</th></tr></thead>`;
      html += `<tbody>`;
      
      Object.entries(analysis.results).forEach(([param, value]) => {
        const status = analysis.reference_flags?.[param] || 'normal';
        const statusIcon = status === 'normal' ? '✅' : status === 'high' ? '⬆️' : '⬇️';
        html += `<tr>`;
        html += `<td>${param}</td>`;
        html += `<td>${value}</td>`;
        html += `<td>${statusIcon}</td>`;
        html += `</tr>`;
      });
      
      html += `</tbody></table>`;
    }
    
    if (analysis.issues?.length > 0) {
      html += `<div class="issues">`;
      html += `<strong>Issues detected:</strong>`;
      html += `<ul>`;
      analysis.issues.forEach((issue: string) => {
        html += `<li>${issue}</li>`;
      });
      html += `</ul>`;
      html += `</div>`;
    }
    
    html += `</div>`;
    return html;
  };

  /**
   * Show manual review alert
   */
  const showManualReviewAlert = (model: Model, aiStep: any, analysis: any) => {
    if (!model) return;
    
    const message = `⚠️ Manual review required for ${aiStep.name}. ` +
                   `Confidence: ${(analysis.confidence * 100).toFixed(1)}%. ` +
                   `Please verify the AI-extracted values.`;
    
    // You can implement a custom modal or use SurveyJS notifications
    alert(message);
  };

  /**
   * Show error message
   */
  const showErrorMessage = (model: Model, aiStep: any, error: string) => {
    if (!model) return;
    
    const message = `❌ AI analysis failed for ${aiStep.name}: ${error}`;
    console.error(message);
    alert(message);
  };

  /**
   * Helper functions
   */
  const convertFileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const getCurrentLabId = (): string => {
    // Get from context or auth
    return localStorage.getItem('current_lab_id') || '';
  };

  const calculateTimeElapsed = (aiStep: any): number => {
    // Calculate based on step timing configuration
    return 60; // Default 60 seconds
  };

  const extractDynamicContext = (model: Model | null, aiStep: any): any => {
    if (!model || !aiStep.context_fields) return {};
    
    const context: any = {};
    aiStep.context_fields.forEach((field: string) => {
      context[field] = model.getValue(field);
    });
    return context;
  };

  const getNestedValue = (obj: any, path: string): any => {
    return path.split('.').reduce((acc, part) => acc?.[part], obj);
  };

  const handleSurveyComplete = (sender: any) => {
    const results = sender.data;
    
    // Merge with AI results
    const completeResults = {
      survey_responses: results,
      ai_analyses: aiResults,
      workflow_meta: {
        workflow_id: workflow.id,
        order_id: orderId,
        completion_time: new Date().toISOString()
      }
    };
    
    onComplete(completeResults);
  };

  if (!surveyModel) {
    return <div>Loading workflow...</div>;
  }

  return (
    <div className="modular-workflow-executor">
      {/* AI Processing Indicator */}
      {Object.values(aiProcessing).some(v => v) && (
        <div className="ai-processing-banner bg-blue-100 border-l-4 border-blue-500 p-4 mb-4">
          <div className="flex items-center">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-900 mr-3"></div>
            <p className="text-blue-900">AI is analyzing your images...</p>
          </div>
        </div>
      )}
      
      {/* Survey Component */}
      <Survey 
        model={surveyModel}
        onComplete={handleSurveyComplete}
      />
      
      {/* AI Results Summary */}
      {Object.keys(aiResults).length > 0 && (
        <div className="ai-results-summary mt-4 p-4 bg-gray-50 rounded-lg">
          <h3 className="font-semibold mb-2">AI Analysis Summary</h3>
          <div className="grid grid-cols-2 gap-4">
            {Object.entries(aiResults).map(([stepId, result]: [string, any]) => (
              <div key={stepId} className="bg-white p-3 rounded shadow-sm">
                <h4 className="text-sm font-medium">{stepId}</h4>
                <p className="text-xs text-gray-600">
                  Confidence: {((result.confidence || 0) * 100).toFixed(1)}%
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default ModularWorkflowExecutor;