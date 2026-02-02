/**
 * REUSABLE PDF.CO HELPER SCRIPT
 * ==============================
 * 
 * This script provides utilities to send HTML with background images to PDF.co
 * in proper A4 size format with letterhead support.
 * 
 * USAGE EXAMPLE:
 * ```typescript
 * const pdfUrl = await generatePdfWithLetterhead({
 *   html: '<h1>Hello World</h1><p>Your content here</p>',
 *   backgroundImageUrl: 'https://example.com/letterhead.png',
 *   apiKey: 'YOUR_PDFCO_API_KEY',
 *   filename: 'report.pdf',
 *   topMargin: 130,
 *   bottomMargin: 130
 * });
 * ```
 */

// ============================================================
// CONFIGURATION
// ============================================================

const PDFCO_API_URL = 'https://api.pdf.co/v1/pdf/convert/from/html';
const PDFCO_JOB_STATUS_URL = 'https://api.pdf.co/v1/job/check';

// Default A4 PDF settings
const DEFAULT_A4_SETTINGS = {
  paperSize: 'A4',
  margins: '0px 20px 0px 20px', // top right bottom left
  scale: 1.0,
  mediaType: 'screen',
  printBackground: true,
  displayHeaderFooter: false,
  headerHeight: '0px',
  footerHeight: '0px',
};

// ============================================================
// BASELINE CSS FOR PDF RENDERING
// ============================================================

const BASELINE_PDF_CSS = `
/* PDF Baseline Styles */
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

:root {
  --pdf-font-family: "Inter", Arial, sans-serif;
  --pdf-text-color: #1f2937;
  --pdf-heading-color: #111827;
  --pdf-border-color: #d1d5db;
}

* {
  box-sizing: border-box;
}

body {
  font-family: var(--pdf-font-family);
  color: var(--pdf-text-color);
  font-size: 14px;
  line-height: 1.6;
  margin: 0;
  padding: 0;
}

/* Typography */
h1, h2, h3, h4, h5, h6 {
  font-family: var(--pdf-font-family);
  color: var(--pdf-heading-color);
  margin: 0 0 0.5rem;
  line-height: 1.3;
}

h1 { font-size: 2rem; }
h2 { font-size: 1.5rem; }
h3 { font-size: 1.25rem; }
h4 { font-size: 1.1rem; }

p {
  margin: 0 0 0.5rem;
}

/* Tables */
table {
  width: 100%;
  border-collapse: collapse;
  margin: 0.75rem 0;
}

table th,
table td {
  border: 1px solid var(--pdf-border-color);
  padding: 10px 12px;
  text-align: left;
  vertical-align: top;
}

table thead th {
  background-color: #f1f5f9;
  font-weight: 600;
}

table tbody tr:nth-child(even) {
  background-color: #f8fafc;
}

/* Images */
img {
  max-width: 100%;
  height: auto;
  display: block;
}

/* Page break helpers */
.avoid-break {
  break-inside: avoid;
  page-break-inside: avoid;
}

.page-break-before {
  break-before: page;
  page-break-before: always;
}

/* Prevent table rows from breaking across pages */
tr {
  page-break-inside: avoid !important;
  break-inside: avoid !important;
}

thead {
  display: table-header-group;
}

tfoot {
  display: table-footer-group;
}
`;

// ============================================================
// INTERFACE DEFINITIONS
// ============================================================

interface PdfGenerationOptions {
  /** The HTML content to convert to PDF */
  html: string;
  
  /** Background image URL (letterhead) - optional */
  backgroundImageUrl?: string | null;
  
  /** PDF.co API key */
  apiKey: string;
  
  /** Output filename (e.g., 'report.pdf') */
  filename: string;
  
  /** Top margin/spacer height in pixels (default: 130) */
  topMargin?: number;
  
  /** Bottom margin/spacer height in pixels (default: 130) */
  bottomMargin?: number;
  
  /** Additional custom CSS to inject */
  customCss?: string;
  
  /** QR code verification URL (optional) */
  verificationUrl?: string | null;
  
  /** Enable grayscale/black & white mode for print */
  grayscale?: boolean;
  
  /** Use async job mode (recommended for large documents) */
  async?: boolean;
}

interface PdfCoResponse {
  url?: string;
  jobId?: string;
  error?: boolean;
  message?: string;
}

// ============================================================
// CORE FUNCTIONS
// ============================================================

/**
 * Build complete HTML document with A4 sizing and optional letterhead background
 */
