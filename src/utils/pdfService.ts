import { supabase } from './supabase';
import type { ReportTemplateContext, ReportTemplateAnalyteRow } from './supabase';
import nunjucks from 'nunjucks';
import { reportBaselineCss } from '../styles/reportBaselineString';
import { ensureReportRegions, extractReportRegions } from './reportTemplateRegions';

// PDF Provider Configuration
import {
  getPDFConfig,
  shouldUsePuppeteer,
  shouldFallbackToPDFCO,
  logPDFEvent,
  recordPerformanceMetrics,
  type PerformanceMetrics
} from './pdfProviderConfig';

// Puppeteer PDF generation (preferred for speed)
import {
  generatePDFWithPuppeteer,
  generatePDFStream,
  analyzePDFComplexity,
  warmupPuppeteer,
  type PDFComplexityAnalysis,
} from './pdfServicePuppeteer';

// Export configuration utilities
export {
  getPDFConfig,
  setPDFConfig,
  resetPDFConfig,
  getPerformanceStats
} from './pdfProviderConfig';

// Export Puppeteer utilities
export { warmupPuppeteer, analyzePDFComplexity };

// PDF.co API configuration (loaded from config)
const getPDFCOConfig = () => {
  const config = getPDFConfig();
  return {
    PDFCO_API_KEY: config.pdfcoApiKey,
    PDFCO_API_URL: 'https://api.pdf.co/v1/pdf/convert/from/html',
    PDFCO_JOB_STATUS_URL: 'https://api.pdf.co/v1/job/check'
  };
};

const nunjucksEnv = nunjucks.configure({
  autoescape: true,
  throwOnUndefined: false,
  trimBlocks: true,
  lstripBlocks: true,
});

const BASELINE_STYLE_TAG_ID = 'lims-report-baseline';
const REPORT_BASELINE_CLASS = 'limsv2-report';
const DEFAULT_HEADER_HTML = '';
const DEFAULT_FOOTER_HTML = '';

let brandingSanitizationEnabled = false;

export const setBrandingSanitizationEnabled = (enabled: boolean): void => {
  brandingSanitizationEnabled = enabled;
};

export const skipBrandingSanitization = (skip = true): void => {
  brandingSanitizationEnabled = !skip;
};

