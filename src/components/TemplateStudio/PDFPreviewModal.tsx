import React, { useEffect, useState } from 'react';
import { Eye, Printer, Monitor, X, Loader2, ChevronLeft, ChevronRight, Download } from 'lucide-react';
import clsx from 'clsx';
import { supabase } from '../../utils/supabase';

interface PDFPreviewModalProps {
  open: boolean;
  onClose: () => void;
  htmlContent: string;
  cssContent: string;
  labId: string;
}

type PreviewMode = 'ecopy' | 'print';

interface LabPdfSettings {
  letterheadUrl?: string | null;
  margins?: {
    top: number;
    bottom: number;
    left: number;
    right: number;
  };
  headerHeight?: number;
  footerHeight?: number;
}

// Default PDF settings matching the edge function
const DEFAULT_PDF_SETTINGS = {
  margins: { top: 130, bottom: 130, left: 20, right: 20 },
  headerHeight: 90,
  footerHeight: 80,
};

// Baseline CSS from the PDF edge function
const BASELINE_CSS = `
:root {
  --report-font-family: "Inter", "Noto Sans", Arial, sans-serif;
  --report-text-color: #1f2937;
  --report-muted-color: #4b5563;
  --report-heading-color: #111827;
  --report-border-color: #d1d5db;
  --report-accent-color: #2563eb;
  --report-background-color: #ffffff;
}

.limsv2-report {
  position: relative;
  font-family: var(--report-font-family);
  color: var(--report-text-color);
  background-color: var(--report-background-color);
  font-size: 14px;
  line-height: 1.6;
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

.limsv2-report * {
  box-sizing: border-box;
}

.limsv2-report-body {
  padding: 15px 20px;
  position: relative;
  z-index: 2;
}

.limsv2-report-body--pdf {
  padding: 0 20px;
}

/* Typography */
.limsv2-report h1, .limsv2-report h2, .limsv2-report h3,
.limsv2-report h4, .limsv2-report h5, .limsv2-report h6 {
  font-family: var(--report-font-family);
  color: var(--report-heading-color);
  margin: 0 0 0.25rem;
  line-height: 1.3;
}

.limsv2-report h1 { font-size: 2rem; }
.limsv2-report h2 { font-size: 1.5rem; }
.limsv2-report h3 { font-size: 1.25rem; }
.limsv2-report h4 { font-size: 1.1rem; }

.limsv2-report p {
  margin: 0 0 0.5rem;
  color: var(--report-text-color);
}

/* Tables */
.limsv2-report table {
  width: 100%;
  border-collapse: collapse;
  margin: 0.75rem 0;
  font-size: 0.95rem;
}

.limsv2-report table thead th {
  background-color: #f1f5f9;
  color: var(--report-heading-color);
}

.limsv2-report table th,
.limsv2-report table td {
  border: 1px solid var(--report-border-color);
  padding: 10px 12px;
  text-align: left;
  vertical-align: top;
}

.limsv2-report table tbody tr:nth-child(even) {
  background-color: #f8fafc;
}

/* Flags */
.result-abnormal, .abnormal, .flag-abnormal {
  color: #dc2626;
  font-weight: bold;
}

.flag-high, .flag-H {
  color: #dc2626;
  font-weight: bold;
}

.flag-low, .flag-L {
  color: #2563eb;
  font-weight: bold;
}

.flag-critical, .flag-C {
  color: #dc2626;
  font-weight: bold;
  background-color: #fef2f2;
}

.flag-normal, .flag-N {
  color: #059669;
}

/* Report structure */
.report-container {
  width: 100%;
}

.report-header h1 {
  color: #0b4aa2;
  font-size: 1.5rem;
  margin-bottom: 0.25rem;
}

.report-subtitle {
  color: #64748b;
  font-size: 0.875rem;
}

.section-header {
  background: #0b4aa2;
  color: white;
  font-weight: bold;
  padding: 8px 12px;
  margin: 1rem 0 0.5rem;
}

.patient-info, .report-table, .tbl-results, .tbl-interpretation {
  width: 100%;
  border-collapse: collapse;
  border: 1px solid #e5ecf6;
  border-radius: 10px;
  overflow: hidden;
  background: #fff;
}

.patient-info td, .report-table td, .tbl-results td, .tbl-interpretation td {
  border: 1px solid #e5ecf6;
  padding: 10px 12px;
  font-size: 13px;
}

.report-table thead th, .tbl-results thead th, .tbl-interpretation thead th {
  font-weight: 600;
  padding: 10px 12px;
}

.note {
  margin-top: 14px;
  padding: 12px 14px;
  border-left: 4px solid #0b4aa2;
  background: #f8fafc;
  font-size: 13px;
  font-style: italic;
}

.signatures {
  margin-top: 2rem;
  text-align: right;
}

/* Method name (test methodology) */
.method-name {
  display: block;
  font-size: 0.75rem;
  font-weight: 400;
  color: rgba(255, 255, 255, 0.85);
  margin-top: 2px;
  font-style: italic;
}

/* Page break helpers */
.page-break {
  page-break-before: always;
  break-before: page;
}

.avoid-break {
  break-inside: avoid;
  page-break-inside: avoid;
}
`;

