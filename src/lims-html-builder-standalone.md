/**
 * ================================================================
 *  STANDALONE LIMS HTML-to-PDF Builder
 * ================================================================
 *  
 *  ZERO external dependencies — copy this ONE file into any project.
 *  Generates PDF-ready HTML tables for any LIMS with fully dynamic:
 *    - Tests, analytes, sections (no hardcoded names)
 *    - Reference ranges (numeric bands, min/max, qualitative)
 *    - Column headers (Low/Normal/High, Optimal/Borderline/High Risk, etc.)
 *    - Colors & branding (theme override)
 *    - Gauges, history tables, specimen info, signatory
 *
 *  Two output modes:
 *    buildLIMSReportHtml()      → 3-band color matrix (green/gold/red cells)
 *    buildLIMSFlatTableHtml()   → Simple flat table (Test | Result | Unit | Ref | Flag)
 *
 *  Works with PDF.co / Puppeteer / wkhtmltopdf / any HTML-to-PDF engine.
 *  All styles are inline. Colors are on <td>. print-color-adjust forced.
 *
 *  Usage:
 *    import { buildLIMSReportHtml, LIMSReportData } from './lims-html-builder';
 *    const html = buildLIMSReportHtml({ patient: {...}, sections: [...] });
 *    // Send `html` to your PDF engine
 * ================================================================
 */

// ============================================================
//  UTILITY FUNCTIONS (inlined — no external dependencies)
// ============================================================

function escapeHtml(text: string | number | undefined | null): string {
  if (text == null) return '';
  const str = String(text);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDate(date?: string | Date): string {
  if (!date) return new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric'
  });
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric'
  });
}

// ============================================================
//  TYPES — Fully dynamic, no hardcoded test names
// ============================================================

/** Color theme override (optional — defaults to green/gold/red) */
export interface LIMSTheme {
  /** "Good" / "Optimal" / "Normal" color (default: #4a8c4a muted green) */
  normalBg?: string;
  normalText?: string;
  /** "Borderline" / "Warning" color (default: #d4a84b warm gold) */
  borderlineBg?: string;
  borderlineText?: string;
  /** "Abnormal" / "High Risk" / "Critical" color (default: #c45454 muted red) */
  abnormalBg?: string;
  abnormalText?: string;
  /** Header row background (default: #e8efe4) */
  headerBg?: string;
  headerText?: string;
  /** Section title color */
  sectionTitleColor?: string;
  /** Section title underline color */
  sectionBorderColor?: string;
}

/** A single analyte / test result row */
export interface LIMSAnalyte {
  /** Display name, e.g. "Total Cholesterol", "TSH", "WBC" */
  name: string;
  /** Result value — number or string for qualitative results (e.g. "Negative") */
  value: number | string;
  /** Unit of measurement, e.g. "mg/dL", "mIU/L" */
  units?: string;
  /** Reference range definition */
  refRange?: LIMSRefRange;
  /** Previous visit value for trend comparison */
  previousValue?: number | string;
  /** Explicit flag override — use if your LIMS already computed the flag */
  flag?: 'normal' | 'low' | 'high' | 'critical' | 'borderline' | 'abnormal';
  /** Clinical note / comment for this analyte */
  note?: string;
  /** Method used for testing, e.g. "ECLIA", "Ion Selective Electrode" */
  method?: string;
}

/**
 * Reference range definition — supports multiple formats:
 * 
 * 1. Simple min/max:      { normalMin: 4.5, normalMax: 11.0 }
 * 2. 3-band thresholds:   { bands: { lowMax: 200, midMin: 200, midMax: 239, highMin: 240 } }
 * 3. Qualitative map:     { qualitativeMap: { negative: 1, trace: 2, positive: 3 } }
 * 4. Free-text fallback:  { referenceText: "< 200 mg/dL" }
 */
export interface LIMSRefRange {
  /**
   * Column header labels override for this specific analyte.
   * e.g. ["Optimal", "Borderline", "High Risk"]
   *      ["Low", "Normal", "High"]
   *      ["Non-Reactive", "—", "Reactive"]
   * Falls back to section's columnLabels, then ["Low", "Normal", "High"]
   */
  columnLabels?: [string, string, string];

  /** Simple normal range: value < min → Low, value > max → High */
  normalMin?: number;
  normalMax?: number;

  /**
   * 3-band thresholds (e.g. for lipid-style Optimal/Borderline/High):
   *   Column 1: ≤ lowMax    Column 2: midMin–midMax    Column 3: ≥ highMin
   */
  bands?: {
    lowMax?: number;
    midMin?: number;
    midMax?: number;
    highMin?: number;
  };

  /** When true, higher values are better (e.g., HDL-C). Flips color mapping. */
  higherIsBetter?: boolean;

  /**
   * Map string results (case-insensitive) to a column: 1, 2, or 3.
   * e.g. { "negative": 1, "trace": 2, "positive": 3 }
   */
  qualitativeMap?: Record<string, 1 | 2 | 3>;

  /** Free-text reference shown when no structured range, e.g. "< 200 mg/dL" */
  referenceText?: string;

  /** Display text for each column when inactive, e.g. ["< 200", "200–239", "≥ 240"] */
  columnRangeText?: [string, string, string];
}

