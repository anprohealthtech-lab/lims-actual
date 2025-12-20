import React, { useEffect, useMemo, useState } from "react";
import {
  Plus, Search, Filter, Clock as ClockIcon, CheckCircle, AlertTriangle,
  Eye, User, Calendar, TestTube, ChevronDown, ChevronUp, TrendingUp,
  UserPlus, DollarSign, FileText, CreditCard, LayoutDashboard, Users,
  MessageCircle, Mail, Send, Receipt
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
import { openWhatsAppManually, buildMessageWithReportLink } from "../utils/whatsappUtils";
import { usePDFGeneration } from "../hooks/usePDFGeneration";
import SampleTransitWidget from "../components/Dashboard/SampleTransitWidget";
import { generateInvoicePDF } from "../utils/invoicePdfService";

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
  doctor: string | null;

  // sample/meta needed by modal
  sample_id: string | null;
  color_code: string | null;
  color_name: string | null;
  sample_collected_at: string | null;
  sample_collected_by: string | null;

  // Billing fields
  billing_status?: 'pending' | 'partial' | 'billed' | null;
  is_billed?: boolean | null;

  // relations
  patients: { name?: string | null; age?: string | null; gender?: string | null } | null;
  order_tests: { id: string; test_group_id: string | null; test_name: string; outsourced_lab_id?: string | null; package_id?: string | null; outsourced_labs?: { name?: string | null } | null }[] | null;

  // daily sequence for sorting
  order_number?: number | null;
};

type Panel = {
  name: string;
  expected: number;
  entered: number;     // from view (clamped later)
  verified: boolean;
  status: ProgressRow["panel_status"];
};

