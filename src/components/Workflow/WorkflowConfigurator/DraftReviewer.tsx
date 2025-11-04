import React, { useEffect, useMemo, useState } from 'react';
import { database, supabase } from '../../../utils/supabase';
import WorkflowExplainer from './WorkflowExplainer';

interface DraftReviewerProps {
  aiProtocolId: string;
  labId: string;
  testGroupId?: string;
  initialData: any;
  onFinalized: (workflowVersionId: string, finalData: any) => void;
  onBack: () => void;
}

const DraftReviewer: React.FC<DraftReviewerProps> = ({
  aiProtocolId,
  labId,
  testGroupId,
  initialData,
  onFinalized,
  onBack,
}) => {
  const [technicianFlowText, setTechnicianFlowText] = useState(
    JSON.stringify(initialData?.technician_flow_draft ?? {}, null, 2)
  );
  const [aiSpecText, setAiSpecText] = useState(
    JSON.stringify(initialData?.ai_spec_draft ?? {}, null, 2)
  );
  const [loadingContext, setLoadingContext] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [validationAlerts, setValidationAlerts] = useState<string[]>(() => {
    const issues = initialData?.builder_validation?.needs_attention ?? [];
    return issues.map((issue: any) => issue.description || String(issue));
  });
  const [testGroup, setTestGroup] = useState<any>(null);

  useEffect(() => {
    const fetchContext = async () => {
      if (!testGroupId) return;
      setLoadingContext(true);
      try {
        const { data, error } = await database.testGroups.getById(testGroupId);
        if (error) throw error;
        setTestGroup(data);
      } catch (error) {
        console.error('Failed to load test group:', error);
      } finally {
        setLoadingContext(false);
      }
    };

    fetchContext();
  }, [testGroupId]);

  const analyteOptions = useMemo(() => {
    return (
      testGroup?.test_group_analytes?.map((row: any) => ({
        id: row.analyte_id,
        label: row.analytes?.name,
        unit: row.analytes?.unit,
      })) ?? []
    );
  }, [testGroup]);

  const handleFinalize = async () => {
    setProcessing(true);
    try {
      const parsedTechnicianFlow = JSON.parse(technicianFlowText || '{}');
      const parsedAiSpec = JSON.parse(aiSpecText || '{}');

      const invokeResponse = await supabase.functions.invoke('agent-2-contextualizer', {
        body: {
          protocol_id: aiProtocolId,
          technician_flow_draft: parsedTechnicianFlow,
          ai_spec_draft: parsedAiSpec,
          lab_id: labId,
          test_group_id: testGroupId ?? null,
        },
      });

      if (invokeResponse.error) {
        throw invokeResponse.error;
      }

      const finalized = invokeResponse.data;

      const { data: workflow } = await database.workflows.create({
        name: `${finalized?.version_metadata?.test_code || 'Test'} Workflow`,
        description: 'Generated from IFU ingestion',
        type: 'test_workflow',
        category: 'automated',
        lab_id: labId,
        is_active: false,
      });

      if (!workflow) {
        throw new Error('Failed to create workflow record');
      }

      const { data: version, error: versionError } = await database.workflowVersions.create({
        workflow_id: workflow.id,
        version: finalized?.version_metadata?.version_hint || '1.0.0',
        definition: {
          ui: {
            engine: 'surveyjs',
            template: finalized?.technician_flow_final ?? parsedTechnicianFlow
          },
          ai_spec: finalized?.ai_spec_final ?? parsedAiSpec,
          meta: finalized?.version_metadata ?? null
        },
        description: 'Generated from IFU ingestion',
        active: false,
      });

      if (versionError || !version) {
        throw versionError || new Error('Failed to create workflow version');
      }

      const finalValidation = finalized?.final_validation;
      if (finalValidation?.needs_attention?.length) {
        setValidationAlerts(
          finalValidation.needs_attention.map((issue: any) => issue.description || String(issue))
        );

        // Store validation issues in the definition metadata for now
        await database.workflowVersions.update(version.id, {
          description: `${version.description} - Has ${finalValidation.needs_attention.length} validation issues`
        });
      }

      onFinalized(version.id, finalized);
    } catch (error) {
      console.error('Workflow finalization failed:', error);
      alert('Workflow finalization failed. Please inspect the JSON and try again.');
    } finally {
      setProcessing(false);
    }
  };

  const [showExplainer, setShowExplainer] = useState(true);

  const technicianFlow = useMemo(() => {
    try {
      return JSON.parse(technicianFlowText);
    } catch {
      return {};
    }
  }, [technicianFlowText]);

  const aiSpec = useMemo(() => {
    try {
      return JSON.parse(aiSpecText);
    } catch {
      return {};
    }
  }, [aiSpecText]);

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-semibold">Step 2 · Review Draft Workflows</h2>
        <button
          onClick={() => setShowExplainer(!showExplainer)}
          className="px-4 py-2 text-sm bg-blue-100 text-blue-700 rounded-md hover:bg-blue-200 transition-colors"
        >
          {showExplainer ? 'Hide' : 'Show'} Workflow Guide
        </button>
      </div>

      {loadingContext && (
        <div className="mb-4 text-sm text-gray-500">Loading test context…</div>
      )}

      {validationAlerts.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6 text-sm text-yellow-800">
          <p className="font-semibold mb-2">Items that need attention</p>
          <ul className="space-y-1 list-disc list-inside">
            {validationAlerts.map((note, index) => (
              <li key={index}>{note}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Workflow Explainer */}
      {showExplainer && (
        <div className="mb-6">
          <WorkflowExplainer
            technicianWorkflow={technicianFlow}
            aiSpec={aiSpec}
            onStepClick={(stepIndex, stepData) => {
              console.log('Step clicked:', stepIndex, stepData);
            }}
            onWorkflowModified={(modifiedWorkflow, modifiedAiSpec, changes) => {
              console.log('Workflow modified:', changes);
              setTechnicianFlowText(JSON.stringify(modifiedWorkflow, null, 2));
              setAiSpecText(JSON.stringify(modifiedAiSpec, null, 2));
              // Show success message
              alert(`✅ Workflow updated!\n\n${changes}`);
            }}
          />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="flex flex-col">
          <span className="text-sm font-medium text-gray-700 mb-2">Technician workflow (SurveyJS JSON)</span>
          <textarea
            value={technicianFlowText}
            onChange={(event) => setTechnicianFlowText(event.target.value)}
            rows={24}
            className="w-full font-mono text-xs border border-gray-300 rounded-md p-3 min-h-[400px]"
          />
        </div>

        <div className="flex flex-col">
          <span className="text-sm font-medium text-gray-700 mb-2">AI processing spec</span>
          <textarea
            value={aiSpecText}
            onChange={(event) => setAiSpecText(event.target.value)}
            rows={24}
            className="w-full font-mono text-xs border border-gray-300 rounded-md p-3 min-h-[400px]"
          />
        </div>
      </div>

      {analyteOptions.length > 0 && (
        <div className="mt-6">
          <h3 className="text-base font-semibold mb-3">Detected analytes</h3>
          <div className="grid gap-3">
            {analyteOptions.map((option: any) => (
              <div key={option.id} className="flex items-center justify-between bg-gray-50 rounded-md px-3 py-2">
                <span className="text-sm text-gray-700">{option.label}</span>
                <span className="text-xs text-gray-500">Unit: {option.unit || '—'}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex justify-end mt-8 space-x-4">
        <button
          type="button"
          onClick={onBack}
          className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
        >
          Back
        </button>
        <button
          type="button"
          onClick={handleFinalize}
          disabled={processing}
          className={`px-4 py-2 rounded-md font-medium ${
            processing ? 'bg-gray-200 text-gray-500 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700'
          }`}
        >
          {processing ? 'Finalizing…' : 'Finalize Draft'}
        </button>
      </div>
    </div>
  );
};

export default DraftReviewer;
