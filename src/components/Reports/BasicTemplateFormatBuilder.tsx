import React, { useMemo } from 'react';

export interface BasicPrintOptions {
  baseFontSize?: number;
  flagAsterisk?: boolean;
  flagAsteriskCritical?: boolean;
  testNameBold?: boolean;          // default true
  boldAllValues?: boolean;         // default true — all values font-weight 600; false = normal weight
  boldAbnormalValues?: boolean;    // default true — extra bold (700) for high/low; false = no extra bold
  calcMarker?: 'asterisk' | 'cal' | 'none'; // default 'asterisk'
  sectionHeaderInline?: boolean;   // default false = small-caps style; true = inline bold row like left screenshot
  flagSymbol?: 'none' | 'before' | 'after'; // default 'none'; 'before' = separate flag column before value; 'after' = inline flag suffix
  showFlagLegend?: boolean;        // show H=High, L=Low legend below each group table
  resultColors?: { high?: string; low?: string; enabled?: boolean }; // custom flag colors (matches edge fn)
}

interface Props {
  printOptions: BasicPrintOptions;
  showMethodology: boolean;
  showInterpretation: boolean;
  onChange: (update: {
    printOptions?: BasicPrintOptions;
    showMethodology?: boolean;
    showInterpretation?: boolean;
  }) => void;
}

// ── Sample CBC data (same analyte shape as edge fn) ───────────────────────────
const SAMPLE_ANALYTES_BY_GROUP = new Map([
  ['grp-cbc', [
    { parameter: 'Hemoglobin',            value: '8.2',   unit: 'g/dL',    reference_range: '13.5 - 17.5',    flag: 'low',  method: 'Photometry', interpretation_low: 'Low — Risk of Anemia',          section_heading: 'Red Blood Cell Indices', sort_order: 1  },
    { parameter: 'Red Blood Cell Count',  value: '4.5',   unit: '10⁶/µL', reference_range: '4.5 - 5.9',      flag: '',     method: 'Impedance',  section_heading: 'Red Blood Cell Indices', sort_order: 2  },
    { parameter: 'Hematocrit',            value: '27.1',  unit: '%',       reference_range: '42 - 52',         flag: 'low',  method: '',           interpretation_low: 'Low',                               section_heading: 'Red Blood Cell Indices', sort_order: 3  },
    { parameter: 'MCV',                   value: '60.2',  unit: 'fL',      reference_range: '78 - 100',        flag: 'low',  method: '',           is_auto_calculated: true, interpretation_low: 'Microcytic',  section_heading: 'Red Blood Cell Indices', sort_order: 4  },
    { parameter: 'MCH',                   value: '18.2',  unit: 'pg',      reference_range: '27 - 31',         flag: 'low',  method: '',           is_auto_calculated: true, interpretation_low: 'Hypochromic', section_heading: 'Red Blood Cell Indices', sort_order: 5  },
    { parameter: 'MCHC',                  value: '30.2',  unit: 'g/dL',   reference_range: '32 - 36',         flag: 'low',  method: '',           is_auto_calculated: true, interpretation_low: 'Hypochromic', section_heading: 'Red Blood Cell Indices', sort_order: 6  },
    { parameter: 'RDW-CV',               value: '16.5',  unit: '%',       reference_range: '11.5 - 14.0',    flag: 'high', method: '',           interpretation_high: 'High — Anisocytosis',              section_heading: 'Red Blood Cell Indices', sort_order: 7  },
    { parameter: 'Total Leukocyte Count', value: '12800', unit: '/cmm',    reference_range: '4000 - 10500',   flag: 'high', method: 'Impedance',  interpretation_high: 'Leukocytosis',                     section_heading: 'White Blood Cell Differential', sort_order: 8  },
    { parameter: 'Neutrophils (%)',       value: '72',    unit: '%',       reference_range: '50 - 80',         flag: '',     method: '',           section_heading: 'White Blood Cell Differential', sort_order: 9  },
    { parameter: 'Neutrophils (Abs)',     value: '9216',  unit: '/cmm',    reference_range: '1500 - 6600',    flag: 'high', method: '',           is_auto_calculated: true, interpretation_high: 'Neutrophilia', section_heading: 'White Blood Cell Differential', sort_order: 10 },
    { parameter: 'Lymphocytes (%)',       value: '20',    unit: '%',       reference_range: '25 - 50',         flag: 'low',  method: '',           interpretation_low: 'Lymphopenia',                       section_heading: 'White Blood Cell Differential', sort_order: 11 },
    { parameter: 'Lymphocytes (Abs)',     value: '2560',  unit: '/cmm',    reference_range: '1500 - 3500',    flag: '',     method: '',           is_auto_calculated: true,                                section_heading: 'White Blood Cell Differential', sort_order: 12 },
    { parameter: 'Monocytes (%)',         value: '5',     unit: '%',       reference_range: '2 - 10',          flag: '',     method: '',           section_heading: 'White Blood Cell Differential', sort_order: 13 },
    { parameter: 'Eosinophils (%)',       value: '2',     unit: '%',       reference_range: '0.0 - 5.0',      flag: '',     method: '',           section_heading: 'White Blood Cell Differential', sort_order: 14 },
    { parameter: 'Basophils (%)',         value: '1',     unit: '%',       reference_range: '0 - 2',           flag: '',     method: '',           section_heading: 'White Blood Cell Differential', sort_order: 15 },
    { parameter: 'Platelet Count',        value: '420000',unit: '/cmm',   reference_range: '150000 - 450000', flag: '',     method: 'Impedance',  section_heading: 'Platelet', sort_order: 16 },
    { parameter: 'ESR (After 1 hour)',    value: '38',    unit: 'mm/hr',   reference_range: '0 - 13',          flag: 'high', method: 'Westergren', interpretation_high: 'Elevated — Inflammation / Infection', section_heading: 'ESR', sort_order: 17 },
  ]],
]);
const SAMPLE_GROUP_NAMES = new Map([['grp-cbc', 'Complete Blood Count (CBC)']]);