type CardOrder = {
  id: string;
  patient_name: string;
  patient_id: string;
  patient_phone?: string | null;
  status: OrderStatus;
  priority: Priority;
  order_date: string;
  expected_date: string;
  total_amount: number;
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
  billing_status?: 'pending' | 'partial' | 'billed' | null;
  is_billed?: boolean | null;
  invoice_id?: string | null;
  paid_amount?: number;
  due_amount?: number;
  payment_status?: 'unpaid' | 'partial' | 'paid' | null;

  patient?: { name?: string | null; age?: string | null; gender?: string | null; mobile?: string | null; email?: string | null } | null;
  tests: {
    id: string;
    test_name: string;
    outsourced_lab_id?: string | null;
    outsourced_labs?: { name?: string | null } | null;
  }[];

  // derived
  panels: Panel[];
  expectedTotal: number;
  enteredTotal: number;

  // 3-bucket model
  pendingAnalytes: number;       // not started OR partial/in-progress
  forApprovalAnalytes: number;   // complete but not verified
  approvedAnalytes: number;      // verified

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
  const [isCollapsedView, setIsCollapsedView] = useState(false); // New collapsed view state
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"All" | OrderStatus>("All");

  // Date range state - default to last 7 days
  const [dateFrom, setDateFrom] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() - 7);
    return date.toISOString().split('T')[0];
  });
  const [dateTo, setDateTo] = useState(() => {
    return new Date().toISOString().split('T')[0];
  });

  const [showOrderForm, setShowOrderForm] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<CardOrder | null>(null);

  // State for invoice modal
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [invoiceOrderId, setInvoiceOrderId] = useState<string | null>(null);

  // State for payment modal
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentInvoiceId, setPaymentInvoiceId] = useState<string | null>(null);

  // PDF Generation
  const { generatePDF } = usePDFGeneration();
  const [isSendingReport, setIsSendingReport] = useState<string | null>(null); // orderId being processed
  const [isSendingInvoice, setIsSendingInvoice] = useState<string | null>(null); // orderId for invoice being sent

  // dashboard counters
  const [summary, setSummary] = useState({ allDone: 0, mostlyDone: 0, pending: 0, awaitingApproval: 0 });

  useEffect(() => {
    fetchOrders();
  }, [dateFrom, dateTo]); // Re-fetch when date range changes

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

    // 1) base orders with date range filter
    const { data: rows, error } = await supabase
      .from("orders")
      .select(`
        id, patient_id, patient_name, status, priority, order_date, expected_date, total_amount, doctor,
        order_number, sample_id, color_code, color_name, sample_collected_at, sample_collected_by,
        billing_status, is_billed, referring_doctor_id,
        location_id, transit_status, collected_at_location_id,
        patients(name, age, gender, phone, email),
        order_tests(id, test_group_id, test_name, outsourced_lab_id, package_id, outsourced_labs(name)),
        doctors ( phone, email ),
        locations!orders_location_id_fkey(id, name, type)
      `)
      .eq('lab_id', lab_id)
      .gte("order_date", dateFrom)
      .lte("order_date", dateTo + "T23:59:59.999Z")
      .order("order_date", { ascending: false });

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
      .from("v_order_test_progress")
      .select("*")
      .in("order_id", orderIds);

    if (pErr) console.error("progress view error", pErr);

    const byOrder = new Map<string, ProgressRow[]>();
    (prog || []).forEach((r) => {
      const arr = byOrder.get(r.order_id) || [];
      arr.push(r as ProgressRow);
      byOrder.set(r.order_id, arr);
    });

    // 3) Fetch invoices and payments for each order
    const invoicePromises = orderIds.map(async (orderId) => {
      const { data: invoice } = await database.invoices.getByOrderId(orderId);
      if (!invoice) return { orderId, invoice: null, payments: [], paidAmount: 0, deliveryStatus: {} };

      const { data: payments } = await database.payments.getByInvoiceId(invoice.id);
      const paidAmount = (payments || []).reduce((sum, p) => sum + (p.amount || 0), 0);

      // Fetch delivery status for this invoice
      const { data: deliveryStatus } = await database.invoices.getDeliveryStatus(invoice.id);

      return { orderId, invoice, payments: payments || [], paidAmount, deliveryStatus: deliveryStatus || {} };
    });

    const invoiceData = await Promise.all(invoicePromises);
    const invoiceMap = new Map(invoiceData.map(d => [d.orderId, d]));

    // 3.5) Fetch reports with delivery status for these orders
    let reportMap = new Map<string, {
      pdf_url: string | null;
      status: string | null;
      whatsapp_sent_at: string | null;
      whatsapp_sent_via: string | null;
      email_sent_at: string | null;
      email_sent_via: string | null;
      doctor_informed_at: string | null;
      doctor_sent_via: string | null;
    }>();
    if (orderIds.length > 0) {
      const { data: reportsData } = await supabase
        .from('reports')
        .select('order_id, pdf_url, status, report_type, whatsapp_sent_at, whatsapp_sent_via, email_sent_at, email_sent_via, doctor_informed_at, doctor_sent_via')
        .in('order_id', orderIds)
        .eq('report_type', 'final'); // Only care about final reports for sending

      if (reportsData) {
        reportsData.forEach((r: any) => {
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
      }
    }

    // 4) shape cards with new buckets
    const cards: CardOrder[] = orderRows.map((o) => {
      const rows = byOrder.get(o.id) || [];
      const invoiceInfo = invoiceMap.get(o.id);
      const reportInfo = reportMap.get(o.id);
      const panels: Panel[] = rows.map((r) => ({
        name: r.test_group_name || "Test",
        expected: r.expected_analytes || 0,
        entered: r.entered_analytes || 0,
        verified: !!r.is_verified,
        status: r.panel_status,
      }));

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

      // Extract doctor info
      const doctorData = (o as any).doctors;
      const doctor_phone = doctorData?.phone || null;
      const doctor_email = doctorData?.email || null;

      // Debug logging for verification (can be removed later)
      if (o.id && expectedTotal > 0) {
        console.debug(`Order ${o.id.slice(-6)}: Expected=${expectedTotal}, Entered=${enteredTotal}, Approved=${approvedAnalytes}, Pending=${pendingAnalytes}, ForApproval=${forApprovalAnalytes}`);
      }

      return {
        id: o.id,
        patient_name: o.patient_name,
        patient_id: o.patient_id,
        patient_phone: (o.patients as any)?.phone,
        status: o.status,
        priority: o.priority,
        order_date: o.order_date,
        expected_date: o.expected_date,
        total_amount: o.total_amount,
        doctor: o.doctor,
        doctor_phone,
        doctor_email,

        order_number: o.order_number ?? null,
        sample_id: o.sample_id,
        color_code: o.color_code,
        color_name: o.color_name,
        sample_collected_at: o.sample_collected_at,
        sample_collected_by: o.sample_collected_by,

        // Billing fields
        billing_status: o.billing_status,
        is_billed: o.is_billed,
        invoice_id: invoiceInfo?.invoice?.id || null,
        paid_amount: invoiceInfo?.paidAmount || 0,
        due_amount: invoiceInfo?.invoice
          ? Math.max(0, (invoiceInfo.invoice.total || invoiceInfo.invoice.total_amount || 0) - (invoiceInfo.paidAmount || 0))
          : o.total_amount,
        payment_status: !invoiceInfo?.invoice ? 'unpaid' :
          (() => {
            const total = invoiceInfo.invoice.total || invoiceInfo.invoice.total_amount || 0;
            const paid = invoiceInfo.paidAmount || 0;
            return paid > 0 && paid >= total ? 'paid' : (paid > 0 ? 'partial' : 'unpaid');
          })(),

        patient: {
          name: (o.patients as any)?.name,
          age: (o.patients as any)?.age,
          gender: (o.patients as any)?.gender,
          mobile: (o.patients as any)?.phone,
          email: (o.patients as any)?.email
        },
        tests: (o.order_tests || []).map((t: any) => ({
          id: t.id,
          test_name: t.test_name,
          outsourced_lab_id: t.outsourced_lab_id,
          outsourced_labs: t.outsourced_labs
        })),

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
        invoice_whatsapp_sent_at: invoiceInfo?.deliveryStatus?.whatsapp_sent_at,
        invoice_whatsapp_sent_via: invoiceInfo?.deliveryStatus?.whatsapp_sent_via,
        invoice_email_sent_at: invoiceInfo?.deliveryStatus?.email_sent_at,
        invoice_email_sent_via: invoiceInfo?.deliveryStatus?.email_sent_via,
        invoice_payment_reminder_count: invoiceInfo?.deliveryStatus?.payment_reminder_count,
        invoice_last_reminder_at: invoiceInfo?.deliveryStatus?.last_reminder_at,

        // Location and transit fields
        location_id: (o as any).location_id || null,
        location: (o as any).locations?.name || null,
        transit_status: (o as any).transit_status || null,
        collected_at_location_id: (o as any).collected_at_location_id || null,
        collected_by: o.sample_collected_by || null,
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

  // Add this function after the existing fetchOrders function
  const handleAddOrder = async (orderData: any) => {
    try {
      console.log('Dashboard: Creating new order:', orderData);
      console.log('Dashboard: Tests array:', orderData.tests, 'Length:', orderData.tests?.length);
      console.log('Dashboard: Test objects structure:', orderData.tests?.[0]);

      // Validate required fields before API call
      if (!orderData.patient_id) {
        alert('❌ Error: Patient is required');
        throw new Error('Patient is required');
      }

      if (!orderData.referring_doctor_id && !orderData.doctor) {
        alert('❌ Error: Referring doctor is required');
        throw new Error('Referring doctor is required');
      }

      // Get current user's lab ID and add it to orderData
      const labId = await database.getCurrentUserLabId();
      const orderDataWithLab = { ...orderData, lab_id: labId };

      // Create the order in the database (pass through like Orders page does)
      const { data: order, error: orderError } = await database.orders.create(orderDataWithLab);
      if (orderError) {
        console.error('Dashboard: Error creating order:', orderError);
        const errorMessage = orderError.message || 'Failed to create order';
        alert(`❌ Order Creation Failed: ${errorMessage}`);
        throw orderError;
      }

      console.log('Dashboard: Order created successfully:', order);

      // Update any pending TRF attachments to link to this order
      const PENDING_ORDER_UUID = '00000000-0000-0000-0000-000000000000';
      const { error: updateError } = await supabase
        .from('attachments')
        .update({ related_id: order.id })
        .eq('related_table', 'orders')
        .eq('related_id', PENDING_ORDER_UUID)
        .eq('description', 'Test Request Form for order creation');

      if (updateError) {
        console.warn('Failed to update TRF attachment:', updateError);
        // Non-critical error, continue with order creation
      } else {
        console.log('Updated TRF attachment to link to order:', order.id);
      }

      // Refresh orders
      await fetchOrders();

      // Close the form
      setShowOrderForm(false);

      // Show success message
      alert('✅ Order created successfully!');
    } catch (error: any) {
      console.error('Dashboard: Error creating order:', error);
      // Don't close form on error so user can fix issues
      // Error message already shown above
    }
  };

  // Handler for creating invoices
  const handleCreateInvoice = (orderId: string) => {
    setInvoiceOrderId(orderId);
    setShowInvoiceModal(true);
  };

  const handleRecordPayment = async (orderId: string) => {
    try {
      // Fetch the invoice for this order
      const { data: invoice, error } = await database.invoices.getByOrderId(orderId);

      if (error || !invoice) {
        alert('No invoice found for this order. Please create an invoice first.');
        return;
      }

      setPaymentInvoiceId(invoice.id);
      setShowPaymentModal(true);
    } catch (error) {
      console.error('Error fetching invoice for order:', error);
      alert('Failed to fetch invoice details. Please try again.');
    }
  };

  const handleInformDoctor = async (order: CardOrder) => {
    if (!order.doctor_phone) {
      alert("Doctor's phone number not found. Please ensure the doctor profile has a valid phone number.");
      return;
    }

    try {
      // Check for final report
      const { data: report } = await database.reports.getByOrderId(order.id);

      // Check if already informed
      if (report && report.doctor_informed_at) {
        const informedDate = new Date(report.doctor_informed_at).toLocaleString();
        const confirmResend = window.confirm(
          `Doctor was already informed on ${informedDate} via ${report.doctor_informed_via || 'WhatsApp'}.\n\nSend again?`
        );
        if (!confirmResend) return;
      }

      // If final report exists, send with PDF and clinical summary
      if (report && report.report_type === 'final' && report.pdf_url) {
        // Fetch order details for clinical summary
        const { data: orderData } = await supabase
          .from('orders')
          .select('ai_clinical_summary, include_clinical_summary_in_report')
          .eq('id', order.id)
          .single();

        const includeClinicalSummary = orderData?.include_clinical_summary_in_report || false;
        const clinicalSummary = orderData?.ai_clinical_summary || '';

        let message = `Hello Dr. ${order.doctor || 'Doctor'},\n\nThe final report for patient ${order.patient_name} (Order #${order.id.slice(-6)}) is ready.`;

        // Add clinical summary if toggled
        if (includeClinicalSummary && clinicalSummary) {
          message += `\n\n📋 Clinical Summary:\n${clinicalSummary}`;
        }

        message += `\n\nPlease find the attached report.\n\nThank you.`;

        const connection = await WhatsAppAPI.getConnectionStatus();
        if (!connection?.success || !connection.isConnected) {
          // Fallback: offer manual WhatsApp link (openWhatsAppManually handles confirmation)
          const { success, method } = await openWhatsAppManually(
            order.doctor_phone,
            message,
            report.pdf_url,
            'doctor'
          );
          if (success && method === 'manual_link') {
            // Record as manual link send
            const { data: { user } } = await supabase.auth.getUser();
            await database.reports.recordDoctorNotification(report.id, {
              via: 'whatsapp',
              sentBy: user?.id || '',
              sentVia: 'manual_link'
            });
            alert('WhatsApp opened. Please send the message manually.');
            fetchOrders();
          }
          return;
        }

        const formattedPhone = WhatsAppAPI.formatPhoneNumber(order.doctor_phone);
        if (!WhatsAppAPI.validatePhoneNumber(order.doctor_phone)) {
          alert('Invalid phone number format. Please update the doctor phone.');
          return;
        }

        const confirmMsg = window.confirm(`Send final report to Dr. ${order.doctor} (${order.doctor_phone})?\n\nMessage:\n${message}`);
        if (!confirmMsg) return;

        const result = await WhatsAppAPI.sendReportFromUrl(
          formattedPhone,
          report.pdf_url,
          message,
          order.patient_name
        );

        if (result.success) {
          // Record doctor notification
          const { data: { user } } = await supabase.auth.getUser();
          await database.reports.recordDoctorNotification(report.id, {
            via: 'whatsapp',
            sentBy: user?.id || '',
          });
          alert('Report sent to doctor successfully!');
          // Refresh orders to update status badges
          fetchOrders();
        } else {
          alert('Failed to send report: ' + result.message);
        }

        return;
      }

      // No final report - send text-only notification (current functionality)
      let message = '';

      try {
        const labId = await database.getCurrentUserLabId();
        const { data: template } = await database.whatsappTemplates.getDefault('doctor_notification', labId);

        if (template) {
          const { data: labData } = await supabase
            .from('labs')
            .select('name, address, phone, email')
            .eq('id', labId!)
            .single();

          // Get test names from order tests
          const testNames = order.tests?.map(t => t.test_name).join(', ') || 'Tests';

          const { replacePlaceholders } = await import('../utils/whatsappTemplates');
          message = replacePlaceholders(template.message_content, {
            DoctorName: order.doctor || 'Doctor',
            PatientName: order.patient_name,
            OrderId: order.id.slice(-6),
            OrderStatus: order.status,
            TestName: testNames,
            LabName: labData?.name || '',
            LabAddress: labData?.address || '',
            LabContact: labData?.phone || '',
            LabEmail: labData?.email || '',
          });
        }
      } catch (err) {
        console.error('Error fetching template:', err);
      }

      if (!message) {
        message = `Hello Dr. ${order.doctor || 'Doctor'},\n\nOrder #${order.id.slice(-6)} for patient ${order.patient_name} is currently ${order.status}.`;
      }

      // Fetch results to include if available
      try {
        const { data: results } = await database.results.getByOrderId(order.id);

        if (results && results.length > 0) {
          const availableResults: string[] = [];

          results.forEach((r: any) => {
            if (r.result_values && r.result_values.length > 0) {
              r.result_values.forEach((rv: any) => {
                if (rv.value) {
                  availableResults.push(`${rv.parameter}: ${rv.value} ${rv.unit || ''} ${rv.flag ? `(${rv.flag})` : ''}`);
                }
              });
            }
          });

          if (availableResults.length > 0) {
            message += `\n\nCurrent Results:\n${availableResults.join('\n')}`;
          }
        }
      } catch (err) {
        console.error('Error fetching results for message:', err);
      }

      if (!message.includes('Thank you')) {
        message += `\n\nThank you.`;
      }

      const connection = await WhatsAppAPI.getConnectionStatus();
      if (!connection?.success || !connection.isConnected) {
        // Fallback: offer manual WhatsApp link (no PDF - text only)
        const { success, method } = await openWhatsAppManually(
          order.doctor_phone,
          message,
          undefined, // no PDF for text-only notification
          'doctor'
        );
        if (success && method === 'manual_link') {
          // Record as manual link send if report exists
          if (report) {
            const { data: { user } } = await supabase.auth.getUser();
            await database.reports.recordDoctorNotification(report.id, {
              via: 'whatsapp',
              sentBy: user?.id || '',
              sentVia: 'manual_link'
            });
          }
          alert('WhatsApp opened. Please send the message manually.');
          fetchOrders();
        }
        return;
      }

      const formattedPhone = WhatsAppAPI.formatPhoneNumber(order.doctor_phone);
      if (!WhatsAppAPI.validatePhoneNumber(order.doctor_phone)) {
        alert('Invalid phone number format. Please update the doctor phone.');
        return;
      }

      const confirmMsg = window.confirm(`Send WhatsApp to Dr. ${order.doctor} (${order.doctor_phone})?\n\nMessage:\n${message}`);
      if (!confirmMsg) return;

      const result = await WhatsAppAPI.sendTextMessage(formattedPhone, message);
      if (result.success) {
        // Record text-only notification if report exists
        if (report) {
          const { data: { user } } = await supabase.auth.getUser();
          await database.reports.recordDoctorNotification(report.id, {
            via: 'whatsapp',
            sentBy: user?.id || '',
          });
        }
        alert('Message sent successfully!');
        // Refresh orders to update status badges
        fetchOrders();
      } else {
        alert('Failed to send message: ' + result.message);
      }
    } catch (error) {
      console.error('Error sending message:', error);
      alert('Error sending message.');
    }
  };

  const handleSendReport = async (order: CardOrder, type: 'whatsapp' | 'email') => {
    if (isSendingReport) return;

    try {
      // Fetch final report
      const { data: report, error: reportError } = await database.reports.getByOrderId(order.id);

      if (reportError || !report) {
        alert('Report not found. Please generate it from the Reports page first.');
        return;
      }

      // Validate report is final
      if (report.report_type !== 'final') {
        alert('Cannot send draft report. Please ensure all results are verified and final report is generated.');
        return;
      }

      // Validate PDF URL exists
      if (!report.pdf_url) {
        alert('Report PDF not generated yet. Please generate it from the Reports page first.');
        return;
      }

      // Check if already sent
      const alreadySent = await database.reports.wasAlreadySent(report.id, type);
      if (alreadySent) {
        const sentField = type === 'whatsapp' ? 'whatsapp_sent_at' : 'email_sent_at';
        const { data: deliveryData } = await database.reports.getDeliveryStatus(report.id);
        const sentDate = deliveryData ? new Date(deliveryData[sentField]).toLocaleString() : 'unknown date';
        const sentTo = type === 'whatsapp' ? deliveryData?.whatsapp_sent_to : deliveryData?.email_sent_to;

        const confirmResend = window.confirm(
          `Report already sent via ${type} on ${sentDate}${sentTo ? ` to ${sentTo}` : ''}.\n\nSend again?`
        );
        if (!confirmResend) return;
      }

      setIsSendingReport(order.id);

      if (type === 'whatsapp') {
        // Get patient phone - prefer from order, then fetch from patients table
        let phone = order.patient_phone || '';

        // If no phone in order, try to fetch from patients table
        if (!phone && order.patient_id) {
          const { data: patientData } = await supabase
            .from('patients')
            .select('phone')
            .eq('id', order.patient_id)
            .single();
          phone = patientData?.phone || '';
        }

        // Normalize phone number - extract last 10 digits
        const normalizePhone = (p: string): string => {
          const digitsOnly = p.replace(/\D/g, '');
          if (digitsOnly.length <= 10) return digitsOnly;
          return digitsOnly.slice(-10);
        };

        phone = normalizePhone(phone);

        // Only prompt if phone is missing or invalid
        if (!phone || phone.length < 10) {
          const input = window.prompt("Patient phone not found. Enter phone number to send report:", phone);
          if (!input) {
            setIsSendingReport(null);
            return;
          }
          phone = normalizePhone(input);
        }

        // Validate phone
        if (phone.length !== 10) {
          alert('Invalid phone number. Please enter a valid 10-digit number.');
          setIsSendingReport(null);
          return;
        }

        // Build caption for patient - NO clinical summary (clinical summary is only for doctors)
        let caption = `Lab Report for ${order.patient_name} (Order #${order.id.slice(-6)})`;

        // Try to fetch template
        try {
          const labId = await database.getCurrentUserLabId();
          const { data: template } = await database.whatsappTemplates.getDefault('report_ready', labId);

          if (template) {
            const { data: labData } = await supabase
              .from('labs')
              .select('name, address, phone, email')
              .eq('id', labId!)
              .single();

            // Get test names from order tests
            const testNames = order.tests?.map(t => t.test_name).join(', ') || 'Tests';

            const { replacePlaceholders } = await import('../utils/whatsappTemplates');
            let baseCaption = replacePlaceholders(template.message_content, {
              PatientName: order.patient_name,
              OrderId: order.id.slice(-6),
              TestName: testNames,
              ReportUrl: report.pdf_url,
              LabName: labData?.name || '',
              LabAddress: labData?.address || '',
              LabContact: labData?.phone || '',
              LabEmail: labData?.email || '',
            });
            // Note: Clinical summary is NOT sent to patient - only to doctors via Inform Dr
            caption = baseCaption;
          }
        } catch (err) {
          console.error('Error fetching template:', err);
        }

        caption += `\n\nThank you.`;

        // Check connection first
        const connection = await WhatsAppAPI.getConnectionStatus();
        if (!connection?.success || !connection.isConnected) {
          // Fallback: offer manual WhatsApp link (openWhatsAppManually handles confirmation)
          const { success, method } = await openWhatsAppManually(
            phone,
            caption,
            report.pdf_url,
            'patient'
          );
          if (success && method === 'manual_link') {
            // Record as manual link send
            const { data: { user } } = await supabase.auth.getUser();
            await database.reports.recordWhatsAppSend(report.id, {
              to: phone,
              caption: caption,
              sentBy: user?.id || '',
              includedClinicalSummary: false,
              sentVia: 'manual_link'
            });
            alert('WhatsApp opened. Please send the message manually.');
            fetchOrders();
          }
          setIsSendingReport(null);
          return;
        }

        const result = await WhatsAppAPI.sendReportFromUrl(phone, report.pdf_url, caption, order.patient_name);

        if (result.success) {
          // Record WhatsApp send
          const { data: { user } } = await supabase.auth.getUser();
          await database.reports.recordWhatsAppSend(report.id, {
            to: phone,
            caption: caption,
            sentBy: user?.id || '',
            includedClinicalSummary: false, // Clinical summary is NOT sent to patients
          });
          alert('Report sent via WhatsApp!');
          // Refresh orders to update status badges
          fetchOrders();
        } else {
          alert('Failed to send report: ' + result.message);
        }

      } else if (type === 'email') {
        let email = (order as any).patient?.email || '';

        const input = window.prompt("Enter email address to send report:", email);
        if (!input) {
          setIsSendingReport(null);
          return;
        }
        email = input;

        // Build email body for patient - NO clinical summary (clinical summary is only for doctors)
        let emailBody = `Please find the lab report for ${order.patient_name} (Order #${order.id.slice(-6)}) below:\n\n`;
        emailBody += `Report Link: ${report.pdf_url}\n\nThank you.`;

        const subject = encodeURIComponent(`Lab Report: ${order.patient_name}`);
        const body = encodeURIComponent(emailBody);
        window.open(`mailto:${email}?subject=${subject}&body=${body}`, '_blank');

        // Record email send
        const { data: { user } } = await supabase.auth.getUser();
        await database.reports.recordEmailSend(report.id, {
          to: email,
          sentBy: user?.id || '',
          includedClinicalSummary: false, // Clinical summary is NOT sent to patients
        });

        alert('Email client opened. Please send the email.');
        // Refresh orders to update status badges
        fetchOrders();
      }

    } catch (error) {
      console.error('Error sending report:', error);
      alert('Failed to send report. Please try again.');
    } finally {
      setIsSendingReport(null);
    }
  };

  /**
   * Generate and send invoice via WhatsApp
   */
  const handleSendInvoice = async (order: CardOrder) => {
    if (isSendingInvoice) return;

    try {
      setIsSendingInvoice(order.id);

      // 1. Check if invoice exists for this order
      const { data: invoice, error: invoiceError } = await database.invoices.getByOrderId(order.id);

      if (invoiceError || !invoice) {
        alert('Invoice not found. Please create an invoice first.');
        setIsSendingInvoice(null);
        return;
      }

      // 2. Generate PDF if not already generated
      let pdfUrl = invoice.pdf_url;

      if (!pdfUrl) {
        alert('Generating invoice PDF...');

        // Get default template
        const { data: templates } = await database.invoiceTemplates.getAll();
        const defaultTemplate = templates?.find((t: any) => t.is_default) || templates?.[0];

        if (!defaultTemplate) {
          alert('No invoice template found. Please configure templates in Settings.');
          setIsSendingInvoice(null);
          return;
        }

        // Generate PDF
        pdfUrl = await generateInvoicePDF(invoice.id, defaultTemplate.id);

        if (!pdfUrl) {
          alert('Failed to generate invoice PDF.');
          setIsSendingInvoice(null);
          return;
        }
      }

      // 3. Get patient phone
      let phone = order.patient_phone || '';

      if (!phone && order.patient_id) {
        const { data: patientData } = await supabase
          .from('patients')
          .select('phone')
          .eq('id', order.patient_id)
          .single();
        phone = patientData?.phone || '';
      }

      // Normalize phone
      const normalizePhone = (p: string): string => {
        const digitsOnly = p.replace(/\D/g, '');
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
        alert('Invalid phone number. Please enter a valid 10-digit number.');
        setIsSendingInvoice(null);
        return;
      }

      // 4. Build message with invoice link
      const baseMessage = `Dear ${order.patient_name},\n\nYour invoice is ready.\n\n` +
        `Total Amount: ₹${invoice.total.toLocaleString()}\n` +
        (invoice.paid_amount > 0 ? `Paid: ₹${invoice.paid_amount.toLocaleString()}\nBalance Due: ₹${(invoice.total - invoice.paid_amount).toLocaleString()}\n\n` : '\n') +
        `Thank you for choosing our services!`;

      const messageWithLink = `Dear ${order.patient_name},\n\nYour invoice is ready. Please find the invoice PDF here:\n\n${pdfUrl}\n\n` +
        `Total Amount: ₹${invoice.total.toLocaleString()}\n` +
        (invoice.paid_amount > 0 ? `Paid: ₹${invoice.paid_amount.toLocaleString()}\nBalance Due: ₹${(invoice.total - invoice.paid_amount).toLocaleString()}\n\n` : '\n') +
        `Thank you for choosing our services!`;

      // 5. Try backend API first
      try {
        const connection = await WhatsAppAPI.getConnectionStatus();

        if (!connection.isConnected) {
          throw new Error('WhatsApp not connected');
        }

        const result = await WhatsAppAPI.sendReportFromUrl(
          phone,
          pdfUrl,
          baseMessage, // Send cleaner message without URL
          order.patient_name,
          'Invoice'
        );

        if (result.success) {
          // Record the API WhatsApp send in the database
          try {
            await database.invoices.recordWhatsAppSend(invoice.id, {
              to: phone,
              caption: baseMessage,
              sentBy: user?.id || '',
              sentVia: 'api'
            });
            console.log('Invoice WhatsApp delivery status recorded (API)');
          } catch (recordError) {
            console.error('Failed to record invoice WhatsApp send:', recordError);
          }

          alert('Invoice sent via WhatsApp successfully!');
          fetchOrders();
          setIsSendingInvoice(null);
          return;
        }
      } catch (apiError) {
        console.log('Backend API failed, falling back to manual WhatsApp:', apiError);
      }

      // 6. Fallback to manual WhatsApp link
      const { success: manualSuccess } = await openWhatsAppManually(phone, messageWithLink);

      if (manualSuccess) {
        // Record the manual WhatsApp send in the database
        try {
          await database.invoices.recordWhatsAppSend(invoice.id, {
            to: phone,
            caption: messageWithLink,
            sentBy: user?.id || '',
            sentVia: 'manual_link'
          });
          console.log('Invoice WhatsApp delivery status recorded');
        } catch (recordError) {
          console.error('Failed to record invoice WhatsApp send:', recordError);
        }

        alert('WhatsApp opened. Please send the message manually.');
        fetchOrders();
      }

    } catch (error) {
      console.error('Error sending invoice:', error);
      alert('Failed to send invoice. Please try again.');
    } finally {
      setIsSendingInvoice(null);
    }
  };

  // Billing badge helper
  const getBillingBadge = (order: any) => {
    if (order.billing_status === 'billed') {
      return <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">💰 Fully Billed</span>;
    } else if (order.billing_status === 'partial') {
      return <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">💸 Partially Billed</span>;
    } else {
      return <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800">📋 Not Billed</span>;
    }
  };

  /* ------------- filtering + grouping ------------- */
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return orders.filter((o) => {
      const matchesQ =
        o.patient_name.toLowerCase().includes(q) ||
        (o.patient_id || "").toLowerCase().includes(q) ||
        (o.id || "").toLowerCase().includes(q);
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

  const getPriorityBadge = (p: Priority) =>
  ({
    Normal: "bg-gray-100 text-gray-800",
    Urgent: "bg-orange-100 text-orange-800",
    STAT: "bg-red-100 text-red-800",
  }[p] || "bg-gray-100 text-gray-800");

  const openDetails = (o: CardOrder) => setSelectedOrder(o);

  // Date range preset functions
  const setDateRange = (days: number) => {
    const to = new Date();
    const from = new Date();
    from.setDate(to.getDate() - days);

    setDateTo(to.toISOString().split('T')[0]);
    setDateFrom(from.toISOString().split('T')[0]);
  };

  const setToday = () => {
    const today = new Date().toISOString().split('T')[0];
    setDateFrom(today);
    setDateTo(today);
  };

  /* ===========================
     UI
  =========================== */

  const mobile = useMobileOptimizations();

  return (
    <div className={mobile.spacing}>
      {/* Header - Mobile optimized */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h1 className={`${mobile.titleSize} font-bold text-gray-900`}>Test Orders</h1>
          {!mobile.isMobile && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsCollapsedView(!isCollapsedView)}
                className="px-4 py-2 rounded-lg font-medium transition-colors ${
                  isCollapsedView 
                    ? 'bg-blue-600 text-white' 
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }"
              >
                {isCollapsedView ? 'Expand Cards' : 'Collapse Cards'}
              </button>
              <button
                onClick={() => setShowOrderForm(true)}
                className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                <Plus className="h-5 w-5 mr-2" />
                Create Order
              </button>
            </div>
          )}
        </div>

        {/* View Toggle - Desktop only */}
        {!mobile.isMobile && (
          <div className="flex items-center gap-2">
            <button className="inline-flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg font-medium">
              <LayoutDashboard className="h-4 w-4" />
              Standard View
            </button>
            <button className="inline-flex items-center gap-2 px-4 py-2 bg-white text-gray-700 border border-gray-200 rounded-lg font-medium hover:bg-gray-50">
              <Users className="h-4 w-4" />
              Patient Visits
            </button>
          </div>
        )}
      </div>

      {/* Overview cards - 2x2 grid on mobile */}
      <div className={`grid ${mobile.gridCols} ${mobile.isMobile ? 'gap-3' : mobile.gap}`}>
        <div className={`bg-green-50 border border-green-200 rounded-lg ${mobile.isMobile ? 'p-4' : mobile.cardPadding}`}>
          <div className="flex items-center justify-between">
            <div>
              <div className={`${mobile.isMobile ? 'text-2xl' : 'text-2xl'} font-bold text-green-900`}>{summary.allDone}</div>
              <div className={`${mobile.isMobile ? 'text-sm' : mobile.textSize} text-green-700 font-medium`}>All Done</div>
            </div>
            <div className={`bg-green-500 ${mobile.isMobile ? 'p-2' : 'p-2'} rounded-lg`}>
              <CheckCircle className={`${mobile.isMobile ? 'h-5 w-5' : 'h-5 w-5'} text-white`} />
            </div>
          </div>
        </div>
        <div className={`bg-blue-50 border border-blue-200 rounded-lg ${mobile.isMobile ? 'p-4' : mobile.cardPadding}`}>
          <div className="flex items-center justify-between">
            <div>
              <div className={`${mobile.isMobile ? 'text-2xl' : 'text-2xl'} font-bold text-blue-900`}>{summary.mostlyDone}</div>
              <div className={`${mobile.isMobile ? 'text-sm' : mobile.textSize} text-blue-700 font-medium`}>Mostly Done</div>
            </div>
            <div className={`bg-blue-500 ${mobile.isMobile ? 'p-2' : 'p-2'} rounded-lg`}>
              <TrendingUp className={`${mobile.isMobile ? 'h-5 w-5' : 'h-5 w-5'} text-white`} />
            </div>
          </div>
        </div>
        <div className={`bg-yellow-50 border border-yellow-200 rounded-lg ${mobile.isMobile ? 'p-4' : mobile.cardPadding}`}>
          <div className="flex items-center justify-between">
            <div>
              <div className={`${mobile.isMobile ? 'text-2xl' : 'text-2xl'} font-bold text-yellow-900`}>{summary.pending}</div>
              <div className={`${mobile.isMobile ? 'text-sm' : mobile.textSize} text-yellow-700 font-medium`}>Pending</div>
            </div>
            <div className={`bg-yellow-500 ${mobile.isMobile ? 'p-2' : 'p-2'} rounded-lg`}>
              <ClockIcon className={`${mobile.isMobile ? 'h-5 w-5' : 'h-5 w-5'} text-white`} />
            </div>
          </div>
        </div>
        <div className={`bg-orange-50 border border-orange-200 rounded-lg ${mobile.isMobile ? 'p-4' : mobile.cardPadding}`}>
          <div className="flex items-center justify-between">
            <div>
              <div className={`${mobile.isMobile ? 'text-2xl' : 'text-2xl'} font-bold text-orange-900`}>{summary.awaitingApproval}</div>
              <div className={`${mobile.isMobile ? 'text-sm' : mobile.textSize} text-orange-700 font-medium`}>Awaiting Approval</div>
            </div>
            <div className={`bg-orange-500 ${mobile.isMobile ? 'p-2' : 'p-2'} rounded-lg`}>
              <AlertTriangle className={`${mobile.isMobile ? 'h-5 w-5' : 'h-5 w-5'} text-white`} />
            </div>
          </div>
        </div>
      </div>

      {/* Sample Transit Widget - for collection center users */}
      <SampleTransitWidget />

      {/* Search / Filters */}
      <div className={`bg-white rounded-lg border border-gray-200 ${mobile.cardPadding}`}>
        <div className="flex flex-col gap-3">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={mobile.isMobile ? "Search patient..." : "Search by patient, order ID, or patient ID…"}
              className={`w-full pl-10 pr-4 ${mobile.isMobile ? 'py-2.5 text-base' : 'py-2'} border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500`}
            />
          </div>

          {/* Status Filter Row */}
          <div className="flex gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className={`flex-1 ${mobile.isMobile ? 'px-3 py-2.5 text-base' : 'px-3 py-2'} border border-gray-300 rounded-lg bg-white font-medium`}
            >
              {["All", "Order Created", "Sample Collection", "In Progress", "Pending Approval", "Completed", "Delivered"].map(
                (s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                )
              )}
            </select>
            {!mobile.isMobile && (
              <button className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">
                <Filter className="h-4 w-4 mr-2" />
                More Filters
              </button>
            )}
          </div>

          {/* Date Range - Card Style for Mobile */}
          {mobile.isMobile ? (
            <div className="bg-gradient-to-br from-gray-50 to-blue-50 rounded-xl p-4 space-y-4 border border-gray-200">
              <h3 className="text-base font-bold text-gray-900">Date Range:</h3>

              {/* Date Inputs */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <label className="text-sm font-medium text-gray-600 w-16">From:</label>
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-sm font-medium text-gray-600 w-16">To:</label>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white"
                  />
                </div>
              </div>

              {/* Quick Presets - 2x3 Grid */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={setToday}
                  className="px-3 py-2.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium shadow-sm"
                >
                  Today
                </button>
                <button
                  onClick={() => setDateRange(7)}
                  className="px-3 py-2.5 text-sm bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-medium"
                >
                  7 days
                </button>
                <button
                  onClick={() => setDateRange(30)}
                  className="px-3 py-2.5 text-sm bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-medium"
                >
                  30 days
                </button>
                <button
                  onClick={() => setDateRange(90)}
                  className="px-3 py-2.5 text-sm bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-medium"
                >
                  90 days
                </button>
                <button
                  onClick={() => {
                    setDateFrom('');
                    setDateTo('');
                  }}
                  className="col-span-2 px-3 py-2.5 text-sm bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-medium"
                >
                  All Dates
                </button>
              </div>

              {/* Status Filters */}
              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-gray-200">
                <button
                  onClick={() => setStatusFilter("Pending Approval")}
                  className={`px-3 py-2.5 text-sm rounded-lg font-medium ${statusFilter === "Pending Approval"
                    ? 'bg-orange-500 text-white shadow-sm'
                    : 'bg-orange-100 text-orange-700 hover:bg-orange-200'
                    }`}
                >
                  Pending
                </button>
                <button
                  onClick={() => setStatusFilter("All")}
                  className={`px-3 py-2.5 text-sm rounded-lg font-medium ${statusFilter === "All"
                    ? 'bg-gray-700 text-white shadow-sm'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                >
                  All
                </button>
              </div>
            </div>
          ) : (
            /* Desktop Layout - Keep Original */
            <div className="pt-2 border-t border-gray-100">
              <div className="flex items-center gap-2 mb-2">
                <Calendar className="h-4 w-4 text-gray-600" />
                <span className="text-sm font-medium text-gray-700">Date Range:</span>
              </div>

              <div className="flex gap-2 mb-2">
                <div className="flex-1">
                  <label className="text-sm text-gray-600 block mb-1">From:</label>
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="w-full px-3 py-1.5 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="flex-1">
                  <label className="text-sm text-gray-600 block mb-1">To:</label>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="w-full px-3 py-1.5 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-1">
                <button
                  onClick={setToday}
                  className="px-3 py-1 text-sm bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                >
                  Today
                </button>
                <button
                  onClick={() => setDateRange(7)}
                  className="px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
                >
                  7 days
                </button>
                <button
                  onClick={() => setDateRange(30)}
                  className="px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
                >
                  30 days
                </button>
                <button
                  onClick={() => setDateRange(90)}
                  className="px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
                >
                  90 days
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Groups + Cards */}
      <div className={`bg-white rounded-lg border border-gray-200 ${mobile.isMobile ? 'mb-20' : ''}`}>
        <div className={`${mobile.isMobile ? 'px-3 py-3' : 'px-6 py-4'} border-b border-gray-200`}>
          <h3 className={`${mobile.isMobile ? 'text-base' : 'text-lg'} font-semibold text-gray-900`}>Test Orders ({filtered.length})</h3>
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

                {isCollapsedView ? (
                  /* Collapsed View - One Line Summary */
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
                            <span className="text-xs text-gray-500">{o.sample_id ? `#${String(o.sample_id).split("-").pop()}` : 'No Sample'}</span>
                          </div>
                          <div className="flex items-center space-x-3 flex-shrink-0">
                            <div className="text-xs text-gray-600">
                              {pct}% ({o.enteredTotal}/{o.expectedTotal})
                            </div>
                            <OrderStatusDisplay order={o} compact={true} />

                            {/* Delivery Status Indicators */}
                            <div className="flex items-center space-x-1">
                              {/* Report Ready */}
                              {o.report_url && (
                                <span
                                  className="px-1.5 py-0.5 text-xs font-medium rounded bg-blue-100 text-blue-700 border border-blue-200"
                                  title="Final Report Available"
                                >
                                  📄
                                </span>
                              )}

                              {/* Doctor Informed */}
                              {o.doctor_informed_at && (
                                <span
                                  className="px-1.5 py-0.5 text-xs font-medium rounded bg-purple-100 text-purple-700 border border-purple-200"
                                  title={`Doctor Informed: ${new Date(o.doctor_informed_at).toLocaleString()}`}
                                >
                                  👨‍⚕️
                                </span>
                              )}

                              {/* Sent to Patient */}
                              {(o.whatsapp_sent_at || o.email_sent_at) && (
                                <span
                                  className="px-1.5 py-0.5 text-xs font-medium rounded bg-green-100 text-green-700 border border-green-200"
                                  title={`Sent: ${new Date(o.whatsapp_sent_at || o.email_sent_at!).toLocaleString()}`}
                                >
                                  {o.whatsapp_sent_at ? '📱' : '📧'}
                                </span>
                              )}

                              {/* Invoice Delivery Status */}
                              {o.invoice_whatsapp_sent_at && (
                                <span
                                  className="px-1.5 py-0.5 text-xs font-medium rounded bg-teal-100 text-teal-700 border border-teal-200"
                                  title={`Invoice sent via WhatsApp: ${new Date(o.invoice_whatsapp_sent_at).toLocaleString()}`}
                                >
                                  💬
                                </span>
                              )}

                              {o.invoice_email_sent_at && (
                                <span
                                  className="px-1.5 py-0.5 text-xs font-medium rounded bg-indigo-100 text-indigo-700 border border-indigo-200"
                                  title={`Invoice sent via Email: ${new Date(o.invoice_email_sent_at).toLocaleString()}`}
                                >
                                  ✉️
                                </span>
                              )}

                              {o.invoice_payment_reminder_count && o.invoice_payment_reminder_count > 0 && (
                                <span
                                  className="px-1.5 py-0.5 text-xs font-medium rounded bg-amber-100 text-amber-700 border border-amber-200"
                                  title={`${o.invoice_payment_reminder_count} payment reminder(s) sent`}
                                >
                                  🔔{o.invoice_payment_reminder_count}
                                </span>
                              )}
                            </div>

                            {/* Combined Billing & Payment Status Badge */}
                            {o.payment_status === 'paid' ? (
                              <span className="px-2 py-1 text-xs font-bold rounded-full bg-green-100 text-green-800 border border-green-300">
                                ✓ Fully Paid
                              </span>
                            ) : o.payment_status === 'partial' ? (
                              <span className="px-2 py-1 text-xs font-bold rounded-full bg-orange-100 text-orange-800 border border-orange-300">
                                ₹{(o.paid_amount || 0).toLocaleString()} Paid
                              </span>
                            ) : o.billing_status === 'billed' ? (
                              <span className="px-2 py-1 text-xs font-bold rounded-full bg-red-100 text-red-800 border border-red-300">
                                Unpaid/Billed
                              </span>
                            ) : (
                              <span className="px-2 py-1 text-xs font-semibold rounded-full bg-yellow-100 text-yellow-800 border border-yellow-300">
                                Not Billed
                              </span>
                            )}

                            {/* Amount with Due Highlight */}
                            <div className="flex flex-col items-end">
                              <span className="text-base font-bold text-gray-900">₹{Number(o.total_amount || 0).toLocaleString()}</span>
                              {o.payment_status !== 'paid' && o.due_amount > 0 && (
                                <span className="text-xs font-semibold text-red-600">Due: ₹{(o.due_amount || 0).toLocaleString()}</span>
                              )}
                            </div>
                            {o.priority !== 'Normal' && (
                              <span className={`px-2 py-1 text-xs rounded-full ${o.priority === 'Urgent' ? 'bg-orange-100 text-orange-800' : 'bg-red-100 text-red-800'
                                }`}>
                                {o.priority}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  /* Expanded View - Full Cards with All Details */
                  <div className="space-y-4">
                    {g.orders.map((o) => {
                      const pct = o.expectedTotal > 0 ? Math.round((o.enteredTotal / o.expectedTotal) * 100) : 0;
                      return (
                        <div
                          key={o.id}
                          className="w-full p-4 border-2 rounded-lg hover:shadow-lg transition-all border-gray-200 bg-white"
                        >
                          {/* Top row - Patient Info + Order Status + Delivery Status */}
                          <div className="flex items-start justify-between gap-3 pb-3 border-b border-gray-200">
                            <div className="flex items-center gap-3 flex-1 min-w-0">
                              <div className="flex items-center justify-center w-8 h-8 bg-blue-100 text-blue-700 rounded-full font-bold text-sm border-2 border-blue-300 shrink-0">
                                {String(getDailySeq(o)).padStart(3, "0")}
                              </div>
                              <User className="h-6 w-6 text-blue-600 shrink-0" />
                              <div className="min-w-0 flex-1">
                                <div className="text-lg sm:text-xl font-bold text-gray-900 truncate">
                                  {o.patient?.name || o.patient_name}
                                </div>
                                <div className="text-sm text-gray-600 truncate">
                                  {(o.patient?.age || "N/A") + "y"} • {o.patient?.gender || "N/A"}
                                </div>
                              </div>
                            </div>

                            <div className="flex flex-col items-end gap-2 shrink-0">
                              <div className="flex items-center gap-2">
                                <OrderStatusDisplay order={o} compact={false} />
                              </div>

                              {/* Delivery Status Badges - Prominent */}
                              <div className="flex items-center gap-1.5">
                                {o.report_url && (
                                  <span
                                    className="px-2 py-1 text-xs font-semibold rounded-lg bg-blue-100 text-blue-700 border border-blue-300"
                                    title="Final Report Available"
                                  >
                                    📄 Report Ready
                                  </span>
                                )}

                                {o.doctor_informed_at && (
                                  <span
                                    className="px-2 py-1 text-xs font-semibold rounded-lg bg-purple-100 text-purple-700 border border-purple-300"
                                    title={`Doctor Informed: ${new Date(o.doctor_informed_at).toLocaleString()}`}
                                  >
                                    👨‍⚕️ Dr Informed
                                  </span>
                                )}

                                {(o.whatsapp_sent_at || o.email_sent_at) && (
                                  <span
                                    className="px-2 py-1 text-xs font-semibold rounded-lg bg-green-100 text-green-700 border border-green-300"
                                    title={`Sent: ${new Date(o.whatsapp_sent_at || o.email_sent_at!).toLocaleString()}`}
                                  >
                                    {o.whatsapp_sent_at ? '📱 Sent' : '📧 Emailed'}
                                  </span>
                                )}

                                {/* Invoice Delivery Badges */}
                                {o.invoice_whatsapp_sent_at && (
                                  <span
                                    className="px-2 py-1 text-xs font-semibold rounded-lg bg-teal-100 text-teal-700 border border-teal-300"
                                    title={`Invoice sent via WhatsApp: ${new Date(o.invoice_whatsapp_sent_at).toLocaleString()}`}
                                  >
                                    💬 Invoice Sent
                                  </span>
                                )}

                                {o.invoice_email_sent_at && (
                                  <span
                                    className="px-2 py-1 text-xs font-semibold rounded-lg bg-indigo-100 text-indigo-700 border border-indigo-300"
                                    title={`Invoice sent via Email: ${new Date(o.invoice_email_sent_at).toLocaleString()}`}
                                  >
                                    ✉️ Invoice Emailed
                                  </span>
                                )}

                                {o.invoice_payment_reminder_count && o.invoice_payment_reminder_count > 0 && (
                                  <span
                                    className="px-2 py-1 text-xs font-semibold rounded-lg bg-amber-100 text-amber-700 border border-amber-300"
                                    title={`${o.invoice_payment_reminder_count} payment reminder(s) sent - Last: ${o.invoice_last_reminder_at ? new Date(o.invoice_last_reminder_at).toLocaleString() : 'N/A'}`}
                                  >
                                    🔔 {o.invoice_payment_reminder_count} Reminder{o.invoice_payment_reminder_count > 1 ? 's' : ''}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Doctor Name & Sample Info - Prominent Row */}
                          <div className="flex items-center justify-between gap-3 py-3 bg-gradient-to-r from-purple-50 to-blue-50 rounded-lg px-3 mt-3 border border-purple-100">
                            <div className="flex items-center gap-4 flex-1">
                              {o.doctor && (
                                <div className="flex items-center gap-2">
                                  <span className="text-2xl">👨‍⚕️</span>
                                  <div>
                                    <div className="text-xs text-gray-600 font-medium">Referring Doctor</div>
                                    <div className="text-base font-bold text-gray-900">Dr. {o.doctor}</div>
                                  </div>
                                </div>
                              )}

                              {o.sample_id && (
                                <div className="flex items-center gap-2">
                                  <div
                                    className="w-7 h-7 rounded-full border-2 border-white shadow-md flex items-center justify-center text-white font-bold text-xs"
                                    style={{ backgroundColor: o.color_code || "#8B5CF6" }}
                                    title={`Sample Tube: ${o.color_name || "Tube"}`}
                                  >
                                    {(o.color_name || "T").charAt(0)}
                                  </div>
                                  <div>
                                    <div className="text-xs text-gray-600 font-medium">Sample ID</div>
                                    <div className="font-mono font-bold text-gray-900 text-sm">
                                      #{String(o.sample_id).split("-").pop()}
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>

                            {/* Amount - Prominent */}
                            <div className="text-right">
                              <div className="flex items-center justify-end gap-2">
                                <div className="text-2xl font-bold text-gray-900">
                                  ₹{Number(o.total_amount || 0).toLocaleString()}
                                </div>
                                {getBillingBadge(o)}
                              </div>
                              {o.payment_status !== 'paid' && o.due_amount > 0 && (
                                <div className="text-sm font-semibold text-red-600 mt-1">
                                  Due: ₹{(o.due_amount || 0).toLocaleString()}
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Expanded Details - Always Show */}
                          <div className="mt-3">

                            {/* Patient Contact Info & Location */}
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
                              {o.transit_status && o.transit_status !== 'received_at_lab' && (
                                <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full ${o.transit_status === 'in_transit'
                                  ? 'bg-amber-100 text-amber-800'
                                  : o.transit_status === 'pending_dispatch'
                                    ? 'bg-yellow-100 text-yellow-800'
                                    : 'bg-gray-100 text-gray-700'
                                  }`}>
                                  <span className="text-base">🚚</span>
                                  <span className="font-medium text-xs">
                                    {o.transit_status === 'in_transit' ? 'In Transit' :
                                      o.transit_status === 'pending_dispatch' ? 'Pending Dispatch' :
                                        o.transit_status === 'at_collection_point' ? 'At Collection' :
                                          o.transit_status}
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
                                    // Find package name once
                                    const packageTest = o.tests.find(t => t.test_name?.startsWith('📦'));
                                    const packageName = packageTest?.test_name?.replace('📦', '').trim();

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

                                              // Modern minimalistic colors based on progress
                                              const getMinimalColor = (percent: number) => {
                                                if (percent === 0) return "bg-gray-100 border-gray-300 text-gray-700";
                                                if (percent < 40) return "bg-red-50 border-red-200 text-red-800";
                                                if (percent < 70) return "bg-orange-50 border-orange-200 text-orange-800";
                                                if (percent < 90) return "bg-yellow-50 border-yellow-200 text-yellow-800";
                                                return "bg-green-50 border-green-200 text-green-800";
                                              };

                                              const colorClass = getMinimalColor(progress);

                                              return (
                                                <div
                                                  key={`${p.name}-${i}`}
                                                  className={`border rounded px-2 py-1 transition-all duration-300 ${colorClass}`}
                                                >
                                                  <div className="font-medium text-xs">{p.name}</div>
                                                  <div className="text-[10px] font-mono">
                                                    {p.entered}/{p.expected}{progress === 100 ? "Complete" : ""}
                                                  </div>
                                                </div>
                                              );
                                            })
                                            : o.tests
                                              .filter(t => !t.test_name?.startsWith('📦'))
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
                                  <span className={new Date(o.expected_date) < new Date() ? "text-red-600 font-semibold" : ""}>
                                    Exp: {new Date(o.expected_date).toLocaleDateString()}
                                    {new Date(o.expected_date) < new Date() && " ⚠️"}
                                  </span>
                                </div>
                              </div>
                            </div>

                            {/* Additional Info Row */}
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

                            {/* Action Buttons - Prominent */}
                            <div className="mt-3 flex flex-wrap gap-2 justify-end px-3 py-2 bg-gray-50 rounded-lg border-t-2 border-blue-200">
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

                              {/* Inform Doctor Button */}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleInformDoctor(o);
                                }}
                                disabled={!o.doctor_phone}
                                className={`inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-lg text-white transition-colors ${o.doctor_phone
                                  ? 'bg-green-600 hover:bg-green-700'
                                  : 'bg-gray-300 cursor-not-allowed'
                                  }`}
                                title={o.doctor_phone ? `Inform Dr. ${o.doctor}` : 'Doctor phone not available'}
                              >
                                <MessageCircle className="h-4 w-4 mr-1.5" />
                                Inform Dr.
                              </button>

                              {/* Send Report Buttons */}
                              {/* Always visible, but enabled only if report URL exists */}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleSendReport(o, 'whatsapp');
                                }}
                                disabled={!o.report_url || !!isSendingReport}
                                className={`inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-lg text-white transition-colors ${o.report_url
                                  ? 'bg-green-600 hover:bg-green-700'
                                  : 'bg-gray-300 cursor-not-allowed'
                                  }`}
                                title={o.report_url ? 'Send Report via WhatsApp' : 'Report not generated yet'}
                              >
                                <Send className="h-4 w-4 mr-1.5" />
                                {isSendingReport === o.id ? '...' : 'WhatsApp'}
                              </button>

                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleSendReport(o, 'email');
                                }}
                                disabled={!o.report_url || !!isSendingReport}
                                className={`inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-lg text-white transition-colors ${o.report_url
                                  ? 'bg-blue-500 hover:bg-blue-600'
                                  : 'bg-gray-300 cursor-not-allowed'
                                  }`}
                                title={o.report_url ? 'Send Report via Email' : 'Report not generated yet'}
                              >
                                <Mail className="h-4 w-4 mr-1.5" />
                                Email
                              </button>

                              {/* Send Invoice Button - only for billed orders */}
                              {o.billing_status === 'billed' && (
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
                                  {isSendingInvoice === o.id ? '...' : 'Invoice'}
                                </button>
                              )}

                              {/* Invoice creation button */}
                              {o.billing_status !== 'billed' && (
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

                              {/* Record Payment button - for billed orders */}
                              {o.billing_status === 'billed' && (
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
                            </div>

                            {/* Enhanced Progress + legend */}
                            <div className="mt-3 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg p-3 border border-blue-200">
                              <div className="flex items-center justify-between text-xs mb-1">
                                <span className="text-blue-800 font-medium flex items-center">
                                  📊 Overall Progress
                                </span>
                                <span className="text-blue-800 font-bold">
                                  {o.enteredTotal}/{o.expectedTotal} analytes
                                </span>
                              </div>

                              {/* Enhanced progress bar with dynamic colors and segments */}
                              <div className="relative w-full bg-gray-200 rounded-full h-2.5 overflow-hidden border">
                                {/* Background gradient based on overall progress */}
                                <div
                                  className="absolute left-0 top-0 h-2.5 transition-all duration-700 rounded-full"
                                  style={{
                                    width: `${pct}%`,
                                    background: pct === 0 ? '#ef4444' : // red
                                      pct < 25 ? `linear-gradient(90deg, #ef4444 0%, #f97316 100%)` : // red to orange
                                        pct < 50 ? `linear-gradient(90deg, #f97316 0%, #eab308 100%)` : // orange to yellow  
                                          pct < 75 ? `linear-gradient(90deg, #eab308 0%, #84cc16 100%)` : // yellow to lime
                                            pct < 100 ? `linear-gradient(90deg, #84cc16 0%, #22c55e 100%)` : // lime to green
                                              '#10b981', // emerald
                                    boxShadow: pct > 0 ? `0 0 12px ${pct < 50 ? '#ef444440' : '#22c55e40'}` : 'none'
                                  }}
                                />

                                {/* Approved segment overlay (darker green) */}
                                <div
                                  className="absolute left-0 top-0 h-4 bg-green-600 transition-all duration-500 rounded-full opacity-80"
                                  style={{ width: `${o.expectedTotal > 0 ? (o.approvedAnalytes / o.expectedTotal) * 100 : 0}%` }}
                                />

                                {/* Progress indicator line */}
                                <div
                                  className="absolute top-0 w-0.5 h-4 bg-white shadow-lg"
                                  style={{ left: `${pct}%` }}
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

                              {/* Enhanced legend with mobile-responsive grid */}
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 text-xs mt-1">
                                <div className="inline-flex items-center bg-white rounded px-1.5 py-0.5 border border-gray-200">
                                  <span className="inline-block w-2 h-2 bg-red-400 rounded-full mr-1" />
                                  <span className="text-gray-600">Pending: <strong>{o.pendingAnalytes}</strong></span>
                                </div>
                                <div className="inline-flex items-center bg-white rounded px-1.5 py-0.5 border border-amber-200">
                                  <span className="inline-block w-2 h-2 bg-amber-500 rounded-full mr-1" />
                                  <span className="text-amber-700">Approval: <strong>{o.forApprovalAnalytes}</strong></span>
                                </div>
                                <div className="inline-flex items-center bg-white rounded px-1.5 py-0.5 border border-green-200">
                                  <span className="inline-block w-2 h-2 bg-green-500 rounded-full mr-1" />
                                  <span className="text-green-700">Approved: <strong>{o.approvedAnalytes}</strong></span>
                                </div>
                                <div className="inline-flex items-center bg-white rounded px-1.5 py-0.5 border border-blue-200 justify-end">
                                  <span className={`font-bold text-xs ${pct < 25 ? 'text-red-600' : pct < 50 ? 'text-orange-600' : pct < 75 ? 'text-yellow-600' : pct < 100 ? 'text-lime-600' : 'text-green-600'}`}>
                                    {pct < 25 ? '🔴' : pct < 50 ? '🟠' : pct < 75 ? '🟡' : pct < 100 ? '🟢' : '✅'} Total: {o.expectedTotal}
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
        )}
      </div>

      {/* Footer stats */}
      <div className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg p-4 border border-blue-200">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-sm">
          <div className="flex items-center gap-6">
            <div className="flex items-center">
              <Calendar className="h-4 w-4 text-blue-600 mr-1" />
              <span className="text-blue-900 font-medium">
                Total Orders: {orders.length}
                <span className="text-blue-700 ml-1">
                  ({new Date(dateFrom).toLocaleDateString()} - {new Date(dateTo).toLocaleDateString()})
                </span>
              </span>
            </div>
            <div className="flex items-center">
              <AlertTriangle className="h-4 w-4 text-red-600 mr-1" />
              <span className="text-red-900 font-medium">
                Overdue: {orders.filter((o) => new Date(o.expected_date) < new Date()).length}
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
        <DashboardOrderModal
          order={selectedOrder}
          onClose={() => setSelectedOrder(null)}
          onUpdateStatus={async (orderId: string, newStatus: string) => {
            try {
              // Update the order status in the database
              const { error } = await database.orders.update(orderId, {
                status: newStatus,
                status_updated_at: new Date().toISOString(),
                status_updated_by: user?.email || 'Unknown'
              });
              if (error) {
                console.error('Error updating order status:', error);
                return;
              }

              console.log(`Order ${orderId} status updated to: ${newStatus}`);

              // Refresh the orders list and close the modal
              await fetchOrders();
              setSelectedOrder(null);
            } catch (error) {
              console.error('Error updating order status:', error);
            }
          }}
        />
      )}

      {/* Invoice Modal */}
      {showInvoiceModal && invoiceOrderId && (
        <CreateInvoiceModal
          orderId={invoiceOrderId}
          onClose={() => { setShowInvoiceModal(false); setInvoiceOrderId(null); }}
          onSuccess={() => { setShowInvoiceModal(false); setInvoiceOrderId(null); fetchOrders(); }}
        />
      )}

      {/* Payment Modal */}
      {showPaymentModal && paymentInvoiceId && (
        <PaymentCapture
          invoiceId={paymentInvoiceId}
          onClose={() => { setShowPaymentModal(false); setPaymentInvoiceId(null); }}
          onSuccess={() => { setShowPaymentModal(false); setPaymentInvoiceId(null); fetchOrders(); }}
        />
      )}

      {/* Mobile FAB - Quick Order */}
      <MobileFAB
        icon={Plus}
        onClick={() => setShowOrderForm(true)}
        label="Create Order"
      />
    </div>
  );
};

export default Dashboard;
