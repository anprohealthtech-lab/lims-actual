import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import WorkflowProgress from './WorkflowProgress';
import ManualUploader from './ManualUploader';
import DraftReviewer from './DraftReviewer';
import FinalApprover from './FinalApprover';
import TestGroupSelector from './TestGroupSelector';
import { database } from '../../../utils/supabase';

const WorkflowConfigurator: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [labId, setLabId] = useState<string | null>(null);
  const [stage, setStage] = useState<'select' | 'upload' | 'review' | 'approve'>('select');
  const [protocolId, setProtocolId] = useState<string | null>(null);
  const [draftData, setDraftData] = useState<any>(null);
  const [contextualizedData, setContextualizedData] = useState<any>(null);
  const [workflowVersionId, setWorkflowVersionId] = useState<string | null>(null);
  const [completionPayload, setCompletionPayload] = useState<any>(null);
  const [labLoading, setLabLoading] = useState(true);
  const [labError, setLabError] = useState<string | null>(null);
  const [selectedTestGroup, setSelectedTestGroup] = useState<any>(null);

  const testGroupId = searchParams.get('testGroupId') || undefined;
  const testCode = searchParams.get('testCode') || undefined;

  useEffect(() => {
    const resolveLabId = async () => {
      setLabLoading(true);
      try {
        const labId = await database.getCurrentUserLabId();
        if (!labId) {
          setLabError('Unable to determine lab context. Please ensure you are logged in.');
        } else {
          setLabId(labId);
        }
      } catch (error) {
        console.error('Failed to resolve lab ID:', error);
        setLabError('Failed to resolve lab context.');
      } finally {
        setLabLoading(false);
      }
    };

    resolveLabId();
  }, []);

  // If testGroupId is provided in URL, skip test group selection
  useEffect(() => {
    if (testGroupId && labId) {
      setStage('upload');
      loadTestGroupData(testGroupId);
    }
  }, [testGroupId, labId]);

  const loadTestGroupData = async (id: string) => {
    try {
      if (!labId) return;
      const { data: testGroups } = await database.testGroups.getByLabId(labId);
      const testGroup = testGroups?.find(tg => tg.id === id);
      if (testGroup) {
        setSelectedTestGroup(testGroup);
      }
    } catch (error) {
      console.error('Error loading test group data:', error);
    }
  };

  const handleTestGroupSelected = (testGroupId: string, testGroup: any) => {
    setSelectedTestGroup(testGroup);
    setSearchParams({ testGroupId });
    setStage('upload');
  };

  const handleBackToSelection = () => {
    setSelectedTestGroup(null);
    setDraftData(null);
    setContextualizedData(null);
    setProtocolId(null);
    setWorkflowVersionId(null);
    setCompletionPayload(null);
    setSearchParams({});
    setStage('select');
  };

  const handleManualProcessed = (newProtocolId: string, drafts: any) => {
    setProtocolId(newProtocolId);
    setDraftData(drafts);
    setStage('review');
  };

  const handleDraftFinalized = (newWorkflowVersionId: string, contextualized: any) => {
    setWorkflowVersionId(newWorkflowVersionId);
    setContextualizedData(contextualized);
    setStage('approve');
  };

  const handleCompletion = (payload: any) => {
    setCompletionPayload(payload);
  };

  if (labLoading) {
    return (
      <div className="p-8 text-center text-gray-600">Loading lab context…</div>
    );
  }

  if (labError || !labId) {
    return (
      <div className="p-8 text-center text-red-600">{labError || 'Missing lab context.'}</div>
    );
  }

  // Show test group selector if no test group is selected
  if (stage === 'select') {
    return (
      <TestGroupSelector
        onTestGroupSelected={handleTestGroupSelected}
        onCancel={() => window.history.back()}
      />
    );
  }

  return (
    <div className="max-w-6xl mx-auto py-8 space-y-6">
      {/* Header with selected test group info and back button */}
      {selectedTestGroup && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                Configuring Workflow for: {selectedTestGroup.name}
              </h2>
              <p className="text-sm text-gray-600">
                Test Code: {selectedTestGroup.test_code} | {selectedTestGroup.description}
              </p>
            </div>
            <button
              onClick={handleBackToSelection}
              className="px-3 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors"
            >
              ← Change Test Group
            </button>
          </div>
        </div>
      )}

      <WorkflowProgress currentStage={stage as 'upload' | 'review' | 'approve'} />

      {stage === 'upload' && (
        <ManualUploader labId={labId} testGroupId={testGroupId} onProcessed={handleManualProcessed} />
      )}

      {stage === 'review' && protocolId && (
        <DraftReviewer
          aiProtocolId={protocolId}
          labId={labId}
          testGroupId={testGroupId}
          initialData={draftData}
          onFinalized={handleDraftFinalized}
          onBack={() => setStage('upload')}
        />
      )}

      {stage === 'approve' && protocolId && workflowVersionId && contextualizedData && (
        <FinalApprover
          aiProtocolId={protocolId}
          workflowVersionId={workflowVersionId}
          labId={labId}
          testGroupId={testGroupId}
          testCode={testCode}
          contextualizedData={contextualizedData}
          onCompleted={handleCompletion}
          onBack={() => setStage('review')}
        />
      )}

      {completionPayload && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-emerald-800 mb-2">Workflow published</h3>
          <p className="text-sm text-emerald-700">
            The workflow version is now active and mapped to the test code. You can manage it from the workflow
            dashboard, or assign it to additional tests as needed.
          </p>
          <button
            onClick={handleBackToSelection}
            className="mt-3 bg-emerald-600 text-white px-4 py-2 rounded-md hover:bg-emerald-700 transition-colors"
          >
            Configure Another Test Group
          </button>
        </div>
      )}
    </div>
  );
};

export default WorkflowConfigurator;