/** A group of analytes (e.g., "Lipid Panel", "CBC", "Thyroid") */
export interface LIMSSection {
  /** Section title, e.g. "Lipid Panel", "Complete Blood Count" */
  title: string;
  /** Unique key (optional, for CSS/anchoring) */
  key?: string;
  /** Default column labels for all analytes in this section */
  columnLabels?: [string, string, string];
  /** The analytes/tests in this section */
  analytes: LIMSAnalyte[];
  /** Section-level notes/comments */
  notes?: string;
}

/** Patient information */
export interface LIMSPatient {
  name: string;
  age?: number;
  gender?: string;
  dob?: string;
  id?: string;
  [key: string]: unknown;
}

/** Lab / Facility information */
export interface LIMSLabInfo {
  name?: string;
  address?: string;
  phone?: string;
  email?: string;
  accreditationNo?: string;
  [key: string]: unknown;
}

/** Historical visit data for trend comparison table */
export interface LIMSHistoryVisit {
  date: string;
  /** Map of analyte name → value for this visit */
  values: Record<string, number | string>;
}

/** Top-level report data — the main input to the builder */
export interface LIMSReportData {
  /** Report title (default: "Laboratory Report") */
  title?: string;
  /** Report subtitle / panel name */
  subtitle?: string;
  /** Patient demographics */
  patient: LIMSPatient;
  /** Lab/Facility info */
  lab?: LIMSLabInfo;
  /** Report date (ISO string or any parseable date) */
  reportDate?: string;
  /** Report / Accession ID */
  reportId?: string;
  /** Specimen information */
  specimen?: {
    type?: string;
    collectedAt?: string;
    receivedAt?: string;
    reportedAt?: string;
  };
  /** Ordering physician name */
  orderingPhysician?: string;
  /** Test sections (the core data) */
  sections: LIMSSection[];
  /** Historical visits for trend table */
  history?: LIMSHistoryVisit[];
  /** Footnotes shown at bottom */
  footnotes?: string[];
  /** Theme overrides (colors, branding) */
  theme?: LIMSTheme;
  /** Show gauge/bar visualization for numeric analytes (default: false) */
  showGauges?: boolean;
  /** Show specimen info block (default: true if specimen present) */
  showSpecimenInfo?: boolean;
  /** Show patient header (default: true) */
  showPatientHeader?: boolean;
  /** Overall interpretation / summary text */
  interpretation?: string;
  /** Pathologist / Authorized signatory */
  signatory?: {
    name: string;
    designation?: string;
    licenseNo?: string;
  };
}

// ============================================================
// DEFAULT THEME
// ============================================================

const DEFAULT_BRAND_GREEN = '#5a7f3a';

const DEFAULT_THEME: Required<LIMSTheme> = {
  normalBg: '#4a8c4a',
  normalText: '#ffffff',
  borderlineBg: '#d4a84b',
  borderlineText: '#1f1f1f',
  abnormalBg: '#c45454',
  abnormalText: '#ffffff',
  headerBg: '#e8efe4',
  headerText: '#374151',
  sectionTitleColor: DEFAULT_BRAND_GREEN,
  sectionBorderColor: DEFAULT_BRAND_GREEN,
};

// ============================================================
// BAND INTERPRETATION
// ============================================================

type BandResult = 1 | 2 | 3 | null;

function interpretColumn(
  value: number | string,
  refRange?: LIMSRefRange,
  explicitFlag?: LIMSAnalyte['flag']
): BandResult {
  if (explicitFlag) {
    switch (explicitFlag) {
      case 'normal': return 2;
      case 'low': return 1;
      case 'high': return 3;
      case 'critical': return 3;
      case 'borderline': return 2;
      case 'abnormal': return 3;
    }
  }

  if (!refRange) return null;

  if (typeof value === 'string' && refRange.qualitativeMap) {
    const lower = value.toLowerCase().trim();
    for (const [key, col] of Object.entries(refRange.qualitativeMap)) {
      if (lower === key.toLowerCase().trim() || lower.includes(key.toLowerCase().trim())) {
        return col;
      }
    }
  }

  let numVal: number | null = null;
  if (typeof value === 'number') {
    numVal = value;
  } else if (typeof value === 'string') {
    const trimmed = value.trim();
    const gtMatch = /^>(=)?\s*(\d+(?:\.\d+)?)$/.exec(trimmed);
    const ltMatch = /^<(=)?\s*(\d+(?:\.\d+)?)$/.exec(trimmed);
    const numMatch = /^(\d+(?:\.\d+)?)$/.exec(trimmed);
    if (gtMatch) numVal = parseFloat(gtMatch[2]) + 0.00001;
    else if (ltMatch) numVal = parseFloat(ltMatch[2]) - 0.00001;
    else if (numMatch) numVal = parseFloat(numMatch[1]);
  }

  if (numVal === null) return null;

  if (refRange.normalMin !== undefined && refRange.normalMax !== undefined) {
    if (numVal < refRange.normalMin) return 1;
    if (numVal > refRange.normalMax) return 3;
    return 2;
  }

  if (refRange.bands) {
    const { lowMax, midMin, midMax, highMin } = refRange.bands;
    const hib = refRange.higherIsBetter;

    if (hib) {
      if (highMin !== undefined && numVal >= highMin) return 3;
      if (midMin !== undefined && midMax !== undefined && numVal >= midMin && numVal < midMax) return 2;
      if (lowMax !== undefined && numVal < lowMax) return 1;
      if (midMax !== undefined && highMin !== undefined && numVal >= midMax && numVal < highMin) return 2;
      if (lowMax !== undefined && midMin !== undefined && numVal >= lowMax && numVal < midMin) return 1;
    } else {
      if (lowMax !== undefined && numVal <= lowMax) return 1;
      if (midMin !== undefined && midMax !== undefined && numVal > midMin && numVal <= midMax) return 2;
      if (highMin !== undefined && numVal > highMin) return 3;
      if (lowMax !== undefined && midMin !== undefined && numVal > lowMax && numVal <= midMin) return 2;
      if (midMax !== undefined && highMin !== undefined && numVal > midMax && numVal <= highMin) return 2;
    }
  }

  return null;
}

