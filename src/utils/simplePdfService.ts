import { reportBaselineCss } from '../styles/reportBaselineString';

/**
 * Lightweight PDF.co integration that requires all fields up front.
 * If any required field is missing or blank, the call rejects immediately.
 */
const PDFCO_API_KEY = import.meta.env.VITE_PDFCO_API_KEY;
const PDFCO_API_URL = 'https://api.pdf.co/v1/pdf/convert/from/html';

if (!PDFCO_API_KEY) {
  throw new Error('VITE_PDFCO_API_KEY is required for simplePdfService');
}

type NonEmptyString = string & { readonly __brand: unique symbol };

const requireString = (value: string | null | undefined, field: string): NonEmptyString => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Missing required field: ${field}`);
  }
  return value.trim() as NonEmptyString;
};

const requireResults = (results: SimpleResult[] | null | undefined): SimpleResult[] => {
  if (!Array.isArray(results) || results.length === 0) {
    throw new Error('Report results are required and must contain at least one row');
  }
  results.forEach((row, idx) => {
    requireString(row.label, `results[${idx}].label`);
    requireString(row.value, `results[${idx}].value`);
  });
  return results;
};

export interface SimpleResult {
  label: string;
  value: string;
  unit?: string;
  referenceRange?: string;
  flag?: string;
}

export interface SimpleReportRequest {
  labName: string;
  labAddress: string;
  labPhone: string;
  patientName: string;
  patientDisplayId: string;
  patientAge: string;
  patientGender: string;
  orderNumber: string;
  orderDate: string;
  sampleCollectedAt: string;
  referringDoctorName: string;
  results: SimpleResult[];
  interpretation?: string;
  footerNote?: string;
  headerLogoUrl?: string;
}

export interface SimpleTemplatePreviewRequest {
  templateHtml: string;
  name: string;
}

interface PdfCoRequest {
  name: string;
  html: string;
  displayHeaderFooter?: boolean;
  async?: boolean;
  margins?: string;
  mediaType?: 'print' | 'screen';
  printBackground?: boolean;
  scale?: number;
  header?: string;
  footer?: string;
}

const callPdfCo = async (payload: PdfCoRequest): Promise<string> => {
  const response = await fetch(PDFCO_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': PDFCO_API_KEY,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`PDF.co error: ${response.status} ${response.statusText}`);
  }

  const json = await response.json();

  if (json.error) {
    throw new Error(`PDF.co error: ${json.message || 'unknown error'}`);
  }

  if (typeof json.url !== 'string' || json.url.length === 0) {
    throw new Error('PDF.co did not return a result URL');
  }

  return json.url;
};

interface ReportFragments {
  html: string;
  header: string;
  footer: string;
}

const buildReportFragments = (input: SimpleReportRequest): ReportFragments => {
  const reportRows = input.results
    .map((row) => {
      const safeUnit = row.unit ? `<td>${row.unit}</td>` : '<td></td>';
      const safeReference = row.referenceRange ? `<td>${row.referenceRange}</td>` : '<td></td>';
      const safeFlag = row.flag ? `<td>${row.flag}</td>` : '<td></td>';
      return `
        <tr>
          <td>${row.label}</td>
          <td>${row.value}</td>
          ${safeUnit}
          ${safeReference}
          ${safeFlag}
        </tr>
      `;
    })
    .join('');

  const interpretationBlock = input.interpretation
    ? `<section class="report-section"><h3>Interpretation</h3><p>${input.interpretation}</p></section>`
    : '';

  const headerLogo = input.headerLogoUrl
    ? `<div style="display:flex; align-items:center; gap:12px;">
        <img src="${input.headerLogoUrl}" alt="${input.labName} logo" style="max-height:48px; object-fit:contain;" />
      </div>`
    : '<div></div>';

  const header = `
    <header style="width:100%; font-family:'Inter','Helvetica Neue',Arial,sans-serif; display:flex; justify-content:space-between; align-items:center; padding:8px 24px; box-sizing:border-box;">
      ${headerLogo}
      <div style="text-align:right;">
        <div style="font-size:14px; font-weight:600; color:#111827;">${input.labName}</div>
        <div style="font-size:12px; color:#4b5563;">${input.labAddress}</div>
        <div style="font-size:12px; color:#4b5563;">${input.labPhone}</div>
      </div>
    </header>
  `;

  const footer = input.footerNote
    ? `<footer style="width:100%; font-family:'Inter','Helvetica Neue',Arial,sans-serif; font-size:11px; color:#4b5563; padding:8px 24px; box-sizing:border-box; border-top:1px solid #e5e7eb;">${input.footerNote}</footer>`
    : '';

  const html = [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    `<style id="lims-report-baseline">${reportBaselineCss}</style>`,
    '<style>',
    '.simple-report { font-family: "Inter", "Helvetica Neue", Arial, sans-serif; max-width: 820px; margin: 0 auto; padding: 40px; color: #1f2937; }',
    '.simple-report h1 { font-size: 28px; margin-bottom: 12px; }',
    '.simple-report section { margin-bottom: 24px; }',
    '.simple-report table { width: 100%; border-collapse: collapse; }',
    '.simple-report th, .simple-report td { border: 1px solid #d1d5db; padding: 8px 12px; text-align: left; }',
    '.simple-report thead { background-color: #eff6ff; }',
    '.simple-report .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; }',
    '.simple-report .summary-item { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 12px; }',
    '.simple-report .label { font-size: 12px; text-transform: uppercase; color: #6b7280; letter-spacing: 0.05em; }',
    '.simple-report .value { font-size: 14px; font-weight: 600; color: #111827; margin-top: 4px; }',
  '.simple-report .report-intro { margin-bottom: 24px; }',
    '</style>',
    '</head>',
    '<body>',
    '<div class="simple-report">',
  '<section class="report-section report-intro">',
  '<h1>Laboratory Report</h1>',
  `<p style="color:#4b5563; margin-top:8px;">${input.labName}</p>`,
  '</section>',
    '<section class="report-section">',
    '<div class="summary-grid">',
    `<div class="summary-item"><div class="label">Patient Name</div><div class="value">${input.patientName}</div></div>`,
    `<div class="summary-item"><div class="label">Patient ID</div><div class="value">${input.patientDisplayId}</div></div>`,
    `<div class="summary-item"><div class="label">Age / Gender</div><div class="value">${input.patientAge} / ${input.patientGender}</div></div>`,
    `<div class="summary-item"><div class="label">Order Number</div><div class="value">${input.orderNumber}</div></div>`,
    `<div class="summary-item"><div class="label">Order Date</div><div class="value">${input.orderDate}</div></div>`,
    `<div class="summary-item"><div class="label">Sample Collected At</div><div class="value">${input.sampleCollectedAt}</div></div>`,
    `<div class="summary-item"><div class="label">Referring Doctor</div><div class="value">${input.referringDoctorName}</div></div>`,
    '</div>',
    '</section>',
    '<section class="report-section">',
    '<h2>Results</h2>',
    '<table>',
    '<thead><tr><th>Analyte</th><th>Value</th><th>Unit</th><th>Reference Range</th><th>Flag</th></tr></thead>',
    `<tbody>${reportRows}</tbody>`,
    '</table>',
    '</section>',
    interpretationBlock,
    '</div>',
    '</body>',
    '</html>',
  ].join('');

  return {
    html,
    header: header.trim(),
    footer: footer.trim(),
  };
};

const buildTemplatePreviewHtml = (templateHtml: string): string => {
  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    `<style id="lims-report-baseline">${reportBaselineCss}</style>`,
    '<style>',
    'body { margin: 0; font-family: "Inter", "Helvetica Neue", Arial, sans-serif; background: #f3f4f6; }',
    '.preview-frame { max-width: 900px; margin: 24px auto; background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; box-shadow: 0 10px 20px rgba(15, 23, 42, 0.08); overflow: hidden; }',
    '.preview-header { padding: 20px 28px; border-bottom: 1px solid #e5e7eb; display: flex; align-items: center; justify-content: space-between; }',
    '.preview-header h1 { font-size: 20px; margin: 0; color: #111827; }',
    '.preview-body { padding: 28px; }',
    '.preview-body .empty { color: #9ca3af; text-align: center; padding: 60px 0; font-size: 18px; }',
    '</style>',
    '</head>',
    '<body>',
    '<div class="preview-frame">',
    '<div class="preview-header"><h1>Template Draft Preview</h1><span style="color:#6b7280;font-size:14px;">Design snapshot</span></div>',
    '<div class="preview-body">',
    templateHtml,
    '</div>',
    '</div>',
    '</body>',
    '</html>',
  ].join('');
};

export const generateSimpleReportPdf = async (input: SimpleReportRequest): Promise<string> => {
  const validated: SimpleReportRequest = {
    labName: requireString(input.labName, 'labName'),
    labAddress: requireString(input.labAddress, 'labAddress'),
    labPhone: requireString(input.labPhone, 'labPhone'),
    patientName: requireString(input.patientName, 'patientName'),
    patientDisplayId: requireString(input.patientDisplayId, 'patientDisplayId'),
    patientAge: requireString(input.patientAge, 'patientAge'),
    patientGender: requireString(input.patientGender, 'patientGender'),
    orderNumber: requireString(input.orderNumber, 'orderNumber'),
    orderDate: requireString(input.orderDate, 'orderDate'),
    sampleCollectedAt: requireString(input.sampleCollectedAt, 'sampleCollectedAt'),
    referringDoctorName: requireString(input.referringDoctorName, 'referringDoctorName'),
    results: requireResults(input.results),
    interpretation: input.interpretation,
    footerNote: input.footerNote,
    headerLogoUrl: input.headerLogoUrl,
  };

  const { html, header, footer } = buildReportFragments(validated);
  const name = `report_${Date.now()}.pdf`;

  return callPdfCo({
    name,
    html,
    header,
    footer,
    displayHeaderFooter: true,
    async: false,
    mediaType: 'print',
    margins: '0.5in 0.5in 0.5in 0.5in',
    printBackground: true,
    scale: 1,
  });
};

export const generateSimpleTemplateDraftPdf = async (input: SimpleTemplatePreviewRequest): Promise<string> => {
  const templateHtml = requireString(input.templateHtml, 'templateHtml');
  const name = `${requireString(input.name, 'name')}.pdf`;
  const html = buildTemplatePreviewHtml(templateHtml);

  return callPdfCo({
    name,
    html,
    displayHeaderFooter: false,
    async: false,
    mediaType: 'screen',
    printBackground: true,
    margins: '0.5in 0.5in 0.5in 0.5in',
    scale: 1,
  });
};
