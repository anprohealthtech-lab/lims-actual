import React, { useState } from 'react';
import { database, generateFilePath, supabase, uploadFile } from '../../../utils/supabase';

interface ManualUploaderProps {
  labId: string;
  testGroupId?: string;
  onProcessed: (protocolId: string, drafts: any) => void;
}

interface TestMeta {
  testCode: string;
  vendor: string;
  model: string;
  sampleType: string;
}

const ManualUploader: React.FC<ManualUploaderProps> = ({ labId, testGroupId, onProcessed }) => {
  const [file, setFile] = useState<File | null>(null);
  const [processing, setProcessing] = useState(false);
  const [testGroup, setTestGroup] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [testMeta, setTestMeta] = useState<TestMeta>({
    testCode: '',
    vendor: '',
    model: '',
    sampleType: 'urine',
  });

  // Load test group data when testGroupId is provided
  React.useEffect(() => {
    const loadTestGroup = async () => {
      if (!testGroupId || !labId) return;
      
      setLoading(true);
      try {
        const { data: testGroups, error } = await database.testGroups.getByLabId(labId);
        if (error) throw error;
        
        const selectedTestGroup = testGroups?.find(tg => tg.id === testGroupId);
        if (selectedTestGroup) {
          setTestGroup(selectedTestGroup);
          // Auto-populate test code from test group
          setTestMeta(prev => ({
            ...prev,
            testCode: selectedTestGroup.code || selectedTestGroup.name || ''
          }));
        }
      } catch (error) {
        console.error('Error loading test group:', error);
      } finally {
        setLoading(false);
      }
    };

    loadTestGroup();
  }, [testGroupId, labId]);

  const handleProcessManual = async () => {
    if (!file) return;

    setProcessing(true);
    try {
      const filePath = generateFilePath(
        file.name,
        testMeta.testCode || 'workflow',
        labId,
        'workflow-manuals'
      );

      const uploadResult = await uploadFile(file, filePath);
      if (!uploadResult?.publicUrl) {
        throw new Error('Unable to upload manual.');
      }

      const protocolPayload = {
        name: `${testMeta.testCode || file.name} IFU ingestion`,
        lab_id: labId,
        category: 'test_ifu_parse',
        status: 'processing',
        description: 'Automated ingestion of test manual to generate workflow drafts',
        config: {
          manual_uri: uploadResult.publicUrl,
          lab_id: labId,
          test_group_id: testGroupId ?? null,
          test_meta: testMeta,
        },
      };

      const { data: protocol, error: createError } = await database.aiProtocols.create(protocolPayload);
      if (createError || !protocol) {
        throw createError || new Error('Failed to initialize protocol');
      }

      const invokeResponse = await supabase.functions.invoke('agent-1-manual-builder', {
        body: {
          protocol_id: protocol.id,
          manual_uri: uploadResult.publicUrl,
          org_id: labId,
          test_meta: testMeta,
        },
      });

      if (invokeResponse.error) {
        throw invokeResponse.error;
      }

      const drafts = invokeResponse.data;

      await database.aiProtocols.update(protocol.id, {
        status: 'draft_ready',
        ui_config: drafts?.technician_flow_draft ?? null,
        result_mapping: drafts?.ai_spec_draft ?? null,
        config: {
          ...(protocol.config || {}),
          builder_validation: drafts?.builder_validation ?? null,
          sections_provenance: drafts?.sections_provenance ?? null,
        },
      });

      onProcessed(protocol.id, drafts);
    } catch (error) {
      console.error('Manual processing failed:', error);
      alert('Manual processing failed. Please verify the file and try again.');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <h2 className="text-2xl font-semibold mb-6">Step 1 · Upload Test Manual</h2>

      {testGroup && (
        <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <h3 className="text-lg font-medium text-blue-900 mb-1">
            Creating workflow for: {testGroup.name}
          </h3>
          <p className="text-sm text-blue-700">
            Test Code: {testGroup.code} | Category: {testGroup.category} | Price: ${testGroup.price}
          </p>
        </div>
      )}

      <div className="grid gap-6">
        <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
          <input
            id="workflow-manual-file"
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"
            className="hidden"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
          <label htmlFor="workflow-manual-file" className="cursor-pointer flex flex-col items-center">
            <svg className="w-12 h-12 text-gray-400 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <span className="text-sm text-gray-600">
              {file ? file.name : 'Click to upload or drag & drop the IFU/manual'}
            </span>
            <span className="text-xs text-gray-400 mt-1">Accepted formats: PDF, PNG, JPG (max 10 MB)</span>
          </label>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Test Code
              {testGroup && <span className="text-green-600 ml-1">(Auto-filled from selected test group)</span>}
            </label>
            <input
              type="text"
              value={testMeta.testCode}
              onChange={(event) => setTestMeta({ ...testMeta, testCode: event.target.value })}
              className={`w-full px-3 py-2 border rounded-md ${
                testGroup 
                  ? 'border-green-300 bg-green-50 text-green-800' 
                  : 'border-gray-300'
              }`}
              placeholder="e.g. URINE-10"
              readOnly={!!testGroup}
            />
            {testGroup && (
              <p className="text-xs text-green-600 mt-1">
                This field is automatically filled from the selected test group. You cannot edit it.
              </p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Sample Type</label>
            <select
              value={testMeta.sampleType}
              onChange={(event) => setTestMeta({ ...testMeta, sampleType: event.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
            >
              <option value="urine">Urine</option>
              <option value="blood">Blood</option>
              <option value="serum">Serum</option>
              <option value="plasma">Plasma</option>
              <option value="swab">Swab</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Vendor</label>
            <input
              type="text"
              value={testMeta.vendor}
              onChange={(event) => setTestMeta({ ...testMeta, vendor: event.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
              placeholder="e.g. Abbott"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Model / Kit</label>
            <input
              type="text"
              value={testMeta.model}
              onChange={(event) => setTestMeta({ ...testMeta, model: event.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
              placeholder="e.g. Multistix 10SG"
            />
          </div>
        </div>

        <button
          type="button"
          onClick={handleProcessManual}
          disabled={!file || processing}
          className={`w-full py-3 px-4 rounded-md font-medium transition-colors ${
            !file || processing
              ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
              : 'bg-blue-600 text-white hover:bg-blue-700'
          }`}
        >
          {processing ? 'Processing manual with AI…' : 'Process Manual'}
        </button>
      </div>
    </div>
  );
};

export default ManualUploader;
