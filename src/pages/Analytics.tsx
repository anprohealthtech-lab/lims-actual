import React, { useState, useEffect, useCallback } from 'react';
import {
  BarChart3,
  TrendingUp,
  Clock,
  AlertTriangle,
  TestTube,
  IndianRupee,
  ShoppingCart,
  FileText,
  Activity,
  Percent,
  Phone,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { database } from '../utils/supabase';
import type {
  KpiSummary,
  RevenueDaily,
  DepartmentStats,
  StatusDistribution,
  TestPopularity,
  TatSummary,
  LocationPerformance,
  AccountPerformance,
  OutsourcedSummary,
  CriticalAlert,
  PatientDemographic,
  PaymentMethodStats,
} from '../utils/supabase';
import {
  StatCard,
  DonutChart,
  AreaLineChart,
  BarChartComponent,
  AnalyticsFilters,
  DataTable,
  TatGauge,
} from '../components/Analytics';

type TabId = 'overview' | 'revenue' | 'operations' | 'tests' | 'tat' | 'critical';

interface FiltersState {
  dateRange: { from: Date; to: Date };
  locationId: string | null;
  department: string | null;
  accountId: string | null;
}

const Analytics: React.FC = () => {
  useAuth(); // For auth context
  const [labId, setLabId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [isLoading, setIsLoading] = useState(true);
  const [filters, setFilters] = useState<FiltersState>(() => {
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    const from = new Date(today);
    from.setDate(from.getDate() - 7);
    from.setHours(0, 0, 0, 0);
    return {
      dateRange: { from, to: today },
      locationId: null,
      department: null,
      accountId: null,
    };
  });

  // Data states
  const [kpiTotals, setKpiTotals] = useState<KpiSummary | null>(null);
  const [revenueDaily, setRevenueDaily] = useState<RevenueDaily[]>([]);
  const [departmentStats, setDepartmentStats] = useState<DepartmentStats[]>([]);
  const [statusDistribution, setStatusDistribution] = useState<StatusDistribution[]>([]);
  const [testPopularity, setTestPopularity] = useState<TestPopularity[]>([]);
  const [tatSummary, setTatSummary] = useState<TatSummary[]>([]);
  const [locationPerformance, setLocationPerformance] = useState<LocationPerformance[]>([]);
  const [accountPerformance, setAccountPerformance] = useState<AccountPerformance[]>([]);
  const [outsourcedSummary, setOutsourcedSummary] = useState<OutsourcedSummary[]>([]);
  const [criticalAlerts, setCriticalAlerts] = useState<CriticalAlert[]>([]);
  const [demographics, setDemographics] = useState<PatientDemographic[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodStats[]>([]);

  useEffect(() => {
    const fetchLabId = async () => {
      const id = await database.getCurrentUserLabId();
      setLabId(id);
    };
    fetchLabId();
  }, []);

  const loadData = useCallback(async () => {
    if (!labId) return;

    setIsLoading(true);

    // ✅ Apply location filtering for access control
    const { shouldFilter, locationIds } = await database.shouldFilterByLocation();

    // Validate and restrict location_id if user has limited access
    let effectiveLocationId = filters.locationId || undefined;
    if (shouldFilter && locationIds.length > 0) {
      // If user selected a location, ensure it's in their allowed list
      if (filters.locationId && !locationIds.includes(filters.locationId)) {
        // User tried to select unauthorized location, default to first assigned
        effectiveLocationId = locationIds[0];
      } else if (!filters.locationId) {
        // No selection, default to first assigned location
        effectiveLocationId = locationIds[0];
      }
    }

    const analyticsFilters = {
      lab_id: labId,
      date_range: filters.dateRange,
      location_id: effectiveLocationId,
      department: filters.department || undefined,
      account_id: filters.accountId || undefined,
    };

    try {
      // Load data based on active tab
      const [
        kpiRes,
        revenueRes,
        deptRes,
        statusRes,
        testsRes,
        tatRes,
        locRes,
        accRes,
        outRes,
        critRes,
        demoRes,
        payRes,
      ] = await Promise.all([
        (database as any).analytics.getKpiTotals(analyticsFilters),
        (database as any).analytics.getRevenueDaily(analyticsFilters),
        (database as any).analytics.getOrdersByDepartment(analyticsFilters),
        (database as any).analytics.getOrdersByStatus(analyticsFilters),
        (database as any).analytics.getTestPopularity(analyticsFilters, 10),
        (database as any).analytics.getTatSummary(analyticsFilters),
        (database as any).analytics.getLocationPerformance(analyticsFilters),
        (database as any).analytics.getAccountPerformance(analyticsFilters),
        (database as any).analytics.getOutsourcedSummary(analyticsFilters),
        (database as any).analytics.getCriticalAlerts(analyticsFilters),
        (database as any).analytics.getPatientDemographics(analyticsFilters),
        (database as any).analytics.getPaymentMethods(analyticsFilters),
      ]);

      setKpiTotals(kpiRes.data);
      setRevenueDaily(revenueRes.data || []);
      setDepartmentStats(deptRes.data || []);
      setStatusDistribution(statusRes.data || []);
      setTestPopularity(testsRes.data || []);
      setTatSummary(tatRes.data || []);
      setLocationPerformance(locRes.data || []);
      setAccountPerformance(accRes.data || []);
      setOutsourcedSummary(outRes.data || []);
      setCriticalAlerts(critRes.data || []);
      setDemographics(demoRes.data || []);
      setPaymentMethods(payRes.data || []);
    } catch (error) {
      console.error('Error loading analytics data:', error);
    } finally {
      setIsLoading(false);
    }
  }, [labId, filters]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const tabs: { id: TabId; label: string; icon: React.ElementType }[] = [
    { id: 'overview', label: 'Overview', icon: BarChart3 },
    { id: 'revenue', label: 'Revenue', icon: IndianRupee },
    { id: 'operations', label: 'Operations', icon: Activity },
    { id: 'tests', label: 'Tests & Departments', icon: TestTube },
    { id: 'tat', label: 'TAT & Quality', icon: Clock },
    { id: 'critical', label: 'Critical Alerts', icon: AlertTriangle },
  ];

  const formatCurrency = (value: number) => `₹${value.toLocaleString('en-IN')}`;

  // Aggregate department data for charts
  const aggregatedDeptData = React.useMemo(() => {
    const grouped: Record<string, { department: string; order_count: number; revenue: number }> = {};
    departmentStats.forEach((d) => {
      if (!grouped[d.department]) {
        grouped[d.department] = { department: d.department, order_count: 0, revenue: 0 };
      }
      grouped[d.department].order_count += d.order_count;
      grouped[d.department].revenue += d.revenue;
    });
    return Object.values(grouped);
  }, [departmentStats]);

  // Aggregate status data for donut chart
  const aggregatedStatusData = React.useMemo(() => {
    const grouped: Record<string, { status: string; count: number }> = {};
    statusDistribution.forEach((s) => {
      if (!grouped[s.status]) {
        grouped[s.status] = { status: s.status, count: 0 };
      }
      grouped[s.status].count += s.count;
    });
    return Object.values(grouped).map((s) => ({
      name: s.status,
      value: s.count,
    }));
  }, [statusDistribution]);

  // Aggregate payment method data
  const aggregatedPaymentData = React.useMemo(() => {
    const grouped: Record<string, { method: string; amount: number }> = {};
    paymentMethods.forEach((p) => {
      const method = p.payment_method || 'Unknown';
      if (!grouped[method]) {
        grouped[method] = { method, amount: 0 };
      }
      grouped[method].amount += p.total_amount;
    });
    return Object.values(grouped).map((p) => ({
      name: p.method.charAt(0).toUpperCase() + p.method.slice(1),
      value: p.amount,
    }));
  }, [paymentMethods]);

  // Revenue trend data for line chart
  const revenueTrendData = React.useMemo(() => {
    return revenueDaily.slice(0, 30).reverse().map((d) => ({
      date: new Date(d.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
      revenue: d.net_revenue,
      collected: d.cash_collected + d.card_collected + d.upi_collected,
    }));
  }, [revenueDaily]);

  // Calculate average TAT
  const avgTat = React.useMemo(() => {
    if (tatSummary.length === 0) return 0;
    const total = tatSummary.reduce((sum, t) => sum + (t.avg_tat_hours || 0), 0);
    return total / tatSummary.length;
  }, [tatSummary]);

  const avgTargetTat = React.useMemo(() => {
    if (tatSummary.length === 0) return 24;
    const total = tatSummary.reduce((sum, t) => sum + (t.target_tat || 24), 0);
    return total / tatSummary.length;
  }, [tatSummary]);

  if (!labId) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Analytics Dashboard</h1>
        <p className="text-gray-500 text-sm mt-1">
          Comprehensive insights into your lab's performance
        </p>
      </div>

      {/* Filters */}
      <AnalyticsFilters
        labId={labId}
        filters={filters}
        onFiltersChange={setFilters}
        onRefresh={loadData}
        isLoading={isLoading}
      />

      {/* Tab Navigation */}
      <div className="bg-white rounded-xl border border-gray-200 mb-6">
        <div className="flex overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-6 py-4 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${activeTab === tab.id
                  ? 'border-blue-600 text-blue-600 bg-blue-50/50'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                }`}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div className="space-y-6">
        {/* OVERVIEW TAB */}
        {activeTab === 'overview' && (
          <>
            {/* KPI Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4">
              <StatCard
                title="Total Revenue"
                value={formatCurrency(kpiTotals?.total_revenue || 0)}
                icon={IndianRupee}
                color="green"
              />
              <StatCard
                title="Total Orders"
                value={kpiTotals?.total_orders || 0}
                icon={ShoppingCart}
                color="blue"
              />
              <StatCard
                title="Avg Order Value"
                value={formatCurrency(kpiTotals?.avg_order_value || 0)}
                icon={TrendingUp}
                color="purple"
              />
              <StatCard
                title="Samples Collected"
                value={kpiTotals?.samples_collected || 0}
                icon={TestTube}
                color="indigo"
              />
              <StatCard
                title="Reports Generated"
                value={kpiTotals?.reports_generated || 0}
                icon={FileText}
                color="green"
              />
              <StatCard
                title="Pending Reports"
                value={kpiTotals?.pending_reports || 0}
                icon={Clock}
                color="yellow"
              />
              <StatCard
                title="Critical Results"
                value={kpiTotals?.critical_results || 0}
                icon={AlertTriangle}
                color="red"
              />
              <StatCard
                title="TAT Breaches"
                value={kpiTotals?.tat_breaches || 0}
                icon={Clock}
                color="orange"
              />
            </div>

            {/* Charts Row 1 */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2">
                <AreaLineChart
                  data={revenueTrendData}
                  xAxisKey="date"
                  series={[
                    { key: 'revenue', name: 'Revenue', color: '#3B82F6' },
                    { key: 'collected', name: 'Collected', color: '#10B981' },
                  ]}
                  title="Revenue Trend"
                  height={280}
                />
              </div>
              <DonutChart
                data={aggregatedStatusData}
                title="Order Status Distribution"
                height={220}
              />
            </div>

            {/* Charts Row 2 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <BarChartComponent
                data={aggregatedDeptData}
                xAxisKey="department"
                series={[{ key: 'order_count', name: 'Orders', color: '#8B5CF6' }]}
                title="Orders by Department"
                height={250}
              />
              <DonutChart
                data={aggregatedPaymentData}
                title="Revenue by Payment Method"
                height={200}
                formatValue={formatCurrency}
              />
            </div>
          </>
        )}

        {/* REVENUE TAB */}
        {activeTab === 'revenue' && (
          <>
            {/* Revenue KPIs */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard
                title="Gross Revenue"
                value={formatCurrency(revenueDaily.reduce((s, r) => s + r.gross_revenue, 0))}
                icon={IndianRupee}
                color="green"
              />
              <StatCard
                title="Total Discounts"
                value={formatCurrency(revenueDaily.reduce((s, r) => s + r.discounts, 0))}
                icon={Percent}
                color="orange"
              />
              <StatCard
                title="Net Revenue"
                value={formatCurrency(revenueDaily.reduce((s, r) => s + r.net_revenue, 0))}
                icon={TrendingUp}
                color="blue"
              />
              <StatCard
                title="Outstanding"
                value={formatCurrency(revenueDaily.reduce((s, r) => s + r.credit_outstanding, 0))}
                icon={Clock}
                color="red"
              />
            </div>

            {/* Revenue Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <AreaLineChart
                data={revenueTrendData}
                xAxisKey="date"
                series={[{ key: 'revenue', name: 'Net Revenue', color: '#3B82F6' }]}
                title="Daily Revenue Trend"
                height={300}
              />
              <DonutChart
                data={aggregatedPaymentData}
                title="Collection by Payment Method"
                height={240}
                formatValue={formatCurrency}
              />
            </div>

            {/* Revenue Table */}
            <DataTable
              data={revenueDaily.slice(0, 30)}
              title="Daily Revenue Breakdown"
              columns={[
                {
                  key: 'date',
                  header: 'Date',
                  render: (v: any) => new Date(v).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
                },
                { key: 'location_name', header: 'Location' },
                { key: 'gross_revenue', header: 'Gross', align: 'right', render: (v: any) => formatCurrency(v) },
                { key: 'discounts', header: 'Discounts', align: 'right', render: (v: any) => formatCurrency(v) },
                { key: 'net_revenue', header: 'Net', align: 'right', render: (v: any) => formatCurrency(v) },
                { key: 'cash_collected', header: 'Cash', align: 'right', render: (v: any) => formatCurrency(v) },
                { key: 'credit_outstanding', header: 'Outstanding', align: 'right', render: (v: any) => formatCurrency(v) },
                { key: 'order_count', header: 'Orders', align: 'center' },
              ]}
            />
          </>
        )}

        {/* OPERATIONS TAB */}
        {activeTab === 'operations' && (
          <>
            {/* Location Performance */}
            <h3 className="text-lg font-semibold text-gray-800 mb-4">Location Performance</h3>
            <DataTable
              data={locationPerformance}
              columns={[
                { key: 'location_name', header: 'Location' },
                { key: 'order_count', header: 'Orders', align: 'center' },
                { key: 'patient_count', header: 'Patients', align: 'center' },
                { key: 'revenue', header: 'Revenue', align: 'right', render: (v: any) => formatCurrency(v) },
                { key: 'collected', header: 'Collected', align: 'right', render: (v: any) => formatCurrency(v) },
                {
                  key: 'collection_efficiency',
                  header: 'Collection %',
                  align: 'center',
                  render: (v: any) => (
                    <span className={v >= 80 ? 'text-green-600' : v >= 50 ? 'text-yellow-600' : 'text-red-600'}>
                      {v?.toFixed(1)}%
                    </span>
                  ),
                },
                { key: 'sample_collection_rate', header: 'Sample Rate %', align: 'center', render: (v: any) => `${v?.toFixed(1)}%` },
              ]}
            />

            {/* Account Performance */}
            {accountPerformance.length > 0 && (
              <>
                <h3 className="text-lg font-semibold text-gray-800 mb-4 mt-8">B2B Account Performance</h3>
                <DataTable
                  data={accountPerformance}
                  columns={[
                    { key: 'account_name', header: 'Account' },
                    { key: 'account_type', header: 'Type' },
                    { key: 'order_count', header: 'Orders', align: 'center' },
                    { key: 'revenue', header: 'Revenue', align: 'right', render: (v: any) => formatCurrency(v) },
                    { key: 'outstanding_amount', header: 'Outstanding', align: 'right', render: (v: any) => formatCurrency(v) },
                    { key: 'avg_order_value', header: 'AOV', align: 'right', render: (v: any) => formatCurrency(v) },
                    { key: 'avg_payment_days', header: 'Avg Payment Days', align: 'center' },
                  ]}
                />
              </>
            )}

            {/* Outsourced Summary */}
            {outsourcedSummary.length > 0 && (
              <>
                <h3 className="text-lg font-semibold text-gray-800 mb-4 mt-8">Outsourced Lab Summary</h3>
                <DataTable
                  data={outsourcedSummary}
                  columns={[
                    { key: 'outsourced_lab_name', header: 'Lab Name' },
                    { key: 'test_count', header: 'Tests', align: 'center' },
                    { key: 'cost', header: 'Cost', align: 'right', render: (v: any) => formatCurrency(v) },
                    { key: 'revenue', header: 'Revenue', align: 'right', render: (v: any) => formatCurrency(v) },
                    { key: 'margin', header: 'Margin', align: 'right', render: (v: any) => formatCurrency(v) },
                    {
                      key: 'margin_percentage',
                      header: 'Margin %',
                      align: 'center',
                      render: (v: any) => (
                        <span className={v >= 30 ? 'text-green-600' : v >= 15 ? 'text-yellow-600' : 'text-red-600'}>
                          {v?.toFixed(1)}%
                        </span>
                      ),
                    },
                    { key: 'pending_results', header: 'Pending', align: 'center' },
                    { key: 'avg_tat_hours', header: 'Avg TAT (hrs)', align: 'center', render: (v: any) => v?.toFixed(1) || '-' },
                  ]}
                />
              </>
            )}
          </>
        )}

        {/* TESTS & DEPARTMENTS TAB */}
        {activeTab === 'tests' && (
          <>
            {/* Department Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <BarChartComponent
                data={aggregatedDeptData}
                xAxisKey="department"
                series={[{ key: 'order_count', name: 'Orders', color: '#8B5CF6' }]}
                title="Orders by Department"
                height={300}
              />
              <BarChartComponent
                data={aggregatedDeptData}
                xAxisKey="department"
                series={[{ key: 'revenue', name: 'Revenue', color: '#10B981' }]}
                title="Revenue by Department"
                height={300}
                formatYAxis={formatCurrency}
                formatTooltip={formatCurrency}
              />
            </div>

            {/* Top Tests Table */}
            <DataTable
              data={testPopularity}
              title="Top Performing Tests"
              columns={[
                { key: 'rank_by_volume', header: '#', width: '50px', align: 'center' },
                { key: 'test_name', header: 'Test Name' },
                { key: 'department', header: 'Department' },
                { key: 'order_count', header: 'Orders', align: 'center' },
                { key: 'revenue', header: 'Revenue', align: 'right', render: (v: any) => formatCurrency(v) },
                { key: 'avg_price', header: 'Avg Price', align: 'right', render: (v: any) => formatCurrency(v) },
              ]}
            />

            {/* Demographics */}
            {demographics.length > 0 && (
              <>
                <h3 className="text-lg font-semibold text-gray-800 mb-4 mt-8">Patient Demographics</h3>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <DonutChart
                    data={(() => {
                      const byGender: Record<string, number> = {};
                      demographics.forEach((d) => {
                        byGender[d.gender] = (byGender[d.gender] || 0) + d.patient_count;
                      });
                      return Object.entries(byGender).map(([name, value]) => ({ name, value }));
                    })()}
                    title="By Gender"
                    height={200}
                  />
                  <DonutChart
                    data={(() => {
                      const byAge: Record<string, number> = {};
                      demographics.forEach((d) => {
                        byAge[d.age_group] = (byAge[d.age_group] || 0) + d.patient_count;
                      });
                      return Object.entries(byAge).map(([name, value]) => ({ name, value }));
                    })()}
                    title="By Age Group"
                    height={200}
                  />
                </div>
              </>
            )}
          </>
        )}

        {/* TAT & QUALITY TAB */}
        {activeTab === 'tat' && (
          <>
            {/* TAT Overview */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
              <div className="bg-white rounded-xl border border-gray-200 p-6 flex flex-col items-center justify-center">
                <TatGauge value={avgTat} target={avgTargetTat} label="Overall TAT" size="lg" />
              </div>
              <div className="md:col-span-2">
                <div className="grid grid-cols-2 gap-4">
                  <StatCard
                    title="Total Tests"
                    value={tatSummary.reduce((s, t) => s + t.total_tests, 0)}
                    icon={TestTube}
                    color="blue"
                  />
                  <StatCard
                    title="Within Target"
                    value={tatSummary.reduce((s, t) => s + t.within_target, 0)}
                    icon={Activity}
                    color="green"
                  />
                  <StatCard
                    title="TAT Breaches"
                    value={tatSummary.reduce((s, t) => s + t.breached, 0)}
                    icon={AlertTriangle}
                    color="red"
                  />
                  <StatCard
                    title="Breach Rate"
                    value={`${(
                      (tatSummary.reduce((s, t) => s + t.breached, 0) /
                        Math.max(tatSummary.reduce((s, t) => s + t.total_tests, 0), 1)) *
                      100
                    ).toFixed(1)}%`}
                    icon={Percent}
                    color="orange"
                  />
                </div>
              </div>
            </div>

            {/* TAT by Department */}
            <DataTable
              data={tatSummary}
              title="TAT Performance by Test"
              columns={[
                { key: 'department', header: 'Department' },
                { key: 'test_name', header: 'Test' },
                { key: 'target_tat', header: 'Target (hrs)', align: 'center' },
                { key: 'avg_tat_hours', header: 'Avg TAT (hrs)', align: 'center', render: (v: any) => v?.toFixed(1) || '-' },
                { key: 'min_tat_hours', header: 'Min (hrs)', align: 'center', render: (v: any) => v?.toFixed(1) || '-' },
                { key: 'max_tat_hours', header: 'Max (hrs)', align: 'center', render: (v: any) => v?.toFixed(1) || '-' },
                { key: 'within_target', header: 'On Time', align: 'center' },
                { key: 'breached', header: 'Breached', align: 'center' },
                {
                  key: 'breach_percentage',
                  header: 'Breach %',
                  align: 'center',
                  render: (v: any) => (
                    <span className={v <= 5 ? 'text-green-600' : v <= 15 ? 'text-yellow-600' : 'text-red-600'}>
                      {v?.toFixed(1)}%
                    </span>
                  ),
                },
              ]}
            />
          </>
        )}

        {/* CRITICAL ALERTS TAB */}
        {activeTab === 'critical' && (
          <>
            {/* Alert Summary */}
            <div className="grid grid-cols-3 gap-4 mb-6">
              <StatCard
                title="Critical (C)"
                value={criticalAlerts.filter((a) => a.flag === 'C').length}
                icon={AlertTriangle}
                color="red"
              />
              <StatCard
                title="High (H)"
                value={criticalAlerts.filter((a) => a.flag === 'H').length}
                icon={TrendingUp}
                color="orange"
              />
              <StatCard
                title="Low (L)"
                value={criticalAlerts.filter((a) => a.flag === 'L').length}
                icon={TrendingUp}
                color="yellow"
              />
            </div>

            {/* Critical Alerts Table */}
            <DataTable
              data={criticalAlerts}
              title="Critical & Abnormal Results"
              emptyMessage="No critical or abnormal results found"
              columns={[
                {
                  key: 'flag',
                  header: 'Flag',
                  width: '60px',
                  align: 'center',
                  render: (v: any) => (
                    <span
                      className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold text-white ${v === 'C' ? 'bg-red-500' : v === 'H' ? 'bg-orange-500' : 'bg-yellow-500'
                        }`}
                    >
                      {v}
                    </span>
                  ),
                },
                { key: 'patient_name', header: 'Patient' },
                { key: 'test_name', header: 'Test' },
                { key: 'analyte_name', header: 'Analyte' },
                {
                  key: 'value',
                  header: 'Value',
                  render: (v: any, row: any) => (
                    <span className="font-mono">
                      {v} {row.unit}
                    </span>
                  ),
                },
                { key: 'reference_range', header: 'Reference' },
                { key: 'doctor_name', header: 'Doctor' },
                {
                  key: 'hours_since_result',
                  header: 'Hours Ago',
                  align: 'center',
                  render: (v: any) => (
                    <span className={v > 2 ? 'text-red-600 font-medium' : 'text-gray-600'}>{v?.toFixed(1)}</span>
                  ),
                },
                {
                  key: 'patient_phone',
                  header: 'Contact',
                  render: (v: any, row: any) => (
                    <div className="flex items-center gap-2">
                      {v && (
                        <a href={`tel:${v}`} className="text-blue-600 hover:text-blue-800">
                          <Phone className="h-4 w-4" />
                        </a>
                      )}
                      {row.doctor_phone && (
                        <a href={`tel:${row.doctor_phone}`} className="text-green-600 hover:text-green-800">
                          <Phone className="h-4 w-4" />
                        </a>
                      )}
                    </div>
                  ),
                },
              ]}
            />
          </>
        )}
      </div>
    </div>
  );
};

export default Analytics;
