/**
 * Quality Control Page
 *
 * AI-First QC Management with NABL/ISO 15189:2022 Compliance
 *
 * Tabs:
 * - Dashboard: AI monitoring, alerts, statistics
 * - QC Runs: Daily QC execution with scan-first capture
 * - Investigations: CAPA tracking and management
 * - Lot Management: Control materials
 * - EQC Programs: External quality control
 * - Calibration: Equipment calibration records
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  LayoutDashboard,
  FlaskConical,
  Search,
  Package,
  Globe,
  SlidersHorizontal,
  RefreshCw,
  Plus,
  Camera,
  Upload,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Clock,
  TrendingUp,
  TrendingDown,
  AlertCircle,
  ChevronRight,
  ChevronDown,
  FileText,
  Loader2,
  Calendar,
  User,
  Target,
  Activity,
  BarChart3,
  Sparkles,
  Shield,
  ClipboardCheck,
  Zap,
  Eye,
  Edit2,
  MoreVertical,
  Filter,
  X,
  Save
} from 'lucide-react';
import { database, supabase } from '../utils/supabase';
import { useQCDashboard } from '../hooks/useQCDashboard';
import { useQualityControl } from '../hooks/useQualityControl';
import { QCRunCapture } from '../components/QC/QCRunCapture';
import { QCManualEntry } from '../components/QC/QCManualEntry';
import { QCRunDetails } from '../components/QC/QCRunDetails';
import { QCInvestigation as QCInvestigationPanel } from '../components/QC/QCInvestigation';
import type {
  QCRun,
  QCInvestigation,
  QCLot,
  QCTask,
  QCDriftAlert
} from '../types/qc';

type TabId = 'dashboard' | 'runs' | 'investigations' | 'lots' | 'eqc' | 'calibration';

interface InventoryLotLinkOption {
  id: string;
  name: string;
  code?: string | null;
  type?: string | null;
  qc_lot_id?: string | null;
  consumption_scope?: string | null;
  ai_category?: string | null;
}

interface Tab {
  id: TabId;
  name: string;
  icon: React.ElementType;
  description: string;
}

const tabs: Tab[] = [
  { id: 'dashboard', name: 'Dashboard', icon: LayoutDashboard, description: 'AI monitoring and alerts' },
  { id: 'runs', name: 'QC Runs', icon: FlaskConical, description: 'Daily QC execution' },
  { id: 'investigations', name: 'Investigations', icon: Search, description: 'CAPA tracking' },
  { id: 'lots', name: 'Lot Management', icon: Package, description: 'Control materials' },
  { id: 'eqc', name: 'EQC Programs', icon: Globe, description: 'External QC' },
  { id: 'calibration', name: 'Calibration', icon: SlidersHorizontal, description: 'Equipment calibration' },
];

const QualityControl: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabId>('dashboard');
  const [labId, setLabId] = useState<string>('');
  const [userId, setUserId] = useState<string>('');
  const [highlightedInvestigationId, setHighlightedInvestigationId] = useState<string | null>(null);

  // Clear highlight after 3 seconds
  useEffect(() => {
    if (highlightedInvestigationId) {
      const timer = setTimeout(() => {
        setHighlightedInvestigationId(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [highlightedInvestigationId]);

  // Get lab ID on mount
  useEffect(() => {
    const fetchUserInfo = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setUserId(user.id);
        const { data: userData } = await supabase
          .from('users')
          .select('lab_id')
          .eq('id', user.id)
          .single();

        if (userData?.lab_id) {
          setLabId(userData.lab_id);
        }
      }
    };
    fetchUserInfo();
  }, []);

  // Dashboard hook
  const dashboard = useQCDashboard(labId);

  // QC operations hook
  const qc = useQualityControl();

  const handleQCConsumption = async (runId: string) => {
    const { error } = await database.inventory.consumeQCRunItems({ runId });
    if (error) {
      console.warn('QC inventory consumption failed:', error);
    }
  };

  const renderTabContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return <DashboardTab 
          labId={labId} 
          dashboard={dashboard} 
          onNavigateToInvestigation={(invId) => {
            setHighlightedInvestigationId(invId);
            setActiveTab('investigations');
          }} 
        />;
      case 'runs':
        return <QCRunsTab labId={labId} qc={qc} onNavigateToInvestigation={(invId) => {
          setHighlightedInvestigationId(invId);
          setActiveTab('investigations');
        }} onQCConsumed={handleQCConsumption} />;
      case 'investigations':
        return <InvestigationsTab labId={labId} qc={qc} highlightedId={highlightedInvestigationId} />;
      case 'lots':
        return <LotManagementTab labId={labId} qc={qc} />;
      case 'eqc':
        return <EQCProgramsTab labId={labId} />;
      case 'calibration':
        return <CalibrationTab labId={labId} />;
      default:
        return null;
    }
  };

  if (!labId) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="py-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-indigo-100 rounded-lg">
                  <Shield className="h-6 w-6 text-indigo-600" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-gray-900">Quality Control</h1>
                  <p className="text-sm text-gray-500">AI-First QC with NABL/ISO 15189:2022 Compliance</p>
                </div>
              </div>
              <div className="flex items-center space-x-3">
                <button
                  onClick={() => dashboard.refresh()}
                  disabled={dashboard.refreshing}
                  className="inline-flex items-center px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
                >
                  <RefreshCw className={`h-4 w-4 mr-2 ${dashboard.refreshing ? 'animate-spin' : ''}`} />
                  Refresh
                </button>
              </div>
            </div>

            {/* Tabs */}
            <div className="mt-6 border-b border-gray-200">
              <nav className="-mb-px flex space-x-8 overflow-x-auto">
                {tabs.map((tab) => {
                  const Icon = tab.icon;
                  const isActive = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={`
                        whitespace-nowrap pb-4 px-1 border-b-2 font-medium text-sm flex items-center space-x-2
                        ${isActive
                          ? 'border-indigo-500 text-indigo-600'
                          : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                        }
                      `}
                    >
                      <Icon className="h-5 w-5" />
                      <span>{tab.name}</span>
                    </button>
                  );
                })}
              </nav>
            </div>
          </div>
        </div>
      </div>

      {/* Tab Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {renderTabContent()}
      </div>
    </div>
  );
};

// ============================================
// Dashboard Tab Component
// ============================================
const DashboardTab: React.FC<{
  labId: string;
  dashboard: ReturnType<typeof useQCDashboard>;
  onNavigateToInvestigation?: (invId: string) => void;
}> = ({ labId, dashboard, onNavigateToInvestigation }) => {
  const {
    todayStats,
    weeklyTrend,
    openInvestigations,
    activeAlerts,
    expiringLots,
    pendingTasks,
    loading
  } = dashboard;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          title="Today's Pass Rate"
          value={`${todayStats?.passRate?.toFixed(1) || 0}%`}
          subtitle={`${todayStats?.passedRuns || 0} of ${todayStats?.totalRuns || 0} runs`}
          icon={Target}
          color={todayStats?.passRate && todayStats.passRate >= 95 ? 'green' : todayStats?.passRate && todayStats.passRate >= 80 ? 'yellow' : 'red'}
        />
        <StatCard
          title="Open Investigations"
          value={openInvestigations.length.toString()}
          subtitle={`${openInvestigations.filter(i => i.severity === 'critical').length} critical`}
          icon={Search}
          color={openInvestigations.length > 0 ? 'yellow' : 'green'}
        />
        <StatCard
          title="Active Alerts"
          value={activeAlerts.length.toString()}
          subtitle={`${activeAlerts.filter(a => a.severity === 'critical').length} critical`}
          icon={AlertTriangle}
          color={activeAlerts.length > 0 ? 'red' : 'green'}
        />
        <StatCard
          title="Pending Tasks"
          value={pendingTasks.length.toString()}
          subtitle={`${pendingTasks.filter(t => t.priority === 'urgent').length} urgent`}
          icon={ClipboardCheck}
          color={pendingTasks.length > 0 ? 'blue' : 'green'}
        />
      </div>

      {/* Charts and Lists */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Weekly Trend */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <TrendingUp className="h-5 w-5 mr-2 text-indigo-600" />
            Weekly Pass Rate Trend
          </h3>
          <div className="h-48 flex items-end space-x-2">
            {weeklyTrend.map((day, idx) => (
              <div key={idx} className="flex-1 flex flex-col items-center">
                <div
                  className={`w-full rounded-t transition-all ${
                    day.passRate >= 95 ? 'bg-green-500' :
                    day.passRate >= 80 ? 'bg-yellow-500' : 'bg-red-500'
                  }`}
                  style={{ height: `${Math.max(day.passRate, 10)}%` }}
                />
                <div className="text-xs text-gray-500 mt-2">
                  {new Date(day.runDate).toLocaleDateString('en-US', { weekday: 'short' })}
                </div>
                <div className="text-xs font-medium">{day.passRate.toFixed(0)}%</div>
              </div>
            ))}
            {weeklyTrend.length === 0 && (
              <div className="flex-1 flex items-center justify-center text-gray-400">
                No data available
              </div>
            )}
          </div>
        </div>

        {/* Active Alerts */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <AlertCircle className="h-5 w-5 mr-2 text-red-600" />
            Active Drift Alerts
          </h3>
          <div className="space-y-3 max-h-48 overflow-y-auto">
            {activeAlerts.length === 0 ? (
              <div className="text-center py-4 text-gray-500">
                <CheckCircle className="h-8 w-8 mx-auto mb-2 text-green-500" />
                No active alerts
              </div>
            ) : (
              activeAlerts.slice(0, 5).map((alert) => (
                <div
                  key={alert.id}
                  className={`p-3 rounded-lg border ${
                    alert.severity === 'critical' ? 'bg-red-50 border-red-200' :
                    alert.severity === 'warning' ? 'bg-yellow-50 border-yellow-200' :
                    'bg-blue-50 border-blue-200'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-medium text-sm">{alert.title}</div>
                      <div className="text-xs text-gray-600 mt-1">{alert.description.slice(0, 100)}...</div>
                    </div>
                    <span className={`text-xs font-medium px-2 py-1 rounded ${
                      alert.severity === 'critical' ? 'bg-red-100 text-red-700' :
                      alert.severity === 'warning' ? 'bg-yellow-100 text-yellow-700' :
                      'bg-blue-100 text-blue-700'
                    }`}>
                      {alert.severity}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Investigations and Tasks */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Open Investigations */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <Search className="h-5 w-5 mr-2 text-indigo-600" />
            Open Investigations
          </h3>
          <div className="space-y-3 max-h-64 overflow-y-auto">
            {openInvestigations.length === 0 ? (
              <div className="text-center py-4 text-gray-500">
                <CheckCircle className="h-8 w-8 mx-auto mb-2 text-green-500" />
                No open investigations
              </div>
            ) : (
              openInvestigations.slice(0, 5).map((inv) => (
                <div 
                  key={inv.id} 
                  className="p-3 bg-gray-50 rounded-lg hover:bg-gray-100 cursor-pointer transition-colors"
                  onClick={() => {
                    if (onNavigateToInvestigation) {
                      onNavigateToInvestigation(inv.id);
                      // Scroll to investigations tab after a short delay
                      setTimeout(() => {
                        const element = document.getElementById(`investigation-${inv.id}`);
                        element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      }, 100);
                    }
                  }}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="font-medium text-sm text-indigo-600">{inv.investigation_number}</div>
                      <div className="text-xs text-gray-600 mt-1">{inv.title}</div>
                      {inv.hold_patient_results && (
                        <span className="inline-flex items-center mt-1 text-xs text-red-600">
                          <AlertTriangle className="h-3 w-3 mr-1" />
                          Results on hold
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-medium px-2 py-1 rounded ${
                        inv.severity === 'critical' ? 'bg-red-100 text-red-700' :
                        inv.severity === 'high' ? 'bg-orange-100 text-orange-700' :
                        inv.severity === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                        'bg-gray-100 text-gray-700'
                      }`}>
                        {inv.severity}
                      </span>
                      <ChevronRight className="h-4 w-4 text-gray-400" />
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Pending Tasks */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <ClipboardCheck className="h-5 w-5 mr-2 text-indigo-600" />
            Pending Tasks
          </h3>
          <div className="space-y-3 max-h-64 overflow-y-auto">
            {pendingTasks.length === 0 ? (
              <div className="text-center py-4 text-gray-500">
                <CheckCircle className="h-8 w-8 mx-auto mb-2 text-green-500" />
                All tasks completed
              </div>
            ) : (
              pendingTasks.slice(0, 5).map((task) => (
                <div key={task.id} className="p-3 bg-gray-50 rounded-lg hover:bg-gray-100 cursor-pointer">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-medium text-sm">{task.title}</div>
                      <div className="text-xs text-gray-600 mt-1">
                        {task.task_type.replace(/_/g, ' ')}
                        {task.due_date && ` • Due: ${new Date(task.due_date).toLocaleDateString()}`}
                      </div>
                    </div>
                    <span className={`text-xs font-medium px-2 py-1 rounded ${
                      task.priority === 'urgent' ? 'bg-red-100 text-red-700' :
                      task.priority === 'high' ? 'bg-orange-100 text-orange-700' :
                      task.priority === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                      'bg-gray-100 text-gray-700'
                    }`}>
                      {task.priority}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Expiring Lots Warning */}
      {expiringLots.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-6">
          <h3 className="text-lg font-semibold text-yellow-800 mb-4 flex items-center">
            <Clock className="h-5 w-5 mr-2" />
            Lots Expiring Soon
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {expiringLots.slice(0, 6).map((lot) => (
              <div key={lot.id} className="bg-white p-3 rounded-lg border border-yellow-300">
                <div className="font-medium text-sm">{lot.lot_number}</div>
                <div className="text-xs text-gray-600">{lot.material_name} {lot.level}</div>
                <div className={`text-xs mt-1 font-medium ${
                  (lot.days_until_expiry || 0) <= 7 ? 'text-red-600' : 'text-yellow-600'
                }`}>
                  {lot.days_until_expiry} days remaining
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// Stat Card Component
const StatCard: React.FC<{
  title: string;
  value: string;
  subtitle: string;
  icon: React.ElementType;
  color: 'green' | 'yellow' | 'red' | 'blue';
}> = ({ title, value, subtitle, icon: Icon, color }) => {
  const colorClasses = {
    green: 'bg-green-50 text-green-600 border-green-200',
    yellow: 'bg-yellow-50 text-yellow-600 border-yellow-200',
    red: 'bg-red-50 text-red-600 border-red-200',
    blue: 'bg-blue-50 text-blue-600 border-blue-200'
  };

  const iconColorClasses = {
    green: 'text-green-600',
    yellow: 'text-yellow-600',
    red: 'text-red-600',
    blue: 'text-blue-600'
  };

  return (
    <div className={`rounded-xl border p-6 ${colorClasses[color]}`}>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium text-gray-600">{title}</div>
          <div className="text-3xl font-bold mt-1">{value}</div>
          <div className="text-xs text-gray-500 mt-1">{subtitle}</div>
        </div>
        <Icon className={`h-10 w-10 ${iconColorClasses[color]}`} />
      </div>
    </div>
  );
};

// ============================================
// QC Runs Tab Component
// ============================================
const QCRunsTab: React.FC<{
  labId: string;
  qc: ReturnType<typeof useQualityControl>;
  onNavigateToInvestigation?: (investigationId: string) => void;
  onQCConsumed?: (runId: string) => Promise<void>;
}> = ({ labId, qc, onNavigateToInvestigation, onQCConsumed }) => {
  const [runs, setRuns] = useState<QCRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [showScanModal, setShowScanModal] = useState(false);
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [dateFilter, setDateFilter] = useState(new Date().toISOString().split('T')[0]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  useEffect(() => {
    loadRuns();
  }, [labId, dateFilter]);

  const loadRuns = async () => {
    setLoading(true);
    const data = await qc.getQCRuns({
      labId,
      dateFrom: dateFilter,
      dateTo: dateFilter
    });
    setRuns(data);
    setLoading(false);
  };

  const handleScanComplete = (runId: string) => {
    setShowScanModal(false);
    onQCConsumed?.(runId).catch((err) => {
      console.warn('QC consumption failed after scan completion:', err);
    });
    loadRuns();
    setSelectedRunId(runId);
  };

  const handleViewRun = (runId: string) => {
    setSelectedRunId(runId);
  };

  const handleAIAnalysis = async (runId: string) => {
    const result = await qc.explainFailure(runId);
    if (result?.success) {
      loadRuns();
      // Navigate to investigations tab and highlight the new investigation
      if (result.investigation_id && onNavigateToInvestigation) {
        onNavigateToInvestigation(result.investigation_id);
      } else {
        alert('AI Analysis completed! Switching to Investigations tab...');
        setTimeout(() => {
          onNavigateToInvestigation?.('latest');
        }, 500);
      }
    } else {
      alert('AI Analysis failed. Please try again or create manual investigation.');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <input
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
          />
          <button
            onClick={loadRuns}
            className="p-2 text-gray-500 hover:text-gray-700"
          >
            <RefreshCw className={`h-5 w-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
        <div className="flex items-center space-x-3">
          <button
            onClick={() => setShowScanModal(true)}
            className="inline-flex items-center px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
          >
            <Camera className="h-4 w-4 mr-2" />
            Scan QC
          </button>
          <button
            onClick={() => setShowManualEntry(true)}
            className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
          >
            <Plus className="h-4 w-4 mr-2" />
            Manual Entry
          </button>
        </div>
      </div>

      {/* Runs List */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
          </div>
        ) : runs.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <FlaskConical className="h-12 w-12 mx-auto mb-4 text-gray-300" />
            <p>No QC runs for this date</p>
            <button
              onClick={() => setShowScanModal(true)}
              className="mt-4 inline-flex items-center px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
            >
              <Camera className="h-4 w-4 mr-2" />
              Scan First QC Run
            </button>
          </div>
        ) : (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Run</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Analyzer</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Results</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {runs.map((run) => (
                <tr key={run.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <div className="text-sm font-medium text-gray-900">
                      {run.run_date} {run.run_time || ''}
                    </div>
                    <div className="text-xs text-gray-500">Run #{run.run_number || 1}</div>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-900">{run.analyzer_name}</td>
                  <td className="px-6 py-4">
                    <span className="px-2 py-1 text-xs font-medium rounded bg-gray-100 text-gray-700">
                      {run.run_type?.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center space-x-2">
                      {run.results && (
                        <>
                          <span className="text-green-600 text-sm">
                            {run.results.filter((r: any) => r.pass_fail === 'pass').length} pass
                          </span>
                          <span className="text-gray-400">/</span>
                          <span className="text-red-600 text-sm">
                            {run.results.filter((r: any) => r.pass_fail === 'fail').length} fail
                          </span>
                        </>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 text-xs font-medium rounded ${
                      run.status === 'reviewed' ? 'bg-green-100 text-green-700' :
                      run.status === 'rejected' ? 'bg-red-100 text-red-700' :
                      run.status === 'completed' ? 'bg-blue-100 text-blue-700' :
                      'bg-yellow-100 text-yellow-700'
                    }`}>
                      {run.status}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => handleViewRun(run.id)}
                        className="p-1 text-gray-400 hover:text-gray-600"
                        title="View Details"
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleAIAnalysis(run.id)}
                        className="p-1 text-indigo-400 hover:text-indigo-600"
                        title="AI Analysis"
                      >
                        <Sparkles className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Scan QC Modal */}
      {showScanModal && (
        <QCRunCapture
          labId={labId}
          onComplete={handleScanComplete}
          onCancel={() => setShowScanModal(false)}
        />
      )}

      {/* Manual Entry Modal */}
      {showManualEntry && (
        <QCManualEntry
          labId={labId}
          onComplete={(runId) => {
            setShowManualEntry(false);
            onQCConsumed?.(runId).catch((err) => {
              console.warn('QC consumption failed after manual entry:', err);
            });
            loadRuns();
            setSelectedRunId(runId);
          }}
          onCancel={() => setShowManualEntry(false)}
        />
      )}

      {/* Run Details Modal */}
      {selectedRunId && (
        <QCRunDetails
          runId={selectedRunId}
          labId={labId}
          onClose={() => setSelectedRunId(null)}
        />
      )}
    </div>
  );
};

// ============================================
// Investigations Tab Component
// ============================================
const InvestigationsTab: React.FC<{
  labId: string;
  qc: ReturnType<typeof useQualityControl>;
  highlightedId?: string | null;
}> = ({ labId, qc, highlightedId }) => {
  const [investigations, setInvestigations] = useState<QCInvestigation[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedInvestigationId, setSelectedInvestigationId] = useState<string | null>(null);

  useEffect(() => {
    loadInvestigations();
  }, [labId]);

  useEffect(() => {
    if (highlightedId) {
      if (highlightedId === 'latest' && investigations.length > 0) {
        setSelectedInvestigationId(investigations[0].id);
      } else if (highlightedId !== 'latest') {
        setSelectedInvestigationId(highlightedId);
      }
    }
  }, [highlightedId, investigations]);

  const loadInvestigations = async () => {
    setLoading(true);
    const data = await qc.getInvestigations({ labId });
    setInvestigations(data);
    setLoading(false);
  };

  const handleViewInvestigation = (invId: string) => {
    setSelectedInvestigationId(invId);
  };

  const handleAIAnalysis = async (inv: QCInvestigation) => {
    if (!inv.qc_run_id) {
      alert('No QC run linked to this investigation');
      return;
    }
    const result = await qc.explainFailure(inv.qc_run_id);
    if (result?.success) {
      loadInvestigations();
      setSelectedInvestigationId(inv.id);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Investigations & CAPA</h2>
        <button
          onClick={loadInvestigations}
          className="inline-flex items-center px-3 py-2 text-sm text-gray-600 hover:text-gray-800"
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </button>
      </div>

      {selectedInvestigationId ? (
        <div className="space-y-4">
          <button
            onClick={() => setSelectedInvestigationId(null)}
            className="inline-flex items-center text-indigo-600 hover:text-indigo-800"
          >
            <ChevronRight className="h-4 w-4 mr-1 rotate-180" />
            Back to List
          </button>
          <QCInvestigationPanel
            investigationId={selectedInvestigationId}
            labId={labId}
            onClose={() => setSelectedInvestigationId(null)}
            onUpdate={loadInvestigations}
          />
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          {investigations.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <CheckCircle className="h-12 w-12 mx-auto mb-4 text-green-500" />
              <p>No open investigations</p>
              <p className="text-sm mt-2">Investigations are created automatically when QC runs fail</p>
            </div>
          ) : (
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Investigation</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Severity</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Assigned</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {investigations.map((inv) => (
                  <tr 
                    key={inv.id} 
                    id={`investigation-${inv.id}`}
                    className={`hover:bg-gray-50 cursor-pointer transition-colors ${
                      highlightedInvestigationId === inv.id ? 'bg-indigo-50 ring-2 ring-indigo-300' : ''
                    }`}
                    onClick={() => handleViewInvestigation(inv.id)}
                  >
                    <td className="px-6 py-4">
                      <div className="text-sm font-medium text-gray-900">{inv.investigation_number}</div>
                      <div className="text-xs text-gray-500">{inv.title}</div>
                      {inv.hold_patient_results && (
                        <span className="inline-flex items-center mt-1 text-xs text-red-600">
                          <AlertTriangle className="h-3 w-3 mr-1" />
                          Results on hold
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 text-xs font-medium rounded ${
                        inv.severity === 'critical' ? 'bg-red-100 text-red-700' :
                        inv.severity === 'high' ? 'bg-orange-100 text-orange-700' :
                        inv.severity === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                        'bg-gray-100 text-gray-700'
                      }`}>
                        {inv.severity}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 text-xs font-medium rounded ${
                        inv.status === 'closed' ? 'bg-green-100 text-green-700' :
                        inv.status === 'pending_review' ? 'bg-blue-100 text-blue-700' :
                        'bg-yellow-100 text-yellow-700'
                      }`}>
                        {inv.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900">
                      {inv.assigned_to_name || '-'}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center space-x-2" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => handleViewInvestigation(inv.id)}
                          className="p-1 text-gray-400 hover:text-gray-600"
                          title="View"
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleAIAnalysis(inv)}
                          className="p-1 text-indigo-400 hover:text-indigo-600"
                          title="AI Analysis"
                        >
                          <Sparkles className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
};

// ============================================
// Lot Management Tab Component
// ============================================
const LotManagementTab: React.FC<{
  labId: string;
  qc: ReturnType<typeof useQualityControl>;
}> = ({ labId, qc }) => {
  const [lots, setLots] = useState<QCLot[]>([]);
  const [inventoryItems, setInventoryItems] = useState<InventoryLotLinkOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingLot, setEditingLot] = useState<QCLot | null>(null);
  const [saving, setSaving] = useState(false);

  // Target values state
  const [showTargetModal, setShowTargetModal] = useState(false);
  const [targetLot, setTargetLot] = useState<QCLot | null>(null);
  const [targetValues, setTargetValues] = useState<Array<{
    analyte_id: string;
    analyte_name: string;
    target_mean: string;
    target_sd: string;
    unit: string;
  }>>([]);
  const [analytes, setAnalytes] = useState<Array<{ id: string; name: string; unit?: string }>>([]);
  const [savingTargets, setSavingTargets] = useState(false);

  // Form state
  const [lotNumber, setLotNumber] = useState('');
  const [materialName, setMaterialName] = useState('');
  const [manufacturer, setManufacturer] = useState('');
  const [level, setLevel] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [lotType, setLotType] = useState('iqc');
  const [analyzerName, setAnalyzerName] = useState('');
  const [selectedTestGroups, setSelectedTestGroups] = useState<string[]>([]);
  const [selectedInventoryItemId, setSelectedInventoryItemId] = useState('');

  // Test groups for selection
  const [testGroups, setTestGroups] = useState<Array<{ id: string; name: string; code?: string }>>([]);

  useEffect(() => {
    loadLots();
    loadTestGroups();
    loadInventoryItems();
  }, [labId]);

  const loadTestGroups = async () => {
    const { data } = await supabase
      .from('test_groups')
      .select('id, name, code')
      .eq('lab_id', labId)
      .eq('is_active', true)
      .order('name');
    setTestGroups(data || []);
  };

  const loadLots = async () => {
    setLoading(true);
    const data = await qc.getLots({ labId });
    setLots(data);
    setLoading(false);
  };

  const loadInventoryItems = async () => {
    const { data, error } = await supabase
      .from('inventory_items')
      .select('id, name, code, type, qc_lot_id, consumption_scope, ai_category')
      .eq('lab_id', labId)
      .eq('is_active', true)
      .order('name');

    if (error) {
      console.error('Failed to load inventory items for QC linking:', error);
      return;
    }

    setInventoryItems((data || []) as InventoryLotLinkOption[]);
  };

  const resetForm = () => {
    setLotNumber('');
    setMaterialName('');
    setManufacturer('');
    setLevel('');
    setExpiryDate('');
    setLotType('iqc');
    setAnalyzerName('');
    setSelectedTestGroups([]);
    setSelectedInventoryItemId('');
    setEditingLot(null);
  };

  const openAddModal = () => {
    resetForm();
    setShowAddModal(true);
  };

  const openEditModal = (lot: QCLot) => {
    const linkedInventoryItem = inventoryItems.find((item) => item.qc_lot_id === lot.id);
    setEditingLot(lot);
    setLotNumber(lot.lot_number);
    setMaterialName(lot.material_name);
    setManufacturer(lot.manufacturer || '');
    setLevel(lot.level || '');
    setExpiryDate(lot.expiry_date);
    setLotType(lot.lot_type || 'iqc');
    setAnalyzerName(lot.analyzer_name || '');
    setSelectedTestGroups(lot.test_group_ids || []);
    setSelectedInventoryItemId(linkedInventoryItem?.id || '');
    setShowAddModal(true);
  };

  const handleSaveLot = async () => {
    if (!lotNumber || !materialName || !expiryDate) {
      alert('Please fill in required fields');
      return;
    }

    if (selectedTestGroups.length === 0) {
      alert('Please select at least one test group');
      return;
    }

    setSaving(true);
    try {
      let savedLot: QCLot | null = null;

      if (editingLot) {
        savedLot = await qc.updateLot(editingLot.id, {
          lot_number: lotNumber,
          material_name: materialName,
          manufacturer,
          level,
          expiry_date: expiryDate,
          lot_type: lotType as any,
          analyzer_name: analyzerName || null,
          test_group_ids: selectedTestGroups
        });
      } else {
        savedLot = await qc.createLot({
          lab_id: labId,
          lot_number: lotNumber,
          material_name: materialName,
          manufacturer,
          level,
          expiry_date: expiryDate,
          lot_type: lotType as any,
          analyzer_name: analyzerName || null,
          test_group_ids: selectedTestGroups,
          is_active: true
        });
      }

      if (!savedLot) {
        throw new Error('QC lot save did not return a lot record');
      }

      const { error: clearLinkError } = await supabase
        .from('inventory_items')
        .update({
          qc_lot_id: null,
          updated_at: new Date().toISOString(),
        })
        .eq('lab_id', labId)
        .eq('qc_lot_id', savedLot.id);

      if (clearLinkError) {
        throw clearLinkError;
      }

      if (selectedInventoryItemId) {
        const { error: linkError } = await database.inventory.linkQCLot(selectedInventoryItemId, savedLot.id);
        if (linkError) {
          throw linkError;
        }
      }

      setShowAddModal(false);
      resetForm();
      loadLots();
      loadInventoryItems();
    } catch (e) {
      console.error(e);
      alert('Failed to save lot');
    } finally {
      setSaving(false);
    }
  };

  // Target Values Functions
  const openTargetValuesModal = async (lot: QCLot) => {
    setTargetLot(lot);
    setShowTargetModal(true);

    // Load analytes via lab_analytes table (multi-lab architecture)
    const { data: labAnalytesData, error: analyteError } = await supabase
      .from('lab_analytes')
      .select('analyte_id, analytes(id, name, unit)')
      .eq('lab_id', labId);

    console.log('📊 Loaded lab_analytes:', labAnalytesData?.length, 'records');
    if (analyteError) console.error('❌ Error loading analytes:', analyteError);

    // Map to analyte objects
    const analytesForLab = labAnalytesData
      ?.filter((la: any) => la.analytes)
      .map((la: any) => ({
        id: la.analytes.id,
        name: la.analytes.name,
        unit: la.analytes.unit || ''
      })) || [];

    console.log('📊 Total analytes:', analytesForLab.length);
    setAnalytes(analytesForLab);

    // Load existing target values for this lot
    const { data: existingTargets } = await supabase
      .from('qc_target_values')
      .select('*, analytes:analyte_id(name)')
      .eq('qc_lot_id', lot.id);

    if (existingTargets && existingTargets.length > 0) {
      setTargetValues(existingTargets.map((t: any) => ({
        analyte_id: t.analyte_id,
        analyte_name: t.analytes?.name || '',
        target_mean: t.target_mean?.toString() || '',
        target_sd: t.target_sd?.toString() || '',
        unit: t.unit || ''
      })));
    } else {
      setTargetValues([]);
    }
  };

  const addTargetRow = () => {
    setTargetValues([...targetValues, {
      analyte_id: '',
      analyte_name: '',
      target_mean: '',
      target_sd: '',
      unit: ''
    }]);
  };

  const updateTargetRow = (index: number, field: string, value: string) => {
    const updated = [...targetValues];
    (updated[index] as any)[field] = value;

    // If analyte selected, set name and unit
    if (field === 'analyte_id') {
      const analyte = analytes.find(a => a.id === value);
      if (analyte) {
        updated[index].analyte_name = analyte.name;
        updated[index].unit = analyte.unit || '';
      }
    }

    setTargetValues(updated);
  };

  const removeTargetRow = (index: number) => {
    setTargetValues(targetValues.filter((_, i) => i !== index));
  };

  const saveTargetValues = async () => {
    if (!targetLot) return;

    const validTargets = targetValues.filter(t =>
      t.analyte_id && t.target_mean && t.target_sd
    );

    if (validTargets.length === 0) {
      alert('Please add at least one target value');
      return;
    }

    setSavingTargets(true);
    try {
      // Delete existing targets for this lot
      await supabase
        .from('qc_target_values')
        .delete()
        .eq('qc_lot_id', targetLot.id);

      // Insert new targets
      const toInsert = validTargets.map(t => ({
        qc_lot_id: targetLot.id,
        analyte_id: t.analyte_id,
        target_mean: parseFloat(t.target_mean),
        target_sd: parseFloat(t.target_sd),
        unit: t.unit || null,
        source: 'manufacturer'
      }));

      const { error } = await supabase
        .from('qc_target_values')
        .insert(toInsert);

      if (error) throw error;

      setShowTargetModal(false);
      setTargetLot(null);
      setTargetValues([]);
      alert('Target values saved successfully!');
    } catch (e) {
      alert('Failed to save target values');
      console.error(e);
    } finally {
      setSavingTargets(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Lot Management</h2>
        <button
          onClick={openAddModal}
          className="inline-flex items-center px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
        >
          <Plus className="h-4 w-4 mr-2" />
          Add Lot
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {lots.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <Package className="h-12 w-12 mx-auto mb-4 text-gray-300" />
            <p>No QC lots configured</p>
            <button
              onClick={openAddModal}
              className="mt-4 inline-flex items-center px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add First Lot
            </button>
          </div>
        ) : (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
	              <tr>
	                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Lot Number</th>
	                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Material</th>
	                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Inventory Link</th>
	                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Analyzer</th>
	                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Test Groups</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Level</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Expiry</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
	              {lots.map((lot) => {
	                // Get test group names for display
	                const lotTestGroupNames = testGroups
	                  .filter(tg => lot.test_group_ids?.includes(tg.id))
	                  .map(tg => tg.name);
	                const linkedInventoryItem = inventoryItems.find((item) => item.qc_lot_id === lot.id);

	                return (
	                <tr key={lot.id} className="hover:bg-gray-50">
	                  <td className="px-6 py-4 text-sm font-medium text-gray-900">{lot.lot_number}</td>
	                  <td className="px-6 py-4 text-sm text-gray-900">{lot.material_name}</td>
	                  <td className="px-6 py-4 text-sm">
	                    {linkedInventoryItem ? (
	                      <div>
	                        <div className="font-medium text-gray-900">{linkedInventoryItem.name}</div>
	                        <div className="text-xs text-gray-500">
	                          {linkedInventoryItem.code || linkedInventoryItem.type || 'Linked inventory item'}
	                        </div>
	                      </div>
	                    ) : (
	                      <span className="text-xs text-amber-600">Not linked</span>
	                    )}
	                  </td>
	                  <td className="px-6 py-4 text-sm text-gray-900">{lot.analyzer_name || '-'}</td>
                  <td className="px-6 py-4">
                    {lotTestGroupNames.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {lotTestGroupNames.slice(0, 2).map((name, idx) => (
                          <span key={idx} className="px-2 py-0.5 text-xs bg-indigo-100 text-indigo-700 rounded">
                            {name}
                          </span>
                        ))}
                        {lotTestGroupNames.length > 2 && (
                          <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded">
                            +{lotTestGroupNames.length - 2} more
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400">Not assigned</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-900">{lot.level || '-'}</td>
                  <td className="px-6 py-4 text-sm text-gray-900">
                    {new Date(lot.expiry_date).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 text-xs font-medium rounded ${
                      lot.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'
                    }`}>
                      {lot.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => openEditModal(lot)}
                        className="p-1 text-gray-400 hover:text-gray-600"
                        title="Edit Lot"
                      >
                        <Edit2 className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => openTargetValuesModal(lot)}
                        className="p-1 text-indigo-400 hover:text-indigo-600"
                        title="Set Target Values (Mean ± SD)"
                      >
                        <Target className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Add/Edit Lot Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">
                {editingLot ? 'Edit QC Lot' : 'Add QC Lot'}
              </h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="p-2 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Lot Number *
                  </label>
                  <input
                    type="text"
                    value={lotNumber}
                    onChange={(e) => setLotNumber(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    placeholder="e.g., LOT-2026-001"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Lot Type *
                  </label>
                  <select
                    value={lotType}
                    onChange={(e) => setLotType(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  >
                    <option value="iqc">Internal QC</option>
                    <option value="calibrator">Calibrator</option>
                    <option value="control">Control</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Material Name *
                </label>
                <input
                  type="text"
                  value={materialName}
                  onChange={(e) => setMaterialName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  placeholder="e.g., Bio-Rad Control Level 1"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Manufacturer
                  </label>
                  <input
                    type="text"
                    value={manufacturer}
                    onChange={(e) => setManufacturer(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    placeholder="e.g., Bio-Rad"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Level
                  </label>
                  <input
                    type="text"
                    value={level}
                    onChange={(e) => setLevel(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    placeholder="e.g., Level 1, Normal"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Expiry Date *
                </label>
                <input
                  type="date"
                  value={expiryDate}
                  onChange={(e) => setExpiryDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
              </div>

	              <div>
	                <label className="block text-sm font-medium text-gray-700 mb-1">
	                  Analyzer Name
                </label>
                <input
                  type="text"
                  value={analyzerName}
                  onChange={(e) => setAnalyzerName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  placeholder="e.g., Roche Cobas c311, Sysmex XN-1000"
                />
	                <p className="mt-1 text-xs text-gray-500">Which analyzer is this QC lot used on?</p>
	              </div>

	              <div>
	                <label className="block text-sm font-medium text-gray-700 mb-1">
	                  Linked Inventory Item
	                </label>
	                <select
	                  value={selectedInventoryItemId}
	                  onChange={(e) => setSelectedInventoryItemId(e.target.value)}
	                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
	                >
	                  <option value="">No linked inventory item</option>
	                  {inventoryItems.map((item) => (
	                    <option key={item.id} value={item.id}>
	                      {item.name}
	                      {item.code ? ` (${item.code})` : ''}
	                      {item.qc_lot_id && item.qc_lot_id !== editingLot?.id ? ' - already linked' : ''}
	                    </option>
	                  ))}
	                </select>
	                <p className="mt-1 text-xs text-gray-500">
	                  Link the physical stock item used by this QC lot so QC runs can deduct inventory automatically.
	                </p>
	              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Test Groups * <span className="text-xs font-normal text-gray-500">(Select which tests this lot validates)</span>
                </label>
                <div className="border border-gray-300 rounded-lg p-3 max-h-48 overflow-y-auto">
                  {testGroups.length === 0 ? (
                    <p className="text-sm text-gray-500">No test groups available</p>
                  ) : (
                    <div className="space-y-2">
                      {testGroups.map((tg) => (
                        <label key={tg.id} className="flex items-center space-x-2 cursor-pointer hover:bg-gray-50 p-1 rounded">
                          <input
                            type="checkbox"
                            checked={selectedTestGroups.includes(tg.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedTestGroups([...selectedTestGroups, tg.id]);
                              } else {
                                setSelectedTestGroups(selectedTestGroups.filter(id => id !== tg.id));
                              }
                            }}
                            className="h-4 w-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500"
                          />
                          <span className="text-sm text-gray-900">{tg.name}</span>
                          {tg.code && <span className="text-xs text-gray-400">({tg.code})</span>}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
                {selectedTestGroups.length > 0 && (
                  <p className="mt-1 text-xs text-indigo-600">
                    {selectedTestGroups.length} test group{selectedTestGroups.length > 1 ? 's' : ''} selected
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end space-x-3 px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-2xl">
              <button
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 text-gray-600 hover:text-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveLot}
                disabled={saving}
                className="inline-flex items-center px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                {editingLot ? 'Update Lot' : 'Create Lot'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Target Values Modal */}
      {showTargetModal && targetLot && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">
                  Target Values (Mean ± SD)
                </h3>
                <p className="text-sm text-gray-500">
                  {targetLot.lot_number} - {targetLot.material_name} {targetLot.level && `(${targetLot.level})`}
                </p>
              </div>
              <button
                onClick={() => {
                  setShowTargetModal(false);
                  setTargetLot(null);
                  setTargetValues([]);
                }}
                className="p-2 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              <div className="mb-4 flex items-center justify-between">
                <p className="text-sm text-gray-600">
                  Define expected mean and standard deviation for each analyte measured with this lot.
                </p>
                <button
                  onClick={addTargetRow}
                  className="inline-flex items-center px-3 py-1.5 bg-indigo-100 text-indigo-700 rounded-lg hover:bg-indigo-200 text-sm"
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Add Analyte
                </button>
              </div>

              {targetValues.length === 0 ? (
                <div className="text-center py-8 text-gray-500 border-2 border-dashed border-gray-200 rounded-xl">
                  <Target className="h-10 w-10 mx-auto mb-3 text-gray-300" />
                  <p>No target values configured</p>
                  <button
                    onClick={addTargetRow}
                    className="mt-3 inline-flex items-center px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Add First Target
                  </button>
                </div>
              ) : (
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Analyte</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Target Mean</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Target SD</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Unit</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">±2SD Range</th>
                      <th className="px-4 py-3 w-12"></th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {targetValues.map((target, idx) => {
                      const mean = parseFloat(target.target_mean) || 0;
                      const sd = parseFloat(target.target_sd) || 0;
                      const low2sd = (mean - 2 * sd).toFixed(2);
                      const high2sd = (mean + 2 * sd).toFixed(2);

                      return (
                        <tr key={idx}>
                          <td className="px-4 py-3">
                            <select
                              value={target.analyte_id}
                              onChange={(e) => updateTargetRow(idx, 'analyte_id', e.target.value)}
                              className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                            >
                              <option value="">Select Analyte</option>
                              {analytes.map(a => (
                                <option key={a.id} value={a.id}>{a.name}</option>
                              ))}
                            </select>
                          </td>
                          <td className="px-4 py-3">
                            <input
                              type="number"
                              step="0.01"
                              value={target.target_mean}
                              onChange={(e) => updateTargetRow(idx, 'target_mean', e.target.value)}
                              className="w-24 px-2 py-1.5 border border-gray-300 rounded text-sm"
                              placeholder="Mean"
                            />
                          </td>
                          <td className="px-4 py-3">
                            <input
                              type="number"
                              step="0.01"
                              value={target.target_sd}
                              onChange={(e) => updateTargetRow(idx, 'target_sd', e.target.value)}
                              className="w-20 px-2 py-1.5 border border-gray-300 rounded text-sm"
                              placeholder="SD"
                            />
                          </td>
                          <td className="px-4 py-3">
                            <input
                              type="text"
                              value={target.unit}
                              onChange={(e) => updateTargetRow(idx, 'unit', e.target.value)}
                              className="w-20 px-2 py-1.5 border border-gray-300 rounded text-sm"
                              placeholder="Unit"
                            />
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600">
                            {target.target_mean && target.target_sd ? (
                              <span className="font-mono">{low2sd} - {high2sd}</span>
                            ) : '-'}
                          </td>
                          <td className="px-4 py-3">
                            <button
                              onClick={() => removeTargetRow(idx)}
                              className="p-1 text-red-400 hover:text-red-600"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            <div className="flex items-center justify-end space-x-3 px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-2xl">
              <button
                onClick={() => {
                  setShowTargetModal(false);
                  setTargetLot(null);
                  setTargetValues([]);
                }}
                className="px-4 py-2 text-gray-600 hover:text-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={saveTargetValues}
                disabled={savingTargets || targetValues.length === 0}
                className="inline-flex items-center px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
              >
                {savingTargets ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                Save Target Values
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================
// EQC Programs Tab Component
// ============================================
const EQCProgramsTab: React.FC<{ labId: string }> = ({ labId }) => {
  const [showAddModal, setShowAddModal] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">External QC Programs</h2>
        <button
          onClick={() => setShowAddModal(true)}
          className="inline-flex items-center px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
        >
          <Plus className="h-4 w-4 mr-2" />
          Add EQC Program
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12">
        <div className="text-center text-gray-500">
          <Globe className="h-12 w-12 mx-auto mb-4 text-gray-300" />
          <p className="text-lg font-medium">External Quality Control Programs</p>
          <p className="mt-2 text-sm">Track and manage EQC/EQAS program results from organizations like RIQAS, CAP, etc.</p>
          <button
            onClick={() => setShowAddModal(true)}
            className="mt-4 inline-flex items-center px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add First EQC Program
          </button>
        </div>
      </div>

      {/* Add EQC Program Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">Add EQC Program</h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="p-2 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Program Name *</label>
                <input
                  type="text"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  placeholder="e.g., RIQAS Chemistry"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Provider *</label>
                <input
                  type="text"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  placeholder="e.g., Randox, CAP, EQAS"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Enrollment Date</label>
                  <input type="date" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Frequency</label>
                  <select className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                    <option>Monthly</option>
                    <option>Bi-Monthly</option>
                    <option>Quarterly</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end space-x-3 px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-2xl">
              <button
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 text-gray-600 hover:text-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  alert('EQC Program feature coming soon!');
                  setShowAddModal(false);
                }}
                className="inline-flex items-center px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
              >
                <Save className="h-4 w-4 mr-2" />
                Add Program
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================
// Calibration Tab Component
// ============================================
const CalibrationTab: React.FC<{ labId: string }> = ({ labId }) => {
  const [showAddModal, setShowAddModal] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Calibration Records</h2>
        <button
          onClick={() => setShowAddModal(true)}
          className="inline-flex items-center px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
        >
          <Plus className="h-4 w-4 mr-2" />
          Add Calibration
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12">
        <div className="text-center text-gray-500">
          <SlidersHorizontal className="h-12 w-12 mx-auto mb-4 text-gray-300" />
          <p className="text-lg font-medium">Equipment Calibration Records</p>
          <p className="mt-2 text-sm">Track calibration schedules, verification, and maintenance records</p>
          <button
            onClick={() => setShowAddModal(true)}
            className="mt-4 inline-flex items-center px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add First Calibration Record
          </button>
        </div>
      </div>

      {/* Add Calibration Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">Add Calibration Record</h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="p-2 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Analyzer Name *</label>
                <input
                  type="text"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  placeholder="e.g., Roche Cobas c311"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Calibration Type *</label>
                  <select className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                    <option>Full Calibration</option>
                    <option>Verification</option>
                    <option>Adjustment</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Date *</label>
                  <input type="date" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Calibrator Lot</label>
                <input
                  type="text"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  placeholder="e.g., CAL-2026-001"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Status *</label>
                <select className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                  <option>Pass</option>
                  <option>Fail</option>
                  <option>Pending Review</option>
                </select>
              </div>
            </div>

            <div className="flex items-center justify-end space-x-3 px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-2xl">
              <button
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 text-gray-600 hover:text-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  alert('Calibration feature coming soon!');
                  setShowAddModal(false);
                }}
                className="inline-flex items-center px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
              >
                <Save className="h-4 w-4 mr-2" />
                Add Record
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default QualityControl;
