/**
 * useQCDashboard Hook
 *
 * Provides real-time QC dashboard data:
 * - Today's pass rate and statistics
 * - Open investigations
 * - Active drift alerts
 * - Expiring lots
 * - Pending tasks
 * - EQC status
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../utils/supabase';
import type {
  QCInvestigation,
  QCDriftAlert,
  QCLot,
  QCTask,
  EQCResult,
  QCDashboardStats,
  QCDashboardData
} from '../types/qc';

interface UseQCDashboardReturn {
  // Dashboard data
  data: QCDashboardData | null;
  todayStats: QCDashboardStats | null;
  weeklyTrend: QCDashboardStats[];
  openInvestigations: QCInvestigation[];
  activeAlerts: QCDriftAlert[];
  expiringLots: QCLot[];
  pendingTasks: QCTask[];
  eqcPending: EQCResult[];
  violationBreakdown: Record<string, number>;

  // Loading states
  loading: boolean;
  refreshing: boolean;
  error: string | null;

  // Actions
  refresh: () => Promise<void>;
}

export function useQCDashboard(labId: string): UseQCDashboardReturn {
  const [data, setData] = useState<QCDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDashboardData = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const today = new Date().toISOString().split('T')[0];
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      const weekAgoStr = weekAgo.toISOString().split('T')[0];

      // Parallel fetch all dashboard data
      const [
        todayStatsResult,
        weeklyTrendResult,
        investigationsResult,
        alertsResult,
        lotsResult,
        tasksResult,
        eqcResult,
        violationsResult
      ] = await Promise.all([
        // Today's stats from v_qc_dashboard view
        supabase
          .from('v_qc_dashboard')
          .select('*')
          .eq('lab_id', labId)
          .eq('run_date', today)
          .single(),

        // Weekly trend
        supabase
          .from('v_qc_dashboard')
          .select('*')
          .eq('lab_id', labId)
          .gte('run_date', weekAgoStr)
          .order('run_date', { ascending: true }),

        // Open investigations
        supabase
          .from('qc_investigations')
          .select(`
            *,
            assigned_user:assigned_to (name),
            qc_runs:qc_run_id (run_date, analyzer_name)
          `)
          .eq('lab_id', labId)
          .not('status', 'in', '("closed","cancelled")')
          .order('severity', { ascending: false })
          .limit(10),

        // Active drift alerts
        supabase
          .from('qc_drift_alerts')
          .select(`
            *,
            analytes:analyte_id (name)
          `)
          .eq('lab_id', labId)
          .eq('status', 'active')
          .order('severity', { ascending: false })
          .limit(10),

        // Expiring lots (within 30 days)
        supabase
          .from('v_qc_expiring_lots')
          .select('*')
          .eq('lab_id', labId)
          .order('days_until_expiry', { ascending: true })
          .limit(10),

        // Pending tasks
        supabase
          .from('qc_tasks')
          .select(`
            *,
            assigned_user:assigned_to (name)
          `)
          .eq('lab_id', labId)
          .in('status', ['pending', 'in_progress'])
          .order('priority', { ascending: false })
          .order('due_date', { ascending: true })
          .limit(10),

        // EQC pending review
        supabase
          .from('eqc_results')
          .select(`
            *,
            eqc_programs!inner (program_name, provider, lab_id),
            analytes:analyte_id (name)
          `)
          .eq('eqc_programs.lab_id', labId)
          .eq('status', 'pending')
          .order('created_at', { ascending: false })
          .limit(10),

        // Westgard violation breakdown (last 30 days)
        supabase
          .from('qc_results')
          .select('westgard_flags, created_at')
          .eq('pass_fail', 'fail')
          .gte('created_at', weekAgoStr)
      ]);

      // Process today's stats
      let todayStats: QCDashboardStats = {
        passRate: 0,
        totalRuns: 0,
        passedRuns: 0,
        failedRuns: 0,
        pendingReview: 0,
        runDate: today
      };

      if (todayStatsResult.data) {
        const ts = todayStatsResult.data;
        todayStats = {
          passRate: ts.pass_rate || 0,
          totalRuns: ts.total_runs || 0,
          passedRuns: ts.passed_runs || 0,
          failedRuns: ts.failed_runs || 0,
          pendingReview: ts.pending_review || 0,
          runDate: ts.run_date
        };
      }

      // Process weekly trend
      const weeklyTrend: QCDashboardStats[] = (weeklyTrendResult.data || []).map((day: any) => ({
        passRate: day.pass_rate || 0,
        totalRuns: day.total_runs || 0,
        passedRuns: day.passed_runs || 0,
        failedRuns: day.failed_runs || 0,
        pendingReview: day.pending_review || 0,
        runDate: day.run_date
      }));

      // Process investigations
      const openInvestigations: QCInvestigation[] = (investigationsResult.data || []).map((inv: any) => ({
        ...inv,
        assigned_to_name: inv.assigned_user?.name,
        run_date: inv.qc_runs?.run_date,
        analyzer_name: inv.qc_runs?.analyzer_name,
        is_overdue: inv.due_date && new Date(inv.due_date) < new Date() && inv.status !== 'closed'
      }));

      // Process alerts
      const activeAlerts: QCDriftAlert[] = (alertsResult.data || []).map((alert: any) => ({
        ...alert,
        analyte_name: alert.analytes?.name
      }));

      // Expiring lots
      const expiringLots: QCLot[] = lotsResult.data || [];

      // Pending tasks
      const pendingTasks: QCTask[] = (tasksResult.data || []).map((task: any) => ({
        ...task,
        assigned_to_name: task.assigned_user?.name,
        is_overdue: task.due_date && new Date(task.due_date) < new Date() && task.status === 'pending'
      }));

      // EQC pending
      const eqcPending: EQCResult[] = (eqcResult.data || []).map((result: any) => ({
        ...result,
        program_name: result.eqc_programs?.program_name,
        analyte_name: result.analytes?.name
      }));

      // Process violation breakdown
      const violationBreakdown: Record<string, number> = {};
      for (const result of violationsResult.data || []) {
        const flags = result.westgard_flags || [];
        for (const flag of flags) {
          violationBreakdown[flag] = (violationBreakdown[flag] || 0) + 1;
        }
      }

      const dashboardData: QCDashboardData = {
        todayStats,
        weeklyTrend,
        openInvestigations,
        activeAlerts,
        expiringLots,
        pendingTasks,
        eqcPending,
        violationBreakdown
      };

      setData(dashboardData);

    } catch (e) {
      console.error('Dashboard load error:', e);
      setError(e instanceof Error ? e.message : 'Failed to load dashboard data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [labId]);

  // Initial load
  useEffect(() => {
    if (labId) {
      loadDashboardData();
    }
  }, [labId, loadDashboardData]);

  // Set up real-time subscriptions
  useEffect(() => {
    if (!labId) return;

    // Subscribe to QC runs changes
    const runsSubscription = supabase
      .channel('qc_dashboard_runs')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'qc_runs',
          filter: `lab_id=eq.${labId}`
        },
        () => {
          loadDashboardData(true);
        }
      )
      .subscribe();

    // Subscribe to investigations changes
    const investigationsSubscription = supabase
      .channel('qc_dashboard_investigations')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'qc_investigations',
          filter: `lab_id=eq.${labId}`
        },
        () => {
          loadDashboardData(true);
        }
      )
      .subscribe();

    // Subscribe to drift alerts
    const alertsSubscription = supabase
      .channel('qc_dashboard_alerts')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'qc_drift_alerts',
          filter: `lab_id=eq.${labId}`
        },
        () => {
          loadDashboardData(true);
        }
      )
      .subscribe();

    return () => {
      runsSubscription.unsubscribe();
      investigationsSubscription.unsubscribe();
      alertsSubscription.unsubscribe();
    };
  }, [labId, loadDashboardData]);

  const refresh = useCallback(async () => {
    await loadDashboardData(true);
  }, [loadDashboardData]);

  return {
    data,
    todayStats: data?.todayStats || null,
    weeklyTrend: data?.weeklyTrend || [],
    openInvestigations: data?.openInvestigations || [],
    activeAlerts: data?.activeAlerts || [],
    expiringLots: data?.expiringLots || [],
    pendingTasks: data?.pendingTasks || [],
    eqcPending: data?.eqcPending || [],
    violationBreakdown: data?.violationBreakdown || {},
    loading,
    refreshing,
    error,
    refresh
  };
}

export default useQCDashboard;
