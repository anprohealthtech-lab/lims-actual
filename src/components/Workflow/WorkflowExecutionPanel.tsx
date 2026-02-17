/**
 * WorkflowExecutionPanel
 *
 * Displays workflow execution history for an order/test with:
 * - Timeline of executed steps
 * - Step details and payloads
 * - Document generation from workflow results
 * - Re-execution capability
 */

import React, { useState, useEffect } from 'react';
import {
  Workflow,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  FileText,
  Download,
  RefreshCw,
  Eye,
  Loader2,
  Play,
  FileCheck,
  ClipboardList,
  User,
  Calendar
} from 'lucide-react';
import { supabase } from '../../utils/supabase';

interface WorkflowInstance {
  id: string;
  order_id: string;
  workflow_version_id: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  current_step_id: string | null;
  total_steps: number | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  created_by: string | null;
  workflow_versions?: {
    id: string;
    name: string;
    version: string;
    definition: any;
    workflows?: {
      name: string;
      description: string;
    };
  };
  workflow_results?: WorkflowResult[];
}

interface WorkflowResult {
  id: string;
  workflow_instance_id: string;
  step_id: string;
  status: 'pending' | 'completed' | 'failed' | 'skipped';
  payload: any;
  review_status: 'pending' | 'approved' | 'rejected' | null;
  created_at: string;
}

interface WorkflowStepEvent {
  id: string;
  workflow_instance_id: string;
  step_id: string;
  event_type: string;
  payload: any;
  created_at: string;
  created_by: string | null;
}

interface WorkflowExecutionPanelProps {
  orderId: string;
  testGroupId?: string;
  resultId?: string;
  compact?: boolean;
  showDocumentButton?: boolean;
  onExecuteWorkflow?: () => void;
  onGenerateDocument?: (instanceId: string) => void;
}