const sanitizeRegionHtml = (html?: string | null): string | null => {
  if (!brandingSanitizationEnabled) {
    if (typeof html !== 'string') {
      return null;
    }

    const trimmed = html.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (!html) {
    return null;
  }

  const trimmed = html.trim();
  if (!trimmed) {
    return null;
  }

  const placeholderTextVariants = new Set([
    'headercontent',
    'footercontent',
    'placeheadercontenthere',
    'placefootercontenthere',
  ]);

  let placeholderRemoved = false;
  const cleaned = trimmed
    .replace(/<[^>]*class=["'][^"']*report-region-placeholder[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/gi, (match, inner) => {
      const normalizedInner = String(inner)
        .replace(/<br\s*\/?>(\s|&nbsp;|&#160;)*?/gi, ' ')
        .replace(/&nbsp;|&#160;/gi, ' ')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, '')
        .toLowerCase();

      if (placeholderTextVariants.has(normalizedInner)) {
        placeholderRemoved = true;
        return '';
      }

      return match;
    })
    .replace(/<[^>]*data-placeholder=["']true["'][^>]*>([\s\S]*?)<\/[^>]+>/gi, (match, inner) => {
      const normalizedInner = String(inner)
        .replace(/<br\s*\/?>(\s|&nbsp;|&#160;)*?/gi, ' ')
        .replace(/&nbsp;|&#160;/gi, ' ')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, '')
        .toLowerCase();

      if (placeholderTextVariants.has(normalizedInner)) {
        placeholderRemoved = true;
        return '';
      }

      return match;
    })
    .trim();

  const workingHtml = cleaned || trimmed;

  const hasVisualElements = /<\s*(img|svg|picture|table|canvas|iframe|video|div|span)[^>]*>/i.test(workingHtml);
  const textContent = workingHtml
    .replace(/<br\s*\/?>(\s|&nbsp;|&#160;)*?/gi, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const textLower = textContent.toLowerCase();
  const isNamedPlaceholder =
    textLower === 'header content' ||
    textLower === 'footer content' ||
    textLower === 'place header content here' ||
    textLower === 'place footer content here';

  if ((placeholderRemoved && !cleaned) || isNamedPlaceholder) {
    return null;
  }

  if (!hasVisualElements && textContent.length === 0) {
    return null;
  }

  return workingHtml;
};

export interface LabTemplateRecord {
  id: string;
  lab_id: string;
  template_name: string;
  template_description?: string | null;
  test_group_id?: string | null;
  category?: string | null;
  gjs_html?: string | null;
  gjs_css?: string | null;
  gjs_project?: any;
  is_default?: boolean | null;
}

const buildDefaultTemplateContext = (): Record<string, string> => ({
  labName: 'MediLab Diagnostics',
  labAddress: '123 Health Street, Medical District, City - 560001',
  labPhone: '+91 80 1234 5678',
  labEmail: 'reports@medilab.com',
  patientName: 'Ravi Mehta',
  patientID: 'PTX100256',
  age: '45',
  sex: 'Male',
  collectionDate: '2025-06-28',
  reportDate: '2025-06-29',
  doctorName: 'Dr. Anjali Desai',
  interpretationNotes: 'All parameters are within expected ranges for the provided demographic profile.',
  hemoglobin: '14.2',
  hematocrit: '42',
  rbcCount: '5.10',
  mcv: '88',
  mch: '30',
  mchc: '34',
  rdw: '12.5',
  wbcCount: '6.2',
  neutrophilsPct: '58',
  lymphocytesPct: '32',
  monocytesPct: '6',
  eosinophilsPct: '3',
  basophilsPct: '1',
  plateletCount: '245',
});

export const buildSampleTemplateContext = (overrides: Record<string, any> = {}): Record<string, any> => ({
  ...buildDefaultTemplateContext(),
  ...overrides,
});

const normalizeDateValue = (value: string | null | undefined): string => {
  if (!value) {
    return '';
  }

  try {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toISOString();
  } catch (error) {
    console.warn('Failed to normalize date value:', value, error);
    return value ?? '';
  }
};

const buildContextFromReportTemplate = (context: ReportTemplateContext): Record<string, any> => {
  const patient = context.patient ?? ({} as ReportTemplateContext['patient']);
  const order = context.order ?? ({} as ReportTemplateContext['order']);
  const meta = context.meta ?? ({} as ReportTemplateContext['meta']);

  const derived: Record<string, any> = {
    orderId: context.orderId,
    orderNumber: meta?.orderNumber ?? context.orderId,
    labId: context.labId ?? '',
    patientId: context.patientId ?? patient?.displayId ?? '',
    patientName: patient?.name ?? '',
    patientDisplayId: patient?.displayId ?? '',
    patientPhone: patient?.phone ?? '',
    age: patient?.age ?? '',
    sex: patient?.gender ?? '',
    gender: patient?.gender ?? '',
    dateOfBirth: patient?.dateOfBirth ? normalizeDateValue(patient.dateOfBirth) : '',
    patientRegistrationDate: patient?.registrationDate ? normalizeDateValue(patient.registrationDate) : '',
    sampleId: order?.sampleId ?? '',
    sampleCollectedAt: order?.sampleCollectedAt ? normalizeDateValue(order.sampleCollectedAt) : '',
    sampleCollectedBy: order?.sampleCollectedBy ?? '',
    locationName: order?.locationName ?? '',
    referringDoctorName: order?.referringDoctorName ?? '',
    doctorName: order?.referringDoctorName ?? '',
    approvedAt: order?.approvedAt ? normalizeDateValue(order.approvedAt) : '',
    reportDate: meta?.createdAt ? normalizeDateValue(meta.createdAt) : new Date().toISOString(),
    orderDate: meta?.orderDate ? normalizeDateValue(meta.orderDate) : '',
    orderStatus: meta?.status ?? '',
    totalAmount: meta?.totalAmount ?? '',
    allAnalytesApproved: meta?.allAnalytesApproved ?? false,
  };

  return Object.fromEntries(
    Object.entries(derived).filter(([, value]) => value !== undefined && value !== null)
  );
};

export interface TemplateRenderOptions {
  context?: ReportTemplateContext | null;
  overrides?: Record<string, any>;
  brandingDefaults?: LabBrandingHtmlDefaults;
}

interface BuildReportHtmlOptions {
  html: string;
  css?: string | null;
  brandingDefaults?: LabBrandingHtmlDefaults;
}

const sanitizeHtmlFragment = (raw: string): string => {
  if (!raw) {
    return '';
  }

  let working = raw
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
    .replace(/<\/?html[^>]*>/gi, '')
    .replace(/<head[\s\S]*?<\/head>/gi, '');

  const bodyMatch = working.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) {
    working = bodyMatch[1];
  }

  working = working.replace(/\u00a0/g, ' ').replace(/undefined\s*:\s*undefined;?/gi, '');

  working = working.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, (block) => {
    const css = block.replace(/<\/?style[^>]*>/gi, '').trim();
    if (!css) {
      return '';
    }

    const normalized = css.replace(/\s+/g, '').toLowerCase();
    const shouldDrop =
      normalized.includes('*{box-sizing:border-box;}body{margin:0;}') ||
      normalized.includes('undefined:undefined');

    return shouldDrop ? '' : block;
  });

  return ensureReportRegions(working.trim());
};

const normalizeCustomCss = (css?: string | null): string => {
  if (!css) {
    return '';
  }

  return css.replace(/\u00a0/g, ' ').replace(/undefined\s*:\s*undefined;?/gi, '').trim();
};

const CUSTOM_STYLE_TAG_ID = 'lims-report-custom';

const renderTemplateWithContext = (html: string, context: Record<string, any>): string => {
  try {
    return nunjucksEnv.renderString(html, context);
  } catch (error) {
    console.error('Failed to render lab template with nunjucks:', error);
    return html;
  }
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface ReportHtmlBundle {
  previewHtml: string;
  bodyHtml: string;
  headerHtml: string;
  footerHtml: string;
  customCss?: string;
}

interface PreparedReportHtml {
  html: string;
  bundle: ReportHtmlBundle | null;
  filenameBase: string;
  brandingDefaults: LabBrandingHtmlDefaults;
}

const buildPreviewDocument = (
  bodyHtml: string,
  headerHtml: string,
  footerHtml: string,
  customCss: string,
  brandingDefaults?: LabBrandingHtmlDefaults
): string => {
  const styles = [
    `<style id="${BASELINE_STYLE_TAG_ID}">${reportBaselineCss}</style>`,
    customCss ? `<style id="${CUSTOM_STYLE_TAG_ID}">${customCss}</style>` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const fallbackHeader = sanitizeBrandingRegion(brandingDefaults?.headerHtml);
  const fallbackFooter = sanitizeBrandingRegion(brandingDefaults?.footerHtml);
  const resolvedHeader = sanitizeRegionHtml(headerHtml) ?? fallbackHeader ?? DEFAULT_HEADER_HTML;
  const resolvedFooter = sanitizeRegionHtml(footerHtml) ?? fallbackFooter ?? DEFAULT_FOOTER_HTML;
  const resolvedBody = bodyHtml || '<p></p>';

  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    styles,
    '</head>',
    '<body>',
    '<div class="limsv2-report">',
    `<header class="limsv2-report-header">${resolvedHeader}</header>`,
    `<main class="limsv2-report-body">${resolvedBody}</main>`,
    `<footer class="limsv2-report-footer">${resolvedFooter}</footer>`,
    '</div>',
    '</body>',
    '</html>',
  ].join('');
};

const buildPdfBodyDocument = (bodyHtml: string, customCss: string): string => {
  const styles = [
    `<style id="${BASELINE_STYLE_TAG_ID}">${reportBaselineCss}</style>`,
    customCss ? `<style id="${CUSTOM_STYLE_TAG_ID}">${customCss}</style>` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    styles,
    '</head>',
    '<body>',
    '<div class="limsv2-report">',
    `<main class="limsv2-report-body limsv2-report-body--pdf">${bodyHtml || '<p></p>'}</main>`,
    '</div>',
    '</body>',
    '</html>',
  ].join('');
};

/**
 * Build print-optimized HTML document for physical letterhead printing
 * - Wraps body in full HTML with baseline CSS
 * - Adds print-specific class for styling
 * - Removes backgrounds, watermarks, and digital header/footer
 * - Adds top padding for pre-printed letterhead area
 */
const buildPrintBodyDocument = (bodyHtml: string, customCss: string): string => {
  // Print-specific CSS overrides
  const printCss = `
    /* Print-optimized styles for physical letterhead */
    .limsv2-report--print {
      background: none !important;
    }
    
    .limsv2-report--print .limsv2-report-body {
      padding-top: 80px;  /* Space for pre-printed letterhead */
      padding-bottom: 40px;
      background: none !important;
    }
    
    /* Hide all digital branding elements */
    .limsv2-report--print img[data-role="watermark"],
    .limsv2-report--print img[data-role="logo"],
    .limsv2-report--print .lab-header-branding,
    .limsv2-report--print .lab-footer-branding,
    .limsv2-report--print .digital-only {
      display: none !important;
    }
    
    /* Remove all background colors and gradients */
    .limsv2-report--print .test-group-section,
    .limsv2-report--print .result-table,
    .limsv2-report--print th,
    .limsv2-report--print td {
      background: none !important;
      background-color: transparent !important;
      background-image: none !important;
    }
    
    /* Keep neutral text colors */
    .limsv2-report--print {
      color: #000 !important;
    }
    
    .limsv2-report--print h1,
    .limsv2-report--print h2,
    .limsv2-report--print h3 {
      color: #000 !important;
    }
    
    /* Clean table formatting */
    .limsv2-report--print table {
      border-collapse: collapse;
      width: 100%;
    }
    
    .limsv2-report--print th,
    .limsv2-report--print td {
      border: 1px solid #ccc;
      padding: 6px 8px;
      color: #000;
    }
    
    /* Page breaks between test groups */
    @media print {
      .test-group-separator {
        page-break-before: always;
      }
      
      .test-group-section {
        page-break-inside: avoid;
      }
    }
    
    /* Keep doctor signature visible */
    .limsv2-report--print .doctor-signature {
      display: block !important;
    }
    
    /* Remove editor placeholders */
    .limsv2-report--print h2:empty,
    .limsv2-report--print p:empty {
      display: none;
    }
  `;

  const styles = [
    `<style id="${BASELINE_STYLE_TAG_ID}">${reportBaselineCss}</style>`,
    customCss ? `<style id="${CUSTOM_STYLE_TAG_ID}">${customCss}</style>` : '',
    `<style id="print-overrides">${printCss}</style>`,
  ]
    .filter(Boolean)
    .join('\n');

  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    styles,
    '</head>',
    '<body>',
    '<div class="limsv2-report limsv2-report--print">',
    `<main class="limsv2-report-body limsv2-report-body--print">${bodyHtml || '<p></p>'}</main>`,
    '</div>',
    '</body>',
    '</html>',
  ].join('');
};

export const buildReportHtmlBundle = (options: BuildReportHtmlOptions): ReportHtmlBundle => {
  const fragment = sanitizeHtmlFragment(options.html);
  const customCss = normalizeCustomCss(options.css);
  const regions = extractReportRegions(fragment);

  return {
    previewHtml: buildPreviewDocument(
      regions.bodyHtml,
      regions.headerHtml,
      regions.footerHtml,
      customCss,
      options.brandingDefaults
    ),
    bodyHtml: buildPdfBodyDocument(regions.bodyHtml, customCss),
    headerHtml: regions.headerHtml,
    footerHtml: regions.footerHtml,
    customCss,
  };
};


const buildReportFilenameBase = (reportData: ReportData, isDraft: boolean): string => {
  const safePatient = (reportData.patient?.name || 'Patient').replace(/\s+/g, '_');
  const reportId = reportData.report?.reportId || 'Report';
  return `${safePatient}_${reportId}${isDraft ? '_DRAFT' : ''}`;
};

export const buildReportHtml = (options: BuildReportHtmlOptions): string =>
  buildReportHtmlBundle(options).previewHtml;

interface PdfCoRequestOptions {
  displayHeaderFooter?: boolean;
  headerHtml?: string;
  footerHtml?: string;
  headerHeight?: string;
  footerHeight?: string;
  margins?: string;
  mediaType?: 'print' | 'screen';
  printBackground?: boolean;
  scale?: number;
}

const pollPdfCoJob = async (jobId: string, maxAttempts = 60, intervalMs = 3000): Promise<string> => {
  const { PDFCO_API_KEY, PDFCO_JOB_STATUS_URL } = getPDFCOConfig();
  
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    await delay(intervalMs);

    const response = await fetch(PDFCO_JOB_STATUS_URL, {
      method: 'POST',
      headers: {
        'x-api-key': PDFCO_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ jobid: jobId }),
    });

    if (!response.ok) {
      throw new Error(`PDF.co job status error: ${response.status} ${response.statusText}`);
    }

    const statusPayload = await response.json();
    const status = (statusPayload.status || '').toLowerCase();

    if (status === 'success' && statusPayload.url) {
      return statusPayload.url;
    }

    if (status === 'working' || status === 'waiting') {
      continue;
    }

    const errorMessage = statusPayload.message || statusPayload.error || `Job returned status: ${status}`;
    throw new Error(`PDF.co job failed: ${errorMessage}`);
  }

  throw new Error('PDF.co job polling exceeded maximum attempts');
};

const sendHtmlToPdfCo = async (
  htmlContent: string,
  filename: string,
  options: PdfCoRequestOptions = {}
): Promise<string> => {
  const { PDFCO_API_KEY, PDFCO_API_URL } = getPDFCOConfig();
  
  if (!PDFCO_API_KEY) {
    throw new Error('PDF.co API key not configured');
  }

  const margins = options.margins ?? '40px 20px 40px 20px';
  const mediaType = options.mediaType ?? 'print';
  const printBackground = options.printBackground ?? true;
  const scale = options.scale ?? 1.0;
  const displayHeaderFooter = options.displayHeaderFooter ?? true;

  // ALWAYS include header/footer fields, even if empty
  const headerHtml = options.headerHtml ?? '';
  const footerHtml = options.footerHtml ?? '';
  
  // 📊 Log PDF.co request for debugging
  console.log('📄 PDF.co generation request:');
  console.log('  Filename:', filename);
  console.log('  Media type:', mediaType);
  console.log('  Display header/footer:', displayHeaderFooter);
  console.log('  Print background:', printBackground);
  console.log('  Margins:', margins);
  console.log('  HTML length:', htmlContent.length);
  console.log('  HTML preview:', htmlContent.substring(0, 500));
  
  // Extract test sections from HTML for debugging
  const testSections = htmlContent.match(/data-test="([^"]+)"/g);
  if (testSections) {
    console.log('  Tests in HTML:', testSections.join(', '));
  } else {
    console.log('  No data-test attributes found in HTML');
  }
  
  console.log('Raw header HTML (before JSON):', headerHtml);
  console.log('Raw footer HTML (before JSON):', footerHtml);
  
  const requestBody = {
    name: filename,
    html: htmlContent,
    async: true,
    margins,
    paperSize: 'A4',
    orientation: 'portrait',
    printBackground,
    scale,
    mediaType,
    displayHeaderFooter,
    header: headerHtml,
    footer: footerHtml,
  };

  // Add header/footer height if specified
  if (options.headerHeight) {
    (requestBody as Record<string, any>).headerHeight = options.headerHeight;
  }
  if (options.footerHeight) {
    (requestBody as Record<string, any>).footerHeight = options.footerHeight;
  }

  const response = await fetch(PDFCO_API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': PDFCO_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    throw new Error(`PDF.co API error: ${response.status} ${response.statusText}`);
  }

  const result = await response.json();

  if (result.error) {
    throw new Error(`PDF.co API error: ${result.message}`);
  }

  if (result.url) {
    console.log('PDF generated synchronously:', result.url);
    return result.url;
  }

  if (result.jobId) {
    console.log('PDF.co async job queued:', result.jobId);
    return pollPdfCoJob(result.jobId);
  }

  throw new Error('PDF.co API did not return a result URL or jobId');
};

const sendPrintHtmlToPdfCo = async (
  bundle: ReportHtmlBundle,
  filename: string
): Promise<PrintPdfResult> => {
  // 📊 Log print HTML for debugging
  console.log('📄 Print PDF generation:');
  console.log('  Filename:', filename);
  console.log('  Body HTML length:', bundle.bodyHtml.length);
  console.log('  Body HTML preview:', bundle.bodyHtml.substring(0, 500));
  
  // Extract test sections from HTML for debugging
  const testSections = bundle.bodyHtml.match(/data-test="([^"]+)"/g);
  if (testSections) {
    console.log('  Tests in print HTML:', testSections.join(', '));
  } else {
    console.log('  No data-test attributes found in print HTML');
  }
  
  // Build full print-optimized HTML document (not fragment)
  const customCss = bundle.customCss || '';
  const printHtml = buildPrintBodyDocument(bundle.bodyHtml, customCss);
  
  console.log('  Full print HTML length:', printHtml.length);
  console.log('  Print HTML has proper structure:', printHtml.includes('limsv2-report--print'));
  
  // Send full HTML document with print-optimized settings
  const url = await sendHtmlToPdfCo(printHtml, filename, {
    headerHtml: '',
    footerHtml: '',
    mediaType: 'print',
    printBackground: false,  // No backgrounds - using physical letterhead
    displayHeaderFooter: false,  // No Chrome header/footer reservation
    margins: '40px 20px 40px 20px',  // Safe print margins
  });

  return {
    url,
    headerHtml: null,  // No header for print version
    footerHtml: null,  // No footer for print version
  };
};

export const renderLabTemplateHtmlBundle = (
  template: LabTemplateRecord,
  options: TemplateRenderOptions = {}
): ReportHtmlBundle => {
  if (!template?.gjs_html) {
    throw new Error('Template is missing HTML content');
  }

  const baseContext = buildSampleTemplateContext();
  let renderContext: Record<string, any> = { ...baseContext };

  if (options.context) {
    const derivedContext = buildContextFromReportTemplate(options.context);
    const placeholderValues = options.context.placeholderValues ?? {};
    renderContext = {
      ...renderContext,
      ...derivedContext,
      ...placeholderValues,
    };
  }

  if (options.overrides) {
    renderContext = {
      ...renderContext,
      ...options.overrides,
    };
  }

  const rendered = renderTemplateWithContext(template.gjs_html, renderContext);
  return buildReportHtmlBundle({
    html: rendered,
    css: template.gjs_css,
    brandingDefaults: options.brandingDefaults,
  });
};

export const renderLabTemplateHtml = (
  template: LabTemplateRecord,
  options: TemplateRenderOptions = {}
): string => renderLabTemplateHtmlBundle(template, options).previewHtml;

const convertImageUrlToBase64 = async (imageUrl: string): Promise<string> => {
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status}`);
    }
    
    const arrayBuffer = await response.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
    
    // Detect image format from URL or response headers
    const contentType = response.headers.get('content-type') || 'image/png';
    return `data:${contentType};base64,${base64}`;
  } catch (error) {
    console.warn('Failed to convert image to base64:', error);
    return '';
  }
};

const convertHtmlImagestoBase64 = async (html: string): Promise<string> => {
  if (!html || html.trim().length === 0) {
    return '';
  }

  // Find all img tags with src attributes
  const imgRegex = /<img([^>]*src=['"]([^'"]+)['"][^>]*)>/gi;
  const matches = [...html.matchAll(imgRegex)];
  
  let convertedHtml = html;
  
  for (const match of matches) {
    const fullImgTag = match[0];
    const imageUrl = match[2];
    
    // Skip if already base64
    if (imageUrl.startsWith('data:')) {
      continue;
    }
    
    try {
      const base64Src = await convertImageUrlToBase64(imageUrl);
      if (base64Src) {
        const newImgTag = fullImgTag.replace(imageUrl, base64Src);
        convertedHtml = convertedHtml.replace(fullImgTag, newImgTag);
        console.log(`Converted image URL to base64: ${imageUrl.substring(0, 50)}...`);
      }
    } catch (error) {
      console.warn(`Failed to convert image ${imageUrl}:`, error);
    }
  }
  
  return convertedHtml;
};

export const generateTemplatePreviewPDF = async (
  template: LabTemplateRecord,
  options: TemplateRenderOptions = {},
  allTemplates?: LabTemplateRecord[]
): Promise<string> => {
  const context = options.context;
  
  // Check if we need multi-template rendering
  const hasMultipleTestGroups = context?.testGroupIds && context.testGroupIds.length > 1;
  
  if (hasMultipleTestGroups && allTemplates && allTemplates.length > 0) {
    console.log('🔀 Preview: Multi-template mode for', context!.testGroupIds!.length, 'test groups');
    
    // Create temporary reportData for multi-template rendering
    const reportData: ReportData = {
      patient: {
        name: context!.patient?.name || 'Patient',
        id: context!.patientId || 'Unknown',
        age: typeof context!.patient?.age === 'number' ? context!.patient.age : 0,
        gender: context!.patient?.gender || 'Unknown',
        referredBy: context!.order?.referringDoctorName || 'Self',
      },
      report: {
        reportId: context!.orderId,
        collectionDate: context!.order?.sampleCollectedAt || '',
        reportDate: new Date().toISOString(),
        reportType: 'Preview',
      },
      testResults: [],
      labTemplateRecord: template,
      templateContext: context!,
      placeholderOverrides: options.overrides,
      labBrandingDefaults: options.brandingDefaults,
    };
    
    const brandingDefaults = resolveBrandingDefaultsFromOptions(options);
    const { html } = await renderMultipleTestGroupTemplates(
      reportData,
      false,
      brandingDefaults,
      allTemplates
    );
    
    // Get lab branding defaults
    const { data: labDefaults } = await supabase
      .from('labs')
      .select('default_report_header_html, default_report_footer_html')
      .eq('id', template.lab_id)
      .maybeSingle();

    const rawHeaderHtml = labDefaults?.default_report_header_html || '';
    const rawFooterHtml = labDefaults?.default_report_footer_html || '';
    
    const headerHtml = await convertHtmlImagestoBase64(rawHeaderHtml);
    const footerHtml = await convertHtmlImagestoBase64(rawFooterHtml);
    
    const filename = `Multi_Template_Preview_${Date.now()}.pdf`;
    return sendHtmlToPdfCo(html, filename, {
      displayHeaderFooter: true,
      headerHtml,
      footerHtml,
      headerHeight: '90px',
      footerHeight: '80px',
      mediaType: 'print',
      printBackground: true,
    });
  }
  
  // Single template rendering (original logic)
  // Get lab branding defaults from database
  const { data: labDefaults } = await supabase
    .from('labs')
    .select('default_report_header_html, default_report_footer_html')
    .eq('id', template.lab_id)
    .maybeSingle();

  const rawHeaderHtml = labDefaults?.default_report_header_html || '';
  const rawFooterHtml = labDefaults?.default_report_footer_html || '';
  
  // Convert images to base64
  const headerHtml = await convertHtmlImagestoBase64(rawHeaderHtml);
  const footerHtml = await convertHtmlImagestoBase64(rawFooterHtml);
  
  const brandingDefaults = resolveBrandingDefaultsFromOptions(options);
  const htmlDocument = renderLabTemplateHtml(template, {
    ...options,
    brandingDefaults,
  });
  const filename = `${template.template_name?.replace(/\s+/g, '_') || 'Template'}_Preview.pdf`;
  return sendHtmlToPdfCo(htmlDocument, filename, {
    displayHeaderFooter: true,
    headerHtml,
    footerHtml,
    headerHeight: '90px',
    footerHeight: '80px',
    mediaType: 'print',
    printBackground: true,
  });
};

// Interfaces from pdfGenerator.ts
export interface LabTemplate {
  id: string;
  name: string;
  header: {
    labName: string;
    address: string;
    phone: string;
    email: string;
    logo?: string;
  };
  footer: {
    signature: string;
    authorizedBy: string;
    disclaimer?: string;
  };
  styling: {
    primaryColor: string;
    secondaryColor: string;
    fontFamily: string;
  };
}

export interface PatientInfo {
  name: string;
  id: string;
  age: number;
  gender: string;
  referredBy?: string;
}

export interface ReportDetails {
  reportId: string;
  collectionDate: string;
  reportDate: string;
  reportType: string;
}

export interface TestResult {
  parameter: string;
  result: string;
  unit: string;
  referenceRange: string;
  flag?: string;
}

export interface ReportData {
  patient: PatientInfo;
  report: ReportDetails;
  testResults: TestResult[];
  interpretation?: string;
  template?: LabTemplate;
  labTemplateRecord?: LabTemplateRecord | null;
  templateContext?: ReportTemplateContext | null;
  placeholderOverrides?: Record<string, any>;
  labBrandingDefaults?: LabBrandingHtmlDefaults;
}

export interface LabBrandingHtmlDefaults {
  headerHtml?: string | null;
  footerHtml?: string | null;
}

// Default lab template
export const defaultLabTemplate: LabTemplate = {
  id: 'medilab-default',
  name: 'MediLab Diagnostics Default',
  header: {
    labName: 'MediLab Diagnostics',
    address: '123 Health Street, Medical District, City - 560001',
    phone: '+91 80 1234 5678',
    email: 'reports@medilab.com',
  },
  footer: {
    signature: 'Digital Signature',
    authorizedBy: 'Dr. Sarah Wilson, MD',
    disclaimer: 'This report is generated electronically and is valid without signature.',
  },
  styling: {
    primaryColor: '#2563eb',
    secondaryColor: '#64748b',
    fontFamily: 'Arial, sans-serif',
  },
};

const normalizeString = (value: string | null | undefined): string => {
  return value ? value.toLowerCase().trim() : '';
};

const pickFirstHtmlValue = (...values: (unknown | null | undefined)[]): string | null => {
  for (const candidate of values) {
    if (typeof candidate === 'string') {
      if (candidate.trim().length > 0) {
        return candidate;
      }
    }
  }
  return null;
};

const resolveBrandingDefaultsFromContext = (context?: ReportTemplateContext | null): LabBrandingHtmlDefaults => {
  if (!context) {
    return {};
  }

  const placeholders = (context.placeholderValues ?? {}) as Record<string, unknown>;
  const branding = context.labBranding;

  const headerCandidate = pickFirstHtmlValue(
    branding?.defaultHeaderHtml,
    placeholders['labDefaultHeaderHtml'],
    placeholders['lab_default_header_html']
  );

  const footerCandidate = pickFirstHtmlValue(
    branding?.defaultFooterHtml,
    placeholders['labDefaultFooterHtml'],
    placeholders['lab_default_footer_html']
  );

  return {
    headerHtml: headerCandidate,
    footerHtml: footerCandidate,
  };
};

const resolveReportBrandingDefaults = (reportData: ReportData): LabBrandingHtmlDefaults => {
  const overrides = (reportData.placeholderOverrides ?? {}) as Record<string, unknown>;

  const overrideHeader = pickFirstHtmlValue(
    overrides['labDefaultHeaderHtml'],
    overrides['lab_default_header_html']
  );

  const overrideFooter = pickFirstHtmlValue(
    overrides['labDefaultFooterHtml'],
    overrides['lab_default_footer_html']
  );

  const dataDefaults = reportData.labBrandingDefaults ?? {};
  const contextDefaults = resolveBrandingDefaultsFromContext(reportData.templateContext);

  return {
    headerHtml: pickFirstHtmlValue(
      overrideHeader,
      dataDefaults.headerHtml,
      contextDefaults.headerHtml
    ),
    footerHtml: pickFirstHtmlValue(
      overrideFooter,
      dataDefaults.footerHtml,
      contextDefaults.footerHtml
    ),
  };
};

const resolveBrandingDefaultsFromOptions = (options: TemplateRenderOptions = {}): LabBrandingHtmlDefaults => {
  const overrides = (options.overrides ?? {}) as Record<string, unknown>;

  const overrideHeader = pickFirstHtmlValue(
    overrides['labDefaultHeaderHtml'],
    overrides['lab_default_header_html']
  );

  const overrideFooter = pickFirstHtmlValue(
    overrides['labDefaultFooterHtml'],
    overrides['lab_default_footer_html']
  );

  const explicitDefaults = options.brandingDefaults ?? {};
  const contextDefaults = resolveBrandingDefaultsFromContext(options.context ?? null);

  return {
    headerHtml: pickFirstHtmlValue(
      overrideHeader,
      explicitDefaults.headerHtml,
      contextDefaults.headerHtml
    ),
    footerHtml: pickFirstHtmlValue(
      overrideFooter,
      explicitDefaults.footerHtml,
      contextDefaults.footerHtml
    ),
  };
};

const sanitizeBrandingRegion = (html?: string | null): string => {
  if (!brandingSanitizationEnabled) {
    if (typeof html !== 'string') {
      return '';
    }

    const trimmed = html.trim();
    return trimmed.length > 0 ? trimmed : '';
  }

  if (typeof html !== 'string') {
    return '';
  }

  const sanitized = sanitizeRegionHtml(html);
  if (sanitized && sanitized.trim().length > 0) {
    return sanitized;
  }

  const trimmed = html.trim();
  return trimmed.length > 0 ? trimmed : '';
};

const createTestResultLabel = (row: ReportTemplateAnalyteRow): string => {
  const parameter = row.parameter?.trim();
  const testName = row.test_name?.trim();

  if (parameter && testName) {
    const normalizedParameter = parameter.toLowerCase();
    const normalizedTestName = testName.toLowerCase();
    if (normalizedParameter.includes(normalizedTestName)) {
      return parameter;
    }
    return `${testName} - ${parameter}`;
  }

  return parameter || testName || 'Analyte';
};

const buildTestResultsFromAnalytes = (
  analytes: ReportTemplateAnalyteRow[],
  includeUnapproved = true
): TestResult[] => {
  const filtered = includeUnapproved
    ? analytes
    : analytes.filter((row) => !row.verify_status || row.verify_status === 'approved');

  if (!filtered.length) {
    return [];
  }

  const seenKeys = new Set<string>();

  return filtered.reduce<TestResult[]>((results, row) => {
    const label = createTestResultLabel(row);
    const dedupeKey = `${row.result_id ?? ''}::${label}`;
    if (seenKeys.has(dedupeKey)) {
      return results;
    }

    seenKeys.add(dedupeKey);

    results.push({
      parameter: label,
      result: row.value ?? '—',
      unit: row.unit ?? '',
      referenceRange: row.reference_range ?? '',
      flag: row.flag ?? '',
    });

    return results;
  }, []);
};

export const selectTemplateForContext = (
  templates: LabTemplateRecord[],
  context: ReportTemplateContext
): LabTemplateRecord | null => {
  if (!Array.isArray(templates) || !templates.length) {
    return null;
  }

  const templatesWithHtml = templates.filter((tpl) => tpl?.gjs_html);
  if (!templatesWithHtml.length) {
    return null;
  }

  const testGroupIds = Array.isArray(context.testGroupIds) ? context.testGroupIds : [];
  if (testGroupIds.length) {
    const byGroup = templatesWithHtml.find(
      (tpl) => tpl.test_group_id && testGroupIds.includes(tpl.test_group_id)
    );
    if (byGroup) {
      return byGroup;
    }
  }

  const analyteNames = new Set(
    (context.analytes || [])
      .map((row) => normalizeString(row.test_name || row.parameter))
      .filter(Boolean)
  );

  if (analyteNames.size) {
    const byName = templatesWithHtml.find((tpl) => {
      const templateName = normalizeString(tpl.template_name ?? '');
      if (!templateName) {
        return false;
      }
      return Array.from(analyteNames).some((name) => templateName.includes(name));
    });

    if (byName) {
      return byName;
    }
  }

  const defaultTemplate = templatesWithHtml.find((tpl) => tpl.is_default);
  return defaultTemplate ?? templatesWithHtml[0];
};

interface CreateReportDataOptions {
  template?: LabTemplateRecord | null;
  isDraft?: boolean;
}

const coerceNumber = (value: unknown): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

const resolveReportType = (
  context: ReportTemplateContext,
  isDraft: boolean | undefined
): string => {
  const placeholders = context.placeholderValues ?? {};
  const preferredValue =
    placeholders['report_type'] ??
    placeholders['reportType'] ??
    placeholders['report_title'] ??
    placeholders['reportTitle'] ??
    placeholders['test_panel_name'];

  const baseType = typeof preferredValue === 'string' && preferredValue.trim()
    ? preferredValue.trim()
    : 'Lab Tests';

  if (isDraft) {
    return `${baseType} (DRAFT)`;
  }

  return baseType;
};

const resolveInterpretation = (
  context: ReportTemplateContext,
  isDraft: boolean | undefined
): string => {
  const placeholders = context.placeholderValues ?? {};
  const interpretationValue =
    placeholders['report_interpretation'] ??
    placeholders['reportInterpretation'] ??
    placeholders['interpretation_summary'] ??
    placeholders['interpretationSummary'] ??
    placeholders['interpretation'];

  if (typeof interpretationValue === 'string' && interpretationValue.trim()) {
    return interpretationValue.trim();
  }

  if (isDraft) {
    return 'DRAFT REPORT: Some results may still be pending verification.';
  }

  return 'Final report based on approved lab results.';
};

export const createReportDataFromContext = (
  context: ReportTemplateContext,
  options: CreateReportDataOptions = {}
): ReportData => {
  const patient = context.patient ?? ({} as ReportTemplateContext['patient']);
  const order = context.order ?? ({} as ReportTemplateContext['order']);
  const isDraft = options.isDraft ?? false;

  const testResults = buildTestResultsFromAnalytes(context.analytes || [], isDraft);

  const reportData: ReportData = {
    patient: {
      name: patient?.name ?? 'Patient',
      id: context.patientId ?? patient?.displayId ?? 'Unknown',
      age: coerceNumber(patient?.age),
      gender: patient?.gender ?? 'Unknown',
      referredBy: order?.referringDoctorName ?? 'Self',
    },
    report: {
      reportId: context.orderId,
      collectionDate: order?.sampleCollectedAt ?? context.meta?.orderDate ?? '',
      reportDate: new Date().toISOString(),
      reportType: resolveReportType(context, isDraft),
    },
    testResults: testResults.length ? testResults : [
      {
        parameter: 'No analytes available',
        result: '—',
        unit: '',
        referenceRange: '',
      },
    ],
    interpretation: resolveInterpretation(context, isDraft),
    template: options.template ? undefined : defaultLabTemplate,
    labTemplateRecord: options.template ?? null,
    templateContext: context,
    placeholderOverrides: { ...(context.placeholderValues ?? {}) },
    labBrandingDefaults: resolveBrandingDefaultsFromContext(context),
  };

  return reportData;
};

// Template management functions
export const saveLabTemplate = (template: LabTemplate): void => {
  try {
    const templates = getLabTemplates();
    const updatedTemplates = templates.filter(t => t.id !== template.id);
    updatedTemplates.push(template);
    localStorage.setItem('lims_lab_templates', JSON.stringify(updatedTemplates));
  } catch (error) {
    console.error('Error saving lab template:', error);
  }
};

export const getLabTemplates = (): LabTemplate[] => {
  try {
    const templates = localStorage.getItem('lims_lab_templates');
    return templates ? JSON.parse(templates) : [defaultLabTemplate];
  } catch (error) {
    console.error('Error loading lab templates:', error);
    return [defaultLabTemplate];
  }
};

export const getLabTemplate = (id: string): LabTemplate => {
  const templates = getLabTemplates();
  return templates.find(t => t.id === id) || defaultLabTemplate;
};

// Authentication helper - ensures user is authenticated before operations
const ensureAuthenticated = async (): Promise<string | null> => {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session) {
    console.error('User not authenticated:', error);
    return null;
  }
  return session.user.id;
};

// Enhanced HTML template generator with optional draft watermark
const generateUniversalHTMLTemplate = (data: ReportData, isDraft = false): string => {
  const { patient, report, testResults, interpretation } = data;
  const template = data.template || defaultLabTemplate;
  
  const draftWatermarkCSS = isDraft ? `
    .draft-watermark {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%) rotate(-45deg);
      font-size: 120px;
      font-weight: bold;
      color: rgba(220, 53, 69, 0.1);
      z-index: -1;
      pointer-events: none;
      user-select: none;
      text-transform: uppercase;
      letter-spacing: 10px;
    }
    .draft-indicator {
      background: #fff3cd;
      border: 2px solid #ffc107;
      border-radius: 8px;
      padding: 15px;
      margin: 20px 0;
      text-align: center;
      color: #856404;
      font-weight: bold;
      font-size: 14px;
    }
  ` : '';
  
  const draftWatermarkHTML = isDraft ? `
    <div class="draft-watermark">DRAFT</div>
    <div class="draft-indicator">
      ⚠️ DRAFT REPORT - Some results may still be pending verification
    </div>
  ` : '';
  
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Lab Report - ${report.reportId}${isDraft ? ' (DRAFT)' : ''}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: ${template.styling.fontFamily}; 
      padding: 30px; 
      margin: 0;
      color: #333;
      line-height: 1.6;
      font-size: 12px;
      position: relative;
    }
    ${draftWatermarkCSS}
    .header { 
      text-align: center; 
      border-bottom: 3px solid ${template.styling.primaryColor};
      padding-bottom: 20px;
      margin-bottom: 30px;
    }
    .header .lab-name {
      font-size: 28px;
      font-weight: bold;
      color: ${template.styling.primaryColor};
      margin-bottom: 8px;
    }
    .header .lab-info {
      font-size: 12px;
      color: ${template.styling.secondaryColor};
      line-height: 1.4;
    }
    .report-title {
      text-align: center;
      font-size: 20px;
      font-weight: bold;
      color: ${template.styling.primaryColor};
      margin: 25px 0;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    .info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 25px;
      margin: 25px 0;
    }
    .info-box {
      background: #f8f9fa;
      padding: 20px;
      border-radius: 8px;
      border-left: 5px solid ${template.styling.primaryColor};
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .info-title {
      font-weight: bold;
      color: ${template.styling.primaryColor};
      margin-bottom: 15px;
      font-size: 16px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .info-item {
      margin: 8px 0;
      font-size: 13px;
      display: flex;
      justify-content: space-between;
    }
    .info-label {
      font-weight: bold;
      color: ${template.styling.secondaryColor};
      min-width: 120px;
    }
    .info-value {
      color: #333;
      font-weight: 500;
    }
    .results-section {
      margin: 30px 0;
    }
    .section-title {
      font-size: 18px;
      font-weight: bold;
      color: ${template.styling.primaryColor};
      margin-bottom: 15px;
      padding-bottom: 8px;
      border-bottom: 2px solid ${template.styling.primaryColor};
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    table { 
      width: 100%; 
      border-collapse: collapse; 
      margin-top: 15px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    th, td { 
      border: 1px solid #ddd; 
      padding: 12px 8px; 
      text-align: left;
      font-size: 12px;
    }
      try {
        const printResult = await generatePrintPDFWithAPI(reportData, preparedHtml);
        const printPdfUrl = printResult.url;
      color: white;
      font-weight: bold;
      text-align: center;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      font-size: 11px;
    }
    td {
      text-align: center;
      vertical-align: middle;
    }
    td:first-child {
      text-align: left;
      font-weight: 600;
      color: #333;
    }
    .result-value {
      font-weight: bold;
      font-size: 13px;
    }
    .flag-h {
      color: #dc3545;
      font-weight: bold;
    }
    .flag-l {
      color: #0066cc;
      font-weight: bold;
    }
    .flag-c {
      color: #ff6600;
      font-weight: bold;
    }
    .interpretation-box {
      background: linear-gradient(135deg, #e3f2fd 0%, #f8f9fa 100%);
      padding: 20px;
      border-radius: 8px;
      border-left: 5px solid ${template.styling.primaryColor};
      margin: 30px 0;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    .interpretation-title {
      font-weight: bold;
      color: ${template.styling.primaryColor};
      margin-bottom: 12px;
      font-size: 16px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .interpretation-text {
      line-height: 1.6;
      color: #333;
      font-size: 13px;
    }
    .footer {
      margin-top: 50px;
      padding-top: 20px;
      border-top: 2px solid ${template.styling.secondaryColor};
    }
    .signature-section {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 40px;
      margin: 30px 0;
    }
    .signature-box {
      text-align: center;
    }
    .signature-line {
      border-top: 2px solid #333;
      margin-top: 60px;
      padding-top: 8px;
      font-weight: bold;
      font-size: 12px;
    }
    .footer-info {
      text-align: center;
      font-size: 10px;
      color: ${template.styling.secondaryColor};
      margin-top: 20px;
      font-style: italic;
    }
    .generation-info {
      text-align: center;
      font-size: 10px;
      color: ${template.styling.secondaryColor};
      margin-top: 15px;
    }
    @media print {
      body { margin: 0; padding: 15px; }
      .page-break { page-break-before: always; }
      .info-grid { grid-template-columns: 1fr; gap: 15px; }
      .signature-section { grid-template-columns: 1fr; gap: 20px; }
    }
  </style>
</head>
<body>
  ${draftWatermarkHTML}
  <div class="header">
    <div class="lab-name">${template.header.labName}</div>
    <div class="lab-info">
      ${template.header.address}<br>
      Phone: ${template.header.phone} | Email: ${template.header.email}
    </div>
  </div>

  <div class="report-title">Laboratory Report${isDraft ? ' (DRAFT)' : ''}</div>

  <div class="info-grid">
    <div class="info-box">
      <div class="info-title">Patient Information</div>
      <div class="info-item">
        <span class="info-label">Name:</span>
        <span class="info-value">${patient.name}</span>
      </div>
      <div class="info-item">
        <span class="info-label">Patient ID:</span>
        <span class="info-value">${patient.id}</span>
      </div>
      <div class="info-item">
        <span class="info-label">Age:</span>
        <span class="info-value">${patient.age} years</span>
      </div>
      <div class="info-item">
        <span class="info-label">Gender:</span>
        <span class="info-value">${patient.gender}</span>
      </div>
      ${patient.referredBy ? `
      <div class="info-item">
        <span class="info-label">Referred By:</span>
        <span class="info-value">${patient.referredBy}</span>
      </div>
      ` : ''}
    </div>
    
    <div class="info-box">
      <div class="info-title">Report Details</div>
      <div class="info-item">
        <span class="info-label">Report ID:</span>
        <span class="info-value">${report.reportId}</span>
      </div>
      <div class="info-item">
        <span class="info-label">Collection Date:</span>
        <span class="info-value">${new Date(report.collectionDate).toLocaleDateString('en-IN')}</span>
      </div>
      <div class="info-item">
        <span class="info-label">Report Date:</span>
        <span class="info-value">${new Date(report.reportDate).toLocaleDateString('en-IN')}</span>
      </div>
      <div class="info-item">
        <span class="info-label">Test Type:</span>
        <span class="info-value">${report.reportType}</span>
      </div>
    </div>
  </div>

  <div class="results-section">
    <div class="section-title">Test Results</div>
    <table>
      <thead>
        <tr>
          <th style="width: 35%;">Parameter</th>
          <th style="width: 15%;">Result</th>
          <th style="width: 10%;">Unit</th>
          <th style="width: 25%;">Reference Range</th>
          <th style="width: 15%;">Flag</th>
        </tr>
      </thead>
      <tbody>
        ${testResults.map(result => `
          <tr>
            <td>${result.parameter}</td>
            <td class="result-value ${result.flag ? `flag-${result.flag.toLowerCase()}` : ''}">${result.result}</td>
            <td>${result.unit || '-'}</td>
            <td>${result.referenceRange || '-'}</td>
            <td>${result.flag ? `<span class="flag-${result.flag.toLowerCase()}">${result.flag}</span>` : '-'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  </div>

  ${interpretation ? `
  <div class="interpretation-box">
    <div class="interpretation-title">Clinical Interpretation</div>
    <div class="interpretation-text">${interpretation}</div>
  </div>
  ` : ''}

  <div class="footer">
    <div class="signature-section">
      <div class="signature-box">
        <div class="signature-line">
          Laboratory Technician
        </div>
      </div>
      <div class="signature-box">
        <div class="signature-line">
          ${template.footer.authorizedBy}
        </div>
      </div>
    </div>
    
    ${template.footer.disclaimer ? `
    <div class="footer-info">
      ${template.footer.disclaimer}
    </div>
    ` : ''}
    
    <div class="generation-info">
      Report generated on: ${new Date().toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      })}
    </div>
  </div>
</body>
</html>`;
};

/**
 * Helper function to group analytes by test_group_id
 */
const groupAnalytesByTestGroup = (analytes: ReportTemplateAnalyteRow[]): Map<string, ReportTemplateAnalyteRow[]> => {
  const grouped = new Map<string, ReportTemplateAnalyteRow[]>();
  
  for (const analyte of analytes) {
    const testGroupId = analyte.test_group_id || 'ungrouped';
    if (!grouped.has(testGroupId)) {
      grouped.set(testGroupId, []);
    }
    grouped.get(testGroupId)!.push(analyte);
  }
  
  return grouped;
};

/**
 * Render multiple test group templates and merge them into a single HTML
 */
const renderMultipleTestGroupTemplates = async (
  reportData: ReportData,
  isDraft: boolean,
  brandingDefaults: LabBrandingHtmlDefaults,
  templates: LabTemplateRecord[]
): Promise<{ html: string; bundle: any }> => {
  const context = reportData.templateContext;
  if (!context || !context.analytes || context.analytes.length === 0) {
    throw new Error('No analytes found in report context');
  }

  // Group analytes by test_group_id
  const analytesByGroup = groupAnalytesByTestGroup(context.analytes);
  
  console.log(`📋 Found ${analytesByGroup.size} test group(s) in order ${context.orderId}`);
  
  // If only one test group, use the standard single-template rendering
  if (analytesByGroup.size === 1) {
    const template = reportData.labTemplateRecord || selectTemplateForContext(templates, context);
    if (template?.gjs_html) {
      const bundle = renderLabTemplateHtmlBundle(template, {
        context,
        overrides: {
          ...(reportData.placeholderOverrides ?? {}),
          report_is_draft: isDraft,
          report_generated_at: new Date().toISOString(),
        },
        brandingDefaults,
      });
      
      return { html: bundle.previewHtml, bundle };
    }
  }

  // Multiple test groups - need to merge templates
  const renderedSections: string[] = [];
  const testGroupNames: string[] = [];
  
  for (const [testGroupId, groupAnalytes] of analytesByGroup.entries()) {
    console.log(`🔧 Rendering test group: ${testGroupId} with ${groupAnalytes.length} analyte(s)`);
    
    // Create a modified context for this test group
    const groupContext: ReportTemplateContext = {
      ...context,
      analytes: groupAnalytes,
      testGroupIds: [testGroupId],
    };
    
    // Select template for this specific test group
    let groupTemplate: LabTemplateRecord | null = null;
    
    // Try to find a template specifically for this test group
    if (testGroupId !== 'ungrouped') {
      groupTemplate = templates.find(t => t.test_group_id === testGroupId && t.gjs_html) || null;
    }
    
    // Fall back to selecting based on context
    if (!groupTemplate) {
      groupTemplate = selectTemplateForContext(templates, groupContext);
    }
    
    // Fall back to default template
    if (!groupTemplate) {
      groupTemplate = templates.find(t => t.is_default && t.gjs_html) || templates.find(t => t.gjs_html) || null;
    }
    
    if (groupTemplate?.gjs_html) {
      const bundle = renderLabTemplateHtmlBundle(groupTemplate, {
        context: groupContext,
        overrides: {
          ...(reportData.placeholderOverrides ?? {}),
          report_is_draft: isDraft,
          report_generated_at: new Date().toISOString(),
        },
        brandingDefaults,
      });
      
      // Extract the body content from the rendered HTML
      const bodyMatch = bundle.previewHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i);
      const bodyContent = bodyMatch ? bodyMatch[1] : bundle.previewHtml;
      
      // Add section with test group separator
      const testName = groupAnalytes[0]?.test_name || `Test Group ${renderedSections.length + 1}`;
      testGroupNames.push(testName);
      
      const sectionHtml = `
        <div class="test-group-section" data-test-group-id="${testGroupId}">
          ${renderedSections.length > 0 ? `
            <div class="test-group-separator" style="page-break-before: always; margin: 40px 0 20px; padding-top: 20px; border-top: 2px solid #2563eb;">
              <h2 style="color: #2563eb; font-size: 18px; margin: 0;">${testName}</h2>
            </div>
          ` : ''}
          ${bodyContent}
        </div>
      `;
      
      renderedSections.push(sectionHtml);
    } else {
      console.warn(`⚠️  No template found for test group: ${testGroupId}`);
    }
  }
  
  if (renderedSections.length === 0) {
    throw new Error('Failed to render any test group templates');
  }
  
  // Merge all sections into a single HTML document
  const mergedBody = renderedSections.join('\n');
  
  // Get the base template structure from the first rendered template
  const firstTemplate = templates.find(t => t.gjs_html) || reportData.labTemplateRecord;
  if (!firstTemplate?.gjs_html) {
    throw new Error('No valid template found for report generation');
  }
  
  // Create a bundle with the first template's structure but merged content
  const baseBundle = renderLabTemplateHtmlBundle(firstTemplate, {
    context,
    overrides: {
      ...(reportData.placeholderOverrides ?? {}),
      report_is_draft: isDraft,
      report_generated_at: new Date().toISOString(),
    },
    brandingDefaults,
  });
  
  // Replace the body content with merged sections
  const mergedHtml = baseBundle.previewHtml.replace(
    /<body[^>]*>[\s\S]*<\/body>/i,
    `<body class="limsv2-report multi-test-group-report">${mergedBody}</body>`
  );
  
  console.log(`✅ Successfully merged ${renderedSections.length} test group template(s)`);
  
  return {
    html: mergedHtml,
    bundle: {
      ...baseBundle,
      previewHtml: mergedHtml,
      bodyHtml: mergedBody,  // ✅ FIX: Use merged body content for print PDF
      testGroupCount: renderedSections.length,
      testGroupNames,
    },
  };
};

/**
 * Inject watermark HTML into report based on lab settings
 */
const injectWatermarkIfEnabled = async (html: string, labId: string): Promise<string> => {
  try {
    const { data: labSettings, error } = await supabase
      .from('labs')
      .select('watermark_enabled, watermark_image_url, watermark_opacity, watermark_position, watermark_size, watermark_rotation')
      .eq('id', labId)
      .single();
    
    if (error || !labSettings || !labSettings.watermark_enabled || !labSettings.watermark_image_url) {
      return html; // No watermark configured
    }

    console.log('💧 Injecting automatic watermark:', {
      url: labSettings.watermark_image_url,
      opacity: labSettings.watermark_opacity,
      position: labSettings.watermark_position,
      size: labSettings.watermark_size,
      rotation: labSettings.watermark_rotation
    });

    // Calculate size percentage
    const sizeMap = { small: '40%', medium: '60%', large: '80%', full: '100%' };
    const maxWidth = sizeMap[labSettings.watermark_size as keyof typeof sizeMap] || '60%';

    // Calculate position styles
    const positionMap: Record<string, string> = {
      'center': 'top:50%;left:50%;transform:translate(-50%, -50%)',
      'top-left': 'top:10%;left:10%',
      'top-right': 'top:10%;right:10%',
      'bottom-left': 'bottom:10%;left:10%',
      'bottom-right': 'bottom:10%;right:10%',
      'repeat': 'top:0;left:0;width:100%;height:100%;background-image:url(' + labSettings.watermark_image_url + ');background-repeat:repeat;background-size:30%;opacity:' + labSettings.watermark_opacity
    };

    const isRepeat = labSettings.watermark_position === 'repeat';
    const positionStyle = positionMap[labSettings.watermark_position] || positionMap['center'];
    const rotation = labSettings.watermark_rotation || 0;

    const watermarkHtml = isRepeat 
      ? `<div style="position:absolute;${positionStyle};z-index:1;pointer-events:none;"></div>`
      : `<img src="${labSettings.watermark_image_url}" style="position:absolute;${positionStyle};${rotation !== 0 ? `transform:translate(-50%, -50%) rotate(${rotation}deg);` : ''}max-width:${maxWidth};height:auto;opacity:${labSettings.watermark_opacity};z-index:1;pointer-events:none;" alt="Watermark" />`;

    // Inject watermark after body opening tag or at the start of main content
    const bodyMatch = html.match(/<body[^>]*>/i);
    if (bodyMatch) {
      const insertIndex = bodyMatch.index! + bodyMatch[0].length;
      return html.slice(0, insertIndex) + watermarkHtml + html.slice(insertIndex);
    }

    // Fallback: inject at the beginning
    return watermarkHtml + html;
  } catch (error) {
    console.error('Failed to inject watermark:', error);
    return html; // Return original HTML on error
  }
};

const prepareReportHtml = async (
  reportData: ReportData,
  isDraft: boolean,
  allTemplates?: LabTemplateRecord[]
): Promise<PreparedReportHtml> => {
  const filenameBase = buildReportFilenameBase(reportData, isDraft);
  const brandingDefaults = resolveReportBrandingDefaults(reportData);

  // Check if we have multiple test groups and templates
  const context = reportData.templateContext;
  const hasMultipleTestGroups = context?.testGroupIds && context.testGroupIds.length > 1;
  
  let finalHtml = '';
  let bundle = null;

  if (hasMultipleTestGroups && allTemplates && allTemplates.length > 0) {
    console.log(`🔀 Detected ${context!.testGroupIds!.length} test groups, attempting multi-template merge`);
    
    try {
      const result = await renderMultipleTestGroupTemplates(
        reportData,
        isDraft,
        brandingDefaults,
        allTemplates
      );
      
      finalHtml = result.html;
      bundle = result.bundle;
    } catch (error) {
      console.error('❌ Multi-template merge failed, falling back to single template:', error);
      // Fall through to single-template rendering
    }
  }

  // Single template rendering (original logic)
  if (!finalHtml && reportData.labTemplateRecord?.gjs_html && context) {
    bundle = renderLabTemplateHtmlBundle(reportData.labTemplateRecord, {
      context,
      overrides: {
        ...(reportData.placeholderOverrides ?? {}),
        report_is_draft: isDraft,
        report_generated_at: new Date().toISOString(),
      },
      brandingDefaults,
    });

    finalHtml = bundle.previewHtml;
  }

  // Fallback to universal template
  if (!finalHtml) {
    finalHtml = generateUniversalHTMLTemplate(reportData, isDraft);
  }

  // Inject automatic watermark if lab has it configured
  if (context?.labId) {
    finalHtml = await injectWatermarkIfEnabled(finalHtml, context.labId);
  }

  // Fetch and inject attachments marked for report inclusion
  try {
    const orderId = reportData.report?.reportId || context?.orderId;
    if (!orderId) {
      console.warn('No order ID available for attachment fetching');
    } else {
      const { data: reportAttachments, error: attachmentError } = await supabase
        .from('attachments')
        .select(`
          id,
          file_url,
          file_name,
          description,
          order_test_id,
          order_tests(
            test_groups(name)
          )
        `)
        .eq('order_id', orderId)
        .eq('tag', 'include_in_report')
        .order('order_test_id', { ascending: true });

      if (!attachmentError && reportAttachments && reportAttachments.length > 0) {
        console.log('📎 Found', reportAttachments.length, 'attachments for report');
      
      // Group attachments by test
      const groupedAttachments: Record<string, Array<{ url: string; heading: string; fileName: string }>> = {};
      reportAttachments.forEach((att: any) => {
        const testName = att.order_tests?.test_groups?.name || 'Additional Information';
        if (!groupedAttachments[testName]) {
          groupedAttachments[testName] = [];
        }
        groupedAttachments[testName].push({
          url: att.file_url,
          heading: att.description || att.file_name || 'Attachment',
          fileName: att.file_name || 'attachment'
        });
      });

      // Generate HTML for attachments
      let attachmentHtml = '<div style="page-break-before: always; padding: 20px;">';
      attachmentHtml += '<h2 style="text-align: center; margin-bottom: 30px; color: #333; border-bottom: 2px solid #4A90E2; padding-bottom: 10px;">Supporting Documentation</h2>';
      
      for (const [testName, attachments] of Object.entries(groupedAttachments)) {
        attachmentHtml += `<h3 style="margin-top: 30px; margin-bottom: 15px; color: #555; font-size: 18px;">${testName}</h3>`;
        
        attachments.forEach((att) => {
          attachmentHtml += '<div style="margin-bottom: 30px; border: 1px solid #ddd; border-radius: 8px; padding: 15px; background-color: #f9f9f9;">';
          attachmentHtml += `<h4 style="margin: 0 0 10px 0; color: #333; font-size: 16px;">${att.heading}</h4>`;
          attachmentHtml += `<img src="${att.url}" alt="${att.fileName}" style="max-width: 100%; height: auto; border-radius: 4px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);" />`;
          attachmentHtml += '</div>';
        });
      }
      
      attachmentHtml += '</div>';
      
      // Insert attachment HTML before closing body tag
      finalHtml = finalHtml.replace('</body>', `${attachmentHtml}</body>`);
      console.log('✅ Attachments injected into report HTML');
    }
    }
  } catch (error) {
    console.error('Failed to fetch attachments:', error);
  }

  return {
    html: finalHtml,
    bundle,
    filenameBase,
    brandingDefaults,
  };
};

// Enhanced PDF generation with PDF.co API
export const generatePDFWithAPI = async (
  reportData: ReportData,
  isDraft = false,
  prepared?: PreparedReportHtml | Promise<PreparedReportHtml>
): Promise<string> => {
  console.log('Generating PDF with PDF.co API...', isDraft ? '(DRAFT)' : '(FINAL)');
  const ready = prepared ? (prepared instanceof Promise ? await prepared : prepared) : await prepareReportHtml(reportData, isDraft);
  const filename = `${ready.filenameBase}.pdf`;
  
  // Get lab defaults directly from database
  let headerHtml = '';
  let footerHtml = '';
  
  if (reportData.templateContext?.labId) {
    const { data: labDefaults } = await supabase
      .from('labs')
      .select('default_report_header_html, default_report_footer_html')
      .eq('id', reportData.templateContext.labId)
      .maybeSingle();
    
    const rawHeaderHtml = labDefaults?.default_report_header_html || '';
    const rawFooterHtml = labDefaults?.default_report_footer_html || '';
    
    // Convert images to base64
    headerHtml = await convertHtmlImagestoBase64(rawHeaderHtml);
    footerHtml = await convertHtmlImagestoBase64(rawFooterHtml);
  }

  console.log('📄 Generating PDF with PDF.co API (direct call)...');
  console.log('  HTML length:', ready.html.length);
  console.log('  Has header:', !!headerHtml);
  console.log('  Has footer:', !!footerHtml);
  console.log('  Has attachments:', ready.html.includes('Supporting Documentation'));

  try {
    return await sendHtmlToPdfCo(ready.html, filename, {
      displayHeaderFooter: true,
      headerHtml,
      footerHtml,
      headerHeight: '100px',
      footerHeight: '80px',
      mediaType: 'screen',
      printBackground: true,
    });
  } catch (error) {
    console.error('PDF.co generation failed:', error);
    throw error;
  }
};

interface PrintPdfResult {
  url: string;
  headerHtml?: string | null;
  footerHtml?: string | null;
}

const generatePrintPDFWithAPI = async (
  _reportData: ReportData,
  prepared: PreparedReportHtml | Promise<PreparedReportHtml>
): Promise<PrintPdfResult> => {
  const ready = prepared instanceof Promise ? await prepared : prepared;
  const filename = `${ready.filenameBase}_PRINT.pdf`;

  if (ready.bundle) {
    return sendPrintHtmlToPdfCo(ready.bundle, filename);
  }

  console.warn('Print PDF requested but no template bundle available. Falling back to preview HTML.');
  const url = await sendHtmlToPdfCo(ready.html, filename, {
    displayHeaderFooter: false,
    mediaType: 'print',
    printBackground: true,
  });

  return {
    url,
    headerHtml: null,
    footerHtml: null,
  };
};

// Fallback PDF generation using browser print
export const generatePDFWithBrowser = async (reportData: ReportData): Promise<string> => {
  console.log('Generating PDF with browser fallback...');

  const ready = await prepareReportHtml(reportData, false);
  const blob = new Blob([ready.html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  
  console.log('Browser PDF blob created');
  return url;
};

// Enhanced Save PDF to Supabase storage - For public bucket
type PdfVariant = 'final' | 'draft' | 'print';

export const savePDFToStorage = async (
  pdfBlob: Blob,
  orderId: string,
  variant: PdfVariant = 'final'
): Promise<string> => {
  console.log('Saving PDF to Supabase storage...');

  try {
    // Create a unique filename
    const suffix = variant === 'final' ? '' : `_${variant}`;
    const fileName = `${orderId}_${Date.now()}${suffix}.pdf`;
    
  console.log('Uploading file:', fileName, 'Size:', pdfBlob.size, 'Type:', pdfBlob.type);

    // Ensure we have a proper PDF blob
    if (!pdfBlob || pdfBlob.size === 0) {
      throw new Error('Invalid PDF blob provided');
    }

    // Ensure blob has correct type
    if (pdfBlob.type !== 'application/pdf') {
      console.log('Converting blob to proper PDF type');
      pdfBlob = new Blob([pdfBlob], { type: 'application/pdf' });
    }

    // Upload the blob directly to Supabase storage
    // This will send raw binary data with proper content-type header
    console.log('Starting upload to Supabase...');
    const { data, error } = await supabase.storage
      .from('reports')
      .upload(fileName, pdfBlob, {
        contentType: 'application/pdf',
        cacheControl: '3600',
        upsert: true
      });

    if (error) {
      console.error('Storage upload error details:', error);
      console.error('Error message:', error.message);
      throw new Error(`Storage upload failed: ${error.message}`);
    }

    console.log('Upload successful, data:', data);

    // Verify the file was uploaded
    if (!data || !data.path) {
      throw new Error('Upload succeeded but no file path returned');
    }

    // Get the public URL for the uploaded file
    const { data: { publicUrl } } = supabase.storage
      .from('reports')
      .getPublicUrl(fileName);

    console.log('PDF saved to storage successfully:', publicUrl);
    
    // Test if the URL is accessible
    try {
      const testResponse = await fetch(publicUrl, { method: 'HEAD' });
      console.log('URL test response status:', testResponse.status);
    } catch (testError) {
      console.warn('URL test failed:', testError);
    }

    return publicUrl;
  } catch (error) {
    console.error('Failed to save PDF to storage:', error);
    throw error;
  }
};

// Update database with PDF information
export const updateReportWithPDFInfo = async (orderId: string, pdfUrl: string, reportType: string = 'final'): Promise<void> => {
  console.log(`Updating database with ${reportType} PDF info...`);
  
  try {
    const { error } = await supabase
      .from('reports')
      .update({
        pdf_url: pdfUrl,
        pdf_generated_at: new Date().toISOString(),
        status: 'completed',
        report_type: reportType,  // Ensure report type is updated
        report_status: 'completed'
      })
      .eq('order_id', orderId);

    if (error) {
      console.error('Database update error:', error);
      throw error;
    }

    console.log(`Database updated successfully for ${reportType} report`);
  } catch (error) {
    console.error('Failed to update database:', error);
    throw error;
  }
};

export const updateReportWithPrintPDFInfo = async (
  orderId: string,
  printPdfUrl: string
): Promise<void> => {
  console.log('Updating database with print PDF info...');

  try {
    const { error } = await supabase
      .from('reports')
      .update({
        print_pdf_url: printPdfUrl,
        print_pdf_generated_at: new Date().toISOString(),
      })
      .eq('order_id', orderId);

    if (error) {
      console.error('Database update error (print PDF):', error);
      throw error;
    }

    console.log('Print PDF metadata stored successfully');
  } catch (error) {
    console.error('Failed to update print PDF information:', error);
    throw error;
  }
};

// Main PDF generation function with comprehensive error handling and progress tracking
export async function generateAndSavePDFReportWithProgress(
  orderId: string, 
  reportData: ReportData,
  onProgress?: (stage: string, progress?: number) => void,
  isDraft = false,
  allTemplates?: LabTemplateRecord[]
): Promise<string | null> {
  console.log('generateAndSavePDFReportWithProgress called for order:', orderId, 'isDraft:', isDraft);
  
  onProgress?.('Checking authentication...', 5);
  
  // Check authentication for database operations only
  const userId = await ensureAuthenticated();
  if (!userId) {
    console.error('User must be authenticated to generate reports');
    onProgress?.('Authentication failed', 0);
    alert('Please login to generate reports');
    return null;
  }
  
  try {
    onProgress?.('Checking existing reports...', 10);
    
    // Check for existing report (regardless of type since there's a unique constraint on order_id)
    let { data: existingReport } = await supabase
      .from('reports')
      .select('id, pdf_url, pdf_generated_at, status, report_type')
      .eq('order_id', orderId)
      .maybeSingle(); // Use maybeSingle to avoid errors when no record exists

    const reportType = isDraft ? 'draft' : 'final';
    
    // If no report exists, create one; if exists, we'll update it later
    if (!existingReport) {
      console.log(`No report record exists, creating one...`);
      onProgress?.(`Creating report record...`, 15);
      
      // Get order details to populate report
      const { data: orderData, error: orderError } = await supabase
        .from('orders')
        .select('patient_id, doctor')
        .eq('id', orderId)
        .single();
      
      if (orderError || !orderData) {
        console.error('Failed to fetch order data:', orderError);
        onProgress?.('Order not found', 0);
        alert('Order not found. Please check the order ID.');
        return null;
      }
      
      // Create report record using UPSERT to handle race conditions
      const { data: newReport, error: upsertError } = await supabase
        .from('reports')
        .upsert({
          order_id: orderId,
          patient_id: orderData.patient_id,
          doctor: orderData.doctor || 'Unknown',
          status: 'pending',
          generated_date: new Date().toISOString(),
          report_type: reportType,
          report_status: 'generating'
        }, {
          onConflict: 'order_id',
          ignoreDuplicates: false
        })
        .select()
        .single();

      if (upsertError) {
        console.error('Failed to create/update report record:', upsertError);
        onProgress?.('Failed to create report record', 0);
        alert('Failed to create report record. Please try again.');
        return null;
      }
      
      existingReport = newReport;
    }

    // Check if we need to regenerate based on report type change
    const needsRegeneration = !existingReport ||
                              existingReport.report_type !== reportType || 
                              !existingReport.pdf_url ||
                              existingReport.status !== 'completed';

    if (!needsRegeneration && existingReport?.pdf_url) {
      console.log(`${reportType.toUpperCase()} PDF already exists and is current:`, existingReport.pdf_url);
      onProgress?.(`Validating existing ${reportType} PDF...`, 20);
      
      try {
        const response = await fetch(existingReport.pdf_url, { method: 'HEAD' });
        if (response.ok) {
          console.log(`Existing ${reportType} PDF is valid`);
          onProgress?.(`Using existing ${reportType} PDF`, 100);
          return existingReport.pdf_url;
        }
      } catch (error) {
        console.warn(`Existing PDF URL is invalid, regenerating...`);
      }
    }

    console.log(`Generating new ${reportType} PDF...`);
    
    const preparedHtml = await prepareReportHtml(reportData, isDraft, allTemplates);
    let pdfUrl: string | null = null;
    let pdfBlob: Blob | null = null;

    // Analyze PDF complexity to determine generation method
    const complexity = analyzePDFComplexity(preparedHtml.html);
    const usePuppeteer = shouldUsePuppeteer() && complexity.recommendation === 'puppeteer';
    
    console.log('PDF Generation Strategy:', {
      usePuppeteer,
      complexity: complexity.complexity,
      pageCount: complexity.pageCount,
      recommendation: complexity.recommendation,
      htmlSize: complexity.htmlSize,
      provider: usePuppeteer ? 'puppeteer' : 'pdfco',
      fallbackEnabled: shouldFallbackToPDFCO()
    });

    // Try Puppeteer first if enabled and recommended
    if (usePuppeteer) {
      logPDFEvent('start', 'puppeteer', { orderId, complexity: complexity.complexity });
      const startTime = Date.now();
      
      try {
        onProgress?.(`Generating ${reportType} PDF with Puppeteer...`, 25);
        console.log('🎭 Using Puppeteer for PDF generation (5s timeout)');
        
        // ⏱️ 5-second timeout wrapper for Puppeteer
        const puppeteerUrl = await Promise.race([
          generatePDFWithPuppeteer({
            orderId,
            html: preparedHtml.html,
            variant: reportType,
            cacheKey: `${orderId}_${reportType}`
          }),
          new Promise<string>((_, reject) => 
            setTimeout(() => reject(new Error('Puppeteer timeout: 5s exceeded')), 5000)
          )
        ]);
        
        if (puppeteerUrl) {
          const totalTime = Date.now() - startTime;
          console.log('✅ Puppeteer generation successful:', puppeteerUrl);
          logPDFEvent('success', 'puppeteer', { orderId, time: totalTime });
          recordPerformanceMetrics({
            provider: 'puppeteer',
            totalTime,
            stages: { generation: totalTime }
          });
          
          // Generate print version if final report (with delay to prevent browser conflicts)
          if (!isDraft) {
            onProgress?.('Preparing print-ready PDF...', 92);
            
            // Wait a moment for the previous page to fully close
            await new Promise(resolve => setTimeout(resolve, 500));
            
            try {
              onProgress?.('Generating print-ready PDF...', 93);
              
              // ⏱️ 5-second timeout for print PDF too
              const printUrl = await Promise.race([
                generatePDFWithPuppeteer({
                  orderId,
                  html: preparedHtml.html,
                  variant: 'print',
                  cacheKey: `${orderId}_print`
                }),
                new Promise<string>((_, reject) => 
                  setTimeout(() => reject(new Error('Print PDF timeout: 5s exceeded')), 5000)
                )
              ]);
              
              if (printUrl) {
                console.log('✅ Print PDF generated successfully:', printUrl);
                onProgress?.('Print PDF ready!', 96);
              }
            } catch (printError) {
              console.error('⚠️ Print PDF generation failed (non-critical):', printError);
              onProgress?.('Main PDF ready (print version skipped)', 96);
              // Don't fail the whole operation if print version fails
            }
          }
          
          onProgress?.('PDF ready for download!', 100);
          return puppeteerUrl;
        } else {
          throw new Error('Puppeteer generation returned no URL');
        }
      } catch (puppeteerError) {
        const failTime = Date.now() - startTime;
        console.warn(`⚠️ Puppeteer generation failed (${failTime}ms), falling back to PDF.co:`, puppeteerError);
        logPDFEvent('error', 'puppeteer', { orderId, error: puppeteerError, time: failTime });
        
        // Check if fallback is enabled
        if (!shouldFallbackToPDFCO()) {
          throw puppeteerError; // Don't fallback, throw error
        }
        
        logPDFEvent('fallback', 'pdfco', { orderId, reason: 'puppeteer_failed' });
        onProgress?.('Retrying with PDF.co...', 30);
        // Continue to PDF.co fallback
      }
    }

    // PDF.co generation (fallback or primary)
    logPDFEvent('start', 'pdfco', { orderId, isFallback: usePuppeteer });
    const pdfcoStartTime = Date.now();

    // PDF.co fallback (or primary method if Puppeteer disabled)
    onProgress?.(`Generating ${reportType} PDF with PDF.co...`, 35);
    try {
      // ⚡ PARALLEL OPTIMIZATION: Generate both main and print PDFs at the same time
      const mainPdfPromise = generatePDFWithAPI(reportData, isDraft, preparedHtml);
      const printPdfPromise = !isDraft ? generatePrintPDFWithAPI(reportData, preparedHtml) : null;
      
      console.log('⚡ Generating main and print PDFs in parallel...');
      
      // Wait for main PDF first
      pdfUrl = await mainPdfPromise;
      console.log('✅ Main PDF.co URL received:', pdfUrl);
      onProgress?.('PDF generated, downloading...', 50);
      
      if (pdfUrl && (pdfUrl.includes('pdf.co') || pdfUrl.includes('s3.us-west-2.amazonaws.com'))) {
        console.log('📥 Downloading main PDF from PDF.co/AWS...');
        
        // Use the robust download function for large files with progress
        try {
          pdfBlob = await downloadLargePDFWithProgress(pdfUrl, onProgress);
          console.log('✅ Main PDF successfully downloaded:', pdfBlob.size, 'bytes');
          onProgress?.('PDF downloaded successfully', 70);
        } catch (downloadError) {
          console.warn('⚠️ Robust download failed, trying standard method:', downloadError);
          onProgress?.('Retrying download...', 50);
          
          // Fallback to standard download method
          const response = await fetch(pdfUrl, {
            method: 'GET',
            headers: {
              'Accept': 'application/pdf, */*',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              'Cache-Control': 'no-cache'
            }
          });
          
          if (response.ok) {
            console.log('📊 Standard download response:', {
              status: response.status,
              contentType: response.headers.get('content-type'),
              contentLength: response.headers.get('content-length')
            });
            
            const arrayBuffer = await response.arrayBuffer();
            pdfBlob = new Blob([arrayBuffer], { type: 'application/pdf' });
            console.log('✅ Standard download completed, size:', pdfBlob.size);
            onProgress?.('PDF downloaded successfully', 70);
          } else {
            throw new Error(`Standard download failed: ${response.status} ${response.statusText}`);
          }
        }
        
        // Record PDF.co success metrics
        const pdfcoTotalTime = Date.now() - pdfcoStartTime;
        logPDFEvent('success', 'pdfco', { orderId, time: pdfcoTotalTime, size: pdfBlob.size });
        recordPerformanceMetrics({
          provider: 'pdfco',
          totalTime: pdfcoTotalTime,
          stages: { generation: pdfcoTotalTime }
        });
        
        // ⚡ PARALLEL: Now wait for print PDF (which was generating in parallel)
        if (printPdfPromise) {
          onProgress?.('Waiting for print PDF (generated in parallel)...', 75);
          try {
            const printResult = await printPdfPromise;
            const printPdfUrl = printResult.url;
            console.log('✅ Print PDF completed in parallel:', printPdfUrl);
            onProgress?.('Downloading print PDF...', 80);

            let printBlob: Blob | null = null;
            try {
              printBlob = await downloadLargePDFWithProgress(printPdfUrl, onProgress);
            } catch (printDownloadError) {
              console.warn('Print PDF robust download failed, attempting standard fetch...', printDownloadError);
              const response = await fetch(printPdfUrl, {
                method: 'GET',
                headers: {
                  'Accept': 'application/pdf, */*',
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                  'Cache-Control': 'no-cache',
                },
              });

              if (response.ok) {
                const buffer = await response.arrayBuffer();
                printBlob = new Blob([buffer], { type: 'application/pdf' });
              } else {
                throw new Error(`Standard print PDF download failed: ${response.status} ${response.statusText}`);
              }
            }

            if (printBlob) {
              onProgress?.('Saving print PDF...', 85);
              const printStorageUrl = await savePDFToStorage(printBlob, orderId, 'print');
              await updateReportWithPrintPDFInfo(orderId, printStorageUrl);
              console.log('✅ Print PDF saved and database updated');
            }
          } catch (printError) {
            console.error('⚠️ Print PDF generation/save failed (non-critical):', printError);
          }
        }
      } else {
        throw new Error(`Invalid PDF URL received: ${pdfUrl}`);
      }
    } catch (error) {
      const pdfcoFailTime = Date.now() - pdfcoStartTime;
      console.error('❌ PDF.co generation failed completely:', error);
      logPDFEvent('error', 'pdfco', { orderId, error, time: pdfcoFailTime });
      onProgress?.('PDF generation failed', 0);
      throw new Error(`PDF generation failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (!pdfBlob) {
      console.error('❌ Failed to generate PDF blob');
      onProgress?.('Failed to generate PDF', 0);
      alert('Failed to generate PDF. Please try again.');
      return null;
    }

    // Save to Supabase storage (public bucket)
    console.log('Saving main PDF to storage...');
    onProgress?.('Uploading to storage...', 90);
    const storageUrl = await savePDFToStorage(pdfBlob, orderId, isDraft ? 'draft' : 'final');
    
    // Update database
    console.log('Updating database with PDF URL...');
    onProgress?.('Updating database...', 95);
    await updateReportWithPDFInfo(orderId, storageUrl, reportType);

    console.log('PDF generation completed successfully');
    onProgress?.('PDF ready for download!', 100);
    return storageUrl;
  } catch (error) {
    console.error('PDF generation and save failed:', error);
    onProgress?.('PDF generation failed', 0);
    alert('An error occurred while generating the PDF. Please try again.');
    return null;
  }
}

