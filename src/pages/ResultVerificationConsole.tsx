import React, { useEffect, useMemo, useState, useCallback } from "react";
import ReactDOM from "react-dom";
import {
  Search,
  Calendar,
  ChevronDown,
  ChevronUp,
  User,
  TestTube,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  CheckSquare,
  RefreshCcw,
  AlertCircle,
  Clock,
  TrendingUp,
  FileText,
  Zap,
  Activity,
  BarChart3,
  Target,
  Loader2,
  Filter as FilterIcon,
  X,
  ChevronRight,
  Eye,
  Expand,
  Minimize,
  FileImage,
  Sparkles,
  ClipboardList,
  Stethoscope,
  Mail,
  Calculator
} from "lucide-react";
import { supabase, database } from "../utils/supabase";
import AttachmentSelector from "../components/Reports/AttachmentSelector";
import OrderVerificationView from "./OrderVerificationView";
import { useAIResultIntelligence, type VerifierSummaryResponse, type ClinicalSummaryResponse, type GeneratedInterpretation, type ResultValue } from "../hooks/useAIResultIntelligence";
import { generateAndSaveTrendCharts, saveClinicalSummary } from "../utils/reportExtrasService";
import TrendGraphPanel from "../components/Results/TrendGraphPanel";
import AIResultSuggestionCard from "../components/Results/AIResultSuggestionCard";
import SectionEditor from "../components/Results/SectionEditor";
import { useCalculatedParameters } from "../hooks/useCalculatedParameters";

/* =========================================
   Types
========================================= */

type PanelRow = {
  order_id: string;
  result_id: string;
  test_group_id: string | null;
  test_group_name: string | null;
  expected_analytes: number;
  entered_analytes: number;
  approved_analytes: number;
  panel_ready: boolean;
  patient_id: string;
  patient_name: string;
  order_date: string;
};

type Analyte = {
  id: string;
  result_id: string;
  analyte_id: string; // UUID reference to analytes table
  parameter: string;
  value: string | null;
  unit: string;
  reference_range: string;
  flag: string | null;
  verify_status: "pending" | "approved" | "rejected" | null;
  verify_note: string | null;
  verified_by: string | null;
  verified_at: string | null;
  // Calculated parameter fields
  is_auto_calculated?: boolean;
  calculation_inputs?: Record<string, number>;
  calculated_at?: string;
};

type TrendData = {
  order_date: string;
  test_name: string;
  value: string;
  unit: string;
  reference_range: string;
  flag: string | null;
};

type Attachment = {
  id: string;
  file_url: string;
  file_type: string;
  original_filename: string;
  created_at: string;
  level: 'test' | 'order';
};

type StateFilter = "all" | "pending" | "partial" | "ready";
type ViewMode = "panel" | "order";

/* =========================================
   Helpers
========================================= */

const todayISO = () => new Date().toISOString().slice(0, 10);
const fromYesterdayISO = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
};

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });

/* =========================================
   Attachment Item Component
========================================= */

interface AttachmentItemProps {
  attachment: Attachment;
  levelColor: string;
  levelBgColor: string;
}

