import React, { useState, useEffect } from 'react';
import {
  Building2,
  MapPin,
  Calendar,
  Loader2,
  TrendingUp,
  TrendingDown,
  IndianRupee,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  FileSpreadsheet
} from 'lucide-react';
import { database, supabase } from '../utils/supabase';
import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns';

type ReportTab = 'outsourced' | 'receivables';

interface OutsourcedCostItem {
  outsourced_lab_id: string;
  outsourced_lab_name: string;
  test_group_id: string;
  test_name: string;
  order_count: number;
  total_revenue: number;
  total_cost: number;
  margin: number;
  margin_percent: number;
}

interface OutsourcedLabSummary {
  lab_id: string;
  lab_name: string;
  total_orders: number;
  total_revenue: number;
  total_cost: number;
  total_margin: number;
  margin_percent: number;
  tests: OutsourcedCostItem[];
}

interface LocationReceivableItem {
  location_id: string;
  location_name: string;
  receivable_type: string;
  collection_percentage: number | null;
  order_count: number;
  total_revenue: number;
  total_receivable: number;
  collection_fee: number;
  // Detail items
  items: LocationItemDetail[];
}

interface LocationItemDetail {
  invoice_id: string;
  invoice_number: string;
  invoice_date: string;
  patient_name: string;
  test_name: string;
  price: number;
  receivable: number;
  fee: number;
}