function getColumnSemantic(
  col: 1 | 2 | 3,
  refRange?: LIMSRefRange,
  sectionLabels?: [string, string, string]
): 'good' | 'borderline' | 'bad' {
  const labels = refRange?.columnLabels || sectionLabels || ['Low', 'Normal', 'High'];
  const hib = refRange?.higherIsBetter;
  const l1 = labels[0].toLowerCase();

  const col1IsGood = l1.includes('optimal') || l1.includes('desirable') ||
    l1.includes('normal') || l1.includes('non-reactive') ||
    l1.includes('negative') || l1.includes('absent');

  const col1IsBad = l1.includes('low') || l1.includes('risk') || l1.includes('deficient');

  if (hib) {
    if (col === 1) return 'bad';
    if (col === 2) return 'borderline';
    return 'good';
  }

  if (col1IsGood) {
    if (col === 1) return 'good';
    if (col === 2) return 'borderline';
    return 'bad';
  }

  if (col1IsBad) {
    if (col === 1) return 'bad';
    if (col === 2) return 'good';
    return 'bad';
  }

  if (col === 1) return 'bad';
  if (col === 2) return 'good';
  return 'bad';
}

// ============================================================
// FORMAT HELPERS
// ============================================================

function formatRefText(refRange?: LIMSRefRange, position: 1 | 2 | 3 = 2): string {
  if (!refRange) return '';

  if (refRange.columnRangeText) {
    return refRange.columnRangeText[position - 1] || '';
  }

  if (refRange.referenceText && position === 2) {
    return refRange.referenceText;
  }

  if (refRange.normalMin !== undefined && refRange.normalMax !== undefined) {
    if (position === 1) return `< ${refRange.normalMin}`;
    if (position === 2) return `${refRange.normalMin} – ${refRange.normalMax}`;
    return `> ${refRange.normalMax}`;
  }

  if (refRange.bands) {
    const { lowMax, midMin, midMax, highMin } = refRange.bands;
    if (position === 1 && lowMax !== undefined) return `≤ ${lowMax}`;
    if (position === 2 && midMin !== undefined && midMax !== undefined) return `${midMin} – ${midMax}`;
    if (position === 3 && highMin !== undefined) return `≥ ${highMin}`;
  }

  return '';
}

// ============================================================
// HTML BUILDERS
// ============================================================

function resolveTheme(custom?: LIMSTheme): Required<LIMSTheme> {
  return { ...DEFAULT_THEME, ...custom };
}

function getColorForSemantic(semantic: 'good' | 'borderline' | 'bad', theme: Required<LIMSTheme>) {
  switch (semantic) {
    case 'good': return { bg: theme.normalBg, text: theme.normalText };
    case 'borderline': return { bg: theme.borderlineBg, text: theme.borderlineText };
    case 'bad': return { bg: theme.abnormalBg, text: theme.abnormalText };
  }
}

function buildLIMSPatientHeader(data: LIMSReportData, theme: Required<LIMSTheme>): string {
  const p = data.patient;
  const fields: string[] = [];
  if (p.id) fields.push(`<strong>Patient ID:</strong> ${escapeHtml(String(p.id))}`);
  if (p.age) fields.push(`<strong>Age:</strong> ${p.age}`);
  if (p.gender) fields.push(`<strong>Gender:</strong> ${escapeHtml(p.gender)}`);
  if (p.dob) fields.push(`<strong>DOB:</strong> ${escapeHtml(p.dob)}`);
  if (data.reportId) fields.push(`<strong>Report ID:</strong> ${escapeHtml(data.reportId)}`);
  if (data.orderingPhysician) fields.push(`<strong>Physician:</strong> ${escapeHtml(data.orderingPhysician)}`);

  return `
    <div style="margin-bottom: 16px; padding: 12px 16px; background: rgba(255,255,255,0.95); border: 1px solid #d1d5db; border-radius: 4px; page-break-inside: avoid;">
      <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px;">
        <div style="font-size: 16px; font-weight: 700; color: ${theme.sectionTitleColor};">
          ${escapeHtml(p.name)}
        </div>
        <div style="font-size: 11px; color: #6b7280;">
          ${data.reportDate ? formatDate(data.reportDate) : ''}
        </div>
      </div>
      <div style="display: flex; flex-wrap: wrap; gap: 12px; font-size: 12px; color: #374151;">
        ${fields.map(f => `<span>${f}</span>`).join('')}
      </div>
    </div>
  `;
}

