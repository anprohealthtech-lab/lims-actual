import React, { useEffect, useMemo, useState } from "react";
import ReactDOM from "react-dom";
import {
  Plus,
  Search,
  Filter,
  Clock as ClockIcon,
  CheckCircle,
  AlertTriangle,
  Eye,
  User,
  Calendar,
  TestTube,
  ChevronDown,
  ChevronUp,
  TrendingUp,
  UserPlus,
  DollarSign,
  FileText,
  CreditCard,
  LayoutDashboard,
  Users,
  MessageCircle,
  Mail,
  Send,
  Receipt,
  Briefcase,
  Trash2,
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { supabase, database } from "../utils/supabase";
import { useMobileOptimizations } from "../utils/platformHelper";
import { MobileFAB } from "../components/ui/MobileFAB";
import OrderForm from "../components/Orders/OrderForm";
import DashboardOrderModal from "../components/Dashboard/DashboardOrderModal";
import CreateInvoiceModal from "../components/Billing/CreateInvoiceModal";
import PaymentCapture from "../components/Billing/PaymentCapture";
import { OrderStatusDisplay } from "../components/Orders/OrderStatusDisplay";
import { WhatsAppAPI } from "../utils/whatsappAPI";
import { openWhatsAppManually } from "../utils/whatsappUtils";

import { usePDFGeneration } from "../hooks/usePDFGeneration";
import SampleTransitWidget from "../components/Dashboard/SampleTransitWidget";
import { generateInvoicePDF } from "../utils/invoicePdfService";
import PhlebotomistSelector from "../components/Users/PhlebotomistSelector";
import { SampleTypeIndicator } from "../components/Common/SampleTypeIndicator";
import { SampleCollectionTracker } from "../components/Samples/SampleCollectionTracker";
import BookingQueue from "../components/Dashboard/BookingQueue";

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
  color_code?: string;
  color_name?: string;
  tat_hours?: number | null;
  tat_start_time?: string | null;
};

type OrderRow = {
  id: string;
  patient_id: string;
  patient_name: string;
  patient_phone?: string | null;
  status: OrderStatus;
  priority: Priority;
  order_date: string;
  expected_date: string;
  total_amount: number;
  final_amount?: number;
  doctor: string | null;

  // sample/meta needed by modal
  sample_id: string | null;
  color_code: string | null;
  color_name: string | null;
  sample_collected_at: string | null;
  sample_collected_by: string | null;

  // Billing fields
  billing_status?: "pending" | "partial" | "billed" | null;
  is_billed?: boolean | null;

  // relations
  patients: { name?: string | null; age?: string | null; gender?: string | null } | null;
  order_tests:
  | {
    id: string;
    test_group_id: string | null;
    test_name: string;
    outsourced_lab_id?: string | null;
    package_id?: string | null;
    outsourced_labs?: { name?: string | null } | null;
  }[]
  | null;

  // daily sequence for sorting
  order_number?: number | null;
};

type Panel = {
  name: string;
  expected: number;
  entered: number; // from view (clamped later)
  verified: boolean;
  status: ProgressRow["panel_status"];
  sample_type?: string;
  sample_color?: string;
  order_color?: string;
};

// Update CardOrder type
type CardOrder = {
  // ... existing fields ...
  id: string;
  patient_name: string;
  patient_id: string;
  patient_phone?: string | null;
  status: OrderStatus;
  priority: Priority;
  order_date: string;
  expected_date: string;
  total_amount: number;
  final_amount?: number;
  doctor: string | null;
  doctor_phone?: string | null;
  doctor_email?: string | null;

  order_number?: number | null;

  sample_id: string | null;
  color_code: string | null;
  color_name: string | null;
  sample_collected_at: string | null;
  sample_collected_by: string | null;

  // Billing fields
  billing_status?: "pending" | "partial" | "billed" | null;
  is_billed?: boolean | null;
  invoice_id?: string | null;
  paid_amount?: number;
  due_amount?: number;
  payment_status?: "unpaid" | "partial" | "paid" | null;

  patient?:
  | {
    name?: string | null;
    age?: string | null;
    gender?: string | null;
    mobile?: string | null;
    email?: string | null;
  }
  | null;
  tests: {
    id: string;
    test_name: string;
    outsourced_lab_id?: string | null;
    outsourced_labs?: { name?: string | null } | null;
    sample_type?: string | null;
    sample_color?: string | null;
  }[];

  // B2B Account (ADDITION)
  account_name?: string | null;
  account_billing_mode?: "standard" | "monthly" | null;

  // derived
  panels: Panel[];
  expectedTotal: number;
  enteredTotal: number;

  // 3-bucket model
  pendingAnalytes: number; // not started OR partial/in-progress
  forApprovalAnalytes: number; // complete but not verified
  approvedAnalytes: number; // verified

  // Report info
  report_url?: string | null;
  report_status?: string | null;

  // Delivery tracking (Reports)
  whatsapp_sent_at?: string | null;
  whatsapp_sent_via?: string | null;
  email_sent_at?: string | null;
  email_sent_via?: string | null;
  doctor_informed_at?: string | null;
  doctor_sent_via?: string | null;

  // Delivery tracking (Invoices)
  invoice_whatsapp_sent_at?: string | null;
  invoice_whatsapp_sent_via?: string | null;
  invoice_email_sent_at?: string | null;
  invoice_email_sent_via?: string | null;
  invoice_payment_reminder_count?: number;
  invoice_last_reminder_at?: string | null;

  // Location and transit fields
  location_id?: string | null;
  location?: string | null;
  transit_status?: string | null;
  collected_at_location_id?: string | null;
  collected_by?: string | null;
};



/* ===========================
   Component
=========================== */

