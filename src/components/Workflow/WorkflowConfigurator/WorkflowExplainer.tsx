import React, { useState, useEffect } from 'react';
import { MessageCircle, Bot, User, ChevronDown, ChevronRight, Play, CheckCircle } from 'lucide-react';

interface WorkflowStep {
  step_type: string;
  description: string;
  parameters?: any;
}

interface WorkflowExplainerProps {
  technicianWorkflow: any; // SurveyJS JSON
  aiSpec: any; // AI processing spec
  onStepClick?: (stepIndex: number, stepData: any) => void;
  onWorkflowModified?: (modifiedWorkflow: any, modifiedAiSpec: any, changes: string) => void;
}

const WorkflowExplainer: React.FC<WorkflowExplainerProps> = ({
  technicianWorkflow,
  aiSpec,
  onStepClick,
  onWorkflowModified
}) => {
  const [activeTab, setActiveTab] = useState<'steps' | 'ai' | 'chat'>('steps');
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set());
  const [chatMessages, setChatMessages] = useState<Array<{
    type: 'user' | 'ai';
    content: string;
    timestamp: Date;
  }>>([]);
  const [chatInput, setChatInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  // Helper function to get workflow pages from different formats
  const getWorkflowPages = (workflow: any) => {
    if (workflow?.ui?.template?.pages) {
      return workflow.ui.template.pages; // New format
    }
    if (workflow?.pages) {
      return workflow.pages; // Direct format
    }
    return [];
  };

  // Helper function to get workflow title
  const getWorkflowTitle = (workflow: any) => {
    if (workflow?.ui?.template?.title) {
      return workflow.ui.template.title; // New format
    }
    if (workflow?.title) {
      return workflow.title; // Direct format
    }
    return 'workflow';
  };

  const workflowPages = getWorkflowPages(technicianWorkflow);
  const workflowTitle = getWorkflowTitle(technicianWorkflow);

  // Initialize with welcome message
  useEffect(() => {
    setChatMessages([{
      type: 'ai',
      content: `Hi! I'm your workflow assistant. I can explain the ${workflowTitle} steps and AI processing logic. Ask me anything about this workflow!`,
      timestamp: new Date()
    }]);
  }, [workflowTitle]);

  const toggleStepExpansion = (stepIndex: number) => {
    const newExpanded = new Set(expandedSteps);
    if (newExpanded.has(stepIndex)) {
      newExpanded.delete(stepIndex);
    } else {
      newExpanded.add(stepIndex);
    }
    setExpandedSteps(newExpanded);
  };

  const handleChatSubmit = async () => {
    if (!chatInput.trim() || isProcessing) return;

    const userMessage = chatInput.trim();
    setChatInput('');
    setIsProcessing(true);

    // Add user message
    setChatMessages(prev => [...prev, {
      type: 'user',
      content: userMessage,
      timestamp: new Date()
    }]);

    try {
      // Determine if this is a modification request
      const isModifyRequest = userMessage.toLowerCase().includes('add') ||
                             userMessage.toLowerCase().includes('modify') ||
                             userMessage.toLowerCase().includes('change') ||
                             userMessage.toLowerCase().includes('timer') ||
                             userMessage.toLowerCase().includes('wait');

      // Call AI to explain or modify the workflow
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/workflow-explainer`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify({
          question: userMessage,
          action_type: isModifyRequest ? 'modify' : 'explain',
          workflow: technicianWorkflow,
          ai_spec: aiSpec,
          context: 'workflow_explanation'
        })
      });

      const result = await response.json();
      
      if (result.type === 'modification') {
        // Handle workflow modification
        const message = `${result.explanation}\n\n✨ **Changes made:** ${result.changes_made}\n\n💡 The workflow has been updated! You can see the changes in the JSON below.`;
        
        setChatMessages(prev => [...prev, {
          type: 'ai',
          content: message,
          timestamp: new Date()
        }]);

        // Call the callback to update the parent component
        if (onWorkflowModified && result.modified_workflow) {
          onWorkflowModified(
            result.modified_workflow, 
            result.modified_ai_spec || aiSpec,
            result.changes_made
          );
        }
      } else {
        // Regular explanation
        setChatMessages(prev => [...prev, {
          type: 'ai',
          content: result.explanation || 'I can explain the workflow steps and AI processing. What specific part would you like me to clarify?',
          timestamp: new Date()
        }]);
      }

    } catch (error) {
      console.error('Error getting AI explanation:', error);
      setChatMessages(prev => [...prev, {
        type: 'ai',
        content: 'Sorry, I had trouble processing that question. Try asking about specific workflow steps or AI processing details.',
        timestamp: new Date()
      }]);
    } finally {
      setIsProcessing(false);
    }
  };

  const getStepIcon = (stepType: string) => {
    switch (stepType) {
      case 'extract_values': return '🔍';
      case 'validate_range': return '✅';
      case 'flag_abnormal': return '🚩';
      case 'capture_image': return '📷';
      case 'timer': return '⏱️';
      default: return '📝';
    }
  };

  const getElementTypeIcon = (elementType: string) => {
    switch (elementType) {
      case 'file': return '📷';
      case 'text': return '✏️';
      case 'radiogroup': return '☑️';
      case 'dropdown': return '📋';
      case 'html': return '📖';
      case 'checkbox': return '☑️';
      default: return '📝';
    }
  };

  return (
    <div className="workflow-explainer bg-white rounded-lg shadow-md">
      {/* Tab Navigation */}
      <div className="border-b border-gray-200">
        <nav className="flex space-x-8 px-6 pt-4">
          <button
            onClick={() => setActiveTab('steps')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'steps'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Workflow Steps ({workflowPages?.length || 0})
          </button>
          <button
            onClick={() => setActiveTab('ai')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'ai'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            AI Processing ({aiSpec?.steps?.length || 0})
          </button>
          <button
            onClick={() => setActiveTab('chat')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'chat'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <MessageCircle className="w-4 h-4 inline mr-1" />
            Ask AI
          </button>
        </nav>
      </div>

      <div className="p-6">
        {/* Workflow Steps Tab */}
        {activeTab === 'steps' && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold flex items-center">
              <User className="w-5 h-5 mr-2" />
              Technician Workflow Steps
            </h3>
            
            {workflowPages?.map((page: any, index: number) => (
              <div key={index} className="border rounded-lg overflow-hidden">
                <button
                  onClick={() => toggleStepExpansion(index)}
                  className="w-full px-4 py-3 bg-gray-50 flex items-center justify-between hover:bg-gray-100 transition-colors"
                >
                  <div className="flex items-center">
                    <span className="bg-blue-100 text-blue-800 text-xs font-medium px-2.5 py-0.5 rounded-full mr-3">
                      Step {index + 1}
                    </span>
                    <span className="font-medium">{page.title || page.name}</span>
                  </div>
                  {expandedSteps.has(index) ? (
                    <ChevronDown className="w-4 h-4" />
                  ) : (
                    <ChevronRight className="w-4 h-4" />
                  )}
                </button>
                
                {expandedSteps.has(index) && (
                  <div className="p-4 border-t bg-white">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <h4 className="font-medium mb-2">Form Elements:</h4>
                        <ul className="space-y-1 text-sm">
                          {page.elements?.map((element: any, elemIndex: number) => (
                            <li key={elemIndex} className="flex items-center">
                              <span className="w-2 h-2 bg-blue-500 rounded-full mr-2" />
                              <span className="font-mono text-xs mr-2 bg-gray-100 px-1 rounded">
                                {element.type}
                              </span>
                              {element.title || element.name}
                              {element.isRequired && <span className="text-red-500 ml-1">*</span>}
                            </li>
                          ))}
                        </ul>
                      </div>
                      
                      <div>
                        <h4 className="font-medium mb-2">User Actions:</h4>
                        <ul className="space-y-1 text-sm text-gray-600">
                          {page.elements?.map((element: any, elemIndex: number) => {
                            let actionText = '';
                            let icon = getElementTypeIcon(element.type);
                            
                            if (element.type === 'file') {
                              actionText = `Capture image: ${element.title}`;
                            } else if (element.type === 'text' && element.inputType === 'number') {
                              actionText = `Enter value: ${element.title}`;
                            } else if (element.type === 'radiogroup' || element.type === 'dropdown') {
                              actionText = `Select option: ${element.title}`;
                            } else if (element.type === 'html') {
                              actionText = 'Read instructions';
                            } else {
                              actionText = `Fill out: ${element.title}`;
                            }
                            
                            return (
                              <li key={elemIndex} className="flex items-center">
                                <span className="mr-2">{icon}</span>
                                {actionText}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
            
            {(!workflowPages || workflowPages.length === 0) && (
              <div className="text-center py-8 text-gray-500">
                <User className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                <p>No workflow steps defined</p>
              </div>
            )}
          </div>
        )}

        {/* AI Processing Tab */}
        {activeTab === 'ai' && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold flex items-center">
              <Bot className="w-5 h-5 mr-2" />
              AI Processing Steps
            </h3>
            
            {aiSpec?.steps?.map((step: WorkflowStep, index: number) => (
              <div key={index} className="border rounded-lg p-4">
                <div className="flex items-start space-x-3">
                  <span className="text-2xl">{getStepIcon(step.step_type)}</span>
                  <div className="flex-1">
                    <div className="flex items-center space-x-2 mb-2">
                      <span className="bg-green-100 text-green-800 text-xs font-medium px-2.5 py-0.5 rounded-full">
                        AI Step {index + 1}
                      </span>
                      <span className="font-mono text-xs bg-gray-100 px-2 py-1 rounded">
                        {step.step_type}
                      </span>
                    </div>
                    
                    <p className="text-gray-700 mb-3">{step.description}</p>
                    
                    {step.parameters && (
                      <div className="bg-gray-50 rounded-lg p-3">
                        <h4 className="font-medium text-sm mb-2">Parameters:</h4>
                        <pre className="text-xs text-gray-600 overflow-x-auto">
                          {JSON.stringify(step.parameters, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
            
            {(!aiSpec?.steps || aiSpec.steps.length === 0) && (
              <div className="text-center py-8 text-gray-500">
                <Bot className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                <p>No AI processing steps defined</p>
              </div>
            )}
          </div>
        )}

        {/* AI Chat Tab */}
        {activeTab === 'chat' && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold flex items-center">
              <MessageCircle className="w-5 h-5 mr-2" />
              Workflow Assistant
            </h3>
            
            {/* Chat Messages */}
            <div className="border rounded-lg h-64 overflow-y-auto p-4 space-y-3 bg-gray-50">
              {chatMessages.map((message, index) => (
                <div
                  key={index}
                  className={`flex ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-xs lg:max-w-md px-4 py-2 rounded-lg ${
                      message.type === 'user'
                        ? 'bg-blue-500 text-white'
                        : 'bg-white text-gray-700 border'
                    }`}
                  >
                    <div className="flex items-center mb-1">
                      {message.type === 'ai' ? (
                        <Bot className="w-4 h-4 mr-1" />
                      ) : (
                        <User className="w-4 h-4 mr-1" />
                      )}
                      <span className="text-xs opacity-75">
                        {message.timestamp.toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                  </div>
                </div>
              ))}
              
              {isProcessing && (
                <div className="flex justify-start">
                  <div className="bg-white text-gray-700 border px-4 py-2 rounded-lg">
                    <div className="flex items-center">
                      <Bot className="w-4 h-4 mr-2" />
                      <div className="flex space-x-1">
                        <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                        <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                        <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
            
            {/* Chat Input */}
            <div className="flex space-x-2">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleChatSubmit()}
                placeholder="Ask about workflow steps, AI processing, or timings..."
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={isProcessing}
              />
              <button
                onClick={handleChatSubmit}
                disabled={!chatInput.trim() || isProcessing}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <MessageCircle className="w-4 h-4" />
              </button>
            </div>
            
            {/* Quick Actions */}
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                <span className="text-sm text-gray-600">Quick modifications:</span>
                {[
                  "Add 30 second timer between dip and result entry",
                  "Add image capture step for test strips",
                  "Add confirmation step before finalizing",
                  "Add quality control validation"
                ].map((action) => (
                  <button
                    key={action}
                    onClick={() => setChatInput(action)}
                    className="text-xs px-3 py-1 bg-green-100 text-green-700 rounded-full hover:bg-green-200 transition-colors"
                  >
                    ⚙️ {action}
                  </button>
                ))}
              </div>
              
              <div className="flex flex-wrap gap-2">
                <span className="text-sm text-gray-600">Quick questions:</span>
                {[
                  "What steps involve timing?",
                  "Which steps capture images?",
                  "How does AI validate results?",
                  "What happens if validation fails?"
                ].map((question) => (
                <button
                  key={question}
                  onClick={() => setChatInput(question)}
                  className="text-xs px-3 py-1 bg-blue-100 text-blue-700 rounded-full hover:bg-blue-200 transition-colors"
                >
                  {question}
                </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default WorkflowExplainer;