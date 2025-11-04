import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { database } from '../utils/supabase';
import { MessageCircle, Bot, User, ChevronDown, ChevronRight, Play, CheckCircle, ArrowLeft } from 'lucide-react';

interface WorkflowStep {
  id: string;
  type: 'agent' | 'user' | 'decision' | 'data';
  title: string;
  description: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  agent?: 'manual-builder' | 'contextualizer' | 'publisher';
  inputs?: string[];
  outputs?: string[];
  confidence?: number;
  issues?: string[];
}

interface WorkflowData {
  protocol_id: string;
  test_name: string;
  status: string;
  steps: WorkflowStep[];
  validation_report?: any;
}

const WorkflowEvaluatorPage: React.FC = () => {
  const { protocolId } = useParams();
  const navigate = useNavigate();
  const [workflowData, setWorkflowData] = useState<WorkflowData | null>(null);
  const [selectedStep, setSelectedStep] = useState<WorkflowStep | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadWorkflowData();
  }, [protocolId]);

  const loadWorkflowData = async () => {
    if (!protocolId) return;
    
    try {
      const { data: protocol, error } = await database.aiProtocols.getById(protocolId);
      
      if (error || !protocol) {
        console.error('Error loading protocol:', error);
        return;
      }

      // Transform protocol data into workflow steps
      const steps: WorkflowStep[] = [
        {
          id: 'step-1-manual',
          type: 'agent',
          title: 'Manual Processing',
          description: 'Extract workflow from uploaded manual',
          status: protocol.status === 'draft_ready' ? 'completed' : 'processing',
          agent: 'manual-builder',
          inputs: ['Manual PDF/Image', 'Test metadata'],
          outputs: ['Technician workflow draft', 'AI processing spec'],
          confidence: 0.87,
          issues: protocol.config?.builder_validation?.needs_attention?.map((issue: any) => issue.description) || []
        },
        {
          id: 'step-2-context',
          type: 'agent',
          title: 'Contextualization',
          description: 'Map to lab-specific analytes and rules',
          status: protocol.status === 'contextualized' ? 'completed' : 'pending',
          agent: 'contextualizer',
          inputs: ['Workflow draft', 'Lab analyte config'],
          outputs: ['Final workflow', 'Validation report'],
          confidence: 0.92,
          issues: []
        },
        {
          id: 'step-3-publish',
          type: 'agent',
          title: 'Publishing',
          description: 'Deploy workflow for production use',
          status: protocol.status === 'published' ? 'completed' : 'pending',
          agent: 'publisher',
          inputs: ['Final workflow', 'Test code mapping'],
          outputs: ['Active workflow version', 'Runtime config'],
          confidence: 0.95,
          issues: []
        }
      ];

      setWorkflowData({
        protocol_id: protocol.id,
        test_name: protocol.name || 'Unknown Test',
        status: protocol.status,
        steps,
        validation_report: protocol.config?.builder_validation
      });
      
    } catch (error) {
      console.error('Error loading workflow data:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStepColor = (step: WorkflowStep) => {
    switch (step.status) {
      case 'completed': return 'bg-green-100 border-green-300';
      case 'processing': return 'bg-blue-100 border-blue-300 animate-pulse';
      case 'error': return 'bg-red-100 border-red-300';
      default: return 'bg-gray-100 border-gray-300';
    }
  };

  const getAgentIcon = (agent?: string) => {
    switch (agent) {
      case 'manual-builder': return '📄';
      case 'contextualizer': return '🔗';
      case 'publisher': return '🚀';
      default: return '👤';
    }
  };

  const handleStepClick = (step: WorkflowStep) => {
    setSelectedStep(selectedStep?.id === step.id ? null : step);
  };

  const handleApprove = async () => {
    if (!protocolId) return;
    
    try {
      // Trigger Agent 2 (Contextualizer)
      const { data, error } = await database.supabase.functions.invoke('agent-2-contextualizer', {
        body: {
          protocol_id: protocolId,
          action: 'proceed_to_contextualization'
        }
      });
      
      if (error) throw error;
      
      console.log('Contextualization started:', data);
      alert('Workflow approved and sent to contextualizer!');
      
      // Refresh data
      await loadWorkflowData();
      
    } catch (error) {
      console.error('Error approving workflow:', error);
      alert('Failed to approve workflow. Please try again.');
    }
  };

  const handleReject = async () => {
    if (!protocolId) return;
    
    try {
      await database.aiProtocols.update(protocolId, {
        status: 'rejected',
        config: {
          rejection_reason: 'Manual review identified issues',
          rejected_at: new Date().toISOString()
        }
      });
      
      alert('Workflow rejected. It can be re-processed after fixing issues.');
      
    } catch (error) {
      console.error('Error rejecting workflow:', error);
      alert('Failed to reject workflow. Please try again.');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin h-12 w-12 border-b-2 border-blue-600 rounded-full mx-auto mb-4"></div>
          <p className="text-gray-600">Loading workflow evaluation...</p>
        </div>
      </div>
    );
  }

  if (!workflowData) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Workflow Not Found</h2>
          <p className="text-gray-600">The requested workflow could not be loaded.</p>
          <button
            onClick={() => navigate('/workflow-configurator')}
            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            Back to Configurator
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="container mx-auto px-4 max-w-6xl">
        <div className="workflow-evaluator p-6 bg-white rounded-lg shadow-md">
          {/* Header */}
          <div className="mb-6">
            <div className="flex items-center mb-4">
              <button
                onClick={() => navigate('/workflow-configurator')}
                className="mr-4 p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <h1 className="text-2xl font-bold text-gray-900">
                Workflow Evaluation: {workflowData.test_name}
              </h1>
            </div>
            <p className="text-sm text-gray-600">
              Protocol ID: {workflowData.protocol_id} | Status: <span className="font-semibold">{workflowData.status}</span>
            </p>
          </div>

          {/* Flowchart Container */}
          <div className="workflow-flowchart bg-gray-50 rounded-lg p-6 mb-6">
            <div className="flex flex-wrap items-center justify-center gap-6">
              {workflowData.steps.map((step, index) => (
                <React.Fragment key={step.id}>
                  {/* Step Node */}
                  <div
                    className={`step-node cursor-pointer transition-all duration-200 hover:scale-105 ${getStepColor(step)} border-2 rounded-lg p-4 min-w-[220px] max-w-[280px]`}
                    onClick={() => handleStepClick(step)}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-2xl">{getAgentIcon(step.agent)}</span>
                      <span className={`px-2 py-1 text-xs rounded-full font-medium ${
                        step.status === 'completed' ? 'bg-green-200 text-green-800' :
                        step.status === 'processing' ? 'bg-blue-200 text-blue-800' :
                        step.status === 'error' ? 'bg-red-200 text-red-800' :
                        'bg-gray-200 text-gray-800'
                      }`}>
                        {step.status}
                      </span>
                    </div>
                    
                    <h3 className="font-semibold text-sm mb-1">{step.title}</h3>
                    <p className="text-xs text-gray-600 mb-2 line-clamp-2">{step.description}</p>
                    
                    {step.confidence && (
                      <div className="confidence-bar mb-2">
                        <div className="flex justify-between text-xs mb-1">
                          <span>Confidence</span>
                          <span>{Math.round(step.confidence * 100)}%</span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div 
                            className="bg-blue-500 h-2 rounded-full transition-all"
                            style={{ width: `${step.confidence * 100}%` }}
                          />
                        </div>
                      </div>
                    )}
                    
                    {step.issues && step.issues.length > 0 && (
                      <div className="flex items-center text-xs text-amber-600">
                        <span className="mr-1">⚠️</span>
                        <span>{step.issues.length} issue(s)</span>
                      </div>
                    )}
                  </div>

                  {/* Arrow Connector */}
                  {index < workflowData.steps.length - 1 && (
                    <div className="flex items-center">
                      <svg width="40" height="20" viewBox="0 0 40 20" className="text-gray-400">
                        <path
                          d="M0 10 L30 10 M25 5 L30 10 L25 15"
                          stroke="currentColor"
                          strokeWidth="2"
                          fill="none"
                        />
                      </svg>
                    </div>
                  )}
                </React.Fragment>
              ))}
            </div>
          </div>

          {/* Step Details Panel */}
          {selectedStep && (
            <div className="step-details bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
              <h3 className="font-semibold text-lg mb-3">
                {getAgentIcon(selectedStep.agent)} {selectedStep.title}
              </h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <h4 className="font-medium mb-2">Inputs:</h4>
                  <ul className="text-sm text-gray-600 space-y-1">
                    {selectedStep.inputs?.map((input, idx) => (
                      <li key={idx} className="flex items-center">
                        <span className="w-2 h-2 bg-blue-500 rounded-full mr-2" />
                        {input}
                      </li>
                    )) || <li className="text-gray-400">None</li>}
                  </ul>
                </div>
                
                <div>
                  <h4 className="font-medium mb-2">Outputs:</h4>
                  <ul className="text-sm text-gray-600 space-y-1">
                    {selectedStep.outputs?.map((output, idx) => (
                      <li key={idx} className="flex items-center">
                        <span className="w-2 h-2 bg-green-500 rounded-full mr-2" />
                        {output}
                      </li>
                    )) || <li className="text-gray-400">None</li>}
                  </ul>
                </div>
              </div>
              
              {selectedStep.issues && selectedStep.issues.length > 0 && (
                <div className="mt-4">
                  <h4 className="font-medium mb-2 text-amber-700">Issues:</h4>
                  <ul className="text-sm text-amber-600 space-y-1">
                    {selectedStep.issues.map((issue, idx) => (
                      <li key={idx} className="flex items-center">
                        <span className="mr-2">⚠️</span>
                        {issue}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Overall Status & Actions */}
          <div className="workflow-actions flex items-center justify-between p-4 bg-gray-50 rounded-lg">
            <div className="status-summary">
              <h4 className="font-medium mb-1">Workflow Summary</h4>
              <div className="flex items-center space-x-4 text-sm">
                <span className="flex items-center">
                  <div className="w-3 h-3 bg-green-500 rounded-full mr-2"></div>
                  {workflowData.steps.filter(s => s.status === 'completed').length} Completed
                </span>
                <span className="flex items-center">
                  <div className="w-3 h-3 bg-red-500 rounded-full mr-2"></div>
                  {workflowData.steps.filter(s => s.status === 'error').length} Errors
                </span>
                <span className="flex items-center">
                  <div className="w-3 h-3 bg-amber-500 rounded-full mr-2"></div>
                  {workflowData.steps.filter(s => s.issues?.length).length} With Issues
                </span>
              </div>
            </div>
            
            <div className="actions flex space-x-3">
              <button
                onClick={handleReject}
                className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors"
              >
                Reject Workflow
              </button>
              <button
                onClick={handleApprove}
                className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors"
              >
                Approve & Continue
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WorkflowEvaluatorPage;