// ── Dummy value injection for preview ────────────────────────────────────────

const DUMMY_PATIENT: Record<string, string> = {
  patientName:         'Anand Priyadarshi',
  patientId:           'LB-2026-00142',
  patientAge:          '35Y',
  patientGender:       'Male',
  collectionDate:      '17-Mar-2026',
  orderDate:           '17-Mar-2026',
  registrationDate:    '17-Mar-2026',
  reportDate:          '17-Mar-2026 02:07 PM',
  sampleId:            'SMPL-2026-00142',
  referringDoctorName: 'Dr. A. Sharma',
  approvedAt:          '17-Mar-2026 02:07 PM',
  patientPhone:        '+91 98765 43210',
  sampleCollectedBy:   'Ravi Kumar',
  orderId:             'ORD-2026-00142',
  orderDate2:          '17-Mar-2026',
  patientDob:          '15-Jun-1990',
  patientAddress:      '123, Sample Street, City',
  labName:             'City Diagnostics Lab',
  signatoryName:       'Dr. Signatory Name',
  signatoryDesignation:'MD Pathology',
  approverName:        'Dr. Approver',
};

// Known analyte code → realistic value mapping
const KNOWN_ANALYTE_VALUES: Record<string, { value: string; unit: string; range: string; flag: string }> = {
  HGB:         { value: '14.5', unit: 'g/dL',   range: '13.5–17.5',    flag: '' },
  HB:          { value: '14.5', unit: 'g/dL',   range: '13.5–17.5',    flag: '' },
  HEMOGLOBIN:  { value: '14.5', unit: 'g/dL',   range: '13.5–17.5',    flag: '' },
  HAEMOGLOBIN: { value: '14.5', unit: 'g/dL',   range: '13.5–17.5',    flag: '' },
  HCT:         { value: '43.2', unit: '%',       range: '42–52',        flag: '' },
  HAEMATOCRIT: { value: '43.2', unit: '%',       range: '42–52',        flag: '' },
  HEMATOCRIT:  { value: '43.2', unit: '%',       range: '42–52',        flag: '' },
  RBC:         { value: '4.80', unit: '10⁶/µL', range: '4.5–5.9',      flag: '' },
  WBC:         { value: '7400', unit: '/cmm',    range: '4000–10500',   flag: '' },
  TLC:         { value: '7400', unit: '/cmm',    range: '4000–10500',   flag: '' },
  PLT:         { value: '230000', unit: '/cmm',  range: '150000–450000',flag: '' },
  PLATELET:    { value: '230000', unit: '/cmm',  range: '150000–450000',flag: '' },
  MCV:         { value: '87.0', unit: 'fL',      range: '78–100',       flag: '' },
  MCH:         { value: '29.0', unit: 'pg',      range: '27–31',        flag: '' },
  MCHC:        { value: '33.5', unit: 'g/dL',   range: '32–36',        flag: '' },
  RDWCV:       { value: '13.2', unit: '%',       range: '11.5–14.0',    flag: '' },
  RDW:         { value: '13.2', unit: '%',       range: '11.5–14.0',    flag: '' },
  NEUT:        { value: '65',   unit: '%',       range: '50–80',        flag: '' },
  NEUTROPHILS: { value: '65',   unit: '%',       range: '50–80',        flag: '' },
  LYMPH:       { value: '28',   unit: '%',       range: '25–50',        flag: '' },
  LYMPHOCYTES: { value: '28',   unit: '%',       range: '25–50',        flag: '' },
  MONO:        { value: '5',    unit: '%',       range: '2–10',         flag: '' },
  MONOCYTES:   { value: '5',    unit: '%',       range: '2–10',         flag: '' },
  EOS:         { value: '2',    unit: '%',       range: '0.0–5.0',      flag: '' },
  EOSINOPHILS: { value: '2',    unit: '%',       range: '0.0–5.0',      flag: '' },
  BASO:        { value: '0',    unit: '%',       range: '0–2',          flag: '' },
  BASOPHILS:   { value: '0',    unit: '%',       range: '0–2',          flag: '' },
  ESR:         { value: '8',    unit: 'mm/hr',   range: '0–13',         flag: '' },
  CRP:         { value: '0.4',  unit: 'mg/L',    range: '< 5.0',        flag: '' },
  GLUCOSE:     { value: '92',   unit: 'mg/dL',   range: '70–100',       flag: '' },
  UREA:        { value: '28',   unit: 'mg/dL',   range: '15–45',        flag: '' },
  CREATININE:  { value: '0.9',  unit: 'mg/dL',   range: '0.7–1.2',      flag: '' },
  SODIUM:      { value: '140',  unit: 'mEq/L',   range: '135–145',      flag: '' },
  POTASSIUM:   { value: '4.2',  unit: 'mEq/L',   range: '3.5–5.0',      flag: '' },
  TSH:         { value: '2.10', unit: 'µIU/mL',  range: '0.5–5.0',      flag: '' },
  T3:          { value: '1.2',  unit: 'ng/mL',   range: '0.8–2.0',      flag: '' },
  T4:          { value: '8.5',  unit: 'µg/dL',   range: '5.0–12.0',     flag: '' },
  FT3:         { value: '3.1',  unit: 'pg/mL',   range: '2.3–4.2',      flag: '' },
  FT4:         { value: '1.2',  unit: 'ng/dL',   range: '0.8–1.8',      flag: '' },
  BILI:        { value: '0.8',  unit: 'mg/dL',   range: '0.2–1.2',      flag: '' },
  SGOT:        { value: '30',   unit: 'U/L',     range: '10–40',        flag: '' },
  AST:         { value: '30',   unit: 'U/L',     range: '10–40',        flag: '' },
  SGPT:        { value: '28',   unit: 'U/L',     range: '7–56',         flag: '' },
  ALT:         { value: '28',   unit: 'U/L',     range: '7–56',         flag: '' },
  ALP:         { value: '72',   unit: 'U/L',     range: '40–130',       flag: '' },
  URICACID:    { value: '5.4',  unit: 'mg/dL',   range: '3.5–7.2',      flag: '' },
  UA:          { value: '5.4',  unit: 'mg/dL',   range: '3.5–7.2',      flag: '' },
  CHOL:        { value: '180',  unit: 'mg/dL',   range: '< 200',        flag: '' },
  CHOLESTEROL: { value: '180',  unit: 'mg/dL',   range: '< 200',        flag: '' },
  HDL:         { value: '52',   unit: 'mg/dL',   range: '> 40',         flag: '' },
  LDL:         { value: '110',  unit: 'mg/dL',   range: '< 130',        flag: '' },
  TG:          { value: '130',  unit: 'mg/dL',   range: '< 150',        flag: '' },
  TRIGLYCERIDES:{ value: '130', unit: 'mg/dL',   range: '< 150',        flag: '' },
};