export const WorkflowExecutionPanel: React.FC<WorkflowExecutionPanelProps> = ({
  orderId,
  testGroupId,
  resultId,
  compact = false,
  showDocumentButton = true,
  onExecuteWorkflow,
  onGenerateDocument
}) => {
  const [instances, setInstances] = useState<WorkflowInstance[]>([]);
  const [stepEvents, setStepEvents] = useState<Record<string, WorkflowStepEvent[]>>({});
  const [loading, setLoading] = useState(true);
  const [expandedInstance, setExpandedInstance] = useState<string | null>(null);
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());
  const [generatingDoc, setGeneratingDoc] = useState<string | null>(null);

  useEffect(() => {
    loadWorkflowInstances();
  }, [orderId, testGroupId, resultId]);

  const loadWorkflowInstances = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('order_workflow_instances')
        .select(`
          id,
          order_id,
          workflow_version_id,
          status,
          current_step_id,
          total_steps,
          started_at,
          completed_at,
          created_at,
          created_by,
          workflow_versions (
            id,
            name,
            version,
            definition,
            workflows (
              name,
              description
            )
          ),
          workflow_results (
            id,
            workflow_instance_id,
            step_id,
            status,
            payload,
            review_status,
            created_at
          )
        `)
        .eq('order_id', orderId)
        .order('created_at', { ascending: false });

      if (testGroupId) {
        // Filter by test_group_id if we have a join to workflow_versions->test_group_id
        query = query.eq('workflow_versions.test_group_id', testGroupId);
      }

      const { data, error } = await query;

      if (error) throw error;

      // Filter out any null results from the join
      const validInstances = (data || []).filter(inst => inst.workflow_versions);
      setInstances(validInstances);

      // Auto-expand the most recent instance
      if (validInstances.length > 0 && !compact) {
        setExpandedInstance(validInstances[0].id);
      }
    } catch (err) {
      console.error('Error loading workflow instances:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadStepEvents = async (instanceId: string) => {
    if (stepEvents[instanceId]) return; // Already loaded

    try {
      const { data, error } = await supabase
        .from('workflow_step_events')
        .select('*')
        .eq('workflow_instance_id', instanceId)
        .order('created_at', { ascending: true });

      if (error) throw error;

      setStepEvents(prev => ({
        ...prev,
        [instanceId]: data || []
      }));
    } catch (err) {
      console.error('Error loading step events:', err);
    }
  };

  const toggleInstance = (instanceId: string) => {
    if (expandedInstance === instanceId) {
      setExpandedInstance(null);
    } else {
      setExpandedInstance(instanceId);
      loadStepEvents(instanceId);
    }
  };

  const toggleStep = (stepId: string) => {
    setExpandedSteps(prev => {
      const newSet = new Set(prev);
      if (newSet.has(stepId)) {
        newSet.delete(stepId);
      } else {
        newSet.add(stepId);
      }
      return newSet;
    });
  };

  const handleGenerateDocument = async (instance: WorkflowInstance) => {
    if (onGenerateDocument) {
      onGenerateDocument(instance.id);
      return;
    }

    setGeneratingDoc(instance.id);
    try {
      // Call the PDF generation function with workflow data
      const { data, error } = await supabase.functions.invoke('generate-report-html', {
        body: {
          order_id: orderId,
          workflow_instance_id: instance.id,
          include_workflow_data: true
        }
      });

      if (error) throw error;

      // Open the generated document
      if (data?.url) {
        window.open(data.url, '_blank');
      }
    } catch (err) {
      console.error('Error generating document:', err);
      alert('Failed to generate document. Please try again.');
    } finally {
      setGeneratingDoc(null);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'failed':
        return <XCircle className="h-4 w-4 text-red-500" />;
      case 'in_progress':
        return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />;
      case 'pending':
        return <Clock className="h-4 w-4 text-gray-400" />;
      default:
        return <AlertCircle className="h-4 w-4 text-yellow-500" />;
    }
  };

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      completed: 'bg-green-100 text-green-800',
      failed: 'bg-red-100 text-red-800',
      in_progress: 'bg-blue-100 text-blue-800',
      pending: 'bg-gray-100 text-gray-800',
      cancelled: 'bg-yellow-100 text-yellow-800'
    };

    return (
      <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${styles[status] || styles.pending}`}>
        {status.replace('_', ' ')}
      </span>
    );
  };

  const formatDateTime = (dateStr: string | null) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const renderStepPayload = (payload: any) => {
    if (!payload || typeof payload !== 'object') return null;

    // Filter out internal fields
    const displayFields = Object.entries(payload).filter(([key]) =>
      !key.startsWith('_') && !['id', 'created_at', 'updated_at'].includes(key)
    );

    if (displayFields.length === 0) return null;

    return (
      <div className="mt-2 bg-gray-50 rounded p-2 text-xs">
        <div className="grid grid-cols-2 gap-2">
          {displayFields.slice(0, 6).map(([key, value]) => (
            <div key={key}>
              <span className="text-gray-500">{key.replace(/_/g, ' ')}:</span>
              <span className="ml-1 text-gray-900 font-medium">
                {typeof value === 'object' ? JSON.stringify(value) : String(value)}
              </span>
            </div>
          ))}
        </div>
        {displayFields.length > 6 && (
          <div className="text-gray-400 mt-1">+{displayFields.length - 6} more fields</div>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        <span className="ml-2 text-gray-500">Loading workflow history...</span>
      </div>
    );
  }

  if (instances.length === 0) {
    return (
      <div className={`${compact ? 'p-3' : 'p-6'} text-center`}>
        <Workflow className={`mx-auto ${compact ? 'h-8 w-8' : 'h-12 w-12'} text-gray-300 mb-2`} />
        <p className="text-gray-500 text-sm">No workflow executions found</p>
        {onExecuteWorkflow && (
          <button
            onClick={onExecuteWorkflow}
            className="mt-3 inline-flex items-center px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            <Play className="h-4 w-4 mr-1" />
            Execute Workflow
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={compact ? 'space-y-2' : 'space-y-4'}>
      {/* Header */}
      {!compact && (
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
            <Workflow className="h-4 w-4 text-indigo-600" />
            Workflow Executions ({instances.length})
          </h3>
          {onExecuteWorkflow && (
            <button
              onClick={onExecuteWorkflow}
              className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
            >
              <Play className="h-3 w-3" />
              New Execution
            </button>
          )}
        </div>
      )}

      {/* Instance List */}
      <div className="space-y-2">
        {instances.map((instance) => {
          const isExpanded = expandedInstance === instance.id;
          const workflowName = instance.workflow_versions?.workflows?.name ||
                               instance.workflow_versions?.name ||
                               'Workflow';
          const results = instance.workflow_results || [];

          return (
            <div
              key={instance.id}
              className={`border rounded-lg overflow-hidden ${
                isExpanded ? 'border-indigo-200 bg-indigo-50/30' : 'border-gray-200'
              }`}
            >
              {/* Instance Header */}
              <button
                onClick={() => toggleInstance(instance.id)}
                className="w-full px-3 py-2 flex items-center justify-between hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4 text-gray-400" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-gray-400" />
                  )}
                  {getStatusIcon(instance.status)}
                  <div className="text-left">
                    <div className="text-sm font-medium text-gray-900">{workflowName}</div>
                    <div className="text-xs text-gray-500">
                      {formatDateTime(instance.started_at || instance.created_at)}
                      {instance.total_steps && (
                        <span className="ml-2">
                          • {instance.current_step_id || '0'}/{instance.total_steps} steps
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {getStatusBadge(instance.status)}
                </div>
              </button>

              {/* Expanded Content */}
              {isExpanded && (
                <div className="border-t border-gray-200 bg-white">
                  {/* Action Bar */}
                  <div className="px-3 py-2 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                    <div className="text-xs text-gray-500">
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        Started: {formatDateTime(instance.started_at)}
                        {instance.completed_at && (
                          <> • Completed: {formatDateTime(instance.completed_at)}</>
                        )}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {showDocumentButton && instance.status === 'completed' && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleGenerateDocument(instance);
                          }}
                          disabled={generatingDoc === instance.id}
                          className="inline-flex items-center px-2 py-1 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
                        >
                          {generatingDoc === instance.id ? (
                            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                          ) : (
                            <FileText className="h-3 w-3 mr-1" />
                          )}
                          Generate Document
                        </button>
                      )}
                      <button
                        onClick={() => loadWorkflowInstances()}
                        className="p-1 text-gray-400 hover:text-gray-600"
                        title="Refresh"
                      >
                        <RefreshCw className="h-3 w-3" />
                      </button>
                    </div>
                  </div>

                  {/* Step Results */}
                  {results.length > 0 ? (
                    <div className="divide-y divide-gray-100">
                      {results.map((result, idx) => {
                        const isStepExpanded = expandedSteps.has(result.id);

                        return (
                          <div key={result.id} className="px-3 py-2">
                            <button
                              onClick={() => toggleStep(result.id)}
                              className="w-full flex items-center justify-between text-left"
                            >
                              <div className="flex items-center gap-2">
                                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
                                  result.status === 'completed' ? 'bg-green-100 text-green-700' :
                                  result.status === 'failed' ? 'bg-red-100 text-red-700' :
                                  'bg-gray-100 text-gray-600'
                                }`}>
                                  {idx + 1}
                                </div>
                                <div>
                                  <div className="text-sm font-medium text-gray-900">
                                    {result.step_id?.replace(/_/g, ' ') || `Step ${idx + 1}`}
                                  </div>
                                  <div className="text-xs text-gray-500">
                                    {result.step_id}
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                {result.review_status && (
                                  <span className={`text-xs px-2 py-0.5 rounded ${
                                    result.review_status === 'approved' ? 'bg-green-100 text-green-700' :
                                    result.review_status === 'rejected' ? 'bg-red-100 text-red-700' :
                                    'bg-yellow-100 text-yellow-700'
                                  }`}>
                                    {result.review_status}
                                  </span>
                                )}
                                {getStatusIcon(result.status)}
                                {isStepExpanded ? (
                                  <ChevronDown className="h-4 w-4 text-gray-400" />
                                ) : (
                                  <ChevronRight className="h-4 w-4 text-gray-400" />
                                )}
                              </div>
                            </button>

                            {isStepExpanded && result.payload && (
                              renderStepPayload(result.payload)
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="px-3 py-4 text-center text-sm text-gray-500">
                      No step results recorded yet
                    </div>
                  )}

                  {/* Step Events Timeline */}
                  {stepEvents[instance.id]?.length > 0 && (
                    <div className="px-3 py-2 bg-gray-50 border-t border-gray-100">
                      <div className="text-xs font-medium text-gray-700 mb-2">Event Timeline</div>
                      <div className="space-y-1">
                        {stepEvents[instance.id].slice(0, 5).map((event) => (
                          <div key={event.id} className="flex items-center gap-2 text-xs">
                            <span className="text-gray-400">{formatDateTime(event.created_at)}</span>
                            <span className={`px-1.5 py-0.5 rounded ${
                              event.event_type === 'COMPLETE' ? 'bg-green-100 text-green-700' :
                              event.event_type === 'FAIL' ? 'bg-red-100 text-red-700' :
                              event.event_type === 'START' ? 'bg-blue-100 text-blue-700' :
                              'bg-gray-100 text-gray-600'
                            }`}>
                              {event.event_type}
                            </span>
                            <span className="text-gray-600">{event.step_id}</span>
                          </div>
                        ))}
                        {stepEvents[instance.id].length > 5 && (
                          <div className="text-xs text-gray-400">
                            +{stepEvents[instance.id].length - 5} more events
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default WorkflowExecutionPanel;