const AttachmentItem: React.FC<AttachmentItemProps> = ({ attachment, levelColor, levelBgColor }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const isPreviewable = attachment.file_type === 'text/plain' ||
    attachment.file_type === 'application/json' ||
    attachment.file_type?.startsWith('image/') ||
    attachment.original_filename.toLowerCase().endsWith('.txt') ||
    attachment.original_filename.toLowerCase().endsWith('.json') ||
    attachment.original_filename.toLowerCase().endsWith('.csv') ||
    attachment.original_filename.toLowerCase().endsWith('.png') ||
    attachment.original_filename.toLowerCase().endsWith('.jpg') ||
    attachment.original_filename.toLowerCase().endsWith('.jpeg') ||
    attachment.original_filename.toLowerCase().endsWith('.gif') ||
    attachment.original_filename.toLowerCase().endsWith('.bmp');

  const isImage = attachment.file_type?.startsWith('image/') ||
    attachment.original_filename.toLowerCase().match(/\.(png|jpg|jpeg|gif|bmp)$/);

  const handleExpand = async () => {
    if (!isExpanded && isPreviewable && !previewContent && !isImage) {
      setPreviewLoading(true);
      try {
        const response = await fetch(attachment.file_url);
        const text = await response.text();
        setPreviewContent(text);
      } catch (error) {
        console.error('Failed to load preview:', error);
        setPreviewContent('Failed to load preview');
      } finally {
        setPreviewLoading(false);
      }
    }
    setIsExpanded(!isExpanded);
  };

  return (
    <div className={`border rounded ${levelBgColor} ${levelColor.replace('text-', 'border-')}`}>
      <div className="flex items-center justify-between p-2">
        <div className="flex items-center space-x-2 flex-1">
          <FileText className={`h-4 w-4 ${levelColor}`} />
          <div className="flex-1">
            <p className="text-sm font-medium">{attachment.original_filename}</p>
            <p className={`text-xs ${levelColor}`}>
              {attachment.level === 'test' ? 'Test' : 'Order'} Level • {new Date(attachment.created_at).toLocaleDateString()}
            </p>
          </div>
        </div>
        <div className="flex items-center space-x-1">
          {isPreviewable && (
            <button
              onClick={handleExpand}
              className={`p-1 ${levelColor} hover:opacity-75 transition-opacity`}
              title={isExpanded ? "Minimize" : "Expand preview"}
            >
              {isExpanded ? <Minimize className="h-4 w-4" /> : <Expand className="h-4 w-4" />}
            </button>
          )}
          <a
            href={attachment.file_url}
            target="_blank"
            rel="noopener noreferrer"
            className={`${levelColor} hover:opacity-75 transition-opacity`}
            title="Open in new tab"
          >
            <Eye className="h-4 w-4" />
          </a>
        </div>
      </div>

      {isExpanded && (
        <div className="border-t p-4 bg-white/50">
          {previewLoading ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCcw className="h-5 w-5 animate-spin mr-2" />
              <span className="text-sm text-gray-600">Loading preview...</span>
            </div>
          ) : isImage ? (
            <div className="max-h-96 overflow-y-auto border rounded bg-white p-2">
              <img
                src={attachment.file_url}
                alt={attachment.original_filename}
                className="max-w-full h-auto rounded"
                style={{ maxHeight: '500px' }}
              />
            </div>
          ) : previewContent ? (
            <div className="max-h-96 overflow-y-auto border rounded bg-white">
              <pre className="text-sm bg-gray-50 p-4 whitespace-pre-wrap break-words font-mono leading-relaxed">
                {previewContent.length > 2000 ? `${previewContent.substring(0, 2000)}...\n\n[Preview truncated - full content available in new tab]` : previewContent}
              </pre>
            </div>
          ) : (
            <div className="text-sm text-gray-500 py-6 text-center">
              Preview not available for this file type
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/* =========================================
   Attachment Viewer Component
========================================= */

interface AttachmentViewerProps {
  attachments: Attachment[];
  viewMode: 'test' | 'all';
}

const AttachmentViewer: React.FC<AttachmentViewerProps> = ({ attachments, viewMode }) => {
  const testAttachments = attachments.filter(a => a.level === 'test');
  const orderAttachments = attachments.filter(a => a.level === 'order');
  const filteredAttachments = viewMode === 'test' ? testAttachments : attachments;

  if (filteredAttachments.length === 0) {
    if (viewMode === 'test') {
      if (orderAttachments.length > 0) {
        return (
          <div className="space-y-3">
            <div className="text-sm text-amber-600 bg-amber-50 p-3 rounded-lg border border-amber-200">
              <div className="flex items-center space-x-2">
                <AlertTriangle className="h-4 w-4" />
                <span className="font-medium">No test-specific attachments for this test</span>
              </div>
              <p className="text-xs text-amber-700 mt-1">
                There are {orderAttachments.length} order-level attachment{orderAttachments.length > 1 ? 's' : ''} available. Switch to "All" view to see them.
              </p>
            </div>
          </div>
        );
      } else {
        return (
          <div className="text-sm text-gray-500 bg-gray-50 p-3 rounded-lg border border-gray-200">
            <div className="flex items-center space-x-2">
              <FileText className="h-4 w-4" />
              <span>No attachments found for this test or order</span>
            </div>
          </div>
        );
      }
    } else {
      return (
        <div className="text-sm text-gray-500 bg-gray-50 p-3 rounded-lg border border-gray-200">
          <div className="flex items-center space-x-2">
            <FileText className="h-4 w-4" />
            <span>No attachments found for this order</span>
          </div>
        </div>
      );
    }
  }

  return (
    <div className="space-y-2">
      {viewMode === 'all' && testAttachments.length > 0 && orderAttachments.length > 0 && (
        <div className="mb-4">
          <h5 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">Test-Specific Attachments</h5>
          <div className="space-y-2">
            {testAttachments.map(attachment => (
              <AttachmentItem
                key={attachment.id}
                attachment={attachment}
                levelColor="text-blue-600"
                levelBgColor="bg-blue-50"
              />
            ))}
          </div>

          {orderAttachments.length > 0 && (
            <>
              <h5 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2 mt-4">Order-Level Attachments</h5>
              <div className="space-y-2">
                {orderAttachments.map(attachment => (
                  <AttachmentItem
                    key={attachment.id}
                    attachment={attachment}
                    levelColor="text-gray-600"
                    levelBgColor="bg-gray-50"
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {viewMode === 'test' && (
        <div className="space-y-2">
          {testAttachments.map(attachment => (
            <AttachmentItem
              key={attachment.id}
              attachment={attachment}
              levelColor="text-blue-600"
              levelBgColor="bg-blue-50"
            />
          ))}
        </div>
      )}

      {viewMode === 'all' && (testAttachments.length === 0 || orderAttachments.length === 0) && (
        <div className="space-y-2">
          {filteredAttachments.map(attachment => (
            <AttachmentItem
              key={attachment.id}
              attachment={attachment}
              levelColor={attachment.level === 'test' ? "text-blue-600" : "text-gray-600"}
              levelBgColor={attachment.level === 'test' ? "bg-blue-50" : "bg-gray-50"}
            />
          ))}
        </div>
      )}
    </div>
  );
};

/* =========================================
   Modern Result Verification Console
========================================= */

const ResultVerificationConsole: React.FC = () => {
  // filters
  const [from, setFrom] = useState(fromYesterdayISO());
  const [to, setTo] = useState(todayISO());
  const [q, setQ] = useState("");
  const [stateFilter, setStateFilter] = useState<StateFilter>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("panel");
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

  // attachment view mode
  const [attachmentViewMode, setAttachmentViewMode] = useState<'test' | 'all'>('test');

  // data
  const [panels, setPanels] = useState<PanelRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // analytes cache by result_id
  const [rowsByResult, setRowsByResult] = useState<Record<string, Analyte[]>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({}); // result_id -> bool
  const [busy, setBusy] = useState<Record<string, boolean>>({});  // small per-row spinner

  // attachments cache by order_id
  const [attachmentsByOrder, setAttachmentsByOrder] = useState<Record<string, Attachment[]>>({});

  // bulk operations
  const [selectedPanels, setSelectedPanels] = useState<Set<string>>(new Set());
  const [bulkProcessing, setBulkProcessing] = useState(false);

  // AI intelligence
  const aiIntelligence = useAIResultIntelligence();
  const [aiVerifierSummary, setAiVerifierSummary] = useState<Record<string, VerifierSummaryResponse>>({});
  const [aiClinicalSummary, setAiClinicalSummary] = useState<Record<string, ClinicalSummaryResponse>>({});
  const [showAiSummaryModal, setShowAiSummaryModal] = useState(false);
  const [aiSummaryTarget, setAiSummaryTarget] = useState<{ type: 'verifier' | 'clinical'; resultId?: string; orderId?: string } | null>(null);
  const [aiGeneratedInterpretations, setAiGeneratedInterpretations] = useState<Record<string, GeneratedInterpretation[]>>({});
  const [showInterpretationsModal, setShowInterpretationsModal] = useState(false);
  const [interpretationsTargetResultId, setInterpretationsTargetResultId] = useState<string | null>(null);
  // New: AI suggestions for actual result values (not templates)
  const [aiResultSuggestions, setAiResultSuggestions] = useState<Record<string, ResultValue[]>>({});
  const [currentLabId, setCurrentLabId] = useState<string | null>(null);
  const [trendData, setTrendData] = useState<Record<string, TrendData[]>>({});
  const [showTrendModal, setShowTrendModal] = useState(false);
  const [selectedAnalyteTrend, setSelectedAnalyteTrend] = useState<{ parameter: string; patientId: string } | null>(null);
  const [loadingTrend, setLoadingTrend] = useState(false);

  // attachment selector
  const [showAttachmentSelector, setShowAttachmentSelector] = useState(false);
  const [selectedOrderForAttachments, setSelectedOrderForAttachments] = useState<string | null>(null);

  // Report extras (trends and clinical summary inclusion)
  const [includeTrendsInReport, setIncludeTrendsInReport] = useState<Record<string, boolean>>({});
  const [includeSummaryInReport, setIncludeSummaryInReport] = useState<Record<string, boolean>>({});
  const [savingReportExtras, setSavingReportExtras] = useState<Record<string, boolean>>({});

  /* ----------------- Load attachments ----------------- */
  const loadAttachments = async (orderId: string) => {
    if (attachmentsByOrder[orderId]) return; // Already loaded

    try {
      const { data, error } = await supabase
        .from('attachments')
        .select(`
          id,
          file_url,
          file_type,
          original_filename,
          created_at,
          order_test_id
        `)
        .eq('order_id', orderId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const attachments: Attachment[] = (data || []).map(att => ({
        id: att.id,
        file_url: att.file_url,
        file_type: att.file_type,
        original_filename: att.original_filename,
        created_at: att.created_at,
        level: att.order_test_id ? 'test' : 'order'
      }));

      setAttachmentsByOrder(prev => ({ ...prev, [orderId]: attachments }));
    } catch (error) {
      console.error('Error loading attachments:', error);
    }
  };

  // Load current lab ID on mount
  useEffect(() => {
    const loadLabId = async () => {
      const labId = await database.getCurrentUserLabId();
      setCurrentLabId(labId);
    };
    loadLabId();
  }, []);

  /* ----------------- Load panels with lab filter ----------------- */
  const loadPanels = async () => {
    setLoading(true);
    setErr(null);

    // Get current lab ID for filtering
    const labId = currentLabId || await database.getCurrentUserLabId();
    if (!labId) {
      setErr("No lab context found. Please log in again.");
      setPanels([]);
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from("v_result_panel_status")
      .select("*")
      .eq("lab_id", labId)
      .gte("order_date", from)
      .lte("order_date", to)
      .order("order_date", { ascending: false });

    if (error) {
      setErr(error.message);
      setPanels([]);
    } else {
      setPanels((data || []) as PanelRow[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (currentLabId) {
      loadPanels();
    }
  }, [from, to, currentLabId]);

  /* ----------------- Filter panels ----------------- */
  const filteredPanels = useMemo(() => {
    const k = q.trim().toLowerCase();

    let list = panels;
    if (k) {
      list = list.filter(
        (r) =>
          (r.patient_name || "").toLowerCase().includes(k) ||
          (r.test_group_name || "").toLowerCase().includes(k) ||
          (r.order_id || "").toLowerCase().includes(k)
      );
    }

    if (stateFilter === "ready") {
      list = list.filter((r) => r.panel_ready);
    } else if (stateFilter === "pending") {
      list = list.filter((r) => !r.panel_ready && (r.approved_analytes || 0) === 0);
    } else if (stateFilter === "partial") {
      list = list.filter(
        (r) => !r.panel_ready && r.approved_analytes > 0 && r.approved_analytes < r.expected_analytes
      );
    }

    return list;
  }, [panels, q, stateFilter]);

  /* ----------------- Load analytes for panel ----------------- */
  const ensureAnalytesLoaded = async (result_id: string) => {
    if (rowsByResult[result_id]) return;

    const { data, error } = await supabase
      .from("result_values")
      .select(
        [
          "id",
          "result_id",
          "analyte_id",
          "parameter",
          "value",
          "unit",
          "reference_range",
          "flag",
          "verify_status",
          "verify_note",
          "verified_by",
          "verified_at",
          "is_auto_calculated",
          "calculation_inputs",
          "calculated_at",
        ].join(",")
      )
      .eq("result_id", result_id)
      .order("parameter", { ascending: true });

    if (!error && data) {
      setRowsByResult((s) => ({ ...s, [result_id]: data as unknown as Analyte[] }));
    } else {
      // Fallback if verify_* columns do not exist
      if (String(error.message || "").includes("column") && String(error.message).includes("verify_status")) {
        const { data: data2, error: e2 } = await supabase
          .from("result_values")
          .select("id,result_id,analyte_id,parameter,value,unit,reference_range,flag,is_auto_calculated,calculation_inputs,calculated_at")
          .eq("result_id", result_id)
          .order("parameter", { ascending: true });

        if (!e2) {
          const mapped = (data2 || []).map((r: any) => ({
            id: r.id,
            result_id: r.result_id,
            analyte_id: r.analyte_id,
            parameter: r.parameter,
            value: r.value,
            unit: r.unit,
            reference_range: r.reference_range,
            flag: r.flag,
            verify_status: "pending",
            verify_note: null,
            verified_by: null,
            verified_at: null,
            is_auto_calculated: r.is_auto_calculated,
            calculation_inputs: r.calculation_inputs,
            calculated_at: r.calculated_at,
          })) as Analyte[];
          setRowsByResult((s) => ({ ...s, [result_id]: mapped }));
        }
      }
    }
  };

  /* ----------------- Load trend data for analyte ----------------- */
  const loadTrendData = async (patientId: string, parameter: string) => {
    const cacheKey = `${patientId}-${parameter}`;
    if (trendData[cacheKey]) {
      setSelectedAnalyteTrend({ parameter, patientId });
      setShowTrendModal(true);
      return;
    }

    setLoadingTrend(true);
    try {
      const { data, error } = await supabase
        .from('v_report_template_context')
        .select('order_date, analytes')
        .eq('patient_id', patientId)
        .order('order_date', { ascending: false })
        .limit(10);

      if (error) throw error;

      // Extract relevant analyte data from jsonb array
      const extractedTrend = data?.flatMap((row: any) => {
        const analytes = row.analytes || [];
        return analytes
          .filter((a: any) => a.parameter === parameter)
          .map((a: any) => ({
            order_date: row.order_date,
            test_name: a.parameter,
            value: a.value,
            unit: a.unit,
            reference_range: a.reference_range,
            flag: a.flag
          }));
      }) || [];

      setTrendData((prev) => ({ ...prev, [cacheKey]: extractedTrend as TrendData[] }));
      setSelectedAnalyteTrend({ parameter, patientId });
      setShowTrendModal(true);
    } catch (error) {
      console.error('Error loading trend data:', error);
      alert('Failed to load trend data');
    } finally {
      setLoadingTrend(false);
    }
  };

  const toggleOpen = async (row: PanelRow) => {
    const k = row.result_id;
    setOpen((s) => ({ ...s, [k]: !s[k] }));
    if (!rowsByResult[k]) await ensureAnalytesLoaded(k);
    if (!attachmentsByOrder[row.order_id]) await loadAttachments(row.order_id);
  };

  /* ----------------- Selection handlers ----------------- */
  const togglePanelSelection = (resultId: string) => {
    setSelectedPanels(prev => {
      const newSet = new Set(prev);
      if (newSet.has(resultId)) {
        newSet.delete(resultId);
      } else {
        newSet.add(resultId);
      }
      return newSet;
    });
  };

  const selectAllPanels = () => {
    setSelectedPanels(new Set(filteredPanels.map(p => p.result_id)));
  };

  const clearSelection = () => {
    setSelectedPanels(new Set());
  };

  /* ----------------- Mutations ----------------- */
  const setBusyFor = (key: string, v: boolean) => setBusy((s) => ({ ...s, [key]: v }));

  const approveAnalyte = async (rv_id: string) => {
    setBusyFor(rv_id, true);
    const { error } = await supabase
      .from("result_values")
      .update({ verify_status: "approved", verified_at: new Date().toISOString() })
      .eq("id", rv_id);
    setBusyFor(rv_id, false);

    if (!error) {
      // update client cache
      setRowsByResult((s) => {
        const next = { ...s };
        for (const rid in next) {
          next[rid] = next[rid].map((a) => (a.id === rv_id ? { ...a, verify_status: "approved" } : a));
        }
        return next;
      });
      await loadPanels();
    }
  };

  const rejectAnalyte = async (rv_id: string) => {
    const note = prompt("Add a note (optional)", "") ?? null;
    setBusyFor(rv_id, true);
    const { error } = await supabase
      .from("result_values")
      .update({
        verify_status: "rejected",
        verify_note: note && note.length ? note : null,
        verified_at: new Date().toISOString(),
      })
      .eq("id", rv_id);
    setBusyFor(rv_id, false);

    if (!error) {
      setRowsByResult((s) => {
        const next = { ...s };
        for (const rid in next) {
          next[rid] = next[rid].map((a) => (a.id === rv_id ? { ...a, verify_status: "rejected", verify_note: note } : a));
        }
        return next;
      });
      await loadPanels();
    }
  };

  // Send rejected analyte back to result entry as pending (for re-run)
  const sendForRerun = async (rv_id: string) => {
    const note = prompt("Add a note for re-run request:", "Please re-run this test") ?? null;
    if (!note?.trim()) {
      alert("Note is required to send for re-run");
      return;
    }

    setBusyFor(rv_id, true);
    const { error } = await supabase
      .from("result_values")
      .update({
        verify_status: "pending",
        verify_note: `RE-RUN REQUESTED: ${note}`,
        verified_at: null,
        verified_by: null,
      })
      .eq("id", rv_id);
    setBusyFor(rv_id, false);

    if (!error) {
      setRowsByResult((s) => {
        const next = { ...s };
        for (const rid in next) {
          next[rid] = next[rid].map((a) =>
            a.id === rv_id
              ? { ...a, verify_status: "pending", verify_note: `RE-RUN REQUESTED: ${note}`, verified_at: null, verified_by: null }
              : a
          );
        }
        return next;
      });
      await loadPanels();
      alert("Analyte sent back for re-run");
    }
  };

  // Edit rejected analyte value inline
  const [editingAnalyteId, setEditingAnalyteId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<{
    value: string;
    unit: string;
    reference_range: string;
    flag: string | null;
  }>({ value: "", unit: "", reference_range: "", flag: null });

  const startEditAnalyte = (analyte: Analyte) => {
    setEditingAnalyteId(analyte.id);
    setEditValues({
      value: analyte.value || "",
      unit: analyte.unit,
      reference_range: analyte.reference_range,
      flag: analyte.flag,
    });
  };

  const cancelEditAnalyte = () => {
    setEditingAnalyteId(null);
    setEditValues({ value: "", unit: "", reference_range: "", flag: null });
  };

  const saveEditedAnalyte = async (rv_id: string) => {
    if (!editValues.value.trim()) {
      alert("Value is required");
      return;
    }

    setBusyFor(rv_id, true);
    const { error } = await supabase
      .from("result_values")
      .update({
        value: editValues.value,
        unit: editValues.unit,
        reference_range: editValues.reference_range,
        flag: editValues.flag,
        verify_status: "pending", // Reset to pending after edit
        verify_note: "Value edited by verifier",
        verified_at: null,
        verified_by: null,
      })
      .eq("id", rv_id);
    setBusyFor(rv_id, false);

    if (!error) {
      setRowsByResult((s) => {
        const next = { ...s };
        for (const rid in next) {
          next[rid] = next[rid].map((a) =>
            a.id === rv_id
              ? {
                ...a,
                value: editValues.value,
                unit: editValues.unit,
                reference_range: editValues.reference_range,
                flag: editValues.flag,
                verify_status: "pending",
                verify_note: "Value edited by verifier",
                verified_at: null,
                verified_by: null
              }
              : a
          );
        }
        return next;
      });
      setEditingAnalyteId(null);
      await loadPanels();
      alert("Analyte value updated and reset to pending");
    }
  };

  const approveAllInPanel = async (row: PanelRow) => {
    const list = rowsByResult[row.result_id] || [];
    if (!list.length) return;
    const ids = list.map((a) => a.id);
    setBusyFor(row.result_id, true);
    setSavingReportExtras(prev => ({ ...prev, [row.order_id]: true }));

    try {
      const { error } = await supabase
        .from("result_values")
        .update({ verify_status: "approved", verified_at: new Date().toISOString() })
        .in("id", ids);

      if (!error) {
        setRowsByResult((s) => ({
          ...s,
          [row.result_id]: (s[row.result_id] || []).map((a) => ({ ...a, verify_status: "approved" })),
        }));

        // Generate and save report extras (trends and clinical summary) if enabled
        try {
          // Save trend charts if enabled and there are flagged analytes
          if (includeTrendsInReport[row.order_id]) {
            const flaggedAnalytes = list.filter(a => a.flag && ['H', 'L', 'C', 'Critical'].includes(a.flag));
            if (flaggedAnalytes.length > 0) {
              console.log(`Generating trend charts for ${flaggedAnalytes.length} flagged analytes...`);
              await generateAndSaveTrendCharts(
                row.result_id,
                row.order_id,
                row.patient_id,
                flaggedAnalytes.map(a => ({ name: a.parameter, flag: a.flag })),
                true  // includeInReport
              );
            }
          }

          // Save clinical summary if enabled and exists
          if (includeSummaryInReport[row.order_id] && aiClinicalSummary[row.order_id]) {
            console.log('Saving clinical summary to report extras...');
            const summaryResponse = aiClinicalSummary[row.order_id];
            await saveClinicalSummary(row.result_id, {
              text: summaryResponse.clinical_interpretation || summaryResponse.executive_summary || '',
              recommendation: summaryResponse.suggested_followup?.join('\n'),
              generated_at: new Date().toISOString(),
              generated_by: 'ai',
            });
          }
        } catch (extrasError) {
          console.error('Failed to save report extras:', extrasError);
          // Don't block the approval - extras are optional
        }

        await loadPanels();
      }
    } finally {
      setBusyFor(row.result_id, false);
      setSavingReportExtras(prev => ({ ...prev, [row.order_id]: false }));
    }
  };

  const bulkApproveSelected = async () => {
    if (selectedPanels.size === 0) return;

    setBulkProcessing(true);
    const promises = Array.from(selectedPanels).map(resultId => {
      const row = filteredPanels.find(p => p.result_id === resultId);
      return row ? approveAllInPanel(row) : Promise.resolve();
    });

    await Promise.all(promises);
    clearSelection();
    setBulkProcessing(false);
  };

  const handleEmailReport = async (row: PanelRow) => {
    if (!currentLabId) {
      alert("Lab ID not found");
      return;
    }

    const confirmSend = window.confirm(`Send report email to ${row.patient_name}?`);
    if (!confirmSend) return;

    setBusyFor(row.result_id, true);
    try {
      const response = await fetch('/.netlify/functions/send-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + (await supabase.auth.getSession()).data.session?.access_token,
        },
        body: JSON.stringify({
          to: 'patient@example.com', // TODO: Get actual patient email
          subject: `Test Report: ${row.test_group_name} - ${row.patient_name}`,
          templateId: 'patient_report',
          labId: currentLabId,
          data: {
            patientName: row.patient_name,
            reportDate: fmtDate(row.order_date),
            labName: 'Your Lab Name', // TODO: Get from lab settings
            downloadUrl: `${window.location.origin}/reports/${row.order_id}`, // Placeholder
          }
        }),
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to send email');

      alert('Email sent successfully!');
    } catch (error) {
      console.error('Error sending email:', error);
      alert('Failed to send email: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setBusyFor(row.result_id, false);
    }
  };

  /* ----------------- Stats ----------------- */
  const stats = useMemo(() => {
    const total = panels.length;
    const ready = panels.filter((p) => p.panel_ready).length;
    const pending = panels.filter(
      (p) => !p.panel_ready && p.approved_analytes === 0
    ).length;
    const partial = total - ready - pending;
    const critical = panels.filter(p =>
      rowsByResult[p.result_id]?.some(a => a.flag === 'C' || a.flag === 'Critical')
    ).length;

    return { total, ready, partial, pending, critical };
  }, [panels, rowsByResult]);

  /* ----------------- UI Components ----------------- */
  const StatsBadge: React.FC<{
    icon: React.FC<any>,
    label: string,
    value: number,
    color: string,
    bgColor: string,
    onClick?: () => void
  }> = ({ icon: Icon, label, value, color, bgColor, onClick }) => (
    <div
      className={`${bgColor} rounded-xl p-6 cursor-pointer hover:shadow-md transition-all duration-200 border-2 border-transparent hover:border-${color.split('-')[0]}-200`}
      onClick={onClick}
    >
      <div className="flex items-center justify-between">
        <div>
          <div className={`text-3xl font-bold ${color}`}>{value}</div>
          <div className={`text-sm font-medium ${color.replace('600', '700')}`}>{label}</div>
        </div>
        <div className={`${color.replace('600', '100')} p-3 rounded-full`}>
          <Icon className={`h-6 w-6 ${color}`} />
        </div>
      </div>
    </div>
  );

  const StateBadge: React.FC<{ row: PanelRow }> = ({ row }) => {
    if (row.panel_ready) {
      return (
        <span className="inline-flex items-center px-3 py-1.5 rounded-full text-sm font-semibold bg-gradient-to-r from-green-100 to-emerald-100 text-green-800 border border-green-200 shadow-sm">
          <ShieldCheck className="h-4 w-4 mr-2" />
          Verified
        </span>
      );
    }
    if (row.approved_analytes > 0) {
      return (
        <span className="inline-flex items-center px-3 py-1.5 rounded-full text-sm font-semibold bg-gradient-to-r from-amber-100 to-orange-100 text-amber-800 border border-amber-200 shadow-sm">
          <AlertTriangle className="h-4 w-4 mr-2" />
          Partial ({row.approved_analytes}/{row.expected_analytes})
        </span>
      );
    }
    return (
      <span className="inline-flex items-center px-3 py-1.5 rounded-full text-sm font-semibold bg-gradient-to-r from-red-100 to-pink-100 text-red-800 border border-red-200 shadow-sm">
        <AlertCircle className="h-4 w-4 mr-2" />
        Pending
      </span>
    );
  };

  const AnalyteRowView: React.FC<{ a: Analyte; patientId: string }> = ({ a, patientId }) => {
    const status = a.verify_status || "pending";
    const isBusy = !!busy[a.id];
    const cacheKey = `${patientId}-${a.parameter}`;
    const hasTrend = trendData[cacheKey] && trendData[cacheKey].length > 0;
    const [showAISuggestion, setShowAISuggestion] = useState(false);
    const isEditing = editingAnalyteId === a.id;

    const getFlagBadge = (flag: string | null) => {
      if (!flag) return null;

      const flagConfig = {
        'H': { bg: 'bg-red-100', text: 'text-red-800', label: 'High' },
        'L': { bg: 'bg-blue-100', text: 'text-blue-800', label: 'Low' },
        'C': { bg: 'bg-orange-100', text: 'text-orange-800', label: 'Critical' },
        'Critical': { bg: 'bg-red-100', text: 'text-red-800', label: 'Critical' }
      };

      const config = flagConfig[flag as keyof typeof flagConfig] ||
        { bg: 'bg-gray-100', text: 'text-gray-800', label: flag };

      return (
        <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-bold ${config.bg} ${config.text} border`}>
          {config.label}
        </span>
      );
    };

    return (
      <>
        <tr className={`hover:bg-blue-50 transition-colors ${a.is_auto_calculated ? 'bg-amber-50/50' : ''}`}>
          <td className="px-4 py-4">
            <div className="flex items-center space-x-2">
              <div className="font-semibold text-gray-900">{a.parameter}</div>
              {a.is_auto_calculated && (
                <span
                  className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 border border-amber-200"
                  title={a.calculation_inputs ? `Calculated from: ${Object.entries(a.calculation_inputs).map(([k, v]) => `${k}=${v}`).join(', ')}` : 'Auto-calculated value'}
                >
                  <Calculator className="h-3 w-3 mr-1" />
                  Calc
                </span>
              )}
              <button
                onClick={() => loadTrendData(patientId, a.parameter)}
                disabled={loadingTrend}
                className="inline-flex items-center text-blue-600 hover:text-blue-800 transition-colors"
                title="View trend"
              >
                {loadingTrend && selectedAnalyteTrend?.parameter === a.parameter ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <TrendingUp className="h-4 w-4" />
                )}
              </button>
              {hasTrend && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                  {trendData[cacheKey].length}
                </span>
              )}
              <button
                onClick={() => setShowAISuggestion(!showAISuggestion)}
                className="inline-flex items-center text-purple-600 hover:text-purple-800 transition-colors"
                title="Toggle AI suggestions"
              >
                <Sparkles className="h-4 w-4" />
              </button>
            </div>
            {a.value && (
              <div className="text-sm text-gray-600 mt-1">
                Last updated: {a.verified_at ? new Date(a.verified_at).toLocaleString() : 'Never'}
              </div>
            )}
          </td>
          <td className="px-4 py-4">
            {isEditing ? (
              <input
                type="text"
                value={editValues.value}
                onChange={(e) => setEditValues(prev => ({ ...prev, value: e.target.value }))}
                className="w-full px-2 py-1 border border-blue-300 rounded focus:ring-2 focus:ring-blue-500 font-bold text-lg"
                placeholder="Enter value"
              />
            ) : (
              <div className="font-bold text-lg text-gray-900">{a.value ?? "—"}</div>
            )}
          </td>
          <td className="px-4 py-4">
            {isEditing ? (
              <input
                type="text"
                value={editValues.unit}
                onChange={(e) => setEditValues(prev => ({ ...prev, unit: e.target.value }))}
                className="w-full px-2 py-1 border border-blue-300 rounded focus:ring-2 focus:ring-blue-500 font-medium"
                placeholder="Unit"
              />
            ) : (
              <span className="font-medium text-gray-700">{a.unit}</span>
            )}
          </td>
          <td className="px-4 py-4">
            {isEditing ? (
              <input
                type="text"
                value={editValues.reference_range}
                onChange={(e) => setEditValues(prev => ({ ...prev, reference_range: e.target.value }))}
                className="w-full px-2 py-1 border border-blue-300 rounded focus:ring-2 focus:ring-blue-500 text-sm"
                placeholder="Reference range"
              />
            ) : (
              <div className="text-sm text-gray-600 max-w-xs">{a.reference_range}</div>
            )}
          </td>
          <td className="px-4 py-4">
            {isEditing ? (
              <select
                value={editValues.flag || ""}
                onChange={(e) => setEditValues(prev => ({ ...prev, flag: e.target.value || null }))}
                className="px-2 py-1 border border-blue-300 rounded focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Normal</option>
                <option value="H">High</option>
                <option value="L">Low</option>
                <option value="C">Critical</option>
              </select>
            ) : (
              getFlagBadge(a.flag)
            )}
          </td>
          <td className="px-4 py-4">
            <div className="flex items-center space-x-3">
              {isEditing ? (
                // Edit mode buttons
                <div className="flex items-center space-x-2">
                  <button
                    disabled={isBusy}
                    onClick={() => saveEditedAnalyte(a.id)}
                    className="inline-flex items-center px-3 py-2 rounded-lg text-sm font-semibold bg-gradient-to-r from-blue-500 to-indigo-500 text-white hover:from-blue-600 hover:to-indigo-600 transition-all duration-200 shadow-sm disabled:opacity-50"
                  >
                    {isBusy ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4 mr-2" />
                    )}
                    Save
                  </button>
                  <button
                    onClick={cancelEditAnalyte}
                    className="inline-flex items-center px-3 py-2 rounded-lg text-sm font-semibold bg-gray-200 text-gray-700 hover:bg-gray-300 transition-all duration-200"
                  >
                    <X className="h-4 w-4 mr-2" />
                    Cancel
                  </button>
                </div>
              ) : status === "approved" ? (
                <span className="inline-flex items-center px-4 py-2 rounded-lg text-sm font-semibold bg-gradient-to-r from-green-600 to-emerald-600 text-white shadow-sm">
                  <CheckSquare className="h-4 w-4 mr-2" />
                  Approved
                </span>
              ) : status === "rejected" ? (
                // Rejected state - show Edit and Re-run options
                <div className="flex flex-col space-y-2">
                  <div className="flex items-center space-x-2">
                    <span className="inline-flex items-center px-3 py-1.5 rounded-lg text-sm font-semibold bg-gradient-to-r from-red-600 to-rose-600 text-white">
                      <XCircle className="h-4 w-4 mr-2" />
                      Rejected
                    </span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <button
                      disabled={isBusy}
                      onClick={() => startEditAnalyte(a)}
                      className="inline-flex items-center px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-gradient-to-r from-blue-100 to-indigo-100 text-blue-700 hover:from-blue-200 hover:to-indigo-200 transition-all duration-200 shadow-sm disabled:opacity-50"
                      title="Edit value and reset to pending"
                    >
                      <svg className="h-3.5 w-3.5 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                      Edit Value
                    </button>
                    <button
                      disabled={isBusy}
                      onClick={() => sendForRerun(a.id)}
                      className="inline-flex items-center px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-gradient-to-r from-orange-100 to-amber-100 text-orange-700 hover:from-orange-200 hover:to-amber-200 transition-all duration-200 shadow-sm disabled:opacity-50"
                      title="Send back to result entry for re-run"
                    >
                      <RefreshCcw className="h-3.5 w-3.5 mr-1.5" />
                      Send for Re-run
                    </button>
                  </div>
                </div>
              ) : (
                // Pending state - show Approve and Reject
                <div className="flex items-center space-x-2">
                  <button
                    disabled={isBusy}
                    onClick={() => approveAnalyte(a.id)}
                    className="inline-flex items-center px-3 py-2 rounded-lg text-sm font-semibold bg-gradient-to-r from-green-500 to-emerald-500 text-white hover:from-green-600 hover:to-emerald-600 transition-all duration-200 shadow-sm disabled:opacity-50"
                  >
                    {isBusy ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4 mr-2" />
                    )}
                    Approve
                  </button>

                  <button
                    disabled={isBusy}
                    onClick={() => rejectAnalyte(a.id)}
                    className="inline-flex items-center px-3 py-2 rounded-lg text-sm font-semibold bg-gradient-to-r from-red-100 to-rose-100 text-red-700 hover:from-red-200 hover:to-rose-200 transition-all duration-200 shadow-sm disabled:opacity-50"
                  >
                    <XCircle className="h-4 w-4 mr-2" />
                    Reject
                  </button>
                </div>
              )}
            </div>

            {a.verify_note && (
              <div className="text-xs text-gray-500 mt-2 italic bg-gray-50 p-2 rounded border">
                Note: {a.verify_note}
              </div>
            )}
          </td>
        </tr>
        {showAISuggestion && (
          <tr>
            <td colSpan={6} className="px-4 py-2 bg-gray-50">
              <AIResultSuggestionCard
                resultValue={{
                  id: a.id,
                  analyte_name: a.parameter,
                  value: a.value || '',
                  unit: a.unit,
                  reference_range: a.reference_range,
                  flag: a.flag as 'H' | 'L' | 'C' | null,
                  ai_suggested_flag: null,
                  ai_suggested_interpretation: null,
                  trend_interpretation: null
                }}
                onApplied={async () => {
                  // Reload analytes after applying AI suggestions
                  await ensureAnalytesLoaded(a.result_id);
                }}
              />
            </td>
          </tr>
        )}
      </>
    );
  };

  const handleRunAIAnalysis = async (row: PanelRow) => {
    if (!confirm(`Run AI Flag & Range Analysis for order #${row.order_id.slice(-8)}?`)) return;

    setBusyFor(row.result_id, true);
    try {
      // Dynamic import to avoid loading AI logic unless needed
      const { runAIFlagAnalysis } = await import('../utils/aiFlagAnalysis');

      const result = await runAIFlagAnalysis(row.order_id, {
        useAIService: true, // Force AI service
        applyToDatabase: true,
        createAudit: true,
        overrideManual: false
      });

      if (result.flagsChanged > 0 || result.results.length > 0) {
        alert(`AI Analysis Completed.\nFlags Changed: ${result.flagsChanged}\nTotal Processed: ${result.totalProcessed}`);
        // Reload data
        await ensureAnalytesLoaded(row.result_id);
      } else {
        alert('AI Analysis Completed. No changes detected.');
      }
    } catch (e) {
      console.error(e);
      alert('AI Analysis failed.');
    } finally {
      setBusyFor(row.result_id, false);
    }
  };

  const PanelCard: React.FC<{ row: PanelRow }> = ({ row }) => {
    const isOpen = !!open[row.result_id];
    const analytes = rowsByResult[row.result_id] || [];
    const isSelected = selectedPanels.has(row.result_id);
    const pct = row.expected_analytes > 0
      ? Math.round((row.approved_analytes / row.expected_analytes) * 100)
      : 0;

    return (
      <div className={`border-2 rounded-2xl bg-white shadow-sm hover:shadow-lg transition-all duration-300 ${isSelected ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
        }`}>
        {/* Header */}
        <div className="p-6 border-b border-gray-100">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => togglePanelSelection(row.result_id)}
                className="w-5 h-5 rounded-md border-2 border-gray-300 text-blue-600 focus:ring-blue-500 focus:ring-2"
              />

              <div className="flex items-center space-x-4">
                <div className="bg-gradient-to-br from-blue-500 to-indigo-600 p-3 rounded-xl shadow-sm">
                  <User className="h-6 w-6 text-white" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-gray-900">
                    {row.patient_name}
                  </h3>
                  <div className="flex items-center space-x-3 text-sm text-gray-600">
                    <span className="flex items-center">
                      <Calendar className="h-4 w-4 mr-1" />
                      {fmtDate(row.order_date)}
                    </span>
                    <span className="flex items-center">
                      <FileText className="h-4 w-4 mr-1" />
                      #{row.order_id.slice(-8)}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center space-x-4">
              <div className="text-right">
                <div className="text-sm text-gray-600 mb-1">Progress</div>
                <div className="flex items-center space-x-3">
                  <div className="text-lg font-bold text-gray-900">
                    {row.approved_analytes}/{row.expected_analytes}
                  </div>
                  <div className="w-24 bg-gray-200 h-3 rounded-full overflow-hidden">
                    <div
                      className={`h-3 rounded-full transition-all duration-500 ${pct >= 100 ? 'bg-gradient-to-r from-green-500 to-emerald-500' :
                        pct >= 50 ? 'bg-gradient-to-r from-amber-500 to-orange-500' :
                          'bg-gradient-to-r from-red-500 to-rose-500'
                        }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-sm font-semibold text-gray-700">{pct}%</span>
                </div>
              </div>

              <StateBadge row={row} />

              <button
                onClick={() => toggleOpen(row)}
                className="p-3 rounded-xl hover:bg-gray-100 transition-colors"
                aria-label="Toggle panel details"
              >
                {isOpen ? (
                  <ChevronUp className="h-6 w-6 text-gray-600" />
                ) : (
                  <ChevronDown className="h-6 w-6 text-gray-600" />
                )}
              </button>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between">
            <button
              onClick={() => toggleOpen(row)}
              className="flex items-center space-x-3 p-2 -m-2 rounded-lg hover:bg-gray-50 transition-colors cursor-pointer flex-1"
              title="Click to expand/collapse test details"
            >
              <TestTube className="h-5 w-5 text-gray-500" />
              <span className="text-lg font-semibold text-gray-900">
                {row.test_group_name}
              </span>
              <span className="text-sm text-gray-500">
                ({row.expected_analytes} analytes)
              </span>
              {isOpen ? (
                <ChevronUp className="h-4 w-4 text-gray-400 ml-2" />
              ) : (
                <ChevronDown className="h-4 w-4 text-gray-400 ml-2" />
              )}
            </button>

            {!isOpen && (
              <div className="flex items-center gap-2">
                {/* Report Extras Checkboxes */}
                <div className="hidden lg:flex items-center gap-3 mr-2 px-3 py-1.5 bg-gray-50 rounded-lg border border-gray-200">
                  <label className="flex items-center gap-1.5 cursor-pointer text-xs font-medium text-gray-600 hover:text-gray-800">
                    <input
                      type="checkbox"
                      checked={includeTrendsInReport[row.order_id] ?? false}
                      onChange={(e) => setIncludeTrendsInReport(prev => ({ ...prev, [row.order_id]: e.target.checked }))}
                      className="w-3.5 h-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                    />
                    <TrendingUp className="h-3.5 w-3.5" />
                    <span>Trends</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer text-xs font-medium text-gray-600 hover:text-gray-800">
                    <input
                      type="checkbox"
                      checked={includeSummaryInReport[row.order_id] ?? false}
                      onChange={(e) => setIncludeSummaryInReport(prev => ({ ...prev, [row.order_id]: e.target.checked }))}
                      disabled={!aiClinicalSummary[row.order_id]}
                      className="w-3.5 h-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer disabled:opacity-50"
                      title={aiClinicalSummary[row.order_id] ? "Include clinical summary in report" : "Generate Doctor Summary from expanded panel first"}
                    />
                    <Stethoscope className="h-3.5 w-3.5" />
                    <span className={!aiClinicalSummary[row.order_id] ? "opacity-50" : ""}>Summary</span>
                  </label>
                </div>
                {/* Doctor Summary removed - it's at ORDER level, available in expanded panel's AIDoctorSummaryPanel component */}
                <button
                  onClick={() => {
                    setSelectedOrderForAttachments(row.order_id);
                    setShowAttachmentSelector(true);
                  }}
                  className="inline-flex items-center px-3 py-2 sm:px-4 sm:py-2 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-lg sm:rounded-xl hover:from-purple-700 hover:to-indigo-700 transition-all duration-200 shadow-sm font-semibold text-xs sm:text-sm"
                  title="Manage which attachments to include in final report"
                >
                  <FileImage className="h-4 w-4 sm:mr-2" />
                  <span className="hidden sm:inline">Manage Attachments</span>
                </button>
                <button
                  onClick={() => handleEmailReport(row)}
                  disabled={busy[row.result_id]}
                  className="inline-flex items-center px-3 py-2 sm:px-4 sm:py-2 bg-gradient-to-r from-blue-500 to-cyan-500 text-white rounded-lg sm:rounded-xl hover:from-blue-600 hover:to-cyan-600 transition-all duration-200 shadow-sm font-semibold text-xs sm:text-sm"
                  title="Email Report to Patient"
                >
                  <Mail className="h-4 w-4 sm:mr-2" />
                  <span className="hidden sm:inline">Email</span>
                </button>
                <button
                  disabled={busy[row.result_id]}
                  onClick={() => approveAllInPanel(row)}
                  className="inline-flex items-center px-3 py-2 sm:px-4 sm:py-2 bg-gradient-to-r from-green-600 to-emerald-600 text-white rounded-lg sm:rounded-xl hover:from-green-700 hover:to-emerald-700 transition-all duration-200 shadow-sm font-semibold disabled:opacity-50 text-xs sm:text-sm"
                >
                  {busy[row.result_id] ? (
                    <Loader2 className="h-4 w-4 sm:mr-2 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4 sm:mr-2" />
                  )}
                  <span className="hidden sm:inline">Approve All</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Expanded content */}
        {isOpen && (
          <div className="p-6 bg-gray-50">
            <div className="mb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="text-sm text-gray-600">
                <span className="font-semibold">Entered:</span> {row.entered_analytes} •
                <span className="font-semibold ml-2">Approved:</span> {row.approved_analytes}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {/* AI Generate Interpretations Button - Uses new system for actual values */}
                <button
                  disabled={aiIntelligence.loading || analytes.length === 0}
                  onClick={async () => {
                    try {
                      // Convert analytes to ResultValue format for AI analysis
                      const resultValues: ResultValue[] = analytes
                        .filter(a => a.value) // Only analyze analytes with values
                        .map(a => ({
                          id: a.id, // result_value ID for saving
                          analyte_id: a.id,
                          analyte_name: a.parameter,
                          value: a.value || '',
                          unit: a.unit,
                          reference_range: a.reference_range,
                          flag: a.flag as 'H' | 'L' | 'C' | null,
                        }));

                      if (resultValues.length === 0) {
                        alert('No analyte values to analyze. Please enter values first.');
                        return;
                      }

                      // Call new AI function for actual value analysis
                      const suggestions = await aiIntelligence.generateResultValueSuggestions(
                        resultValues,
                        undefined // patient context - could be added
                      );

                      if (suggestions.length > 0) {
                        setAiResultSuggestions(prev => ({ ...prev, [row.result_id]: suggestions }));
                        setInterpretationsTargetResultId(row.result_id);
                        setShowInterpretationsModal(true);
                      } else {
                        alert('No suggestions generated. Please try again.');
                      }
                    } catch (error) {
                      console.error('AI Interpretations failed:', error);
                      alert('Failed to generate interpretations: ' + (error instanceof Error ? error.message : 'Unknown error'));
                    }
                  }}
                  className="inline-flex items-center px-4 py-2 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-lg hover:from-amber-600 hover:to-orange-600 transition-all duration-200 shadow-sm font-medium text-sm disabled:opacity-50"
                  title="Generate AI flag and interpretation for actual result values"
                >
                  {aiIntelligence.loading ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Zap className="h-4 w-4 mr-2" />
                  )}
                  AI Interpretations
                </button>

                {/* AI Flag & Range Analysis Button - MANUAL TRIGGER */}
                <button
                  disabled={!!busy[row.result_id]}
                  onClick={() => handleRunAIAnalysis(row)}
                  className="inline-flex items-center px-4 py-2 bg-gradient-to-r from-purple-500 to-indigo-500 text-white rounded-lg hover:from-purple-600 hover:to-indigo-600 transition-all duration-200 shadow-sm font-medium text-sm disabled:opacity-50"
                  title="Run Full AI Analysis (Ranges & Flags)"
                >
                  {busy[row.result_id] ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4 mr-2" />
                  )}
                  AI Range & Flag
                </button>

                {/* AI Verifier Summary Button */}
                <button
                  disabled={aiIntelligence.loading || analytes.length === 0}
                  onClick={async () => {
                    try {
                      const testGroup = {
                        test_group_name: row.test_group_name || 'Unknown',
                        test_group_code: row.test_group_id || '',
                        category: 'General',
                      };
                      const resultValues = analytes.map(a => ({
                        analyte_name: a.parameter,
                        value: a.value || '',
                        unit: a.unit,
                        reference_range: a.reference_range,
                        flag: a.flag as 'H' | 'L' | 'C' | null,
                      }));
                      const summary = await aiIntelligence.getVerifierSummary(testGroup, resultValues);
                      setAiVerifierSummary(prev => ({ ...prev, [row.result_id]: summary }));
                      setAiSummaryTarget({ type: 'verifier', resultId: row.result_id });
                      setShowAiSummaryModal(true);
                    } catch (error) {
                      console.error('AI Summary failed:', error);
                      alert('Failed to generate AI summary: ' + (error instanceof Error ? error.message : 'Unknown error'));
                    }
                  }}
                  className="inline-flex items-center px-4 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-lg hover:from-purple-700 hover:to-indigo-700 transition-all duration-200 shadow-sm font-medium text-sm disabled:opacity-50"
                  title="Get AI-powered summary for verification"
                >
                  {aiIntelligence.loading ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4 mr-2" />
                  )}
                  AI Summary
                </button>

                <button
                  disabled={busy[row.result_id]}
                  onClick={() => approveAllInPanel(row)}
                  className="inline-flex items-center px-6 py-3 bg-gradient-to-r from-green-600 to-emerald-600 text-white rounded-xl hover:from-green-700 hover:to-emerald-700 transition-all duration-200 shadow-lg font-semibold disabled:opacity-50"
                >
                  {busy[row.result_id] ? (
                    <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-5 w-5 mr-2" />
                  )}
                  Approve All Analytes
                </button>
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              <table className="min-w-full">
                <thead className="bg-gradient-to-r from-gray-50 to-gray-100">
                  <tr>
                    <th className="px-4 py-4 text-left text-sm font-bold text-gray-700 uppercase tracking-wider">
                      Analyte
                    </th>
                    <th className="px-4 py-4 text-left text-sm font-bold text-gray-700 uppercase tracking-wider">
                      Value
                    </th>
                    <th className="px-4 py-4 text-left text-sm font-bold text-gray-700 uppercase tracking-wider">
                      Unit
                    </th>
                    <th className="px-4 py-4 text-left text-sm font-bold text-gray-700 uppercase tracking-wider">
                      Reference Range
                    </th>
                    <th className="px-4 py-4 text-left text-sm font-bold text-gray-700 uppercase tracking-wider">
                      Flag
                    </th>
                    <th className="px-4 py-4 text-left text-sm font-bold text-gray-700 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {analytes.map((a) => (
                    <AnalyteRowView key={a.id} a={a} patientId={row.patient_id} />
                  ))}
                </tbody>
              </table>
            </div>

            {/* Attachments section */}
            <div className="mt-6 bg-white rounded-xl shadow-sm border border-gray-200">
              <div className="px-6 py-4 border-b border-gray-200">
                <div className="flex items-center justify-between">
                  <h4 className="text-lg font-semibold text-gray-900 flex items-center">
                    <FileText className="h-5 w-5 mr-2 text-blue-600" />
                    Attachments
                    {attachmentsByOrder[row.order_id] && (
                      <span className="ml-2 text-sm bg-blue-100 text-blue-800 px-2 py-1 rounded-full">
                        {attachmentsByOrder[row.order_id].length}
                      </span>
                    )}
                  </h4>
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => setAttachmentViewMode('test')}
                      className={`text-xs px-3 py-1 rounded-full transition-colors ${attachmentViewMode === 'test'
                        ? 'bg-blue-100 text-blue-700 font-medium'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                    >
                      Test Only
                      {attachmentsByOrder[row.order_id] && (
                        <span className="ml-1 text-xs">
                          ({attachmentsByOrder[row.order_id].filter(a => a.level === 'test').length})
                        </span>
                      )}
                    </button>
                    <button
                      onClick={() => setAttachmentViewMode('all')}
                      className={`text-xs px-3 py-1 rounded-full transition-colors ${attachmentViewMode === 'all'
                        ? 'bg-blue-100 text-blue-700 font-medium'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                    >
                      All
                      {attachmentsByOrder[row.order_id] && (
                        <span className="ml-1 text-xs">
                          ({attachmentsByOrder[row.order_id].length})
                        </span>
                      )}
                    </button>
                  </div>
                </div>
              </div>
              <div className="p-6">
                <AttachmentViewer
                  attachments={attachmentsByOrder[row.order_id] || []}
                  viewMode={attachmentViewMode}
                />
              </div>
            </div>

            {/* AI Trend Graphs Section */}
            <div className="mt-6">
              <TrendGraphPanel
                orderId={row.order_id}
                patientId={row.patient_id}
                analyteIds={analytes.filter(a => a.analyte_id).map(a => a.analyte_id)}
                analyteNames={analytes.map(a => a.parameter)}
                includeInReport={includeTrendsInReport[row.order_id] ?? false}
                onIncludeInReportChange={(include) => {
                  setIncludeTrendsInReport(prev => ({ ...prev, [row.order_id]: include }));
                }}
                onSaved={() => {
                  // Auto-enable include in report when trends are saved
                  setIncludeTrendsInReport(prev => ({ ...prev, [row.order_id]: true }));
                }}
              />
            </div>

            {/* Report Sections Editor (PBS/Radiology findings, impressions, etc.) */}
            {row.test_group_id && (
              <div className="mt-6">
                <SectionEditor
                  resultId={row.result_id}
                  testGroupId={row.test_group_id}
                  onSave={() => {
                    console.log('Section content saved for result:', row.result_id);
                  }}
                />
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  /* ----------------- Date Preset Functions ----------------- */
  const setDateRange = (days: number) => {
    const to = new Date();
    const from = new Date();
    from.setDate(to.getDate() - days);

    setTo(to.toISOString().split('T')[0]);
    setFrom(from.toISOString().split('T')[0]);
  };

  const setToday = () => {
    const today = new Date().toISOString().split('T')[0];
    setFrom(today);
    setTo(today);
  };

  /* ----------------- Trend Modal Component ----------------- */
  const TrendModal: React.FC = () => {
    if (!showTrendModal || !selectedAnalyteTrend) return null;

    const cacheKey = `${selectedAnalyteTrend.patientId}-${selectedAnalyteTrend.parameter}`;
    const trends = trendData[cacheKey] || [];

    return ReactDOM.createPortal(
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden">
          <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-4 flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <TrendingUp className="h-6 w-6 text-white" />
              <h3 className="text-xl font-bold text-white">
                Trend: {selectedAnalyteTrend.parameter}
              </h3>
            </div>
            <button
              onClick={() => setShowTrendModal(false)}
              className="text-white hover:bg-white hover:bg-opacity-20 rounded-full p-2 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="p-6 overflow-y-auto max-h-[calc(90vh-80px)]">
            {trends.length === 0 ? (
              <div className="text-center py-12">
                <Activity className="h-16 w-16 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-500 text-lg">No historical data available</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-4">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-gray-600 font-medium">Total Records:</span>
                      <span className="ml-2 text-gray-900 font-bold">{trends.length}</span>
                    </div>
                    <div>
                      <span className="text-gray-600 font-medium">Date Range:</span>
                      <span className="ml-2 text-gray-900 font-bold">
                        {trends.length > 0 && fmtDate(trends[trends.length - 1].order_date)} - {trends.length > 0 && fmtDate(trends[0].order_date)}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <table className="min-w-full">
                    <thead className="bg-gradient-to-r from-gray-50 to-gray-100">
                      <tr>
                        <th className="px-4 py-3 text-left text-sm font-bold text-gray-700 uppercase">
                          Order Date
                        </th>
                        <th className="px-4 py-3 text-left text-sm font-bold text-gray-700 uppercase">
                          Test Name
                        </th>
                        <th className="px-4 py-3 text-left text-sm font-bold text-gray-700 uppercase">
                          Value
                        </th>
                        <th className="px-4 py-3 text-left text-sm font-bold text-gray-700 uppercase">
                          Unit
                        </th>
                        <th className="px-4 py-3 text-left text-sm font-bold text-gray-700 uppercase">
                          Range
                        </th>
                        <th className="px-4 py-3 text-left text-sm font-bold text-gray-700 uppercase">
                          Flag
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {trends.map((trend, idx) => {
                        const isLatest = idx === 0;
                        return (
                          <tr
                            key={idx}
                            className={`${isLatest ? 'bg-blue-50 font-semibold' : 'hover:bg-gray-50'
                              } transition-colors`}
                          >
                            <td className="px-4 py-3 text-sm text-gray-900">
                              {fmtDate(trend.order_date)}
                              {isLatest && (
                                <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-800">
                                  Latest
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-700">
                              {trend.test_name}
                            </td>
                            <td className="px-4 py-3">
                              <span className="text-lg font-bold text-gray-900">
                                {trend.value}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-sm font-medium text-gray-700">
                              {trend.unit}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-600">
                              {trend.reference_range}
                            </td>
                            <td className="px-4 py-3">
                              {trend.flag && (
                                <span
                                  className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-bold ${trend.flag === 'H' || trend.flag === 'Critical'
                                    ? 'bg-red-100 text-red-800'
                                    : trend.flag === 'L'
                                      ? 'bg-blue-100 text-blue-800'
                                      : 'bg-orange-100 text-orange-800'
                                    }`}
                                >
                                  {trend.flag}
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>,
      document.body
    );
  };

  /* ----------------- AI Summary Modal Component ----------------- */
  const AISummaryModal: React.FC = () => {
    if (!showAiSummaryModal || !aiSummaryTarget) return null;

    const isVerifier = aiSummaryTarget.type === 'verifier';
    const summary = isVerifier && aiSummaryTarget.resultId
      ? aiVerifierSummary[aiSummaryTarget.resultId]
      : (aiSummaryTarget.orderId ? aiClinicalSummary[aiSummaryTarget.orderId] : null);

    if (!summary) return null;

    const getRecommendationColor = (rec: string) => {
      switch (rec) {
        case 'approve': return 'bg-green-100 text-green-800 border-green-300';
        case 'needs_clarification': return 'bg-amber-100 text-amber-800 border-amber-300';
        case 'reject': return 'bg-red-100 text-red-800 border-red-300';
        default: return 'bg-gray-100 text-gray-800 border-gray-300';
      }
    };

    return ReactDOM.createPortal(
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden">
          <div className="bg-gradient-to-r from-purple-600 to-indigo-600 px-6 py-4 flex items-center justify-between">
            <div className="flex items-center space-x-3">
              {isVerifier ? (
                <ClipboardList className="h-6 w-6 text-white" />
              ) : (
                <Stethoscope className="h-6 w-6 text-white" />
              )}
              <h3 className="text-xl font-bold text-white">
                {isVerifier ? 'AI Verifier Summary' : 'Clinical Summary for Doctor'}
              </h3>
            </div>
            <button
              onClick={() => {
                setShowAiSummaryModal(false);
                setAiSummaryTarget(null);
              }}
              className="text-white hover:bg-white hover:bg-opacity-20 rounded-full p-2 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="p-6 overflow-y-auto max-h-[calc(90vh-80px)]">
            {isVerifier && 'overall_assessment' in summary ? (
              // Verifier Summary
              <div className="space-y-6">
                {/* Overall Assessment */}
                <div className="bg-gradient-to-r from-purple-50 to-indigo-50 rounded-xl p-4 border border-purple-200">
                  <h4 className="font-semibold text-purple-900 mb-2 flex items-center">
                    <Sparkles className="h-5 w-5 mr-2" />
                    Overall Assessment
                  </h4>
                  <p className="text-gray-800">{(summary as VerifierSummaryResponse).overall_assessment}</p>
                </div>

                {/* Recommendation */}
                <div className={`rounded-xl p-4 border-2 ${getRecommendationColor((summary as VerifierSummaryResponse).recommendation)}`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-semibold mb-1">AI Recommendation</h4>
                      <span className="text-lg font-bold capitalize">
                        {(summary as VerifierSummaryResponse).recommendation.replace('_', ' ')}
                      </span>
                    </div>
                    {(summary as VerifierSummaryResponse).recommendation === 'approve' && (
                      <CheckCircle2 className="h-8 w-8 text-green-600" />
                    )}
                    {(summary as VerifierSummaryResponse).recommendation === 'needs_clarification' && (
                      <AlertTriangle className="h-8 w-8 text-amber-600" />
                    )}
                    {(summary as VerifierSummaryResponse).recommendation === 'reject' && (
                      <XCircle className="h-8 w-8 text-red-600" />
                    )}
                  </div>
                  <p className="text-sm mt-2 opacity-80">{(summary as VerifierSummaryResponse).recommendation_reason}</p>
                </div>

                {/* Abnormal Findings */}
                {(summary as VerifierSummaryResponse).abnormal_findings.length > 0 && (
                  <div className="bg-amber-50 rounded-xl p-4 border border-amber-200">
                    <h4 className="font-semibold text-amber-900 mb-3 flex items-center">
                      <AlertTriangle className="h-5 w-5 mr-2" />
                      Abnormal Findings
                    </h4>
                    <ul className="space-y-2">
                      {(summary as VerifierSummaryResponse).abnormal_findings.map((finding, idx) => (
                        <li key={idx} className="flex items-start text-gray-800">
                          <span className="inline-block w-2 h-2 bg-amber-500 rounded-full mt-2 mr-3 flex-shrink-0" />
                          {finding}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Critical Alerts */}
                {(summary as VerifierSummaryResponse).critical_alerts.length > 0 && (
                  <div className="bg-red-50 rounded-xl p-4 border border-red-200">
                    <h4 className="font-semibold text-red-900 mb-3 flex items-center">
                      <AlertCircle className="h-5 w-5 mr-2" />
                      Critical Alerts
                    </h4>
                    <ul className="space-y-2">
                      {(summary as VerifierSummaryResponse).critical_alerts.map((alert, idx) => (
                        <li key={idx} className="flex items-start text-red-800 font-medium">
                          <span className="inline-block w-2 h-2 bg-red-500 rounded-full mt-2 mr-3 flex-shrink-0" />
                          {alert}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Verifier Notes */}
                {(summary as VerifierSummaryResponse).verifier_notes && (
                  <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                    <h4 className="font-semibold text-gray-700 mb-2">Additional Notes</h4>
                    <p className="text-gray-600 text-sm">{(summary as VerifierSummaryResponse).verifier_notes}</p>
                  </div>
                )}
              </div>
            ) : (
              // Clinical Summary
              <div className="space-y-6">
                {/* Executive Summary */}
                <div className="bg-gradient-to-r from-blue-50 to-cyan-50 rounded-xl p-4 border border-blue-200">
                  <h4 className="font-semibold text-blue-900 mb-2 flex items-center">
                    <Stethoscope className="h-5 w-5 mr-2" />
                    Executive Summary
                  </h4>
                  <p className="text-gray-800">{(summary as ClinicalSummaryResponse).executive_summary}</p>
                </div>

                {/* Significant Findings */}
                {(summary as ClinicalSummaryResponse).significant_findings.length > 0 && (
                  <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                    <div className="bg-gray-50 px-4 py-3 border-b">
                      <h4 className="font-semibold text-gray-900">Significant Findings</h4>
                    </div>
                    <div className="divide-y">
                      {(summary as ClinicalSummaryResponse).significant_findings.map((finding, idx) => (
                        <div key={idx} className="p-4">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <p className="font-medium text-gray-900">{finding.finding}</p>
                              <p className="text-sm text-gray-600 mt-1">{finding.clinical_significance}</p>
                            </div>
                            <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded-full ml-3">
                              {finding.test_group}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Clinical Interpretation */}
                <div className="bg-purple-50 rounded-xl p-4 border border-purple-200">
                  <h4 className="font-semibold text-purple-900 mb-2">Clinical Interpretation</h4>
                  <p className="text-gray-800 whitespace-pre-wrap">{(summary as ClinicalSummaryResponse).clinical_interpretation}</p>
                </div>

                {/* Urgent Findings */}
                {(summary as ClinicalSummaryResponse).urgent_findings.length > 0 && (
                  <div className="bg-red-50 rounded-xl p-4 border border-red-200">
                    <h4 className="font-semibold text-red-900 mb-3 flex items-center">
                      <AlertCircle className="h-5 w-5 mr-2" />
                      Urgent Findings
                    </h4>
                    <ul className="space-y-2">
                      {(summary as ClinicalSummaryResponse).urgent_findings.map((finding, idx) => (
                        <li key={idx} className="flex items-start text-red-800 font-medium">
                          <span className="inline-block w-2 h-2 bg-red-500 rounded-full mt-2 mr-3 flex-shrink-0" />
                          {finding}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Suggested Follow-up */}
                {(summary as ClinicalSummaryResponse).suggested_followup.length > 0 && (
                  <div className="bg-green-50 rounded-xl p-4 border border-green-200">
                    <h4 className="font-semibold text-green-900 mb-3">Suggested Follow-up</h4>
                    <ul className="space-y-2">
                      {(summary as ClinicalSummaryResponse).suggested_followup.map((item, idx) => (
                        <li key={idx} className="flex items-start text-gray-800">
                          <span className="inline-block w-2 h-2 bg-green-500 rounded-full mt-2 mr-3 flex-shrink-0" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer with Copy Button */}
          <div className="border-t bg-gray-50 px-6 py-4 flex items-center justify-between">
            <p className="text-sm text-gray-600">
              {isVerifier ? (
                <>
                  <ClipboardList className="h-4 w-4 inline mr-1 text-purple-500" />
                  AI-generated verification summary for internal review
                </>
              ) : (
                <>
                  <Stethoscope className="h-4 w-4 inline mr-1 text-cyan-500" />
                  AI-generated clinical summary for referring physician
                </>
              )}
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  setShowAiSummaryModal(false);
                  setAiSummaryTarget(null);
                }}
                className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors font-medium"
              >
                Close
              </button>
              <button
                onClick={() => {
                  // Format summary for clipboard
                  let text = '';
                  if (isVerifier && 'overall_assessment' in summary) {
                    const vs = summary as VerifierSummaryResponse;
                    text = `VERIFIER SUMMARY\n\n`;
                    text += `Overall Assessment:\n${vs.overall_assessment}\n\n`;
                    text += `Recommendation: ${vs.recommendation.replace('_', ' ').toUpperCase()}\n`;
                    text += `Reason: ${vs.recommendation_reason}\n\n`;
                    if (vs.abnormal_findings.length > 0) {
                      text += `Abnormal Findings:\n${vs.abnormal_findings.map(f => `• ${f}`).join('\n')}\n\n`;
                    }
                    if (vs.critical_alerts.length > 0) {
                      text += `Critical Alerts:\n${vs.critical_alerts.map(a => `• ${a}`).join('\n')}\n\n`;
                    }
                    if (vs.verifier_notes) {
                      text += `Notes: ${vs.verifier_notes}\n`;
                    }
                  } else {
                    const cs = summary as ClinicalSummaryResponse;
                    text = `CLINICAL SUMMARY FOR REFERRING PHYSICIAN\n\n`;
                    text += `Executive Summary:\n${cs.executive_summary}\n\n`;
                    text += `Clinical Interpretation:\n${cs.clinical_interpretation}\n\n`;
                    if (cs.significant_findings.length > 0) {
                      text += `Significant Findings:\n${cs.significant_findings.map(f => `• ${f.finding} (${f.test_group})\n  Clinical Significance: ${f.clinical_significance}`).join('\n')}\n\n`;
                    }
                    if (cs.urgent_findings.length > 0) {
                      text += `URGENT FINDINGS:\n${cs.urgent_findings.map(f => `⚠️ ${f}`).join('\n')}\n\n`;
                    }
                    if (cs.suggested_followup.length > 0) {
                      text += `Suggested Follow-up:\n${cs.suggested_followup.map(s => `• ${s}`).join('\n')}\n`;
                    }
                  }
                  navigator.clipboard.writeText(text).then(() => {
                    alert('Summary copied to clipboard!');
                  }).catch(() => {
                    alert('Failed to copy to clipboard');
                  });
                }}
                className="inline-flex items-center px-6 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-lg hover:from-blue-700 hover:to-indigo-700 transition-all duration-200 shadow-sm font-semibold"
              >
                <FileText className="h-5 w-5 mr-2" />
                Copy to Clipboard
              </button>
            </div>
          </div>
        </div>
      </div>,
      document.body
    );
  };

  /* ----------------- AI Interpretations Modal Component (New: Actual Value Analysis) ----------------- */
  const AIInterpretationsModal: React.FC = () => {
    const [saving, setSaving] = useState(false);

    if (!showInterpretationsModal || !interpretationsTargetResultId) return null;

    // Get AI suggestions for actual result values
    const suggestions = aiResultSuggestions[interpretationsTargetResultId] || [];

    const handleSaveToDb = async () => {
      if (suggestions.length === 0) {
        alert('No suggestions to save.');
        return;
      }

      setSaving(true);
      try {
        // Save AI suggestions to result_values table (also updates the actual flag column)
        const result = await aiIntelligence.saveResultValueSuggestions(suggestions, true);

        if (result.success > 0) {
          alert(`Successfully saved interpretations for ${result.success} analyte(s)!${result.failed > 0 ? ` (${result.failed} failed)` : ''}\n\nThe flags have been updated.`);

          // Clear the cached analytes for this result to force reload
          const targetResultId = interpretationsTargetResultId;
          setRowsByResult(prev => {
            const newState = { ...prev };
            delete newState[targetResultId];
            return newState;
          });

          setShowInterpretationsModal(false);
          setInterpretationsTargetResultId(null);

          // Reload panels to show updated flags
          await loadPanels();
        } else {
          alert('Failed to save interpretations. Please try again.');
        }
      } catch (error) {
        console.error('Failed to save interpretations:', error);
        alert('Failed to save interpretations: ' + (error instanceof Error ? error.message : 'Unknown error'));
      } finally {
        setSaving(false);
      }
    };

    // Helper to get flag color
    const getFlagColor = (flag: string | null | undefined) => {
      switch (flag) {
        case 'H': return 'bg-red-100 text-red-800 border-red-200';
        case 'L': return 'bg-blue-100 text-blue-800 border-blue-200';
        case 'C': return 'bg-purple-100 text-purple-800 border-purple-200';
        case 'N': return 'bg-green-100 text-green-800 border-green-200';
        default: return 'bg-gray-100 text-gray-600 border-gray-200';
      }
    };

    const getFlagLabel = (flag: string | null | undefined) => {
      switch (flag) {
        case 'H': return 'High';
        case 'L': return 'Low';
        case 'C': return 'Critical';
        case 'N': return 'Normal';
        default: return 'Unknown';
      }
    };

    return ReactDOM.createPortal(
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-2xl shadow-2xl max-w-5xl w-full max-h-[90vh] overflow-hidden">
          <div className="bg-gradient-to-r from-amber-500 to-orange-500 px-6 py-4 flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <Zap className="h-6 w-6 text-white" />
              <h3 className="text-xl font-bold text-white">
                AI-Generated Interpretations
              </h3>
              <span className="bg-white bg-opacity-20 px-2 py-1 rounded-full text-sm text-white">
                {suggestions.length} analytes
              </span>
            </div>
            <button
              onClick={() => {
                setShowInterpretationsModal(false);
                setInterpretationsTargetResultId(null);
              }}
              className="text-white hover:bg-white hover:bg-opacity-20 rounded-full p-2 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="p-6 overflow-y-auto max-h-[calc(90vh-160px)]">
            {suggestions.length === 0 ? (
              <div className="text-center py-12">
                <CheckCircle2 className="h-16 w-16 text-green-300 mx-auto mb-4" />
                <p className="text-gray-500 text-lg">No suggestions available.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {suggestions.map((suggestion, idx) => (
                  <div key={suggestion.id || idx} className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="font-bold text-gray-900 flex items-center">
                        <Activity className="h-5 w-5 mr-2 text-amber-600" />
                        {suggestion.analyte_name}
                      </h4>
                      <div className="flex items-center gap-3">
                        <span className="text-sm text-gray-500">
                          Value: <strong className="text-gray-900">{suggestion.value} {suggestion.unit}</strong>
                        </span>
                        <span className="text-sm text-gray-500">
                          Ref: {suggestion.reference_range}
                        </span>
                      </div>
                    </div>

                    <div className="grid md:grid-cols-2 gap-4">
                      {/* AI Suggested Flag */}
                      <div className={`rounded-lg p-3 border ${getFlagColor(suggestion.ai_suggested_flag)}`}>
                        <div className="text-xs font-semibold uppercase mb-1 flex items-center">
                          <Target className="h-3 w-3 mr-1" />
                          AI Suggested Flag
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-lg font-bold">
                            {suggestion.ai_suggested_flag || 'N'}
                          </span>
                          <span className="text-sm">
                            ({getFlagLabel(suggestion.ai_suggested_flag)})
                          </span>
                        </div>
                      </div>

                      {/* Current Flag Comparison */}
                      <div className="bg-white rounded-lg p-3 border border-gray-200">
                        <div className="text-xs font-semibold text-gray-500 uppercase mb-1 flex items-center">
                          <ShieldCheck className="h-3 w-3 mr-1" />
                          Current Flag
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`text-lg font-bold ${suggestion.flag ? 'text-gray-900' : 'text-gray-400'}`}>
                            {suggestion.flag || '-'}
                          </span>
                          {suggestion.flag !== suggestion.ai_suggested_flag && suggestion.ai_suggested_flag && (
                            <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded">
                              Differs from AI
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* AI Interpretation */}
                    {suggestion.ai_suggested_interpretation && (
                      <div className="mt-3 bg-white rounded-lg p-4 border border-gray-200">
                        <div className="text-xs font-semibold text-gray-500 uppercase mb-2 flex items-center">
                          <Stethoscope className="h-3 w-3 mr-1" />
                          AI Clinical Interpretation
                        </div>
                        <p className="text-sm text-gray-700 leading-relaxed">
                          {suggestion.ai_suggested_interpretation}
                        </p>
                      </div>
                    )}

                    {/* Trend Interpretation (if available) */}
                    {suggestion.trend_interpretation && (
                      <div className="mt-3 bg-blue-50 rounded-lg p-4 border border-blue-200">
                        <div className="text-xs font-semibold text-blue-700 uppercase mb-2 flex items-center">
                          <TrendingUp className="h-3 w-3 mr-1" />
                          Trend Analysis
                        </div>
                        <p className="text-sm text-blue-800">
                          {suggestion.trend_interpretation}
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer with Save Button */}
          {suggestions.length > 0 && (
            <div className="border-t bg-gray-50 px-6 py-4 flex items-center justify-between">
              <p className="text-sm text-gray-600">
                <AlertCircle className="h-4 w-4 inline mr-1 text-amber-500" />
                Review the AI suggestions above before saving to result_values.
              </p>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => {
                    setShowInterpretationsModal(false);
                    setInterpretationsTargetResultId(null);
                  }}
                  className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveToDb}
                  disabled={saving}
                  className="inline-flex items-center px-6 py-2 bg-gradient-to-r from-green-600 to-emerald-600 text-white rounded-lg hover:from-green-700 hover:to-emerald-700 transition-all duration-200 shadow-sm font-semibold disabled:opacity-50"
                >
                  {saving ? (
                    <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-5 w-5 mr-2" />
                  )}
                  Save to Database
                </button>
              </div>
            </div>
          )}
        </div>
      </div>,
      document.body
    );
  };

  if (viewMode === "order") {
    return <OrderVerificationView onBackToPanel={() => setViewMode("panel")} />;
  }

  /* ----------------- Render ----------------- */

  return (
    <div className="bg-gradient-to-br from-gray-50 to-blue-50">
      {/* Modern Header */}
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
            <div>
              <h1 className="text-4xl font-bold text-gray-900 mb-2">
                Result Verification Console
              </h1>
              <p className="text-lg text-gray-600">
                High-performance analyte verification with intelligent workflows
              </p>
              <div className="flex items-center space-x-4 mt-3">
                <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800">
                  <Activity className="h-4 w-4 mr-2" />
                  Real-time Processing
                </span>
                <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-purple-100 text-purple-800">
                  <Target className="h-4 w-4 mr-2" />
                  Batch Operations
                </span>
              </div>
            </div>

            <div className="flex items-center space-x-4">
              <div className="flex items-center bg-gray-100 rounded-full p-1">
                <button
                  onClick={() => setViewMode("panel")}
                  className={`px-4 py-2 text-sm font-semibold rounded-full transition-colors ${viewMode === "panel" ? "bg-white shadow text-blue-600" : "text-gray-600"}`}
                >
                  Panel View
                </button>
                <button
                  onClick={() => setViewMode("order")}
                  className={`px-4 py-2 text-sm font-semibold rounded-full transition-colors ${viewMode === "order" ? "bg-white shadow text-blue-600" : "text-gray-600"}`}
                >
                  Order View
                </button>
              </div>
              <button
                onClick={loadPanels}
                className="inline-flex items-center px-6 py-3 bg-white border-2 border-gray-300 rounded-xl hover:border-gray-400 hover:shadow-md transition-all duration-200 font-semibold"
                title="Refresh data"
              >
                <RefreshCcw className={`h-5 w-5 mr-2 ${loading ? "animate-spin text-blue-600" : "text-gray-600"}`} />
                Refresh
              </button>

              {selectedPanels.size > 0 && (
                <button
                  onClick={bulkApproveSelected}
                  disabled={bulkProcessing}
                  className="inline-flex items-center px-6 py-3 bg-gradient-to-r from-green-600 to-emerald-600 text-white rounded-xl hover:from-green-700 hover:to-emerald-700 transition-all duration-200 shadow-lg font-semibold disabled:opacity-50"
                >
                  {bulkProcessing ? (
                    <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                  ) : (
                    <Zap className="h-5 w-5 mr-2" />
                  )}
                  Bulk Approve ({selectedPanels.size})
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        {/* Statistics Dashboard */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <StatsBadge
            icon={BarChart3}
            label="Total Panels"
            value={stats.total}
            color="text-blue-600"
            bgColor="bg-gradient-to-br from-blue-50 to-indigo-100"
            onClick={() => setStateFilter('all')}
          />
          <StatsBadge
            icon={CheckCircle2}
            label="Verified"
            value={stats.ready}
            color="text-green-600"
            bgColor="bg-gradient-to-br from-green-50 to-emerald-100"
            onClick={() => setStateFilter('ready')}
          />
          <StatsBadge
            icon={Clock}
            label="Partial"
            value={stats.partial}
            color="text-amber-600"
            bgColor="bg-gradient-to-br from-amber-50 to-orange-100"
            onClick={() => setStateFilter('partial')}
          />
          <StatsBadge
            icon={AlertTriangle}
            label="Pending"
            value={stats.pending}
            color="text-red-600"
            bgColor="bg-gradient-to-br from-red-50 to-rose-100"
            onClick={() => setStateFilter('pending')}
          />
        </div>

        {/* Enhanced Filters */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="p-6 border-b border-gray-100">
            <div className="flex flex-col lg:flex-row gap-4">
              {/* Search Bar */}
              <div className="flex-1 relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search patients, tests, or order IDs..."
                  className="w-full pl-12 pr-4 py-4 text-lg border-2 border-gray-200 rounded-xl focus:border-blue-500 focus:ring-4 focus:ring-blue-100 transition-all duration-200"
                />
                {q && (
                  <button
                    onClick={() => setQ('')}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    <X className="h-5 w-5" />
                  </button>
                )}
              </div>

              {/* Quick Filters */}
              <div className="flex items-center space-x-3">
                <select
                  value={stateFilter}
                  onChange={(e) => setStateFilter(e.target.value as StateFilter)}
                  className="px-4 py-4 border-2 border-gray-200 rounded-xl focus:border-blue-500 focus:ring-4 focus:ring-blue-100 text-lg font-medium"
                >
                  <option value="all">All Status</option>
                  <option value="pending">Pending Only</option>
                  <option value="partial">Partial Only</option>
                  <option value="ready">Verified Only</option>
                </select>

                <button
                  onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
                  className={`inline-flex items-center px-4 py-4 border-2 rounded-xl transition-all duration-200 font-semibold ${showAdvancedFilters
                    ? 'bg-blue-100 border-blue-300 text-blue-700'
                    : 'border-gray-300 text-gray-700 hover:border-gray-400 hover:bg-gray-50'
                    }`}
                >
                  <FilterIcon className="h-5 w-5 mr-2" />
                  Advanced
                  {showAdvancedFilters ? (
                    <ChevronUp className="h-4 w-4 ml-2" />
                  ) : (
                    <ChevronDown className="h-4 w-4 ml-2" />
                  )}
                </button>
              </div>
            </div>

            {/* Advanced Filters Panel */}
            {showAdvancedFilters && (
              <div className="mt-6 pt-6 border-t border-gray-100">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-3">Date Range</label>
                    <div className="space-y-3">
                      <div className="flex items-center space-x-2">
                        <Calendar className="h-4 w-4 text-gray-500" />
                        <input
                          type="date"
                          value={from}
                          onChange={(e) => setFrom(e.target.value)}
                          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                      </div>
                      <div className="text-center text-gray-500 text-sm">to</div>
                      <div className="flex items-center space-x-2">
                        <Calendar className="h-4 w-4 text-gray-500" />
                        <input
                          type="date"
                          value={to}
                          onChange={(e) => setTo(e.target.value)}
                          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-3">Quick Presets</label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={setToday}
                        className="px-3 py-2 text-sm bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 transition-colors font-medium"
                      >
                        Today
                      </button>
                      <button
                        onClick={() => setDateRange(7)}
                        className="px-3 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors font-medium"
                      >
                        7 Days
                      </button>
                      <button
                        onClick={() => setDateRange(30)}
                        className="px-3 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors font-medium"
                      >
                        30 Days
                      </button>
                      <button
                        onClick={() => setDateRange(90)}
                        className="px-3 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors font-medium"
                      >
                        90 Days
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-3">Bulk Actions</label>
                    <div className="space-y-2">
                      <button
                        onClick={selectAllPanels}
                        disabled={filteredPanels.length === 0}
                        className="w-full px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-50"
                      >
                        Select All ({filteredPanels.length})
                      </button>
                      <button
                        onClick={clearSelection}
                        disabled={selectedPanels.size === 0}
                        className="w-full px-4 py-2 text-sm border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium disabled:opacity-50"
                      >
                        Clear Selection
                      </button>
                      <button
                        onClick={() => {
                          if (selectedPanels.size === 1) {
                            const resultId = Array.from(selectedPanels)[0];
                            const panel = panels.find(p => p.result_id === resultId);
                            if (panel) {
                              setSelectedOrderForAttachments(panel.order_id);
                              setShowAttachmentSelector(true);
                            }
                          } else {
                            alert('Please select exactly one panel to manage attachments');
                          }
                        }}
                        disabled={selectedPanels.size !== 1}
                        className="w-full px-4 py-2 text-sm border-2 border-purple-300 bg-purple-50 text-purple-700 rounded-lg hover:bg-purple-100 hover:border-purple-400 transition-colors font-medium disabled:opacity-50 flex items-center justify-center gap-2"
                      >
                        <FileImage className="h-4 w-4" />
                        Manage Report Attachments
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Selection Summary */}
        {selectedPanels.size > 0 && (
          <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-2xl p-6 text-white shadow-lg">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <div className="bg-white/20 p-3 rounded-xl">
                  <CheckSquare className="h-6 w-6" />
                </div>
                <div>
                  <div className="text-xl font-bold">
                    {selectedPanels.size} panel{selectedPanels.size !== 1 ? 's' : ''} selected
                  </div>
                  <div className="text-blue-100">
                    Ready for bulk verification operations
                  </div>
                </div>
              </div>
              <div className="flex items-center space-x-3">
                <button
                  onClick={clearSelection}
                  className="px-4 py-2 bg-white/20 text-white rounded-lg hover:bg-white/30 transition-colors font-medium"
                >
                  Clear
                </button>
                <button
                  onClick={bulkApproveSelected}
                  disabled={bulkProcessing}
                  className="px-6 py-3 bg-white text-blue-600 rounded-xl hover:bg-gray-50 transition-colors font-bold shadow-sm disabled:opacity-50"
                >
                  {bulkProcessing ? (
                    <Loader2 className="h-5 w-5 mr-2 animate-spin inline" />
                  ) : (
                    <Zap className="h-5 w-5 mr-2 inline" />
                  )}
                  Approve Selected
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Error Display */}
        {err && (
          <div className="bg-red-50 border-2 border-red-200 rounded-2xl p-6">
            <div className="flex items-center">
              <AlertTriangle className="h-6 w-6 text-red-600 mr-3" />
              <div>
                <h3 className="text-lg font-semibold text-red-900">Error Loading Data</h3>
                <p className="text-red-700">{err}</p>
              </div>
            </div>
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div className="space-y-6">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="bg-white rounded-2xl border border-gray-200 p-6 animate-pulse">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center space-x-4">
                    <div className="w-12 h-12 bg-gray-200 rounded-xl"></div>
                    <div className="space-y-2">
                      <div className="h-6 bg-gray-200 rounded w-48"></div>
                      <div className="h-4 bg-gray-200 rounded w-32"></div>
                    </div>
                  </div>
                  <div className="h-8 w-24 bg-gray-200 rounded-full"></div>
                </div>
                <div className="h-4 bg-gray-200 rounded w-full"></div>
              </div>
            ))}
          </div>
        )}

        {/* Empty State */}
        {!loading && filteredPanels.length === 0 && (
          <div className="bg-white rounded-2xl border-2 border-dashed border-gray-300 p-12 text-center">
            <div className="mx-auto w-24 h-24 bg-gray-100 rounded-full flex items-center justify-center mb-6">
              <TestTube className="w-12 h-12 text-gray-400" />
            </div>
            <h3 className="text-2xl font-bold text-gray-900 mb-3">No Results Found</h3>
            <p className="text-gray-600 mb-6 max-w-md mx-auto text-lg">
              No verification results match your current filters for the selected date range.
            </p>
            <div className="flex justify-center space-x-4">
              <button
                onClick={() => {
                  setQ('');
                  setStateFilter('all');
                  setShowAdvancedFilters(false);
                }}
                className="px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors font-semibold"
              >
                Clear All Filters
              </button>
              <button
                onClick={loadPanels}
                className="px-6 py-3 border-2 border-gray-300 text-gray-700 rounded-xl hover:border-gray-400 hover:bg-gray-50 transition-colors font-semibold"
              >
                Refresh Data
              </button>
            </div>
          </div>
        )}

        {/* Results Grid */}
        {!loading && filteredPanels.length > 0 && (
          <div className="space-y-6">
            {/* Results Header */}
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold text-gray-900">
                  Verification Queue
                </h2>
                <p className="text-gray-600 mt-1">
                  {filteredPanels.length} panel{filteredPanels.length !== 1 ? 's' : ''} found
                </p>
              </div>

              {selectedPanels.size === 0 && (
                <div className="flex items-center space-x-2 text-sm text-gray-500">
                  <span>Select panels for bulk operations</span>
                  <ChevronRight className="h-4 w-4" />
                </div>
              )}
            </div>

            {/* Panel Cards */}
            <div className="space-y-6">
              {filteredPanels.map((row) => (
                <PanelCard key={row.result_id} row={row} />
              ))}
            </div>
          </div>
        )}

        {/* Modern Footer */}
        <div className="bg-gradient-to-r from-gray-900 to-gray-800 rounded-2xl p-6 text-white shadow-xl">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center space-x-6">
              <div className="flex items-center">
                <TrendingUp className="h-5 w-5 mr-2 text-blue-400" />
                <span className="font-semibold">
                  Performance: {stats.ready > 0 ? Math.round((stats.ready / stats.total) * 100) : 0}% verified
                </span>
              </div>
              <div className="flex items-center">
                <Clock className="h-5 w-5 mr-2 text-green-400" />
                <span className="font-semibold">
                  Date Range: {fmtDate(from)} - {fmtDate(to)}
                </span>
              </div>
            </div>
            <div className="text-sm text-gray-300">
              Last updated: {new Date().toLocaleTimeString()}
            </div>
          </div>
        </div>
      </div>

      {/* Trend Modal */}
      <TrendModal />

      {/* AI Summary Modal */}
      <AISummaryModal />

      {/* AI Interpretations Modal */}
      <AIInterpretationsModal />

      {/* Attachment Selector Modal */}
      {showAttachmentSelector && selectedOrderForAttachments && (
        <AttachmentSelector
          orderId={selectedOrderForAttachments}
          onClose={() => {
            setShowAttachmentSelector(false);
            setSelectedOrderForAttachments(null);
          }}
          onSave={() => {
            // Reload attachments after save
            if (selectedOrderForAttachments) {
              setAttachmentsByOrder(prev => {
                const updated = { ...prev };
                delete updated[selectedOrderForAttachments];
                return updated;
              });
              loadAttachments(selectedOrderForAttachments);
            }
          }}
        />
      )}
    </div>
  );
};

export default ResultVerificationConsole;