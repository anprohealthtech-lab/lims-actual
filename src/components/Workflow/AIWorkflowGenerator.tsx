import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  Search,
  CheckCircle,
  AlertCircle,
  Loader2,
  Workflow,
  TestTube,
  Shield,
  Zap,
  ChevronRight,
  RefreshCw,
  FileCheck,
  Settings2,
  Beaker,
  Activity,
  ClipboardCheck
} from 'lucide-react';
import { supabase, database } from '../../utils/supabase';
import { useAuth } from '../../contexts/AuthContext';

interface TestGroup {
  id: string;
  name: string;
  code: string;
  category: string;
  sample_type?: string;
  department?: string;
  is_active: boolean;
  test_group_analytes?: {
    analyte_id: string;
    analytes: {
      id: string;
      name: string;
      unit: string;
    };
  }[];
}

interface GenerationResult {
  success: boolean;
  workflow?: {
    id: string;
    version_id: string;
  };
  mapping?: {
    id: string;
    test_code: string;
  };
  validation?: {
    nabl_compliant: boolean;
    compliance_score: number;
    accreditation_checklist: Record<string, boolean>;
  };
  metadata?: {
    generated_at: string;
    source: string;
    ai_model: string;
  };
  error?: string;
}

interface AIWorkflowGeneratorProps {
  labId: string;
  onWorkflowGenerated?: (result: GenerationResult) => void;
  onReset?: () => void;
}