function buildSpecimenInfo(data: LIMSReportData): string {
  if (!data.specimen) return '';
  const s = data.specimen;
  const items: string[] = [];
  if (s.type) items.push(`<strong>Specimen:</strong> ${escapeHtml(s.type)}`);
  if (s.collectedAt) items.push(`<strong>Collected:</strong> ${escapeHtml(s.collectedAt)}`);
  if (s.receivedAt) items.push(`<strong>Received:</strong> ${escapeHtml(s.receivedAt)}`);
  if (s.reportedAt) items.push(`<strong>Reported:</strong> ${escapeHtml(s.reportedAt)}`);
  if (items.length === 0) return '';

  return `
    <div style="margin-bottom: 14px; padding: 8px 14px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 4px; font-size: 11px; color: #374151; page-break-inside: avoid;">
      <div style="display: flex; flex-wrap: wrap; gap: 16px;">
        ${items.map(i => `<span>${i}</span>`).join('')}
      </div>
    </div>
  `;
}

function buildNoteRow(note: string): string {
  return `
    <tr style="page-break-inside: avoid;">
      <td colspan="5" style="padding: 4px 12px 8px 24px; border: 1px solid #d1d5db; border-top: none; font-size: 10px; color: #6b7280; font-style: italic; background: #fafafa;">
        📝 ${escapeHtml(note)}
      </td>
    </tr>
  `;
}

function buildAnalyteRow(
  analyte: LIMSAnalyte,
  sectionLabels: [string, string, string],
  theme: Required<LIMSTheme>
): string {
  const col = interpretColumn(analyte.value, analyte.refRange, analyte.flag);
  const displayValue = analyte.value !== undefined && analyte.value !== null ? String(analyte.value) : '';
  const unitStr = analyte.units || '';

  if (col === null) {
    return `
      <tr style="page-break-inside: avoid;">
        <td style="font-weight: 600; padding: 10px 12px; border: 1px solid #d1d5db; color: #1f2937; width: 180px;">
          ${escapeHtml(analyte.name)}
          ${analyte.method ? `<div style="font-size: 9px; color: #9ca3af; margin-top: 2px;">${escapeHtml(analyte.method)}</div>` : ''}
        </td>
        <td style="padding: 6px; border: 1px solid #d1d5db; text-align: center; vertical-align: middle; background-color: #f9fafb; -webkit-print-color-adjust: exact; print-color-adjust: exact;" colspan="3">
          <div style="font-size: 15px; font-weight: 700; color: #374151;">${escapeHtml(displayValue)}</div>
          ${unitStr ? `<div style="font-size: 10px; color: #6b7280; margin-top: 2px;">${escapeHtml(unitStr)}</div>` : ''}
          ${analyte.refRange?.referenceText ? `<div style="font-size: 9px; color: #9ca3af; margin-top: 2px;">Ref: ${escapeHtml(analyte.refRange.referenceText)}</div>` : ''}
        </td>
        <td style="padding: 10px 12px; border: 1px solid #d1d5db; font-size: 12px; color: #6b7280;">
          ${analyte.previousValue !== undefined ? escapeHtml(String(analyte.previousValue)) : ''}
        </td>
      </tr>
      ${analyte.note ? buildNoteRow(analyte.note) : ''}
    `;
  }

  const sem1 = getColumnSemantic(1, analyte.refRange, sectionLabels);
  const sem2 = getColumnSemantic(2, analyte.refRange, sectionLabels);
  const sem3 = getColumnSemantic(3, analyte.refRange, sectionLabels);

  const color1 = getColorForSemantic(sem1, theme);
  const color2 = getColorForSemantic(sem2, theme);
  const color3 = getColorForSemantic(sem3, theme);

  const ref1 = formatRefText(analyte.refRange, 1);
  const ref2 = formatRefText(analyte.refRange, 2);
  const ref3 = formatRefText(analyte.refRange, 3);

  const buildCell = (colNum: 1 | 2 | 3, color: { bg: string; text: string }, refText: string) => {
    const isActive = col === colNum;
    if (isActive) {
      return `
        <td style="padding: 6px; border: 1px solid #d1d5db; text-align: center; vertical-align: middle; background-color: ${color.bg}; -webkit-print-color-adjust: exact; print-color-adjust: exact;">
          <div style="font-size: 15px; font-weight: 700; color: ${color.text};">${escapeHtml(displayValue)}</div>
          ${unitStr ? `<div style="font-size: 10px; color: ${color.text}; opacity: 0.85; margin-top: 1px;">${escapeHtml(unitStr)}</div>` : ''}
          ${refText ? `<div style="font-size: 10px; color: ${color.text}; opacity: 0.85; margin-top: 2px;">${refText}</div>` : ''}
        </td>
      `;
    }
    return `
      <td style="padding: 6px; border: 1px solid #d1d5db; text-align: center; vertical-align: middle; background-color: transparent;">
        <div style="font-size: 10px; color: #6b7280;">${refText}</div>
      </td>
    `;
  };

  return `
    <tr style="page-break-inside: avoid;">
      <td style="font-weight: 600; padding: 10px 12px; border: 1px solid #d1d5db; color: #1f2937; width: 180px;">
        ${escapeHtml(analyte.name)}
        ${analyte.method ? `<div style="font-size: 9px; color: #9ca3af; margin-top: 2px;">${escapeHtml(analyte.method)}</div>` : ''}
      </td>
      ${buildCell(1, color1, ref1)}
      ${buildCell(2, color2, ref2)}
      ${buildCell(3, color3, ref3)}
      <td style="padding: 10px 12px; border: 1px solid #d1d5db; font-size: 12px; color: #6b7280;">
        ${analyte.previousValue !== undefined ? escapeHtml(String(analyte.previousValue)) : ''}
      </td>
    </tr>
    ${analyte.note ? buildNoteRow(analyte.note) : ''}
  `;
}