// Enhanced download function with progress callbacks
export const downloadLargePDFWithProgress = async (
  url: string, 
  onProgress?: (stage: string, progress?: number) => void,
  maxRetries: number = 3
): Promise<Blob> => {
  console.log('🔄 Downloading large PDF from:', url);
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`📥 Attempt ${attempt}/${maxRetries}...`);
      onProgress?.(`Downloading... (Attempt ${attempt}/${maxRetries})`, 40 + (attempt - 1) * 10);
      
      // Create abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/pdf, */*',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache',
          'Range': 'bytes=0-' // Request all bytes
        },
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const contentLength = response.headers.get('content-length');
      const expectedLength = contentLength ? parseInt(contentLength) : 0;
      
      // Read the response as a stream for large files
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Response body is not readable');
      }
      
      const chunks: Uint8Array[] = [];
      let receivedLength = 0;
      
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;
        
        chunks.push(value);
        receivedLength += value.length;
        
        if (expectedLength > 0) {
          const downloadProgress = (receivedLength / expectedLength * 100);
          const overallProgress = 40 + (downloadProgress * 0.4); // 40-80% range
          onProgress?.(`Downloading: ${downloadProgress.toFixed(1)}%`, overallProgress);
        }
      }
      
      console.log(`✅ Download completed: ${receivedLength} bytes received`);
      
      // Verify we got the expected amount
      if (expectedLength > 0 && receivedLength !== expectedLength) {
        console.warn(`⚠️ Size mismatch: expected ${expectedLength}, got ${receivedLength}`);
        if (receivedLength < expectedLength * 0.9) {
          throw new Error(`Incomplete download: ${receivedLength}/${expectedLength} bytes`);
        }
      }
      
      // Combine all chunks into a single array buffer
      const arrayBuffer = new ArrayBuffer(receivedLength);
      const uint8Array = new Uint8Array(arrayBuffer);
      let position = 0;
      
      for (const chunk of chunks) {
        uint8Array.set(chunk, position);
        position += chunk.length;
      }
      
      // Validate PDF format
      const firstBytes = new Uint8Array(arrayBuffer.slice(0, 8));
      const header = String.fromCharCode(...firstBytes);
      
      if (!header.startsWith('%PDF')) {
        throw new Error(`Invalid PDF header: ${header}`);
      }
      
      // Create and return the blob
      const blob = new Blob([arrayBuffer], { type: 'application/pdf' });
      console.log(`✅ PDF blob created successfully: ${blob.size} bytes`);
      
      return blob;
      
    } catch (error) {
      console.error(`❌ Attempt ${attempt} failed:`, error);
      
      if (attempt === maxRetries) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to download PDF after ${maxRetries} attempts: ${errorMessage}`);
      }
      
      // Wait before retry (exponential backoff)
      const delay = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s...
      onProgress?.(`Retrying in ${delay/1000}s...`, 40 + (attempt - 1) * 10);
      console.log(`⏳ Waiting ${delay}ms before retry...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw new Error('This should never be reached');
};

