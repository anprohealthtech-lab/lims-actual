import React from "react";
import { TestTube, FlaskConical, ShieldCheck, FileText, FileCheck, Send, Paperclip, Brain, IndianRupee, Eye } from "lucide-react";
import { DashboardOrderRow } from "@/types/dashboard";

type Props = {
  row: DashboardOrderRow;
  onView?: (id: string) => void;
  onApprove?: (id: string) => void;
  onGenerate?: (id: string) => void;
  onSend?: (id: string) => void;
  onPayments?: (id: string) => void;
  onAttachments?: (id: string) => void;
  onAIConsole?: (id: string) => void;
};

const IconStrip: React.FC<Props> = ({ row, onView, onApprove, onGenerate, onSend, onPayments, onAttachments, onAIConsole }) => {
  const chip = (n: number) => (
    <span className="inline-flex min-w-[1.5rem] items-center justify-center rounded-md border bg-gray-100 px-1.5 py-0.5 text-[11px] leading-none">
      {n}
    </span>
  );

  const iconButtonClass = "inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded-md px-1.5 py-1 text-gray-600 transition hover:bg-gray-100";

  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5 text-gray-600 sm:gap-2">
      <button title={row.sample_collected_at ? "Sample collected" : "Sample pending"} className={iconButtonClass}>
        <TestTube className={`h-4 w-4 ${row.sample_collected_at ? "text-green-600" : "text-gray-400"}`} />
      </button>
      <span title={`${row.entered_total}/${row.expected_total} entered`} className="inline-flex min-h-[36px] items-center gap-1 rounded-md px-1.5 py-1 hover:bg-gray-100">
        <FlaskConical className="h-4 w-4 shrink-0" />
        <span className="inline-flex items-center gap-1 leading-none">
          {chip(row.entered_total)}
          <span className="text-xs text-gray-400">/</span>
          {chip(row.expected_total)}
        </span>
      </span>
      <button title={row.all_verified ? "All verified" : "Verification pending"} onClick={() => onApprove?.(row.order_id)} className={iconButtonClass}>
        <ShieldCheck className={`h-4 w-4 ${row.all_verified ? "text-green-600" : "text-amber-600"}`} />
      </button>
      <button title={row.report_pdf_ready ? "Report ready" : "Generate report"} onClick={() => (row.report_pdf_ready ? onView?.(row.order_id) : onGenerate?.(row.order_id))} className={iconButtonClass}>
        {row.report_pdf_ready ? <FileCheck className="h-4 w-4 text-blue-600" /> : <FileText className="h-4 w-4" />}
      </button>
      <button title="Send report" onClick={() => onSend?.(row.order_id)} className={iconButtonClass}>
        <Send className={`h-4 w-4 ${row.report_pdf_ready ? "text-indigo-600" : "text-gray-300"}`} />
      </button>
      <button title="Attachments" onClick={() => onAttachments?.(row.order_id)} className="inline-flex min-h-[36px] items-center gap-1 rounded-md px-1.5 py-1 hover:bg-gray-100">
        <Paperclip className="h-4 w-4" />
        {chip(row.attachments_count)}
      </button>
      <button title={row.ai_used ? "AI used" : "Open AI console"} onClick={() => onAIConsole?.(row.order_id)} className={iconButtonClass}>
        <Brain className={`h-4 w-4 ${row.ai_used ? "text-purple-600" : ""}`} />
      </button>
      <button title={`Balance: Rs ${row.balance_due ?? 0}`} onClick={() => onPayments?.(row.order_id)} className={iconButtonClass}>
        <IndianRupee className={`h-4 w-4 ${(row.balance_due ?? 0) > 0 ? "text-red-600" : "text-green-600"}`} />
      </button>
      <button title="View details" onClick={() => onView?.(row.order_id)} className={iconButtonClass}>
        <Eye className="h-4 w-4" />
      </button>
    </div>
  );
};

export default IconStrip;
