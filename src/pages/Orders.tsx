// src/pages/Orders.tsx
import React, { useEffect, useMemo, useState } from "react";
import {
  Plus, Search, Clock as ClockIcon, CheckCircle, AlertTriangle,
  Eye, User, Calendar, TestTube, ChevronDown, ChevronUp, TrendingUp, ToggleLeft, ToggleRight, X, RefreshCcw
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { database, supabase, formatAge } from "../utils/supabase";
import OrderForm from "../components/Orders/OrderForm";
import OrderDetailsModal from "../components/Orders/OrderDetailsModal";
import EnhancedOrdersPage from "../components/Orders/EnhancedOrdersPage";
import OrderFiltersBar, { OrderFilters } from "../components/Orders/OrderFiltersBar";
import { useRealtimeOrders } from "../hooks/useRealtimeOrders";
import { SampleTypeGroup } from "../components/Common/SampleTypeIndicator";
import { TATStatusBadge } from "../components/Orders/TATStatusBadge";
import { useMobileOptimizations } from "../utils/platformHelper";

/* ===========================
   Types
=========================== */

type OrderStatus =
  | "Order Created"
  | "Sample Collection"
  | "In Progress"
  | "Pending Approval"
  | "Completed"
  | "Delivered";

type Priority = "Normal" | "Urgent" | "STAT";

type ProgressRow = {
  order_id: string;
  test_group_id: string | null;
  test_group_name: string | null;
  expected_analytes: number;
  entered_analytes: number;
  total_values: number;
  has_results: boolean;
  is_verified: boolean;
  panel_status: "Not started" | "In progress" | "Partial" | "Complete" | "Verified";
  sample_type?: string;
  sample_color?: string;
  hours_until_tat_breach?: number | null;
  is_tat_breached?: boolean;
  tat_hours?: number;
  tat_start_time?: string | null;
};



type Panel = {
  name: string;
  expected: number;
  entered: number;     // from view (clamped later)
  verified: boolean;
  status: ProgressRow["panel_status"];
  isOutsourced?: boolean;
  outsourcedLab?: string;
  sample_type?: string;
  sample_color?: string;
  // TAT fields per panel
  hours_until_tat_breach?: number | null;
  is_tat_breached?: boolean;
  tat_hours?: number | null;
};

type CardOrder = {
  id: string;
  lab_id: string;
  location_id?: string;
  patient_name: string;
  patient_id: string;
  status: OrderStatus;
  priority: Priority;
  order_date: string;
  expected_date: string;
  total_amount: number;
  final_amount?: number;
  doctor: string | null;

  order_number?: number | null;

  sample_id: string | null;
  sample_type?: string;
  color_code: string | null;
  color_name: string | null;
  sample_collected_at: string | null;
  sample_collected_by: string | null;

  patient?: { name?: string | null; age?: string | null; gender?: string | null } | null;
  tests: string[];
  order_tests?: any[]; // Full order_tests array with outsourcing details

  // derived
  panels: Panel[];
  expectedTotal: number;
  enteredTotal: number;

  // 3-bucket model
  pendingAnalytes: number;       // not started OR partial/in-progress
  forApprovalAnalytes: number;   // complete but not verified
  approvedAnalytes: number;      // verified

  // TAT aggregation
  hours_until_tat_breach?: number | null;
  is_tat_breached?: boolean | null;
  tat_hours?: number | null;
  tatStarted?: boolean;
};

/* ===========================
   Component
=========================== */

const Orders: React.FC = () => {
  const { user } = useAuth();
  const mobile = useMobileOptimizations();

  const [orders, setOrders] = useState<CardOrder[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [showOrderForm, setShowOrderForm] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<CardOrder | null>(null);
  const [openOnResults, setOpenOnResults] = useState(false);
  const [viewMode, setViewMode] = useState<'standard' | 'enhanced'>('standard');

  // Filter state
  const [filters, setFilters] = useState<OrderFilters>({
    status: "All",
    priority: "All",
    from: new Date().toISOString().slice(0, 10), // Today's date
    to: new Date().toISOString().slice(0, 10)    // Today's date
  });

  // Add test modal state
  const [showAddTestModal, setShowAddTestModal] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [availableTests, setAvailableTests] = useState<any[]>([]);
  const [selectedTests, setSelectedTests] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoadingTests, setIsLoadingTests] = useState(false);
  const [locations, setLocations] = useState<{ id: string; name: string }[]>([]);

  // Load locations on mount
  useEffect(() => {
    const loadLocations = async () => {
      const userLocInfo = await database.shouldFilterByLocation();
      const { data: allLocations } = await database.locations.getAll();

      if (allLocations) {
        if (userLocInfo.canViewAll || !userLocInfo.shouldFilter) {
          setLocations(allLocations.map((l: any) => ({ id: l.id, name: l.name })));
        } else {
          setLocations(allLocations
            .filter((l: any) => userLocInfo.locationIds.includes(l.id))
            .map((l: any) => ({ id: l.id, name: l.name }))
          );
        }
      }
    };
    loadLocations();
  }, []);

  // dashboard counters
  const [summary, setSummary] = useState({ allDone: 0, mostlyDone: 0, pending: 0, awaitingApproval: 0 });

  // RE-RUN requests tracking
  const [rerunRequests, setRerunRequests] = useState<{ order_id: string; count: number; analytes: string[] }[]>([]);
  const [totalRerunCount, setTotalRerunCount] = useState(0);

  // Create a map of order_id to rerun info for quick lookup
  const rerunByOrder = useMemo(() => {
    const map = new Map<string, { count: number; analytes: string[] }>();
    rerunRequests.forEach(r => map.set(r.order_id, { count: r.count, analytes: r.analytes }));
    return map;
  }, [rerunRequests]);

  // Fetch RE-RUN requests
  const fetchRerunRequests = async () => {
    const lab_id = await database.getCurrentUserLabId();
    if (!lab_id) return;

    // Fetch result_values with RE-RUN in verify_note, pending status
    const { data, error } = await supabase
      .from('result_values')
      .select(`
        id,
        analyte_name,
        verify_note,
        results!inner (
          id,
          order_id,
          orders!inner (
            id,
            lab_id,
            status
          )
        )
      `)
      .eq('verify_status', 'pending')
      .ilike('verify_note', '%RE-RUN%')
      .eq('results.orders.lab_id', lab_id)
      .neq('results.orders.status', 'Completed')
      .neq('results.orders.status', 'Delivered');

    if (error) {
      console.error('Error fetching re-run requests:', error);
      return;
    }

    // Group by order_id
    const byOrder = new Map<string, { count: number; analytes: string[] }>();
    (data || []).forEach((rv: any) => {
      const orderId = rv.results?.order_id;
      if (orderId) {
        const existing = byOrder.get(orderId) || { count: 0, analytes: [] };
        existing.count++;
        if (rv.analyte_name && !existing.analytes.includes(rv.analyte_name)) {
          existing.analytes.push(rv.analyte_name);
        }
        byOrder.set(orderId, existing);
      }
    });

    const requests = Array.from(byOrder.entries()).map(([order_id, info]) => ({
      order_id,
      count: info.count,
      analytes: info.analytes
    }));

    setRerunRequests(requests);
    setTotalRerunCount(data?.length || 0);
  };

  useEffect(() => {
    fetchOrders();
    fetchRerunRequests();
  }, []);

  // Get user's lab_id for realtime filtering
  const [userLabId, setUserLabId] = useState<string>('');

  useEffect(() => {
    const getLabId = async () => {
      const labId = await database.getCurrentUserLabId();
      if (labId) {
        setUserLabId(labId);
      }
    };
    getLabId();
  }, []);

  // 🔴 REALTIME: Subscribe to order changes
  const { isConnected: realtimeConnected } = useRealtimeOrders({
    labId: userLabId,
    enabled: !!userLabId, // Only enable when we have lab_id
    onInsert: async (newOrder) => {
      console.log('📡 Realtime: New order created', newOrder.id);

      // Fetch full order data with relations
      const { data: fullOrderData } = await supabase
        .from("orders")
        .select(`
          id, lab_id, patient_id, patient_name, status, priority, order_date, expected_date, total_amount, final_amount, doctor,
          order_number, sample_id, color_code, color_name, sample_collected_at, sample_collected_by,
          patients(name, age, gender),
          order_tests(id, test_group_id, test_name, outsourced_lab_id, outsourced_labs(name))
        `)
        .eq('id', newOrder.id)
        .single();

      if (fullOrderData) {
        // Transform to CardOrder format (simplified - no progress data yet)
        const orderRow = fullOrderData as any;
        const panels: Panel[] = []; // Will be populated on next refresh

        const newCardOrder: CardOrder = {
          id: orderRow.id,
          lab_id: orderRow.lab_id,
          patient_name: orderRow.patient_name,
          patient_id: orderRow.patient_id,
          status: orderRow.status,
          priority: orderRow.priority,
          order_date: orderRow.order_date,
          expected_date: orderRow.expected_date,
          total_amount: orderRow.total_amount,
          final_amount: orderRow.final_amount || orderRow.total_amount,
          doctor: orderRow.doctor,
          order_number: orderRow.order_number ?? null,
          sample_id: orderRow.sample_id,
          color_code: orderRow.color_code,
          color_name: orderRow.color_name,
          sample_collected_at: orderRow.sample_collected_at,
          sample_collected_by: orderRow.sample_collected_by,
          patient: orderRow.patients,
          tests: (orderRow.order_tests || []).map((t: any) => t.test_name),
          order_tests: orderRow.order_tests || [],
          panels,
          expectedTotal: 0,
          enteredTotal: 0,
          pendingAnalytes: 0,
          forApprovalAnalytes: 0,
          approvedAnalytes: 0,
        };

        setOrders(prev => [newCardOrder, ...prev]);
      }
    },
    onUpdate: (updatedOrder) => {
      console.log('📡 Realtime: Order updated', updatedOrder.id);
      // Refresh that specific order
      fetchOrders();
    },
    onDelete: (deletedOrderId) => {
      console.log('📡 Realtime: Order deleted', deletedOrderId);
      setOrders(prev => prev.filter(order => order.id !== deletedOrderId));
    }
  });

  // Update selected order when orders change (for modal refresh after status update)
  useEffect(() => {
    if (selectedOrder) {
      const updatedOrder = orders.find(order => order.id === selectedOrder.id);
      if (updatedOrder && (
        updatedOrder.status !== selectedOrder.status ||
        updatedOrder.sample_collected_at !== selectedOrder.sample_collected_at ||
        updatedOrder.sample_collected_by !== selectedOrder.sample_collected_by
      )) {
        console.log(`Updating modal order data: ${selectedOrder.status} → ${updatedOrder.status}`);
        console.log(`Sample collection: ${selectedOrder.sample_collected_at} → ${updatedOrder.sample_collected_at}`);
        setSelectedOrder(updatedOrder);
      }
    }
  }, [orders, selectedOrder]);

  // Fetch tests and packages from database
  const fetchTestsAndPackages = async () => {
    setIsLoadingTests(true);
    try {
      const labId = await database.getCurrentUserLabId();
      if (!labId) {
        console.warn('No lab_id found for user - fetching all available tests for demo purposes');
        // Continue anyway for demo/development purposes
      }

      // Use the centralized database API following project patterns (same as enhanced view)
      const { data: testGroups, error: testGroupsError } = await database.testGroups.getAll();
      if (testGroupsError) {
        console.error('Error fetching test groups:', testGroupsError);
        throw testGroupsError;
      }

      const { data: packages, error: packagesError } = await database.packages.getAll();
      if (packagesError) {
        console.error('Error fetching packages:', packagesError);
        throw packagesError;
      }

      console.log('Fetched test groups:', testGroups?.length || 0);
      console.log('Fetched packages:', packages?.length || 0);

      // Transform test groups to match the expected format
      const transformedTests = (testGroups || []).map(test => ({
        id: test.id,
        name: test.name,
        price: test.price || 0,
        category: test.category || 'Test',
        sample: test.sample_type || 'Various',
        code: test.code || '',
        type: 'test'
      }));

      // Transform packages to match the expected format
      const transformedPackages = (packages || []).map(pkg => ({
        id: pkg.id,
        name: pkg.name,
        price: pkg.price || 0,
        category: 'Package',
        sample: 'Various',
        description: pkg.description || '',
        type: 'package'
      }));

      const allTests = [...transformedTests, ...transformedPackages];
      console.log('Total available tests/packages:', allTests.length);
      setAvailableTests(allTests);
    } catch (error) {
      console.error('Error fetching tests and packages:', error);
      setAvailableTests([]);
    } finally {
      setIsLoadingTests(false);
    }
  };

  useEffect(() => {
    if (user) {
      fetchTestsAndPackages();
    }
  }, [user]);

  const filteredTests = availableTests.filter(test =>
    test.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    test.category.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const toggleTestSelection = (test: any) => {
    setSelectedTests(prev => {
      const isSelected = prev.some(t => t.id === test.id);
      if (isSelected) {
        return prev.filter(t => t.id !== test.id);
      } else {
        return [...prev, test];
      }
    });
  };

  const getTotalPrice = () => {
    return selectedTests.reduce((sum, test) => sum + test.price, 0);
  };

  const handleAddSelectedTests = async () => {
    if (selectedTests.length === 0 || !selectedOrderId) return;

    try {
      console.log('Adding tests to order:', selectedOrderId, selectedTests);

      // Find the current order to get existing data
      const currentOrder = orders.find(order => order.id === selectedOrderId);
      if (!currentOrder) {
        alert('Order not found');
        return;
      }

      // Create new test records for the order_tests table
      const newOrderTests = selectedTests.map(test => ({
        order_id: selectedOrderId,
        test_name: test.name,
        test_group_id: test.type === 'test' ? test.id : null
      }));

      // Insert new tests into order_tests table
      const { error: testsError } = await supabase
        .from('order_tests')
        .insert(newOrderTests);

      if (testsError) {
        console.error('Error inserting order tests:', testsError);
        alert('Failed to add tests. Please try again.');
        return;
      }

      // Calculate new total amount and update the order
      const newTestsTotal = selectedTests.reduce((sum, test) => sum + test.price, 0);
      const updatedTotalAmount = currentOrder.total_amount + newTestsTotal;

      // Update the order's total amount
      const { error: updateError } = await supabase
        .from('orders')
        .update({ total_amount: updatedTotalAmount })
        .eq('id', selectedOrderId);

      if (updateError) {
        console.error('Error updating order total:', updateError);
        alert('Tests added but failed to update total amount.');
        return;
      }

      console.log('Order updated successfully');

      // Reset modal state
      setSelectedTests([]);
      setSearchQuery('');
      setShowAddTestModal(false);
      setSelectedOrderId(null);

      // Refresh the orders data
      await fetchOrders();

      // Show success message
      alert(`Successfully added ${selectedTests.length} tests to the order! Total cost: ₹${newTestsTotal.toLocaleString()}`);

    } catch (error) {
      console.error('Error adding tests:', error);
      alert('Failed to add tests. Please try again.');
    }
  };

  const handleAddTests = (orderId: string) => {
    setSelectedOrderId(orderId);
    setShowAddTestModal(true);
  };

  // Read daily sequence (prefer order_number; fallback to tail of sample_id)
  const getDailySeq = (o: CardOrder) => {
    if (typeof o.order_number === "number" && !Number.isNaN(o.order_number)) return o.order_number;
    const tail = String(o.sample_id || "").split("-").pop() || "";
    const n = parseInt(tail, 10);
    return Number.isFinite(n) ? n : 0;
  };

  const fetchOrders = async () => {
    // Get current user's lab_id
    const lab_id = await database.getCurrentUserLabId();
    if (!lab_id) {
      console.error('No lab_id found for current user');
      return;
    }

    // 1) base orders
    let query = supabase
      .from("orders")
      .select(`
        id, lab_id, location_id, patient_id, patient_name, status, priority, order_date, expected_date, total_amount, final_amount, doctor,
        order_number, sample_id, color_code, color_name, sample_collected_at, sample_collected_by,
        patients(name, age, gender),
        order_tests(
          id, test_group_id, test_name, outsourced_lab_id,
          outsourced_labs(name),
          test_groups(sample_type, sample_color)
        )
      `)
      .eq('lab_id', lab_id)
      .order("order_date", { ascending: false });

    // Apply location filtering
    const { shouldFilter, locationIds } = await database.shouldFilterByLocation();
    if (shouldFilter && locationIds.length > 0) {
      query = query.in('location_id', locationIds);
    }

    const { data: rows, error } = await query;

    if (error) {
      console.error("orders load error", error);
      return;
    }

    const orderRows = (rows || []) as any[]; // Use any temporarily to solve complex relation casting
    const orderIds = orderRows.map((o) => o.id);
    if (orderIds.length === 0) {
      setOrders([]);
      return;
    }

    // 2) view-based progress (Using ENHANCED view for TAT)
    const { data: prog, error: pErr } = await supabase
      .from("v_order_test_progress_enhanced")
      .select("*")
      .in("order_id", orderIds);

    if (pErr) console.error("progress view error", pErr);

    const byOrder = new Map<string, ProgressRow[]>();
    (prog || []).forEach((r) => {
      const arr = byOrder.get(r.order_id) || [];
      arr.push(r as ProgressRow);
      byOrder.set(r.order_id, arr);
    });

    // 3) invoice aggregation (aligned with Dashboard amount logic)
    const invoicePromises = orderIds.map(async (orderId) => {
      const { data: invoices } = await database.invoices.getAllByOrderId(orderId);
      if (!invoices || invoices.length === 0) {
        return { orderId, totalInvoiced: 0 };
      }

      let totalInvoiced = 0;
      for (const inv of invoices) {
        totalInvoiced += Number(inv.total_after_discount || inv.total || inv.subtotal || 0);
      }

      return { orderId, totalInvoiced };
    });
    const invoiceData = await Promise.all(invoicePromises);
    const invoiceMap = new Map(invoiceData.map((d) => [d.orderId, d]));

    // 4) shape cards with new buckets
    const cards: CardOrder[] = orderRows.map((o) => {
      const rows = byOrder.get(o.id) || [];
      const invoiceInfo = invoiceMap.get(o.id);
      const orderAmount = o.final_amount || o.total_amount || 0;
      const effectiveDisplayAmount = invoiceInfo?.totalInvoiced
        ? Math.max(invoiceInfo.totalInvoiced, orderAmount)
        : orderAmount;

      // Calculate dynamic expected date based on TAT (only when sample has been received)
      let calculatedExpectedDateMs = 0;
      let hasTatStartTime = false;
      rows.forEach((r) => {
        if (r.tat_hours && r.tat_start_time) {
          hasTatStartTime = true;
          const start = new Date(r.tat_start_time).getTime();
          const duration = Number(r.tat_hours) * 3600 * 1000;
          const end = start + duration;
          if (end > calculatedExpectedDateMs) {
            calculatedExpectedDateMs = end;
          }
        }
      });

      // TAT only starts after sample receipt — no fallback calculation before that
      const dynamicExpectedDate = calculatedExpectedDateMs > 0
        ? new Date(calculatedExpectedDateMs).toISOString()
        : o.expected_date;
      const tatStarted = hasTatStartTime;
      const panels: Panel[] = rows.map((r) => {
        // Check if this test group is outsourced
        const outsourcedTest = (o.order_tests || []).find((t: any) => t.test_group_id === r.test_group_id);
        const labInfo = Array.isArray(outsourcedTest?.outsourced_labs)
          ? outsourcedTest.outsourced_labs[0]
          : outsourcedTest?.outsourced_labs;

        // Get sample info from joined test_groups if not in view
        const testGroupInfo = (outsourcedTest as any)?.test_groups;
        const effectiveSampleType = r.sample_type || testGroupInfo?.sample_type;
        const effectiveSampleColor = r.sample_color || testGroupInfo?.sample_color;

        return {
          name: r.test_group_name || "Test",
          expected: r.expected_analytes || 0,
          entered: r.entered_analytes || 0,
          verified: !!r.is_verified,
          status: r.panel_status,
          isOutsourced: !!outsourcedTest?.outsourced_lab_id,
          outsourcedLab: labInfo?.name,
          sample_type: effectiveSampleType,
          sample_color: effectiveSampleColor,
          // TAT fields per panel
          hours_until_tat_breach: r.hours_until_tat_breach,
          is_tat_breached: r.is_tat_breached,
          tat_hours: r.tat_hours,
        };
      });

      // Calculate TAT aggregates (worst case: min hours remaining)
      let minHours: number | null = null;
      let isBreached = false;
      let maxTatHours: number | null = null;

      rows.forEach(r => {
        if (r.hours_until_tat_breach !== undefined && r.hours_until_tat_breach !== null) {
          if (minHours === null || r.hours_until_tat_breach < minHours) {
            minHours = r.hours_until_tat_breach;
          }
        }
        if (r.is_tat_breached) isBreached = true;
        if (r.tat_hours && (maxTatHours === null || r.tat_hours > maxTatHours)) {
          maxTatHours = r.tat_hours;
        }
      });


      // Calculate totals correctly
      const expectedTotal = panels.reduce((sum, p) => sum + p.expected, 0);
      const enteredTotal = panels.reduce((sum, p) => sum + Math.min(p.entered, p.expected), 0);

      // ✅ Fix: Calculate approved analytes correctly
      // Only count analytes from verified panels, not entire expected total
      const approvedAnalytes = panels.reduce((sum, p) => {
        if (p.verified || p.status === "Verified") {
          return sum + Math.min(p.entered, p.expected); // Only count entered analytes that are verified
        }
        return sum;
      }, 0);

      // ✅ Fix: Calculate pending and for-approval correctly
      const pendingAnalytes = Math.max(expectedTotal - enteredTotal, 0); // Not entered yet
      const forApprovalAnalytes = Math.max(enteredTotal - approvedAnalytes, 0); // Entered but not verified

      // Debug logging for verification (can be removed later)
      if (o.id && expectedTotal > 0) {
        console.debug(`Order ${o.id.slice(-6)}: Expected = ${expectedTotal}, Entered = ${enteredTotal}, Approved = ${approvedAnalytes}, Pending = ${pendingAnalytes}, ForApproval = ${forApprovalAnalytes} `);
      }

      return {
        id: o.id,
        lab_id: o.lab_id,
        location_id: o.location_id,
        patient_name: o.patient_name,
        patient_id: o.patient_id,
        status: o.status,
        priority: o.priority,
        order_date: o.order_date,
        expected_date: dynamicExpectedDate,
        total_amount: o.total_amount,
        final_amount: effectiveDisplayAmount,
        doctor: o.doctor,

        order_number: o.order_number ?? null,
        sample_id: o.sample_id,
        color_code: o.color_code,
        color_name: o.color_name,
        sample_collected_at: o.sample_collected_at,
        sample_collected_by: o.sample_collected_by,

        patient: o.patients,
        tests: (o.order_tests || []).map((t: any) => t.test_name),
        order_tests: o.order_tests || [], // ✅ Include full order_tests with outsourcing data

        panels,
        expectedTotal,
        enteredTotal,
        pendingAnalytes,
        forApprovalAnalytes,
        approvedAnalytes,

        hours_until_tat_breach: minHours,
        is_tat_breached: isBreached,
        tat_hours: maxTatHours,
        tatStarted
      };
    });

    // sort: date DESC, then daily seq DESC (002 above 001)
    const sorted = cards.sort((a, b) => {
      const dA = new Date(a.order_date).setHours(0, 0, 0, 0);
      const dB = new Date(b.order_date).setHours(0, 0, 0, 0);
      if (dA !== dB) return dB - dA;
      const nA = getDailySeq(a);
      const nB = getDailySeq(b);
      return nB - nA;
    });

    // dashboard summary (kept)
    const s = sorted.reduce(
      (acc, o) => {
        if (o.status === "Completed" || o.status === "Delivered" ||
            (o.expectedTotal > 0 && o.approvedAnalytes >= o.expectedTotal)) acc.allDone++;
        else if (o.status === "Pending Approval") acc.awaitingApproval++;
        else if (o.enteredTotal > 0 && o.enteredTotal >= o.expectedTotal * 0.75) acc.mostlyDone++;
        else acc.pending++;
        return acc;
      },
      { allDone: 0, mostlyDone: 0, pending: 0, awaitingApproval: 0 }
    );

    setOrders(sorted);
    setSummary(s);
  };

  /* ------------- filtering + grouping ------------- */
  const filtered = useMemo(() => {
    const q = (filters.q || "").toLowerCase();
    return orders.filter((o) => {
      // Search filter
      const matchesQ = !filters.q ||
        o.patient_name.toLowerCase().includes(q) ||
        (o.patient_id || "").toLowerCase().includes(q) ||
        (o.id || "").toLowerCase().includes(q) ||
        (o.doctor || "").toLowerCase().includes(q);

      // Status filter
      const matchesStatus = !filters.status || filters.status === "All" || 
        (filters.status === "Re-Run Requests" ? rerunByOrder.has(o.id) : o.status === filters.status);

      // Priority filter
      const matchesPriority = !filters.priority || filters.priority === "All" || o.priority === filters.priority;

      // Date range filter
      const matchesDateRange = () => {
        if (!filters.from && !filters.to) return true;
        const orderDate = new Date(o.order_date);
        const fromDate = filters.from ? new Date(filters.from) : null;
        const toDate = filters.to ? new Date(filters.to) : null;

        if (fromDate && orderDate < fromDate) return false;
        if (toDate && orderDate > toDate) return false;
        return true;
      };

      // Doctor filter
      const matchesDoctor = !filters.doctor ||
        (o.doctor || "").toLowerCase().includes((filters.doctor || "").toLowerCase());

      // Location filter
      const matchesLocation = !filters.locationId || o.location_id === filters.locationId;

      return matchesQ && matchesStatus && matchesPriority && matchesDateRange() && matchesDoctor && matchesLocation;
    });
  }, [orders, filters]);

  // Calculate order counts for filter bar
  const orderCounts = useMemo(() => {
    const total = orders.length;
    const byStatus: Record<string, number> = {};
    const byPriority: Record<string, number> = {};

    orders.forEach(order => {
      byStatus[order.status] = (byStatus[order.status] || 0) + 1;
      byPriority[order.priority] = (byPriority[order.priority] || 0) + 1;
    });

    return {
      total,
      byStatus,
      byPriority
    };
  }, [orders]);

  // Calculate filtered summary stats that update based on filters
  const filteredSummary = useMemo(() => {
    return filtered.reduce(
      (acc, o) => {
        if (o.status === "Completed" || o.status === "Delivered" ||
            (o.expectedTotal > 0 && o.approvedAnalytes >= o.expectedTotal)) acc.allDone++;
        else if (o.status === "Pending Approval") acc.awaitingApproval++;
        else if (o.enteredTotal > 0 && o.enteredTotal >= o.expectedTotal * 0.75) acc.mostlyDone++;
        else acc.pending++;
        return acc;
      },
      { allDone: 0, mostlyDone: 0, pending: 0, awaitingApproval: 0 }
    );
  }, [filtered]);

  // Transform orders for EnhancedOrdersPage
  const transformedOrdersForEnhanced = useMemo(() => {
    return filtered.map(order => ({
      id: order.id,
      patient_id: order.patient_id,
      patient_name: order.patient_name,
      status: order.status,
      total_amount: order.final_amount ?? order.total_amount,
      order_date: order.order_date,
      created_at: order.order_date,
      sample_id: order.sample_id || undefined,
      sample_type: order.sample_type,
      color_name: order.color_name || undefined,
      tests: order.tests,
      can_add_tests: !['Completed', 'Delivered'].includes(order.status),
      visit_group_id: order.sample_id ? `sample - ${order.sample_id} ` : `${order.patient_id} -${order.order_date.slice(0, 10)} `,
      order_type: 'initial' as const
    }));
  }, [filtered]);

  type Group = { key: string; label: string; orders: CardOrder[] };
  const groups: Group[] = useMemo(() => {
    const map = new Map<string, { date: Date; orders: CardOrder[] }>();
    filtered.forEach((o) => {
      const d = new Date(o.order_date);
      d.setHours(0, 0, 0, 0);
      const k = d.toISOString().slice(0, 10);
      map.set(k, map.get(k) || { date: d, orders: [] });
      map.get(k)!.orders.push(o);
    });

    return Array.from(map.entries())
      .sort((a, b) => b[1].date.getTime() - a[1].date.getTime())
      .map(([key, v]) => ({
        key,
        label: v.date.toLocaleDateString("en-IN", {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric",
        }),
        orders: v.orders.sort((a, b) => {
          const nA = getDailySeq(a);
          const nB = getDailySeq(b);
          if (nA !== nB) return nB - nA;
          return new Date(b.order_date).getTime() - new Date(a.order_date).getTime();
        }),
      }));
  }, [filtered]);

  const openDetails = (o: CardOrder) => { setOpenOnResults(false); setSelectedOrder(o); };
  const openResultEntry = (o: CardOrder) => { setOpenOnResults(true); setSelectedOrder(o); };

  // Enhanced view handlers
  const handleAddOrder = async (orderData: any) => {
    try {
      console.log('Creating new order:', orderData);
      console.log('Tests array:', orderData.tests, 'Length:', orderData.tests?.length);
      console.log('Test objects structure:', orderData.tests?.[0]);

      // Validate required fields before API call
      if (!orderData.patient_id) {
        alert('❌ Error: Patient is required');
        throw new Error('Patient is required');
      }

      if (!orderData.referring_doctor_id && !orderData.doctor) {
        alert('❌ Error: Referring doctor is required');
        throw new Error('Referring doctor is required');
      }

      // Create the order in the database
      const { data: order, error: orderError } = await database.orders.create(orderData);
      if (orderError) {
        console.error('Error creating order:', orderError);
        const errorMessage = orderError.message || 'Failed to create order';
        alert(`❌ Order Creation Failed: ${errorMessage} `);
        throw orderError;
      }

      console.log('Order created successfully:', order);

      // Update any pending TRF attachments to link to this order - ONLY for current user + lab + recent uploads
      const PENDING_ORDER_UUID = '00000000-0000-0000-0000-000000000000';
      const { data: currentUser } = await supabase.auth.getUser();
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      
      const { error: updateError } = await supabase
        .from('attachments')
        .update({ related_id: order.id, order_id: order.id })
        .eq('related_table', 'orders')
        .eq('related_id', PENDING_ORDER_UUID)
        .eq('description', 'Test Request Form for order creation')
        .eq('uploaded_by', currentUser?.user?.id) // Only current user's uploads
        .eq('lab_id', labId) // Only current lab
        .gte('upload_timestamp', oneHourAgo); // Only recent uploads (within 1 hour)

      if (updateError) {
        console.warn('Failed to update TRF attachment:', updateError);
        // Non-critical error, continue with order creation
      } else {
        console.log('Updated TRF attachment to link to order:', order.id);
      }

      // ✅ AUTO-CREATE SAMPLES: Generate samples based on test group requirements
      try {
        // Import sample service dynamically to avoid circular dependencies
        const { createSamplesForOrder } = await import('../services/sampleService');

        // Fetch order_test_groups with test_group info for sample creation
        const { data: orderTestGroups, error: otgError } = await supabase
          .from('order_test_groups')
          .select(`
    id,
      order_id,
      test_group_id,
      test_name,
      test_groups!inner(sample_type, sample_color)
          `)
          .eq('order_id', order.id);

        if (otgError) {
          console.error('Error fetching order test groups for sample creation:', otgError);
        } else if (!orderTestGroups || orderTestGroups.length === 0) {
          console.warn('⚠️ No order test groups found for sample creation. Samples will NOT be created for Order:', order.id);
        } else {
          // Transform data to match service interface
          const testGroupsWithInfo = orderTestGroups.map(otg => {
            // Handle potential array return from join
            const groupData = Array.isArray(otg.test_groups) ? otg.test_groups[0] : otg.test_groups;
            return {
              id: otg.id,
              order_id: otg.order_id,
              test_group_id: otg.test_group_id,
              test_name: otg.test_name,
              test_group: {
                sample_type: (groupData as any)?.sample_type || 'Blood',
                sample_color: (groupData as any)?.sample_color
              }
            };
          });

          // Create samples
          const samples = await createSamplesForOrder(
            order.id,
            testGroupsWithInfo,
            order.lab_id,
            order.patient_id
          );

          console.log(`✅ Created ${samples.length} sample(s) for order ${order.id}: `, samples);
        }
      } catch (sampleError) {
        console.error('Error creating samples (non-critical):', sampleError);
        // Don't fail the order creation if sample generation fails
      }

      // ✅ OPTIMIZED: Instead of re-fetching all orders, fetch only the new order with required data
      const lab_id = await database.getCurrentUserLabId();
      if (lab_id) {
        const { data: newOrderData, error: fetchError } = await supabase
          .from("orders")
          .select(`
    id, lab_id, patient_id, patient_name, status, priority, order_date, expected_date, total_amount, final_amount, doctor,
      order_number, sample_id, color_code, color_name, sample_collected_at, sample_collected_by,
      patients(name, age, gender),
      order_tests(id, test_group_id, test_name, outsourced_lab_id, outsourced_labs(name))
        `)
          .eq('id', order.id)
          .eq('lab_id', lab_id)
          .single();

        if (!fetchError && newOrderData) {
          // Transform the new order into CardOrder format
          const orderRow = newOrderData as any;

          // Fetch progress for this order only
          const { data: prog } = await supabase
            .from("v_order_test_progress")
            .select("*")
            .eq("order_id", order.id);

          const rows = (prog || []) as ProgressRow[];
          const panels: Panel[] = rows.map((r) => {
            const outsourcedTest = orderRow.order_tests?.find((ot: any) =>
              ot.test_group_id === r.test_group_id && ot.outsourced_lab_id
            );

            return {
              name: r.test_group_name || "Test",
              expected: r.expected_analytes || 0,
              entered: r.entered_analytes || 0,
              verified: !!r.is_verified,
              status: r.panel_status,
              isOutsourced: !!outsourcedTest,
              outsourcedLab: outsourcedTest?.outsourced_labs?.name,
              sample_type: r.sample_type,
              sample_color: r.sample_color,
            };
          });

          const expectedTotal = panels.reduce((sum, p) => sum + p.expected, 0);
          const enteredTotal = panels.reduce((sum, p) => sum + Math.min(p.entered, p.expected), 0);
          const approvedAnalytes = panels.reduce((sum, p) => {
            if (p.verified || p.status === "Verified") {
              return sum + Math.min(p.entered, p.expected);
            }
            return sum;
          }, 0);
          const pendingAnalytes = Math.max(expectedTotal - enteredTotal, 0);
          const forApprovalAnalytes = Math.max(enteredTotal - approvedAnalytes, 0);

          const newCardOrder: CardOrder = {
            id: orderRow.id,
            lab_id: orderRow.lab_id,
            patient_name: orderRow.patient_name,
            patient_id: orderRow.patient_id,
            status: orderRow.status,
            priority: orderRow.priority,
            order_date: orderRow.order_date,
            expected_date: orderRow.expected_date,
            total_amount: orderRow.total_amount,
            final_amount: orderRow.final_amount || orderRow.total_amount,
            doctor: orderRow.doctor,
            order_number: orderRow.order_number ?? null,
            sample_id: orderRow.sample_id,
            color_code: orderRow.color_code,
            color_name: orderRow.color_name,
            sample_collected_at: orderRow.sample_collected_at,
            sample_collected_by: orderRow.sample_collected_by,
            patient: orderRow.patients,
            tests: (orderRow.order_tests || []).map((t: any) => t.test_name),
            order_tests: orderRow.order_tests || [],
            panels,
            expectedTotal,
            enteredTotal,
            pendingAnalytes,
            forApprovalAnalytes,
            approvedAnalytes,
          };

          // Add new order to the beginning of the orders array
          setOrders(prev => [newCardOrder, ...prev]);
          console.log('✅ Added new order to list without full re-fetch');
        } else {
          console.warn('Failed to fetch new order data, falling back to full refresh');
          await fetchOrders();
        }
      } else {
        // Fallback to full refresh if no lab_id
        await fetchOrders();
      }

      // Close the form
      setShowOrderForm(false);

      // Show success message
      alert('✅ Order created successfully!');

      // Return the order so OrderForm can use it for invoice/payment creation
      return order;
    } catch (error: any) {
      console.error('Error creating order:', error);
      // Don't close form on error so user can fix issues
      // Error message already shown above
      throw error; // Re-throw so OrderForm knows creation failed
    }
  };

  const handleUpdateStatus = async () => {
    // Centralized components perform the update; here we only refresh data
    await fetchOrders();
  };

  const handleNewSession = () => {
    setShowOrderForm(true);
  };

  const handleNewPatientVisit = () => {
    setShowOrderForm(true);
  };

  // If enhanced view is selected, render EnhancedOrdersPage
  if (viewMode === 'enhanced') {
    return (
      <div className="space-y-6">
        {/* View Mode Toggle */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Test Orders</h1>

            {/* Realtime Connection Indicator */}
            <div className={`flex items - center gap - 1.5 px - 2 py - 1 rounded - full text - xs font - medium ${realtimeConnected
              ? 'bg-green-100 text-green-700'
              : 'bg-gray-100 text-gray-500'
              } `}>
              <span className={`w - 2 h - 2 rounded - full ${realtimeConnected ? 'bg-green-500' : 'bg-gray-400'
                } `}></span>
              {realtimeConnected ? 'Live' : 'Offline'}
            </div>

            <div className="flex items-center space-x-2 bg-gray-100 rounded-lg p-1">
              <button
                onClick={() => setViewMode('standard')}
                className="flex items-center px-3 py-1.5 rounded-md text-sm font-medium transition-colors text-gray-600 hover:text-gray-800"
              >
                <ToggleLeft className="h-4 w-4 mr-1" />
                Standard View
              </button>
              <button
                onClick={() => setViewMode('enhanced')}
                className="flex items-center px-3 py-1.5 rounded-md text-sm font-medium transition-colors bg-white text-blue-600 shadow-sm"
              >
                <ToggleRight className="h-4 w-4 mr-1" />
                Patient Visits
              </button>
            </div>
          </div>
        </div>

        {/* Filters Bar */}
        <OrderFiltersBar
          value={filters}
          onChange={setFilters}
          orderCounts={orderCounts}
          locations={locations}
        />

        <EnhancedOrdersPage
          orders={transformedOrdersForEnhanced}
          onAddOrder={handleAddOrder}
          onUpdateStatus={handleUpdateStatus}
          onRefreshOrders={fetchOrders}
          onNewSession={handleNewSession}
          onNewPatientVisit={handleNewPatientVisit}
        />

        {/* Modals */}
        {showOrderForm && (
          <OrderForm
            onClose={() => setShowOrderForm(false)}
            onSubmit={handleAddOrder}
          />
        )}

        {selectedOrder && (
          <OrderDetailsModal
            order={{
              ...selectedOrder,
              doctor: selectedOrder.doctor || '',
              sample_id: selectedOrder.sample_id || undefined,
              color_code: selectedOrder.color_code || undefined,
              color_name: selectedOrder.color_name || undefined,
              sample_collected_at: selectedOrder.sample_collected_at || undefined,
              sample_collected_by: selectedOrder.sample_collected_by || undefined
            }}
            initialTab={openOnResults ? "results" : "details"}
            onClose={() => { setSelectedOrder(null); setOpenOnResults(false); }}
            onUpdateStatus={handleUpdateStatus}
            onSubmitResults={async (_orderId: string, _resultsData: any[]) => {
              console.log('onSubmitResults called');
              await fetchOrders();
              setSelectedOrder(null);
              setOpenOnResults(false);
            }}
          />
        )}
      </div>
    );
  }

  /* ===========================
     Standard UI
  =========================== */

  return (
    <div className="space-y-6">
      {/* Header with View Mode Toggle */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center space-x-4">
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Test Orders</h1>
          <div className="flex items-center space-x-2 bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => setViewMode('standard')}
              className="flex items-center px-3 py-1.5 rounded-md text-sm font-medium transition-colors bg-white text-blue-600 shadow-sm"
            >
              <ToggleLeft className="h-4 w-4 mr-1" />
              Standard View
            </button>
            <button
              onClick={() => setViewMode('enhanced')}
              className="flex items-center px-3 py-1.5 rounded-md text-sm font-medium transition-colors text-gray-600 hover:text-gray-800"
            >
              <ToggleRight className="h-4 w-4 mr-1" />
              Patient Visits
            </button>
          </div>
        </div>
      </div>

      {/* Overview cards */}
      {/* Overview cards - Compact Mobile Grid */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 md:gap-4">
        <div className="bg-green-50 border border-green-200 rounded-lg p-3 md:p-4 relative overflow-hidden">
          <div className="relative z-10">
            <div className="text-xl md:text-2xl font-bold text-green-900">{filteredSummary.allDone}</div>
            <div className="text-xs md:text-sm text-green-700 font-medium">All Done</div>
          </div>
          <CheckCircle className="absolute right-2 bottom-2 h-8 w-8 text-green-500/20 md:static md:h-5 md:w-5 md:text-white md:bg-green-500 md:p-1 md:rounded-lg md:opacity-100" />
        </div>
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 md:p-4 relative overflow-hidden">
          <div className="relative z-10">
            <div className="text-xl md:text-2xl font-bold text-blue-900">{filteredSummary.mostlyDone}</div>
            <div className="text-xs md:text-sm text-blue-700 font-medium">Mostly Done</div>
          </div>
          <TrendingUp className="absolute right-2 bottom-2 h-8 w-8 text-blue-500/20 md:static md:h-5 md:w-5 md:text-white md:bg-blue-500 md:p-1 md:rounded-lg md:opacity-100" />
        </div>
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 md:p-4 relative overflow-hidden">
          <div className="relative z-10">
            <div className="text-xl md:text-2xl font-bold text-yellow-900">{filteredSummary.pending}</div>
            <div className="text-xs md:text-sm text-yellow-700 font-medium">Pending</div>
          </div>
          <ClockIcon className="absolute right-2 bottom-2 h-8 w-8 text-yellow-500/20 md:static md:h-5 md:w-5 md:text-white md:bg-yellow-500 md:p-1 md:rounded-lg md:opacity-100" />
        </div>
        <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 md:p-4 relative overflow-hidden">
          <div className="relative z-10">
            <div className="text-xl md:text-2xl font-bold text-orange-900">{filteredSummary.awaitingApproval}</div>
            <div className="text-xs md:text-sm text-orange-700 font-medium">Approval</div>
          </div>
          <AlertTriangle className="absolute right-2 bottom-2 h-8 w-8 text-orange-500/20 md:static md:h-5 md:w-5 md:text-white md:bg-orange-500 md:p-1 md:rounded-lg md:opacity-100" />
        </div>
        {/* RE-RUN Requests Card */}
        <div 
          onClick={() => totalRerunCount > 0 && setFilters(f => ({ ...f, status: filters.status === 'Re-Run Requests' ? 'All' : 'Re-Run Requests' }))}
          className={`border rounded-lg p-3 md:p-4 relative overflow-hidden cursor-pointer transition-all ${totalRerunCount > 0 ? 'bg-red-50 border-red-300 ring-2 ring-red-400 ring-opacity-50' : 'bg-gray-50 border-gray-200'} ${filters.status === 'Re-Run Requests' ? 'ring-2 ring-red-600 ring-opacity-80' : ''}`}>
          <div className="relative z-10">
            <div className={`text-xl md:text-2xl font-bold ${totalRerunCount > 0 ? 'text-red-900 animate-pulse' : 'text-gray-600'}`}>
              {totalRerunCount}
            </div>
            <div className={`text-xs md:text-sm font-medium ${totalRerunCount > 0 ? 'text-red-700' : 'text-gray-500'}`}>
              RE-RUN Requests
            </div>
            {totalRerunCount > 0 && (
              <div className="text-xs text-red-600 mt-1">
                {rerunRequests.length} order{rerunRequests.length !== 1 ? 's' : ''}
              </div>
            )}
          </div>
          <RefreshCcw className={`absolute right-2 bottom-2 h-8 w-8 md:static md:h-5 md:w-5 md:p-1 md:rounded-lg md:opacity-100 ${totalRerunCount > 0 ? 'text-red-500/20 md:text-white md:bg-red-500 animate-spin-slow' : 'text-gray-400/20 md:text-white md:bg-gray-400'}`} />
        </div>
      </div>

      {/* Filters Bar */}
      <OrderFiltersBar
        value={filters}
        onChange={setFilters}
        orderCounts={orderCounts}
        locations={locations}
      />

      {/* Groups + Cards */}
      <div className="bg-white rounded-lg border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">Test Orders ({filtered.length})</h3>
        </div>

        {groups.length === 0 ? (
          <div className="text-center py-12">
            <TestTube className="h-12 w-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-600">No Orders Found</p>
          </div>
        ) : (
          <div className="space-y-8">
            {groups.map((g) => (
              <div key={g.key} className="px-6">
                <div className="flex items-center justify-between py-4 border-b-2 mb-6 border-gray-200">
                  <h4 className="text-lg font-semibold text-gray-700">{g.label}</h4>
                  <div className="text-sm text-gray-500">{g.orders.length} order{g.orders.length !== 1 ? "s" : ""}</div>
                </div>

                <div className="space-y-4">
                  {g.orders.map((o) => {
                    const pct = o.expectedTotal > 0 ? Math.round((o.enteredTotal / o.expectedTotal) * 100) : 0;
                    const canAddTests = !['Completed', 'Delivered'].includes(o.status);
                    const visiblePanels = mobile.isMobile ? o.panels.slice(0, 2) : o.panels;
                    const hiddenPanelCount = Math.max(0, o.panels.length - visiblePanels.length);
                    const visibleTests = mobile.isMobile ? o.tests.slice(0, 2) : o.tests;
                    const hiddenTestCount = Math.max(0, o.tests.length - visibleTests.length);

                    // Debug logging
                    if (pct === 0 && o.expectedTotal > 0) {
                      console.debug(`⚠️ Order ${o.sample_id}: pct=0 but expected=${o.expectedTotal}, entered=${o.enteredTotal}, panels=`, o.panels.map(p => ({ name: p.name, entered: p.entered, expected: p.expected })));
                    }

                    return (
                      <div
                        key={o.id}
                        role="button"
                        onClick={() => openDetails(o)}
                        className="w-full p-3 md:p-4 border rounded-lg hover:shadow-md transition-all cursor-pointer border-gray-200 bg-white"
                      >
                        {/* Top row */}
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-2 md:gap-3">
                            <div className="flex items-center justify-center w-6 h-6 md:w-8 md:h-8 bg-blue-100 text-blue-700 rounded-full font-bold text-xs md:text-sm border border-blue-200">
                              {String(getDailySeq(o)).padStart(3, "0")}
                            </div>
                            <div className="flex items-center gap-2 md:gap-3">
                              <User className="h-5 w-5 md:h-6 md:w-6 text-blue-600 shrink-0" />
                              <div>
                                <div className="text-base md:text-2xl font-bold text-gray-900 leading-tight">
                                  {o.patient?.name || o.patient_name}
                                </div>
                                <div className="text-xs md:text-base text-gray-700">
                                  {formatAge(o.patient?.age, (o.patient as any)?.age_unit)} • {o.patient?.gender || "N/A"}
                                  <span className="hidden sm:inline"> • ID: {o.patient_id}</span>
                                </div>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-1 md:gap-2" onClick={(e) => e.stopPropagation()}>
                            {/* RE-RUN Request Badge */}
                            {rerunByOrder.has(o.id) && (
                              <span className="inline-flex items-center px-2 py-0.5 md:px-2.5 md:py-1 rounded-lg text-xs md:text-sm font-bold border bg-red-100 text-red-800 border-red-300 whitespace-nowrap animate-pulse">
                                <RefreshCcw className="h-3 w-3 md:h-3.5 md:w-3.5 mr-1" />
                                RE-RUN ({rerunByOrder.get(o.id)?.count})
                              </span>
                            )}
                            <span className="inline-flex items-center px-2 py-0.5 md:px-3 md:py-1.5 rounded-lg text-xs md:text-sm font-bold border bg-blue-100 text-blue-800 border-blue-200 whitespace-nowrap">
                              {o.status === "In Progress" ? "In Process" : o.status}
                            </span>
                            <button
                              className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg"
                              onClick={() => setExpanded((prev) => ({ ...prev, [o.id]: !prev[o.id] }))}
                            >
                              {expanded[o.id] ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
                            </button>
                          </div>
                        </div>

                        {/* TAT Badge (New) */}
                        <div className="mt-1 flex justify-end">
                          <TATStatusBadge
                            hoursUntilBreach={o.hours_until_tat_breach ?? null}
                            isBreached={o.is_tat_breached ?? null}
                            tatHours={o.tat_hours ?? null}
                            compact={true}
                          />
                        </div>

                        {/* Middle: sample + tests */}
                        <div className="mt-3 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 bg-gray-50 rounded-lg p-3">
                          <div className="flex flex-col sm:flex-row sm:items-center gap-6">
                            <div className="min-w-[110px]">
                              <div className="flex flex-col items-start gap-1">
                                <span className="text-xs text-gray-500 font-mono bg-white px-2 py-0.5 rounded border">
                                  {o.sample_id ? `#${String(o.sample_id).split("-").pop()} ` : 'No Sample'}
                                </span>
                                <SampleTypeGroup
                                  samples={o.panels.map(p => ({ sampleType: p.sample_type || 'Blood', sampleColor: p.sample_color }))}
                                  size="sm"
                                />
                              </div>
                            </div>

                            {o.sample_id && (
                              <div className="hidden sm:flex items-center gap-2">
                                <div
                                  className="w-8 h-8 rounded-full border-2 border-white shadow-md flex items-center justify-center text-white font-bold text-xs"
                                  style={{ backgroundColor: o.color_code || "#8B5CF6" }}
                                  title={`Sample Color: ${o.color_code || "N/A"} `}
                                >
                                  {(o.color_name || "Tube").charAt(0)}
                                </div>
                                <div>
                                  <div className="text-xs text-gray-600">Sample</div>
                                  <div className="font-mono font-bold text-gray-900 text-sm">
                                    {String(o.sample_id).split("-").pop()}
                                  </div>
                                </div>
                              </div>
                            )}

                            <div className="flex-1">
                              <div className="text-sm text-gray-600 mb-1">
                                Tests ({o.tests.length})
                                {(() => {
                                  const orderTests = (o as any).order_tests || [];
                                  const outsourcedCount = orderTests.filter((ot: any) => ot.outsourced_lab_id).length;
                                  if (outsourcedCount > 0) {
                                    return (
                                      <span className="ml-2 inline-flex items-center gap-0.5 px-1.5 py-0.5 text-xs font-medium bg-orange-100 text-orange-700 rounded">
                                        🏥 {outsourcedCount} outsourced
                                      </span>
                                    );
                                  }
                                  return null;
                                })()}
                              </div>
                              <div className="flex flex-wrap gap-3">
                                {o.panels.length > 0
                                  ? visiblePanels.map((p, i) => {
                                    const progress = p.expected > 0 ? (p.entered / p.expected) * 100 : 0;

                                    // Modern minimalistic colors based on progress
                                    const getMinimalColor = (percent: number, isOutsourced?: boolean) => {
                                      if (isOutsourced) return "bg-purple-50 border-purple-200 text-purple-800";
                                      if (percent === 0) return "bg-gray-100 border-gray-300 text-gray-700";
                                      if (percent < 40) return "bg-red-50 border-red-200 text-red-800";
                                      if (percent < 70) return "bg-orange-50 border-orange-200 text-orange-800";
                                      if (percent < 90) return "bg-yellow-50 border-yellow-200 text-yellow-800";
                                      return "bg-green-50 border-green-200 text-green-800";
                                    };

                                    const colorClass = getMinimalColor(progress, p.isOutsourced);

                                    return (
                                      <div
                                        key={`${p.name} -${i} `}
                                        className={`border rounded - lg px - 3 py - 2 transition - all duration - 300 ${colorClass} `}
                                      >
                                        <div className="font-medium text-sm mb-1 flex items-center gap-1">
                                          {p.isOutsourced && <span>🏥</span>}
                                          {p.name}
                                          {/* TAT indicator per panel */}
                                          {p.tat_hours && !p.isOutsourced && (
                                            <span 
                                              className={`ml-1 text-xs px-1 py-0.5 rounded ${
                                                p.is_tat_breached 
                                                  ? 'bg-red-500 text-white animate-pulse' 
                                                  : p.hours_until_tat_breach !== null && p.hours_until_tat_breach !== undefined && p.hours_until_tat_breach < 2 
                                                    ? 'bg-yellow-400 text-yellow-900' 
                                                    : 'bg-gray-200 text-gray-600'
                                              }`}
                                              title={`TAT: ${p.tat_hours}h | ${p.is_tat_breached ? 'BREACHED' : p.hours_until_tat_breach !== null ? `${p.hours_until_tat_breach.toFixed(1)}h left` : 'Not started'}`}
                                            >
                                              {p.is_tat_breached ? '⏰!' : `${p.tat_hours}h`}
                                            </span>
                                          )}
                                        </div>
                                        <div className="flex items-center justify-between text-xs">
                                          {p.isOutsourced ? (
                                            <>
                                              <span className="font-medium">Outsourced</span>
                                              <span className="text-xs opacity-75 truncate max-w-[80px]" title={p.outsourcedLab}>
                                                {p.outsourcedLab || 'External Lab'}
                                              </span>
                                            </>
                                          ) : (
                                            <>
                                              <span className="font-mono">
                                                {p.entered}/{p.expected} analytes
                                              </span>
                                              <span className="text-xs opacity-75">
                                                {progress === 0 ? "Pending" : progress < 100 ? "Partial" : "Complete"}
                                              </span>
                                            </>
                                          )}
                                        </div>
                                      </div>
                                    );
                                  })
                                  : visibleTests.map((t, i) => {
                                    // Find corresponding order_test to check outsourcing status
                                    const orderTests = (o as any).order_tests || [];
                                    const orderTest = orderTests.find((ot: any) => ot.test_name === t);
                                    const isOutsourced = orderTest?.outsourced_lab_id;

                                    return (
                                      <span
                                        key={i}
                                        className={`px - 2 py - 1 rounded text - sm ${isOutsourced
                                          ? 'bg-orange-100 text-orange-800 border border-orange-200'
                                          : 'bg-blue-100 text-blue-800'
                                          } `}
                                      >
                                        {isOutsourced && '🏥 '}{t}
                                      </span>
                                    );
                                  })}
                                {o.panels.length > 0 && hiddenPanelCount > 0 && (
                                  <span className="px-2 py-1 rounded text-xs bg-gray-100 text-gray-700 border border-gray-200">
                                    +{hiddenPanelCount} more
                                  </span>
                                )}
                                {o.panels.length === 0 && hiddenTestCount > 0 && (
                                  <span className="px-2 py-1 rounded text-xs bg-gray-100 text-gray-700 border border-gray-200">
                                    +{hiddenTestCount} more
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="text-right">
                            <div className="text-xl sm:text-2xl font-bold text-green-600">
                              ₹{Number(o.final_amount ?? o.total_amount ?? 0).toLocaleString()}
                            </div>
                            <div className="text-sm text-gray-600">
                              <div>Ordered: {new Date(o.order_date).toLocaleDateString()}</div>
                                {!o.tatStarted ? (
                                  <div className="text-amber-600 font-medium text-xs">
                                    ⏳ TAT starts after collection
                                  </div>
                                ) : (
                                  <div className={`${new Date(o.expected_date) < new Date() ? "text-red-600 font-bold" : ""} `}>
                                    Expected: {mobile.isMobile
                                      ? new Date(o.expected_date).toLocaleDateString()
                                      : new Date(o.expected_date).toLocaleString(undefined, { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                    {new Date(o.expected_date) < new Date() && " ⚠️ OVERDUE"}
                                  </div>
                                )}
                              </div>

                            {/* Updated button section with Add Tests functionality */}
                            <div className="mt-3 flex flex-col sm:flex-row gap-2">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openDetails(o);
                                }}
                                className="inline-flex items-center px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                              >
                                <Eye className="h-4 w-4 mr-1" />
                                View Details
                              </button>

                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openResultEntry(o);
                                }}
                                className="inline-flex items-center px-3 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700"
                              >
                                <TestTube className="h-4 w-4 mr-1" />
                                Enter Results
                              </button>

                              {canAddTests && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleAddTests(o.id);
                                  }}
                                  className="hidden sm:inline-flex items-center px-3 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700"
                                >
                                  <Plus className="h-4 w-4 mr-1" />
                                  Add Tests
                                </button>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Enhanced Progress + legend */}
                        <div className="mt-3 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg p-3 border border-blue-200">
                          <div className="flex items-center justify-between text-sm mb-2">
                            <span className="text-blue-800 font-semibold flex items-center">
                              📊 Overall Progress
                            </span>
                            <span className="text-blue-800 font-bold text-base">
                              {o.enteredTotal}/{o.expectedTotal} analytes
                            </span>
                          </div>

                          {/* Enhanced progress bar with dynamic colors and segments */}
                          <div className="relative w-full bg-gray-200 rounded-full h-4 mb-3 overflow-hidden border">
                            {/* Background gradient based on overall progress */}
                            <div
                              className="absolute left-0 top-0 h-4 transition-all duration-700 rounded-full"
                              style={{
                                width: `${pct}% `,
                                background: pct === 0 ? '#ef4444' : // red
                                  pct < 25 ? `linear - gradient(90deg, #ef4444 0 %, #f97316 100 %)` : // red to orange
                                    pct < 50 ? `linear - gradient(90deg, #f97316 0 %, #eab308 100 %)` : // orange to yellow  
                                      pct < 75 ? `linear - gradient(90deg, #eab308 0 %, #84cc16 100 %)` : // yellow to lime
                                        pct < 100 ? `linear - gradient(90deg, #84cc16 0 %, #22c55e 100 %)` : // lime to green
                                          '#10b981', // emerald
                                boxShadow: pct > 0 ? `0 0 12px ${pct < 50 ? '#ef444440' : '#22c55e40'} ` : 'none'
                              }}
                            />

                            {/* Approved segment overlay (darker green) */}
                            <div
                              className="absolute left-0 top-0 h-4 bg-green-600 transition-all duration-500 rounded-full opacity-80"
                              style={{ width: `${o.expectedTotal > 0 ? (o.approvedAnalytes / o.expectedTotal) * 100 : 0}% ` }}
                            />

                            {/* Progress indicator line */}
                            <div
                              className="absolute top-0 w-0.5 h-4 bg-white shadow-lg"
                              style={{ left: `${pct}% ` }}
                            />

                            {/* Sparkle effect for high progress */}
                            {pct > 75 && (
                              <div className="absolute inset-0 rounded-full opacity-30">
                                <div className="absolute top-1 left-1/4 w-1 h-1 bg-white rounded-full animate-pulse" />
                                <div className="absolute top-2 right-1/3 w-0.5 h-0.5 bg-white rounded-full animate-pulse delay-150" />
                                <div className="absolute bottom-1 left-2/3 w-1 h-1 bg-white rounded-full animate-pulse delay-300" />
                              </div>
                            )}
                          </div>

                          {/* Enhanced legend with better spacing and icons */}
                          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 text-sm">
                            <div className="inline-flex items-center bg-white rounded-md px-2 py-1 border border-gray-200">
                              <span className="inline-block w-3 h-3 bg-red-400 rounded-full mr-2 shadow-sm" />
                              <span className="text-gray-700">Pending: <strong>{o.pendingAnalytes}</strong></span>
                            </div>
                            <div className="inline-flex items-center bg-white rounded-md px-2 py-1 border border-amber-200">
                              <span className="inline-block w-3 h-3 bg-amber-500 rounded-full mr-2 shadow-sm" />
                              <span className="text-amber-700">For approval: <strong>{o.forApprovalAnalytes}</strong></span>
                            </div>
                            <div className="inline-flex items-center bg-white rounded-md px-2 py-1 border border-green-200">
                              <span className="inline-block w-3 h-3 bg-green-500 rounded-full mr-2 shadow-sm" />
                              <span className="text-green-700">Approved: <strong>{o.approvedAnalytes}</strong></span>
                            </div>
                            <div className="inline-flex items-center bg-white rounded-md px-2 py-1 border border-blue-200 lg:justify-end">
                              <span className={`font - bold ${pct < 25 ? 'text-red-600' : pct < 50 ? 'text-orange-600' : pct < 75 ? 'text-yellow-600' : pct < 100 ? 'text-lime-600' : 'text-green-600'} `}>
                                {pct < 25 ? '🔴' : pct < 50 ? '🟠' : pct < 75 ? '🟡' : pct < 100 ? '🟢' : '✅'} Total: {o.expectedTotal}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer stats */}
      <div className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg p-4 border border-blue-200">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-sm">
          <div className="flex items-center gap-6">
            <div className="flex items-center">
              <Calendar className="h-4 w-4 text-blue-600 mr-1" />
              <span className="text-blue-900 font-medium">Total Orders: {orders.length}</span>
            </div>
            <div className="flex items-center">
              <AlertTriangle className="h-4 w-4 text-red-600 mr-1" />
              <span className="text-red-900 font-medium">
                Overdue: {orders.filter((o) => new Date(o.expected_date).setHours(0, 0, 0, 0) < new Date().setHours(0, 0, 0, 0)).length}
              </span>
            </div>
          </div>
          <div className="flex items-center">
            <TrendingUp className="h-4 w-4 text-purple-600 mr-1" />
            <span className="text-purple-900 font-medium">
              Avg TAT:{" "}
              {orders.length
                ? Math.round(
                  orders.reduce((sum, o) => {
                    const diffHrs = (Date.now() - new Date(o.order_date).getTime()) / 36e5;
                    return sum + diffHrs;
                  }, 0) / orders.length
                )
                : 0}
              h
            </span>
          </div>
        </div>
      </div>

      {/* Modals */}
      {showOrderForm && (
        <OrderForm
          onClose={() => setShowOrderForm(false)}
          onSubmit={handleAddOrder}
        />
      )}

      {selectedOrder && (
        <OrderDetailsModal
          order={{
            ...selectedOrder,
            doctor: selectedOrder.doctor || '',
            sample_id: selectedOrder.sample_id || undefined,
            color_code: selectedOrder.color_code || undefined,
            color_name: selectedOrder.color_name || undefined,
            sample_collected_at: selectedOrder.sample_collected_at || undefined,
            sample_collected_by: selectedOrder.sample_collected_by || undefined
          }}
          initialTab={openOnResults ? "results" : "details"}
          onClose={() => { setSelectedOrder(null); setOpenOnResults(false); }}
          onUpdateStatus={handleUpdateStatus}
          onSubmitResults={async (_orderId: string, _resultsData: any[]) => {
            console.log('onSubmitResults called');
            await fetchOrders();
            setSelectedOrder(null);
          }}
        />
      )}

      {/* Add Test Selection Modal */}
      {showAddTestModal && selectedOrderId && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-75 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 bg-blue-50">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900">Add Tests to Order</h3>
                <button
                  onClick={() => {
                    setShowAddTestModal(false);
                    setSelectedOrderId(null);
                    setSelectedTests([]);
                    setSearchQuery('');
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="h-6 w-6" />
                </button>
              </div>
              <p className="text-sm text-gray-600 mt-1">
                Order ID: {selectedOrderId?.slice(-6)} • Select tests to add to this order
              </p>
            </div>

            <div className="p-6 overflow-y-auto max-h-[60vh]">
              {/* Search */}
              <div className="mb-4">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search tests and packages..."
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>

              {/* Loading state */}
              {isLoadingTests ? (
                <div className="text-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
                  <p className="text-gray-600 mt-2">Loading tests...</p>
                </div>
              ) : (
                /* Tests grid */
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-96 overflow-y-auto">
                  {filteredTests.map((test) => {
                    const isSelected = selectedTests.some(t => t.id === test.id);
                    return (
                      <div
                        key={test.id}
                        onClick={() => toggleTestSelection(test)}
                        className={`p - 3 border - 2 rounded - lg cursor - pointer transition - all ${isSelected
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-200 hover:border-gray-300'
                          } `}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <h4 className="font-medium text-gray-900">{test.name}</h4>
                            <p className="text-sm text-gray-600">
                              {test.category} • {test.sample}
                            </p>
                            {test.code && (
                              <p className="text-xs text-gray-500 font-mono">{test.code}</p>
                            )}
                          </div>
                          <div className="text-right ml-3">
                            <div className="font-bold text-green-600">₹{test.price.toLocaleString()}</div>
                            {isSelected && (
                              <div className="text-xs text-blue-600 font-medium">✓ Selected</div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {filteredTests.length === 0 && !isLoadingTests && (
                <div className="text-center py-8">
                  <TestTube className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                  <p className="text-gray-600">No tests found matching your search</p>
                </div>
              )}
            </div>

            {/* Selected tests summary and actions */}
            {selectedTests.length > 0 && (
              <div className="px-6 py-4 border-t border-gray-200 bg-gray-50">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {selectedTests.length} test{selectedTests.length !== 1 ? 's' : ''} selected
                    </p>
                    <p className="text-lg font-bold text-green-600">
                      Total: ₹{getTotalPrice().toLocaleString()}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setSelectedTests([])}
                      className="px-4 py-2 text-sm text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
                    >
                      Clear All
                    </button>
                    <button
                      onClick={handleAddSelectedTests}
                      className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                    >
                      Add Selected Tests
                    </button>
                  </div>
                </div>

                {/* Selected tests list */}
                <div className="flex flex-wrap gap-2">
                  {selectedTests.map((test) => (
                    <span
                      key={test.id}
                      className="inline-flex items-center px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded-full"
                    >
                      {test.name}
                      <button
                        onClick={() => toggleTestSelection(test)}
                        className="ml-1 text-blue-600 hover:text-blue-800"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Bottom spacer for mobile */}
      <div className="h-4 sm:hidden"></div>

      {/* Order Details Modal */}
      {selectedOrder && (
        <OrderDetailsModal
          order={{
            ...selectedOrder,
            tests: selectedOrder.tests || []
          }}
          onClose={() => {
            setSelectedOrder(null);
            fetchOrders(); // Refresh orders when modal closes
          }}
          onUpdateStatus={handleUpdateStatus}
          onSubmitResults={() => {
            fetchOrders(); // Refresh orders after submitting results
            setSelectedOrder(null);
          }}
        />
      )}
    </div>
  );
};

export default Orders;
