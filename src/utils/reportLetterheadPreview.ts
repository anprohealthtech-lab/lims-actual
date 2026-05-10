import { database, supabase } from "./supabase";
import {
  createReportDataFromContext,
  prepareReportHtml,
  preparePDFBundle,
  selectTemplateForContext,
} from "./pdfService";
import type { LabTemplateRecord } from "./supabase";

const DEFAULT_LAYOUT = {
  margins: {
    top: 180,
    right: 20,
    bottom: 150,
    left: 20,
  },
};

const PRINT_LAYOUT = {
  margins: {
    top: 180,
    right: 20,
    bottom: 150,
    left: 20,
  },
};

type ReportPreviewMode = "ecopy" | "print";

const injectPreviewStyles = (
  htmlDocument: string,
  options: {
    mode: ReportPreviewMode;
    letterheadUrl?: string | null;
    margins: { top: number; right: number; bottom: number; left: number };
  },
): string => {
  const { mode, letterheadUrl, margins } = options;
  const useLetterheadBackground = mode === "ecopy" && !!letterheadUrl;
  const pageBackground = letterheadUrl
    && useLetterheadBackground
    ? `
      .limsv2-report {
        background-image: url('${letterheadUrl}');
        background-repeat: repeat-y;
        background-position: top center;
        background-size: 210mm 297mm;
      }
    `
    : "";

  const previewCss = `
    <style id="report-letterhead-preview">
      html, body {
        margin: 0;
        padding: 0;
        background: #d1d5db;
        min-height: 100%;
      }

      body {
        position: relative;
      }

	      .limsv2-report {
	        position: relative;
	        width: 210mm;
	        min-height: 297mm;
	        margin: 0 auto;
	        background: #ffffff;
	        box-shadow: 0 18px 38px rgba(15, 23, 42, 0.15);
	        ${useLetterheadBackground ? "" : "background-image: none;"}
	      }

	      ${pageBackground}

	      .limsv2-report-body,
      .report-region,
      .report-region--body {
        background: transparent !important;
      }

	      .limsv2-report-body,
	      .limsv2-report-body--pdf {
	        padding-top: ${margins.top}px !important;
	        padding-right: ${margins.right}px !important;
	        padding-bottom: ${margins.bottom}px !important;
	        padding-left: ${margins.left}px !important;
	      }

        ${
          mode === "print"
            ? `
	      .limsv2-report,
	      .limsv2-report-header,
	      .limsv2-report-footer,
	      .limsv2-report-body,
	      .limsv2-report-body--pdf,
	      .report-region,
	      .report-region--body,
	      .test-group-section,
	      .result-table,
	      th,
	      td {
	        background: #ffffff !important;
	        background-color: transparent !important;
	        background-image: none !important;
	      }

	      .limsv2-report {
	        color: #000000 !important;
	      }

	      .limsv2-report h1,
	      .limsv2-report h2,
	      .limsv2-report h3,
	      .limsv2-report h4,
	      .limsv2-report h5,
	      .limsv2-report h6,
	      .limsv2-report p,
	      .limsv2-report span,
	      .limsv2-report td,
	      .limsv2-report th {
	        color: #000000 !important;
	      }

	      .limsv2-report img[data-role="watermark"],
	      .limsv2-report img[data-role="logo"],
	      .limsv2-report .lab-header-branding,
	      .limsv2-report .lab-footer-branding,
	      .limsv2-report .digital-only {
	        display: none !important;
	      }
            `
            : ""
        }

	      @media print {
	        html, body {
	          background: #ffffff !important;
	        }

        .limsv2-report {
          width: auto;
          min-height: auto;
          margin: 0;
          box-shadow: none;
        }
      }
    </style>
  `;

  if (htmlDocument.includes("</head>")) {
    return htmlDocument.replace("</head>", `${previewCss}</head>`);
  }

  return `${previewCss}${htmlDocument}`;
};

export interface ReportLetterheadPreviewResult {
  html: string;
  isDraft: boolean;
}

export const buildReportLetterheadPreview = async (
  orderId: string,
  options: { mode?: ReportPreviewMode } = {},
): Promise<ReportLetterheadPreviewResult> => {
  const mode = options.mode ?? "ecopy";
  const { data: context, error } = await database.reports.getTemplateContext(orderId);
  if (error || !context) {
    throw new Error("Could not load report data for preview");
  }

  const isDraft = context.meta?.allAnalytesApproved !== true;

  let templates: LabTemplateRecord[] = [];
  let selectedTemplate: LabTemplateRecord | null = null;

  try {
    const { data: templateData, error: templateError } = await database.labTemplates.list();
    if (templateError) {
      console.warn("Unable to load lab templates for preview:", templateError);
    } else if (Array.isArray(templateData) && templateData.length > 0) {
      templates = templateData as LabTemplateRecord[];
      selectedTemplate = selectTemplateForContext(templates, context);
    }
  } catch (templateFetchError) {
    console.warn("Unexpected error fetching lab templates for preview:", templateFetchError);
  }

  const reportData = createReportDataFromContext(context, {
    template: selectedTemplate,
    isDraft,
  });

  const previewHtml = mode === "print"
    ? (
      await prepareReportHtml(reportData, isDraft, templates, true)
    ).html
    : (await preparePDFBundle(orderId, reportData, isDraft, templates)).html;

  const [labRes, brandingRes] = await Promise.all([
    context.labId
      ? supabase
          .from("labs")
          .select("pdf_layout_settings")
          .eq("id", context.labId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    context.labId
      ? supabase
          .from("lab_branding_assets")
          .select("file_url, imagekit_url, variants")
          .eq("lab_id", context.labId)
          .eq("asset_type", "letterhead")
          .eq("is_default", true)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  const layoutSettings = (labRes.data as any)?.pdf_layout_settings || {};
  const margins = {
    ...(mode === "print" ? PRINT_LAYOUT.margins : DEFAULT_LAYOUT.margins),
    ...(mode === "ecopy" ? (layoutSettings?.margins || {}) : {}),
  };

  const brandingData = brandingRes.data as any;
  const letterheadUrl =
    brandingData?.imagekit_url ||
    brandingData?.variants?.optimized ||
    brandingData?.variants?.optimized_url ||
    brandingData?.file_url ||
    null;

  return {
    html: injectPreviewStyles(previewHtml, {
      mode,
      letterheadUrl: mode === "ecopy" ? letterheadUrl : null,
      margins,
    }),
    isDraft,
  };
};