// Main PDF generation function with comprehensive error handling and authentication
export async function generateAndSavePDFReport(orderId: string, reportData: ReportData, isDraft = false): Promise<string | null> {
  console.log('generateAndSavePDFReport called for order:', orderId);
  
  // Check authentication for database operations only
  const userId = await ensureAuthenticated();
  if (!userId) {
    console.error('User must be authenticated to generate reports');
    alert('Please login to generate reports');
    return null;
  }
  
  try {
    const reportType = isDraft ? 'draft' : 'final';
    // First, ensure a report record exists
    let { data: existingReport } = await supabase
      .from('reports')
      .select('id, pdf_url, pdf_generated_at, status')
      .eq('order_id', orderId)
      .maybeSingle(); // Use maybeSingle to avoid errors when no record exists

    // If no report exists, create one
    if (!existingReport) {
      console.log('No report record exists, creating one...');
      
      // Get order details to populate report
      // Remove test_names from the query as it doesn't exist in orders table
      const { data: orderData, error: orderError } = await supabase
        .from('orders')
        .select('patient_id, doctor')  // Removed test_names
        .eq('id', orderId)
        .single();
      
      if (orderError || !orderData) {
        console.error('Failed to fetch order data:', orderError);
        alert('Order not found. Please check the order ID.');
        return null;
      }
      
      // Create report record
      const { data: newReport, error: insertError } = await supabase
        .from('reports')
        .insert({
          order_id: orderId,
          patient_id: orderData.patient_id,
          doctor: orderData.doctor || 'Unknown',
          status: 'pending',
          generated_date: new Date().toISOString(),
          report_type: reportType,
          report_status: 'generating'
        })
        .select()
        .single();

      if (insertError) {
        console.error('Failed to create report record:', insertError);
        // Check if it's a unique constraint violation
        if (insertError.code === '23505') {
          // Report already exists, try to fetch it again
          const { data: retryReport } = await supabase
            .from('reports')
            .select('id, pdf_url, pdf_generated_at, status')
            .eq('order_id', orderId)
            .single();
          existingReport = retryReport;
        } else {
          alert('Failed to create report record. Please try again.');
          return null;
        }
      } else {
        existingReport = newReport;
      }
    }

    // Check if PDF already exists and is valid
    if (existingReport?.pdf_url) {
      console.log('PDF already exists:', existingReport.pdf_url);
      
      // Verify URL is still valid
      try {
        const response = await fetch(existingReport.pdf_url, { method: 'HEAD' });
        if (response.ok) {
          console.log('Existing PDF is valid');
          return existingReport.pdf_url;
        }
      } catch (error) {
        console.warn('Existing PDF URL is invalid, regenerating...');
      }
    }

    console.log('Generating new PDF...');
    const preparedHtml = await prepareReportHtml(reportData, isDraft);
  let pdfUrl: string | null = null;
  let pdfBlob: Blob | null = null;

    // Try PDF.co API - this is the only method we should use
    try {
      pdfUrl = await generatePDFWithAPI(reportData, isDraft, preparedHtml);
      console.log('✅ PDF.co URL received:', pdfUrl);
      
      if (pdfUrl && (pdfUrl.includes('pdf.co') || pdfUrl.includes('s3.us-west-2.amazonaws.com'))) {
        console.log('📥 Downloading PDF from PDF.co/AWS...');
        
        // Use the robust download function for large files
        try {
          pdfBlob = await downloadLargePDF(pdfUrl);
          console.log('✅ PDF successfully downloaded:', pdfBlob.size, 'bytes');
        } catch (downloadError) {
          console.warn('⚠️ Robust download failed, trying standard method:', downloadError);
          
          // Fallback to standard download method
          const response = await fetch(pdfUrl, {
            method: 'GET',
            headers: {
              'Accept': 'application/pdf, */*',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              'Cache-Control': 'no-cache'
            }
          });
          
          if (response.ok) {
            console.log('📊 Standard download response:', {
              status: response.status,
              contentType: response.headers.get('content-type'),
              contentLength: response.headers.get('content-length')
            });
            
            const arrayBuffer = await response.arrayBuffer();
            pdfBlob = new Blob([arrayBuffer], { type: 'application/pdf' });
            console.log('✅ Standard download completed, size:', pdfBlob.size);
          } else {
            throw new Error(`Standard download failed: ${response.status} ${response.statusText}`);
          }
        }
      } else {
        throw new Error(`Invalid PDF URL received: ${pdfUrl}`);
      }
    } catch (error) {
      console.error('❌ PDF.co generation failed completely:', error);
      throw new Error(`PDF generation failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (!pdfBlob) {
      console.error('❌ Failed to generate PDF blob');
      alert('Failed to generate PDF. Please try again.');
      return null;
    }

    // Save to Supabase storage (public bucket)
    console.log('Saving PDF to storage...');
  const storageUrl = await savePDFToStorage(pdfBlob, orderId, reportType);
    
    // Update database
    console.log('Updating database with PDF URL...');
  await updateReportWithPDFInfo(orderId, storageUrl, reportType);

  if (!isDraft) {
      console.log('Generating print-ready PDF variant...');
      try {
        const printResult = await generatePrintPDFWithAPI(reportData, preparedHtml);
        const printPdfUrl = printResult.url;
        let printBlob: Blob | null = null;

        try {
          printBlob = await downloadLargePDF(printPdfUrl);
        } catch (printDownloadError) {
          console.warn('Print PDF robust download failed, trying standard fetch...', printDownloadError);

          const response = await fetch(printPdfUrl, {
            method: 'GET',
            headers: {
              'Accept': 'application/pdf, */*',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              'Cache-Control': 'no-cache',
            },
          });

          if (response.ok) {
            const buffer = await response.arrayBuffer();
            printBlob = new Blob([buffer], { type: 'application/pdf' });
          } else {
            throw new Error(`Standard print PDF download failed: ${response.status} ${response.statusText}`);
          }
        }

        if (printBlob) {
          const printStorageUrl = await savePDFToStorage(printBlob, orderId, 'print');
          await updateReportWithPrintPDFInfo(orderId, printStorageUrl);
        }
      } catch (printError) {
        console.error('Print PDF generation failed:', printError);
      }
    }

    console.log('PDF generation completed successfully');
    return storageUrl;
  } catch (error) {
    console.error('PDF generation and save failed:', error);
    alert('An error occurred while generating the PDF. Please try again.');
    return null;
  }
}

// View PDF report (opens in new tab)
export async function viewPDFReport(orderId: string, reportData: ReportData): Promise<string | null> {
  console.log('viewPDFReport called for order:', orderId);
  
  try {
    const pdfUrl = await generateAndSavePDFReport(orderId, reportData);
    if (!pdfUrl) {
      console.error('No PDF URL returned');
      return null;
    }
    
    console.log('PDF URL ready for viewing:', pdfUrl);
    return pdfUrl;
  } catch (error) {
    console.error('View PDF error:', error);
    alert('Failed to view PDF report');
    return null;
  }
}

// Enhanced Download PDF report with progress callback
export async function downloadPDFReport(
  orderId: string, 
  reportData: ReportData, 
  onProgress?: (stage: string, progress?: number) => void
): Promise<boolean> {
  console.log('downloadPDFReport called for order:', orderId);
  
  try {
    onProgress?.('Initializing PDF generation...', 0);
    
    const pdfUrl = await generateAndSavePDFReportWithProgress(orderId, reportData, onProgress);
    if (!pdfUrl) {
      console.error('No PDF URL generated');
      onProgress?.('Failed to generate PDF', 0);
      return false;
    }

    onProgress?.('Starting download...', 95);
    console.log('Initiating download from URL:', pdfUrl);
    
    // Handle blob URLs differently
    if (pdfUrl.startsWith('blob:')) {
      // For blob URLs, open in new window
      window.open(pdfUrl, '_blank');
      onProgress?.('Download completed!', 100);
      return true;
    }
    
    // For regular URLs, create download link
    const link = document.createElement('a');
    link.href = pdfUrl;
    link.download = `Report_${reportData.patient.name.replace(/\s+/g, '_')}_${orderId}.pdf`;
    link.target = '_blank';
    
    // Some browsers require the link to be in the DOM
    document.body.appendChild(link);
    
    // Trigger download
    link.click();
    
    // Clean up
    setTimeout(() => {
      document.body.removeChild(link);
    }, 100);
    
    onProgress?.('Download completed!', 100);
    console.log('Download initiated successfully');
    return true;
  } catch (error) {
    console.error('Download failed:', error);
    onProgress?.('Download failed', 0);
    alert('Failed to download PDF report');
    return false;
  }
}

// Generate sample report data for testing
export const generateSampleReportData = (template: LabTemplate = defaultLabTemplate): ReportData => {
  return {
    patient: {
      name: 'Ravi Mehta',
      id: 'PTX100256',
      age: 45,
      gender: 'Male',
      referredBy: 'Dr. Anjali Desai',
    },
    report: {
      reportId: 'RPT20250629',
      collectionDate: '2025-06-28',
      reportDate: '2025-06-29',
      reportType: 'Liver Function Test (LFT)',
    },
    testResults: [
      { parameter: 'SGOT (AST)', result: '72', unit: 'U/L', referenceRange: '15–37', flag: 'H' },
      { parameter: 'SGPT (ALT)', result: '105', unit: 'U/L', referenceRange: '16–63', flag: 'H' },
      { parameter: 'Total Bilirubin', result: '1.9', unit: 'mg/dL', referenceRange: '0.2–1', flag: 'H' },
      { parameter: 'Direct Bilirubin', result: '1.1', unit: 'mg/dL', referenceRange: '0.0–0.3', flag: 'H' },
      { parameter: 'Albumin', result: '2.8', unit: 'g/dL', referenceRange: '3.4–5', flag: 'L' },
      { parameter: 'Total Protein', result: '6.2', unit: 'g/dL', referenceRange: '6.0–8.3', flag: '' },
      { parameter: 'ALP', result: '120', unit: 'U/L', referenceRange: '40–150', flag: '' },
      { parameter: 'GGT', result: '85', unit: 'U/L', referenceRange: '10–50', flag: 'H' },
    ],
    interpretation: 'Liver enzymes (AST, ALT, GGT) are significantly elevated. Bilirubin levels are increased with predominant direct fraction. Low albumin suggests impaired synthetic function. These findings are suggestive of hepatocellular injury with cholestatic pattern. Clinical correlation and further evaluation recommended.',
    template,
  };
};

// Utility function to download PDF from URL
export const downloadPDFFromURL = async (url: string, filename: string): Promise<void> => {
  try {
    console.log('Downloading PDF from URL:', url);
    
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download PDF: ${response.statusText}`);
    }
    
    const blob = await response.blob();
    const downloadUrl = window.URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    // Clean up the blob URL
    setTimeout(() => {
      window.URL.revokeObjectURL(downloadUrl);
    }, 100);
    
    console.log('PDF download completed');
  } catch (error) {
    console.error('Error downloading PDF:', error);
    throw error;
  }
};