function buildA4PdfDocument(options: {
  bodyHtml: string;
  backgroundImageUrl?: string | null;
  customCss?: string;
  topMargin?: number;
  bottomMargin?: number;
  verificationUrl?: string | null;
  grayscale?: boolean;
}): string {
  const topSpacerHeight = options.topMargin ?? 130;
  const bottomSpacerHeight = options.bottomMargin ?? 130;
  
  // QR Code positioning
  const qrTopPos = options.backgroundImageUrl 
    ? (topSpacerHeight + 20) 
    : 50;
  
  // Generate QR code HTML if verification URL provided
  const qrCodeHtml = options.verificationUrl 
    ? `<div style="position: absolute; top: ${qrTopPos}px; right: 25px; z-index: 9999;">
         <img src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(options.verificationUrl)}" 
              alt="Verify Document"
              style="width: 75px; height: 75px; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.1);" />
       </div>`
    : '';
  
  // Letterhead background styles
  const letterheadStyles = options.backgroundImageUrl 
    ? `
    /* Letterhead Background - Fixed layer that repeats on every PDF page */
    html, body {
      margin: 0;
      padding: 0;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    
    /* The repeating full-page background layer */
    #page-bg {
      position: fixed;
      top: 0;
      left: 0;
      width: 210mm;   /* A4 width */
      height: 297mm;  /* A4 height */
      z-index: 0;
      pointer-events: none;
      background-image: url('${options.backgroundImageUrl}');
      background-repeat: no-repeat;
      background-position: top left;
      background-size: 210mm 297mm; /* A4 exact sizing */
    }
    
    /* Keep content above the background */
    .pdf-content {
      position: relative;
      z-index: 1;
      background: transparent !important;
    }
    
    /* Keep tables readable with semi-transparent background */
    table {
      background: rgba(255, 255, 255, 0.88) !important;
    }
    
    table tbody tr:nth-child(even) {
      background: rgba(248, 250, 252, 0.88) !important;
    }
    `
    : '';
  
  // Grayscale CSS for print mode
  const grayscaleCss = options.grayscale 
    ? `
    html, body {
      -webkit-filter: grayscale(100%) !important;
      filter: grayscale(100%) !important;
      background: white !important;
      color: black !important;
    }
    
    body, p, span, td, th, div, h1, h2, h3, h4, h5, h6 {
      color: #000000 !important;
    }
    
    table, th, td {
      border-color: #000 !important;
    }
    `
    : '';
  
  // Build wrapped body with optional letterhead
  const wrappedBody = options.backgroundImageUrl 
    ? `
    ${qrCodeHtml}
    <!-- Fixed background layer - repeats on every PDF page -->
    <div id="page-bg"></div>
    
    <!-- Layout Table for Multi-Page Spacing -->
    <table style="width: 100%; border: none; border-collapse: collapse;">
      <!-- HEADER SPACER (Repeats on every page) -->
      <thead style="display: table-header-group;">
        <tr>
          <td style="border: none; padding: 0;">
            <div style="height: ${topSpacerHeight}px;"></div>
          </td>
        </tr>
      </thead>
      
      <!-- FOOTER SPACER (Repeats on every page) -->
      <tfoot style="display: table-footer-group;">
        <tr>
          <td style="border: none; padding: 0;">
            <div style="height: ${bottomSpacerHeight}px;"></div>
          </td>
        </tr>
      </tfoot>
      
      <!-- MAIN CONTENT -->
      <tbody>
        <tr>
          <td style="border: none; padding: 0 20px;">
            <main class="pdf-content">
              ${options.bodyHtml}
            </main>
          </td>
        </tr>
      </tbody>
    </table>
    `
    : `
    ${qrCodeHtml}
    <main class="pdf-content" style="padding: 20px;">
      ${options.bodyHtml}
    </main>
    `;
  
  // Combine all CSS
  const combinedCss = `
    ${BASELINE_PDF_CSS}
    ${letterheadStyles}
    ${grayscaleCss}
    ${options.customCss || ''}
  `;
  
  // Build complete HTML document
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>${combinedCss}</style>
</head>
<body>
  ${wrappedBody}
</body>
</html>
  `.trim();
}

/**
 * Send HTML to PDF.co API
 */
async function sendToPdfCo(
  html: string,
  filename: string,
  apiKey: string,
  options: {
    margins?: string;
    paperSize?: string;
    scale?: number;
    mediaType?: string;
    printBackground?: boolean;
    async?: boolean;
  } = {}
): Promise<string> {
  console.log('📤 Sending HTML to PDF.co API...');
  console.log('  Filename:', filename);
  console.log('  HTML length:', html.length);
  console.log('  Paper size:', options.paperSize || DEFAULT_A4_SETTINGS.paperSize);
  
  const payload: Record<string, any> = {
    name: filename,
    html: html,
    async: options.async ?? true,
    margins: options.margins || DEFAULT_A4_SETTINGS.margins,
    paperSize: options.paperSize || DEFAULT_A4_SETTINGS.paperSize,
    displayHeaderFooter: DEFAULT_A4_SETTINGS.displayHeaderFooter,
    header: '',
    footer: '',
    headerHeight: DEFAULT_A4_SETTINGS.headerHeight,
    footerHeight: DEFAULT_A4_SETTINGS.footerHeight,
    scale: options.scale ?? DEFAULT_A4_SETTINGS.scale,
    mediaType: options.mediaType || DEFAULT_A4_SETTINGS.mediaType,
    printBackground: options.printBackground ?? DEFAULT_A4_SETTINGS.printBackground,
  };
  
  const response = await fetch(PDFCO_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify(payload),
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`PDF.co API error: ${response.status} ${response.statusText} - ${errorText}`);
  }
  
  const result: PdfCoResponse = await response.json();
  
  if (result.error) {
    throw new Error(`PDF.co API error: ${result.message}`);
  }
  
  // Handle synchronous response
  if (result.url) {
    console.log('✅ PDF generated synchronously');
    return result.url;
  }
  
  // Handle async response (poll for completion)
  if (result.jobId) {
    console.log('📋 PDF.co async job queued:', result.jobId);
    return pollPdfCoJob(result.jobId, apiKey);
  }
  
  throw new Error('PDF.co API did not return a URL or jobId');
}

/**
 * Poll PDF.co job status until completion
 */
async function pollPdfCoJob(jobId: string, apiKey: string): Promise<string> {
  const maxAttempts = 60; // 60 attempts = 5 minutes max
  const delayMs = 5000; // 5 seconds between polls
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(`📊 Polling job status (attempt ${attempt}/${maxAttempts})...`);
    
    const response = await fetch(`${PDFCO_JOB_STATUS_URL}?jobid=${jobId}`, {
      headers: { 'x-api-key': apiKey },
    });
    
    if (!response.ok) {
      throw new Error(`Job status check failed: ${response.statusText}`);
    }
    
    const status = await response.json();
    
    if (status.status === 'success' && status.url) {
      console.log('✅ PDF generation completed');
      return status.url;
    }
    
    if (status.status === 'error') {
      throw new Error(`PDF generation failed: ${status.message || 'Unknown error'}`);
    }
    
    // Still processing, wait before next attempt
    if (attempt < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  
  throw new Error('PDF generation timeout - job did not complete in time');
}

// ============================================================
// MAIN EXPORT FUNCTION
// ============================================================

/**
 * Generate PDF with letterhead using PDF.co
 * 
 * @param options - PDF generation options
 * @returns Promise<string> - URL of the generated PDF
 * 
 * @example
 * ```typescript
 * const pdfUrl = await generatePdfWithLetterhead({
 *   html: '<h1>Report Title</h1><p>Content here</p>',
 *   backgroundImageUrl: 'https://imagekit.io/letterhead.png',
 *   apiKey: process.env.PDFCO_API_KEY,
 *   filename: 'report-2024.pdf',
 *   topMargin: 130,
 *   bottomMargin: 130,
 * });
 * console.log('PDF generated:', pdfUrl);
 * ```
 */
export async function generatePdfWithLetterhead(
  options: PdfGenerationOptions
): Promise<string> {
  console.log('🚀 Starting PDF generation with letterhead...');
  console.log('  Background:', options.backgroundImageUrl ? 'YES' : 'NO');
  console.log('  HTML length:', options.html.length);
  
  // Build complete HTML document
  const fullHtml = buildA4PdfDocument({
    bodyHtml: options.html,
    backgroundImageUrl: options.backgroundImageUrl,
    customCss: options.customCss,
    topMargin: options.topMargin,
    bottomMargin: options.bottomMargin,
    verificationUrl: options.verificationUrl,
    grayscale: options.grayscale,
  });
  
  console.log('  Full HTML length:', fullHtml.length);
  
  // Determine margins based on letterhead presence
  // If letterhead: use 0px vertical margins (background handles spacing via spacers)
  // If no letterhead: use provided margins
  const margins = options.backgroundImageUrl
    ? '0px 20px 0px 20px'
    : `${options.topMargin || 130}px 20px ${options.bottomMargin || 130}px 20px`;
  
  // Send to PDF.co
  const pdfUrl = await sendToPdfCo(
    fullHtml,
    options.filename,
    options.apiKey,
    {
      margins,
      paperSize: 'A4',
      scale: 1.0,
      mediaType: options.grayscale ? 'print' : 'screen',
      printBackground: !options.grayscale,
      async: options.async ?? true,
    }
  );
  
  console.log('✅ PDF generated successfully');
  return pdfUrl;
}

// ============================================================
// ADDITIONAL UTILITY EXPORTS
// ============================================================

/**
 * Generate print-friendly PDF (black & white, no letterhead)
 */
export async function generatePrintPdf(
  options: Omit<PdfGenerationOptions, 'backgroundImageUrl' | 'grayscale'>
): Promise<string> {
  return generatePdfWithLetterhead({
    ...options,
    backgroundImageUrl: null,
    grayscale: true,
  });
}

/**
 * Build HTML document only (without sending to PDF.co)
 * Useful for previewing or debugging
 */
export function buildPdfHtml(options: {
  html: string;
  backgroundImageUrl?: string | null;
  customCss?: string;
  topMargin?: number;
  bottomMargin?: number;
  verificationUrl?: string | null;
}): string {
  return buildA4PdfDocument(options);
}

// Export types for TypeScript users
export type { PdfGenerationOptions, PdfCoResponse };