const FinancialReports: React.FC = () => {
  const [activeTab, setActiveTab] = useState<ReportTab>('outsourced');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Date range
  const [dateFrom, setDateFrom] = useState<string>(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [dateTo, setDateTo] = useState<string>(format(endOfMonth(new Date()), 'yyyy-MM-dd'));

  // Outsourced costs data
  const [outsourcedData, setOutsourcedData] = useState<OutsourcedLabSummary[]>([]);
  const [expandedLabs, setExpandedLabs] = useState<Set<string>>(new Set());

  // Location receivables data
  const [receivablesData, setReceivablesData] = useState<LocationReceivableItem[]>([]);
  const [expandedLocations, setExpandedLocations] = useState<Set<string>>(new Set());

  // Totals
  const [outsourcedTotals, setOutsourcedTotals] = useState({ revenue: 0, cost: 0, margin: 0 });
  const [receivableTotals, setReceivableTotals] = useState({ revenue: 0, receivable: 0, fee: 0 });

  // Load data on mount and when date changes
  useEffect(() => {
    if (activeTab === 'outsourced') {
      loadOutsourcedCosts();
    } else {
      loadLocationReceivables();
    }
  }, [activeTab, dateFrom, dateTo]);

  const loadOutsourcedCosts = async () => {
    setLoading(true);
    setError(null);

    try {
      const labId = await database.getCurrentUserLabId();
      if (!labId) throw new Error('No lab context');

      // ✅ Apply location filtering for access control
      const { shouldFilter, locationIds } = await database.shouldFilterByLocation();

      // Get allowed invoice IDs if user is location-restricted
      let allowedInvoiceIds: string[] | null = null;

      if (shouldFilter && locationIds.length > 0) {
        const { data: invoices } = await supabase
          .from('invoices')
          .select('id, order:orders!inner(location_id)')
          .eq('lab_id', labId)
          .in('order.location_id', locationIds)
          .gte('invoice_date', dateFrom)
          .lte('invoice_date', dateTo);

        allowedInvoiceIds = (invoices || []).map((inv: any) => inv.id);

        if (allowedInvoiceIds.length === 0) {
          // No invoices for assigned locations
          setOutsourcedData([]);
          setOutsourcedTotals({ revenue: 0, cost: 0, margin: 0 });
          setLoading(false);
          return;
        }
      }

      // Build query for invoice items
      let query = supabase
        .from('invoice_items')
        .select(`
          id,
          test_name,
          price,
          outsourced_cost,
          outsourced_lab_id,
          invoice:invoices!inner(invoice_date, lab_id),
          outsourced_lab:outsourced_labs(id, name)
        `)
        .eq('invoice.lab_id', labId)
        .not('outsourced_lab_id', 'is', null)
        .gte('invoice.invoice_date', dateFrom)
        .lte('invoice.invoice_date', dateTo);

      // Apply location filter via invoice IDs
      if (allowedInvoiceIds) {
        query = query.in('invoice_id', allowedInvoiceIds);
      }

      const { data, error: fetchError } = await query;

      if (fetchError) throw fetchError;

      // Group by outsourced lab and test
      const labMap = new Map<string, OutsourcedLabSummary>();

      (data || []).forEach((item: any) => {
        const labId = item.outsourced_lab_id;
        const labName = item.outsourced_lab?.name || 'Unknown Lab';
        const testName = item.test_name;
        const revenue = item.price || 0;
        const cost = item.outsourced_cost || 0;

        if (!labMap.has(labId)) {
          labMap.set(labId, {
            lab_id: labId,
            lab_name: labName,
            total_orders: 0,
            total_revenue: 0,
            total_cost: 0,
            total_margin: 0,
            margin_percent: 0,
            tests: []
          });
        }

        const lab = labMap.get(labId)!;
        lab.total_orders += 1;
        lab.total_revenue += revenue;
        lab.total_cost += cost;

        // Find or create test entry
        let testEntry = lab.tests.find(t => t.test_name === testName);
        if (!testEntry) {
          testEntry = {
            outsourced_lab_id: labId,
            outsourced_lab_name: labName,
            test_group_id: '',
            test_name: testName,
            order_count: 0,
            total_revenue: 0,
            total_cost: 0,
            margin: 0,
            margin_percent: 0
          };
          lab.tests.push(testEntry);
        }

        testEntry.order_count += 1;
        testEntry.total_revenue += revenue;
        testEntry.total_cost += cost;
      });

      // Calculate margins
      const summaries = Array.from(labMap.values()).map(lab => {
        lab.total_margin = lab.total_revenue - lab.total_cost;
        lab.margin_percent = lab.total_revenue > 0
          ? (lab.total_margin / lab.total_revenue) * 100
          : 0;

        lab.tests = lab.tests.map(test => ({
          ...test,
          margin: test.total_revenue - test.total_cost,
          margin_percent: test.total_revenue > 0
            ? ((test.total_revenue - test.total_cost) / test.total_revenue) * 100
            : 0
        }));

        return lab;
      });

      // Calculate totals
      const totals = summaries.reduce((acc, lab) => ({
        revenue: acc.revenue + lab.total_revenue,
        cost: acc.cost + lab.total_cost,
        margin: acc.margin + lab.total_margin
      }), { revenue: 0, cost: 0, margin: 0 });

      setOutsourcedData(summaries);
      setOutsourcedTotals(totals);
    } catch (err: any) {
      console.error('Error loading outsourced costs:', err);
      setError(err.message || 'Failed to load outsourced costs');
    } finally {
      setLoading(false);
    }
  };

  const loadLocationReceivables = async () => {
    setLoading(true);
    setError(null);

    try {
      const labId = await database.getCurrentUserLabId();
      if (!labId) throw new Error('No lab context');

      // ✅ Apply location filtering for access control
      const { shouldFilter, locationIds } = await database.shouldFilterByLocation();

      // Get invoice items with location info
      // Note: Must use explicit FK hint for locations due to multiple relationships
      const { data, error: fetchError } = await supabase
        .from('invoice_items')
        .select(`
          id,
          price,
          test_name,
          location_receivable,
          invoice:invoices!inner(
            id,
            invoice_number,
            invoice_date, 
            patient_name,
            lab_id,
            order:orders(
              location_id,
              location:locations!orders_location_id_fkey(id, name, receivable_type, collection_percentage)
            )
          )
        `)
        .eq('invoice.lab_id', labId)
        .gte('invoice.invoice_date', dateFrom)
        .lte('invoice.invoice_date', dateTo);

      if (fetchError) throw fetchError;

      // ✅ Filter by location in memory (complex join structure)
      let filteredData = data || [];
      if (shouldFilter && locationIds.length > 0) {
        filteredData = filteredData.filter((item: any) => {
          const locationId = item.invoice?.order?.location?.id;
          return locationId && locationIds.includes(locationId);
        });
      }

      // Group by location using filtered data
      const locationMap = new Map<string, LocationReceivableItem>();

      filteredData.forEach((item: any) => {
        const location = item.invoice?.order?.location;
        if (!location) return;

        const locationId = location.id;
        const revenue = item.price || 0;

        // Use stored location_receivable - it should be populated at order creation time
        // Only fall back if truly missing (for old data before this fix)
        let receivable = item.location_receivable;
        if (receivable === null || receivable === undefined) {
          // Legacy fallback for old data without location_receivable
          if (location.receivable_type === 'own_center') {
            receivable = revenue; // Lab gets 100%
          } else if (location.collection_percentage) {
            receivable = revenue * (location.collection_percentage / 100);
          } else {
            receivable = 0; // Default if no config
          }
        }

        const fee = revenue - receivable;

        if (!locationMap.has(locationId)) {
          locationMap.set(locationId, {
            location_id: locationId,
            location_name: location.name,
            receivable_type: location.receivable_type || 'percentage',
            collection_percentage: location.collection_percentage,
            order_count: 0,
            total_revenue: 0,
            total_receivable: 0,
            collection_fee: 0,
            items: []
          });
        }

        const loc = locationMap.get(locationId)!;
        loc.order_count += 1;
        loc.total_revenue += revenue;
        loc.total_receivable += receivable;
        loc.collection_fee = loc.total_revenue - loc.total_receivable;

        // Add detail item
        loc.items.push({
          invoice_id: item.invoice?.id || '',
          invoice_number: item.invoice?.invoice_number || '',
          invoice_date: item.invoice?.invoice_date || '',
          patient_name: item.invoice?.patient_name || 'Unknown',
          test_name: item.test_name || 'Unknown Test',
          price: revenue,
          receivable: receivable,
          fee: fee
        });
      });

      const receivables = Array.from(locationMap.values());

      // Sort items within each location by invoice date (descending)
      receivables.forEach(loc => {
        loc.items.sort((a, b) =>
          new Date(b.invoice_date).getTime() - new Date(a.invoice_date).getTime()
        );
      });

      // Calculate totals
      const totals = receivables.reduce((acc, loc) => ({
        revenue: acc.revenue + loc.total_revenue,
        receivable: acc.receivable + loc.total_receivable,
        fee: acc.fee + loc.collection_fee
      }), { revenue: 0, receivable: 0, fee: 0 });

      setReceivablesData(receivables);
      setReceivableTotals(totals);
    } catch (err: any) {
      console.error('Error loading location receivables:', err);
      setError(err.message || 'Failed to load location receivables');
    } finally {
      setLoading(false);
    }
  };

  const toggleLabExpand = (labId: string) => {
    setExpandedLabs(prev => {
      const next = new Set(prev);
      if (next.has(labId)) {
        next.delete(labId);
      } else {
        next.add(labId);
      }
      return next;
    });
  };

  const toggleLocationExpand = (locationId: string) => {
    setExpandedLocations(prev => {
      const next = new Set(prev);
      if (next.has(locationId)) {
        next.delete(locationId);
      } else {
        next.add(locationId);
      }
      return next;
    });
  };

  const handleDatePreset = (preset: 'thisMonth' | 'lastMonth' | 'last3Months') => {
    const now = new Date();
    switch (preset) {
      case 'thisMonth':
        setDateFrom(format(startOfMonth(now), 'yyyy-MM-dd'));
        setDateTo(format(endOfMonth(now), 'yyyy-MM-dd'));
        break;
      case 'lastMonth':
        const lastMonth = subMonths(now, 1);
        setDateFrom(format(startOfMonth(lastMonth), 'yyyy-MM-dd'));
        setDateTo(format(endOfMonth(lastMonth), 'yyyy-MM-dd'));
        break;
      case 'last3Months':
        setDateFrom(format(startOfMonth(subMonths(now, 2)), 'yyyy-MM-dd'));
        setDateTo(format(endOfMonth(now), 'yyyy-MM-dd'));
        break;
    }
  };

  const exportToCSV = () => {
    let csv = '';
    const filename = activeTab === 'outsourced'
      ? `outsourced_costs_${dateFrom}_to_${dateTo}.csv`
      : `location_receivables_${dateFrom}_to_${dateTo}.csv`;

    if (activeTab === 'outsourced') {
      csv = 'Lab Name,Test Name,Order Count,Revenue,Cost,Margin,Margin %\n';
      outsourcedData.forEach(lab => {
        lab.tests.forEach(test => {
          csv += `"${lab.lab_name}","${test.test_name}",${test.order_count},${test.total_revenue},${test.total_cost},${test.margin},${test.margin_percent.toFixed(1)}\n`;
        });
      });
      csv += `\n"TOTAL","",${outsourcedData.reduce((s, l) => s + l.total_orders, 0)},${outsourcedTotals.revenue},${outsourcedTotals.cost},${outsourcedTotals.margin},${outsourcedTotals.revenue > 0 ? ((outsourcedTotals.margin / outsourcedTotals.revenue) * 100).toFixed(1) : 0}\n`;
    } else {
      csv = 'Location,Receivable Type,Order Count,Revenue,Lab Receivable,Collection Fee\n';
      receivablesData.forEach(loc => {
        csv += `"${loc.location_name}","${loc.receivable_type}",${loc.order_count},${loc.total_revenue},${loc.total_receivable},${loc.collection_fee}\n`;
      });
      csv += `\n"TOTAL","",${receivablesData.reduce((s, l) => s + l.order_count, 0)},${receivableTotals.revenue},${receivableTotals.receivable},${receivableTotals.fee}\n`;
    }

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Financial Reports</h1>
        <p className="text-gray-600">Track outsourced test costs and location receivables</p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 mb-6">
        <button
          onClick={() => setActiveTab('outsourced')}
          className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'outsourced'
            ? 'border-blue-600 text-blue-600'
            : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
        >
          <Building2 className="w-4 h-4 inline mr-2" />
          Outsourced Costs
        </button>
        <button
          onClick={() => setActiveTab('receivables')}
          className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'receivables'
            ? 'border-blue-600 text-blue-600'
            : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
        >
          <MapPin className="w-4 h-4 inline mr-2" />
          Location Receivables
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-6">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-gray-400" />
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
            <span className="text-gray-500">to</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => handleDatePreset('thisMonth')}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50"
            >
              This Month
            </button>
            <button
              onClick={() => handleDatePreset('lastMonth')}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50"
            >
              Last Month
            </button>
            <button
              onClick={() => handleDatePreset('last3Months')}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50"
            >
              Last 3 Months
            </button>
          </div>

          <div className="flex-1"></div>

          <button
            onClick={() => activeTab === 'outsourced' ? loadOutsourcedCosts() : loadLocationReceivables()}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Refresh
          </button>

          <button
            onClick={exportToCSV}
            className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            <FileSpreadsheet className="w-4 h-4" />
            Export CSV
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          {error}
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {activeTab === 'outsourced' ? (
          <>
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">Total Revenue</p>
                  <p className="text-2xl font-bold text-gray-900">₹{outsourcedTotals.revenue.toLocaleString()}</p>
                </div>
                <div className="h-12 w-12 bg-green-100 rounded-full flex items-center justify-center">
                  <IndianRupee className="h-6 w-6 text-green-600" />
                </div>
              </div>
            </div>
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">Total Cost</p>
                  <p className="text-2xl font-bold text-red-600">₹{outsourcedTotals.cost.toLocaleString()}</p>
                </div>
                <div className="h-12 w-12 bg-red-100 rounded-full flex items-center justify-center">
                  <TrendingDown className="h-6 w-6 text-red-600" />
                </div>
              </div>
            </div>
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">Net Margin</p>
                  <p className="text-2xl font-bold text-blue-600">₹{outsourcedTotals.margin.toLocaleString()}</p>
                  <p className="text-sm text-gray-500">
                    ({outsourcedTotals.revenue > 0 ? ((outsourcedTotals.margin / outsourcedTotals.revenue) * 100).toFixed(1) : 0}%)
                  </p>
                </div>
                <div className="h-12 w-12 bg-blue-100 rounded-full flex items-center justify-center">
                  <TrendingUp className="h-6 w-6 text-blue-600" />
                </div>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">Total Revenue</p>
                  <p className="text-2xl font-bold text-gray-900">₹{receivableTotals.revenue.toLocaleString()}</p>
                </div>
                <div className="h-12 w-12 bg-green-100 rounded-full flex items-center justify-center">
                  <IndianRupee className="h-6 w-6 text-green-600" />
                </div>
              </div>
            </div>
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">Lab Receivable</p>
                  <p className="text-2xl font-bold text-blue-600">₹{receivableTotals.receivable.toLocaleString()}</p>
                </div>
                <div className="h-12 w-12 bg-blue-100 rounded-full flex items-center justify-center">
                  <TrendingUp className="h-6 w-6 text-blue-600" />
                </div>
              </div>
            </div>
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">Collection Fee</p>
                  <p className="text-2xl font-bold text-orange-600">₹{receivableTotals.fee.toLocaleString()}</p>
                  <p className="text-sm text-gray-500">
                    ({receivableTotals.revenue > 0 ? ((receivableTotals.fee / receivableTotals.revenue) * 100).toFixed(1) : 0}%)
                  </p>
                </div>
                <div className="h-12 w-12 bg-orange-100 rounded-full flex items-center justify-center">
                  <MapPin className="h-6 w-6 text-orange-600" />
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Data Table */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
          <span className="ml-3 text-gray-600">Loading data...</span>
        </div>
      ) : activeTab === 'outsourced' ? (
        /* Outsourced Costs Table */
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          {outsourcedData.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <Building2 className="w-12 h-12 mx-auto mb-4 text-gray-300" />
              <p>No outsourced tests found for this period.</p>
              <p className="text-sm mt-2">Make sure to configure costs in Outsourced Labs settings.</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {outsourcedData.map(lab => (
                <div key={lab.lab_id}>
                  {/* Lab Header */}
                  <button
                    onClick={() => toggleLabExpand(lab.lab_id)}
                    className="w-full flex items-center justify-between px-6 py-4 hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center gap-4">
                      <div className="h-10 w-10 bg-purple-100 rounded-full flex items-center justify-center">
                        <Building2 className="h-5 w-5 text-purple-600" />
                      </div>
                      <div className="text-left">
                        <p className="font-medium text-gray-900">{lab.lab_name}</p>
                        <p className="text-sm text-gray-500">{lab.total_orders} tests</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-6">
                      <div className="text-right">
                        <p className="text-sm text-gray-500">Revenue</p>
                        <p className="font-medium text-gray-900">₹{lab.total_revenue.toLocaleString()}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm text-gray-500">Cost</p>
                        <p className="font-medium text-red-600">₹{lab.total_cost.toLocaleString()}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm text-gray-500">Margin</p>
                        <p className={`font-medium ${lab.total_margin >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          ₹{lab.total_margin.toLocaleString()}
                          <span className="text-xs ml-1">({lab.margin_percent.toFixed(1)}%)</span>
                        </p>
                      </div>
                      {expandedLabs.has(lab.lab_id) ? (
                        <ChevronUp className="w-5 h-5 text-gray-400" />
                      ) : (
                        <ChevronDown className="w-5 h-5 text-gray-400" />
                      )}
                    </div>
                  </button>

                  {/* Lab Details */}
                  {expandedLabs.has(lab.lab_id) && (
                    <div className="bg-gray-50 px-6 py-3">
                      <table className="min-w-full">
                        <thead>
                          <tr className="text-xs text-gray-500 uppercase">
                            <th className="text-left py-2">Test Name</th>
                            <th className="text-center py-2">Count</th>
                            <th className="text-right py-2">Revenue</th>
                            <th className="text-right py-2">Cost</th>
                            <th className="text-right py-2">Margin</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                          {lab.tests.map((test, idx) => (
                            <tr key={idx} className="text-sm">
                              <td className="py-2 text-gray-900">{test.test_name}</td>
                              <td className="py-2 text-center text-gray-600">{test.order_count}</td>
                              <td className="py-2 text-right text-gray-900">₹{test.total_revenue.toLocaleString()}</td>
                              <td className="py-2 text-right text-red-600">₹{test.total_cost.toLocaleString()}</td>
                              <td className={`py-2 text-right ${test.margin >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                ₹{test.margin.toLocaleString()}
                                <span className="text-xs ml-1">({test.margin_percent.toFixed(1)}%)</span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* Location Receivables Table */
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          {receivablesData.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <MapPin className="w-12 h-12 mx-auto mb-4 text-gray-300" />
              <p>No location data found for this period.</p>
              <p className="text-sm mt-2">Make sure to configure pricing in Location Master.</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {/* Header */}
              <div className="bg-gray-50 px-6 py-3 grid grid-cols-7 gap-4 text-xs font-medium text-gray-500 uppercase">
                <div className="col-span-2">Location</div>
                <div className="text-center">Type</div>
                <div className="text-center">Orders</div>
                <div className="text-right">Revenue</div>
                <div className="text-right">Lab Receivable</div>
                <div className="text-right">Collection Fee</div>
              </div>

              {/* Location Rows */}
              {receivablesData.map(loc => (
                <div key={loc.location_id}>
                  <button
                    onClick={() => toggleLocationExpand(loc.location_id)}
                    className="w-full px-6 py-4 grid grid-cols-7 gap-4 items-center hover:bg-gray-50 transition-colors text-left"
                  >
                    <div className="col-span-2 flex items-center gap-3">
                      <div className="h-8 w-8 bg-blue-100 rounded-full flex items-center justify-center">
                        <MapPin className="h-4 w-4 text-blue-600" />
                      </div>
                      <div>
                        <span className="font-medium text-gray-900">{loc.location_name}</span>
                        {loc.receivable_type === 'percentage' && loc.collection_percentage && (
                          <span className="ml-2 text-xs text-gray-500">({loc.collection_percentage}% to lab)</span>
                        )}
                      </div>
                      {expandedLocations.has(loc.location_id) ? (
                        <ChevronUp className="w-4 h-4 text-gray-400" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-gray-400" />
                      )}
                    </div>
                    <div className="text-center">
                      <span className={`inline-flex px-2 py-1 text-xs font-medium rounded ${loc.receivable_type === 'own_center'
                        ? 'bg-green-100 text-green-800'
                        : loc.receivable_type === 'test_wise'
                          ? 'bg-purple-100 text-purple-800'
                          : 'bg-orange-100 text-orange-800'
                        }`}>
                        {loc.receivable_type === 'own_center' ? 'Own Center' :
                          loc.receivable_type === 'test_wise' ? 'Test-wise' : 'Percentage'}
                      </span>
                    </div>
                    <div className="text-center text-gray-600">{loc.order_count}</div>
                    <div className="text-right text-gray-900">₹{loc.total_revenue.toLocaleString()}</div>
                    <div className="text-right text-blue-600 font-medium">₹{loc.total_receivable.toLocaleString()}</div>
                    <div className="text-right text-orange-600">₹{loc.collection_fee.toLocaleString()}</div>
                  </button>

                  {/* Expanded Details */}
                  {expandedLocations.has(loc.location_id) && (
                    <div className="bg-gray-50 px-6 py-3 border-t border-gray-200">
                      <div className="mb-2 text-sm text-gray-600">
                        {loc.receivable_type === 'own_center' && (
                          <span className="bg-green-50 px-2 py-1 rounded">💡 Own Center: Lab receives 100% of revenue</span>
                        )}
                        {loc.receivable_type === 'percentage' && (
                          <span className="bg-orange-50 px-2 py-1 rounded">
                            💡 Lab receives {loc.collection_percentage || 0}% of revenue, Location keeps {100 - (loc.collection_percentage || 0)}%
                          </span>
                        )}
                        {loc.receivable_type === 'test_wise' && (
                          <span className="bg-purple-50 px-2 py-1 rounded">💡 Receivable varies per test (configured in Location Test Prices)</span>
                        )}
                      </div>
                      <table className="min-w-full">
                        <thead>
                          <tr className="text-xs text-gray-500 uppercase">
                            <th className="text-left py-2">Date</th>
                            <th className="text-left py-2">Invoice</th>
                            <th className="text-left py-2">Patient</th>
                            <th className="text-left py-2">Test</th>
                            <th className="text-right py-2">Price</th>
                            <th className="text-right py-2">Lab Gets</th>
                            <th className="text-right py-2">Loc Gets</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                          {loc.items.map((item, idx) => (
                            <tr key={idx} className="text-sm">
                              <td className="py-2 text-gray-600">{item.invoice_date ? new Date(item.invoice_date).toLocaleDateString() : '-'}</td>
                              <td className="py-2 text-gray-900 font-mono text-xs">{item.invoice_number}</td>
                              <td className="py-2 text-gray-900">{item.patient_name}</td>
                              <td className="py-2 text-gray-600">{item.test_name}</td>
                              <td className="py-2 text-right text-gray-900">₹{item.price.toLocaleString()}</td>
                              <td className="py-2 text-right text-blue-600">₹{item.receivable.toLocaleString()}</td>
                              <td className="py-2 text-right text-orange-600">₹{item.fee.toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))}

              {/* Totals Row */}
              <div className="bg-gray-100 px-6 py-4 grid grid-cols-7 gap-4 font-semibold">
                <div className="col-span-2 text-gray-900">Total</div>
                <div></div>
                <div className="text-center text-gray-900">{receivablesData.reduce((s, l) => s + l.order_count, 0)}</div>
                <div className="text-right text-gray-900">₹{receivableTotals.revenue.toLocaleString()}</div>
                <div className="text-right text-blue-600">₹{receivableTotals.receivable.toLocaleString()}</div>
                <div className="text-right text-orange-600">₹{receivableTotals.fee.toLocaleString()}</div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default FinancialReports;