// Function to test PDF generation without saving to database
export const testPDFGeneration = async (): Promise<void> => {
  console.log('Testing PDF generation...');
  
  try {
    const sampleData = generateSampleReportData();
    const pdfUrl = await generatePDFWithAPI(sampleData);
    
    if (pdfUrl) {
      console.log('Test PDF generated successfully:', pdfUrl);
      window.open(pdfUrl, '_blank');
    } else {
      console.error('Test PDF generation failed');
    }
  } catch (error) {
    console.error('Test PDF generation error:', error);
  }
};

// Debug function to test storage upload directly
export const testStorageUpload = async (): Promise<void> => {
  console.log('Testing storage upload...');
  
  try {
    // Create a test PDF blob
    const testContent = new Blob(['%PDF-1.4\n1 0 obj\n<<\n/Type /Catalog\n/Pages 2 0 R\n>>\nendobj\n2 0 obj\n<<\n/Type /Pages\n/Kids [3 0 R]\n/Count 1\n>>\nendobj\n3 0 obj\n<<\n/Type /Page\n/Parent 2 0 R\n/MediaBox [0 0 612 792]\n>>\nendobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \ntrailer\n<<\n/Size 4\n/Root 1 0 R\n>>\nstartxref\n174\n%%EOF'], { type: 'application/pdf' });
    
    console.log('Test blob created:', testContent.size, 'bytes');
    
    // Check auth status
    const { data: { session }, error: authError } = await supabase.auth.getSession();
    console.log('Auth check - session exists:', !!session);
    console.log('Auth error:', authError);
    if (session) {
      console.log('User ID:', session.user.id);
      console.log('Access token length:', session.access_token.length);
    }
    
    // Test upload
    const fileName = `test_${Date.now()}.pdf`;
    console.log('Attempting upload of:', fileName);
    
    const { data, error } = await supabase.storage
      .from('reports')
      .upload(fileName, testContent, {
        contentType: 'application/pdf',
        upsert: true
      });
    
    if (error) {
      console.error('Upload failed:', error);
      console.error('Error details:', JSON.stringify(error, null, 2));
    } else {
      console.log('Upload successful:', data);
      
      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('reports')
        .getPublicUrl(fileName);
      
      console.log('Public URL:', publicUrl);
      
      // Test URL accessibility
      try {
        const testResponse = await fetch(publicUrl, { method: 'HEAD' });
        console.log('URL accessible:', testResponse.ok, testResponse.status);
      } catch (urlError) {
        console.error('URL test failed:', urlError);
      }
    }
  } catch (error) {
    console.error('Test storage upload error:', error);
  }
};

