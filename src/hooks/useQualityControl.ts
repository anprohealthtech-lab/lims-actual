/**
 * useQualityControl Hook
 *
 * Comprehensive hook for Quality Control operations:
 * - QC Runs management
 * - QC Results handling
 * - AI-powered analysis and CAPA generation
 * - Lot management
 * - Task tracking
 */

import { useState, useCallback } from 'react';
import { supabase } from '../utils/supabase';
import type {
  QCRun,
  QCResult,
  QCLot,
  QCInvestigation,
  QCTask,
  QCEvidence,
  QCDriftAlert,
  QCScanIntakeRequest,
  QCScanIntakeResponse,
  QCExplainRunResponse,
  QCDraftCAPAResponse,
  QCDriftAlertResponse,
  QCRunFilters,
  QCInvestigationFilters,
  QCTaskFilters,
  QCLotFilters,
  ExtractedQCValues
} from '../types/qc';

interface UseQualityControlReturn {
  // State
  loading: boolean;
  error: string | null;

  // QC Runs
  createQCRun: (data: Partial<QCRun>) => Promise<QCRun | null>;
  getQCRuns: (filters: QCRunFilters) => Promise<QCRun[]>;
  getQCRun: (id: string) => Promise<QCRun | null>;
  updateQCRun: (id: string, data: Partial<QCRun>) => Promise<QCRun | null>;
  reviewQCRun: (id: string, review: { status: 'reviewed' | 'rejected'; notes?: string }) => Promise<void>;

  // QC Results
  addQCResult: (runId: string, result: Partial<QCResult>) => Promise<QCResult | null>;
  bulkAddResults: (runId: string, results: Partial<QCResult>[]) => Promise<QCResult[]>;
  overrideResult: (resultId: string, override: { pass_fail: string; reason: string }) => Promise<void>;

  // AI Functions
  scanAndExtract: (options: QCScanIntakeRequest) => Promise<QCScanIntakeResponse | null>;
  explainFailure: (runId: string) => Promise<QCExplainRunResponse | null>;
  generateCAPA: (runId?: string, investigationId?: string) => Promise<QCDraftCAPAResponse | null>;
  checkDrift: (labId: string, options?: { analyzerName?: string; lookbackDays?: number }) => Promise<QCDriftAlertResponse | null>;

  // Investigations
  getInvestigations: (filters: QCInvestigationFilters) => Promise<QCInvestigation[]>;
  getInvestigation: (id: string) => Promise<QCInvestigation | null>;
  createInvestigation: (data: Partial<QCInvestigation>) => Promise<QCInvestigation | null>;
  updateInvestigation: (id: string, data: Partial<QCInvestigation>) => Promise<QCInvestigation | null>;
  applyHold: (investigationId: string, reason: string) => Promise<void>;
  releaseHold: (investigationId: string, justification: string) => Promise<void>;

  // Tasks
  getTasks: (filters: QCTaskFilters) => Promise<QCTask[]>;
  createTask: (data: Partial<QCTask>) => Promise<QCTask | null>;
  updateTask: (id: string, data: Partial<QCTask>) => Promise<QCTask | null>;
  completeTask: (id: string, notes: string) => Promise<void>;

  // Lots
  getLots: (filters: QCLotFilters) => Promise<QCLot[]>;
  getLot: (id: string) => Promise<QCLot | null>;
  createLot: (data: Partial<QCLot>) => Promise<QCLot | null>;
  updateLot: (id: string, data: Partial<QCLot>) => Promise<QCLot | null>;

  // Drift Alerts
  getDriftAlerts: (labId: string, status?: string) => Promise<QCDriftAlert[]>;
  acknowledgeAlert: (alertId: string, notes?: string) => Promise<void>;
  resolveAlert: (alertId: string, resolution: string) => Promise<void>;

  // Utilities
  clearError: () => void;
}

