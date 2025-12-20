import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom";
import {
  X,
  User,
  Calendar,
  Clock,
  FileText,
  CreditCard,
  DollarSign,
  Printer,
  QrCode,
  CheckCircle,
  AlertTriangle,
  Phone,
  Mail,
  TestTube,
  Download,
  Building,
  Sparkles,
  Upload,
  Loader,
  Edit2,
  Save,
  Truck,
  Send,
  MapPin
} from "lucide-react";
import QRCodeLib from "qrcode";
import { database, supabase } from "../../utils/supabase";
import { generateAndDownloadReport, getLabTemplate, type ReportData } from "../../utils/pdfGenerator";
import { generateInvoicePDF } from "../../utils/invoicePdfService";
import { useAuth } from "../../contexts/AuthContext";
import { useOrderStatusCentral } from "../../hooks/useOrderStatusCentral";
import QuickStatusButtons from "../Orders/QuickStatusButtons";
import PhlebotomistSelector from "../Users/PhlebotomistSelector";
import { OrderStatusDisplay } from "../Orders/OrderStatusDisplay";
import CreateInvoiceModal from "../Billing/CreateInvoiceModal";
import PaymentCapture from "../Billing/PaymentCapture";
import InvoiceDeliveryTracker from "../Billing/InvoiceDeliveryTracker";
import {
  processTRFImage,
  trfToOrderFormData,
  validatePatientData,
  autoCreatePatientFromTRF,
  findDoctorByName,
  type TRFExtractionResult,
  type TRFProcessingProgress
} from '../../utils/trfProcessor';

// Define the order shape expected by this modal (matching Dashboard's CardOrder)
export interface DashboardOrder {
  id: string;
  patient_name: string;
  patient_id: string;
  patient_phone?: string | null;
  status: string;
  priority: string;
  order_date: string;
  expected_date: string;
  total_amount: number;
  doctor: string | null;
  doctor_phone?: string | null;
  doctor_email?: string | null;

  sample_id: string | null;
  color_code: string | null;
  color_name: string | null;
  sample_collected_at: string | null;
  sample_collected_by: string | null;
  qr_code_data?: string;

  // Billing fields
  billing_status?: 'pending' | 'partial' | 'billed' | null;
  is_billed?: boolean | null;
  invoice_id?: string | null;
  paid_amount?: number;
  due_amount?: number;
  payment_status?: 'unpaid' | 'partial' | 'paid' | null;

  patient?: { name?: string | null; age?: string | null; gender?: string | null; phone?: string | null; mobile?: string | null; email?: string | null } | null;
  tests: {
    id: string;
    test_name: string;
    outsourced_lab_id?: string | null;
    outsourced_labs?: { name?: string | null } | null;
  }[];

  // Report info
  report_url?: string | null;

  // Location and transit fields
  location_id?: string | null;
  location?: string | null;
  transit_status?: string | null;
  collected_at_location_id?: string | null;
}

interface DashboardOrderModalProps {
  order: DashboardOrder;
  onClose: () => void;
  onUpdateStatus: (orderId: string, newStatus: string) => Promise<void>;
}