function buildLIMSSectionHtml(section: LIMSSection, theme: Required<LIMSTheme>): string {
  const labels: [string, string, string] = section.columnLabels || ['Low', 'Normal', 'High'];

  return `
    <div style="margin-bottom: 20px; page-break-inside: avoid;">
      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px; padding-bottom: 6px; border-bottom: 2px solid ${theme.sectionBorderColor};">
        <h3 style="font-size: 15px; font-weight: 600; color: ${theme.sectionTitleColor}; margin: 0;">
          ${escapeHtml(section.title)}
        </h3>
      </div>
      <table style="width: 100%; border-collapse: collapse; font-size: 13px; background: rgba(255,255,255,0.95); -webkit-print-color-adjust: exact; print-color-adjust: exact;">
        <thead>
          <tr>
            <th style="text-align: left; padding: 8px 12px; border: 1px solid #d1d5db; width: 180px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.03em; color: ${theme.headerText}; background-color: ${theme.headerBg}; -webkit-print-color-adjust: exact; print-color-adjust: exact;">Test Name</th>
            <th style="text-align: center; padding: 8px 12px; border: 1px solid #d1d5db; width: 130px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.03em; color: ${theme.headerText}; background-color: ${theme.headerBg}; -webkit-print-color-adjust: exact; print-color-adjust: exact;">${escapeHtml(labels[0])}</th>
            <th style="text-align: center; padding: 8px 12px; border: 1px solid #d1d5db; width: 130px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.03em; color: ${theme.headerText}; background-color: ${theme.headerBg}; -webkit-print-color-adjust: exact; print-color-adjust: exact;">${escapeHtml(labels[1])}</th>
            <th style="text-align: center; padding: 8px 12px; border: 1px solid #d1d5db; width: 130px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.03em; color: ${theme.headerText}; background-color: ${theme.headerBg}; -webkit-print-color-adjust: exact; print-color-adjust: exact;">${escapeHtml(labels[2])}</th>
            <th style="text-align: left; padding: 8px 12px; border: 1px solid #d1d5db; width: 80px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.03em; color: ${theme.headerText}; background-color: ${theme.headerBg}; -webkit-print-color-adjust: exact; print-color-adjust: exact;">Previous</th>
          </tr>
        </thead>
        <tbody>
          ${section.analytes.map(a => buildAnalyteRow(a, labels, theme)).join('')}
        </tbody>
      </table>
      ${section.notes ? `<div style="margin-top: 6px; padding: 6px 12px; font-size: 11px; color: #6b7280; font-style: italic;">${escapeHtml(section.notes)}</div>` : ''}
    </div>
  `;
}

function buildAnalyteGauge(
  analyte: LIMSAnalyte,
  sectionLabels: [string, string, string],
  theme: Required<LIMSTheme>
): string {
  if (typeof analyte.value !== 'number' || !analyte.refRange) return '';

  const ref = analyte.refRange;
  let minScale: number;
  let maxScale: number;
  let segments: { start: number; end: number; semantic: 'good' | 'borderline' | 'bad' }[] = [];

  if (ref.normalMin !== undefined && ref.normalMax !== undefined) {
    const range = ref.normalMax - ref.normalMin;
    minScale = ref.normalMin - range * 0.5;
    maxScale = ref.normalMax + range * 0.5;
    segments = [
      { start: minScale, end: ref.normalMin, semantic: 'bad' },
      { start: ref.normalMin, end: ref.normalMax, semantic: 'good' },
      { start: ref.normalMax, end: maxScale, semantic: 'bad' },
    ];
  } else if (ref.bands) {
    const { lowMax, midMin, midMax, highMin } = ref.bands;
    const lo = lowMax ?? 0;
    const hi = highMin ?? (midMax ?? 100);
    const range = hi - lo;
    minScale = lo - range * 0.3;
    maxScale = hi + range * 0.3;
    const hib = ref.higherIsBetter;
    segments = [
      { start: minScale, end: lowMax ?? minScale, semantic: hib ? 'bad' : 'good' },
      { start: midMin ?? lowMax ?? minScale, end: midMax ?? highMin ?? maxScale, semantic: 'borderline' },
      { start: highMin ?? maxScale, end: maxScale, semantic: hib ? 'good' : 'bad' },
    ];
  } else {
    return '';
  }

  const totalRange = maxScale - minScale;
  if (totalRange <= 0) return '';

  const clampedValue = Math.max(minScale, Math.min(maxScale, analyte.value));
  const pointerPercent = ((clampedValue - minScale) / totalRange) * 100;
  const col = interpretColumn(analyte.value, ref, analyte.flag);
  const semantic = col ? getColumnSemantic(col, ref, sectionLabels) : 'borderline';
  const pointerColor = getColorForSemantic(semantic, theme);

  return `
    <div style="margin-bottom: 16px; padding: 10px 14px; background: rgba(255,255,255,0.95); border: 1px solid #e5e7eb; border-radius: 4px; page-break-inside: avoid;">
      <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px;">
        <span style="font-size: 13px; font-weight: 600; color: #1f2937;">${escapeHtml(analyte.name)}</span>
        <span style="font-size: 15px; font-weight: 700; color: ${pointerColor.bg};">
          ${escapeHtml(String(analyte.value))} ${analyte.units ? escapeHtml(analyte.units) : ''}
        </span>
      </div>
      <div style="position: relative; height: 18px; border-radius: 9px; overflow: hidden; display: flex;">
        ${segments.map(seg => {
          const width = ((seg.end - seg.start) / totalRange) * 100;
          const c = getColorForSemantic(seg.semantic, theme);
          return `<div style="width: ${width}%; height: 100%; background-color: ${c.bg}; -webkit-print-color-adjust: exact; print-color-adjust: exact;"></div>`;
        }).join('')}
      </div>
      <div style="position: relative; height: 12px; margin-top: -6px;">
        <div style="position: absolute; left: ${pointerPercent}%; transform: translateX(-50%); width: 0; height: 0; border-left: 6px solid transparent; border-right: 6px solid transparent; border-top: 8px solid ${pointerColor.bg}; -webkit-print-color-adjust: exact; print-color-adjust: exact;"></div>
      </div>
      <div style="display: flex; justify-content: space-between; font-size: 9px; color: #9ca3af; margin-top: 2px;">
        <span>${minScale}</span>
        <span>${maxScale}</span>
      </div>
    </div>
  `;
}