// Robust PDF download function for large files
export const downloadLargePDF = async (url: string, maxRetries: number = 3): Promise<Blob> => {
  console.log('🔄 Downloading large PDF from:', url);
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`📥 Attempt ${attempt}/${maxRetries}...`);
      
      // Create abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/pdf, */*',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache',
          'Range': 'bytes=0-' // Request all bytes
        },
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const contentLength = response.headers.get('content-length');
      const contentType = response.headers.get('content-type');
      
      console.log('📊 Response headers:', {
        status: response.status,
        contentType,
        contentLength: contentLength ? `${parseInt(contentLength)} bytes` : 'unknown',
        acceptRanges: response.headers.get('accept-ranges'),
        cacheControl: response.headers.get('cache-control')
      });
      
      // Read the response as a stream for large files
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Response body is not readable');
      }
      
      const chunks: Uint8Array[] = [];
      let receivedLength = 0;
      const expectedLength = contentLength ? parseInt(contentLength) : 0;
      
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;
        
        chunks.push(value);
        receivedLength += value.length;
        
        if (expectedLength > 0) {
          const progress = (receivedLength / expectedLength * 100).toFixed(1);
          console.log(`📈 Download progress: ${progress}% (${receivedLength}/${expectedLength} bytes)`);
        }
      }
      
      console.log(`✅ Download completed: ${receivedLength} bytes received`);
      
      // Verify we got the expected amount
      if (expectedLength > 0 && receivedLength !== expectedLength) {
        console.warn(`⚠️ Size mismatch: expected ${expectedLength}, got ${receivedLength}`);
        if (receivedLength < expectedLength * 0.9) { // If we got less than 90% of expected
          throw new Error(`Incomplete download: ${receivedLength}/${expectedLength} bytes`);
        }
      }
      
      // Combine all chunks into a single array buffer
      const arrayBuffer = new ArrayBuffer(receivedLength);
      const uint8Array = new Uint8Array(arrayBuffer);
      let position = 0;
      
      for (const chunk of chunks) {
        uint8Array.set(chunk, position);
        position += chunk.length;
      }
      
      // Validate PDF format
      const firstBytes = new Uint8Array(arrayBuffer.slice(0, 8));
      const header = String.fromCharCode(...firstBytes);
      
      if (!header.startsWith('%PDF')) {
        throw new Error(`Invalid PDF header: ${header}`);
      }
      
      // Check for PDF end marker
      const lastBytes = new Uint8Array(arrayBuffer.slice(-10));
      const footer = String.fromCharCode(...lastBytes);
      const hasEOF = footer.includes('%%EOF') || arrayBuffer.byteLength < 1000; // Small files might not have clear EOF
      
      console.log('📄 PDF validation:', {
        header: header.substring(0, 8),
        size: arrayBuffer.byteLength,
        hasEOF,
        isValid: header.startsWith('%PDF')
      });
      
      if (!hasEOF && arrayBuffer.byteLength > 1000) {
        console.warn('⚠️ PDF may be incomplete - no EOF marker found');
      }
      
      // Create and return the blob
      const blob = new Blob([arrayBuffer], { type: 'application/pdf' });
      console.log(`✅ PDF blob created successfully: ${blob.size} bytes`);
      
      return blob;
      
    } catch (error) {
      console.error(`❌ Attempt ${attempt} failed:`, error);
      
      if (attempt === maxRetries) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to download PDF after ${maxRetries} attempts: ${errorMessage}`);
      }
      
      // Wait before retry (exponential backoff)
      const delay = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s...
      console.log(`⏳ Waiting ${delay}ms before retry...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw new Error('This should never be reached');
};