const DashboardOrderModal: React.FC<DashboardOrderModalProps> = ({
  order,
  onClose,
  onUpdateStatus,
}) => {
  const { user } = useAuth();
  const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null);
  const [labId, setLabId] = useState<string | null>(null);

  // Billing Modals
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [invoiceRefreshTrigger, setInvoiceRefreshTrigger] = useState(0);

  // Outsource Modal
  const [showOutsourceModal, setShowOutsourceModal] = useState(false);
  const [outsourcedLabs, setOutsourcedLabs] = useState<any[]>([]);
  const [selectedOutsourceLab, setSelectedOutsourceLab] = useState<string>("");

  // Sample Collection
  const { markSampleCollected: markCollectedCentral } = useOrderStatusCentral();
  const [updatingCollection, setUpdatingCollection] = useState(false);
  const [showPhlebotomistSelector, setShowPhlebotomistSelector] = useState(false);
  const [selectedPhlebotomistId, setSelectedPhlebotomistId] = useState<string>('');
  const [selectedPhlebotomistName, setSelectedPhlebotomistName] = useState<string>('');
  const [doctors, setDoctors] = useState<any[]>([]);

  // TRF Processing
  const [processingTRF, setProcessingTRF] = useState<boolean>(false);
  const [trfProgress, setTrfProgress] = useState<TRFProcessingProgress | null>(null);
  const [trfExtraction, setTrfExtraction] = useState<TRFExtractionResult | null>(null);
  const [showTRFReview, setShowTRFReview] = useState<boolean>(false);
  const [testRequestFile, setTestRequestFile] = useState<File | null>(null);
  const [enableTRFOptimization, setEnableTRFOptimization] = useState<boolean>(true);

  // Editing
  const [isEditingPatient, setIsEditingPatient] = useState(false);
  const [isEditingDoctor, setIsEditingDoctor] = useState(false);
  const [editPatientName, setEditPatientName] = useState(order.patient_name);
  const [editPatientPhone, setEditPatientPhone] = useState(order.patient_phone || '');
  const [editDoctorId, setEditDoctorId] = useState<string>('');
  const [tests, setTests] = useState(order.tests);
  const [viewInvoiceLoading, setViewInvoiceLoading] = useState(false);

  // Transit/Dispatch
  const [showDispatchModal, setShowDispatchModal] = useState(false);
  const [dispatchLocations, setDispatchLocations] = useState<{ id: string; name: string; type: string; is_processing_center: boolean }[]>([]);
  const [dispatchDestination, setDispatchDestination] = useState<string>('');
  const [dispatchNotes, setDispatchNotes] = useState('');
  const [dispatchPriority, setDispatchPriority] = useState<'normal' | 'urgent' | 'high' | 'low'>('normal');
  const [dispatching, setDispatching] = useState(false);


  // Init
  useEffect(() => {
    const init = async () => {
      const id = await database.getCurrentUserLabId();
      setLabId(id);
      console.log('[DashboardOrderModal] Lab ID:', id);
      console.log('[DashboardOrderModal] Order location:', order.location, 'location_id:', order.location_id);
      console.log('[DashboardOrderModal] Sample collected:', order.sample_collected_at);
      console.log('[DashboardOrderModal] Transit status:', order.transit_status);

      if (id) {
        const { data } = await supabase
          .from('outsourced_labs')
          .select('*')
          .eq('lab_id', id)
          .eq('is_active', true)
          .order('name');
        setOutsourcedLabs(data || []);

        const { data: doctorsData } = await database.doctors.getAll();
        setDoctors(doctorsData || []);

        // Fetch all locations for dispatch (processing centers + others)
        const { data: locations, error: locationsError } = await supabase
          .from('locations')
          .select('id, name, type, is_processing_center')
          .eq('lab_id', id)
          .eq('is_active', true)
          .order('name');

        console.log('[DashboardOrderModal] Dispatch locations:', locations, 'Error:', locationsError);
        setDispatchLocations(locations || []);

        // Default to a processing center if available, otherwise first location
        if (locations && locations.length > 0) {
          // Try to find a processing center first
          const defaultLoc = locations.find((l: any) => l.is_processing_center) || locations[0];
          setDispatchDestination(defaultLoc.id);
        }
      }
    };
    init();
  }, []);

  // Reload invoice delivery status and notify parent dashboard when invoice delivery is tracked
  useEffect(() => {
    if (invoiceRefreshTrigger > 0 && order.invoice_id) {
      // Notify parent to refresh dashboard
      onUpdateStatus(order.id, order.status);
      console.log('[DashboardOrderModal] Invoice delivery tracked, refreshing dashboard');
    }
  }, [invoiceRefreshTrigger]);

  // Pre-select doctor when editing starts
  useEffect(() => {
    if (isEditingDoctor && doctors.length > 0) {
      const match = doctors.find(d => d.name === order.doctor);
      if (match) setEditDoctorId(match.id);
      else setEditDoctorId('');
    }
  }, [isEditingDoctor, doctors, order.doctor]);

  // Generate QR Code on mount
  useEffect(() => {
    if (order.sample_id || order.id) {
      const qrData = order.qr_code_data || JSON.stringify({
        id: order.id,
        sid: order.sample_id,
        p: order.patient_name,
        d: order.order_date
      });

      QRCodeLib.toDataURL(qrData, { width: 200, margin: 1 })
        .then(setQrCodeUrl)
        .catch(err => console.error("QR Gen Error:", err));
    }
  }, [order]);

  // Handlers
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      alert('File size must be less than 10MB');
      return;
    }

    setTestRequestFile(file);

    // Auto-process TRF with AI
    if (file.type.startsWith('image/') || file.type === 'application/pdf') {
      setProcessingTRF(true);
      setTrfExtraction(null);
      setTrfProgress(null);

      try {
        const result = await processTRFImage(file, (progress) => {
          setTrfProgress(progress);
        }, {
          enableOptimization: enableTRFOptimization
        });

        if (result.success) {
          setTrfExtraction(result);
          // Here we could auto-update order details if needed, or just show success
          // For now, we just store the result and file

          // Upload file to attachments
          // TODO: Use database.attachments.uploadForOrder when available
          // For now, we can't easily upload without that helper or direct storage access
          console.log('TRF Processed:', result);
        }
      } catch (error) {
        console.error('TRF Processing failed:', error);
      } finally {
        setProcessingTRF(false);
      }
    }
  };

  const handleViewInvoice = async () => {
    console.log('[DashboardOrderModal] View Invoice clicked. Order:', order);

    if (!order.invoice_id) {
      console.error('[DashboardOrderModal] Invoice ID is missing despite billing status:', order.billing_status);
      alert('Invoice record not found. Please contact support or try regenerating the invoice.');
      return;
    }

    setViewInvoiceLoading(true);

    try {
      // 1. Get invoice data with PDF URL
      const { data: invoice, error } = await supabase
        .from('invoices')
        .select('id, pdf_url, template_id, invoice_number')
        .eq('id', order.invoice_id)
        .single();

      if (error || !invoice) {
        throw error || new Error('Invoice not found');
      }

      // 2. Generate PDF if not already generated
      let pdfUrl = invoice.pdf_url;

      if (!pdfUrl) {
        console.log('PDF not found, generating invoice PDF...');

        // Get default template if not specified
        let templateId = invoice.template_id;

        if (!templateId) {
          const { data: templates } = await database.invoiceTemplates.getAll();
          const defaultTemplate = templates?.find((t: any) => t.is_default) || templates?.[0];

          if (!defaultTemplate) {
            throw new Error('No invoice template found. Please configure templates in Settings.');
          }

          templateId = defaultTemplate.id;
        }

        // Generate PDF using the proper invoice PDF service
        pdfUrl = await generateInvoicePDF(invoice.id, templateId);

        if (!pdfUrl) {
          throw new Error('Failed to generate invoice PDF');
        }
      }

      // 3. Open PDF in new tab
      window.open(pdfUrl, '_blank');

    } catch (err) {
      console.error('Failed to view invoice', err);
      alert(`Failed to view invoice: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setViewInvoiceLoading(false);
    }
  };

  const handleTestOutsourceChange = async (testId: string, labId: string | 'inhouse') => {
    try {
      const updateData = labId === 'inhouse'
        ? { outsourced_lab_id: null }
        : { outsourced_lab_id: labId };

      const { error } = await supabase
        .from('order_tests')
        .update(updateData)
        .eq('id', testId);

      if (error) throw error;

      // Update local state so the dropdown reflects the change without closing the modal
      setTests((prev) => prev.map((t) => t.id === testId ? { ...t, outsourced_lab_id: updateData.outsourced_lab_id || null } : t));
    } catch (err) {
      console.error(err);
      alert('Failed to update test outsourcing');
    }
  };

  const handleSavePatient = async () => {
    try {
      if (order.patient_id) {
        const { error } = await supabase
          .from('patients')
          .update({
            name: editPatientName,
            phone: editPatientPhone
          })
          .eq('id', order.patient_id);

        if (error) throw error;
        setIsEditingPatient(false);
        onUpdateStatus(order.id, order.status);
      }
    } catch (e) {
      console.error(e);
      alert('Failed to update patient');
    }
  };

  const handleSaveDoctor = async () => {
    try {
      if (!editDoctorId) {
        alert('Please select a doctor');
        return;
      }

      const selectedDoc = doctors.find(d => d.id === editDoctorId);
      if (!selectedDoc) return;

      // Update both doctor_id and doctor name (denormalized)
      const { error } = await supabase
        .from('orders')
        .update({
          doctor_id: selectedDoc.id,
          doctor: selectedDoc.name,
          // Also update phone/email if available in doctor record and order has fields for it?
          // DashboardOrder has doctor_phone, doctor_email. 
          // Usually these are fetched from relation, but if stored in orders, update them too.
          // Checking schema.md or types would confirm, but safe to assume we might want to update if they exist on order table.
          // For now, just updating doctor_id and doctor name is the core requirement.
        })
        .eq('id', order.id);

      if (error) throw error;

      setIsEditingDoctor(false);
      onUpdateStatus(order.id, order.status);
    } catch (e) {
      console.error(e);
      alert('Failed to update doctor');
    }
  };

  // Handle dispatch to main lab/processing center
  const handleDispatchToLab = async () => {
    if (!dispatchDestination) {
      alert('Please select a destination');
      return;
    }

    const fromLocationId = order.collected_at_location_id || order.location_id;
    if (!fromLocationId) {
      alert('Order does not have a source location');
      return;
    }

    setDispatching(true);
    try {
      // Generate batch ID for tracking (must be UUID to match DB schema)
      const batchId = crypto.randomUUID();

      // Get current user info
      const { data: { user: authUser } } = await supabase.auth.getUser();
      const { data: userData } = await supabase
        .from('users')
        .select('id')
        .eq('email', authUser?.email)
        .single();

      // Create transit record
      const trackingBarcode = `TRN-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

      const { error: transitError } = await supabase
        .from('sample_transits')
        .insert({
          lab_id: labId,
          order_id: order.id,
          from_location_id: fromLocationId,
          to_location_id: dispatchDestination,
          status: 'in_transit',
          priority: dispatchPriority,
          dispatch_notes: dispatchNotes,
          tracking_barcode: trackingBarcode,
          batch_id: batchId,
          dispatched_at: new Date().toISOString(),
          dispatched_by: userData?.id
        });

      if (transitError) throw transitError;

      // Update order transit status
      const { error: orderError } = await supabase
        .from('orders')
        .update({ transit_status: 'in_transit' })
        .eq('id', order.id);

      if (orderError) throw orderError;

      setShowDispatchModal(false);
      setDispatchNotes('');
      alert(`Order dispatched successfully!\nTracking: ${trackingBarcode}`);
      onUpdateStatus(order.id, order.status); // Refresh parent
    } catch (e: any) {
      console.error('Dispatch error:', e);
      alert('Failed to dispatch: ' + (e.message || 'Unknown error'));
    } finally {
      setDispatching(false);
    }
  };

  const handleMarkSampleCollected = async () => {
    if (!order.sample_collected_at && !showPhlebotomistSelector) {
      setShowPhlebotomistSelector(true);
      return;
    }

    try {
      setUpdatingCollection(true);
      const { error } = await database.orders.markSampleCollected(
        order.id,
        selectedPhlebotomistName || undefined,
        selectedPhlebotomistId || undefined
      );
      if (error) {
        alert('Failed to mark sample collected');
        return;
      }
      await database.orders.checkAndUpdateStatus(order.id);
      await onUpdateStatus(order.id, "Sample Collection");
      setShowPhlebotomistSelector(false);
    } catch (e) {
      console.error("Error marking sample collected:", e);
      alert("Failed to mark sample collected");
    } finally {
      setUpdatingCollection(false);
    }
  };

  const handlePrintBarcode = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    printWindow.document.write(`
      <html>
        <head>
          <title>Sample Label - ${order.sample_id}</title>
          <style>
            body { font-family: sans-serif; text-align: center; padding: 10px; }
            .label { border: 1px dashed #ccc; padding: 10px; display: inline-block; }
            .sid { font-size: 18px; font-weight: bold; margin: 5px 0; }
            .meta { font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="label">
            <img src="${qrCodeUrl}" width="100" height="100" />
            <div class="sid">${order.sample_id || 'NO ID'}</div>
            <div class="meta">${order.patient_name}</div>
            <div class="meta">${new Date(order.order_date).toLocaleDateString()}</div>
            <div class="meta">${order.color_name || 'Tube'}</div>
          </div>
          <script>window.print();</script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const handlePrintTRF = () => {
    // Placeholder for TRF printing logic
    alert("TRF Printing feature coming soon!");
  };

  const handleDownloadReport = () => {
    if (order.report_url) {
      window.open(order.report_url, '_blank');
    } else {
      alert("Report not generated yet.");
    }
  };

  const handleOutsource = async () => {
    if (!selectedOutsourceLab) return;

    try {
      const { error } = await supabase
        .from('orders')
        .update({
          outsourced_lab_id: selectedOutsourceLab,
          outsourced_status: 'pending_send',
          status: 'In Progress' // Ensure it's not stuck
        })
        .eq('id', order.id);

      if (error) throw error;

      alert('Order outsourced successfully');
      setShowOutsourceModal(false);
      onUpdateStatus(order.id, 'In Progress');
      onClose();
    } catch (err) {
      console.error(err);
      alert('Failed to outsource');
    }
  };

  return ReactDOM.createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gray-50/50">
          <div className="flex items-center gap-4">
            <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold">
              {order.patient_name.charAt(0)}
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                {order.patient_name}
                <span className="text-sm font-normal text-gray-500">#{order.patient_id}</span>
              </h2>
              <div className="flex items-center gap-3 text-sm text-gray-600">
                <span>{(order.patient?.age || 'N/A') + 'y'}</span>
                <span>•</span>
                <span>{order.patient?.gender || 'N/A'}</span>
                {order.patient_phone && (
                  <>
                    <span>•</span>
                    <span className="flex items-center gap-1"><Phone className="h-3 w-3" /> {order.patient_phone}</span>
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <OrderStatusDisplay order={order as any} />
            <button onClick={onClose} className="p-2 hover:bg-gray-200 rounded-full transition-colors">
              <X className="h-5 w-5 text-gray-500" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">

          {/* TRF Upload Section */}
          <section className="space-y-3 bg-gradient-to-r from-purple-50 to-blue-50 p-4 rounded-lg border-2 border-dashed border-purple-300">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="h-5 w-5 text-purple-600" />
              <h3 className="text-lg font-medium text-gray-900">AI-Powered TRF Extraction</h3>
            </div>
            <div className="space-y-3">
              <input
                type="file"
                id="trf-upload-modal"
                accept="image/*,.pdf"
                onChange={handleFileChange}
                className="hidden"
              />
              <label
                htmlFor="trf-upload-modal"
                className="block cursor-pointer border-2 border-dashed border-purple-300 bg-white rounded-lg p-6 text-center hover:border-purple-400 hover:bg-purple-50 transition-colors"
              >
                {processingTRF ? (
                  <div className="flex flex-col items-center">
                    <Loader className="w-8 h-8 text-purple-600 mb-2 animate-spin" />
                    <span className="text-sm font-medium text-purple-700">Processing...</span>
                  </div>
                ) : trfExtraction?.success ? (
                  <div className="flex flex-col items-center">
                    <CheckCircle className="w-8 h-8 text-green-600 mb-2" />
                    <span className="text-sm font-medium text-green-700">Processed Successfully!</span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center">
                    <Upload className="w-8 h-8 text-purple-500 mb-2" />
                    <span className="text-sm font-medium text-gray-700">Upload TRF / Attachment</span>
                  </div>
                )}
              </label>
            </div>
          </section>

          {/* Top Row: Order Info, Doctor, Sample & Location */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-4 bg-blue-50 rounded-lg border border-blue-100">
              <div className="text-xs font-semibold text-blue-600 uppercase tracking-wider mb-1">Order Details</div>
              <div className="font-mono font-bold text-gray-900">#{order.id.slice(-6)}</div>
              <div className="text-sm text-gray-600 mt-1 flex items-center gap-1">
                <Calendar className="h-3 w-3" /> {new Date(order.order_date).toLocaleDateString()}
                <Clock className="h-3 w-3 ml-1" /> {new Date(order.order_date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>

            {/* Referring Doctor (Editable) */}
            <div className="p-4 bg-purple-50 rounded-lg border border-purple-100 relative group">
              <div className="flex justify-between items-start">
                <div className="text-xs font-semibold text-purple-600 uppercase tracking-wider mb-1">Referring Doctor</div>
                {!isEditingDoctor && (
                  <button onClick={() => setIsEditingDoctor(true)} className="opacity-0 group-hover:opacity-100 p-1 hover:bg-purple-200 rounded transition-opacity">
                    <Edit2 className="h-3 w-3 text-purple-700" />
                  </button>
                )}
              </div>

              {isEditingDoctor ? (
                <div className="space-y-2">
                  <select
                    value={editDoctorId}
                    onChange={(e) => setEditDoctorId(e.target.value)}
                    className="w-full text-sm border border-purple-300 rounded p-1 focus:ring-2 focus:ring-purple-500 outline-none"
                  >
                    <option value="">Select Doctor</option>
                    {doctors.map(d => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                  <div className="flex gap-2 justify-end">
                    <button onClick={handleSaveDoctor} className="text-xs bg-purple-600 text-white px-2 py-1 rounded">Save</button>
                    <button onClick={() => setIsEditingDoctor(false)} className="text-xs bg-gray-200 px-2 py-1 rounded">Cancel</button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="font-bold text-gray-900">{order.doctor || 'Self'}</div>
                  {order.doctor_phone && (
                    <div className="text-sm text-gray-600 mt-1 flex items-center gap-1">
                      <Phone className="h-3 w-3" /> {order.doctor_phone}
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="p-4 bg-gray-50 rounded-lg border border-gray-100">
              <div className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1">Sample Info</div>
              {order.sample_id ? (
                <>
                  <div className="font-mono font-bold text-gray-900">{order.sample_id}</div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="w-3 h-3 rounded-full" style={{ backgroundColor: order.color_code || '#ccc' }}></span>
                    <span className="text-sm text-gray-600">{order.color_name || 'Tube'}</span>
                  </div>
                </>
              ) : (
                <div className="text-sm text-gray-500 italic">No sample assigned</div>
              )}
            </div>

            {/* Location & Transit */}
            <div className="p-4 bg-amber-50 rounded-lg border border-amber-100">
              <div className="text-xs font-semibold text-amber-600 uppercase tracking-wider mb-1">Collection Location</div>
              <div className="font-bold text-gray-900 flex items-center gap-1">
                <MapPin className="h-3 w-3 text-amber-600" />
                {order.location || 'Main Lab'}
              </div>
              {order.transit_status && (
                <div className={`text-xs mt-1 px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${order.transit_status === 'in_transit' ? 'bg-amber-200 text-amber-800' :
                    order.transit_status === 'received_at_lab' ? 'bg-green-200 text-green-800' :
                      'bg-gray-200 text-gray-700'
                  }`}>
                  <Truck className="h-3 w-3" />
                  {order.transit_status === 'in_transit' ? 'In Transit' :
                    order.transit_status === 'received_at_lab' ? 'Received' :
                      order.transit_status === 'at_collection_point' ? 'At Collection' :
                        order.transit_status}
                </div>
              )}
              {/* Send Sample button - show if sample collected and locations exist */}
              {order.sample_collected_at &&
                (!order.transit_status || order.transit_status === 'at_collection_point') &&
                dispatchLocations.length > 0 && (
                  <button
                    onClick={() => setShowDispatchModal(true)}
                    className="mt-2 w-full flex items-center justify-center gap-1 text-xs font-medium bg-amber-600 text-white px-2 py-1.5 rounded hover:bg-amber-700 transition-colors"
                  >
                    <Send className="h-3 w-3" />
                    Send Sample
                  </button>
                )}
              {/* Debug: Show why button not showing */}
              {!order.sample_collected_at && (
                <div className="text-xs text-gray-400 mt-1">Sample not collected yet</div>
              )}
              {order.sample_collected_at && dispatchLocations.length === 0 && (
                <div className="text-xs text-orange-500 mt-1">No destination locations configured</div>
              )}
              {order.sample_collected_at && order.transit_status && order.transit_status !== 'at_collection_point' && (
                <div className="text-xs text-green-600 mt-1">Already dispatched</div>
              )}
            </div>
          </div>

          {/* Patient Info (Editable) */}
          <div className="bg-white border border-gray-200 rounded-xl p-4 relative group">
            <div className="flex justify-between items-start mb-2">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <User className="h-4 w-4 text-gray-500" />
                Patient Information
              </h3>
              {!isEditingPatient && (
                <button onClick={() => setIsEditingPatient(true)} className="opacity-0 group-hover:opacity-100 p-1 hover:bg-gray-100 rounded transition-opacity">
                  <Edit2 className="h-3 w-3 text-gray-600" />
                </button>
              )}
            </div>

            {isEditingPatient ? (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-gray-500">Name</label>
                  <input
                    type="text"
                    value={editPatientName}
                    onChange={(e) => setEditPatientName(e.target.value)}
                    className="w-full border rounded p-1 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Phone</label>
                  <input
                    type="text"
                    value={editPatientPhone}
                    onChange={(e) => setEditPatientPhone(e.target.value)}
                    className="w-full border rounded p-1 text-sm"
                  />
                </div>
                <div className="col-span-2 flex gap-2 justify-end">
                  <button onClick={handleSavePatient} className="text-xs bg-blue-600 text-white px-3 py-1 rounded">Save Changes</button>
                  <button onClick={() => setIsEditingPatient(false)} className="text-xs bg-gray-200 px-3 py-1 rounded">Cancel</button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <span className="text-gray-500 block text-xs">Name</span>
                  <span className="font-medium">{order.patient_name}</span>
                </div>
                <div>
                  <span className="text-gray-500 block text-xs">Phone</span>
                  <span className="font-medium">{order.patient_phone || 'N/A'}</span>
                </div>
                <div>
                  <span className="text-gray-500 block text-xs">Age/Gender</span>
                  <span className="font-medium">{order.patient?.age} / {order.patient?.gender}</span>
                </div>
                <div>
                  <span className="text-gray-500 block text-xs">ID</span>
                  <span className="font-medium">{order.patient_id}</span>
                </div>
              </div>
            )}
          </div>

          {/* Middle Row: Tests & Billing */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

            {/* Tests List */}
            <div className="lg:col-span-2 border border-gray-200 rounded-xl overflow-hidden">
              <div className="bg-gray-50 px-4 py-3 border-b border-gray-200 flex justify-between items-center">
                <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                  <TestTube className="h-4 w-4 text-gray-500" />
                  Prescribed Tests
                </h3>
                <span className="text-xs font-medium bg-gray-200 text-gray-700 px-2 py-1 rounded-full">
                  {tests.length} Items
                </span>
              </div>
              <div className="divide-y divide-gray-100">
                {tests.map((test, i) => (
                  <div key={i} className="px-4 py-3 flex items-center justify-between hover:bg-gray-50">
                    <span className="text-sm font-medium text-gray-700">{test.test_name}</span>

                    {/* Outsourcing Dropdown */}
                    <select
                      value={test.outsourced_lab_id || 'inhouse'}
                      onChange={(e) => handleTestOutsourceChange(test.id, e.target.value)}
                      className="text-xs border border-gray-300 rounded px-2 py-1 bg-white focus:ring-2 focus:ring-blue-500 outline-none"
                    >
                      <option value="inhouse">In-House</option>
                      {outsourcedLabs.map(lab => (
                        <option key={lab.id} value={lab.id}>
                          Outsource to {lab.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>

            {/* Billing & Actions */}
            <div className="space-y-4">
              {/* Financial Summary */}
              <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
                <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <CreditCard className="h-4 w-4 text-gray-500" />
                  Billing Status
                </h3>

                <div className="space-y-2 mb-4">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Total Amount</span>
                    <span className="font-bold text-gray-900">₹{order.total_amount.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Paid</span>
                    <span className="font-medium text-green-600">₹{(order.paid_amount || 0).toLocaleString()}</span>
                  </div>
                  <div className="pt-2 border-t border-gray-100 flex justify-between items-center">
                    <span className="text-sm font-medium text-gray-900">Due Amount</span>
                    <span className={`text-lg font-bold ${(order.due_amount || 0) > 0 ? 'text-red-600' : 'text-green-600'}`}>
                      ₹{(order.due_amount || 0).toLocaleString()}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-2">
                  {order.billing_status !== 'billed' && (
                    <button
                      onClick={() => setShowInvoiceModal(true)}
                      className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
                    >
                      <DollarSign className="h-4 w-4" />
                      Create Invoice
                    </button>
                  )}

                  {order.billing_status === 'billed' && (order.due_amount || 0) > 0 && (
                    <button
                      onClick={() => setShowPaymentModal(true)}
                      className="w-full flex items-center justify-center gap-2 bg-green-600 text-white py-2 rounded-lg hover:bg-green-700 transition-colors text-sm font-medium"
                    >
                      <CreditCard className="h-4 w-4" />
                      Record Payment
                    </button>
                  )}

                  {order.billing_status === 'billed' && (
                    <>
                      <button
                        onClick={handleViewInvoice}
                        disabled={viewInvoiceLoading}
                        className="w-full flex items-center justify-center gap-2 bg-white border border-gray-300 text-gray-700 py-2 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        <FileText className="h-4 w-4" />
                        {viewInvoiceLoading ? 'Downloading…' : 'View Invoice'}
                      </button>

                      {/* Invoice Delivery Tracker */}
                      {order.invoice_id && (
                        <div className="w-full flex justify-center">
                          <InvoiceDeliveryTracker
                            invoiceId={order.invoice_id}
                            invoiceNumber={`INV-${order.id.slice(-6).toUpperCase()}`}
                            customerPhone={order.patient_phone || undefined}
                            customerEmail={order.patient?.email || undefined}
                            onDeliveryTracked={() => {
                              setInvoiceRefreshTrigger(prev => prev + 1);
                            }}
                          />
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* Quick Actions */}
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
                <h3 className="font-semibold text-gray-900 mb-3 text-sm">Front Desk Actions</h3>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={handlePrintBarcode}
                    disabled={!order.sample_id}
                    className="flex flex-col items-center justify-center p-3 bg-white border border-gray-200 rounded-lg hover:border-blue-300 hover:shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <QrCode className="h-5 w-5 text-gray-600 mb-1" />
                    <span className="text-xs font-medium text-gray-700">Barcode</span>
                  </button>

                  <button
                    onClick={handlePrintTRF}
                    className="flex flex-col items-center justify-center p-3 bg-white border border-gray-200 rounded-lg hover:border-blue-300 hover:shadow-sm transition-all"
                  >
                    <Printer className="h-5 w-5 text-gray-600 mb-1" />
                    <span className="text-xs font-medium text-gray-700">Print TRF</span>
                  </button>



                  <button
                    onClick={handleDownloadReport}
                    disabled={!order.report_url}
                    className="col-span-2 flex items-center justify-center gap-2 p-3 bg-white border border-gray-200 rounded-lg hover:border-blue-300 hover:shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Download className="h-4 w-4 text-gray-600" />
                    <span className="text-sm font-medium text-gray-700">Download Report</span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Bottom Row: Status & Sample Collection */}
          <div className="border-t border-gray-100 pt-6">
            <h3 className="font-semibold text-gray-900 mb-4">Order Status & Workflow</h3>

            <div className="flex flex-col md:flex-row gap-6">
              {/* Status Buttons */}
              <div className="flex-1">
                <QuickStatusButtons
                  currentStatus={order.status}
                  onUpdateStatus={(status) => onUpdateStatus(order.id, status)}
                  disabled={false}
                />
              </div>

              {/* Sample Collection */}
              <div className="md:w-1/3">
                {!order.sample_collected_at ? (
                  <div className="bg-orange-50 border border-orange-100 rounded-lg p-4">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="h-5 w-5 text-orange-500 mt-0.5" />
                      <div>
                        <h4 className="font-medium text-orange-900">Sample Pending</h4>
                        <p className="text-sm text-orange-700 mt-1 mb-3">
                          Sample has not been collected yet.
                        </p>

                        {showPhlebotomistSelector ? (
                          <div className="space-y-3">
                            <PhlebotomistSelector
                              labId={labId || ''}
                              value={selectedPhlebotomistId}
                              onChange={(id, name) => {
                                setSelectedPhlebotomistId(id || '');
                                setSelectedPhlebotomistName(name);
                              }}
                            />
                            <div className="flex gap-2">
                              <button
                                onClick={handleMarkSampleCollected}
                                disabled={updatingCollection || !selectedPhlebotomistId}
                                className="flex-1 bg-orange-600 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-orange-700 disabled:opacity-50"
                              >
                                {updatingCollection ? 'Saving...' : 'Confirm Collection'}
                              </button>
                              <button
                                onClick={() => setShowPhlebotomistSelector(false)}
                                className="px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            onClick={() => setShowPhlebotomistSelector(true)}
                            className="w-full bg-orange-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-orange-700 transition-colors shadow-sm"
                          >
                            Mark Sample Collected
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="bg-green-50 border border-green-100 rounded-lg p-4">
                    <div className="flex items-start gap-3">
                      <CheckCircle className="h-5 w-5 text-green-500 mt-0.5" />
                      <div>
                        <h4 className="font-medium text-green-900">Sample Collected</h4>
                        <p className="text-sm text-green-700 mt-1">
                          Collected by {order.sample_collected_by || 'Unknown'} on {new Date(order.sample_collected_at).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* Modals */}
      {showInvoiceModal && (
        <CreateInvoiceModal
          orderId={order.id}
          onClose={() => setShowInvoiceModal(false)}
          onSuccess={async () => {
            setShowInvoiceModal(false);
            // Trigger a refresh in parent if needed, or just close
            // Ideally we should refresh the order data here, but for now we rely on parent refresh
            onClose();
          }}
        />
      )}

      {showPaymentModal && order.invoice_id && (
        <PaymentCapture
          invoiceId={order.invoice_id}
          onClose={() => setShowPaymentModal(false)}
          onSuccess={() => {
            setShowPaymentModal(false);
            onClose();
          }}
        />
      )}

      {/* Dispatch Modal */}
      {showDispatchModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <Truck className="h-5 w-5 text-amber-600" />
                Send Sample
              </h3>
              <button onClick={() => setShowDispatchModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="bg-amber-50 border border-amber-100 rounded-lg p-3">
                <div className="text-sm text-amber-800">
                  <strong>From:</strong> {order.location || 'Collection Center'}
                </div>
                <div className="text-sm text-amber-800 mt-1">
                  <strong>Order:</strong> #{order.id.slice(-6)} - {order.patient_name}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Destination Location
                </label>
                <select
                  value={dispatchDestination}
                  onChange={(e) => setDispatchDestination(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-amber-500"
                >
                  {dispatchLocations.map(loc => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name} {loc.is_processing_center ? '(Processing Center)' : ''}
                    </option>
                  ))}
                  {dispatchLocations.length === 0 && (
                    <option value="">No locations configured</option>
                  )}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Priority
                </label>
                <select
                  value={dispatchPriority}
                  onChange={(e) => setDispatchPriority(e.target.value as any)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                >
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                  <option value="low">Low</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Notes (optional)
                </label>
                <textarea
                  value={dispatchNotes}
                  onChange={(e) => setDispatchNotes(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  rows={2}
                  placeholder="Any special instructions..."
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t bg-gray-50">
              <button
                onClick={() => setShowDispatchModal(false)}
                className="px-4 py-2 text-gray-700 hover:text-gray-900"
              >
                Cancel
              </button>
              <button
                onClick={handleDispatchToLab}
                disabled={dispatching || !dispatchDestination}
                className="flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50"
              >
                {dispatching ? <Loader className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                Dispatch Now
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Outsource Modal */}
      {showOutsourceModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
              <Building className="h-5 w-5 text-purple-600" />
              Outsource Order
            </h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Select Lab</label>
                <select
                  value={selectedOutsourceLab}
                  onChange={(e) => setSelectedOutsourceLab(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                >
                  <option value="">-- Select Lab --</option>
                  {outsourcedLabs.map(lab => (
                    <option key={lab.id} value={lab.id}>{lab.name}</option>
                  ))}
                </select>
              </div>

              <div className="bg-yellow-50 border border-yellow-100 rounded-lg p-3 text-sm text-yellow-800">
                <p>This will mark the order as outsourced and update its status.</p>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={handleOutsource}
                  disabled={!selectedOutsourceLab}
                  className="flex-1 bg-purple-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Confirm Outsource
                </button>
                <button
                  onClick={() => setShowOutsourceModal(false)}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 font-medium"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body
  );
};

export default DashboardOrderModal;