function buildHistoryTable(data: LIMSReportData, theme: Required<LIMSTheme>): string {
  if (!data.history || data.history.length === 0) return '';

  const analyteNames: string[] = [];
  for (const section of data.sections) {
    for (const a of section.analytes) {
      if (!analyteNames.includes(a.name)) analyteNames.push(a.name);
    }
  }

  return `
    <div style="margin-bottom: 20px; page-break-inside: avoid;">
      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px; padding-bottom: 6px; border-bottom: 2px solid ${theme.sectionBorderColor};">
        <h3 style="font-size: 15px; font-weight: 600; color: ${theme.sectionTitleColor}; margin: 0;">Historical Comparison</h3>
      </div>
      <table style="width: 100%; border-collapse: collapse; font-size: 12px; background: rgba(255,255,255,0.95);">
        <thead>
          <tr>
            <th style="text-align: left; padding: 8px 12px; border: 1px solid #d1d5db; font-size: 10px; text-transform: uppercase; color: ${theme.headerText}; background-color: ${theme.headerBg}; -webkit-print-color-adjust: exact; print-color-adjust: exact;">Analyte</th>
            ${data.history.map(v => `
              <th style="text-align: center; padding: 8px 12px; border: 1px solid #d1d5db; font-size: 10px; text-transform: uppercase; color: ${theme.headerText}; background-color: ${theme.headerBg}; -webkit-print-color-adjust: exact; print-color-adjust: exact;">${escapeHtml(v.date)}</th>
            `).join('')}
          </tr>
        </thead>
        <tbody>
          ${analyteNames.map(name => `
            <tr style="page-break-inside: avoid;">
              <td style="font-weight: 600; padding: 8px 12px; border: 1px solid #d1d5db; color: #1f2937;">${escapeHtml(name)}</td>
              ${data.history!.map(v => `
                <td style="padding: 8px 12px; border: 1px solid #d1d5db; text-align: center; color: #374151;">
                  ${v.values[name] !== undefined ? escapeHtml(String(v.values[name])) : '—'}
                </td>
              `).join('')}
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function buildSignatory(signatory: LIMSReportData['signatory']): string {
  if (!signatory) return '';
  return `
    <div style="margin-top: 30px; text-align: right; page-break-inside: avoid;">
      <div style="display: inline-block; text-align: center; min-width: 200px;">
        <div style="border-bottom: 1px solid #374151; padding-bottom: 4px; margin-bottom: 4px; font-size: 14px; font-weight: 600; color: #1f2937;">
          ${escapeHtml(signatory.name)}
        </div>
        ${signatory.designation ? `<div style="font-size: 11px; color: #6b7280;">${escapeHtml(signatory.designation)}</div>` : ''}
        ${signatory.licenseNo ? `<div style="font-size: 10px; color: #9ca3af;">Lic. No: ${escapeHtml(signatory.licenseNo)}</div>` : ''}
      </div>
    </div>
  `;
}

// ============================================================
// MAIN EXPORTS
// ============================================================

/**
 * Build 3-band color matrix HTML (like lab report / lipid profile).
 * 
 * Each analyte value lands in one of 3 colored columns based on its ref range.
 * The active cell is highlighted green/gold/red, inactive cells show the range text.
 */
export function buildLIMSReportHtml(data: LIMSReportData): string {
  const theme = resolveTheme(data.theme);
  const reportDate = formatDate(data.reportDate);
  const title = data.title || 'Laboratory Report';

  return `
    <div class="lims-report">
      <div style="margin-bottom: 16px;">
        <h1 style="font-size: 20px; font-weight: 700; color: ${theme.sectionTitleColor}; margin: 0 0 4px;">${escapeHtml(title)}</h1>
        ${data.subtitle ? `<p style="font-size: 13px; color: #374151; margin: 0 0 4px;">${escapeHtml(data.subtitle)}</p>` : ''}
        <p style="font-size: 12px; color: #6b7280; margin: 0;">Generated on: ${reportDate}</p>
      </div>

      ${data.showPatientHeader !== false ? buildLIMSPatientHeader(data, theme) : ''}
      ${(data.showSpecimenInfo !== false && data.specimen) ? buildSpecimenInfo(data) : ''}

      ${data.sections.map(section => buildLIMSSectionHtml(section, theme)).join('')}

      ${data.showGauges ? `
        <div style="margin-bottom: 20px;">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px; padding-bottom: 6px; border-bottom: 2px solid ${theme.sectionBorderColor};">
            <h3 style="font-size: 15px; font-weight: 600; color: ${theme.sectionTitleColor}; margin: 0;">Visual Summary</h3>
          </div>
          ${data.sections.map(section => {
            const labels: [string, string, string] = section.columnLabels || ['Low', 'Normal', 'High'];
            return section.analytes
              .filter(a => typeof a.value === 'number' && a.refRange)
              .map(a => buildAnalyteGauge(a, labels, theme))
              .join('');
          }).join('')}
        </div>
      ` : ''}

      ${buildHistoryTable(data, theme)}

      ${data.interpretation ? `
        <div style="margin-top: 16px; padding: 12px 16px; background: #f5f9f3; border: 1px solid #9dc99d; border-radius: 4px; page-break-inside: avoid;">
          <h4 style="font-size: 13px; font-weight: 600; color: ${theme.sectionTitleColor}; margin: 0 0 6px;">Interpretation</h4>
          <p style="font-size: 12px; color: #374151; margin: 0; line-height: 1.6;">${escapeHtml(data.interpretation)}</p>
        </div>
      ` : ''}

      ${buildSignatory(data.signatory)}

      ${data.footnotes && data.footnotes.length > 0 ? `
        <div style="margin-top: 16px; padding-top: 8px; border-top: 1px solid #e5e7eb; font-size: 10px; color: #9ca3af;">
          ${data.footnotes.map((fn, i) => `<p style="margin: 2px 0;"><sup>${i + 1}</sup> ${escapeHtml(fn)}</p>`).join('')}
        </div>
      ` : ''}

      <div style="margin-top: 24px; padding-top: 12px; border-top: 1px solid #e5e7eb; font-size: 11px; color: #6b7280; text-align: center;">
        <p style="font-style: italic; margin-bottom: 4px;">Display-only clinical summary. For diagnostic decisions, refer to the official laboratory report and physician guidance.</p>
        <p style="color: #9ca3af; margin: 0;">Generated on ${reportDate}</p>
      </div>
    </div>
  `;
}

/**
 * Build simple flat table HTML (Test | Result | Unit | Ref Range | Flag badge).
 * 
 * Simpler layout — no 3-column color matrix, just a standard results table
 * with colored flag badges for abnormal values.
 */
export function buildLIMSFlatTableHtml(data: LIMSReportData): string {
  const theme = resolveTheme(data.theme);
  const reportDate = formatDate(data.reportDate);
  const title = data.title || 'Laboratory Report';

  const flagColor = (analyte: LIMSAnalyte): string => {
    const col = interpretColumn(analyte.value, analyte.refRange, analyte.flag);
    if (!col) return '#374151';
    const labels: [string, string, string] = ['Low', 'Normal', 'High'];
    const sem = getColumnSemantic(col, analyte.refRange, labels);
    return getColorForSemantic(sem, theme).bg;
  };

  const flagText = (analyte: LIMSAnalyte): string => {
    if (analyte.flag) return analyte.flag.toUpperCase();
    const col = interpretColumn(analyte.value, analyte.refRange);
    if (!col) return '';
    const labels = analyte.refRange?.columnLabels || ['Low', 'Normal', 'High'];
    return labels[col - 1];
  };

  const refString = (analyte: LIMSAnalyte): string => {
    const r = analyte.refRange;
    if (!r) return '';
    if (r.referenceText) return r.referenceText;
    if (r.normalMin !== undefined && r.normalMax !== undefined) return `${r.normalMin} – ${r.normalMax}`;
    if (r.bands) {
      const parts: string[] = [];
      if (r.bands.lowMax !== undefined) parts.push(`≤${r.bands.lowMax}`);
      if (r.bands.midMin !== undefined && r.bands.midMax !== undefined) parts.push(`${r.bands.midMin}–${r.bands.midMax}`);
      if (r.bands.highMin !== undefined) parts.push(`≥${r.bands.highMin}`);
      return parts.join(' / ');
    }
    return '';
  };

  return `
    <div class="lims-report-flat">
      <div style="margin-bottom: 16px;">
        <h1 style="font-size: 20px; font-weight: 700; color: ${theme.sectionTitleColor}; margin: 0 0 4px;">${escapeHtml(title)}</h1>
        ${data.subtitle ? `<p style="font-size: 13px; color: #374151; margin: 0 0 4px;">${escapeHtml(data.subtitle)}</p>` : ''}
        <p style="font-size: 12px; color: #6b7280; margin: 0;">Generated on: ${reportDate}</p>
      </div>

      ${data.showPatientHeader !== false ? buildLIMSPatientHeader(data, theme) : ''}
      ${(data.showSpecimenInfo !== false && data.specimen) ? buildSpecimenInfo(data) : ''}

      ${data.sections.map(section => `
        <div style="margin-bottom: 20px; page-break-inside: avoid;">
          <div style="margin-bottom: 10px; padding-bottom: 6px; border-bottom: 2px solid ${theme.sectionBorderColor};">
            <h3 style="font-size: 15px; font-weight: 600; color: ${theme.sectionTitleColor}; margin: 0;">${escapeHtml(section.title)}</h3>
          </div>
          <table style="width: 100%; border-collapse: collapse; font-size: 13px; background: rgba(255,255,255,0.95);">
            <thead>
              <tr>
                <th style="text-align: left; padding: 8px 12px; border: 1px solid #d1d5db; font-size: 10px; text-transform: uppercase; color: ${theme.headerText}; background-color: ${theme.headerBg}; -webkit-print-color-adjust: exact; print-color-adjust: exact;">Test</th>
                <th style="text-align: center; padding: 8px 12px; border: 1px solid #d1d5db; font-size: 10px; text-transform: uppercase; color: ${theme.headerText}; background-color: ${theme.headerBg}; -webkit-print-color-adjust: exact; print-color-adjust: exact;">Result</th>
                <th style="text-align: center; padding: 8px 12px; border: 1px solid #d1d5db; font-size: 10px; text-transform: uppercase; color: ${theme.headerText}; background-color: ${theme.headerBg}; -webkit-print-color-adjust: exact; print-color-adjust: exact;">Unit</th>
                <th style="text-align: center; padding: 8px 12px; border: 1px solid #d1d5db; font-size: 10px; text-transform: uppercase; color: ${theme.headerText}; background-color: ${theme.headerBg}; -webkit-print-color-adjust: exact; print-color-adjust: exact;">Ref. Range</th>
                <th style="text-align: center; padding: 8px 12px; border: 1px solid #d1d5db; font-size: 10px; text-transform: uppercase; color: ${theme.headerText}; background-color: ${theme.headerBg}; -webkit-print-color-adjust: exact; print-color-adjust: exact;">Flag</th>
              </tr>
            </thead>
            <tbody>
              ${section.analytes.map(a => {
                const fc = flagColor(a);
                const ft = flagText(a);
                const isAbnormal = ft && ft.toLowerCase() !== 'normal' && ft.toLowerCase() !== 'optimal';
                return `
                  <tr style="page-break-inside: avoid;">
                    <td style="padding: 8px 12px; border: 1px solid #d1d5db; font-weight: 600; color: #1f2937;">
                      ${escapeHtml(a.name)}
                      ${a.method ? `<div style="font-size: 9px; color: #9ca3af;">${escapeHtml(a.method)}</div>` : ''}
                    </td>
                    <td style="padding: 8px 12px; border: 1px solid #d1d5db; text-align: center; font-weight: 700; color: ${isAbnormal ? fc : '#374151'};">${escapeHtml(String(a.value))}</td>
                    <td style="padding: 8px 12px; border: 1px solid #d1d5db; text-align: center; color: #6b7280; font-size: 12px;">${a.units ? escapeHtml(a.units) : ''}</td>
                    <td style="padding: 8px 12px; border: 1px solid #d1d5db; text-align: center; color: #6b7280; font-size: 12px;">${escapeHtml(refString(a))}</td>
                    <td style="padding: 8px 12px; border: 1px solid #d1d5db; text-align: center;">
                      ${ft ? `<span style="display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 10px; font-weight: 600; color: white; background-color: ${fc}; -webkit-print-color-adjust: exact; print-color-adjust: exact;">${escapeHtml(ft)}</span>` : ''}
                    </td>
                  </tr>
                  ${a.note ? buildNoteRow(a.note) : ''}
                `;
              }).join('')}
            </tbody>
          </table>
          ${section.notes ? `<div style="margin-top: 6px; font-size: 11px; color: #6b7280; font-style: italic;">${escapeHtml(section.notes)}</div>` : ''}
        </div>
      `).join('')}

      ${data.interpretation ? `
        <div style="margin-top: 16px; padding: 12px 16px; background: #f5f9f3; border: 1px solid #9dc99d; border-radius: 4px; page-break-inside: avoid;">
          <h4 style="font-size: 13px; font-weight: 600; color: ${theme.sectionTitleColor}; margin: 0 0 6px;">Interpretation</h4>
          <p style="font-size: 12px; color: #374151; margin: 0; line-height: 1.6;">${escapeHtml(data.interpretation)}</p>
        </div>
      ` : ''}

      ${buildSignatory(data.signatory)}

      <div style="margin-top: 24px; padding-top: 12px; border-top: 1px solid #e5e7eb; font-size: 11px; color: #6b7280; text-align: center;">
        <p style="font-style: italic; margin-bottom: 4px;">Display-only clinical summary. For diagnostic decisions, refer to the official laboratory report and physician guidance.</p>
        <p style="color: #9ca3af; margin: 0;">Generated on ${reportDate}</p>
      </div>
    </div>
  `;
}