// Comprehensive debug function to test the entire PDF pipeline
export const debugPDFPipeline = async (): Promise<void> => {
  console.log('🔍 Starting comprehensive PDF pipeline debug...');
  
  try {
    // Step 1: Generate PDF with PDF.co
    console.log('📝 Step 1: Generating PDF with PDF.co...');
    const sampleData = generateSampleReportData();
    const pdfcoUrl = await generatePDFWithAPI(sampleData);
    console.log('✅ PDF.co URL generated:', pdfcoUrl);
    
    // Step 2: Test PDF.co URL directly
    console.log('🔗 Step 2: Testing PDF.co URL directly...');
    window.open(pdfcoUrl, '_blank');
    
    // Step 3: Download and analyze the PDF
    console.log('⬇️ Step 3: Downloading PDF from PDF.co...');
    const response = await fetch(pdfcoUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/pdf',
        'User-Agent': 'Mozilla/5.0 (compatible; LIMS-PDF-Downloader)',
      }
    });
    
    console.log('📊 Response details:', {
      status: response.status,
      statusText: response.statusText,
      contentType: response.headers.get('content-type'),
      contentLength: response.headers.get('content-length'),
      headers: [...response.headers.entries()]
    });
    
    if (!response.ok) {
      throw new Error(`PDF.co download failed: ${response.status}`);
    }
    
    // Step 4: Get ArrayBuffer and analyze
    console.log('🔬 Step 4: Analyzing downloaded content...');
    const arrayBuffer = await response.arrayBuffer();
    console.log('📏 ArrayBuffer size:', arrayBuffer.byteLength);
    
    // Check PDF header
    const firstBytes = new Uint8Array(arrayBuffer.slice(0, 10));
    const header = String.fromCharCode(...firstBytes);
    console.log('📄 PDF header:', JSON.stringify(header));
    console.log('✅ Valid PDF header:', header.startsWith('%PDF'));
    
    // Check PDF footer
    const lastBytes = new Uint8Array(arrayBuffer.slice(-10));
    const footer = String.fromCharCode(...lastBytes);
    console.log('📄 PDF footer:', JSON.stringify(footer));
    
    // Step 5: Create blob and test locally
    console.log('💾 Step 5: Creating blob and testing locally...');
    const pdfBlob = new Blob([arrayBuffer], { type: 'application/pdf' });
    console.log('🎯 Blob details:', {
      size: pdfBlob.size,
      type: pdfBlob.type,
      arrayBufferSize: arrayBuffer.byteLength,
      sizesMatch: pdfBlob.size === arrayBuffer.byteLength
    });
    
    // Create local blob URL and test
    const localBlobUrl = URL.createObjectURL(pdfBlob);
    console.log('🔗 Local blob URL:', localBlobUrl);
    console.log('🚀 Opening local blob in new tab...');
    setTimeout(() => window.open(localBlobUrl, '_blank'), 2000);
    
    // Step 6: Upload to Supabase and test
    console.log('☁️ Step 6: Uploading to Supabase...');
    const fileName = `debug_${Date.now()}.pdf`;
    
    const { data, error } = await supabase.storage
      .from('reports')
      .upload(fileName, pdfBlob, {
        contentType: 'application/pdf',
        upsert: true
      });
    
    if (error) {
      console.error('❌ Supabase upload failed:', error);
      return;
    }
    
    console.log('✅ Supabase upload successful:', data);
    
    // Step 7: Get public URL and test
    const { data: { publicUrl } } = supabase.storage
      .from('reports')
      .getPublicUrl(fileName);
    
    console.log('🔗 Supabase public URL:', publicUrl);
    
    // Step 8: Download from Supabase and compare
    console.log('🔄 Step 8: Downloading from Supabase to compare...');
    const supabaseResponse = await fetch(publicUrl);
    console.log('📊 Supabase response:', {
      status: supabaseResponse.status,
      contentType: supabaseResponse.headers.get('content-type'),
      contentLength: supabaseResponse.headers.get('content-length')
    });
    
    if (supabaseResponse.ok) {
      const supabaseArrayBuffer = await supabaseResponse.arrayBuffer();
      console.log('📏 Downloaded from Supabase size:', supabaseArrayBuffer.byteLength);
      
      // Compare sizes
      console.log('🔍 Size comparison:', {
        original: arrayBuffer.byteLength,
        downloaded: supabaseArrayBuffer.byteLength,
        match: arrayBuffer.byteLength === supabaseArrayBuffer.byteLength
      });
      
      // Compare first few bytes
      const downloadedFirstBytes = new Uint8Array(supabaseArrayBuffer.slice(0, 10));
      const downloadedHeader = String.fromCharCode(...downloadedFirstBytes);
      console.log('📄 Downloaded PDF header:', JSON.stringify(downloadedHeader));
      
      // Test if downloaded version works
      const downloadedBlob = new Blob([supabaseArrayBuffer], { type: 'application/pdf' });
      const downloadedUrl = URL.createObjectURL(downloadedBlob);
      console.log('🚀 Opening downloaded version in new tab...');
      setTimeout(() => window.open(downloadedUrl, '_blank'), 4000);
      
      // Direct comparison
      const originalBytes = new Uint8Array(arrayBuffer);
      const downloadedBytes = new Uint8Array(supabaseArrayBuffer);
      let differences = 0;
      for (let i = 0; i < Math.min(originalBytes.length, downloadedBytes.length); i++) {
        if (originalBytes[i] !== downloadedBytes[i]) {
          differences++;
          if (differences <= 10) {
            console.log(`Byte difference at ${i}: ${originalBytes[i]} vs ${downloadedBytes[i]}`);
          }
        }
      }
      console.log('🔍 Total byte differences:', differences);
    }
    
    console.log('🚀 Opening Supabase URL in new tab...');
    setTimeout(() => window.open(publicUrl, '_blank'), 6000);
    
    console.log('✅ Debug pipeline completed. Check the opened tabs to compare results.');
    
  } catch (error) {
    console.error('❌ Debug pipeline failed:', error);
  }
};

// Export all functions and interfaces
export default {
  generateAndSavePDFReport,
  viewPDFReport,
  downloadPDFReport,
  generateSampleReportData,
  downloadPDFFromURL,
  saveLabTemplate,
  getLabTemplates,
  getLabTemplate,
  defaultLabTemplate,
  testPDFGeneration,
  testStorageUpload,
  debugPDFPipeline
};