// Qualitative / morphology analytes → descriptive dummy
const QUALITATIVE_SUFFIXES = ['MORPHOLOGY', 'APPEARANCE', 'COLOUR', 'COLOR', 'REACTION', 'CAST', 'RESULT', 'RESULTS'];
const QUALITATIVE_DUMMY = 'Normal';

function injectDummyValues(html: string): string {
  return html.replace(/\{\{([^}]+)\}\}/g, (_match, key: string) => {
    const k = key.trim();

    // 1. Known patient/order fields
    if (DUMMY_PATIENT[k]) return DUMMY_PATIENT[k];

    // 2. Custom patient fields → generic dummy
    if (k.startsWith('custom_')) return 'N/A';

    // 3. Section content blocks → collapse to empty
    if (k.startsWith('section:')) return '';

    // 4. Analyte placeholders: ANALYTE_<CODE>_<SUFFIX>
    const analyteMatch = k.match(/^ANALYTE_(.+?)_(VALUE|UNIT|REFERENCE|REF_RANGE|RANGE|FLAG|FLAG_RAW|FLAG_CLASS|VALUE_CLASS|FLAG_TEXT|DISPLAYFLAG|METHOD|NOTE)$/);
    if (analyteMatch) {
      const code = analyteMatch[1];
      const suffix = analyteMatch[2];
      const known = KNOWN_ANALYTE_VALUES[code] || KNOWN_ANALYTE_VALUES[code.replace(/_/g, '')];
      switch (suffix) {
        case 'VALUE':       return known ? known.value : '12.5';
        case 'UNIT':        return known ? known.unit  : 'units';
        case 'REFERENCE':
        case 'REF_RANGE':
        case 'RANGE':       return known ? known.range : '10.0–15.0';
        case 'FLAG':        return known ? known.flag  : '';
        case 'FLAG_RAW':    return '';
        case 'FLAG_CLASS':  return '';
        case 'VALUE_CLASS': return '';
        case 'FLAG_TEXT':   return '';
        case 'DISPLAYFLAG': return '';
        case 'METHOD':      return '';
        case 'NOTE':        return '';
      }
    }

    // 4b. Slug-style analyte placeholders: <AnalyteName>_VALUE etc. (no ANALYTE_ prefix)
    const slugMatch = k.match(/^(.+?)_(VALUE|UNIT|REFERENCE|REF_RANGE|FLAG|FLAG_RAW|FLAG_CLASS|VALUE_CLASS|FLAG_TEXT|DISPLAYFLAG|METHOD|NOTE)$/);
    if (slugMatch) {
      const code = slugMatch[1].toUpperCase().replace(/[^A-Z0-9]/g, '');
      const suffix = slugMatch[2];
      const known = KNOWN_ANALYTE_VALUES[code];
      switch (suffix) {
        case 'VALUE':       return known ? known.value : '12.5';
        case 'UNIT':        return known ? known.unit  : 'units';
        case 'REFERENCE':
        case 'REF_RANGE':   return known ? known.range : '10.0–15.0';
        case 'FLAG':        return known ? known.flag  : '';
        default:            return '';
      }
    }

    // 5. Any remaining ANALYTE_* with qualitative suffixes
    if (QUALITATIVE_SUFFIXES.some(s => k.endsWith(`_${s}`))) return QUALITATIVE_DUMMY;

    // 6. Fallback: leave visually clean — show the key name in muted style
    return `<span style="color:#aaa;font-style:italic;">[${k}]</span>`;
  });
}