export const AIWorkflowGenerator: React.FC<AIWorkflowGeneratorProps> = ({
  labId,
  onWorkflowGenerated,
  onReset
}) => {
  const { user } = useAuth();
  const [testGroups, setTestGroups] = useState<TestGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTestGroup, setSelectedTestGroup] = useState<TestGroup | null>(null);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<GenerationResult | null>(null);
  const [step, setStep] = useState<'select' | 'options' | 'generating' | 'complete'>('select');

  // Generation options
  const [options, setOptions] = useState({
    include_qc: true,
    iqc_levels: 2,
    include_calibration: true,
    strict_nabl: true,
    publish_immediately: true
  });

  useEffect(() => {
    loadTestGroups();
  }, [labId]);

  const loadTestGroups = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('test_groups')
        .select(`
          id, name, code, category, sample_type, department, is_active,
          test_group_analytes (
            analyte_id,
            analytes (id, name, unit)
          )
        `)
        .eq('lab_id', labId)
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      setTestGroups(data || []);
    } catch (err) {
      console.error('Error loading test groups:', err);
    } finally {
      setLoading(false);
    }
  };

  const filteredTestGroups = testGroups.filter(tg => {
    if (!searchTerm) return true;
    const search = searchTerm.toLowerCase();
    return (
      tg.name.toLowerCase().includes(search) ||
      tg.code?.toLowerCase().includes(search) ||
      tg.category?.toLowerCase().includes(search)
    );
  });

  const generateWorkflow = async () => {
    if (!selectedTestGroup) return;

    setGenerating(true);
    setStep('generating');
    setResult(null);

    try {
      const { data, error } = await supabase.functions.invoke('workflow-builder-unified', {
        body: {
          lab_id: labId,
          test_group_id: selectedTestGroup.id,
          options: {
            publish_immediately: options.publish_immediately,
            include_qc: options.include_qc,
            iqc_levels: options.iqc_levels,
            include_calibration: options.include_calibration,
            strict_nabl: options.strict_nabl
          }
        }
      });

      if (error) throw error;

      setResult(data);
      setStep('complete');
      onWorkflowGenerated?.(data);
    } catch (err: any) {
      console.error('Error generating workflow:', err);
      setResult({
        success: false,
        error: err.message || 'Failed to generate workflow'
      });
      setStep('complete');
    } finally {
      setGenerating(false);
    }
  };

  const resetGenerator = () => {
    setSelectedTestGroup(null);
    setResult(null);
    setStep('select');
    // Notify parent to refresh workflow data now that user is done viewing success
    onReset?.();
  };

  const getCategoryColor = (category: string) => {
    const colors: Record<string, string> = {
      'Chemistry': 'bg-blue-100 text-blue-800',
      'Hematology': 'bg-red-100 text-red-800',
      'Microbiology': 'bg-green-100 text-green-800',
      'Immunology': 'bg-purple-100 text-purple-800',
      'Serology': 'bg-orange-100 text-orange-800',
      'Endocrinology': 'bg-pink-100 text-pink-800',
      'Urinalysis': 'bg-yellow-100 text-yellow-800'
    };
    return colors[category] || 'bg-gray-100 text-gray-800';
  };

  const getCategoryIcon = (category: string) => {
    const icons: Record<string, React.ReactNode> = {
      'Chemistry': <Beaker className="h-5 w-5" />,
      'Hematology': <Activity className="h-5 w-5" />,
      'Microbiology': <TestTube className="h-5 w-5" />
    };
    return icons[category] || <TestTube className="h-5 w-5" />;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-indigo-600 to-purple-600 rounded-xl p-6 text-white">
        <div className="flex items-center gap-3 mb-2">
          <div className="bg-white/20 p-2 rounded-lg">
            <Sparkles className="h-6 w-6" />
          </div>
          <h2 className="text-2xl font-bold">AI Workflow Generator</h2>
        </div>
        <p className="text-indigo-100">
          Generate NABL/ISO 15189:2022 compliant workflows in one click.
          The AI will create a complete 4-phase workflow with QC verification,
          analyte mapping, and critical value protocols.
        </p>

        {/* Progress Steps */}
        <div className="flex items-center gap-2 mt-6">
          {['Select Test', 'Configure', 'Generate', 'Complete'].map((label, idx) => {
            const stepNames = ['select', 'options', 'generating', 'complete'];
            const currentIdx = stepNames.indexOf(step);
            const isActive = idx === currentIdx;
            const isComplete = idx < currentIdx;

            return (
              <React.Fragment key={label}>
                <div className="flex items-center gap-2">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${
                    isComplete ? 'bg-green-500 text-white' :
                    isActive ? 'bg-white text-indigo-600' :
                    'bg-white/30 text-white'
                  }`}>
                    {isComplete ? <CheckCircle className="h-5 w-5" /> : idx + 1}
                  </div>
                  <span className={`text-sm hidden sm:block ${isActive ? 'font-semibold' : 'text-indigo-200'}`}>
                    {label}
                  </span>
                </div>
                {idx < 3 && (
                  <div className={`flex-1 h-0.5 ${isComplete ? 'bg-green-400' : 'bg-white/30'}`} />
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* Step 1: Test Group Selection */}
      {step === 'select' && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
          <div className="p-4 border-b border-gray-200">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <TestTube className="h-5 w-5 text-indigo-600" />
              Select Test Group
            </h3>
            <p className="text-sm text-gray-600 mt-1">
              Choose a test group to generate an AI-powered NABL-compliant workflow
            </p>
          </div>

          {/* Search */}
          <div className="p-4 border-b border-gray-100">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
              <input
                type="text"
                placeholder="Search tests by name, code, or category..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>
          </div>

          {/* Test Group Grid */}
          <div className="p-4">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
              </div>
            ) : filteredTestGroups.length === 0 ? (
              <div className="text-center py-12">
                <TestTube className="h-12 w-12 mx-auto text-gray-300 mb-4" />
                <h4 className="font-medium text-gray-900">No test groups found</h4>
                <p className="text-sm text-gray-500">Try adjusting your search</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 max-h-[400px] overflow-y-auto">
                {filteredTestGroups.map((tg) => {
                  const analyteCount = tg.test_group_analytes?.length || 0;
                  const isSelected = selectedTestGroup?.id === tg.id;

                  return (
                    <button
                      key={tg.id}
                      onClick={() => setSelectedTestGroup(tg)}
                      className={`text-left p-4 rounded-lg border-2 transition-all hover:shadow-md ${
                        isSelected
                          ? 'border-indigo-500 bg-indigo-50 shadow-md'
                          : 'border-gray-200 hover:border-indigo-300'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2">
                          <div className={`p-2 rounded-lg ${isSelected ? 'bg-indigo-100 text-indigo-600' : 'bg-gray-100 text-gray-600'}`}>
                            {getCategoryIcon(tg.category)}
                          </div>
                          <div>
                            <h4 className="font-semibold text-gray-900">{tg.name}</h4>
                            <p className="text-xs text-gray-500">{tg.code}</p>
                          </div>
                        </div>
                        {isSelected && (
                          <CheckCircle className="h-5 w-5 text-indigo-600" />
                        )}
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${getCategoryColor(tg.category)}`}>
                          {tg.category || 'General'}
                        </span>
                        {tg.sample_type && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                            {tg.sample_type}
                          </span>
                        )}
                        <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700">
                          {analyteCount} analyte{analyteCount !== 1 ? 's' : ''}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Continue Button */}
          {selectedTestGroup && (
            <div className="p-4 bg-gray-50 border-t border-gray-200 flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Selected:</p>
                <p className="font-semibold text-gray-900">{selectedTestGroup.name}</p>
              </div>
              <button
                onClick={() => setStep('options')}
                className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium"
              >
                Continue
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Step 2: Configuration Options */}
      {step === 'options' && selectedTestGroup && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
          <div className="p-4 border-b border-gray-200">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <Settings2 className="h-5 w-5 text-indigo-600" />
              Configure Workflow Options
            </h3>
            <p className="text-sm text-gray-600 mt-1">
              Customize the workflow generation for {selectedTestGroup.name}
            </p>
          </div>

          <div className="p-6 space-y-6">
            {/* Selected Test Info */}
            <div className="bg-indigo-50 rounded-lg p-4">
              <div className="flex items-center gap-3">
                <div className="bg-indigo-100 p-3 rounded-lg">
                  {getCategoryIcon(selectedTestGroup.category)}
                </div>
                <div>
                  <h4 className="font-semibold text-indigo-900">{selectedTestGroup.name}</h4>
                  <p className="text-sm text-indigo-700">
                    {selectedTestGroup.code} | {selectedTestGroup.category} | {selectedTestGroup.test_group_analytes?.length || 0} analytes
                  </p>
                </div>
              </div>
            </div>

            {/* Options Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* QC Verification */}
              <div className={`p-4 rounded-lg border-2 transition-colors ${options.include_qc ? 'border-green-500 bg-green-50' : 'border-gray-200'}`}>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={options.include_qc}
                    onChange={(e) => setOptions(prev => ({ ...prev, include_qc: e.target.checked }))}
                    className="mt-1 h-5 w-5 text-green-600 rounded focus:ring-green-500"
                  />
                  <div>
                    <div className="flex items-center gap-2">
                      <Shield className="h-4 w-4 text-green-600" />
                      <span className="font-medium text-gray-900">QC Verification Phase</span>
                    </div>
                    <p className="text-sm text-gray-600 mt-1">
                      Include IQC verification with Westgard rules before patient testing
                    </p>
                  </div>
                </label>

                {options.include_qc && (
                  <div className="mt-3 ml-8">
                    <label className="block text-sm font-medium text-gray-700 mb-1">IQC Levels</label>
                    <select
                      value={options.iqc_levels}
                      onChange={(e) => setOptions(prev => ({ ...prev, iqc_levels: parseInt(e.target.value) }))}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                    >
                      <option value={2}>2 Levels (Low + Normal)</option>
                      <option value={3}>3 Levels (Low + Normal + High)</option>
                    </select>
                  </div>
                )}
              </div>

              {/* Calibration */}
              <div className={`p-4 rounded-lg border-2 transition-colors ${options.include_calibration ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}`}>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={options.include_calibration}
                    onChange={(e) => setOptions(prev => ({ ...prev, include_calibration: e.target.checked }))}
                    className="mt-1 h-5 w-5 text-blue-600 rounded focus:ring-blue-500"
                  />
                  <div>
                    <div className="flex items-center gap-2">
                      <Activity className="h-4 w-4 text-blue-600" />
                      <span className="font-medium text-gray-900">Calibration Verification</span>
                    </div>
                    <p className="text-sm text-gray-600 mt-1">
                      Include calibration status check and lot tracking
                    </p>
                  </div>
                </label>
              </div>

              {/* Strict NABL */}
              <div className={`p-4 rounded-lg border-2 transition-colors ${options.strict_nabl ? 'border-purple-500 bg-purple-50' : 'border-gray-200'}`}>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={options.strict_nabl}
                    onChange={(e) => setOptions(prev => ({ ...prev, strict_nabl: e.target.checked }))}
                    className="mt-1 h-5 w-5 text-purple-600 rounded focus:ring-purple-500"
                  />
                  <div>
                    <div className="flex items-center gap-2">
                      <ClipboardCheck className="h-4 w-4 text-purple-600" />
                      <span className="font-medium text-gray-900">Strict NABL Mode</span>
                    </div>
                    <p className="text-sm text-gray-600 mt-1">
                      Enforce all ISO 15189:2022 mandatory requirements
                    </p>
                  </div>
                </label>
              </div>

              {/* Auto Publish */}
              <div className={`p-4 rounded-lg border-2 transition-colors ${options.publish_immediately ? 'border-orange-500 bg-orange-50' : 'border-gray-200'}`}>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={options.publish_immediately}
                    onChange={(e) => setOptions(prev => ({ ...prev, publish_immediately: e.target.checked }))}
                    className="mt-1 h-5 w-5 text-orange-600 rounded focus:ring-orange-500"
                  />
                  <div>
                    <div className="flex items-center gap-2">
                      <Zap className="h-4 w-4 text-orange-600" />
                      <span className="font-medium text-gray-900">Auto-Publish</span>
                    </div>
                    <p className="text-sm text-gray-600 mt-1">
                      Automatically save and activate the workflow
                    </p>
                  </div>
                </label>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="p-4 bg-gray-50 border-t border-gray-200 flex items-center justify-between">
            <button
              onClick={() => setStep('select')}
              className="px-4 py-2 text-gray-600 hover:text-gray-900"
            >
              Back
            </button>
            <button
              onClick={generateWorkflow}
              className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-lg hover:from-indigo-700 hover:to-purple-700 transition-all font-medium shadow-md"
            >
              <Sparkles className="h-4 w-4" />
              Generate Workflow
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Generating */}
      {step === 'generating' && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-12 text-center">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-indigo-100 rounded-full mb-6">
            <Loader2 className="h-10 w-10 animate-spin text-indigo-600" />
          </div>
          <h3 className="text-xl font-semibold text-gray-900 mb-2">Generating NABL Workflow</h3>
          <p className="text-gray-600 mb-6">
            AI is creating a compliant workflow for {selectedTestGroup?.name}...
          </p>

          <div className="max-w-md mx-auto space-y-3 text-left">
            {[
              'Fetching test group configuration',
              'Analyzing analyte requirements',
              'Building 4-phase workflow structure',
              'Configuring QC verification',
              'Mapping to database fields'
            ].map((task, idx) => (
              <div key={idx} className="flex items-center gap-3 text-sm">
                <Loader2 className="h-4 w-4 animate-spin text-indigo-500" />
                <span className="text-gray-600">{task}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Step 4: Complete */}
      {step === 'complete' && result && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
          {result.success ? (
            <>
              {/* Success Header */}
              <div className="p-6 bg-gradient-to-r from-green-50 to-emerald-50 border-b border-green-100">
                <div className="flex items-center gap-4">
                  <div className="bg-green-100 p-3 rounded-full">
                    <CheckCircle className="h-8 w-8 text-green-600" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-green-900">Workflow Generated Successfully!</h3>
                    <p className="text-green-700">
                      {selectedTestGroup?.name} now has a NABL-compliant workflow
                    </p>
                  </div>
                </div>
              </div>

              {/* Validation Results */}
              <div className="p-6">
                <h4 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <Shield className="h-5 w-5 text-indigo-600" />
                  NABL Compliance Score
                </h4>

                {/* Score Display */}
                <div className="flex items-center gap-6 mb-6">
                  <div className="relative w-32 h-32">
                    <svg className="w-32 h-32 transform -rotate-90">
                      <circle
                        cx="64"
                        cy="64"
                        r="56"
                        stroke="#e5e7eb"
                        strokeWidth="8"
                        fill="none"
                      />
                      <circle
                        cx="64"
                        cy="64"
                        r="56"
                        stroke={result.validation?.compliance_score >= 90 ? '#10b981' : result.validation?.compliance_score >= 70 ? '#f59e0b' : '#ef4444'}
                        strokeWidth="8"
                        fill="none"
                        strokeDasharray={`${(result.validation?.compliance_score || 0) * 3.52} 352`}
                        strokeLinecap="round"
                      />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-3xl font-bold text-gray-900">
                        {result.validation?.compliance_score || 0}%
                      </span>
                    </div>
                  </div>

                  <div className="flex-1">
                    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium ${
                      result.validation?.nabl_compliant
                        ? 'bg-green-100 text-green-800'
                        : 'bg-red-100 text-red-800'
                    }`}>
                      {result.validation?.nabl_compliant ? (
                        <>
                          <CheckCircle className="h-4 w-4" />
                          NABL Compliant
                        </>
                      ) : (
                        <>
                          <AlertCircle className="h-4 w-4" />
                          Needs Review
                        </>
                      )}
                    </div>
                    <p className="text-sm text-gray-600 mt-2">
                      Generated with {result.metadata?.ai_model} on {new Date(result.metadata?.generated_at || '').toLocaleString()}
                    </p>
                  </div>
                </div>

                {/* Accreditation Checklist */}
                {result.validation?.accreditation_checklist && (
                  <div className="bg-gray-50 rounded-lg p-4">
                    <h5 className="font-medium text-gray-900 mb-3">Accreditation Checklist</h5>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                      {Object.entries(result.validation.accreditation_checklist).map(([key, value]) => (
                        <div key={key} className="flex items-center gap-2 text-sm">
                          {value ? (
                            <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />
                          ) : (
                            <AlertCircle className="h-4 w-4 text-red-500 flex-shrink-0" />
                          )}
                          <span className="text-gray-700 capitalize">
                            {key.replace(/_/g, ' ')}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Workflow Details */}
                {result.workflow && (
                  <div className="mt-6 p-4 bg-blue-50 rounded-lg">
                    <h5 className="font-medium text-blue-900 mb-2">Workflow Created</h5>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <span className="text-blue-700">Workflow ID:</span>
                        <p className="font-mono text-blue-900">{result.workflow.id.slice(0, 8)}...</p>
                      </div>
                      <div>
                        <span className="text-blue-700">Version ID:</span>
                        <p className="font-mono text-blue-900">{result.workflow.version_id.slice(0, 8)}...</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            /* Error State */
            <div className="p-8 text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-red-100 rounded-full mb-4">
                <AlertCircle className="h-8 w-8 text-red-600" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">Generation Failed</h3>
              <p className="text-red-600 mb-6">{result.error}</p>
            </div>
          )}

          {/* Action Buttons */}
          <div className="p-4 bg-gray-50 border-t border-gray-200 flex items-center justify-between">
            <button
              onClick={resetGenerator}
              className="flex items-center gap-2 px-4 py-2 text-gray-600 hover:text-gray-900"
            >
              <RefreshCw className="h-4 w-4" />
              Generate Another
            </button>
            {result.success && (
              <a
                href="/workflow-management"
                className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
              >
                <Workflow className="h-4 w-4" />
                View Workflows
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default AIWorkflowGenerator;