export function useQualityControl(): UseQualityControlReturn {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  // ============================================
  // QC Runs
  // ============================================

  const createQCRun = useCallback(async (data: Partial<QCRun>): Promise<QCRun | null> => {
    setLoading(true);
    setError(null);
    try {
      const { data: run, error: err } = await supabase
        .from('qc_runs')
        .insert(data)
        .select()
        .single();

      if (err) throw err;
      return run;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create QC run');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const getQCRuns = useCallback(async (filters: QCRunFilters): Promise<QCRun[]> => {
    setLoading(true);
    setError(null);
    try {
      let query = supabase
        .from('qc_runs')
        .select(`
          *,
          qc_results (
            *,
            analytes:analyte_id (name, code),
            qc_lots:qc_lot_id (lot_number, material_name, level)
          )
        `)
        .eq('lab_id', filters.labId)
        .order('run_date', { ascending: false });

      if (filters.dateFrom) query = query.gte('run_date', filters.dateFrom);
      if (filters.dateTo) query = query.lte('run_date', filters.dateTo);
      if (filters.analyzerName) query = query.eq('analyzer_name', filters.analyzerName);
      if (filters.status) query = query.eq('status', filters.status);
      if (filters.runType) query = query.eq('run_type', filters.runType);
      if (filters.passOnly) query = query.eq('overall_pass', true);
      if (filters.failOnly) query = query.eq('overall_pass', false);

      const { data, error: err } = await query;

      if (err) throw err;
      return data || [];
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch QC runs');
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const getQCRun = useCallback(async (id: string): Promise<QCRun | null> => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from('qc_runs')
        .select(`
          *,
          qc_results (
            *,
            analytes:analyte_id (name, code, unit),
            qc_lots:qc_lot_id (lot_number, material_name, level, manufacturer)
          ),
          qc_evidence (*)
        `)
        .eq('id', id)
        .single();

      if (err) throw err;
      return data;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch QC run');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const updateQCRun = useCallback(async (id: string, data: Partial<QCRun>): Promise<QCRun | null> => {
    setLoading(true);
    setError(null);
    try {
      const { data: run, error: err } = await supabase
        .from('qc_runs')
        .update({ ...data, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();

      if (err) throw err;
      return run;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update QC run');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const reviewQCRun = useCallback(async (
    id: string,
    review: { status: 'reviewed' | 'rejected'; notes?: string }
  ): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id;

      const { error: err } = await supabase
        .from('qc_runs')
        .update({
          status: review.status,
          reviewed_by: userId,
          reviewed_at: new Date().toISOString(),
          review_notes: review.notes,
          updated_at: new Date().toISOString()
        })
        .eq('id', id);

      if (err) throw err;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to review QC run');
    } finally {
      setLoading(false);
    }
  }, []);

  // ============================================
  // QC Results
  // ============================================

  const addQCResult = useCallback(async (runId: string, result: Partial<QCResult>): Promise<QCResult | null> => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from('qc_results')
        .insert({ ...result, qc_run_id: runId })
        .select()
        .single();

      if (err) throw err;
      return data;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add QC result');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const bulkAddResults = useCallback(async (runId: string, results: Partial<QCResult>[]): Promise<QCResult[]> => {
    setLoading(true);
    setError(null);
    try {
      const toInsert = results.map(r => ({ ...r, qc_run_id: runId }));
      const { data, error: err } = await supabase
        .from('qc_results')
        .insert(toInsert)
        .select();

      if (err) throw err;
      return data || [];
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add QC results');
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const overrideResult = useCallback(async (
    resultId: string,
    override: { pass_fail: string; reason: string }
  ): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id;

      const { error: err } = await supabase
        .from('qc_results')
        .update({
          override_pass_fail: override.pass_fail,
          override_reason: override.reason,
          override_by: userId,
          override_at: new Date().toISOString()
        })
        .eq('id', resultId);

      if (err) throw err;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to override result');
    } finally {
      setLoading(false);
    }
  }, []);

  // ============================================
  // AI Functions
  // ============================================

  const scanAndExtract = useCallback(async (options: QCScanIntakeRequest): Promise<QCScanIntakeResponse | null> => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase.functions.invoke('qc-scan-intake', {
        body: options
      });

      if (err) throw err;
      return data;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to scan and extract QC data');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const explainFailure = useCallback(async (runId: string): Promise<QCExplainRunResponse | null> => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase.functions.invoke('qc-ai-explain-run', {
        body: { qc_run_id: runId, include_historical: true, include_calibration: true }
      });

      if (err) throw err;
      return data;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate explanation');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const generateCAPA = useCallback(async (
    runId?: string,
    investigationId?: string
  ): Promise<QCDraftCAPAResponse | null> => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase.functions.invoke('qc-ai-draft-capa', {
        body: { qc_run_id: runId, qc_investigation_id: investigationId }
      });

      if (err) throw err;
      return data;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate CAPA');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const checkDrift = useCallback(async (
    labId: string,
    options?: { analyzerName?: string; lookbackDays?: number }
  ): Promise<QCDriftAlertResponse | null> => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase.functions.invoke('qc-ai-drift-alerts', {
        body: {
          lab_id: labId,
          analyzer_name: options?.analyzerName,
          lookback_days: options?.lookbackDays || 30
        }
      });

      if (err) throw err;
      return data;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to check drift');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  // ============================================
  // Investigations
  // ============================================

  const getInvestigations = useCallback(async (filters: QCInvestigationFilters): Promise<QCInvestigation[]> => {
    setLoading(true);
    setError(null);
    try {
      let query = supabase
        .from('qc_investigations')
        .select(`
          *,
          assigned_user:assigned_to (full_name),
          qc_runs:qc_run_id (run_date, analyzer_name)
        `)
        .eq('lab_id', filters.labId)
        .order('created_at', { ascending: false });

      if (filters.status) query = query.eq('status', filters.status);
      if (filters.severity) query = query.eq('severity', filters.severity);
      if (filters.assignedTo) query = query.eq('assigned_to', filters.assignedTo);
      if (filters.hasHold) query = query.eq('hold_patient_results', true);
      if (filters.dateFrom) query = query.gte('created_at', filters.dateFrom);
      if (filters.dateTo) query = query.lte('created_at', filters.dateTo);

      const { data, error: err } = await query;

      if (err) throw err;
      return (data || []).map(inv => ({
        ...inv,
        assigned_to_name: (inv.assigned_user as any)?.full_name,
        run_date: (inv.qc_runs as any)?.run_date,
        analyzer_name: (inv.qc_runs as any)?.analyzer_name
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch investigations');
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const getInvestigation = useCallback(async (id: string): Promise<QCInvestigation | null> => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from('qc_investigations')
        .select(`
          *,
          qc_runs:qc_run_id (
            *,
            qc_results (
              *,
              analytes:analyte_id (name, code),
              qc_lots:qc_lot_id (lot_number, material_name, level)
            )
          ),
          qc_tasks (*)
        `)
        .eq('id', id)
        .single();

      if (err) throw err;
      return data;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch investigation');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const createInvestigation = useCallback(async (data: Partial<QCInvestigation>): Promise<QCInvestigation | null> => {
    setLoading(true);
    setError(null);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id;

      const { data: inv, error: err } = await supabase
        .from('qc_investigations')
        .insert({ ...data, created_by: userId })
        .select()
        .single();

      if (err) throw err;
      return inv;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create investigation');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const updateInvestigation = useCallback(async (id: string, data: Partial<QCInvestigation>): Promise<QCInvestigation | null> => {
    setLoading(true);
    setError(null);
    try {
      const { data: inv, error: err } = await supabase
        .from('qc_investigations')
        .update({ ...data, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();

      if (err) throw err;
      return inv;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update investigation');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const applyHold = useCallback(async (investigationId: string, reason: string): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id;

      const { error: err } = await supabase.rpc('apply_investigation_hold', {
        p_investigation_id: investigationId,
        p_hold_reason: reason,
        p_applied_by: userId
      });

      if (err) throw err;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to apply hold');
    } finally {
      setLoading(false);
    }
  }, []);

  const releaseHold = useCallback(async (investigationId: string, justification: string): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id;

      const { error: err } = await supabase.rpc('release_investigation_hold', {
        p_investigation_id: investigationId,
        p_justification: justification,
        p_released_by: userId
      });

      if (err) throw err;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to release hold');
    } finally {
      setLoading(false);
    }
  }, []);

  // ============================================
  // Tasks
  // ============================================

  const getTasks = useCallback(async (filters: QCTaskFilters): Promise<QCTask[]> => {
    setLoading(true);
    setError(null);
    try {
      let query = supabase
        .from('qc_tasks')
        .select(`
          *,
          assigned_user:assigned_to (full_name),
          qc_investigations:qc_investigation_id (investigation_number)
        `)
        .eq('lab_id', filters.labId)
        .order('due_date', { ascending: true });

      if (filters.status) query = query.eq('status', filters.status);
      if (filters.priority) query = query.eq('priority', filters.priority);
      if (filters.taskType) query = query.eq('task_type', filters.taskType);
      if (filters.assignedTo) query = query.eq('assigned_to', filters.assignedTo);
      if (filters.dueBefore) query = query.lte('due_date', filters.dueBefore);
      if (filters.overdueOnly) {
        query = query.lt('due_date', new Date().toISOString().split('T')[0]);
        query = query.eq('status', 'pending');
      }

      const { data, error: err } = await query;

      if (err) throw err;
      return (data || []).map(task => ({
        ...task,
        assigned_to_name: (task.assigned_user as any)?.full_name,
        investigation_number: (task.qc_investigations as any)?.investigation_number
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch tasks');
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const createTask = useCallback(async (data: Partial<QCTask>): Promise<QCTask | null> => {
    setLoading(true);
    setError(null);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id;

      const { data: task, error: err } = await supabase
        .from('qc_tasks')
        .insert({ ...data, created_by: userId })
        .select()
        .single();

      if (err) throw err;
      return task;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create task');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const updateTask = useCallback(async (id: string, data: Partial<QCTask>): Promise<QCTask | null> => {
    setLoading(true);
    setError(null);
    try {
      const { data: task, error: err } = await supabase
        .from('qc_tasks')
        .update({ ...data, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();

      if (err) throw err;
      return task;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update task');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const completeTask = useCallback(async (id: string, notes: string): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id;

      const { error: err } = await supabase
        .from('qc_tasks')
        .update({
          status: 'completed',
          completed_by: userId,
          completed_at: new Date().toISOString(),
          completion_notes: notes,
          updated_at: new Date().toISOString()
        })
        .eq('id', id);

      if (err) throw err;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to complete task');
    } finally {
      setLoading(false);
    }
  }, []);

  // ============================================
  // Lots
  // ============================================

  const getLots = useCallback(async (filters: QCLotFilters): Promise<QCLot[]> => {
    setLoading(true);
    setError(null);
    try {
      let query = supabase
        .from('qc_lots')
        .select('*')
        .eq('lab_id', filters.labId)
        .order('created_at', { ascending: false });

      if (filters.isActive !== undefined) query = query.eq('is_active', filters.isActive);
      if (filters.lotType) query = query.eq('lot_type', filters.lotType);
      if (filters.expiringWithinDays) {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() + filters.expiringWithinDays);
        query = query.lte('expiry_date', cutoffDate.toISOString().split('T')[0]);
      }

      const { data, error: err } = await query;

      if (err) throw err;
      return data || [];
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch lots');
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const getLot = useCallback(async (id: string): Promise<QCLot | null> => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from('qc_lots')
        .select(`
          *,
          qc_target_values (
            *,
            analytes:analyte_id (name, code)
          )
        `)
        .eq('id', id)
        .single();

      if (err) throw err;
      return data;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch lot');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const createLot = useCallback(async (data: Partial<QCLot>): Promise<QCLot | null> => {
    setLoading(true);
    setError(null);
    try {
      const { data: lot, error: err } = await supabase
        .from('qc_lots')
        .insert(data)
        .select()
        .single();

      if (err) throw err;
      return lot;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create lot');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const updateLot = useCallback(async (id: string, data: Partial<QCLot>): Promise<QCLot | null> => {
    setLoading(true);
    setError(null);
    try {
      const { data: lot, error: err } = await supabase
        .from('qc_lots')
        .update({ ...data, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();

      if (err) throw err;
      return lot;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update lot');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  // ============================================
  // Drift Alerts
  // ============================================

  const getDriftAlerts = useCallback(async (labId: string, status?: string): Promise<QCDriftAlert[]> => {
    setLoading(true);
    setError(null);
    try {
      let query = supabase
        .from('qc_drift_alerts')
        .select(`
          *,
          analytes:analyte_id (name),
          qc_lots:qc_lot_id (lot_number)
        `)
        .eq('lab_id', labId)
        .order('created_at', { ascending: false });

      if (status) query = query.eq('status', status);

      const { data, error: err } = await query;

      if (err) throw err;
      return (data || []).map(alert => ({
        ...alert,
        analyte_name: (alert.analytes as any)?.name,
        lot_number: (alert.qc_lots as any)?.lot_number
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch drift alerts');
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const acknowledgeAlert = useCallback(async (alertId: string, notes?: string): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id;

      const { error: err } = await supabase
        .from('qc_drift_alerts')
        .update({
          status: 'acknowledged',
          acknowledged_by: userId,
          acknowledged_at: new Date().toISOString(),
          acknowledgment_notes: notes
        })
        .eq('id', alertId);

      if (err) throw err;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to acknowledge alert');
    } finally {
      setLoading(false);
    }
  }, []);

  const resolveAlert = useCallback(async (alertId: string, resolution: string): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id;

      const { error: err } = await supabase
        .from('qc_drift_alerts')
        .update({
          status: 'resolved',
          resolved_by: userId,
          resolved_at: new Date().toISOString(),
          resolution_notes: resolution
        })
        .eq('id', alertId);

      if (err) throw err;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to resolve alert');
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    loading,
    error,
    createQCRun,
    getQCRuns,
    getQCRun,
    updateQCRun,
    reviewQCRun,
    addQCResult,
    bulkAddResults,
    overrideResult,
    scanAndExtract,
    explainFailure,
    generateCAPA,
    checkDrift,
    getInvestigations,
    getInvestigation,
    createInvestigation,
    updateInvestigation,
    applyHold,
    releaseHold,
    getTasks,
    createTask,
    updateTask,
    completeTask,
    getLots,
    getLot,
    createLot,
    updateLot,
    getDriftAlerts,
    acknowledgeAlert,
    resolveAlert,
    clearError
  };
}

export default useQualityControl;
