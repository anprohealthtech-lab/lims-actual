/**
 * buildBasicPreviewHtml.ts
 *
 * Frontend port of generateBasicDefaultTemplateHtml() from the
 * generate-pdf-letterhead edge function.
 *
 * Produces a complete standalone HTML document for the quick-preview
 * srcdoc iframe on the result-verification page.
 * Pure function — no DB calls, no external deps.
 */

export interface PreviewAnalyte {
  parameter: string;
  value: string | null;
  unit: string;
  reference_range: string;
  flag: string | null;
  section_heading?: string | null;
  is_auto_calculated?: boolean;
}

export interface PreviewTestGroup {
  testGroupName: string;
  analytes: PreviewAnalyte[];
}

export interface PreviewSection {
  sectionName: string;
  content: string;
}

export interface BuildBasicPreviewParams {
  patientName: string;
  patientCode: string;
  ageGender: string;
  orderDate: string;
  reportDate?: string;
  referredBy?: string;
  sampleId?: string;
  testGroups: PreviewTestGroup[];
  sections?: PreviewSection[];
  signatoryName?: string;
  signatoryDesignation?: string;
  printOptions?: Record<string, unknown>;
}

function normalizeFlag(flag?: string | null): string {
  const raw = String(flag || "")
    .trim()
    .toLowerCase()
    .replace(/[-\s]/g, "_");
  if (!raw) return "";
  if (["h", "high", "hh", "hi"].includes(raw)) return "high";
  if (["l", "low", "ll"].includes(raw)) return "low";
  if (
    ["critical_h", "critical_high", "criticalh", "high_critical", "h*", "ch"].includes(raw)
  )
    return "critical_high";
  if (
    ["critical_l", "critical_low", "criticall", "low_critical", "l*", "cl"].includes(raw)
  )
    return "critical_low";
  if (["c", "critical", "crit"].includes(raw)) return "critical";
  if (["a", "abnormal", "abn", "pos", "positive"].includes(raw)) return "abnormal";
  return "";
}

function getFlagSymbolText(canonical: string): string {
  if (!canonical || canonical === "normal") return "";
  if (canonical === "high") return "H";
  if (canonical === "low") return "L";
  if (canonical === "critical_high") return "H*";
  if (canonical === "critical_low") return "L*";
  if (canonical === "abnormal") return "A";
  return "";
}

export function buildBasicPreviewHtml(params: BuildBasicPreviewParams): string {
  const {
    patientName,
    patientCode,
    ageGender,
    orderDate,
    reportDate = new Date().toLocaleString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }),
    referredBy = "",
    sampleId = "",
    testGroups,
    sections = [],
    signatoryName = "",
    signatoryDesignation = "",
    printOptions = {},
  } = params;

  const basePx =
    typeof printOptions.baseFontSize === "number"
      ? Math.max(8, Math.min(24, printOptions.baseFontSize as number))
      : 11;
  const smallPx = Math.max(7, basePx - 3);
  const testNameWeight = (printOptions.testNameBold ?? true) ? "600" : "normal";
  const boldAllValues = (printOptions.boldAllValues as boolean) ?? true;
  const boldAbnormal = (printOptions.boldAbnormalValues as boolean) ?? true;
  const sectionHeaderInline = (printOptions.sectionHeaderInline as boolean) ?? false;
  const flagSymbol = (printOptions.flagSymbol as string) ?? "none";
  const showFlagLegend = (printOptions.showFlagLegend as boolean) ?? false;
  const calcMarker = (printOptions.calcMarker as string) ?? "asterisk";
  const flagAsterisk = (printOptions.flagAsterisk as boolean) ?? false;
  const flagAsteriskCritical = (printOptions.flagAsteriskCritical as boolean) ?? false;
  const colCount = flagSymbol === "before" ? 5 : 4;
  const resultColors = printOptions.resultColors as Record<string, unknown> | undefined;
  const colorsEnabled = resultColors?.enabled !== false;
  const highColor = colorsEnabled ? (String(resultColors?.high || "") || "#dc2626") : "#000000";
  const lowColor = colorsEnabled ? (String(resultColors?.low || "") || "#000000") : "#000000";

  const css = `<style>
* { box-sizing: border-box; }
body { margin: 16px; font-family: Arial, Helvetica, sans-serif; font-size: ${basePx}px; color: #000; background: #fff; }
table { border: none !important; border-collapse: collapse !important; }
td, th { color: #000 !important; font-weight: normal; background-color: #fff !important; vertical-align: top !important; }
td { padding: 2px 4px !important; }
th { padding: 3px 4px !important; }
.report-main-title {
  text-align: center; font-size: ${basePx + 3}px;
  border-top: 1.5px solid #000; border-bottom: 1.5px solid #000;
  padding: 5px 0; margin: 6px 0 10px; font-weight: 700; color: #000;
}
.patient-header-table { width: 100%; table-layout: fixed; margin-bottom: 8px; border: none !important; }
.patient-header-table th {
  width: 15%; font-weight: 700; text-align: left; color: #000;
  padding: 2px 3px !important; white-space: nowrap; border: none !important;
  font-size: ${basePx}px;
}
.patient-header-table td {
  width: 35%; padding: 2px 3px !important; border: none !important;
  color: #111 !important; word-break: break-word; font-size: ${basePx}px;
}
.tbl-results {
  width: 100%; table-layout: fixed; border-collapse: collapse;
  border: none !important; margin-top: 4px;
}
.tbl-results thead th {
  border-top: 1.5px solid #000 !important; border-bottom: 1.5px solid #000 !important;
  border-left: none !important; border-right: none !important;
  font-weight: 700; color: #000; padding: 4px 4px !important;
  font-size: ${Math.max(10, basePx - 0.5)}px; vertical-align: middle;
}
${
  flagSymbol === "before"
    ? `
