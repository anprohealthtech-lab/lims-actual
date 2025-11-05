import React, { useState, useEffect, useRef } from 'react';
import { SurveyCreatorComponent, SurveyCreator } from 'survey-creator-react';
import { database, workflows } from '../../utils/supabase';
import { useAuth } from '../../contexts/AuthContext';
import 'survey-core/defaultV2.min.css';
import 'survey-creator-core/survey-creator-core.min.css';

interface SurveyJSFormBuilderProps {
  workflow?: any;
  onSave: (workflow: any) => void;
}

const SurveyJSFormBuilder: React.FC<SurveyJSFormBuilderProps> = ({ workflow, onSave }) => {
  const { user } = useAuth();
  const [creator, setCreator] = useState<SurveyCreator | null>(null);
  const [loading, setLoading] = useState(false);
  const [showTips, setShowTips] = useState(true);
  const [workflowName, setWorkflowName] = useState(workflow?.name || '');
  const [workflowDescription, setWorkflowDescription] = useState(workflow?.description || '');
  const creatorRef = useRef<HTMLDivElement>(null);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey) {
        switch (event.key) {
          case 's':
            event.preventDefault();
            // Trigger save via button click to use the same logic
            const saveButton = document.querySelector('[data-save-button]') as HTMLButtonElement;
            if (saveButton) {
              saveButton.click();
            }
            break;
          case 'p':
            event.preventDefault();
            if (creator) {
              creator.showPreview();
            }
            break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [creator]);

  useEffect(() => {
    // Initialize SurveyJS Creator
    const creatorOptions = {
      showLogicTab: true,
      showTranslationTab: false,
      showThemeTab: true,
      showJSONEditorTab: true,
      showTestSurveyTab: true,
      showEmbeddedSurveyTab: false,
      allowModifyPages: true,
      showPropertyGrid: true,
      questionTypes: [
        'text', 'textarea', 'radiogroup', 'checkbox', 'dropdown',
        'rating', 'boolean', 'file', 'html', 'panel', 'paneldynamic',
        'matrix', 'matrixdropdown', 'matrixdynamic', 'multipletext',
        'image', 'signaturepad', 'comment', 'expression'
      ]
    };

    const surveyCreator = new SurveyCreator(creatorOptions);
    
    // Load existing workflow definition if editing
    if (workflow?.definition?.ui?.template) {
      surveyCreator.JSON = workflow.definition.ui.template;
    } else {
      // Default template for new workflows
      surveyCreator.JSON = {
        title: "New Workflow",
        description: "Built with Visual Form Builder",
        pages: [
          {
            name: "page1",
            title: "Step 1",
            elements: [
              {
                type: "html",
                name: "welcome",
                html: "<h3>Welcome to the workflow</h3><p>Start by adding your form elements using the toolbox on the left.</p>"
              }
            ]
          }
        ]
      };
    }

    // Customize the creator
    surveyCreator.onQuestionAdded.add((sender, options) => {
      // Auto-configure file upload questions for workflow image capture
      if (options.question.getType() === 'file') {
        options.question.acceptedTypes = 'image/*';
        options.question.allowMultiple = false;
        options.question.maxSize = 10485760; // 10MB
        options.question.capture = 'camera';
      }
    });

    // Add custom property for workflow steps
    surveyCreator.onPropertyGridSurveyCreated.add((sender, options) => {
      if (options.obj.getType() === 'page') {
        // Add workflow-specific properties to pages
        options.survey.addNewPage({
          name: "workflowProperties",
          title: "Workflow Properties",
          elements: [
            {
              type: "text",
              name: "workflowStepId",
              title: "Workflow Step ID",
              description: "Unique identifier for this workflow step"
            },
            {
              type: "dropdown",
              name: "workflowStepType",
              title: "Step Type",
              choices: [
                { value: "pre_analytical", text: "Pre-Analytical" },
                { value: "sample_collection", text: "Sample Collection" },
                { value: "processing", text: "Processing" },
                { value: "measurement", text: "Measurement" },
                { value: "result_entry", text: "Result Entry" },
                { value: "quality_control", text: "Quality Control" },
                { value: "verification", text: "Verification" },
                { value: "post_analytical", text: "Post-Analytical" }
              ]
            },
            {
              type: "checkbox",
              name: "requiresImageCapture",
              title: "Requires Image Capture",
              description: "This step requires photo documentation"
            },
            {
              type: "text",
              name: "maxTimeToFinish",
              title: "Timer (seconds)",
              description: "Auto-advance after specified time (optional)",
              inputType: "number"
            }
          ]
        });
      }
    });

    setCreator(surveyCreator);

    return () => {
      if (surveyCreator) {
        surveyCreator.dispose();
      }
    };
  }, [workflow]);

  const handleSave = async () => {
    if (!creator) {
      alert('Workflow builder is not ready. Please wait and try again.');
      return;
    }

    if (!workflowName.trim()) {
      alert('Please provide a workflow name before saving.');
      return;
    }

    // Check if there's actual content in the survey
    try {
      const surveyJSON = creator.JSON;
      if (!surveyJSON.pages || surveyJSON.pages.length === 0) {
        alert('Please add at least one page to your workflow before saving.');
        return;
      }

      // Check if there are actual questions (not just the default HTML welcome)
      const hasQuestions = surveyJSON.pages.some((page: any) => 
        page.elements && page.elements.some((element: any) => 
          element.type !== 'html' || !element.html?.includes('Welcome to the workflow')
        )
      );

      if (!hasQuestions) {
        alert('Please add some questions to your workflow before saving.');
        return;
      }
    } catch (err) {
      alert('Invalid survey structure. Please check your workflow design.');
      return;
    }

    setLoading(true);
    try {
      const surveyJSON = creator.JSON;
      
      // Get current user's lab ID
      const currentLabId = await database.getCurrentUserLabId();
      if (!currentLabId) {
        throw new Error('Unable to determine lab context. Please make sure you are logged in.');
      }
      
      // Build the complete workflow definition
      const workflowDefinition = {
        ui: {
          engine: 'surveyjs',
          template: {
            ...surveyJSON,
            title: workflowName,
            description: workflowDescription
          }
        },
        ai_spec: generateAISpecFromSurvey(surveyJSON),
        meta: {
          created_with: 'visual-form-builder',
          version: '1.0.0',
          created_at: new Date().toISOString(),
          has_image_capture: hasImageCapture(surveyJSON),
          step_count: surveyJSON.pages?.length || 0
        }
      };

      let result;
      if (workflow?.id) {
        // Update existing workflow version
        result = await database.workflowVersions.update(workflow.id, {
          description: workflowDescription,
          definition: workflowDefinition
        });
        
        // Update the parent workflow name if provided
        if (workflow.workflows?.id && workflowName !== workflow.workflows.name) {
          await workflows.update(workflow.workflows.id, {
            name: workflowName,
            description: workflowDescription
          });
        }
      } else {
        // Create new workflow
        // First create the workflow
        const { data: newWorkflow, error: workflowError } = await workflows.create({
          name: workflowName,
          description: workflowDescription,
          category: 'custom',
          type: 'visual-builder',
          lab_id: currentLabId
        });

        if (workflowError) throw workflowError;

        // Then create the version
        result = await database.workflowVersions.create({
          workflow_id: newWorkflow.id,
          version: '1.0.0',
          definition: workflowDefinition,
          description: workflowDescription,
          active: true
        });
      }

      if (result.error) throw result.error;

      alert('Workflow saved successfully!');
      onSave(result.data);
    } catch (error) {
      console.error('Error saving workflow:', error);
      alert('Failed to save workflow: ' + (error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const generateAISpecFromSurvey = (surveyJSON: any) => {
    const aiSteps: any[] = [];
    
    if (surveyJSON.pages) {
      surveyJSON.pages.forEach((page: any) => {
        page.elements?.forEach((element: any) => {
          if (element.type === 'file' && element.acceptedTypes === 'image/*') {
            // Generate AI spec for image elements
            aiSteps.push({
              id: `${page.name}_${element.name}`,
              step_id: `${page.name}_${element.name}`,
              name: `AI Analysis: ${element.title || element.name}`,
              type: 'image_analysis',
              trigger: {
                page: page.name,
                element: element.name,
                event: 'file_uploaded'
              },
              custom_prompt: generatePromptForElement(element, page),
              expected_output_schema: {
                analysis_result: { type: 'string', required: true },
                confidence: { type: 'number', required: true },
                extracted_values: { type: 'object', required: false }
              },
              review_criteria: {
                min_confidence: 0.8,
                flags_requiring_review: ['low_quality', 'unclear_result']
              }
            });
          }
        });
      });
    }

    return {
      version: '2.0',
      steps: aiSteps,
      meta: {
        generated_from: 'visual-form-builder',
        total_steps: aiSteps.length
      }
    };
  };

  const generatePromptForElement = (element: any, page: any) => {
    const stepType = page.workflowStepType || 'general';
    const elementTitle = element.title || element.name;
    
    const basePrompt = `Analyze this image captured during the "${elementTitle}" step of a laboratory workflow.`;
    
    const stepPrompts = {
      pre_analytical: `${basePrompt} Focus on sample quality, labeling, and preparation standards.`,
      sample_collection: `${basePrompt} Verify proper collection technique and sample integrity.`,
      processing: `${basePrompt} Document processing steps and any visible changes.`,
      measurement: `${basePrompt} Extract measurement values and readings from instruments or test results.`,
      result_entry: `${basePrompt} Extract final test results and values for data entry.`,
      quality_control: `${basePrompt} Assess quality control measures and compliance.`,
      verification: `${basePrompt} Verify results accuracy and completeness.`,
      post_analytical: `${basePrompt} Document final outcomes and any post-test observations.`
    };

    return stepPrompts[stepType as keyof typeof stepPrompts] || basePrompt + ' Provide a detailed analysis of what is shown in the image.';
  };

  const hasImageCapture = (surveyJSON: any): boolean => {
    if (!surveyJSON.pages) return false;
    
    return surveyJSON.pages.some((page: any) =>
      page.elements?.some((element: any) => 
        element.type === 'file' && element.acceptedTypes === 'image/*'
      )
    );
  };

  if (!creator) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header Controls */}
      <div className="flex items-center justify-between p-4 border-b bg-gray-50">
        <div className="flex items-center space-x-4">
          <div>
            <input
              type="text"
              value={workflowName}
              onChange={(e) => setWorkflowName(e.target.value)}
              placeholder="Workflow Name"
              className="text-lg font-medium border-0 bg-transparent focus:outline-none focus:ring-2 focus:ring-blue-500 rounded px-2 py-1"
            />
          </div>
          <div>
            <input
              type="text"
              value={workflowDescription}
              onChange={(e) => setWorkflowDescription(e.target.value)}
              placeholder="Workflow Description"
              className="text-sm text-gray-600 border-0 bg-transparent focus:outline-none focus:ring-2 focus:ring-blue-500 rounded px-2 py-1"
            />
          </div>
        </div>
        
        <div className="flex items-center space-x-3">
          <button
            onClick={() => creator.showPreview()}
            className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700"
          >
            Preview
          </button>
          <button
            data-save-button
            onClick={handleSave}
            disabled={loading || !workflowName.trim() || !creator}
            className={`px-4 py-2 rounded-md flex items-center gap-2 font-medium transition-all duration-200 ${
              loading || !workflowName.trim() || !creator
                ? 'bg-gray-400 cursor-not-allowed text-gray-200'
                : 'bg-blue-600 text-white hover:bg-blue-700 hover:shadow-lg'
            }`}
          >
            {loading ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                Saving...
              </>
            ) : (
              <>
                💾 Save Workflow
              </>
            )}
          </button>
        </div>
      </div>

      {/* SurveyJS Creator */}
      <div className="flex-1 overflow-hidden">
        <SurveyCreatorComponent creator={creator} />
      </div>

      {/* Usage Tips - Collapsible */}
      <div className="border-t bg-gradient-to-r from-blue-50 to-indigo-50">
        <button
          onClick={() => setShowTips(!showTips)}
          className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-blue-100 transition-colors"
        >
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
            <h4 className="font-medium text-blue-900">Workflow Builder Tips & Quick Actions</h4>
          </div>
          <div className={`transform transition-transform ${showTips ? 'rotate-180' : ''}`}>
            ▼
          </div>
        </button>
        
        {showTips && (
          <div className="px-4 pb-4">
            <div className="grid md:grid-cols-2 gap-4">
              {/* Tips Column */}
              <div>
                <h5 className="font-medium text-blue-900 mb-2 flex items-center gap-1">
                  💡 Building Tips
                </h5>
                <ul className="text-sm text-blue-800 space-y-1">
                  <li>• Use <strong>File Upload</strong> questions for image capture (auto-configured for camera)</li>
                  <li>• Add <strong>Timer</strong> to pages using 'maxTimeToFinish' property</li>
                  <li>• Use <strong>HTML</strong> elements for instructions and guidance</li>
                  <li>• Test workflows using Preview button before saving</li>
                  <li>• Image uploads automatically generate AI analysis specs</li>
                </ul>
              </div>
              
              {/* Quick Actions Column */}
              <div>
                <h5 className="font-medium text-blue-900 mb-2 flex items-center gap-1">
                  ⚡ Quick Actions
                </h5>
                <div className="space-y-2">
                  <button
                    onClick={() => creator?.addPage()}
                    className="w-full text-left px-3 py-2 bg-white border border-blue-200 rounded text-sm text-blue-700 hover:bg-blue-50 transition-colors"
                  >
                    + Add New Page
                  </button>
                  <button
                    onClick={() => {
                      if (creator?.survey) {
                        // Add a new file question for image capture
                        const currentPage = creator.survey.currentPage || creator.survey.pages[0];
                        if (currentPage) {
                          const newQuestion = currentPage.addNewQuestion('file', `image_${Date.now()}`);
                          newQuestion.title = 'Capture Image';
                          newQuestion.acceptedTypes = 'image/*';
                          newQuestion.allowMultiple = false;
                          newQuestion.maxSize = 10485760; // 10MB
                        }
                      }
                    }}
                    className="w-full text-left px-3 py-2 bg-white border border-blue-200 rounded text-sm text-blue-700 hover:bg-blue-50 transition-colors"
                  >
                    📷 Add Image Capture
                  </button>
                  <button
                    onClick={() => creator?.showPreview()}
                    className="w-full text-left px-3 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 transition-colors"
                  >
                    👁️ Preview Workflow
                  </button>
                </div>
              </div>
            </div>
            
            {/* Status Bar */}
            <div className="mt-3 pt-3 border-t border-blue-200 flex items-center justify-between text-xs text-blue-600">
              <span>🎯 Pro tip: Use keyboard shortcuts - Ctrl+S to save, Ctrl+P to preview</span>
              <span>📊 Questions: {creator?.survey?.getAllQuestions?.()?.length || 0}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SurveyJSFormBuilder;