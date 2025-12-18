import React, { useMemo, useState } from 'react';
import { database, supabase } from '../../../utils/supabase';

interface FinalApproverProps {
  aiProtocolId: string;
  workflowVersionId: string;
  labId: string;
  testGroupId?: string;
  testCode?: string;
  contextualizedData: any;
  onCompleted: (payload: {
    workflowVersionId: string;
    publishedWorkflowId: string | null;
    finalMetadata?: any;
  }) => void;
  onBack: () => void;
}

const FinalApprover: React.FC<FinalApproverProps> = ({
  aiProtocolId,
  workflowVersionId,
  labId,
  testGroupId,
  testCode,
  contextualizedData,
  onCompleted,
  onBack,
}) => {
  const [overrideName, setOverrideName] = useState('');
  const [overrideDescription, setOverrideDescription] = useState('');
  const [setDefault, setSetDefault] = useState(true);
  const [publishResults, setPublishResults] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const summary = useMemo(() => {
    const technicianSummary = contextualizedData?.technician_flow_final?.pages?.length ?? 0;
    const aiSteps = contextualizedData?.ai_spec_final?.steps ?? [];
    const analytes = contextualizedData?.version_metadata?.analyte_names ?? [];

    return {
      technicianPageCount: technicianSummary,
      aiStepCount: Array.isArray(aiSteps) ? aiSteps.length : 0,
      analyteCount: Array.isArray(analytes) ? analytes.length : 0,
    };
  }, [contextualizedData]);

  const handleApprove = async () => {
    setProcessing(true);
    setErrorMessage(null);
    try {
      const response = await supabase.functions.invoke('agent-3-publisher', {
        body: {
          protocol_id: aiProtocolId,
          workflow_version_id: workflowVersionId,
          lab_id: labId,
          test_group_id: testGroupId ?? null,
          test_code: testCode ?? contextualizedData?.version_metadata?.test_code ?? null,
          overrides: {
            name: overrideName || undefined,
            description: overrideDescription || undefined,
            publish_results: publishResults,
          },
        },
      });

      if (response.error) {
        throw response.error;
      }

      const { data: publishPayload } = response;

      const finalTestCode = publishPayload?.test_code || testCode || contextualizedData?.version_metadata?.test_code;

      await database.workflowVersions.update(workflowVersionId, {
        active: true,
        description: `${contextualizedData?.version_metadata?.display_name || 'Workflow'} - Approved at ${new Date().toISOString()}`,
      });

      await database.aiProtocols.update(aiProtocolId, {
        status: 'published',
        ui_config: publishPayload?.ui_config ?? contextualizedData?.ui_config ?? null,
        result_mapping: publishPayload?.result_mapping ?? contextualizedData?.result_mapping ?? null,
      });

      if (setDefault && finalTestCode) {
        await database.testWorkflowMap.create({
          lab_id: labId,
          test_group_id: testGroupId ?? null,
          workflow_version_id: workflowVersionId,
          test_code: finalTestCode,
          is_default: true,
        });
      }

      onCompleted({
        workflowVersionId,
        publishedWorkflowId: publishPayload?.workflow_id ?? null,
        finalMetadata: publishPayload,
      });
      
      // Show success message
      setSuccessMessage('Workflow published successfully! Redirecting...');
      
      // Auto-scroll to top to show success message
      window.scrollTo({ top: 0, behavior: 'smooth' });
      
    } catch (error: any) {
      console.error('Workflow approval failed:', error);
      setErrorMessage(error?.message || 'Workflow approval failed.');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <h2 className="text-2xl font-semibold mb-4">Step 3 · Final Approval</h2>
      <p className="text-sm text-gray-600 mb-6">
        Confirm the workflow metadata, publish settings, and finalize the AI protocol for production usage.
      </p>

      {errorMessage && (
        <div className="bg-red-50 text-red-700 border border-red-200 rounded-md px-4 py-3 mb-6 text-sm">
          {errorMessage}
        </div>
      )}

      {successMessage && (
        <div className="bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-md px-4 py-3 mb-6 text-sm font-medium">
          ✓ {successMessage}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="bg-blue-50 text-blue-700 rounded-md px-4 py-3">
          <div className="text-2xl font-semibold">{summary.technicianPageCount}</div>
          <div className="text-xs uppercase tracking-wide">Technician pages</div>
        </div>
        <div className="bg-green-50 text-green-700 rounded-md px-4 py-3">
          <div className="text-2xl font-semibold">{summary.aiStepCount}</div>
          <div className="text-xs uppercase tracking-wide">AI processing steps</div>
        </div>
        <div className="bg-purple-50 text-purple-700 rounded-md px-4 py-3">
          <div className="text-2xl font-semibold">{summary.analyteCount}</div>
          <div className="text-xs uppercase tracking-wide">Mapped analytes</div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <label className="flex flex-col text-sm text-gray-700">
          Workflow display name
          <input
            className="mt-1 border border-gray-300 rounded-md px-3 py-2"
            type="text"
            placeholder={contextualizedData?.version_metadata?.display_name || 'Workflow name'}
            value={overrideName}
            onChange={(event) => setOverrideName(event.target.value)}
          />
        </label>

        <label className="flex flex-col text-sm text-gray-700">
          Description
          <input
            className="mt-1 border border-gray-300 rounded-md px-3 py-2"
            type="text"
            placeholder="Optional description"
            value={overrideDescription}
            onChange={(event) => setOverrideDescription(event.target.value)}
          />
        </label>
      </div>

      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
        <label className="flex items-center space-x-3 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={setDefault}
            onChange={(event) => setSetDefault(event.target.checked)}
            className="h-4 w-4"
          />
          <span>Set as default workflow for this test code</span>
        </label>

        <label className="flex items-center space-x-3 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={publishResults}
            onChange={(event) => setPublishResults(event.target.checked)}
            className="h-4 w-4"
          />
          <span>Enable automatic result publishing</span>
        </label>
      </div>

      <div className="mt-8 flex justify-end space-x-4">
        <button
          type="button"
          className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
          onClick={onBack}
          disabled={processing || !!successMessage}
        >
          Back
        </button>
        <button
          type="button"
          onClick={handleApprove}
          disabled={processing || !!successMessage}
          className={`px-4 py-2 rounded-md font-medium ${
            successMessage
              ? 'bg-emerald-500 text-white cursor-default'
              : processing
              ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
              : 'bg-emerald-600 text-white hover:bg-emerald-700'
          }`}
        >
          {successMessage ? '✓ Published' : processing ? 'Publishing…' : 'Approve & Publish'}
        </button>
      </div>
    </div>
  );
};

export default FinalApprover;