// ── Exact port of groupAnalytesBySectionHeading from edge fn ─────────────────
function groupAnalytesBySectionHeading(analytes: any[]): { heading: string | null; analytes: any[] }[] {
  const sorted = [...analytes].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const hasHeadings = sorted.some((a) => a.section_heading);
  if (!hasHeadings) return [{ heading: null, analytes: sorted }];
  const blocks: { heading: string | null; analytes: any[] }[] = [];
  let currentHeading: string | null = null;
  let currentBlock: any[] = [];
  for (const analyte of sorted) {
    const h = analyte.section_heading ?? null;
    if (h !== currentHeading) {
      if (currentBlock.length > 0) blocks.push({ heading: currentHeading, analytes: currentBlock });
      currentHeading = h;
      currentBlock = [];
    }
    currentBlock.push(analyte);
  }
  if (currentBlock.length > 0) blocks.push({ heading: currentHeading, analytes: currentBlock });
  return blocks;
}

// ── Exact port of normalizeReportFlag from edge fn ───────────────────────────
function normalizeReportFlag(flag: string): { canonical: string } {
  const f = (flag || '').toLowerCase().trim();
  if (f === 'high' || f === 'h')           return { canonical: 'high' };
  if (f === 'low'  || f === 'l')           return { canonical: 'low' };
  if (f === 'critical_high' || f === 'ch') return { canonical: 'critical_high' };
  if (f === 'critical_low'  || f === 'cl') return { canonical: 'critical_low' };
  if (f === 'abnormal' || f === 'a')       return { canonical: 'abnormal' };
  return { canonical: f };
}

