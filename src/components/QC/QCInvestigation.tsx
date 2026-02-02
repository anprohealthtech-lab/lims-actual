/**
 * QCInvestigation Component
 *
 * Detailed investigation panel with AI copilot for:
 * - "What happened?" - AI summary
 * - "Why it happened?" - Likely causes
 * - "Do next" - Action checklist
 * - CAPA draft editor
 * - Hold/Release patient results control
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  AlertTriangle,
  CheckCircle,
  XCircle,
  Clock,
  Loader2,
  Sparkles,
  ChevronDown,
  ChevronRight,
  FileText,
  ClipboardList,
  AlertCircle,
  User,
  Calendar,
  Edit2,
  Save,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Target,
  Lightbulb,
  ListChecks,
  FileCheck
} from 'lucide-react';
import { useQualityControl } from '../../hooks/useQualityControl';
import type {
  QCInvestigation as QCInvestigationType,
  QCExplainRunResponse,
  QCDraftCAPAResponse,
  LikelyCause,
  AIRecommendation
} from '../../types/qc';

interface QCInvestigationProps {
  investigationId?: string;
  qcRunId?: string;
  labId: string;
  onClose?: () => void;
  onUpdate?: () => void;
}

type Section = 'summary' | 'causes' | 'actions' | 'capa' | 'hold';

export const QCInvestigation: React.FC<QCInvestigationProps> = ({
  investigationId,
  qcRunId,
  labId,
  onClose,
  onUpdate
}) => {
  const [investigation, setInvestigation] = useState<QCInvestigationType | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<Section>>(new Set(['summary', 'causes', 'actions']));
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);

  // Editable CAPA fields
  const [problemStatement, setProblemStatement] = useState('');
  const [rootCause, setRootCause] = useState('');
  const [correctiveAction, setCorrectiveAction] = useState('');
  const [preventiveAction, setPreventiveAction] = useState('');
  const [verificationPlan, setVerificationPlan] = useState('');

  const qc = useQualityControl();

  // Load investigation data
  useEffect(() => {
    loadInvestigation();
  }, [investigationId, qcRunId]);

  const loadInvestigation = async () => {
    setLoading(true);
    try {
      if (investigationId) {
        const data = await qc.getInvestigation(investigationId);
        setInvestigation(data);
        if (data) {
          setProblemStatement(data.final_problem_statement || data.ai_summary || '');
          setRootCause(data.final_root_cause || '');
          setCorrectiveAction(data.final_corrective_action || '');
          setPreventiveAction(data.final_preventive_action || '');
          setVerificationPlan(data.verification_plan || '');
        }
      } else if (qcRunId) {
        // Create new investigation from run
        const newInv = await qc.createInvestigation({
          lab_id: labId,
          qc_run_id: qcRunId,
          title: `QC Investigation`,
          severity: 'medium',
          status: 'open'
        });
        if (newInv) {
          setInvestigation(newInv);
          // Generate AI explanation
          await generateAIExplanation(qcRunId);
        }
      }
    } catch (e) {
      console.error('Failed to load investigation:', e);
    } finally {
      setLoading(false);
    }
  };

  // Generate AI explanation
  const generateAIExplanation = async (runId: string) => {
    setGenerating(true);
    try {
      const explanation = await qc.explainFailure(runId);
      if (explanation?.success && investigation) {
        // Update local state with AI data
        setInvestigation(prev => prev ? {
          ...prev,
          ai_summary: explanation.summary,
          ai_likely_causes: explanation.likely_causes,
          ai_recommendations: explanation.recommended_actions.map(r => ({
            ...r,
            task_type: r.task_type
          })),
          ai_impact_assessment: explanation.impact_assessment as any
        } : null);

        setProblemStatement(explanation.summary);
      }
    } catch (e) {
      console.error('Failed to generate explanation:', e);
    } finally {
      setGenerating(false);
    }
  };

  // Generate CAPA draft
  const generateCAPA = async () => {
    if (!investigation) return;

    setGenerating(true);
    try {
      const capa = await qc.generateCAPA(investigation.qc_run_id || undefined, investigation.id);
      if (capa?.success) {
        setProblemStatement(capa.capa_draft.problem_statement);
        setRootCause(capa.capa_draft.root_cause_hypotheses.map(h => `${h.cause} (${h.likelihood})`).join('\n\n'));
        setCorrectiveAction(capa.capa_draft.corrective_actions.map(a => `${a.action} - ${a.responsible_role} (${a.timeline})`).join('\n\n'));
        setPreventiveAction(capa.capa_draft.preventive_actions.map(a => `${a.action} - ${a.responsible_role} (${a.timeline})`).join('\n\n'));
        setVerificationPlan(capa.capa_draft.verification_plan);
      }
    } catch (e) {
      console.error('Failed to generate CAPA:', e);
    } finally {
      setGenerating(false);
    }
  };

  // Save CAPA updates
  const saveCAPA = async () => {
    if (!investigation) return;

    setSaving(true);
    try {
      await qc.updateInvestigation(investigation.id, {
        final_problem_statement: problemStatement,
        final_root_cause: rootCause,
        final_corrective_action: correctiveAction,
        final_preventive_action: preventiveAction,
        verification_plan: verificationPlan
      });
      setEditMode(false);
      onUpdate?.();
    } catch (e) {
      console.error('Failed to save CAPA:', e);
    } finally {
      setSaving(false);
    }
  };

  // Apply hold
  const applyHold = async () => {
    if (!investigation) return;

    try {
      await qc.applyHold(investigation.id, 'QC failure pending investigation');
      loadInvestigation();
      onUpdate?.();
    } catch (e) {
      console.error('Failed to apply hold:', e);
    }
  };

  // Release hold
  const releaseHold = async () => {
    if (!investigation) return;

    const justification = prompt('Enter justification for releasing the hold:');
    if (!justification) return;

    try {
      await qc.releaseHold(investigation.id, justification);
      loadInvestigation();
      onUpdate?.();
    } catch (e) {
      console.error('Failed to release hold:', e);
    }
  };

  // Toggle section
  const toggleSection = (section: Section) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };

  // Severity badge
  const getSeverityBadge = (severity: string) => {
    const colors = {
      critical: 'bg-red-100 text-red-700 border-red-200',
      high: 'bg-orange-100 text-orange-700 border-orange-200',
      medium: 'bg-yellow-100 text-yellow-700 border-yellow-200',
      low: 'bg-gray-100 text-gray-700 border-gray-200'
    };
    return colors[severity as keyof typeof colors] || colors.medium;
  };

  // Status badge
  const getStatusBadge = (status: string) => {
    const colors = {
      open: 'bg-red-100 text-red-700',
      investigating: 'bg-yellow-100 text-yellow-700',
      pending_review: 'bg-blue-100 text-blue-700',
      closed: 'bg-green-100 text-green-700',
      cancelled: 'bg-gray-100 text-gray-700'
    };
    return colors[status as keyof typeof colors] || colors.open;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
      </div>
    );
  }

  if (!investigation) {
    return (
      <div className="text-center py-12 text-gray-500">
        Investigation not found
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-indigo-600 to-purple-600 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center space-x-3">
              <FileText className="h-6 w-6 text-white" />
              <h2 className="text-xl font-bold text-white">
                {investigation.investigation_number || 'New Investigation'}
              </h2>
            </div>
            <p className="text-indigo-100 mt-1 text-sm">{investigation.title}</p>
          </div>
          <div className="flex items-center space-x-2">
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${getSeverityBadge(investigation.severity)}`}>
              {investigation.severity}
            </span>
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusBadge(investigation.status)}`}>
              {investigation.status.replace(/_/g, ' ')}
            </span>
          </div>
        </div>
      </div>

      <div className="p-6 space-y-6">
        {/* Hold Status Banner */}
        {investigation.hold_patient_results && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center justify-between">
            <div className="flex items-center">
              <ShieldAlert className="h-6 w-6 text-red-600 mr-3" />
              <div>
                <div className="font-semibold text-red-800">Patient Results on Hold</div>
                <div className="text-sm text-red-600">{investigation.hold_reason}</div>
              </div>
            </div>
            <button
              onClick={releaseHold}
              className="px-4 py-2 bg-white text-red-600 border border-red-300 rounded-lg hover:bg-red-50"
            >
              Release Hold
            </button>
          </div>
        )}

        {/* Section: What Happened? (AI Summary) */}
        <div className="border border-gray-200 rounded-xl overflow-hidden">
          <button
            onClick={() => toggleSection('summary')}
            className="w-full px-4 py-3 bg-gray-50 flex items-center justify-between hover:bg-gray-100"
          >
            <div className="flex items-center">
              <Target className="h-5 w-5 text-indigo-600 mr-3" />
              <span className="font-semibold text-gray-900">What Happened?</span>
            </div>
            {expandedSections.has('summary') ? (
              <ChevronDown className="h-5 w-5 text-gray-400" />
            ) : (
              <ChevronRight className="h-5 w-5 text-gray-400" />
            )}
          </button>
          {expandedSections.has('summary') && (
            <div className="p-4">
              {investigation.ai_summary ? (
                <div className="prose prose-sm max-w-none">
                  <p className="text-gray-700">{investigation.ai_summary}</p>
                </div>
              ) : (
                <div className="text-center py-4">
                  <p className="text-gray-500 mb-3">No AI analysis available yet</p>
                  <button
                    onClick={() => investigation.qc_run_id && generateAIExplanation(investigation.qc_run_id)}
                    disabled={generating || !investigation.qc_run_id}
                    className="inline-flex items-center px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {generating ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Sparkles className="h-4 w-4 mr-2" />
                    )}
                    Generate AI Analysis
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Section: Why It Happened? (Likely Causes) */}
        <div className="border border-gray-200 rounded-xl overflow-hidden">
          <button
            onClick={() => toggleSection('causes')}
            className="w-full px-4 py-3 bg-gray-50 flex items-center justify-between hover:bg-gray-100"
          >
            <div className="flex items-center">
              <Lightbulb className="h-5 w-5 text-yellow-600 mr-3" />
              <span className="font-semibold text-gray-900">Why It Happened?</span>
            </div>
            {expandedSections.has('causes') ? (
              <ChevronDown className="h-5 w-5 text-gray-400" />
            ) : (
              <ChevronRight className="h-5 w-5 text-gray-400" />
            )}
          </button>
          {expandedSections.has('causes') && (
            <div className="p-4">
              {investigation.ai_likely_causes && investigation.ai_likely_causes.length > 0 ? (
                <div className="space-y-3">
                  {investigation.ai_likely_causes.map((cause, idx) => (
                    <div
                      key={idx}
                      className={`p-3 rounded-lg border ${
                        cause.probability === 'high' ? 'bg-red-50 border-red-200' :
                        cause.probability === 'medium' ? 'bg-yellow-50 border-yellow-200' :
                        'bg-gray-50 border-gray-200'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="font-medium text-gray-900">{cause.cause}</div>
                        <span className={`text-xs font-medium px-2 py-1 rounded ${
                          cause.probability === 'high' ? 'bg-red-100 text-red-700' :
                          cause.probability === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                          'bg-gray-100 text-gray-700'
                        }`}>
                          {cause.probability}
                        </span>
                      </div>
                      {cause.evidence && cause.evidence.length > 0 && (
                        <ul className="mt-2 text-sm text-gray-600 list-disc list-inside">
                          {cause.evidence.map((e, i) => (
                            <li key={i}>{e}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-500 text-center py-4">No likely causes identified yet</p>
              )}
            </div>
          )}
        </div>

        {/* Section: Do Next (Action Checklist) */}
        <div className="border border-gray-200 rounded-xl overflow-hidden">
          <button
            onClick={() => toggleSection('actions')}
            className="w-full px-4 py-3 bg-gray-50 flex items-center justify-between hover:bg-gray-100"
          >
            <div className="flex items-center">
              <ListChecks className="h-5 w-5 text-green-600 mr-3" />
              <span className="font-semibold text-gray-900">Do Next</span>
            </div>
            {expandedSections.has('actions') ? (
              <ChevronDown className="h-5 w-5 text-gray-400" />
            ) : (
              <ChevronRight className="h-5 w-5 text-gray-400" />
            )}
          </button>
          {expandedSections.has('actions') && (
            <div className="p-4">
              {investigation.ai_recommendations && investigation.ai_recommendations.length > 0 ? (
                <div className="space-y-3">
                  {investigation.ai_recommendations.map((rec, idx) => (
                    <div key={idx} className="flex items-start p-3 bg-gray-50 rounded-lg">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center mr-3 flex-shrink-0 ${
                        rec.priority === 'immediate' ? 'bg-red-100 text-red-600' :
                        rec.priority === 'soon' ? 'bg-yellow-100 text-yellow-600' :
                        'bg-gray-100 text-gray-600'
                      }`}>
                        {idx + 1}
                      </div>
                      <div className="flex-1">
                        <div className="font-medium text-gray-900">{rec.action}</div>
                        <div className="text-sm text-gray-500 mt-1">{rec.rationale}</div>
                        <div className="flex items-center mt-2 space-x-2">
                          <span className={`text-xs px-2 py-1 rounded ${
                            rec.priority === 'immediate' ? 'bg-red-100 text-red-700' :
                            rec.priority === 'soon' ? 'bg-yellow-100 text-yellow-700' :
                            'bg-gray-100 text-gray-700'
                          }`}>
                            {rec.priority}
                          </span>
                          {rec.task_type && (
                            <span className="text-xs px-2 py-1 bg-indigo-100 text-indigo-700 rounded">
                              {rec.task_type.replace(/_/g, ' ')}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-500 text-center py-4">No recommendations available yet</p>
              )}
            </div>
          )}
        </div>

        {/* Section: CAPA Draft */}
        <div className="border border-gray-200 rounded-xl overflow-hidden">
          <button
            onClick={() => toggleSection('capa')}
            className="w-full px-4 py-3 bg-gray-50 flex items-center justify-between hover:bg-gray-100"
          >
            <div className="flex items-center">
              <FileCheck className="h-5 w-5 text-purple-600 mr-3" />
              <span className="font-semibold text-gray-900">CAPA Document</span>
            </div>
            {expandedSections.has('capa') ? (
              <ChevronDown className="h-5 w-5 text-gray-400" />
            ) : (
              <ChevronRight className="h-5 w-5 text-gray-400" />
            )}
          </button>
          {expandedSections.has('capa') && (
            <div className="p-4 space-y-4">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center space-x-2">
                  <button
                    onClick={generateCAPA}
                    disabled={generating}
                    className="inline-flex items-center px-3 py-1.5 bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 text-sm"
                  >
                    {generating ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Sparkles className="h-4 w-4 mr-2" />
                    )}
                    Generate AI CAPA
                  </button>
                </div>
                <button
                  onClick={() => setEditMode(!editMode)}
                  className="inline-flex items-center px-3 py-1.5 text-gray-600 hover:text-gray-800 text-sm"
                >
                  <Edit2 className="h-4 w-4 mr-1" />
                  {editMode ? 'Cancel Edit' : 'Edit'}
                </button>
              </div>

              {/* Problem Statement */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Problem Statement
                </label>
                {editMode ? (
                  <textarea
                    value={problemStatement}
                    onChange={(e) => setProblemStatement(e.target.value)}
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                ) : (
                  <div className="bg-gray-50 p-3 rounded-lg text-sm text-gray-700">
                    {problemStatement || 'Not defined'}
                  </div>
                )}
              </div>

              {/* Root Cause */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Root Cause Analysis
                </label>
                {editMode ? (
                  <textarea
                    value={rootCause}
                    onChange={(e) => setRootCause(e.target.value)}
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                ) : (
                  <div className="bg-gray-50 p-3 rounded-lg text-sm text-gray-700 whitespace-pre-wrap">
                    {rootCause || 'Not defined'}
                  </div>
                )}
              </div>

              {/* Corrective Action */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Corrective Action
                </label>
                {editMode ? (
                  <textarea
                    value={correctiveAction}
                    onChange={(e) => setCorrectiveAction(e.target.value)}
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                ) : (
                  <div className="bg-gray-50 p-3 rounded-lg text-sm text-gray-700 whitespace-pre-wrap">
                    {correctiveAction || 'Not defined'}
                  </div>
                )}
              </div>

              {/* Preventive Action */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Preventive Action
                </label>
                {editMode ? (
                  <textarea
                    value={preventiveAction}
                    onChange={(e) => setPreventiveAction(e.target.value)}
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                ) : (
                  <div className="bg-gray-50 p-3 rounded-lg text-sm text-gray-700 whitespace-pre-wrap">
                    {preventiveAction || 'Not defined'}
                  </div>
                )}
              </div>

              {/* Verification Plan */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Verification Plan
                </label>
                {editMode ? (
                  <textarea
                    value={verificationPlan}
                    onChange={(e) => setVerificationPlan(e.target.value)}
                    rows={2}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                ) : (
                  <div className="bg-gray-50 p-3 rounded-lg text-sm text-gray-700">
                    {verificationPlan || 'Not defined'}
                  </div>
                )}
              </div>

              {editMode && (
                <div className="flex justify-end">
                  <button
                    onClick={saveCAPA}
                    disabled={saving}
                    className="inline-flex items-center px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {saving ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4 mr-2" />
                    )}
                    Save CAPA
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Hold Control */}
        {!investigation.hold_patient_results && (
          <div className="border border-gray-200 rounded-xl p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <ShieldCheck className="h-5 w-5 text-gray-400 mr-3" />
                <div>
                  <div className="font-medium text-gray-900">Patient Result Hold</div>
                  <div className="text-sm text-gray-500">
                    Apply a hold to prevent releasing affected patient results
                  </div>
                </div>
              </div>
              <button
                onClick={applyHold}
                className="px-4 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200"
              >
                Apply Hold
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-gray-200 px-6 py-4 bg-gray-50 flex items-center justify-between">
        <div className="text-sm text-gray-500">
          Created: {new Date(investigation.created_at).toLocaleString()}
        </div>
        <button
          onClick={onClose}
          className="px-4 py-2 text-gray-600 hover:text-gray-800"
        >
          Close
        </button>
      </div>
    </div>
  );
};

export default QCInvestigation;