const Dashboard: React.FC = () => {
  const { user } = useAuth();

  const [orders, setOrders] = useState<CardOrder[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [isCollapsedView, setIsCollapsedView] = useState(false);
  const [isHeaderCollapsed, setIsHeaderCollapsed] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"All" | OrderStatus>("All");

  // Date range state - default to last 7 days
  const [dateFrom, setDateFrom] = useState<string>(() => {
    const date = new Date();
    date.setDate(date.getDate() - 7);
    return date.toISOString().split("T")[0];
  });
  const [dateTo, setDateTo] = useState<string>(() => new Date().toISOString().split("T")[0]);
  const [allDates, setAllDates] = useState(false); // ✅ FIX: “All Dates” without breaking query

  const [showOrderForm, setShowOrderForm] = useState(false);
  const [processingBooking, setProcessingBooking] = useState<any>(null); // State for booking being processed
  const [selectedOrder, setSelectedOrder] = useState<CardOrder | null>(null);

  // State for invoice modal
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [invoiceOrderId, setInvoiceOrderId] = useState<string | null>(null);

  // State for payment modal
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentInvoiceId, setPaymentInvoiceId] = useState<string | null>(null);

  // PDF Generation
  // const { generatePDF } = usePDFGeneration(); // Currently unused
  const [isSendingReport, setIsSendingReport] = useState<string | null>(null);
  const [isSendingInvoice, setIsSendingInvoice] = useState<string | null>(null);

  // dashboard counters
  const [summary, setSummary] = useState({
    allDone: 0,
    mostlyDone: 0,
    pending: 0,
    awaitingApproval: 0,
  });

  // Sample Collection Modal State
  const [labId, setLabId] = useState<string | null>(null);
  const [showCollectionModal, setShowCollectionModal] = useState(false);
  const [collectionOrder, setCollectionOrder] = useState<CardOrder | null>(null);
  const [selectedPhlebotomistId, setSelectedPhlebotomistId] = useState<string>("");
  const [selectedPhlebotomistName, setSelectedPhlebotomistName] = useState<string>("");

  useEffect(() => {
    fetchOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, allDates]);

  // Read daily sequence (prefer order_number; fallback to tail of sample_id)
  const getDailySeq = (o: CardOrder) => {
    if (typeof o.order_number === "number" && !Number.isNaN(o.order_number)) return o.order_number;
    const tail = String(o.sample_id || "").split("-").pop() || "";
    const n = parseInt(tail, 10);
    return Number.isFinite(n) ? n : 0;
  };

  const fetchOrders = async () => {
    const lab_id = await database.getCurrentUserLabId();
    setLabId(lab_id);

    if (!lab_id) {
      console.error("No lab_id found for current user");
      return;
    }

    // 1) base orders with optional date filter
    let q = supabase
      .from("orders")
      .select(
        `
id, patient_id, patient_name, status, priority, order_date, expected_date, total_amount, final_amount, doctor,
  order_number, sample_id, color_code, color_name, sample_collected_at, sample_collected_by,
  billing_status, is_billed, referring_doctor_id,
  location_id, transit_status, collected_at_location_id,
  patients(name, age, gender, phone, email),
  order_tests(id, test_group_id, test_name, outsourced_lab_id, package_id, outsourced_labs(name), test_groups(sample_type, sample_color)),
  doctors(phone, email),
  locations!orders_location_id_fkey(id, name, type),
  accounts(name, billing_mode)
      `
      )
      .eq("lab_id", lab_id)
      .order("order_date", { ascending: false });

    // Apply location filtering if required
    const { shouldFilter, locationIds } = await database.shouldFilterByLocation();
    if (shouldFilter && locationIds.length > 0) {
      q = q.in("location_id", locationIds);
    }

    if (!allDates) {
      q = q.gte("order_date", dateFrom).lte("order_date", dateTo + "T23:59:59.999Z");
    }

    const { data: rows, error } = await q;

    if (error) {
      console.error("orders load error", error);
      return;
    }

    const orderRows = (rows || []) as OrderRow[];
    const orderIds = orderRows.map((o) => o.id);
    if (orderIds.length === 0) {
      setOrders([]);
      return;
    }

    // 2) view-based progress
    const { data: prog, error: pErr } = await supabase
      .from("v_order_test_progress_enhanced")
      .select("*")
      .in("order_id", orderIds);

    if (pErr) console.error("progress view error", pErr);

    const byOrder = new Map<string, ProgressRow[]>();
    (prog || []).forEach((r) => {
      const arr = byOrder.get((r as any).order_id) || [];
      arr.push(r as ProgressRow);
      byOrder.set((r as any).order_id, arr);
    });

    // 3) Fetch invoices and payments for each order
    const invoicePromises = orderIds.map(async (orderId) => {
      const { data: invoice } = await database.invoices.getByOrderId(orderId);
      if (!invoice) return { orderId, invoice: null, payments: [], paidAmount: 0, deliveryStatus: {} };

      const { data: payments } = await database.payments.getByInvoiceId(invoice.id);
      const paidAmount = (payments || []).reduce((sum: number, p: any) => sum + (p.amount || 0), 0);

      const { data: deliveryStatus } = await database.invoices.getDeliveryStatus(invoice.id);

      return { orderId, invoice, payments: payments || [], paidAmount, deliveryStatus: deliveryStatus || {} };
    });

    const invoiceData = await Promise.all(invoicePromises);
    const invoiceMap = new Map(invoiceData.map((d) => [d.orderId, d]));

    // 3.5) Fetch reports with delivery status for these orders
    const reportMap = new Map<
      string,
      {
        pdf_url: string | null;
        status: string | null;
        whatsapp_sent_at: string | null;
        whatsapp_sent_via: string | null;
        email_sent_at: string | null;
        email_sent_via: string | null;
        doctor_informed_at: string | null;
        doctor_sent_via: string | null;
      }
    >();

    const { data: reportsData } = await supabase
      .from("reports")
      .select("order_id, pdf_url, status, report_type, whatsapp_sent_at, whatsapp_sent_via, email_sent_at, email_sent_via, doctor_informed_at, doctor_sent_via")
      .in("order_id", orderIds)
      .eq("report_type", "final");

    (reportsData || []).forEach((r: any) => {
      reportMap.set(r.order_id, {
        pdf_url: r.pdf_url,
        status: r.status,
        whatsapp_sent_at: r.whatsapp_sent_at,
        whatsapp_sent_via: r.whatsapp_sent_via,
        email_sent_at: r.email_sent_at,
        email_sent_via: r.email_sent_via,
        doctor_informed_at: r.doctor_informed_at,
        doctor_sent_via: r.doctor_sent_via,
      });
    });

    // 4) shape cards
    const cards: CardOrder[] = orderRows.map((o: any) => {
      const rows = byOrder.get(o.id) || [];
      const invoiceInfo = invoiceMap.get(o.id);
      const reportInfo = reportMap.get(o.id);

      // Calculate dynamic expected date based on TAT
      let calculatedExpectedDateMs = 0;
      rows.forEach((r) => {
        if (r.tat_hours && r.tat_start_time) {
          const start = new Date(r.tat_start_time).getTime();
          const duration = Number(r.tat_hours) * 3600 * 1000;
          const end = start + duration;
          if (end > calculatedExpectedDateMs) calculatedExpectedDateMs = end;
        }
      });

      const dynamicExpectedDate = calculatedExpectedDateMs > 0 ? new Date(calculatedExpectedDateMs).toISOString() : o.expected_date;

      const panels: Panel[] = rows.map((r) => ({
        name: r.test_group_name || "Test",
        expected: r.expected_analytes || 0,
        entered: r.entered_analytes || 0,
        verified: !!r.is_verified,
        status: r.panel_status,
        sample_type: r.sample_type,
        sample_color: r.sample_color,
        order_color: r.color_code,
      }));

      const expectedTotal = panels.reduce((sum, p) => sum + p.expected, 0);
      const enteredTotal = panels.reduce((sum, p) => sum + Math.min(p.entered, p.expected), 0);

      const approvedAnalytes = panels.reduce((sum, p) => {
        if (p.verified || p.status === "Verified") return sum + Math.min(p.entered, p.expected);
        return sum;
      }, 0);

      const pendingAnalytes = Math.max(expectedTotal - enteredTotal, 0);
      const forApprovalAnalytes = Math.max(enteredTotal - approvedAnalytes, 0);

      const doctorData = (o as any).doctors;
      const doctor_phone = doctorData?.phone || null;
      const doctor_email = doctorData?.email || null;

      return {
        id: o.id,
        patient_name: o.patient_name,
        patient_id: o.patient_id,
        patient_phone: o.patients?.phone,
        status: o.status,
        priority: o.priority,
        order_date: o.order_date,
        expected_date: dynamicExpectedDate,
        total_amount: o.total_amount,
        final_amount: !invoiceInfo?.invoice
          ? (o.total_amount || o.final_amount || 0)
          : ((invoiceInfo.invoice.total_after_discount ?? invoiceInfo.invoice.total ?? invoiceInfo.invoice.total_amount ?? 0) + Math.max(0, (o.total_amount || 0) - (invoiceInfo.invoice.subtotal ?? o.total_amount ?? 0))),
        doctor: o.doctor,
        doctor_phone,
        doctor_email,

        order_number: o.order_number ?? null,
        sample_id: o.sample_id,
        color_code: o.color_code,
        color_name: o.color_name,
        sample_collected_at: o.sample_collected_at,
        sample_collected_by: o.sample_collected_by,

        billing_status: (invoiceInfo?.invoice && ((o.total_amount || 0) - (invoiceInfo.invoice.subtotal || 0)) > 1) ? 'partial' : o.billing_status,
        is_billed: o.is_billed,
        invoice_id: invoiceInfo?.invoice?.id || null,
        paid_amount: invoiceInfo?.paidAmount || 0,
        due_amount: !invoiceInfo?.invoice
          ? Math.max(0, (o.total_amount || 0) - (invoiceInfo?.paidAmount || 0))
          : (() => {
            const invTotal = invoiceInfo.invoice.total_after_discount ?? invoiceInfo.invoice.total ?? invoiceInfo.invoice.total_amount ?? 0;
            const paid = invoiceInfo.paidAmount || 0;
            const invDue = Math.max(0, invTotal - paid);

            const orderTotal = o.total_amount || 0;
            const invSubtotal = invoiceInfo.invoice.subtotal ?? orderTotal;
            const unbilled = Math.max(0, orderTotal - invSubtotal);

            // If unbilled amount is explained by discount, ignore it
            const discount = invoiceInfo.invoice.discount_amount || invoiceInfo.invoice.discount || 0;
            if (unbilled > 0 && Math.abs(unbilled - discount) < 2) { // 2.0 tolerance
              return invDue;
            }

            return invDue + unbilled;
          })(),
        payment_status: !invoiceInfo?.invoice
          ? "unpaid"
          : (() => {
            const invTotal = invoiceInfo.invoice.total_after_discount ?? invoiceInfo.invoice.total ?? invoiceInfo.invoice.total_amount ?? 0;
            const invSub = invoiceInfo.invoice.subtotal ?? o.total_amount ?? 0;
            const ordTotal = o.total_amount || 0;
            const unbilled = Math.max(0, ordTotal - invSub);
            const effTotal = invTotal + unbilled;
            const paid = invoiceInfo.paidAmount || 0;
            // Allow small float diff (1.0)
            return paid > 0 && paid >= (effTotal - 1) ? "paid" : paid > 0 ? "partial" : "unpaid";
          })(),

        patient: {
          name: o.patients?.name,
          age: o.patients?.age,
          gender: o.patients?.gender,
          mobile: o.patients?.phone,
          email: o.patients?.email,
        },

        tests: (o.order_tests || []).map((t: any) => ({
          id: t.id,
          test_name: t.test_name,
          outsourced_lab_id: t.outsourced_lab_id,
          outsourced_labs: t.outsourced_labs,
          sample_type: t.test_groups?.sample_type,
          sample_color: t.test_groups?.sample_color,
        })),

        // B2B account (ADDITION)
        account_name: o.accounts?.name || null,
        account_billing_mode: o.accounts?.billing_mode || null,

        panels,
        expectedTotal,
        enteredTotal,
        pendingAnalytes,
        forApprovalAnalytes,
        approvedAnalytes,

        report_url: reportInfo?.pdf_url,
        report_status: reportInfo?.status,
        whatsapp_sent_at: reportInfo?.whatsapp_sent_at,
        whatsapp_sent_via: reportInfo?.whatsapp_sent_via,
        email_sent_at: reportInfo?.email_sent_at,
        email_sent_via: reportInfo?.email_sent_via,
        doctor_informed_at: reportInfo?.doctor_informed_at,
        doctor_sent_via: reportInfo?.doctor_sent_via,

        // Invoice delivery tracking
        invoice_whatsapp_sent_at: (invoiceInfo as any)?.deliveryStatus?.whatsapp_sent_at,
        invoice_whatsapp_sent_via: (invoiceInfo as any)?.deliveryStatus?.whatsapp_sent_via,
        invoice_email_sent_at: (invoiceInfo as any)?.deliveryStatus?.email_sent_at,
        invoice_email_sent_via: (invoiceInfo as any)?.deliveryStatus?.email_sent_via,
        invoice_payment_reminder_count: (invoiceInfo as any)?.deliveryStatus?.payment_reminder_count,
        invoice_last_reminder_at: (invoiceInfo as any)?.deliveryStatus?.last_reminder_at,

        // Location and transit fields
        location_id: o.location_id || null,
        location: o.locations?.name || null,
        transit_status: o.transit_status || null,
        collected_at_location_id: o.collected_at_location_id || null,
        collected_by: o.sample_collected_by || null,
      };
    });

    // sort: date DESC, then daily seq DESC
    const sorted = cards.sort((a, b) => {
      const dA = new Date(a.order_date).setHours(0, 0, 0, 0);
      const dB = new Date(b.order_date).setHours(0, 0, 0, 0);
      if (dA !== dB) return dB - dA;
      const nA = getDailySeq(a);
      const nB = getDailySeq(b);
      return nB - nA;
    });

    const s = sorted.reduce(
      (acc, o) => {
        if (o.status === "Completed" || o.status === "Delivered") acc.allDone++;
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

  /* ===========================
     Handlers
  =========================== */

  const handleAddOrder = async (orderData: any) => {
    try {
      if (!orderData.patient_id) {
        alert("❌ Error: Patient is required");
        throw new Error("Patient is required");
      }

      if (!orderData.referring_doctor_id && !orderData.doctor) {
        alert("❌ Error: Referring doctor is required");
        throw new Error("Referring doctor is required");
      }

      const labId = await database.getCurrentUserLabId();
      const orderDataWithLab = { ...orderData, lab_id: labId };

      const { data: order, error: orderError } = await database.orders.create(orderDataWithLab);
      if (orderError) {
        const errorMessage = orderError.message || "Failed to create order";
        alert(`❌ Order Creation Failed: ${errorMessage} `);
        throw orderError;
      }

      // Update pending TRF attachments
      const PENDING_ORDER_UUID = "00000000-0000-0000-0000-000000000000";
      const { error: updateError } = await supabase
        .from("attachments")
        .update({ related_id: order.id })
        .eq("related_table", "orders")
        .eq("related_id", PENDING_ORDER_UUID)
        .eq("description", "Test Request Form for order creation");

      if (updateError) console.warn("Failed to update TRF attachment:", updateError);

      // ✅ AUTO-CREATE SAMPLES
      try {
        const { createSamplesForOrder } = await import("../services/sampleService");

        const { data: orderTests, error: otError } = await supabase
          .from("order_tests")
          .select(
            `
id,
  order_id,
  test_group_id,
  test_name,
  test_groups: test_group_id(sample_type, sample_color)
    `
          )
          .eq("order_id", order.id);

        if (otError) {
          console.error("Error fetching order tests for sample creation:", otError);
        } else if (!orderTests || orderTests.length === 0) {
          console.warn("⚠️ No order tests found for sample creation via Dashboard. Order:", order.id);
        } else {
          const testGroupsWithInfo = orderTests.map((ot: any) => {
            const groupData = Array.isArray(ot.test_groups) ? ot.test_groups[0] : ot.test_groups;
            return {
              id: ot.id,
              order_id: ot.order_id,
              test_group_id: ot.test_group_id,
              test_name: ot.test_name,
              test_group: {
                sample_type: groupData?.sample_type || "Blood",
                sample_color: groupData?.sample_color,
              },
            };
          });

          await createSamplesForOrder(order.id, testGroupsWithInfo, labId || order.lab_id, orderData.patient_id);
        }
      } catch (sampleCheckErr) {
        console.error("Error auto-creating samples from Dashboard:", sampleCheckErr);
      }

      // 5. Update Booking Status (if converted)
      if (processingBooking) {
        try {
          await database.bookings.update(processingBooking.id, {
            status: 'converted',
            converted_order_id: order.id,
            updated_at: new Date().toISOString()
          });
          console.log('✅ Booking status updated to converted:', processingBooking.id);
        } catch (bookingErr) {
          console.error('Failed to update booking status:', bookingErr);
          // Non-blocking error
        }
      }

      await fetchOrders();
      // Don't close immediately - wait for OrderForm to handle invoice creation
      // setShowOrderForm(false); 
      console.log("✅ Order created successfully!");

      // Return order for invoice/payment creation in OrderForm
      return order;
    } catch (error: any) {
      console.error("Dashboard: Error creating order:", error);
      throw error; // Re-throw so OrderForm knows creation failed
    }
  };

  const handleDeleteOrder = async (orderId: string) => {
    if (!window.confirm("Are you sure you want to delete this order? This action cannot be undone and will delete all associated tests and results.")) return;

    try {
      const { error } = await database.orders.delete(orderId);
      if (error) {
        throw error;
      }
      fetchOrders();
    } catch (error) {
      console.error("Error deleting order:", error);
      alert("Failed to delete order. Please try again.");
    }
  };

  const handleCreateInvoice = (orderId: string) => {
    setInvoiceOrderId(orderId);
    setShowInvoiceModal(true);
  };

  const handleRecordPayment = async (orderId: string) => {
    try {
      const { data: invoice, error } = await database.invoices.getByOrderId(orderId);
      if (error || !invoice) {
        alert("No invoice found for this order. Please create an invoice first.");
        return;
      }
      setPaymentInvoiceId(invoice.id);
      setShowPaymentModal(true);
    } catch (error) {
      console.error("Error fetching invoice for order:", error);
      alert("Failed to fetch invoice details. Please try again.");
    }
  };

  const handleOpenCollectionModal = async (order: CardOrder) => {
    try {
      const { getSamplesForOrder, createSamplesForOrder } = await import("../services/sampleService");
      const existingSamples = await getSamplesForOrder(order.id);

      if (existingSamples.length === 0) {
        const { data: orderTests } = await supabase
          .from("order_tests")
          .select(
            `
id,
  order_id,
  test_group_id,
  test_name,
  test_groups: test_group_id(sample_type, sample_color)
          `
          )
          .eq("order_id", order.id);

        if (orderTests && orderTests.length > 0) {
          const labId = await database.getCurrentUserLabId();
          const testGroupsWithInfo = orderTests.map((ot: any) => {
            const groupData = Array.isArray(ot.test_groups) ? ot.test_groups[0] : ot.test_groups;
            return {
              id: ot.id,
              order_id: ot.order_id,
              test_group_id: ot.test_group_id,
              test_name: ot.test_name,
              test_group: {
                sample_type: groupData?.sample_type || "Blood",
                sample_color: groupData?.sample_color,
              },
            };
          });

          await createSamplesForOrder(order.id, testGroupsWithInfo, labId, order.patient_id);
        }
      }
    } catch (err) {
      console.error("Error auto-creating samples during collection:", err);
    }

    setCollectionOrder(order);
    setSelectedPhlebotomistId("");
    setSelectedPhlebotomistName("");
    setShowCollectionModal(true);
  };

  const handleSaveCollection = async () => {
    if (!collectionOrder) return;

    try {
      if (selectedPhlebotomistId) {
        await database.orders.markSampleCollected(collectionOrder.id, selectedPhlebotomistName || undefined, selectedPhlebotomistId);
      }
      await database.orders.checkAndUpdateStatus(collectionOrder.id);
      setShowCollectionModal(false);
      fetchOrders();
    } catch (err) {
      console.error("Error saving collection info:", err);
      setShowCollectionModal(false);
      fetchOrders();
    }
  };

  const handleInformDoctor = async (order: CardOrder) => {
    if (!order.doctor_phone) {
      alert("Doctor's phone number not found. Please ensure the doctor profile has a valid phone number.");
      return;
    }

    try {
      const { data: report } = await database.reports.getByOrderId(order.id);

      if (report && report.doctor_informed_at) {
        const informedDate = new Date(report.doctor_informed_at).toLocaleString();
        const confirmResend = window.confirm(
          `Doctor was already informed on ${informedDate} via ${report.doctor_informed_via || "WhatsApp"}.\n\nSend again ? `
        );
        if (!confirmResend) return;
      }

      // If final report exists, send with PDF and clinical summary
      if (report && report.report_type === "final" && report.pdf_url) {
        const { data: orderData } = await supabase
          .from("orders")
          .select("ai_clinical_summary, include_clinical_summary_in_report")
          .eq("id", order.id)
          .single();

        const includeClinicalSummary = orderData?.include_clinical_summary_in_report || false;
        const clinicalSummary = orderData?.ai_clinical_summary || "";

        let message = `Hello ${order.doctor || "Doctor"}, \n\nThe final report for patient ${order.patient_name}(Order #${order.id.slice(
          -6
        )
          }) is ready.`;

        if (includeClinicalSummary && clinicalSummary) {
          message += `\n\n📋 Clinical Summary: \n${clinicalSummary} `;
        }

        message += `\n\nPlease find the attached report.\n\nThank you.`;

        const connection = await WhatsAppAPI.getConnectionStatus();
        if (!connection?.success || !connection.isConnected) {
          const { success, method } = await openWhatsAppManually(order.doctor_phone, message, report.pdf_url, "doctor");
          if (success && method === "manual_link") {
            const { data: auth } = await supabase.auth.getUser();
            await database.reports.recordDoctorNotification(report.id, {
              via: "whatsapp",
              sentBy: auth?.user?.id || "",
              sentVia: "manual_link",
            });
            alert("WhatsApp opened. Please send the message manually.");
            fetchOrders();
          }
          return;
        }

        const formattedPhone = WhatsAppAPI.formatPhoneNumber(order.doctor_phone);
        if (!WhatsAppAPI.validatePhoneNumber(order.doctor_phone)) {
          alert("Invalid phone number format. Please update the doctor phone.");
          return;
        }

        const confirmMsg = window.confirm(`Send final report to ${order.doctor} (${order.doctor_phone})?\n\nMessage: \n${message} `);
        if (!confirmMsg) return;

        const result = await WhatsAppAPI.sendReportFromUrl(formattedPhone, report.pdf_url, message, order.patient_name);

        if (result.success) {
          const { data: auth } = await supabase.auth.getUser();
          await database.reports.recordDoctorNotification(report.id, { via: "whatsapp", sentBy: auth?.user?.id || "" });
          alert("Report sent to doctor successfully!");
          fetchOrders();
        } else {
          alert("Failed to send report: " + result.message);
        }

        return;
      }

      // No final report - text-only
      let message = "";
      try {
        const labId = await database.getCurrentUserLabId();
        const { data: template } = await database.whatsappTemplates.getDefault("doctor_notification", labId);

        if (template) {
          const { data: labData } = await supabase.from("labs").select("name, address, phone, email").eq("id", labId!).single();
          const testNames = order.tests?.map((t) => t.test_name).join(", ") || "Tests";

          const { replacePlaceholders } = await import("../utils/whatsappTemplates");
          message = replacePlaceholders(template.message_content, {
            DoctorName: order.doctor || "Doctor",
            PatientName: order.patient_name,
            OrderId: order.id.slice(-6),
            OrderStatus: order.status,
            TestName: testNames,
            LabName: labData?.name || "",
            LabAddress: labData?.address || "",
            LabContact: labData?.phone || "",
            LabEmail: labData?.email || "",
          });
        }
      } catch (err) {
        console.error("Error fetching template:", err);
      }

      if (!message) {
        message = `Hello ${order.doctor || "Doctor"}, \n\nOrder #${order.id.slice(-6)} for patient ${order.patient_name} is currently ${order.status}.`;
      }

      if (!message.includes("Thank you")) message += `\n\nThank you.`;

      const connection = await WhatsAppAPI.getConnectionStatus();
      if (!connection?.success || !connection.isConnected) {
        const { success, method } = await openWhatsAppManually(order.doctor_phone, message, undefined, "doctor");
        if (success && method === "manual_link") {
          if (report) {
            const { data: auth } = await supabase.auth.getUser();
            await database.reports.recordDoctorNotification(report.id, {
              via: "whatsapp",
              sentBy: auth?.user?.id || "",
              sentVia: "manual_link",
            });
          }
          alert("WhatsApp opened. Please send the message manually.");
          fetchOrders();
        }
        return;
      }

      const formattedPhone = WhatsAppAPI.formatPhoneNumber(order.doctor_phone);
      if (!WhatsAppAPI.validatePhoneNumber(order.doctor_phone)) {
        alert("Invalid phone number format. Please update the doctor phone.");
        return;
      }

      const confirmMsg = window.confirm(`Send WhatsApp to ${order.doctor} (${order.doctor_phone})?\n\nMessage: \n${message} `);
      if (!confirmMsg) return;

      const result = await WhatsAppAPI.sendTextMessage(formattedPhone, message);
      if (result.success) {
        if (report) {
          const { data: auth } = await supabase.auth.getUser();
          await database.reports.recordDoctorNotification(report.id, { via: "whatsapp", sentBy: auth?.user?.id || "" });
        }
        alert("Message sent successfully!");
        fetchOrders();
      } else {
        alert("Failed to send message: " + result.message);
      }
    } catch (error) {
      console.error("Error sending message:", error);
      alert("Error sending message.");
    }
  };

  const handleSendReport = async (order: CardOrder, type: "whatsapp" | "email") => {
    if (isSendingReport) return;

    try {
      const { data: report, error: reportError } = await database.reports.getByOrderId(order.id);
      if (reportError || !report) {
        alert("Report not found. Please generate it from the Reports page first.");
        return;
      }
      if (report.report_type !== "final") {
        alert("Cannot send draft report. Please ensure all results are verified and final report is generated.");
        return;
      }
      if (!report.pdf_url) {
        alert("Report PDF not generated yet. Please generate it from the Reports page first.");
        return;
      }

      const alreadySent = await database.reports.wasAlreadySent(report.id, type);
      if (alreadySent) {
        const sentField = type === "whatsapp" ? "whatsapp_sent_at" : "email_sent_at";
        const { data: deliveryData } = await database.reports.getDeliveryStatus(report.id);
        const sentDate = deliveryData ? new Date((deliveryData as any)[sentField]).toLocaleString() : "unknown date";
        const sentTo = type === "whatsapp" ? (deliveryData as any)?.whatsapp_sent_to : (deliveryData as any)?.email_sent_to;

        const confirmResend = window.confirm(`Report already sent via ${type} on ${sentDate}${sentTo ? ` to ${sentTo}` : ""}.\n\nSend again ? `);
        if (!confirmResend) return;
      }

      setIsSendingReport(order.id);

      if (type === "whatsapp") {
        let phone = order.patient_phone || "";
        if (!phone && order.patient_id) {
          const { data: patientData } = await supabase.from("patients").select("phone").eq("id", order.patient_id).single();
          phone = patientData?.phone || "";
        }

        const normalizePhone = (p: string): string => {
          const digitsOnly = p.replace(/\D/g, "");
          if (digitsOnly.length <= 10) return digitsOnly;
          return digitsOnly.slice(-10);
        };

        phone = normalizePhone(phone);

        if (!phone || phone.length < 10) {
          const input = window.prompt("Patient phone not found. Enter phone number to send report:", phone);
          if (!input) {
            setIsSendingReport(null);
            return;
          }
          phone = normalizePhone(input);
        }

        if (phone.length !== 10) {
          alert("Invalid phone number. Please enter a valid 10-digit number.");
          setIsSendingReport(null);
          return;
        }

        let caption = `Lab Report for ${order.patient_name}(Order #${order.id.slice(-6)})`;

        try {
          const labId = await database.getCurrentUserLabId();
          const { data: template } = await database.whatsappTemplates.getDefault("report_ready", labId);

          if (template) {
            const { data: labData } = await supabase.from("labs").select("name, address, phone, email").eq("id", labId!).single();
            const testNames = order.tests?.map((t) => t.test_name).join(", ") || "Tests";

            const { replacePlaceholders } = await import("../utils/whatsappTemplates");
            caption = replacePlaceholders(template.message_content, {
              PatientName: order.patient_name,
              OrderId: order.id.slice(-6),
              TestName: testNames,
              ReportUrl: report.pdf_url,
              LabName: labData?.name || "",
              LabAddress: labData?.address || "",
              LabContact: labData?.phone || "",
              LabEmail: labData?.email || "",
            });
          }
        } catch (err) {
          console.error("Error fetching template:", err);
        }

        caption += `\n\nThank you.`;

        const connection = await WhatsAppAPI.getConnectionStatus();
        if (!connection?.success || !connection.isConnected) {
          const { success, method } = await openWhatsAppManually(phone, caption, report.pdf_url, "patient");
          if (success && method === "manual_link") {
            const { data: auth } = await supabase.auth.getUser();
            await database.reports.recordWhatsAppSend(report.id, {
              to: phone,
              caption,
              sentBy: auth?.user?.id || "",
              includedClinicalSummary: false,
              sentVia: "manual_link",
            });
            alert("WhatsApp opened. Please send the message manually.");
            fetchOrders();
          }
          setIsSendingReport(null);
          return;
        }

        const result = await WhatsAppAPI.sendReportFromUrl(phone, report.pdf_url, caption, order.patient_name);

        if (result.success) {
          const { data: auth } = await supabase.auth.getUser();
          await database.reports.recordWhatsAppSend(report.id, {
            to: phone,
            caption,
            sentBy: auth?.user?.id || "",
            includedClinicalSummary: false,
          });
          alert("Report sent via WhatsApp!");
          fetchOrders();
        } else {
          alert("Failed to send report: " + result.message);
        }
      } else {
        let email = (order as any).patient?.email || "";
        const input = window.prompt("Enter email address to send report:", email);
        if (!input) {
          setIsSendingReport(null);
          return;
        }
        email = input;

        let emailBody = `Please find the lab report for ${order.patient_name}(Order #${order.id.slice(-6)}) below: \n\n`;
        emailBody += `Report Link: ${report.pdf_url} \n\nThank you.`;

        const subject = encodeURIComponent(`Lab Report: ${order.patient_name} `);
        const body = encodeURIComponent(emailBody);
        window.open(`mailto:${email}?subject = ${subject}& body=${body} `, "_blank");

        const { data: auth } = await supabase.auth.getUser();
        await database.reports.recordEmailSend(report.id, {
          to: email,
          sentBy: auth?.user?.id || "",
          includedClinicalSummary: false,
        });

        alert("Email client opened. Please send the email.");
        fetchOrders();
      }
    } catch (error) {
      console.error("Error sending report:", error);
      alert("Failed to send report. Please try again.");
    } finally {
      setIsSendingReport(null);
    }
  };

  const handleSendInvoice = async (order: CardOrder) => {
    if (isSendingInvoice) return;

    try {
      setIsSendingInvoice(order.id);

      const { data: invoice, error: invoiceError } = await database.invoices.getByOrderId(order.id);
      if (invoiceError || !invoice) {
        alert("Invoice not found. Please create an invoice first.");
        setIsSendingInvoice(null);
        return;
      }

      let pdfUrl = invoice.pdf_url;
      if (!pdfUrl) {
        alert("Generating invoice PDF...");

        const { data: templates } = await database.invoiceTemplates.getAll();
        const defaultTemplate = templates?.find((t: any) => t.is_default) || templates?.[0];

        if (!defaultTemplate) {
          alert("No invoice template found. Please configure templates in Settings.");
          setIsSendingInvoice(null);
          return;
        }

        pdfUrl = await generateInvoicePDF(invoice.id, defaultTemplate.id);
        if (!pdfUrl) {
          alert("Failed to generate invoice PDF.");
          setIsSendingInvoice(null);
          return;
        }
      }

      let phone = order.patient_phone || "";
      if (!phone && order.patient_id) {
        const { data: patientData } = await supabase.from("patients").select("phone").eq("id", order.patient_id).single();
        phone = patientData?.phone || "";
      }

      const normalizePhone = (p: string): string => {
        const digitsOnly = p.replace(/\D/g, "");
        if (digitsOnly.length <= 10) return digitsOnly;
        return digitsOnly.slice(-10);
      };

      phone = normalizePhone(phone);

      if (!phone || phone.length < 10) {
        const input = window.prompt("Patient phone not found. Enter phone number to send invoice:", phone);
        if (!input) {
          setIsSendingInvoice(null);
          return;
        }
        phone = normalizePhone(input);
      }

      if (phone.length !== 10) {
        alert("Invalid phone number. Please enter a valid 10-digit number.");
        setIsSendingInvoice(null);
        return;
      }

      const baseMessage =
        `Dear ${order.patient_name}, \n\nYour invoice is ready.\n\n` +
        `Total Amount: ₹${invoice.total.toLocaleString()} \n` +
        (invoice.paid_amount > 0
          ? `Paid: ₹${invoice.paid_amount.toLocaleString()} \nBalance Due: ₹${(invoice.total - invoice.paid_amount).toLocaleString()} \n\n`
          : "\n") +
        `Thank you for choosing our services!`;

      const messageWithLink =
        `Dear ${order.patient_name}, \n\nYour invoice is ready.Please find the invoice PDF here: \n\n${pdfUrl} \n\n` +
        `Total Amount: ₹${invoice.total.toLocaleString()} \n` +
        (invoice.paid_amount > 0
          ? `Paid: ₹${invoice.paid_amount.toLocaleString()} \nBalance Due: ₹${(invoice.total - invoice.paid_amount).toLocaleString()} \n\n`
          : "\n") +
        `Thank you for choosing our services!`;

      // Try backend API first
      try {
        const connection = await WhatsAppAPI.getConnectionStatus();
        if (!connection.isConnected) throw new Error("WhatsApp not connected");

        const result = await WhatsAppAPI.sendReportFromUrl(phone, pdfUrl, baseMessage, order.patient_name, "Invoice");

        if (result.success) {
          try {
            await database.invoices.recordWhatsAppSend(invoice.id, {
              to: phone,
              caption: baseMessage,
              sentBy: user?.id || "",
              sentVia: "api",
            });
          } catch (recordError) {
            console.error("Failed to record invoice WhatsApp send:", recordError);
          }

          alert("Invoice sent via WhatsApp successfully!");
          fetchOrders();
          setIsSendingInvoice(null);
          return;
        }
      } catch (apiError) {
        console.log("Backend API failed, falling back to manual WhatsApp:", apiError);
      }

      // Fallback to manual WhatsApp link
      const { success: manualSuccess } = await openWhatsAppManually(phone, messageWithLink);
      if (manualSuccess) {
        try {
          await database.invoices.recordWhatsAppSend(invoice.id, {
            to: phone,
            caption: messageWithLink,
            sentBy: user?.id || "",
            sentVia: "manual_link",
          });
        } catch (recordError) {
          console.error("Failed to record invoice WhatsApp send:", recordError);
        }

        alert("WhatsApp opened. Please send the message manually.");
        fetchOrders();
      }
    } catch (error) {
      console.error("Error sending invoice:", error);
      alert("Failed to send invoice. Please try again.");
    } finally {
      setIsSendingInvoice(null);
    }
  };

  const getBillingBadge = (order: any) => {
    if (order.billing_status === "billed") {
      return (
        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
          💰 Fully Billed
        </span>
      );
    } else if (order.billing_status === "partial") {
      return (
        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
          💸 Partially Billed
        </span>
      );
    } else {
      return (
        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
          📋 Not Billed
        </span>
      );
    }
  };

  /* ------------- filtering + grouping ------------- */
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return orders.filter((o) => {
      const matchesQ = o.patient_name.toLowerCase().includes(q) || (o.patient_id || "").toLowerCase().includes(q) || (o.id || "").toLowerCase().includes(q);
      const matchesStatus = statusFilter === "All" || o.status === statusFilter;
      return matchesQ && matchesStatus;
    });
  }, [orders, search, statusFilter]);

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
        label: v.date.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" }),
        orders: v.orders.sort((a, b) => {
          const nA = getDailySeq(a);
          const nB = getDailySeq(b);
          if (nA !== nB) return nB - nA;
          return new Date(b.order_date).getTime() - new Date(a.order_date).getTime();
        }),
      }));
  }, [filtered]);

  const openDetails = (o: CardOrder) => setSelectedOrder(o);

  const setDateRange = (days: number) => {
    const to = new Date();
    const from = new Date();
    from.setDate(to.getDate() - days);

    setAllDates(false);
    setDateTo(to.toISOString().split("T")[0]);
    setDateFrom(from.toISOString().split("T")[0]);
  };

  const setToday = () => {
    const today = new Date().toISOString().split("T")[0];
    setAllDates(false);
    setDateFrom(today);
    setDateTo(today);
  };

  const mobile = useMobileOptimizations();

  return (
    <>
      <div className={mobile.spacing}>
        {/* Header */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h1 className={`${mobile.titleSize} font-bold text-gray-900 flex items-center gap-2`}>
              Test Orders
              <button
                onClick={() => setIsHeaderCollapsed(!isHeaderCollapsed)}
                className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors text-gray-500"
                title={isHeaderCollapsed ? "Show Filters" : "Hide Filters"}
              >
                {isHeaderCollapsed ? <ChevronDown className="h-5 w-5" /> : <ChevronUp className="h-5 w-5" />}
              </button>
            </h1>
            {!mobile.isMobile && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsCollapsedView(!isCollapsedView)}
                  className={`px-4 py-2 rounded-lg font-medium transition-colors ${isCollapsedView ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
                >
                  {isCollapsedView ? "Expand Cards" : "Collapse Cards"}
                </button>
                <button
                  onClick={() => setShowOrderForm(true)}
                  className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 shadow-sm"
                >
                  <Plus className="h-5 w-5 mr-2" />
                  Create Order
                </button>
              </div>
            )}
          </div>

          {!mobile.isMobile && (
            <div className="flex items-center gap-2">
              <button className="inline-flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg font-medium shadow-sm transition-all">
                <LayoutDashboard className="h-4 w-4" />
                Standard View
              </button>
              <button className="inline-flex items-center gap-2 px-4 py-2 bg-white text-gray-700 border border-gray-200 rounded-lg font-medium hover:bg-gray-50 shadow-sm transition-all">
                <Users className="h-4 w-4" />
                Patient Visits
              </button>
            </div>
          )}
        </div>

        {!isHeaderCollapsed && (
          <div className="mt-4 space-y-4">
            {/* Overview cards */}
            <div className={`grid ${mobile.gridCols} ${mobile.isMobile ? "gap-3" : mobile.gap}`}>
              <div className={`bg-green-50 border border-green-200 rounded-lg ${mobile.isMobile ? "p-4" : mobile.cardPadding} shadow-sm transition-all hover:shadow-md`}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-2xl font-bold text-green-900">{summary.allDone}</div>
                    <div className={`${mobile.isMobile ? "text-sm" : mobile.textSize} text-green-700 font-medium`}>All Done</div>
                  </div>
                  <div className="bg-green-500 p-2 rounded-lg shadow-sm">
                    <CheckCircle className="h-5 w-5 text-white" />
                  </div>
                </div>
              </div>

              <div className={`bg-blue-50 border border-blue-200 rounded-lg ${mobile.isMobile ? "p-4" : mobile.cardPadding} shadow-sm transition-all hover:shadow-md`}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-2xl font-bold text-blue-900">{summary.mostlyDone}</div>
                    <div className={`${mobile.isMobile ? "text-sm" : mobile.textSize} text-blue-700 font-medium`}>Mostly Done</div>
                  </div>
                  <div className="bg-blue-500 p-2 rounded-lg shadow-sm">
                    <TrendingUp className="h-5 w-5 text-white" />
                  </div>
                </div>
              </div>

              <div className={`bg-yellow-50 border border-yellow-200 rounded-lg ${mobile.isMobile ? "p-4" : mobile.cardPadding} shadow-sm transition-all hover:shadow-md`}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-2xl font-bold text-yellow-900">{summary.pending}</div>
                    <div className={`${mobile.isMobile ? "text-sm" : mobile.textSize} text-yellow-700 font-medium`}>Pending</div>
                  </div>
                  <div className="bg-yellow-500 p-2 rounded-lg shadow-sm">
                    <ClockIcon className="h-5 w-5 text-white" />
                  </div>
                </div>
              </div>

              <div className={`bg-orange-50 border border-orange-200 rounded-lg ${mobile.isMobile ? "p-4" : mobile.cardPadding} shadow-sm transition-all hover:shadow-md`}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-2xl font-bold text-orange-900">{summary.awaitingApproval}</div>
                    <div className={`${mobile.isMobile ? "text-sm" : mobile.textSize} text-orange-700 font-medium`}>Awaiting Approval</div>
                  </div>
                  <div className="bg-orange-500 p-2 rounded-lg shadow-sm">
                    <AlertTriangle className="h-5 w-5 text-white" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* New Bookings/Samples Queue */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
          <BookingQueue
            onProcessBooking={(booking) => {
              setProcessingBooking(booking);
              setShowOrderForm(true);
            }}
          />
          <div className="hidden lg:block">
            {/* Placeholder or move SampleCollectionTracker here if desired, 
                   otherwise keep layout balanced */}
          </div>
        </div>

        <SampleTransitWidget />

        {/* Search / Filters */}
        <div className={`bg-white rounded-lg border border-gray-200 shadow-sm ${mobile.cardPadding}`}>
          <div className="flex flex-col gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={mobile.isMobile ? "Search patient..." : "Search by patient, order ID, or patient ID…"}
                className={`w-full pl-10 pr-4 ${mobile.isMobile ? "py-2.5 text-base" : "py-2"} border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 shadow-sm transition-all`}
              />
            </div>

            <div className="flex gap-2">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
                className={`flex-1 ${mobile.isMobile ? "px-3 py-2.5 text-base" : "px-3 py-2"} border border-gray-300 rounded-lg bg-white font-medium shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200`}
              >
                {["All", "Order Created", "Sample Collection", "In Progress", "Pending Approval", "Completed", "Delivered"].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>

              {!mobile.isMobile && (
                <button className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 bg-white shadow-sm transition-all">
                  <Filter className="h-4 w-4 mr-2" />
                  More Filters
                </button>
              )}
            </div>

            {/* Date Range */}
            {mobile.isMobile ? (
              <div className="bg-gradient-to-br from-gray-50 to-blue-50 rounded-xl p-4 space-y-4 border border-gray-200">
                <h3 className="text-base font-bold text-gray-900">Date Range:</h3>

                {!allDates && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <label className="text-sm font-medium text-gray-600 w-16">From:</label>
                      <input
                        type="date"
                        value={dateFrom}
                        onChange={(e) => {
                          setAllDates(false);
                          setDateFrom(e.target.value);
                        }}
                        className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-sm font-medium text-gray-600 w-16">To:</label>
                      <input
                        type="date"
                        value={dateTo}
                        onChange={(e) => {
                          setAllDates(false);
                          setDateTo(e.target.value);
                        }}
                        className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white"
                      />
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <button onClick={setToday} className="px-3 py-2.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium shadow-sm">
                    Today
                  </button>
                  <button onClick={() => setDateRange(7)} className="px-3 py-2.5 text-sm bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-medium">
                    7 days
                  </button>
                  <button onClick={() => setDateRange(30)} className="px-3 py-2.5 text-sm bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-medium">
                    30 days
                  </button>
                  <button onClick={() => setDateRange(90)} className="px-3 py-2.5 text-sm bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-medium">
                    90 days
                  </button>
                  <button
                    onClick={() => setAllDates(true)}
                    className="col-span-2 px-3 py-2.5 text-sm bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-medium"
                  >
                    All Dates
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-gray-200">
                  <button
                    onClick={() => setStatusFilter("Pending Approval")}
                    className={`px-3 py-2.5 text-sm rounded-lg font-medium ${statusFilter === "Pending Approval" ? "bg-orange-500 text-white shadow-sm" : "bg-orange-100 text-orange-700 hover:bg-orange-200"
                      } `}
                  >
                    Pending
                  </button>
                  <button
                    onClick={() => setStatusFilter("All")}
                    className={`px-3 py-2.5 text-sm rounded-lg font-medium ${statusFilter === "All" ? "bg-gray-700 text-white shadow-sm" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                      } `}
                  >
                    All
                  </button>
                </div>
              </div>
            ) : (
              <div className="pt-2 border-t border-gray-100">
                <div className="flex items-center gap-2 mb-2">
                  <Calendar className="h-4 w-4 text-gray-600" />
                  <span className="text-sm font-medium text-gray-700">Date Range:</span>
                  <button
                    onClick={() => setAllDates(!allDates)}
                    className={`ml-2 px-2 py-0.5 text-xs rounded border ${allDates ? "bg-blue-50 border-blue-200 text-blue-700" : "bg-white border-gray-200 text-gray-600"} `}
                  >
                    {allDates ? "All Dates ON" : "All Dates OFF"}
                  </button>
                </div>

                {!allDates && (
                  <>
                    <div className="flex gap-2 mb-2">
                      <div className="flex-1">
                        <label className="text-sm text-gray-600 block mb-1">From:</label>
                        <input
                          type="date"
                          value={dateFrom}
                          onChange={(e) => {
                            setAllDates(false);
                            setDateFrom(e.target.value);
                          }}
                          className="w-full px-3 py-1.5 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
                        />
                      </div>

                      <div className="flex-1">
                        <label className="text-sm text-gray-600 block mb-1">To:</label>
                        <input
                          type="date"
                          value={dateTo}
                          onChange={(e) => {
                            setAllDates(false);
                            setDateTo(e.target.value);
                          }}
                          className="w-full px-3 py-1.5 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-1">
                      <button onClick={setToday} className="px-3 py-1 text-sm bg-blue-100 text-blue-700 rounded hover:bg-blue-200">
                        Today
                      </button>
                      <button onClick={() => setDateRange(7)} className="px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200">
                        7 days
                      </button>
                      <button onClick={() => setDateRange(30)} className="px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200">
                        30 days
                      </button>
                      <button onClick={() => setDateRange(90)} className="px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200">
                        90 days
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {
        isHeaderCollapsed && (
          <div className="mt-4 flex flex-wrap items-center gap-3 animate-in fade-in slide-in-from-top-2 duration-300">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Quick search..."
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 h-10 shadow-sm transition-all"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="w-full sm:w-48 px-3 py-2 border border-gray-300 rounded-lg bg-white font-medium h-10 shadow-sm focus:ring-2 focus:ring-blue-200 transition-all"
            >
              {["All", "Order Created", "Sample Collection", "In Progress", "Pending Approval", "Completed", "Delivered"].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        )
      }

      {/* Groups + Cards */}
      <div className={`mt-6 bg-white rounded-lg border border-gray-200 shadow-sm ${mobile.isMobile ? "mb-20" : ""}`}>
        <div className={`${mobile.isMobile ? "px-3 py-3" : "px-6 py-4"} border-b border-gray-200 bg-gray-50/50`}>
          <h3 className={`${mobile.isMobile ? "text-base" : "text-lg"} font-semibold text-gray-900`}>Test Orders ({filtered.length})</h3>
        </div>

        {
          groups.length === 0 ? (
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
                    <div className="text-sm text-gray-500">
                      {g.orders.length} order{g.orders.length !== 1 ? "s" : ""}
                    </div>
                  </div>

                  {isCollapsedView ? (
                    <div className="space-y-2">
                      {g.orders.map((o) => {
                        const pct = o.expectedTotal > 0 ? Math.round((o.enteredTotal / o.expectedTotal) * 100) : 0;

                        return (
                          <div
                            key={o.id}
                            role="button"
                            onClick={() => openDetails(o)}
                            className="w-full p-3 border rounded-lg hover:shadow-md transition-all cursor-pointer border-gray-200 bg-white flex items-center justify-between"
                          >
                            <div className="flex items-center space-x-4 flex-1 min-w-0">
                              <div className="flex items-center justify-center w-6 h-6 bg-blue-100 text-blue-700 rounded-full font-bold text-xs border border-blue-200">
                                {String(getDailySeq(o)).padStart(3, "0")}
                              </div>
                              <User className="h-4 w-4 text-blue-600 shrink-0" />
                              <span className="font-medium text-gray-900 truncate">{o.patient?.name || o.patient_name}</span>
                              <span className="text-sm text-gray-600 truncate">
                                {(o.patient?.age || "N/A") + "y"} • {o.patient?.gender || "N/A"}
                              </span>

                              {o.account_name && (
                                <span className="flex items-center gap-1 text-xs text-indigo-600 font-medium bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-100 truncate max-w-[140px]">
                                  <Briefcase className="h-3 w-3" />
                                  {o.account_name}
                                </span>
                              )}

                              <span className="text-xs text-gray-500">{o.sample_id ? `#${String(o.sample_id).split("-").pop()} ` : "No Sample"}</span>
                            </div>

                            <div className="flex items-center space-x-3 flex-shrink-0">
                              <div className="text-xs text-gray-600">
                                {pct}% ({o.enteredTotal}/{o.expectedTotal})
                              </div>

                              <OrderStatusDisplay order={o} compact={true} />

                              <div className="flex items-center space-x-1">
                                {o.report_url && <span className="px-1.5 py-0.5 text-xs font-medium rounded bg-blue-100 text-blue-700 border border-blue-200" title="Final Report Available">📄</span>}
                                {o.doctor_informed_at && (
                                  <span
                                    className="px-1.5 py-0.5 text-xs font-medium rounded bg-purple-100 text-purple-700 border border-purple-200"
                                    title={`Doctor Informed: ${new Date(o.doctor_informed_at).toLocaleString()} `}
                                  >
                                    👨‍⚕️
                                  </span>
                                )}
                                {(o.whatsapp_sent_at || o.email_sent_at) && (
                                  <span
                                    className="px-1.5 py-0.5 text-xs font-medium rounded bg-green-100 text-green-700 border border-green-200"
                                    title={`Sent: ${new Date(o.whatsapp_sent_at || o.email_sent_at!).toLocaleString()} `}
                                  >
                                    {o.whatsapp_sent_at ? "📱" : "📧"}
                                  </span>
                                )}
                                {o.invoice_whatsapp_sent_at && (
                                  <span
                                    className="px-1.5 py-0.5 text-xs font-medium rounded bg-teal-100 text-teal-700 border border-teal-200"
                                    title={`Invoice sent via WhatsApp: ${new Date(o.invoice_whatsapp_sent_at).toLocaleString()} `}
                                  >
                                    💬
                                  </span>
                                )}
                                {o.invoice_email_sent_at && (
                                  <span
                                    className="px-1.5 py-0.5 text-xs font-medium rounded bg-indigo-100 text-indigo-700 border border-indigo-200"
                                    title={`Invoice sent via Email: ${new Date(o.invoice_email_sent_at).toLocaleString()} `}
                                  >
                                    ✉️
                                  </span>
                                )}
                                {o.invoice_payment_reminder_count && o.invoice_payment_reminder_count > 0 && (
                                  <span className="px-1.5 py-0.5 text-xs font-medium rounded bg-amber-100 text-amber-700 border border-amber-200" title={`${o.invoice_payment_reminder_count} payment reminder(s) sent`}>
                                    🔔{o.invoice_payment_reminder_count}
                                  </span>
                                )}
                              </div>

                              {o.payment_status === "paid" ? (
                                <span className="px-2 py-1 text-xs font-bold rounded-full bg-green-100 text-green-800 border border-green-300">✓ Fully Paid</span>
                              ) : o.payment_status === "partial" ? (
                                <span className="px-2 py-1 text-xs font-bold rounded-full bg-orange-100 text-orange-800 border border-orange-300">
                                  ₹{(o.paid_amount || 0).toLocaleString()} Paid
                                </span>
                              ) : o.billing_status === "billed" ? (
                                <span className="px-2 py-1 text-xs font-bold rounded-full bg-red-100 text-red-800 border border-red-300">Unpaid/Billed</span>
                              ) : o.account_billing_mode === 'monthly' ? (
                                <span className="px-2 py-1 text-xs font-semibold rounded-full bg-purple-100 text-purple-800 border border-purple-300">🏢 Monthly Billing</span>
                              ) : (
                                <span className="px-2 py-1 text-xs font-semibold rounded-full bg-yellow-100 text-yellow-800 border border-yellow-300">Not Billed</span>
                              )}

                              <div className="flex flex-col items-end">
                                <span className="text-base font-bold text-gray-900">₹{Number(o.total_amount || 0).toLocaleString()}</span>
                                {o.payment_status !== "paid" && (o.due_amount || 0) > 0 && !o.account_name && (
                                  <span className="text-xs font-semibold text-red-600">Due: ₹{Number(o.due_amount || 0).toLocaleString()}</span>
                                )}
                              </div>

                              {o.priority !== "Normal" && (
                                <span className={`px-2 py-1 text-xs rounded-full ${o.priority === "Urgent" ? "bg-orange-100 text-orange-800" : "bg-red-100 text-red-800"}`}>
                                  {o.priority}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    // Expanded
                    <div className="space-y-4">
                      {g.orders.map((o) => {
                        const pct = o.expectedTotal > 0 ? Math.round((o.enteredTotal / o.expectedTotal) * 100) : 0;

                        return (
                          <div key={o.id} className="w-full p-4 border-2 rounded-lg hover:shadow-lg transition-all border-gray-200 bg-white">
                            {/* Top row */}
                            <div className="flex items-start justify-between gap-3 pb-3 border-b border-gray-200">
                              <div className="flex items-center gap-3 flex-1 min-w-0">
                                <div className="flex items-center justify-center w-8 h-8 bg-blue-100 text-blue-700 rounded-full font-bold text-sm border-2 border-blue-300 shrink-0">
                                  {String(getDailySeq(o)).padStart(3, "0")}
                                </div>
                                <User className="h-6 w-6 text-blue-600 shrink-0" />
                                <div className="min-w-0 flex-1">
                                  <div className="text-lg sm:text-xl font-bold text-gray-900 truncate">{o.patient?.name || o.patient_name}</div>
                                  <div className="text-sm text-gray-600 truncate">
                                    {(o.patient?.age || "N/A") + "y"} • {o.patient?.gender || "N/A"}
                                  </div>
                                  <div className="mt-1">
                                    <span className="text-xs text-gray-500 font-mono bg-gray-50 px-2 py-0.5 rounded border">
                                      {o.sample_id ? `#${String(o.sample_id).split("-").pop()} ` : "No Sample ID"}
                                    </span>
                                  </div>
                                </div>
                              </div>

                              <div className="flex flex-col items-end gap-2 shrink-0">
                                <div className="flex items-center gap-2">
                                  <OrderStatusDisplay order={o} compact={false} />
                                </div>

                                <div className="flex items-center gap-1.5">
                                  {o.report_url && (
                                    <span className="px-2 py-1 text-xs font-semibold rounded-lg bg-blue-100 text-blue-700 border border-blue-300" title="Final Report Available">
                                      📄 Report Ready
                                    </span>
                                  )}
                                  {o.doctor_informed_at && (
                                    <span className="px-2 py-1 text-xs font-semibold rounded-lg bg-purple-100 text-purple-700 border border-purple-300" title={`Doctor Informed: ${new Date(o.doctor_informed_at).toLocaleString()} `}>
                                      👨‍⚕️ Dr Informed
                                    </span>
                                  )}
                                  {(o.whatsapp_sent_at || o.email_sent_at) && (
                                    <span className="px-2 py-1 text-xs font-semibold rounded-lg bg-green-100 text-green-700 border border-green-300" title={`Sent: ${new Date(o.whatsapp_sent_at || o.email_sent_at!).toLocaleString()} `}>
                                      {o.whatsapp_sent_at ? "📱 Sent" : "📧 Emailed"}
                                    </span>
                                  )}
                                  {o.invoice_whatsapp_sent_at && (
                                    <span className="px-2 py-1 text-xs font-semibold rounded-lg bg-teal-100 text-teal-700 border border-teal-300" title={`Invoice sent via WhatsApp: ${new Date(o.invoice_whatsapp_sent_at).toLocaleString()} `}>
                                      💬 Invoice Sent
                                    </span>
                                  )}
                                  {o.invoice_email_sent_at && (
                                    <span className="px-2 py-1 text-xs font-semibold rounded-lg bg-indigo-100 text-indigo-700 border border-indigo-300" title={`Invoice sent via Email: ${new Date(o.invoice_email_sent_at).toLocaleString()} `}>
                                      ✉️ Invoice Emailed
                                    </span>
                                  )}
                                  {o.invoice_payment_reminder_count && o.invoice_payment_reminder_count > 0 && (
                                    <span
                                      className="px-2 py-1 text-xs font-semibold rounded-lg bg-amber-100 text-amber-700 border border-amber-300"
                                      title={`${o.invoice_payment_reminder_count} payment reminder(s) sent - Last: ${o.invoice_last_reminder_at ? new Date(o.invoice_last_reminder_at).toLocaleString() : "N/A"} `}
                                    >
                                      🔔 {o.invoice_payment_reminder_count} Reminder{o.invoice_payment_reminder_count > 1 ? "s" : ""}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>

                            {/* Doctor + sample row */}
                            <div className="flex items-center justify-between gap-3 py-3 bg-gradient-to-r from-purple-50 to-blue-50 rounded-lg px-3 mt-3 border border-purple-100">
                              <div className="flex items-center gap-4 flex-1">
                                {o.doctor && (
                                  <div className="flex items-center gap-2">
                                    <span className="text-2xl">👨‍⚕️</span>
                                    <div>
                                      <div className="text-xs text-gray-600 font-medium">Referring Doctor</div>
                                      <div className="text-base font-bold text-gray-900">{o.doctor}</div>
                                    </div>
                                  </div>
                                )}

                                {o.sample_id && (
                                  <div className="flex items-center gap-2">
                                    <div
                                      className="w-7 h-7 rounded-full border-2 border-white shadow-md flex items-center justify-center text-white font-bold text-xs"
                                      style={{ backgroundColor: o.color_code || "#8B5CF6" }}
                                      title={`Sample Color: ${o.color_code || "N/A"} `}
                                    >
                                      {(o.color_name || "T").charAt(0)}
                                    </div>
                                    <div>
                                      <div className="text-xs text-gray-600 font-medium">Sample ID</div>
                                      <div className="font-mono font-bold text-gray-900 text-sm">#{String(o.sample_id).split("-").pop()}</div>
                                    </div>
                                  </div>
                                )}

                                {o.account_name && (
                                  <div className="flex items-center gap-2 bg-indigo-50 border border-indigo-100 rounded-lg px-2 py-1">
                                    <Briefcase className="h-4 w-4 text-indigo-600" />
                                    <div>
                                      <div className="text-xs text-gray-600 font-medium">Account</div>
                                      <div className="text-sm font-bold text-indigo-800">{o.account_name}</div>
                                    </div>
                                  </div>
                                )}
                              </div>

                              <div className="text-right">
                                <div className="flex items-center justify-end gap-2">
                                  <div className="text-2xl font-bold text-gray-900">₹{Number(o.final_amount ?? o.total_amount ?? 0).toLocaleString()}</div>
                                  {getBillingBadge(o)}
                                </div>
                                {(o.due_amount || 0) > 0 ? (
                                  <span className="text-xs font-semibold text-red-600 mt-1">Due: ₹{Number(o.due_amount || 0).toLocaleString()}</span>
                                ) : (
                                  <span className="text-xs font-semibold text-green-600 mt-1">Due: ₹0</span>
                                )}
                              </div>
                            </div>

                            {/* Details */}
                            <div className="mt-3">
                              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 bg-blue-50 rounded-lg text-sm border border-blue-100">
                                {o.patient?.mobile && (
                                  <div className="flex items-center gap-1.5 text-blue-800">
                                    <span className="text-base">📱</span>
                                    <span className="font-semibold">{o.patient.mobile}</span>
                                  </div>
                                )}
                                {o.patient?.email && (
                                  <div className="flex items-center gap-1.5 text-blue-700">
                                    <span className="text-base">✉️</span>
                                    <span>{o.patient.email}</span>
                                  </div>
                                )}
                                {o.location && (
                                  <div className="flex items-center gap-1.5 text-purple-700">
                                    <span className="text-base">🏥</span>
                                    <span className="font-medium">{o.location}</span>
                                  </div>
                                )}
                                {o.transit_status && o.transit_status !== "received_at_lab" && (
                                  <div
                                    className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full ${o.transit_status === "in_transit"
                                      ? "bg-amber-100 text-amber-800"
                                      : o.transit_status === "pending_dispatch"
                                        ? "bg-yellow-100 text-yellow-800"
                                        : "bg-gray-100 text-gray-700"
                                      }`}
                                  >
                                    <span className="text-base">🚚</span>
                                    <span className="font-medium text-xs">
                                      {o.transit_status === "in_transit"
                                        ? "In Transit"
                                        : o.transit_status === "pending_dispatch"
                                          ? "Pending Dispatch"
                                          : o.transit_status === "at_collection_point"
                                            ? "At Collection"
                                            : o.transit_status}
                                    </span>
                                  </div>
                                )}
                              </div>

                              {/* Order Info & Tests */}
                              <div className="mt-3 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 bg-gray-50 rounded-lg p-3 border border-gray-200">
                                <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                                  <div className="min-w-[120px]">
                                    <div className="text-xs text-gray-500 font-medium">Order ID</div>
                                    <div className="font-bold text-gray-900 text-base">#{(o.id || "").slice(-6)}</div>
                                  </div>

                                  <div className="flex-1">
                                    {(() => {
                                      const packageTest = o.tests.find((t) => t.test_name?.startsWith("📦"));
                                      const packageName = packageTest?.test_name?.replace("📦", "").trim();

                                      return (
                                        <>
                                          <div className="text-xs text-gray-500 mb-1">
                                            Tests ({o.tests.length})
                                            {packageName && (
                                              <span className="ml-2 px-2 py-0.5 bg-purple-100 text-purple-700 rounded border border-purple-200 font-semibold">
                                                📦 {packageName}
                                              </span>
                                            )}
                                          </div>

                                          <div className="flex flex-wrap gap-2">
                                            {o.panels.length > 0
                                              ? o.panels.map((p, i) => {
                                                const progress = p.expected > 0 ? (p.entered / p.expected) * 100 : 0;

                                                return (
                                                  <div
                                                    key={`${p.name} -${i} `}
                                                    className={`flex items - center gap - 2 border rounded - lg px - 3 py - 1.5 shadow - sm transition - all duration - 300 ${p.verified
                                                      ? "border-green-200 bg-green-50"
                                                      : p.entered > 0
                                                        ? "border-amber-200 bg-amber-50"
                                                        : "border-gray-200 bg-white"
                                                      } `}
                                                  >
                                                    <SampleTypeIndicator
                                                      sampleType={p.sample_type || "Blood"}
                                                      sampleColor={o.color_code || undefined}
                                                      size="sm"
                                                    />
                                                    <div>
                                                      <div className="font-bold text-gray-900 text-xs">{p.name}</div>
                                                      <div className="text-[10px] text-gray-500 font-medium">
                                                        {p.entered}/{p.expected} {progress === 100 && "✓"}
                                                      </div>
                                                    </div>
                                                  </div>
                                                );
                                              })
                                              : o.tests
                                                .filter((t) => !t.test_name?.startsWith("📦"))
                                                .map((t, i) => (
                                                  <span key={i} className="px-2 py-0.5 rounded text-xs bg-blue-100 text-blue-800">
                                                    {t.test_name}
                                                  </span>
                                                ))}
                                          </div>
                                        </>
                                      );
                                    })()}
                                  </div>
                                </div>

                                <div className="text-right shrink-0">
                                  <div className="flex items-center justify-end gap-2 text-sm text-gray-600">
                                    <span>Ordered: {new Date(o.order_date).toLocaleDateString()}</span>
                                    {(() => {
                                      const now = new Date();
                                      const exp = new Date(o.expected_date);
                                      // Check if time is effectively midnight (Start of Day)
                                      // 00:00 (Local/UTC) or 05:30 (IST interpretation of UTC midnight)
                                      const isStartOfDay = (exp.getHours() === 0 && exp.getMinutes() === 0) ||
                                        (exp.getHours() === 5 && exp.getMinutes() === 30);

                                      // If start of day, treat deadline as end of day
                                      const cutoff = new Date(exp);
                                      if (isStartOfDay) {
                                        cutoff.setHours(23, 59, 59, 999);
                                      }

                                      const isOverdue = cutoff < now;
                                      const showTime = !isStartOfDay;

                                      return (
                                        <span className={isOverdue ? "text-red-600 font-semibold" : ""}>
                                          Exp: {exp.toLocaleDateString()}
                                          {showTime && " " + exp.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                                          {isOverdue && " ⚠️"}
                                        </span>
                                      );
                                    })()}
                                  </div>
                                </div>
                              </div>

                              {/* Additional Info */}
                              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 px-3 text-sm text-gray-600">
                                {o.collected_by && (
                                  <div className="flex items-center gap-1">
                                    <span className="font-medium text-gray-700">Collected by:</span>
                                    <span className="font-semibold">{o.collected_by}</span>
                                  </div>
                                )}
                                {o.sample_collected_at && (
                                  <div className="flex items-center gap-1">
                                    <span className="font-medium text-gray-700">Collection Time:</span>
                                    <span className="font-semibold">{new Date(o.sample_collected_at).toLocaleString()}</span>
                                  </div>
                                )}
                              </div>

                              {/* Actions */}
                              <div className="mt-3 flex flex-wrap gap-2 justify-end px-3 py-2 bg-gray-50 rounded-lg border-t-2 border-blue-200">
                                {!o.sample_collected_at && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleOpenCollectionModal(o);
                                    }}
                                    className="inline-flex items-center px-3 py-1.5 text-sm font-medium bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors shadow-sm"
                                    title="Mark Sample Collected"
                                  >
                                    <TestTube className="h-4 w-4 mr-1.5" />
                                    Collect
                                  </button>
                                )}

                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openDetails(o);
                                  }}
                                  className="inline-flex items-center px-3 py-1.5 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                                >
                                  <Eye className="h-4 w-4 mr-1.5" />
                                  View
                                </button>

                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleInformDoctor(o);
                                  }}
                                  disabled={!o.doctor_phone}
                                  className={`inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-lg text-white transition-colors ${o.doctor_phone ? "bg-green-600 hover:bg-green-700" : "bg-gray-300 cursor-not-allowed"}`}
                                  title={o.doctor_phone ? `Inform ${o.doctor || ""} ` : "Doctor phone not available"}
                                >
                                  <MessageCircle className="h-4 w-4 mr-1.5" />
                                  Inform Dr.
                                </button>

                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleSendReport(o, "whatsapp");
                                  }}
                                  disabled={!o.report_url || !!isSendingReport}
                                  className={`inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-lg text-white transition-colors ${o.report_url ? "bg-green-600 hover:bg-green-700" : "bg-gray-300 cursor-not-allowed"}`}
                                  title={o.report_url ? "Send Report via WhatsApp" : "Report not generated yet"}
                                >
                                  <Send className="h-4 w-4 mr-1.5" />
                                  {isSendingReport === o.id ? "..." : "WhatsApp"}
                                </button>

                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleSendReport(o, "email");
                                  }}
                                  disabled={!o.report_url || !!isSendingReport}
                                  className={`inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-lg text-white transition-colors ${o.report_url ? "bg-blue-500 hover:bg-blue-600" : "bg-gray-300 cursor-not-allowed"}`}
                                  title={o.report_url ? "Send Report via Email" : "Report not generated yet"}
                                >
                                  <Mail className="h-4 w-4 mr-1.5" />
                                  Email
                                </button>

                                {o.billing_status === "billed" && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleSendInvoice(o);
                                    }}
                                    disabled={!!isSendingInvoice}
                                    className="inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-lg text-white bg-purple-600 hover:bg-purple-700 transition-colors"
                                    title="Generate & Send Invoice via WhatsApp"
                                  >
                                    <Receipt className="h-4 w-4 mr-1.5" />
                                    {isSendingInvoice === o.id ? "..." : "Invoice"}
                                  </button>
                                )}



                                {o.billing_status !== "billed" && (
                                  <>
                                    {o.account_billing_mode === 'monthly' ? (
                                      <div className="inline-flex items-center px-3 py-1.5 text-sm font-medium bg-gray-100 text-gray-600 rounded-lg border border-gray-200 cursor-help" title="To be billed in monthly consolidation">
                                        <Briefcase className="h-4 w-4 mr-1.5" />
                                        Monthly Account
                                      </div>
                                    ) : (
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleCreateInvoice(o.id);
                                        }}
                                        className="inline-flex items-center px-3 py-1.5 text-sm font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                                      >
                                        <DollarSign className="h-4 w-4 mr-1.5" />
                                        Invoice
                                      </button>
                                    )}
                                  </>
                                )}

                                {o.billing_status === "billed" && (
                                  <button
                                    onClick={async (e) => {
                                      e.stopPropagation();
                                      await handleRecordPayment(o.id);
                                    }}
                                    className="inline-flex items-center px-3 py-1.5 text-sm font-medium bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
                                  >
                                    <CreditCard className="h-4 w-4 mr-1.5" />
                                    Pay
                                  </button>
                                )}

                                {/* Delete Order (Admin Only) - Hide if billed */}
                                {['admin', 'administrator', 'super admin', 'lab_manager', 'owner', 'manager'].some(r => String(user?.user_metadata?.role || '').toLowerCase().includes(r)) && !o.is_billed && o.billing_status !== 'billed' && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleDeleteOrder(o.id);
                                    }}
                                    className="inline-flex items-center px-3 py-1.5 text-sm font-medium bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors border border-red-200"
                                    title="Delete Order"
                                  >
                                    <Trash2 className="h-4 w-4 mr-1.5" />
                                    Delete
                                  </button>
                                )}
                              </div>

                              {/* Progress */}
                              <div className="mt-3 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg p-3 border border-blue-200">
                                <div className="flex items-center justify-between text-xs mb-1">
                                  <span className="text-blue-800 font-medium flex items-center">📊 Overall Progress</span>
                                  <span className="text-blue-800 font-bold">
                                    {o.enteredTotal}/{o.expectedTotal} analytes
                                  </span>
                                </div>

                                <div className="relative w-full bg-gray-200 rounded-full h-2.5 overflow-hidden border">
                                  <div
                                    className="absolute left-0 top-0 h-2.5 transition-all duration-700 rounded-full"
                                    style={{
                                      width: `${pct}% `,
                                      background:
                                        pct === 0
                                          ? "#ef4444"
                                          : pct < 25
                                            ? "linear-gradient(90deg, #ef4444 0%, #f97316 100%)"
                                            : pct < 50
                                              ? "linear-gradient(90deg, #f97316 0%, #eab308 100%)"
                                              : pct < 75
                                                ? "linear-gradient(90deg, #eab308 0%, #84cc16 100%)"
                                                : pct < 100
                                                  ? "linear-gradient(90deg, #84cc16 0%, #22c55e 100%)"
                                                  : "#10b981",
                                      boxShadow: pct > 0 ? `0 0 12px ${pct < 50 ? "#ef444440" : "#22c55e40"} ` : "none",
                                    }}
                                  />

                                  <div
                                    className="absolute left-0 top-0 h-4 bg-green-600 transition-all duration-500 rounded-full opacity-80"
                                    style={{ width: `${o.expectedTotal > 0 ? (o.approvedAnalytes / o.expectedTotal) * 100 : 0}% ` }}
                                  />

                                  <div className="absolute top-0 w-0.5 h-4 bg-white shadow-lg" style={{ left: `${pct}% ` }} />

                                  {pct > 75 && (
                                    <div className="absolute inset-0 rounded-full opacity-30">
                                      <div className="absolute top-1 left-1/4 w-1 h-1 bg-white rounded-full animate-pulse" />
                                      <div className="absolute top-2 right-1/3 w-0.5 h-0.5 bg-white rounded-full animate-pulse delay-150" />
                                      <div className="absolute bottom-1 left-2/3 w-1 h-1 bg-white rounded-full animate-pulse delay-300" />
                                    </div>
                                  )}
                                </div>

                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 text-xs mt-1">
                                  <div className="inline-flex items-center bg-white rounded px-1.5 py-0.5 border border-gray-200">
                                    <span className="inline-block w-2 h-2 bg-red-400 rounded-full mr-1" />
                                    <span className="text-gray-600">
                                      Pending: <strong>{o.pendingAnalytes}</strong>
                                    </span>
                                  </div>
                                  <div className="inline-flex items-center bg-white rounded px-1.5 py-0.5 border border-amber-200">
                                    <span className="inline-block w-2 h-2 bg-amber-500 rounded-full mr-1" />
                                    <span className="text-amber-700">
                                      Approval: <strong>{o.forApprovalAnalytes}</strong>
                                    </span>
                                  </div>
                                  <div className="inline-flex items-center bg-white rounded px-1.5 py-0.5 border border-green-200">
                                    <span className="inline-block w-2 h-2 bg-green-500 rounded-full mr-1" />
                                    <span className="text-green-700">
                                      Approved: <strong>{o.approvedAnalytes}</strong>
                                    </span>
                                  </div>
                                  <div className="inline-flex items-center bg-white rounded px-1.5 py-0.5 border border-blue-200 justify-end">
                                    <span
                                      className={`font - bold text - xs ${pct < 25 ? "text-red-600" : pct < 50 ? "text-orange-600" : pct < 75 ? "text-yellow-600" : pct < 100 ? "text-lime-600" : "text-green-600"
                                        } `}
                                    >
                                      {pct < 25 ? "🔴" : pct < 50 ? "🟠" : pct < 75 ? "🟡" : pct < 100 ? "🟢" : "✅"} Total: {o.expectedTotal}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )
        }
      </div>

      {/* Footer stats */}
      <div className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg p-4 border border-blue-200">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-sm">
          <div className="flex items-center gap-6">
            <div className="flex items-center">
              <Calendar className="h-4 w-4 text-blue-600 mr-1" />
              <span className="text-blue-900 font-medium">
                Total Orders: {orders.length}
                {!allDates && (
                  <span className="text-blue-700 ml-1">
                    ({new Date(dateFrom).toLocaleDateString()} - {new Date(dateTo).toLocaleDateString()})
                  </span>
                )}
                {allDates && <span className="text-blue-700 ml-1">(All Dates)</span>}
              </span>
            </div>
            <div className="flex items-center">
              <AlertTriangle className="h-4 w-4 text-red-600 mr-1" />
              <span className="text-red-900 font-medium">Overdue: {orders.filter((o) => new Date(o.expected_date) < new Date()).length}</span>
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
      {
        showOrderForm && (
          <OrderForm
            initialBookingData={processingBooking}
            onClose={() => {
              setProcessingBooking(null); // Clear processing booking
              setShowOrderForm(false);
              fetchOrders();
            }}
            onSubmit={handleAddOrder}
          />
        )
      }

      {
        selectedOrder && (
          <DashboardOrderModal
            order={selectedOrder}
            onClose={() => setSelectedOrder(null)}
            onUpdateStatus={async (orderId: string, newStatus: string) => {
              try {
                const { error } = await database.orders.update(orderId, {
                  status: newStatus,
                  status_updated_at: new Date().toISOString(),
                  status_updated_by: user?.email || "Unknown",
                });
                if (error) {
                  console.error("Error updating order status:", error);
                  return;
                }
                await fetchOrders();
                setSelectedOrder(null);
              } catch (error) {
                console.error("Error updating order status:", error);
              }
            }}
          />
        )
      }

      {
        showInvoiceModal && invoiceOrderId && (
          <CreateInvoiceModal
            orderId={invoiceOrderId}
            onClose={() => {
              setShowInvoiceModal(false);
              setInvoiceOrderId(null);
            }}
            onSuccess={() => {
              setShowInvoiceModal(false);
              setInvoiceOrderId(null);
              fetchOrders();
            }}
          />
        )
      }

      {
        showPaymentModal && paymentInvoiceId && (
          <PaymentCapture
            invoiceId={paymentInvoiceId}
            onClose={() => {
              setShowPaymentModal(false);
              setPaymentInvoiceId(null);
            }}
            onSuccess={() => {
              setShowPaymentModal(false);
              setPaymentInvoiceId(null);
              // Small delay to ensure DB propagation
              setTimeout(() => fetchOrders(), 500);
            }}
          />
        )
      }

      {
        showCollectionModal && collectionOrder && ReactDOM.createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-md overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-100">
                <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                  <TestTube className="h-5 w-5 text-blue-600" />
                  Collect Sample
                </h3>
                <button onClick={() => setShowCollectionModal(false)} className="text-gray-400 hover:text-gray-600">
                  <span className="sr-only">Close</span>
                  <X className="h-6 w-6" />
                </button>
              </div>

              <div className="p-4 space-y-4">
                <div className="bg-blue-50 p-3 rounded-lg border border-blue-100">
                  <div className="text-sm text-blue-900 font-medium">{collectionOrder.patient_name}</div>
                  <div className="text-xs text-blue-700 flex gap-2 mt-1">
                    <span>Order #{collectionOrder.id.slice(-6)}</span>
                    <span>•</span>
                    <span>{collectionOrder.sample_id || "Sample Tracking"}</span>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Collected By (Optional)</label>
                  {labId && (
                    <PhlebotomistSelector
                      labId={labId}
                      value={selectedPhlebotomistId}
                      onChange={(id, name) => {
                        setSelectedPhlebotomistId(id || "");
                        setSelectedPhlebotomistName(name);
                      }}
                    />
                  )}
                </div>

                <div className="max-h-[60vh] overflow-y-auto pr-1">
                  <SampleCollectionTracker
                    orderId={collectionOrder.id}
                    collectedById={selectedPhlebotomistId || undefined}
                    onSampleCollected={() => {
                      fetchOrders();
                    }}
                  />
                </div>

                <div className="flex justify-end gap-3 mt-4 pt-2 border-t border-gray-100">
                  <button onClick={() => setShowCollectionModal(false)} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">
                    Close
                  </button>
                  <button onClick={handleSaveCollection} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 shadow-sm">
                    Save & Finish
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )
      }

      {
        Math.max(window.innerWidth) < 768 && (
          <MobileFAB icon={Plus} onClick={() => setShowOrderForm(true)} label="Create Order" />
        )
      }
    </>
  );
};

export default Dashboard;
