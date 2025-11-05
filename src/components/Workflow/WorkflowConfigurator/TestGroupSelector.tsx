import React, { useState, useEffect } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import { database } from '../../../utils/supabase';

interface TestGroup {
  id: string;
  name: string;
  description: string;
  test_code: string;
  created_at: string;
}

interface TestGroupSelectorProps {
  onTestGroupSelected: (testGroupId: string, testGroup: TestGroup) => void;
  onCancel?: () => void;
}

const TestGroupSelector: React.FC<TestGroupSelectorProps> = ({
  onTestGroupSelected,
  onCancel
}) => {
  const { user } = useAuth();
  const [unmappedTestGroups, setUnmappedTestGroups] = useState<TestGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTestGroup, setSelectedTestGroup] = useState<TestGroup | null>(null);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    loadUnmappedTestGroups();
  }, [user]);

  const loadUnmappedTestGroups = async () => {
    if (!user) return;

    setLoading(true);
    setError('');

    try {
      // Get current user's lab ID
      const labId = await database.getCurrentUserLabId();
      if (!labId) {
        throw new Error('Unable to determine user lab context');
      }

      // Get all test groups for this lab
      const { data: testGroups, error: testGroupsError } = await database.testGroups.getByLabId(labId);
      if (testGroupsError) throw testGroupsError;

      // Get all existing workflow mappings for this lab
      const { data: mappings, error: mappingsError } = await database.testWorkflowMap.getAll();
      if (mappingsError) throw mappingsError;

      // Filter out test groups that already have workflow mappings
      const mappedTestGroupIds = new Set(mappings?.map(m => m.test_group_id) || []);
      const unmapped = (testGroups || []).filter(tg => !mappedTestGroupIds.has(tg.id));

      setUnmappedTestGroups(unmapped);
    } catch (error) {
      console.error('Error loading unmapped test groups:', error);
      setError(error instanceof Error ? error.message : 'Failed to load test groups');
    } finally {
      setLoading(false);
    }
  };

  const handleTestGroupSelection = (testGroup: TestGroup) => {
    setSelectedTestGroup(testGroup);
  };

  const handleProceed = () => {
    if (selectedTestGroup) {
      onTestGroupSelected(selectedTestGroup.id, selectedTestGroup);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading available test groups...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6">
          <div className="flex items-center">
            <svg className="h-5 w-5 text-red-400 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.5 0L4.268 19.5c.77.833 1.732 2.5 1.732 2.5z" />
            </svg>
            <h3 className="text-red-800 font-medium">Error Loading Test Groups</h3>
          </div>
          <p className="text-red-700 mt-2">{error}</p>
          <button
            onClick={loadUnmappedTestGroups}
            className="mt-4 bg-red-600 text-white px-4 py-2 rounded-md hover:bg-red-700 transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  if (unmappedTestGroups.length === 0) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6">
          <div className="flex items-center">
            <svg className="h-5 w-5 text-yellow-400 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <h3 className="text-yellow-800 font-medium">No Unmapped Test Groups</h3>
          </div>
          <p className="text-yellow-700 mt-2">
            All test groups in your lab already have workflow configurations. 
            You can edit existing workflows from the Workflow Mappings tab.
          </p>
          {onCancel && (
            <button
              onClick={onCancel}
              className="mt-4 bg-yellow-600 text-white px-4 py-2 rounded-md hover:bg-yellow-700 transition-colors"
            >
              Back to Workflow Management
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-2xl font-semibold text-gray-900">Select Test Group</h2>
          <p className="text-gray-600 mt-2">
            Choose a test group that doesn't have a workflow configuration yet. 
            You'll create the workflow configuration for the selected test group.
          </p>
        </div>

        <div className="p-6">
          <div className="grid gap-4">
            {unmappedTestGroups.map((testGroup) => (
              <div
                key={testGroup.id}
                className={`border rounded-lg p-4 cursor-pointer transition-all ${
                  selectedTestGroup?.id === testGroup.id
                    ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-200'
                    : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                }`}
                onClick={() => handleTestGroupSelection(testGroup)}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center">
                      <input
                        type="radio"
                        name="testGroup"
                        checked={selectedTestGroup?.id === testGroup.id}
                        onChange={() => handleTestGroupSelection(testGroup)}
                        className="mr-3 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300"
                      />
                      <h3 className="text-lg font-medium text-gray-900">{testGroup.name}</h3>
                      <span className="ml-2 px-2 py-1 text-xs font-medium bg-gray-100 text-gray-700 rounded-full">
                        {testGroup.test_code}
                      </span>
                    </div>
                    <p className="text-gray-600 mt-2 ml-7">{testGroup.description || 'No description available'}</p>
                    <p className="text-sm text-gray-500 mt-1 ml-7">
                      Created: {new Date(testGroup.created_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-8 flex justify-between">
            {onCancel && (
              <button
                onClick={onCancel}
                className="px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors"
              >
                Cancel
              </button>
            )}
            <button
              onClick={handleProceed}
              disabled={!selectedTestGroup}
              className={`px-6 py-2 rounded-md font-medium transition-colors ${
                selectedTestGroup
                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                  : 'bg-gray-300 text-gray-500 cursor-not-allowed'
              }`}
            >
              Configure Workflow for Selected Test Group
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TestGroupSelector;