// ─────────────────────────────────────────────────────────────────────────────

const PDFPreviewModal: React.FC<PDFPreviewModalProps> = ({
  open,
  onClose,
  htmlContent,
  cssContent,
  labId,
}) => {
  const [mode, setMode] = useState<PreviewMode>('ecopy');
  const [settings, setSettings] = useState<LabPdfSettings>({});
  const [loading, setLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const handleDownload = () => {
    const margins = settings.margins || DEFAULT_PDF_SETTINGS.margins;
    const topSpacer = mode === 'ecopy' ? margins.top : 20;
    const bottomSpacer = mode === 'ecopy' ? margins.bottom : 20;
    const letterheadBg = mode === 'ecopy' && settings.letterheadUrl
      ? `background-image: url('${settings.letterheadUrl}'); background-size: 210mm 297mm; background-repeat: no-repeat; background-position: top left;`
      : '';

    const fullHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Report Preview</title>
  <style>
    @page { size: A4; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; width: 210mm; }
    body {
      position: relative;
      ${letterheadBg}
    }
    .content-wrap {
      padding: ${topSpacer}px ${margins.right}px ${bottomSpacer}px ${margins.left}px;
    }
    ${BASELINE_CSS}
    ${cssContent || ''}
  </style>
</head>
<body>
  <div class="content-wrap">
    ${injectDummyValues(htmlContent)}
  </div>
  <script>window.onload = function(){ window.print(); }<\/script>
</body>
</html>`;

    const blob = new Blob([fullHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, '_blank');
    if (win) {
      win.onafterprint = () => URL.revokeObjectURL(url);
    }
  };

  // Fetch lab letterhead and PDF settings
  useEffect(() => {
    if (!open || !labId) return;

    const fetchSettings = async () => {
      setLoading(true);
      try {
        // Fetch lab branding assets for letterhead
        const { data: brandingData } = await supabase
          .from('lab_branding_assets')
          .select('asset_type, file_url, imagekit_url')
          .eq('lab_id', labId)
          .eq('asset_type', 'letterhead')
          .eq('is_active', true)
          .single();

        // Fetch lab settings for PDF margins
        const { data: labData } = await supabase
          .from('labs')
          .select('pdf_settings')
          .eq('id', labId)
          .single();

        const letterheadUrl = brandingData?.imagekit_url || brandingData?.file_url || null;
        const pdfSettings = labData?.pdf_settings || {};

        setSettings({
          letterheadUrl,
          margins: pdfSettings.margins || DEFAULT_PDF_SETTINGS.margins,
          headerHeight: pdfSettings.headerHeight || DEFAULT_PDF_SETTINGS.headerHeight,
          footerHeight: pdfSettings.footerHeight || DEFAULT_PDF_SETTINGS.footerHeight,
        });
      } catch (err) {
        console.error('Failed to fetch PDF settings:', err);
        setSettings({
          margins: DEFAULT_PDF_SETTINGS.margins,
        });
      } finally {
        setLoading(false);
      }
    };

    fetchSettings();
  }, [open, labId]);

  // Calculate pages based on content height
  useEffect(() => {
    if (!open) return;
    // Simple estimation: A4 is ~297mm, with margins ~1000px content area
    // This is a rough estimate - actual pagination would need measuring
    const contentLength = htmlContent.length;
    const estimatedPages = Math.max(1, Math.ceil(contentLength / 8000));
    setTotalPages(estimatedPages);
    setCurrentPage(1);
  }, [open, htmlContent]);

  if (!open) return null;

  const margins = settings.margins || DEFAULT_PDF_SETTINGS.margins;
  const topSpacer = mode === 'ecopy' ? margins.top : 20;
  const bottomSpacer = mode === 'ecopy' ? margins.bottom : 20;

  // Build the preview HTML with proper structure
  const buildPreviewHtml = () => {
    const letterheadStyles = mode === 'ecopy' && settings.letterheadUrl ? `
      #page-bg {
        position: absolute;
        top: 0;
        left: 0;
        width: 210mm;
        height: 297mm;
        z-index: 0;
        pointer-events: none;
        background-image: url('${settings.letterheadUrl}');
        background-repeat: no-repeat;
        background-position: top left;
        background-size: 210mm 297mm;
      }

      .limsv2-report,
      .limsv2-report-body,
      .report-container,
      .report-body,
      .report-region,
      .report-header {
        background: transparent !important;
      }

      .patient-info,
      .report-table,
      .tbl-meta,
      .tbl-results,
      .tbl-interpretation {
        background: rgba(255, 255, 255, 0.92) !important;
      }
    ` : '';

    const wrappedContent = mode === 'ecopy' && settings.letterheadUrl ? `
      <div id="page-bg"></div>
      <table style="width: 100%; border: none; border-collapse: collapse;">
        <thead style="display: table-header-group;">
          <tr>
            <td style="border: none; padding: 0;">
              <div style="height: ${topSpacer}px;"></div>
            </td>
          </tr>
        </thead>
        <tfoot style="display: table-footer-group;">
          <tr>
            <td style="border: none; padding: 0;">
              <div style="height: ${bottomSpacer}px;"></div>
            </td>
          </tr>
        </tfoot>
        <tbody>
          <tr>
            <td style="border: none; padding: 0;">
              <div class="limsv2-report">
                <main class="limsv2-report-body limsv2-report-body--pdf">${htmlContent}</main>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    ` : `
      <div class="limsv2-report" style="padding: ${topSpacer}px ${margins.right}px ${bottomSpacer}px ${margins.left}px;">
        <main class="limsv2-report-body">${htmlContent}</main>
      </div>
    `;

    return `
      <style>
        ${BASELINE_CSS}
        ${cssContent || ''}
        ${letterheadStyles}

        /* Preview-specific styles */
        * { box-sizing: border-box; }
        body { margin: 0; padding: 0; }

        /* Page break visualization */
        .page-break {
          border-top: 2px dashed #ef4444;
          margin: 20px 0;
          position: relative;
        }
        .page-break::before {
          content: 'PAGE BREAK';
          position: absolute;
          top: -10px;
          left: 50%;
          transform: translateX(-50%);
          background: #ef4444;
          color: white;
          padding: 2px 8px;
          font-size: 10px;
          border-radius: 4px;
        }
      </style>
      ${wrappedContent}
    `;
  };

  return (
    <div className="fixed inset-0 z-[200000] flex items-center justify-center bg-black/70 px-4">
      <div className="flex h-[95vh] w-full max-w-7xl flex-col rounded-xl bg-white shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4 bg-gray-50">
          <div className="flex items-center gap-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-orange-500 to-red-600">
              <Eye className="h-5 w-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">PDF Preview</h2>
              <p className="text-sm text-gray-500">
                Preview exactly how your template will render in PDF
              </p>
            </div>
          </div>

          {/* Mode Toggle */}
          <div className="flex items-center gap-2 bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => setMode('ecopy')}
              className={clsx(
                'flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all',
                mode === 'ecopy'
                  ? 'bg-white text-blue-700 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              )}
            >
              <Monitor className="h-4 w-4" />
              E-Copy (with Letterhead)
            </button>
            <button
              onClick={() => setMode('print')}
              className={clsx(
                'flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all',
                mode === 'print'
                  ? 'bg-white text-blue-700 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              )}
            >
              <Printer className="h-4 w-4" />
              Print (No Letterhead)
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleDownload}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors"
              title="Opens print dialog — choose 'Save as PDF' to download A4"
            >
              <Download className="h-4 w-4" />
              Download PDF
            </button>
            <button
              onClick={onClose}
              className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Info Bar */}
        <div className="px-6 py-3 bg-blue-50 border-b border-blue-100 flex items-center justify-between">
          <div className="flex items-center gap-6 text-sm">
            <span className="bg-amber-100 text-amber-700 px-2 py-0.5 rounded font-medium text-xs">
              Sample Data
            </span>
            <span className="text-blue-700">
              <strong>Mode:</strong> {mode === 'ecopy' ? 'E-Copy (Digital)' : 'Print Version'}
            </span>
            <span className="text-blue-700">
              <strong>Top Margin:</strong> {topSpacer}px
            </span>
            <span className="text-blue-700">
              <strong>Bottom Margin:</strong> {bottomSpacer}px
            </span>
            {mode === 'ecopy' && (
              <span className={settings.letterheadUrl ? 'text-green-700' : 'text-amber-700'}>
                <strong>Letterhead:</strong> {settings.letterheadUrl ? 'Loaded' : 'Not configured'}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage <= 1}
              className="p-1 rounded hover:bg-blue-100 disabled:opacity-50"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm text-blue-700">
              Page {currentPage} of {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages}
              className="p-1 rounded hover:bg-blue-100 disabled:opacity-50"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Preview Content */}
        <div className="flex-1 overflow-auto bg-gray-200 p-8">
          {loading ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
              <span className="ml-2 text-gray-500">Loading settings...</span>
            </div>
          ) : (
            <div className="flex justify-center">
              {/* A4 Page */}
              <div
                className="bg-white shadow-2xl relative"
                style={{
                  width: '210mm',
                  minHeight: '297mm',
                  position: 'relative',
                  overflow: 'hidden',
                }}
              >
                {/* Letterhead Background for E-Copy mode */}
                {mode === 'ecopy' && settings.letterheadUrl && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '210mm',
                      height: '297mm',
                      backgroundImage: `url(${settings.letterheadUrl})`,
                      backgroundSize: '210mm 297mm',
                      backgroundRepeat: 'no-repeat',
                      backgroundPosition: 'top left',
                      zIndex: 0,
                      pointerEvents: 'none',
                    }}
                  />
                )}

                {/* Content with margins */}
                <div
                  style={{
                    position: 'relative',
                    zIndex: 1,
                    paddingTop: `${topSpacer}px`,
                    paddingBottom: `${bottomSpacer}px`,
                    paddingLeft: `${margins.left}px`,
                    paddingRight: `${margins.right}px`,
                  }}
                >
                  <div
                    dangerouslySetInnerHTML={{
                      __html: `
                        <style>
                          ${BASELINE_CSS}
                          ${cssContent || ''}

                          /* Make tables semi-transparent on letterhead */
                          ${mode === 'ecopy' && settings.letterheadUrl ? `
                            .patient-info,
                            .report-table,
                            .tbl-meta,
                            .tbl-results,
                            .tbl-interpretation {
                              background: rgba(255, 255, 255, 0.92) !important;
                            }
                            .report-table tbody tr:nth-child(even),
                            .tbl-results tbody tr:nth-child(even) {
                              background: rgba(248, 250, 252, 0.92) !important;
                            }
                          ` : ''}
                        </style>
                        ${injectDummyValues(htmlContent)}
                      `
                    }}
                  />
                </div>

                {/* Margin guides (visual helpers) */}
                <div
                  className="absolute pointer-events-none"
                  style={{
                    top: `${topSpacer}px`,
                    left: 0,
                    right: 0,
                    borderTop: '1px dashed rgba(239, 68, 68, 0.3)',
                  }}
                />
                <div
                  className="absolute pointer-events-none"
                  style={{
                    bottom: `${bottomSpacer}px`,
                    left: 0,
                    right: 0,
                    borderTop: '1px dashed rgba(239, 68, 68, 0.3)',
                  }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer with legend */}
        <div className="px-6 py-3 bg-gray-50 border-t border-gray-200 flex items-center justify-between text-xs text-gray-500">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1">
              <span className="w-4 h-0.5 bg-red-300 inline-block" style={{ borderTop: '1px dashed #ef4444' }}></span>
              Content safe zone
            </span>
            <span>A4: 210mm × 297mm</span>
          </div>
          <div>
            {mode === 'ecopy'
              ? 'E-Copy includes letterhead background - content appears below header area'
              : 'Print version has minimal margins - letterhead printed separately'
            }
          </div>
        </div>
      </div>
    </div>
  );
};

export default PDFPreviewModal;
