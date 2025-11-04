import React, { useState, useEffect } from 'react';
import { Workflow, Settings, TestTube, Users, BarChart3, Loader2, Plus, AlertCircle, Trash2 } from 'lucide-react';
import { WorkflowConfigurator } from '../components/Workflow/WorkflowConfigurator';
import { FlowManager } from '../components/Workflow/FlowManager';
import { useAuth } from '../contexts/AuthContext';
import { database } from '../utils/supabase';

interface WorkflowManagementProps {
  className?: string;
}

interface TestGroup {
  id: string;
  name: string;
  description?: string;
  lab_id: string;
}

interface WorkflowVersion {
  id: string;
  name: string;
  description?: string;
  active: boolean;
}

interface WorkflowMapping {
  id: string;
  test_group_id: string;
  workflow_version_id: string;
  is_default: boolean;
  is_active: boolean;
  priority: number;
  test_groups: { id: string; name: string };
  workflow_versions: { id: string; name: string };
}

export const WorkflowManagement: React.FC<WorkflowManagementProps> = ({
  className = ''
}) => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'mappings' | 'config' | 'demo'>('mappings');
  const [labId, setLabId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // State for mappings
  const [mappings, setMappings] = useState<WorkflowMapping[]>([]);
  const [testGroups, setTestGroups] = useState<TestGroup[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowVersion[]>([]);
  
  // State for creation
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newMapping, setNewMapping] = useState({
    test_group_id: '',
    workflow_version_id: '',
    is_default: false,
    priority: 1
  });
  
  const [demoSettings, setDemoSettings] = useState({
    orderId: 'ORDER-12345',
    testGroupId: 'test-group-id',
    analyteIds: ['analyte-1', 'analyte-2'],
    labId: ''
  });

  useEffect(() => {
    const loadLabId = async () => {
      try {
        setLoading(true);
        const currentLabId = await database.getCurrentUserLabId();
        if (!currentLabId) {
          setError('No lab ID found for current user');
          return;
        }
        setLabId(currentLabId);
        setDemoSettings(prev => ({ ...prev, labId: currentLabId }));
        
        // Load workflow mappings
        await loadWorkflowMappings(currentLabId);
      } catch (err) {
        console.error('Failed to load lab ID:', err);
        setError('Failed to load lab context');
      } finally {
        setLoading(false);
      }
    };

    if (user) {
      loadLabId();
    }
  }, [user]);

  const loadWorkflowMappings = async (currentLabId?: string) => {
    const labIdToUse = currentLabId || labId;
    if (!labIdToUse) return;

    try {
      // Load all required data
      const [mappingsResult, testGroupsResult, workflowsResult] = await Promise.all([
        database.testWorkflowMap.getAll(labIdToUse),
        database.testGroups.getByLabId ? database.testGroups.getByLabId(labIdToUse) : database.testGroups.list(labIdToUse),
        database.workflowVersions ? database.workflowVersions.getAll() : { data: [], error: null }
      ]);

      if (mappingsResult.error) throw mappingsResult.error;
      if (testGroupsResult.error) throw testGroupsResult.error;
      if (workflowsResult.error) throw workflowsResult.error;

      setMappings(mappingsResult.data || []);
      setTestGroups(testGroupsResult.data || []);
      setWorkflows(workflowsResult.data || []);
    } catch (err) {
      console.error('Error loading workflow mappings:', err);
      setError(err.message || 'Failed to load workflow mappings');
    }
  };

  const createMapping = async () => {
    if (!newMapping.test_group_id || !newMapping.workflow_version_id) {
      setError('Please select both test group and workflow');
      return;
    }

    try {
      const { error } = await database.testWorkflowMap.create({
        test_group_id: newMapping.test_group_id,
        workflow_version_id: newMapping.workflow_version_id,
        is_default: newMapping.is_default,
        is_active: true,
        priority: newMapping.priority,
        lab_id: labId
      });

      if (error) throw error;

      setShowCreateModal(false);
      setNewMapping({
        test_group_id: '',
        workflow_version_id: '',
        is_default: false,
        priority: 1
      });
      
      await loadWorkflowMappings();
    } catch (err) {
      console.error('Error creating mapping:', err);
      setError(err.message || 'Failed to create mapping');
    }
  };

  const deleteMapping = async (mappingId: string) => {
    if (!confirm('Are you sure you want to delete this workflow mapping?')) {
      return;
    }

    try {
      const { error } = await database.testWorkflowMap.delete(mappingId, labId);
      if (error) throw error;
      
      await loadWorkflowMappings();
    } catch (err) {
      console.error('Error deleting mapping:', err);
      setError(err.message || 'Failed to delete mapping');
    }
  };

  const toggleMappingStatus = async (mappingId: string, currentStatus: boolean) => {
    try {
      const { error } = await database.testWorkflowMap.update(mappingId, {
        is_active: !currentStatus
      }, labId);
      
      if (error) throw error;
      await loadWorkflowMappings();
    } catch (err) {
      console.error('Error updating mapping:', err);
      setError(err.message || 'Failed to update mapping status');
    }
  };

  const setDefaultMapping = async (mappingId: string, testGroupId: string) => {
    try {
      // First, remove default from all mappings for this test group
      const currentDefaults = mappings.filter(m => 
        m.test_group_id === testGroupId && m.is_default
      );
      
      for (const defaultMapping of currentDefaults) {
        await database.testWorkflowMap.update(defaultMapping.id, {
          is_default: false
        }, labId);
      }
      
      // Then set the new default
      const { error } = await database.testWorkflowMap.update(mappingId, {
        is_default: true
      }, labId);
      
      if (error) throw error;
      await loadWorkflowMappings();
    } catch (err) {
      console.error('Error setting default:', err);
      setError(err.message || 'Failed to set default mapping');
    }
  };

  const tabs = [
    {
      id: 'mappings',
      name: 'Test Group Mappings',
      icon: Settings,
      description: 'Configure workflow mappings for test groups'
    },
    {
      id: 'config',
      name: 'Workflow Builder',
      icon: Workflow,
      description: 'Create and configure new workflows'
    },
    {
      id: 'demo',
      name: 'Demo Runner',
      icon: TestTube,
      description: 'Test workflow execution with sample data'
    }
  ];

  if (!labId) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <AlertCircle className="mx-auto h-12 w-12 text-red-500 mb-4" />
          <h2 className="text-lg font-semibold text-gray-900 mb-2">No Lab Context</h2>
          <p className="text-gray-600">Please ensure you're logged in with a valid lab account.</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <div className="flex items-center gap-2 text-gray-600">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading workflow management...
        </div>
      </div>
    );
  }

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Header */}
      <div className="bg-white rounded-lg shadow-sm border p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="bg-blue-100 p-3 rounded-lg">
              <Workflow className="h-6 w-6 text-blue-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Workflow Management</h1>
              <p className="text-gray-600 mt-1">Configure test group mappings and manage workflows</p>
            </div>
          </div>
          {activeTab === 'mappings' && (
            <button
              onClick={() => setShowCreateModal(true)}
              className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 flex items-center gap-2"
            >
              <Plus className="h-4 w-4" />
              Add Mapping
            </button>
          )}
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex">
            <AlertCircle className="h-5 w-5 text-red-400" />
            <div className="ml-3">
              <p className="text-sm text-red-800">{error}</p>
              <button
                onClick={() => setError(null)}
                className="text-xs text-red-600 hover:text-red-800 underline mt-1"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="bg-white rounded-lg shadow-sm border">
        <div className="border-b border-gray-200">
          <nav className="flex px-6">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`py-4 px-4 border-b-2 font-medium text-sm whitespace-nowrap ${
                    isActive
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <div className="flex items-center space-x-2">
                    <Icon className="h-4 w-4" />
                    <span>{tab.name}</span>
                    {tab.id === 'mappings' && (
                      <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full text-xs">
                        {mappings.length}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Tab Content */}
        <div className="p-6">
          {activeTab === 'mappings' && (
            <div>
              {mappings.length === 0 ? (
                <div className="text-center py-12">
                  <Settings className="mx-auto h-12 w-12 text-gray-400 mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 mb-2">No mappings configured</h3>
                  <p className="text-gray-600 mb-4">Create your first test group to workflow mapping.</p>
                  <button
                    onClick={() => setShowCreateModal(true)}
                    className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700"
                  >
                    Add Mapping
                  </button>
                </div>
              ) : (
                <div className="overflow-hidden shadow ring-1 ring-black ring-opacity-5 md:rounded-lg">
                  <table className="min-w-full divide-y divide-gray-300">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Test Group
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Workflow
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Status
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Priority
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {mappings.map((mapping) => (
                        <tr key={mapping.id}>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm font-medium text-gray-900">
                              {mapping.test_groups?.name || 'Unknown Test Group'}
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-900">
                              {mapping.workflow_versions?.name || 'Unknown Workflow'}
                            </div>
                            {mapping.is_default && (
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 ml-2">
                                Default
                              </span>
                            )}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span
                              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                mapping.is_active
                                  ? 'bg-green-100 text-green-800'
                                  : 'bg-red-100 text-red-800'
                              }`}
                            >
                              {mapping.is_active ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {mapping.priority}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                            <div className="flex items-center space-x-2">
                              <button
                                onClick={() => toggleMappingStatus(mapping.id, mapping.is_active)}
                                className="text-blue-600 hover:text-blue-900"
                              >
                                {mapping.is_active ? 'Deactivate' : 'Activate'}
                              </button>
                              {!mapping.is_default && (
                                <button
                                  onClick={() => setDefaultMapping(mapping.id, mapping.test_group_id)}
                                  className="text-green-600 hover:text-green-900"
                                >
                                  Set Default
                                </button>
                              )}
                              <button
                                onClick={() => deleteMapping(mapping.id)}
                                className="text-red-600 hover:text-red-900"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {activeTab === 'config' && (
            <div>
              <div className="mb-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Workflow Configuration</h3>
                <p className="text-gray-600">
                  Map Survey.js workflows to test groups and individual analytes. Higher priority workflows
                  take precedence when multiple mappings exist.
                </p>
              </div>
              {labId ? (
                <WorkflowConfigurator labId={labId} />
              ) : (
                <div className="text-center text-gray-500">Loading lab context...</div>
              )}
            </div>
          )}

          {activeTab === 'demo' && (
            <div>
              <div className="mb-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Workflow Demo</h3>
                <p className="text-gray-600">
                  Test workflow execution with sample data. Configure the demo settings below.
                </p>
              </div>

              {/* Demo Settings */}
              <div className="bg-gray-50 rounded-lg p-4 mb-6">
                <h4 className="font-medium text-gray-900 mb-3">Demo Settings</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Order ID
                    </label>
                    <input
                      type="text"
                      value={demoSettings.orderId}
                      onChange={(e) => setDemoSettings(prev => ({ ...prev, orderId: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Lab ID
                    </label>
                    <input
                      type="text"
                      value={demoSettings.labId}
                      onChange={(e) => setDemoSettings(prev => ({ ...prev, labId: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Test Group ID
                    </label>
                    <input
                      type="text"
                      value={demoSettings.testGroupId}
                      onChange={(e) => setDemoSettings(prev => ({ ...prev, testGroupId: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Analyte IDs (comma-separated)
                    </label>
                    <input
                      type="text"
                      value={demoSettings.analyteIds.join(', ')}
                      onChange={(e) => setDemoSettings(prev => ({ 
                        ...prev, 
                        analyteIds: e.target.value.split(',').map(id => id.trim()).filter(Boolean)
                      }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                </div>
              </div>

              {/* Demo Flow Manager */}
              <FlowManager
                orderId={demoSettings.orderId}
                testGroupId={demoSettings.testGroupId}
                analyteIds={demoSettings.analyteIds}
                labId={demoSettings.labId}
                onComplete={(results) => {
                  console.log('Demo workflow completed:', results);
                  alert('Demo workflow completed! Check console for results.');
                }}
              />
            </div>
          )}

          {activeTab === 'analytics' && (
            <div>
              <div className="mb-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Workflow Analytics</h3>
                <p className="text-gray-600">
                  Monitor workflow performance, completion rates, and user feedback.
                </p>
              </div>

              {/* Analytics Placeholder */}
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-12 text-center">
                <BarChart3 className="h-12 w-12 mx-auto text-gray-400 mb-4" />
                <h4 className="text-lg font-medium text-gray-700 mb-2">Analytics Dashboard</h4>
                <p className="text-gray-500 mb-4">
                  Workflow analytics will be displayed here once sufficient data is collected.
                </p>
                <div className="grid grid-cols-3 gap-4 max-w-md mx-auto">
                  <div className="bg-gray-50 rounded-lg p-4">
                    <div className="text-2xl font-bold text-gray-600">0</div>
                    <div className="text-sm text-gray-500">Total Workflows</div>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-4">
                    <div className="text-2xl font-bold text-gray-600">0%</div>
                    <div className="text-sm text-gray-500">Completion Rate</div>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-4">
                    <div className="text-2xl font-bold text-gray-600">0m</div>
                    <div className="text-sm text-gray-500">Avg Duration</div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="bg-white rounded-lg shadow-sm border p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <button className="p-4 border-2 border-dashed border-gray-300 rounded-lg hover:border-blue-300 hover:bg-blue-50 transition-colors text-left">
            <div className="flex items-center space-x-3">
              <div className="bg-blue-100 p-2 rounded">
                <Workflow className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <h4 className="font-medium text-gray-900">Create New Workflow</h4>
                <p className="text-sm text-gray-600">Design a new Survey.js workflow</p>
              </div>
            </div>
          </button>

          <button className="p-4 border-2 border-dashed border-gray-300 rounded-lg hover:border-green-300 hover:bg-green-50 transition-colors text-left">
            <div className="flex items-center space-x-3">
              <div className="bg-green-100 p-2 rounded">
                <TestTube className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <h4 className="font-medium text-gray-900">Import Templates</h4>
                <p className="text-sm text-gray-600">Import pre-built workflow templates</p>
              </div>
            </div>
          </button>

          <button className="p-4 border-2 border-dashed border-gray-300 rounded-lg hover:border-purple-300 hover:bg-purple-50 transition-colors text-left">
            <div className="flex items-center space-x-3">
              <div className="bg-purple-100 p-2 rounded">
                <Settings className="h-5 w-5 text-purple-600" />
              </div>
              <div>
                <h4 className="font-medium text-gray-900">Bulk Configuration</h4>
                <p className="text-sm text-gray-600">Configure multiple mappings at once</p>
              </div>
            </div>
          </button>
        </div>
      </div>

      {/* Create Mapping Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
            <div className="mt-3">
              <h3 className="text-lg font-medium text-gray-900 mb-4">
                Create Workflow Mapping
              </h3>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Test Group
                  </label>
                  <select
                    value={newMapping.test_group_id}
                    onChange={(e) => setNewMapping(prev => ({ ...prev, test_group_id: e.target.value }))}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select Test Group</option>
                    {testGroups.map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Workflow
                  </label>
                  <select
                    value={newMapping.workflow_version_id}
                    onChange={(e) => setNewMapping(prev => ({ ...prev, workflow_version_id: e.target.value }))}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select Workflow</option>
                    {workflows.filter(w => w.active).map((workflow) => (
                      <option key={workflow.id} value={workflow.id}>
                        {workflow.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Priority
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="10"
                    value={newMapping.priority}
                    onChange={(e) => setNewMapping(prev => ({ ...prev, priority: parseInt(e.target.value) }))}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="is_default"
                    checked={newMapping.is_default}
                    onChange={(e) => setNewMapping(prev => ({ ...prev, is_default: e.target.checked }))}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                  />
                  <label htmlFor="is_default" className="ml-2 block text-sm text-gray-900">
                    Set as default for this test group
                  </label>
                </div>
              </div>

              <div className="flex justify-end space-x-3 mt-6">
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={createMapping}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                >
                  Create Mapping
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};