// ── Exact port of generateBasicDefaultTemplateHtml from edge fn ──────────────
function buildBasicHtml(
  testGroupNames: Map<string, string>,
  analytesByGroup: Map<string, any[]>,
  showMethodology: boolean,
  showInterpretation: boolean,
  printOptions: BasicPrintOptions,
): string {
  const basePx  = Math.max(8, Math.min(24, printOptions.baseFontSize ?? 11));
  const smallPx = Math.max(7, basePx - 3);
  const titlePx = basePx + 2;
  const sigPx   = basePx + 1;
  const testNameWeight = (printOptions.testNameBold ?? true) ? '600' : 'normal';
  const calcMarker = printOptions.calcMarker ?? 'asterisk';
  const boldAllValues = printOptions.boldAllValues ?? true;
  const boldAbnormal = printOptions.boldAbnormalValues ?? true;
  const sectionHeaderInline = printOptions.sectionHeaderInline ?? false;
  const flagSymbol = printOptions.flagSymbol ?? 'none';
  const showFlagLegend = printOptions.showFlagLegend ?? false;
  const colCount = flagSymbol === 'before' ? 5 : 4;
  const highColor = printOptions.resultColors?.enabled ? (printOptions.resultColors?.high ?? '#dc2626') : '#dc2626';
  const lowColor  = printOptions.resultColors?.enabled ? (printOptions.resultColors?.low  ?? '#000')    : '#000';

  const noColorCss = `
<style>
.basic-report-template {
  font-size: ${basePx}px;
  line-height: 1.32;
  color: #000;
  font-family: Arial, Helvetica, sans-serif;
}

.basic-report-template table {
  border: none !important;
  border-collapse: collapse !important;
}

.basic-report-template td,
.basic-report-template th {
  color: #000 !important;
  font-weight: normal;
  background-color: #fff !important;
  vertical-align: top !important;
}

.basic-report-template td {
  padding: 2px 4px !important;
}

.basic-report-template th {
  padding: 3px 4px !important;
}

.basic-report-template .result-normal,
.basic-report-template .flag-normal,
.basic-report-template .value-normal,
.basic-report-template .result-high,
.basic-report-template .flag-high,
.basic-report-template .value-high,
.basic-report-template .result-low,
.basic-report-template .flag-low,
.basic-report-template .value-low,
.basic-report-template .result-critical,
.basic-report-template .flag-critical,
.basic-report-template .value-critical,
.basic-report-template .result-abnormal,
.basic-report-template .flag-abnormal,
.basic-report-template .value-abnormal,
.basic-report-template .flag-trace,
.basic-report-template .value-trace {
  color: #000 !important;
  font-weight: normal;
}

.basic-report-template .report-main-title {
  text-align: center !important;
  font-size: ${titlePx + 1}px !important;
  border-top: 1.5px solid #000 !important;
  border-bottom: 1.5px solid #000 !important;
  padding: 5px 0 !important;
  margin: 6px 0 10px !important;
  font-weight: 700 !important;
  color: #000 !important;
  line-height: 1.2 !important;
}

.basic-report-template .patient-header-table {
  width: 100% !important;
  table-layout: fixed !important;
  margin-bottom: 8px !important;
  border: none !important;
}

.basic-report-template .patient-header-table th {
  width: 15% !important;
  font-weight: 700 !important;
  text-align: left !important;
  color: #000 !important;
  padding: 2px 3px !important;
  white-space: nowrap !important;
  border: none !important;
}

.basic-report-template .patient-header-table td {
  width: 35% !important;
  padding: 2px 3px !important;
  border: none !important;
  color: #111 !important;
  word-break: break-word !important;
  font-size: ${basePx}px !important;
}

.basic-report-template .patient-header-table th {
  font-size: ${basePx}px !important;
}

.basic-report-template .tbl-results {
  width: 100% !important;
  table-layout: fixed !important;
  border-collapse: collapse !important;
  border: none !important;
  margin-top: 4px !important;
}

.basic-report-template .tbl-results thead th {
  border-top: 1.5px solid #000 !important;
  border-bottom: 1.5px solid #000 !important;
  border-left: none !important;
  border-right: none !important;
  font-weight: 700 !important;
  color: #000 !important;
  padding: 4px 4px !important;
  font-size: ${Math.max(10, basePx - 0.5)}px !important;
  vertical-align: middle !important;
}

${flagSymbol === 'before' ? `
.basic-report-template .tbl-results thead th:nth-child(1) { width: 44% !important; text-align: left !important; }
.basic-report-template .tbl-results thead th:nth-child(2) { width: 7% !important; text-align: center !important; }
.basic-report-template .tbl-results thead th:nth-child(3) { width: 14% !important; text-align: right !important; }
.basic-report-template .tbl-results thead th:nth-child(4) { width: 10% !important; text-align: left !important; }
.basic-report-template .tbl-results thead th:nth-child(5) { width: 25% !important; text-align: right !important; }
.basic-report-template .tbl-results tbody td:nth-child(1) { width: 44% !important; text-align: left !important; color: #111 !important; }
.basic-report-template .tbl-results tbody td:nth-child(2) { width: 7% !important; text-align: center !important; font-weight: 700 !important; }
.basic-report-template .tbl-results tbody td:nth-child(3) { width: 14% !important; text-align: right !important; }
.basic-report-template .tbl-results tbody td:nth-child(4) { width: 10% !important; text-align: left !important; color: #444 !important; white-space: nowrap !important; }
.basic-report-template .tbl-results tbody td:nth-child(5) { width: 25% !important; text-align: right !important; color: #666 !important; }
` : `
.basic-report-template .tbl-results thead th:nth-child(1) { width: 50% !important; text-align: left !important; }
.basic-report-template .tbl-results thead th:nth-child(2) { width: 15% !important; text-align: right !important; }
.basic-report-template .tbl-results thead th:nth-child(3) { width: 10% !important; text-align: left !important; }
.basic-report-template .tbl-results thead th:nth-child(4) { width: 25% !important; text-align: right !important; }
.basic-report-template .tbl-results tbody td:nth-child(1) { width: 50% !important; text-align: left !important; color: #111 !important; }
.basic-report-template .tbl-results tbody td:nth-child(2) { width: 15% !important; text-align: right !important; }
.basic-report-template .tbl-results tbody td:nth-child(3) { width: 10% !important; text-align: left !important; color: #444 !important; white-space: nowrap !important; }
.basic-report-template .tbl-results tbody td:nth-child(4) { width: 25% !important; text-align: right !important; color: #666 !important; }
`}

.basic-report-template .tbl-results td {
  border: none !important;
  padding: 2px 4px !important;
  line-height: 1.28 !important;
}

.basic-report-template .tbl-results tbody tr:not(.main-group-row):not(.sub-section-header):not(.interpretation-row):not(.descriptive-row) td {
  border-bottom: 0.5px dotted #e5e5e5 !important;
}

.basic-report-template .test-name-cell { vertical-align: top !important; }

.basic-report-template .test-name {
  font-size: ${basePx}px !important;
  font-weight: ${testNameWeight} !important;
  color: #111 !important;
  line-height: 1.22 !important;
}

.basic-report-template .test-method {
  font-size: ${smallPx}px !important;
  color: #444 !important;
  font-style: italic !important;
  margin-top: 1px !important;
  line-height: 1.2 !important;
}

.basic-report-template .val {
  text-align: right !important;
  vertical-align: top !important;
  font-size: ${basePx}px !important;
  font-weight: ${boldAllValues ? '600' : 'normal'} !important;
  font-variant-numeric: tabular-nums !important;
}

.basic-report-template .val.high,
.basic-report-template .val.critical_high,
.basic-report-template .val.critical_h,
.basic-report-template .val.H,
.basic-report-template .val.High {
  color: ${highColor} !important;
  ${boldAbnormal ? 'font-weight: 700 !important;' : ''}
}

.basic-report-template .val.low,
.basic-report-template .val.critical_low,
.basic-report-template .val.critical_l,
.basic-report-template .val.abnormal,
.basic-report-template .val.L,
.basic-report-template .val.Low {
  color: ${lowColor} !important;
  ${boldAbnormal ? 'font-weight: 700 !important;' : ''}
}

.basic-report-template .main-group-row td { padding: 0 !important; border: none !important; }

.basic-report-template .center-title {
  text-align: center !important;
  font-weight: 700 !important;
  text-decoration: underline !important;
  font-size: ${basePx + 1}px !important;
  margin: 8px 0 0 !important;
  text-transform: uppercase !important;
  line-height: 1.2 !important;
  color: #000 !important;
}

.basic-report-template .center-subtitle {
  text-align: center !important;
  font-size: ${smallPx + 1}px !important;
  margin: 2px 0 6px !important;
  color: #444 !important;
  font-weight: 600 !important;
}

.basic-report-template .sub-section-header td {
  font-weight: 700 !important;
  padding-top: ${sectionHeaderInline ? 6 : 12}px !important;
  padding-bottom: 3px !important;
  text-transform: uppercase !important;
  font-size: ${sectionHeaderInline ? basePx - 1 : smallPx + 1}px !important;
  letter-spacing: ${sectionHeaderInline ? 0 : 0.25}px !important;
  border: none !important;
  color: #000 !important;
  ${sectionHeaderInline ? `border-bottom: 0.5px solid #ccc !important; background-color: #f5f5f5 !important;` : ''}
}

.basic-report-template .descriptive-row td {
  border-bottom: 0.5px dotted #e5e5e5 !important;
  color: #111 !important;
}

.basic-report-template .interpretation-row td {
  padding: 1px 6px 4px 20px !important;
  font-size: ${smallPx}px !important;
  color: #333 !important;
  font-style: italic !important;
  border-bottom: none !important;
}

.basic-report-template .calculated-note {
  font-size: ${smallPx}px !important;
  color: #444 !important;
  margin: 3px 0 6px !important;
  font-style: italic !important;
}

.basic-report-template .report-sections {
  margin-top: 14px !important;
  border-top: 1px solid #000 !important;
  padding-top: 6px !important;
}

.basic-report-template .report-footer {
  margin-top: 20px !important;
  padding-top: 8px !important;
  display: flex !important;
  justify-content: space-between !important;
  align-items: flex-end !important;
  page-break-inside: avoid !important;
  border-top: none !important;
}

.basic-report-template .auth-text {
  font-size: ${smallPx}px !important;
  color: #444 !important;
  font-style: italic !important;
}

.basic-report-template .signature-box { text-align: right !important; }

.basic-report-template .tbl-results th:last-child,
.basic-report-template .tbl-results td:last-child {
  display: table-cell !important;
}
</style>`;

  const patientInfoHtml = `
    <div class="report-header-top">
      <h2 class="report-main-title">TEST REPORT</h2>
    </div>
    <figure class="table" style="margin: 0 0 10px;">
      <table class="patient-header-table">
        <tbody>
          <tr>
            <th>Name</th><td>: John Doe</td>
            <th>Reg. No</th><td>: LB-2026-00142</td>
          </tr>
          <tr>
            <th>Age / Sex</th><td>: 42Y / Male</td>
            <th>Reg. Date</th><td>: 17-Mar-2026</td>
          </tr>
          <tr>
            <th>Ref. By</th><td>: Dr. A. Sharma</td>
            <th>Report Date</th><td>: 17-Mar-2026</td>
          </tr>
        </tbody>
      </table>
    </figure>
  `;

  let testResultsHtml = '<div class="test-results">';

  for (const [groupId, analytes] of analytesByGroup) {
    if (!analytes || analytes.length === 0) continue;

    const groupName = testGroupNames.get(groupId) || analytes[0]?.test_name || 'Test Results';
    const hasCalcInGroup = analytes.some((a: any) => a.is_auto_calculated || a.is_calculated);
    const specimenText = analytes[0]?.specimen
      ? `<div class="center-subtitle">Specimen: ${analytes[0].specimen}</div>`
      : '';

    testResultsHtml += `
      <figure class="table" style="margin: 0 0 14px;">
        <table class="tbl-results">
          <thead>
            <tr>
              <th style="font-size:${basePx}px;">TEST NAME</th>
              ${flagSymbol === 'before' ? `<th style="font-size:${basePx}px;">FLAG</th>` : ''}
              <th style="font-size:${basePx}px;">VALUE</th>
              <th style="font-size:${basePx}px;">UNITS</th>
              <th style="font-size:${basePx}px;">Bio. Ref. Interval</th>
            </tr>
          </thead>
          <tbody>
            <tr class="main-group-row">
              <td colspan="${colCount}">
                <div class="center-title" style="font-size:${basePx + 1}px;">${groupName}</div>
                ${specimenText}
              </td>
            </tr>
    `;

    const sectionBlocks = groupAnalytesBySectionHeading(analytes);
    for (const block of sectionBlocks) {
      if (block.heading) {
        testResultsHtml += `
            <tr class="sub-section-header">
              <td colspan="${colCount}" style="font-size:${smallPx + 1}px;">${block.heading}</td>
            </tr>
        `;
      }

      for (const analyte of block.analytes) {
        const parameterName = analyte.parameter || analyte.name || analyte.test_name || '';
        const isCalculated    = analyte.is_auto_calculated || analyte.is_calculated;
        const rawValue        = analyte.value ?? '';
        const value           = isCalculated && rawValue !== '' && !isNaN(Number(rawValue))
          ? String(parseFloat(Number(rawValue).toFixed(2)))
          : rawValue;
        const unit          = analyte.unit || '';
        const refRange      = analyte.reference_range || '';
        const flag          = analyte.flag || '';
        const normalizedFlag  = normalizeReportFlag(flag);
        const canonicalFlag   = normalizedFlag.canonical;

        const unitText      = String(unit || '').trim().toLowerCase();
        const refText       = String(refRange || '').trim();
        const hasNumericRef = /\d/.test(refText);
        const isDescriptive =
          unitText === 'n/a' || unitText === 'na' || unitText === '-' ||
          unitText === 'none' || unitText === 'not applicable' ||
          (!unitText && refText && !hasNumericRef);

        const isNumericHigh = canonicalFlag === 'high' || canonicalFlag === 'critical_high';
        const isNumericLow  = canonicalFlag === 'low'  || canonicalFlag === 'critical_low';

        const asteriskSuffix = (printOptions?.flagAsterisk && (isNumericHigh || isNumericLow))
          ? (printOptions?.flagAsteriskCritical &&
              (canonicalFlag === 'critical_high' || canonicalFlag === 'critical_low')
              ? '***' : '**')
          : '';

        // Short flag symbol: H / L / A / H* / L*
        const flagSymbolText = (() => {
          if (!canonicalFlag || canonicalFlag === 'normal') return '';
          if (canonicalFlag === 'high') return 'H';
          if (canonicalFlag === 'low') return 'L';
          if (canonicalFlag === 'critical_high') return 'H*';
          if (canonicalFlag === 'critical_low') return 'L*';
          if (canonicalFlag === 'abnormal') return 'A';
          return '';
        })();

        const displayValue = flagSymbol === 'after' && flagSymbolText
          ? `${value + asteriskSuffix} <span style="font-weight:700;">${flagSymbolText}</span>`
          : value + asteriskSuffix;

        if (isDescriptive) {
          testResultsHtml += `
              <tr class="descriptive-row">
                <td colspan="${colCount}" style="font-size: ${basePx}px;">
                  <span style="font-weight:600;">${parameterName}</span>: ${value || refText || ''}
                </td>
              </tr>
          `;
          continue;
        }

        const valClass = canonicalFlag ? `val ${canonicalFlag}` : 'val';

        const calcSuffix = isCalculated
          ? calcMarker === 'asterisk' ? `<sup style="font-size:${smallPx - 1}px; color:#444; margin-left:1px;">*</sup>`
          : calcMarker === 'cal'      ? `<span style="font-size:${smallPx - 1}px; color:#888; margin-left:2px; font-style:italic;">*cal</span>`
          : ''
          : '';

        testResultsHtml += `
              <tr>
                <td class="test-name-cell">
                  <div class="test-name" style="font-size:${basePx}px; font-weight:${testNameWeight};">
                    ${parameterName}${calcSuffix}
                  </div>
                  ${showMethodology && analyte.method ? `<div class="test-method" style="font-size:${smallPx}px;">${analyte.method}</div>` : ''}
                </td>
                ${flagSymbol === 'before' ? `<td class="${valClass}" style="font-size:${basePx}px; text-align:center;">${flagSymbolText}</td>` : ''}
                <td class="${valClass}" style="font-size:${basePx}px;">${displayValue}</td>
                <td style="text-align:left; vertical-align:top; font-size:${basePx}px; color:#444;">${unit}</td>
                <td style="text-align:right; vertical-align:top; font-size:${smallPx + 1}px; color:#666;">${refRange}</td>
              </tr>
        `;

        if (showInterpretation) {
          let interp = '';
          if (isNumericHigh) interp = analyte.interpretation_high || '';
          else if (isNumericLow) interp = analyte.interpretation_low || '';
          else interp = analyte.interpretation_normal || '';
          if (interp) {
            testResultsHtml += `
              <tr class="interpretation-row">
                <td colspan="${colCount}" style="font-size:${smallPx}px;">${interp}</td>
              </tr>
            `;
          }
        }
      }
    }

    testResultsHtml += `
          </tbody>
        </table>
        ${(() => {
          const parts: string[] = [];
          if (hasCalcInGroup && calcMarker === 'asterisk') parts.push('* Calculated parameter');
          if (printOptions.flagAsterisk) parts.push('** Abnormal value');
          if (printOptions.flagAsterisk && printOptions.flagAsteriskCritical) parts.push('*** Critical value');
          if (showFlagLegend && flagSymbol !== 'none') parts.push('H = High &nbsp; L = Low &nbsp; A = Abnormal &nbsp; H* = Critical High &nbsp; L* = Critical Low');
          return parts.length ? `<p class="calculated-note">${parts.join(' &nbsp;|&nbsp; ')}</p>` : '';
        })()}
      </figure>
    `;
  }

  testResultsHtml += '</div>';

  const signatoryHtml = `
    <div class="report-footer">
      <div class="auth-text">Authenticated Electronic Report</div>
      <div class="signature-box">
        <div style="font-weight:700; font-size:${sigPx}px;">Dr. Signatory Name</div>
        <div style="font-size:${basePx - 1}px; margin-top:2px;">MD Pathology</div>
      </div>
    </div>
  `;

  return `
    ${noColorCss}
    <div class="basic-report-template" style="font-family: Arial, Helvetica, sans-serif; font-size: ${basePx}px; color: #000;">
      ${patientInfoHtml}
      ${testResultsHtml}
      ${signatoryHtml}
    </div>
  `;
}

// ── Controls ──────────────────────────────────────────────────────────────────

function Toggle({ checked, disabled, onChange }: { checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-indigo-500 disabled:opacity-40 ${checked ? 'bg-indigo-600' : 'bg-gray-300'}`}
    >
      <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-4' : 'translate-x-1'}`} />
    </button>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 border-b border-gray-100 last:border-0">
      <div>
        <p className="text-sm font-medium text-gray-800">{label}</p>
        {hint && <p className="text-xs text-gray-400 mt-0.5">{hint}</p>}
      </div>
      <div className="shrink-0 flex items-center">{children}</div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function BasicTemplateFormatBuilder({ printOptions, showMethodology, showInterpretation, onChange }: Props) {
  const setPO = (patch: Partial<BasicPrintOptions>) =>
    onChange({ printOptions: { ...printOptions, ...patch } });

  const html = useMemo(
    () => buildBasicHtml(SAMPLE_GROUP_NAMES, SAMPLE_ANALYTES_BY_GROUP, showMethodology, showInterpretation, printOptions),
    [printOptions, showMethodology, showInterpretation],
  );

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
        <span className="text-sm font-semibold text-gray-800">Basic (Old School) — Live Preview</span>
        <span className="ml-2 text-xs text-gray-400">Exact output from PDF engine · sample CBC data</span>
      </div>

      <div className="flex flex-col lg:flex-row divide-y lg:divide-y-0 lg:divide-x divide-gray-200">

        {/* Settings */}
        <div className="lg:w-72 shrink-0 p-4 space-y-0.5">
          <Row label="Base Font Size" hint="8 – 24 px">
            <div className="flex items-center gap-2">
              <input
                type="range" min={8} max={24} step={1}
                value={printOptions.baseFontSize ?? 11}
                onChange={(e) => setPO({ baseFontSize: Number(e.target.value) })}
                className="w-24 accent-indigo-600"
              />
              <span className="w-6 text-sm font-mono font-semibold text-gray-700">
                {printOptions.baseFontSize ?? 11}
              </span>
            </div>
          </Row>
          <Row label="Show Methodology" hint="Italic method below test name">
            <Toggle checked={showMethodology} onChange={(v) => onChange({ showMethodology: v })} />
          </Row>
          <Row label="Show Interpretation" hint="Italic text below flagged rows">
            <Toggle checked={showInterpretation} onChange={(v) => onChange({ showInterpretation: v })} />
          </Row>
          <Row label="Test Name Bold" hint="Bold test names (off = normal weight)">
            <Toggle checked={printOptions.testNameBold ?? true} onChange={(v) => setPO({ testNameBold: v })} />
          </Row>
          <Row label="Bold All Values" hint="All result values semi-bold (off = normal weight)">
            <Toggle checked={printOptions.boldAllValues ?? true} onChange={(v) => setPO({ boldAllValues: v })} />
          </Row>
          <Row label="Bold Abnormal Values" hint="Extra bold for high/low values (off = normal weight)">
            <Toggle checked={printOptions.boldAbnormalValues ?? true} onChange={(v) => setPO({ boldAbnormalValues: v })} />
          </Row>
          <Row label="Calculated Marker" hint="How to mark auto-calculated fields">
            <select
              value={printOptions.calcMarker ?? 'asterisk'}
              onChange={(e) => setPO({ calcMarker: e.target.value as 'asterisk' | 'cal' | 'none' })}
              className="text-sm border border-gray-300 rounded px-2 py-1 bg-white"
            >
              <option value="asterisk">* (superscript)</option>
              <option value="cal">*cal (text)</option>
              <option value="none">None</option>
            </select>
          </Row>
          <Row label="Section Header Style" hint="Small caps label vs inline shaded row">
            <select
              value={printOptions.sectionHeaderInline ? 'inline' : 'label'}
              onChange={(e) => setPO({ sectionHeaderInline: e.target.value === 'inline' })}
              className="text-sm border border-gray-300 rounded px-2 py-1 bg-white"
            >
              <option value="label">Small caps label</option>
              <option value="inline">Inline shaded row</option>
            </select>
          </Row>
          <Row label="Flag Symbol" hint="Show H/L symbol before or after value">
            <select
              value={printOptions.flagSymbol ?? 'none'}
              onChange={(e) => setPO({ flagSymbol: e.target.value as 'none' | 'before' | 'after', showFlagLegend: e.target.value === 'none' ? false : printOptions.showFlagLegend })}
              className="text-sm border border-gray-300 rounded px-2 py-1 bg-white"
            >
              <option value="none">None</option>
              <option value="before">Before value (column)</option>
              <option value="after">After value (inline)</option>
            </select>
          </Row>
          <Row label="Flag Legend" hint="H=High, L=Low legend below table">
            <Toggle
              checked={!!printOptions.showFlagLegend}
              disabled={(printOptions.flagSymbol ?? 'none') === 'none' && !printOptions.flagAsterisk}
              onChange={(v) => setPO({ showFlagLegend: v })}
            />
          </Row>
          <Row label="Flag Asterisk (*)" hint="Append * to H/L values">
            <Toggle
              checked={!!printOptions.flagAsterisk}
              onChange={(v) => setPO({ flagAsterisk: v, flagAsteriskCritical: v ? printOptions.flagAsteriskCritical : false })}
            />
          </Row>
          <Row label="Critical Double (**)" hint="** for critical values">
            <Toggle
              checked={!!printOptions.flagAsteriskCritical}
              disabled={!printOptions.flagAsterisk}
              onChange={(v) => setPO({ flagAsteriskCritical: v })}
            />
          </Row>
        </div>

        {/* Preview — exact HTML from edge fn */}
        <div className="flex-1 p-4 bg-gray-50 overflow-auto" style={{ maxHeight: 600 }}>
          <div dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      </div>
    </div>
  );
}
