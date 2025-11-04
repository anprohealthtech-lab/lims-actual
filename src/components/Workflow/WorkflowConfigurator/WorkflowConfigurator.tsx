import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import WorkflowProgress from './WorkflowProgress';
import ManualUploader from './ManualUploader';
import DraftReviewer from './DraftReviewer';
import FinalApprover from './FinalApprover';
import { database } from '../../../utils/supabase';

const WorkflowConfigurator: React.FC = () => {
  const [searchParams] = useSearchParams();
  const [labId, setLabId] = useState<string | null>(null);
  const [stage, setStage] = useState<'upload' | 'review' | 'approve'>('upload');
  const [protocolId, setProtocolId] = useState<string | null>(null);
  const [draftData, setDraftData] = useState<any>(null);
  const [contextualizedData, setContextualizedData] = useState<any>(null);
  const [workflowVersionId, setWorkflowVersionId] = useState<string | null>(null);
  const [completionPayload, setCompletionPayload] = useState<any>(null);
  const [labLoading, setLabLoading] = useState(true);
  const [labError, setLabError] = useState<string | null>(null);

  const testGroupId = searchParams.get('testGroupId') || undefined;
  const testCode = searchParams.get('testCode') || undefined;

  useEffect(() => {
    const resolveLabId = async () => {
      setLabLoading(true);
      try {
        const resolvedLabId = await database.getCurrentUserLabId();
        if (!resolvedLabId) {
          setLabError('Unable to determine lab context. Please ensure you are logged in.');
        } else {
          setLabId(resolvedLabId);
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

  return (
    <div className="max-w-6xl mx-auto py-8 space-y-6">
      <WorkflowProgress currentStage={stage} />

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
        </div>
      )}
    </div>
  );
};

export default WorkflowConfigurator;