.tbl-results thead th:nth-child(1) { width: 44%; text-align: left; }
.tbl-results thead th:nth-child(2) { width: 7%;  text-align: center; }
.tbl-results thead th:nth-child(3) { width: 14%; text-align: right; }
.tbl-results thead th:nth-child(4) { width: 10%; text-align: left; }
.tbl-results thead th:nth-child(5) { width: 25%; text-align: right; }
.tbl-results tbody td:nth-child(1) { width: 44%; text-align: left; color: #111 !important; }
.tbl-results tbody td:nth-child(2) { width: 7%;  text-align: center; font-weight: 700; }
.tbl-results tbody td:nth-child(3) { width: 14%; text-align: right; }
.tbl-results tbody td:nth-child(4) { width: 10%; text-align: left; color: #444 !important; white-space: nowrap; }
.tbl-results tbody td:nth-child(5) { width: 25%; text-align: right; color: #666 !important; }
`
    : `
.tbl-results thead th:nth-child(1) { width: 50%; text-align: left; }
.tbl-results thead th:nth-child(2) { width: 15%; text-align: right; }
.tbl-results thead th:nth-child(3) { width: 10%; text-align: left; }
.tbl-results thead th:nth-child(4) { width: 25%; text-align: right; }
.tbl-results tbody td:nth-child(1) { width: 50%; text-align: left; color: #111 !important; }
.tbl-results tbody td:nth-child(2) { width: 15%; text-align: right; }
.tbl-results tbody td:nth-child(3) { width: 10%; text-align: left; color: #444 !important; white-space: nowrap; }
.tbl-results tbody td:nth-child(4) { width: 25%; text-align: right; color: #666 !important; }
`
}
.tbl-results td, .tbl-results th { border: none !important; padding: 2px 4px !important; line-height: 1.28; font-size: ${basePx}px !important; }
.tbl-results tbody tr:not(.main-group-row):not(.sub-section-header):not(.descriptive-row) td {
  border-bottom: 0.5px dotted #e5e5e5 !important;
}
.test-name { font-size: ${basePx}px; font-weight: ${testNameWeight}; color: #111; line-height: 1.22; }
.val { text-align: right; vertical-align: top; font-size: ${basePx}px; font-weight: ${boldAllValues ? "600" : "normal"}; }
.val.high, .val.critical_high { color: ${highColor} !important; ${boldAbnormal ? "font-weight: 700 !important;" : ""} }
.val.low, .val.critical_low   { color: ${lowColor} !important;  ${boldAbnormal ? "font-weight: 700 !important;" : ""} }
.val.abnormal { color: ${highColor} !important; ${boldAbnormal ? "font-weight: 700 !important;" : ""} }
.main-group-row td { padding: 0 !important; border: none !important; }
.center-title {
  text-align: center; font-weight: 700; text-decoration: underline;
  font-size: ${basePx + 2}px; margin: 8px 0 0;
  text-transform: uppercase; line-height: 1.2; color: #000;
}
.sub-section-header td {
  font-weight: 700 !important;
  padding-top: ${sectionHeaderInline ? 6 : 12}px !important;
  padding-bottom: 3px !important; text-transform: uppercase !important;
  font-size: ${sectionHeaderInline ? basePx - 1 : smallPx + 1}px !important;
  border: none !important; color: #000 !important;
  ${sectionHeaderInline ? "border-bottom: 0.5px solid #ccc !important; background-color: #f5f5f5 !important;" : ""}
}
.descriptive-row td { border-bottom: 0.5px dotted #e5e5e5 !important; color: #111 !important; }
.calculated-note { font-size: ${smallPx}px; color: #444; margin: 3px 0 6px; font-style: italic; }
.report-sections { margin-top: 14px; border-top: 1px solid #000; padding-top: 6px; }
.report-sections .section-block { margin-top: 8px; font-size: ${basePx}px; }
.report-sections .section-label { font-weight: 700; margin-bottom: 2px; }
.report-footer { margin-top: 20px; padding-top: 8px; display: flex; justify-content: space-between; align-items: flex-end; }
.auth-text { font-size: ${smallPx}px; color: #444; font-style: italic; }
.signatory-box { text-align: right; }
.signatory-name { font-weight: 700; font-size: ${basePx + 1}px; }
.signatory-role { font-size: ${basePx - 1}px; margin-top: 2px; color: #333; }
@media print { body { margin: 0; } @page { margin: 12mm; } }
</style>`;

  // ── Patient header ──────────────────────────────────────────────────────────
  const patientHtml = `
  <div>
    <h2 class="report-main-title">TEST REPORT</h2>
  </div>
  <figure style="margin: 0 0 10px;">
    <table class="patient-header-table">
      <tbody>
        <tr>
          <th>Name</th><td>: ${patientName || ""}</td>
          <th>Reg. No</th><td>: ${patientCode || ""}</td>
        </tr>
        <tr>
          <th>Age / Sex</th><td>: ${ageGender || ""}</td>
          <th>Reg. Date</th><td>: ${orderDate || ""}</td>
        </tr>
        <tr>
          <th>Ref. By</th><td>: ${referredBy || ""}</td>
          <th>Report Date</th><td>: ${reportDate || ""}</td>
        </tr>
        ${sampleId ? `<tr><th>Sample ID</th><td>: ${sampleId}</td><td colspan="2"></td></tr>` : ""}
      </tbody>
    </table>
  </figure>`;

  // ── Test results (all groups) ───────────────────────────────────────────────
  let testResultsHtml = '<div class="test-results">';

  for (const group of testGroups) {
    if (!group.analytes || group.analytes.length === 0) continue;

    let hasCalcInGroup = false;

    testResultsHtml += `
  <figure style="margin: 0 0 14px;">
    <table class="tbl-results">
      <thead>
        <tr>
          <th>TEST NAME</th>
          ${flagSymbol === "before" ? `<th>FLAG</th>` : ""}
          <th>VALUE</th>
          <th>UNITS</th>
          <th>Bio. Ref. Interval</th>
        </tr>
      </thead>
      <tbody>
        <tr class="main-group-row">
          <td colspan="${colCount}">
            <div class="center-title">${group.testGroupName}</div>
          </td>
        </tr>`;

    // Group analytes by section_heading
    type SectionBlock = { heading: string | null; analytes: PreviewAnalyte[] };
    const sectionBlocks: SectionBlock[] = [];
    let currentBlock: SectionBlock = { heading: null, analytes: [] };
    for (const a of group.analytes) {
      const heading = a.section_heading ?? null;
      if (heading !== currentBlock.heading) {
        if (currentBlock.analytes.length > 0) sectionBlocks.push(currentBlock);
        currentBlock = { heading, analytes: [] };
      }
      currentBlock.analytes.push(a);
    }
    if (currentBlock.analytes.length > 0) sectionBlocks.push(currentBlock);

    const groupLegendParts: string[] = [];

    for (const block of sectionBlocks) {
      if (block.heading) {
        testResultsHtml += `
        <tr class="sub-section-header">
          <td colspan="${colCount}">${block.heading}</td>
        </tr>`;
      }

      for (const analyte of block.analytes) {
        const rawValue = analyte.value ?? "";
        const unit = analyte.unit || "";
        const refRange = analyte.reference_range || "";
        const canonical = normalizeFlag(analyte.flag);
        const isCalc = analyte.is_auto_calculated ?? false;
        if (isCalc) hasCalcInGroup = true;

        const unitText = unit.trim().toLowerCase();
        const refText = refRange.trim();
        const hasNumericRef = /\d/.test(refText);
        const isDescriptive =
          unitText === "n/a" ||
          unitText === "na" ||
          unitText === "-" ||
          unitText === "none" ||
          (!unitText && refText && !hasNumericRef);

        // *cal / *cal(text) suffix
        const calcSuffix = isCalc
          ? calcMarker === "asterisk"
            ? `<sup style="font-size:${smallPx - 1}px; color:#444; margin-left:1px;">*</sup>`
            : calcMarker === "cal"
            ? `<span style="font-size:${smallPx - 1}px; color:#888; margin-left:2px; font-style:italic;">*cal</span>`
            : ""
          : "";

        // ** / *** asterisk suffix on value
        const isNumericHigh = canonical === "high" || canonical === "critical_high";
        const isNumericLow = canonical === "low" || canonical === "critical_low";
        const asteriskSuffix = flagAsterisk && (isNumericHigh || isNumericLow)
          ? flagAsteriskCritical && (canonical === "critical_high" || canonical === "critical_low")
            ? "***"
            : "**"
          : "";

        if (isDescriptive) {
          testResultsHtml += `
        <tr class="descriptive-row">
          <td colspan="${colCount}" style="font-size:${basePx}px;">
            <span style="font-weight:600;">${analyte.parameter}${calcSuffix}</span>: ${rawValue || refText || ""}
          </td>
        </tr>`;
          continue;
        }

        const sym = flagSymbol !== "none" ? getFlagSymbolText(canonical) : "";
        const displayValue =
          flagSymbol === "after" && sym
            ? `${rawValue + asteriskSuffix} <span style="font-weight:700;">${sym}</span>`
            : rawValue + asteriskSuffix;

        const valClass = canonical ? `val ${canonical}` : "val";

        testResultsHtml += `
        <tr>
          <td class="test-name-cell">
            <div class="test-name">${analyte.parameter}${calcSuffix}</div>
          </td>
          ${flagSymbol === "before" ? `<td class="${valClass}" style="text-align:center;">${sym}</td>` : ""}
          <td class="${valClass}">${displayValue}</td>
          <td style="text-align:left; vertical-align:top; font-size:${basePx}px; color:#444;">${unit}</td>
          <td style="text-align:right; vertical-align:top; font-size:${smallPx + 1}px; color:#666;">${refRange}</td>
        </tr>`;
      }
    }

    // Per-group legend
    if (hasCalcInGroup && calcMarker === "asterisk") groupLegendParts.push("* Calculated parameter");
    if (flagAsterisk) groupLegendParts.push("** Abnormal value");
    if (flagAsterisk && flagAsteriskCritical) groupLegendParts.push("*** Critical value");
    if (showFlagLegend && flagSymbol !== "none")
      groupLegendParts.push(
        "H&nbsp;=&nbsp;High &nbsp; L&nbsp;=&nbsp;Low &nbsp; A&nbsp;=&nbsp;Abnormal &nbsp; H*&nbsp;=&nbsp;Critical High &nbsp; L*&nbsp;=&nbsp;Critical Low"
      );

    testResultsHtml += `
      </tbody>
    </table>
    ${groupLegendParts.length ? `<p class="calculated-note">${groupLegendParts.join(" &nbsp;|&nbsp; ")}</p>` : ""}
  </figure>`;
  }

  testResultsHtml += "</div>";

  // ── Report Sections (findings, impression, etc.) ────────────────────────────
  let sectionsHtml = "";
  const validSections = sections.filter(s => s.content && s.content.trim());
  if (validSections.length > 0) {
    sectionsHtml = `<div class="report-sections">`;
    for (const sec of validSections) {
      sectionsHtml += `
      <div class="section-block">
        <div class="section-label">${sec.sectionName}</div>
        <div>${sec.content}</div>
      </div>`;
    }
    sectionsHtml += `</div>`;
  }

  // ── Footer + Signatory ──────────────────────────────────────────────────────
  const signatoryBlock = (signatoryName || signatoryDesignation)
    ? `<div class="signatory-box">
        ${signatoryName ? `<div class="signatory-name">${signatoryName}</div>` : ""}
        ${signatoryDesignation ? `<div class="signatory-role">${signatoryDesignation}</div>` : ""}
      </div>`
    : "";

  const footerHtml = `
  <div class="report-footer">
    <div class="auth-text">Authenticated Electronic Report</div>
    ${signatoryBlock}
  </div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Quick Preview</title>
${css}
</head>
<body>
<div style="font-family: Arial, Helvetica, sans-serif; font-size: ${basePx}px; color: #000;">
  ${patientHtml}
  ${testResultsHtml}
  ${sectionsHtml}
  ${footerHtml}
</div>
</body>
</html>`;
}
