import React, { useState, useEffect } from 'react';
import { 
  Edit, Plus, Trash2, Copy, Search, Filter, Download, 
  ArrowLeft, Eye, Play, Pause, Grid3x3, List, Calendar,
  XCircle, Zap, FileText, RefreshCw
} from 'lucide-react';
import { database } from '../../utils/supabase';
import { useAuth } from '../../contexts/AuthContext';
import SurveyJSFormBuilder from './SurveyJSFormBuilder';



interface WorkflowVersion {
  id: string;
  workflow_id?: string;
  name?: string;
  description?: string;
  version?: string;
  definition?: any;
  active: boolean;
  created_at: string;
}

const VisualWorkflowManager: React.FC = () => {
  const { user } = useAuth();
  const [workflows, setWorkflows] = useState<WorkflowVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [selectedWorkflow, setSelectedWorkflow] = useState<WorkflowVersion | null>(null);
  const [showBuilder, setShowBuilder] = useState(false);
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [stats, setStats] = useState({
    total: 0,
    active: 0,
    draft: 0,
    recentlyUpdated: 0
  });

  useEffect(() => {
    if (user) {
      loadWorkflows();
    }
  }, [user]);

  const loadWorkflows = async () => {
    setLoading(true);
    setError('');

    try {
      const { data: workflowVersions, error: workflowError } = await database.workflowVersions.getAll();
      if (workflowError) throw workflowError;

      const workflows = workflowVersions || [];
      setWorkflows(workflows);
      
      // Calculate statistics
      const now = new Date();
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      
      setStats({
        total: workflows.length,
        active: workflows.filter(w => w.active).length,
        draft: workflows.filter(w => !w.active).length,
        recentlyUpdated: workflows.filter(w => new Date(w.created_at) > weekAgo).length
      });
    } catch (err: any) {
      console.error('Error loading workflows:', err);
      setError(err.message || 'Failed to load workflows');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateNew = () => {
    setSelectedWorkflow(null);
    setIsCreatingNew(true);
    setShowBuilder(true);
  };

  const handleEditWorkflow = (workflow: WorkflowVersion) => {
    setSelectedWorkflow(workflow);
    setIsCreatingNew(false);
    setShowBuilder(true);
  };

  const handleCloneWorkflow = async (workflow: WorkflowVersion) => {
    try {
      const clonedName = `${workflow.name} (Copy)`;
      
      // First create a new workflow
      const { data: newWorkflow, error: workflowError } = await database.workflows.create({
        name: clonedName,
        description: `Cloned from: ${workflow.description || workflow.name}`,
        category: 'custom',
        type: 'visual-builder'
      });

      if (workflowError) throw workflowError;

      // Then create a new version with the cloned definition
      const { error: versionError } = await database.workflowVersions.create({
        workflow_id: newWorkflow.id,
        description: workflow.description,
        version: '1.0.0',
        definition: { ui: { template: {} } },
        active: true
      });

      if (versionError) throw versionError;

      alert('Workflow cloned successfully!');
      loadWorkflows();
    } catch (error: any) {
      console.error('Error cloning workflow:', error);
      alert('Failed to clone workflow: ' + error.message);
    }
  };

  const handleDeleteWorkflow = async (workflow: WorkflowVersion) => {
    if (!confirm(`Are you sure you want to delete "${workflow.name}"? This action cannot be undone.`)) {
      return;
    }

    try {
      const { error } = await database.workflowVersions.delete(workflow.id);
      if (error) throw error;

      alert('Workflow deleted successfully!');
      loadWorkflows();
    } catch (error: any) {
      console.error('Error deleting workflow:', error);
      alert('Failed to delete workflow: ' + error.message);
    }
  };

  const handleToggleActive = async (workflow: WorkflowVersion) => {
    try {
      const { error } = await database.workflowVersions.update(workflow.id, {
        active: !workflow.active
      });

      if (error) throw error;
      loadWorkflows();
    } catch (error: any) {
      console.error('Error updating workflow status:', error);
      alert('Failed to update workflow status: ' + error.message);
    }
  };

  const handleWorkflowSaved = () => {
    setShowBuilder(false);
    setSelectedWorkflow(null);
    setIsCreatingNew(false);
    loadWorkflows();
  };

  const handleExportWorkflow = (workflow: WorkflowVersion) => {
    const exportData = {
      name: workflow.name,
      description: workflow.description,
      version: workflow.version,
      definition: workflow.definition,
      exported_at: new Date().toISOString(),
      exported_from: 'LIMS v2 Visual Workflow Manager'
    };

    const dataStr = JSON.stringify(exportData, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    
    const exportFileDefaultName = `${(workflow.name || 'workflow').replace(/[^a-z0-9]/gi, '_').toLowerCase()}_workflow.json`;
    
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
  };

  const categories = ['all', 'custom', 'visual-builder'];

  if (showBuilder) {
    return (
      <div className="fixed inset-0 z-50 bg-white">
        <div className="h-full flex flex-col">
          {/* Enhanced Builder Header */}
          <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-lg">
            <div className="px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <button
                  onClick={() => {
                    setShowBuilder(false);
                    setSelectedWorkflow(null);
                    setIsCreatingNew(false);
                  }}
                  className="p-2 hover:bg-white hover:bg-opacity-20 rounded-full transition-all duration-200 flex items-center gap-2"
                >
                  <ArrowLeft className="h-5 w-5" />
                  <span className="font-medium">Back to Manager</span>
                </button>
                <div className="border-l border-white border-opacity-30 pl-4">
                  <h1 className="text-xl font-semibold">
                    {isCreatingNew ? '✨ Create New Workflow' : `🎨 Edit: ${selectedWorkflow?.name}`}
                  </h1>
                  <p className="text-blue-100 text-sm">Drag & drop visual workflow builder with AI capabilities</p>
                </div>
              </div>
              
              <div className="flex items-center gap-3">
                <button
                  onClick={() => alert('Preview functionality - coming soon!')}
                  className="px-4 py-2 bg-white bg-opacity-20 hover:bg-opacity-30 rounded-lg flex items-center gap-2 transition-all duration-200"
                >
                  <Eye className="h-4 w-4" />
                  Preview Workflow
                </button>
                <div className="flex items-center gap-2 text-blue-100 text-sm">
                  <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                  Auto-save enabled
                </div>
              </div>
            </div>
          </div>

          {/* Builder Content with Enhanced UI */}
          <div className="flex-1 overflow-hidden bg-gray-50">
            <SurveyJSFormBuilder 
              workflow={selectedWorkflow}
              onSave={handleWorkflowSaved}
            />
          </div>
        </div>
      </div>
    );
  }

  // Filter workflows for display
  const filteredWorkflows = workflows.filter(workflow => {
    const matchesSearch = !searchTerm || 
      workflow.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      workflow.description?.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesCategory = filterCategory === 'all' || 
      filterCategory === 'visual-builder'; // All are visual-builder type
    
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      {/* Enhanced Full Screen Header */}
      <div className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-8">
          {/* Hero Section */}
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-6">
              <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-r from-blue-600 to-purple-600 rounded-2xl blur-sm opacity-75"></div>
                <div className="relative p-4 bg-gradient-to-r from-blue-600 to-purple-600 rounded-2xl">
                  <Zap className="h-8 w-8 text-white" />
                </div>
              </div>
              <div>
                <h1 className="text-4xl font-bold text-gray-900 mb-2">
                  Visual Workflow Manager
                </h1>
                <p className="text-lg text-gray-600">
                  Create, manage and deploy AI-powered laboratory workflows with drag & drop simplicity
                </p>
              </div>
            </div>
            
            <button
              onClick={handleCreateNew}
              className="group relative bg-gradient-to-r from-blue-600 to-blue-700 text-white px-8 py-4 rounded-2xl hover:from-blue-700 hover:to-blue-800 flex items-center gap-3 shadow-xl transition-all duration-300 hover:shadow-2xl hover:scale-105"
            >
              <Plus className="h-6 w-6 group-hover:rotate-90 transition-transform duration-300" />
              <div className="text-left">
                <div className="font-semibold text-lg">Create Workflow</div>
                <div className="text-xs text-blue-100">AI-powered builder</div>
              </div>
            </button>
          </div>

          {/* Enhanced Statistics Dashboard */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
            <div className="group bg-gradient-to-br from-blue-50 via-blue-100 to-blue-200 rounded-2xl p-6 border border-blue-200 hover:shadow-lg transition-all duration-300 hover:-translate-y-1">
              <div className="flex items-center justify-between mb-4">
                <div className="p-3 bg-blue-500 rounded-xl group-hover:scale-110 transition-transform duration-300">
                  <FileText className="h-6 w-6 text-white" />
                </div>
                <div className="text-3xl font-bold text-blue-900">{stats.total}</div>
              </div>
              <div>
                <p className="text-sm font-semibold text-blue-700 uppercase tracking-wide">Total Workflows</p>
                <p className="text-blue-600 text-sm mt-1">All workflow versions</p>
              </div>
            </div>

            <div className="group bg-gradient-to-br from-green-50 via-green-100 to-green-200 rounded-2xl p-6 border border-green-200 hover:shadow-lg transition-all duration-300 hover:-translate-y-1">
              <div className="flex items-center justify-between mb-4">
                <div className="p-3 bg-green-500 rounded-xl group-hover:scale-110 transition-transform duration-300">
                  <Play className="h-6 w-6 text-white" />
                </div>
                <div className="text-3xl font-bold text-green-900">{stats.active}</div>
              </div>
              <div>
                <p className="text-sm font-semibold text-green-700 uppercase tracking-wide">Active Workflows</p>
                <p className="text-green-600 text-sm mt-1">Ready for deployment</p>
              </div>
            </div>

            <div className="group bg-gradient-to-br from-orange-50 via-orange-100 to-orange-200 rounded-2xl p-6 border border-orange-200 hover:shadow-lg transition-all duration-300 hover:-translate-y-1">
              <div className="flex items-center justify-between mb-4">
                <div className="p-3 bg-orange-500 rounded-xl group-hover:scale-110 transition-transform duration-300">
                  <Pause className="h-6 w-6 text-white" />
                </div>
                <div className="text-3xl font-bold text-orange-900">{stats.draft}</div>
              </div>
              <div>
                <p className="text-sm font-semibold text-orange-700 uppercase tracking-wide">Draft Workflows</p>
                <p className="text-orange-600 text-sm mt-1">In development</p>
              </div>
            </div>

            <div className="group bg-gradient-to-br from-purple-50 via-purple-100 to-purple-200 rounded-2xl p-6 border border-purple-200 hover:shadow-lg transition-all duration-300 hover:-translate-y-1">
              <div className="flex items-center justify-between mb-4">
                <div className="p-3 bg-purple-500 rounded-xl group-hover:scale-110 transition-transform duration-300">
                  <Calendar className="h-6 w-6 text-white" />
                </div>
                <div className="text-3xl font-bold text-purple-900">{stats.recentlyUpdated}</div>
              </div>
              <div>
                <p className="text-sm font-semibold text-purple-700 uppercase tracking-wide">Recent Updates</p>
                <p className="text-purple-600 text-sm mt-1">Modified this week</p>
              </div>
            </div>
          </div>

          {/* Enhanced Search, Filters and Controls */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 mb-8">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 flex-1">
              <div className="relative flex-1 max-w-2xl">
                <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400 h-5 w-5" />
                <input
                  type="text"
                  placeholder="Search workflows by name, description, or capabilities..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-12 pr-6 py-4 border border-gray-300 rounded-2xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 w-full shadow-sm text-lg bg-white"
                />
              </div>
              
              <div className="flex items-center gap-3 bg-white rounded-2xl border border-gray-300 px-4 py-4 shadow-sm">
                <Filter className="h-5 w-5 text-gray-400" />
                <select
                  value={filterCategory}
                  onChange={(e) => setFilterCategory(e.target.value)}
                  className="border-0 bg-transparent focus:ring-0 text-gray-700 font-medium"
                >
                  {categories.map(category => (
                    <option key={category} value={category}>
                      {category === 'all' ? 'All Categories' : 
                       category.charAt(0).toUpperCase() + category.slice(1)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1 bg-white rounded-2xl p-1 border border-gray-300 shadow-sm">
                <button
                  onClick={() => setViewMode('grid')}
                  className={`p-3 rounded-xl transition-all duration-200 ${
                    viewMode === 'grid' 
                      ? 'bg-blue-600 text-white shadow-md' 
                      : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                  }`}
                  title="Grid View"
                >
                  <Grid3x3 className="h-5 w-5" />
                </button>
                <button
                  onClick={() => setViewMode('list')}
                  className={`p-3 rounded-xl transition-all duration-200 ${
                    viewMode === 'list' 
                      ? 'bg-blue-600 text-white shadow-md' 
                      : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                  }`}
                  title="List View"
                >
                  <List className="h-5 w-5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Loading State */}
        {loading && (
          <div className="flex items-center justify-center h-96">
            <div className="text-center">
              <div className="relative">
                <div className="animate-spin rounded-full h-16 w-16 border-4 border-blue-200 mx-auto mb-6"></div>
                <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-blue-600 absolute top-0 left-1/2 transform -translate-x-1/2"></div>
              </div>
              <h3 className="text-lg font-semibold text-gray-800 mb-2">Loading Workflows</h3>
              <p className="text-gray-600">Fetching your workflow library...</p>
            </div>
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="bg-gradient-to-r from-red-50 to-red-100 border-l-4 border-red-500 rounded-2xl p-8 shadow-lg">
            <div className="flex items-center mb-4">
              <XCircle className="h-8 w-8 text-red-500 mr-4" />
              <h3 className="text-xl font-bold text-red-900">Unable to Load Workflows</h3>
            </div>
            <p className="text-red-700 mb-6 text-lg">{error}</p>
            <button
              onClick={loadWorkflows}
              className="bg-red-600 text-white px-6 py-3 rounded-xl hover:bg-red-700 transition-colors duration-200 flex items-center gap-2 font-semibold"
            >
              <RefreshCw className="h-5 w-5" />
              Try Again
            </button>
          </div>
        )}

        {/* Enhanced Workflows Display */}
        {!loading && !error && (
          <>
            {filteredWorkflows.length === 0 ? (
              <div className="text-center py-20">
                <div className="relative mb-8">
                  <div className="absolute inset-0 bg-gradient-to-r from-blue-400 to-purple-500 rounded-full blur-3xl opacity-20"></div>
                  <div className="relative p-6 bg-white rounded-full shadow-xl">
                    <Zap className="h-16 w-16 text-gray-400 mx-auto" />
                  </div>
                </div>
                <h3 className="text-3xl font-bold text-gray-900 mb-4">
                  {searchTerm || filterCategory !== 'all' 
                    ? 'No Matching Workflows Found'
                    : 'Ready to Build Your First Workflow?'}
                </h3>
                <p className="text-xl text-gray-600 mb-8 max-w-2xl mx-auto">
                  {searchTerm || filterCategory !== 'all' 
                    ? 'Try adjusting your search terms or filters to find what you\'re looking for.'
                    : 'Create intelligent, AI-powered laboratory workflows with our intuitive drag-and-drop builder.'}
                </p>
                {(!searchTerm && filterCategory === 'all') && (
                  <button
                    onClick={handleCreateNew}
                    className="bg-gradient-to-r from-blue-600 to-purple-600 text-white px-10 py-4 rounded-2xl hover:from-blue-700 hover:to-purple-700 transition-all duration-300 transform hover:scale-105 shadow-xl text-lg font-semibold"
                  >
                    🚀 Create Your First Workflow
                  </button>
                )}
              </div>
            ) : (
              <div className={viewMode === 'grid' 
                ? "grid gap-8 md:grid-cols-2 lg:grid-cols-3" 
                : "space-y-6"
              }>
                {filteredWorkflows.map((workflow) => (
                  <div
                    key={workflow.id}
                    className={`group bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-xl transition-all duration-300 hover:-translate-y-1 ${
                      viewMode === 'list' ? 'flex items-center' : ''
                    }`}
                  >
                    <div className={viewMode === 'list' ? 'flex-1 flex items-center p-6' : 'p-8'}>
                      <div className={viewMode === 'list' ? 'flex-1' : ''}>
                        <div className="flex items-start justify-between mb-4">
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-3">
                              <div className="p-2 bg-gradient-to-r from-blue-500 to-purple-500 rounded-xl">
                                <Zap className="h-5 w-5 text-white" />
                              </div>
                              <h3 className="text-xl font-bold text-gray-900 group-hover:text-blue-600 transition-colors">
                                {workflow.name}
                              </h3>
                            </div>
                            <p className="text-gray-600 mb-4 leading-relaxed">
                              {workflow.description || 'No description provided'}
                            </p>
                            <div className="flex items-center gap-3 flex-wrap mb-4">
                              <span className="px-3 py-1 text-sm font-semibold bg-gradient-to-r from-blue-100 to-blue-200 text-blue-800 rounded-full">
                                v{workflow.version}
                              </span>
                              <span className="px-3 py-1 text-sm font-semibold bg-gradient-to-r from-purple-100 to-purple-200 text-purple-800 rounded-full">
                                🎨 Visual Builder
                              </span>
                              <span className={`px-3 py-1 text-sm font-semibold rounded-full ${
                                workflow.active 
                                  ? 'bg-gradient-to-r from-green-100 to-green-200 text-green-800' 
                                  : 'bg-gradient-to-r from-gray-100 to-gray-200 text-gray-700'
                              }`}>
                                {workflow.active ? '✅ Active' : '⏸️ Draft'}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="text-sm text-gray-500 mb-6 flex items-center gap-2">
                          <Calendar className="h-4 w-4" />
                          Created {new Date(workflow.created_at).toLocaleDateString()}
                        </div>

                        {/* Enhanced Action Buttons */}
                        <div className="flex items-center gap-3 flex-wrap">
                          <button
                            onClick={() => handleEditWorkflow(workflow)}
                            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-600 to-blue-700 text-white text-sm rounded-xl hover:from-blue-700 hover:to-blue-800 transition-all duration-200 shadow-md hover:shadow-lg font-semibold"
                          >
                            <Edit className="h-4 w-4" />
                            Edit Workflow
                          </button>
                          <button
                            onClick={() => handleCloneWorkflow(workflow)}
                            className="flex items-center gap-2 px-4 py-2 bg-gray-600 text-white text-sm rounded-xl hover:bg-gray-700 transition-all duration-200 shadow-md font-semibold"
                          >
                            <Copy className="h-4 w-4" />
                            Clone
                          </button>
                          <button
                            onClick={() => handleExportWorkflow(workflow)}
                            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-sm rounded-xl hover:bg-green-700 transition-all duration-200 shadow-md font-semibold"
                          >
                            <Download className="h-4 w-4" />
                            Export
                          </button>
                          <button
                            onClick={() => handleToggleActive(workflow)}
                            className={`flex items-center gap-2 px-4 py-2 text-sm rounded-xl transition-all duration-200 shadow-md font-semibold ${
                              workflow.active
                                ? 'bg-orange-100 text-orange-800 hover:bg-orange-200'
                                : 'bg-green-100 text-green-800 hover:bg-green-200'
                            }`}
                          >
                            {workflow.active ? (
                              <>
                                <Pause className="h-4 w-4" />
                                Deactivate
                              </>
                            ) : (
                              <>
                                <Play className="h-4 w-4" />
                                Activate
                              </>
                            )}
                          </button>
                          <button
                            onClick={() => handleDeleteWorkflow(workflow)}
                            className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white text-sm rounded-xl hover:bg-red-700 transition-all duration-200 shadow-md font-semibold"
                          >
                            <Trash2 className="h-4 w-4" />
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default VisualWorkflowManager;