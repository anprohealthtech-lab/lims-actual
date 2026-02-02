/**
 * STANDALONE PDF.CO HELPER (JavaScript/Browser Compatible)
 * ==========================================================
 * 
 * Simple copy-paste script for generating PDFs with PDF.co
 * Works in: Browser, Node.js, Deno, Edge Functions
 * 
 * NO DEPENDENCIES - Pure JavaScript
 * 
 * QUICK USAGE:
 * ------------
 * const pdfUrl = await generatePdfWithLetterhead({
 *   html: '<h1>Hello</h1>',
 *   backgroundImageUrl: 'https://your-cdn.com/letterhead.png',
 *   apiKey: 'YOUR_API_KEY',
 *   filename: 'output.pdf',
 *   topMargin: 130,
 *   bottomMargin: 130
 * });
 */

// ============================================================
// CONFIGURATION
// ============================================================

const PDFCO_CONFIG = {
    API_URL: 'https://api.pdf.co/v1/pdf/convert/from/html',
    JOB_STATUS_URL: 'https://api.pdf.co/v1/job/check',
    A4_WIDTH_MM: 210,
    A4_HEIGHT_MM: 297,
    DEFAULT_MARGINS: '0px 20px 0px 20px',
    DEFAULT_SCALE: 1.0,
};

// ============================================================
// BASELINE CSS
// ============================================================

const BASELINE_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
* { box-sizing: border-box; }
body { font-family: 'Inter', Arial, sans-serif; color: #1f2937; font-size: 14px; line-height: 1.6; margin: 0; padding: 0; }
h1, h2, h3, h4 { color: #111827; margin: 0 0 0.5rem; line-height: 1.3; }
h1 { font-size: 2rem; } h2 { font-size: 1.5rem; } h3 { font-size: 1.25rem; }
p { margin: 0 0 0.5rem; }
table { width: 100%; border-collapse: collapse; margin: 0.75rem 0; }
table th, table td { border: 1px solid #d1d5db; padding: 10px 12px; text-align: left; }
table thead th { background-color: #f1f5f9; font-weight: 600; }
table tbody tr:nth-child(even) { background-color: #f8fafc; }
img { max-width: 100%; height: auto; display: block; }
.avoid-break { break-inside: avoid; page-break-inside: avoid; }
tr { page-break-inside: avoid !important; break-inside: avoid !important; }
thead { display: table-header-group; }
`;

// ============================================================
// MAIN FUNCTION
// ============================================================

/**
 * Generate PDF with optional letterhead background
 * 
 * @param {Object} options
 * @param {string} options.html - HTML content to convert
 * @param {string|null} options.backgroundImageUrl - Background image URL (null for none)
 * @param {string} options.apiKey - PDF.co API key
 * @param {string} options.filename - Output filename
 * @param {number} [options.topMargin=130] - Top margin in pixels
 * @param {number} [options.bottomMargin=130] - Bottom margin in pixels
 * @param {string} [options.customCss=''] - Additional CSS
 * @param {string|null} [options.verificationUrl=null] - QR code URL
 * @param {boolean} [options.grayscale=false] - Black & white mode
 * @returns {Promise<string>} - PDF URL
 */
async function generatePdfWithLetterhead(options) {
    const {
        html,
        backgroundImageUrl = null,
        apiKey,
        filename,
        topMargin = 130,
        bottomMargin = 130,
        customCss = '',
        verificationUrl = null,
        grayscale = false,
    } = options;

    console.log('🚀 Generating PDF with PDF.co...');

    // Build complete HTML document
    const fullHtml = buildHtmlDocument({
        html,
        backgroundImageUrl,
        topMargin,
        bottomMargin,
        customCss,
        verificationUrl,
        grayscale,
    });

    // Determine margins
    const margins = backgroundImageUrl
        ? PDFCO_CONFIG.DEFAULT_MARGINS
        : `${topMargin}px 20px ${bottomMargin}px 20px`;

    // Send to PDF.co
    const pdfUrl = await sendToPdfCo({
        html: fullHtml,
        filename,
        apiKey,
        margins,
        grayscale,
    });

    console.log('✅ PDF generated:', pdfUrl);
    return pdfUrl;
}

// ============================================================
// BUILD HTML DOCUMENT
// ============================================================

function buildHtmlDocument(options) {
    const {
        html,
        backgroundImageUrl,
        topMargin,
        bottomMargin,
        customCss,
        verificationUrl,
        grayscale,
    } = options;

    // QR code HTML
    const qrTop = backgroundImageUrl ? topMargin + 20 : 50;
    const qrHtml = verificationUrl
        ? `<div style="position: absolute; top: ${qrTop}px; right: 25px; z-index: 9999;">
         <img src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(verificationUrl)}" 
              alt="Verify" style="width: 75px; height: 75px; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.1);" />
       </div>`
        : '';

    // Letterhead CSS
    const letterheadCss = backgroundImageUrl
        ? `
    html, body { margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    #page-bg {
      position: fixed; top: 0; left: 0;
      width: ${PDFCO_CONFIG.A4_WIDTH_MM}mm;
      height: ${PDFCO_CONFIG.A4_HEIGHT_MM}mm;
      z-index: 0; pointer-events: none;
      background-image: url('${backgroundImageUrl}');
      background-repeat: no-repeat;
      background-position: top left;
      background-size: ${PDFCO_CONFIG.A4_WIDTH_MM}mm ${PDFCO_CONFIG.A4_HEIGHT_MM}mm;
    }
    .pdf-content { position: relative; z-index: 1; background: transparent !important; }
    table { background: rgba(255, 255, 255, 0.88) !important; }
    table tbody tr:nth-child(even) { background: rgba(248, 250, 252, 0.88) !important; }
    `
        : '';

    // Grayscale CSS
    const grayscaleCss = grayscale
        ? `
    html, body { -webkit-filter: grayscale(100%) !important; filter: grayscale(100%) !important; background: white !important; color: black !important; }
    body, p, span, td, th, div, h1, h2, h3, h4, h5, h6 { color: #000000 !important; }
    table, th, td { border-color: #000 !important; }
    `
        : '';

    // Body content with or without letterhead
    const bodyContent = backgroundImageUrl
        ? `
    ${qrHtml}
    <div id="page-bg"></div>
    <table style="width: 100%; border: none; border-collapse: collapse;">
      <thead style="display: table-header-group;">
        <tr><td style="border: none; padding: 0;"><div style="height: ${topMargin}px;"></div></td></tr>
      </thead>
      <tfoot style="display: table-footer-group;">
        <tr><td style="border: none; padding: 0;"><div style="height: ${bottomMargin}px;"></div></td></tr>
      </tfoot>
      <tbody>
        <tr><td style="border: none; padding: 0 20px;">
          <main class="pdf-content">${html}</main>
        </td></tr>
      </tbody>
    </table>
    `
        : `
    ${qrHtml}
    <main class="pdf-content" style="padding: 20px;">${html}</main>
    `;

    // Combine everything
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>${BASELINE_CSS}${letterheadCss}${grayscaleCss}${customCss}</style>
</head>
<body>${bodyContent}</body>
</html>`;
}

// ============================================================
// SEND TO PDF.CO
// ============================================================

async function sendToPdfCo(options) {
    const { html, filename, apiKey, margins, grayscale } = options;

    const payload = {
        name: filename,
        html: html,
        async: true,
        margins: margins,
        paperSize: 'A4',
        displayHeaderFooter: false,
        header: '',
        footer: '',
        headerHeight: '0px',
        footerHeight: '0px',
        scale: PDFCO_CONFIG.DEFAULT_SCALE,
        mediaType: grayscale ? 'print' : 'screen',
        printBackground: !grayscale,
    };

    const response = await fetch(PDFCO_CONFIG.API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
        },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`PDF.co error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();

    if (result.error) {
        throw new Error(`PDF.co error: ${result.message}`);
    }

    // Return URL immediately if available
    if (result.url) {
        return result.url;
    }

    // Poll for async job
    if (result.jobId) {
        return pollJob(result.jobId, apiKey);
    }

    throw new Error('PDF.co did not return URL or jobId');
}

// ============================================================
// POLL JOB STATUS
// ============================================================

async function pollJob(jobId, apiKey) {
    const maxAttempts = 60;
    const delayMs = 5000;

    for (let i = 1; i <= maxAttempts; i++) {
        console.log(`📊 Polling job ${jobId} (${i}/${maxAttempts})...`);

        const response = await fetch(
            `${PDFCO_CONFIG.JOB_STATUS_URL}?jobid=${jobId}`,
            { headers: { 'x-api-key': apiKey } }
        );

        if (!response.ok) {
            throw new Error(`Job status check failed: ${response.statusText}`);
        }

        const status = await response.json();

        if (status.status === 'success' && status.url) {
            return status.url;
        }

        if (status.status === 'error') {
            throw new Error(`PDF generation failed: ${status.message || 'Unknown error'}`);
        }

        if (i < maxAttempts) {
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
    }

    throw new Error('PDF generation timeout');
}

// ============================================================
// CONVENIENCE FUNCTIONS
// ============================================================

/**
 * Generate print-friendly PDF (grayscale, no background)
 */
async function generatePrintPdf(options) {
    return generatePdfWithLetterhead({
        ...options,
        backgroundImageUrl: null,
        grayscale: true,
    });
}

/**
 * Build HTML without sending to PDF.co (for preview/debugging)
 */
function buildPdfHtml(options) {
    return buildHtmlDocument({
        html: options.html,
        backgroundImageUrl: options.backgroundImageUrl || null,
        topMargin: options.topMargin || 130,
        bottomMargin: options.bottomMargin || 130,
        customCss: options.customCss || '',
        verificationUrl: options.verificationUrl || null,
        grayscale: options.grayscale || false,
    });
}

// ============================================================
// EXPORTS
// ============================================================

// For ES6 modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        generatePdfWithLetterhead,
        generatePrintPdf,
        buildPdfHtml,
    };
}

// For browser/window
if (typeof window !== 'undefined') {
    window.PdfCoHelper = {
        generatePdfWithLetterhead,
        generatePrintPdf,
        buildPdfHtml,
    };
}

// ============================================================
// USAGE EXAMPLES (uncomment to test)
// ============================================================

/*

// EXAMPLE 1: PDF with letterhead
const pdfUrl1 = await generatePdfWithLetterhead({
  html: '<h1>Report Title</h1><p>Content here</p>',
  backgroundImageUrl: 'https://your-cdn.com/letterhead.png',
  apiKey: 'YOUR_PDFCO_API_KEY',
  filename: 'report.pdf',
  topMargin: 130,
  bottomMargin: 130,
});

// EXAMPLE 2: Clean PDF (no background)
const pdfUrl2 = await generatePdfWithLetterhead({
  html: '<h1>Invoice</h1><p>Total: $100</p>',
  backgroundImageUrl: null,
  apiKey: 'YOUR_PDFCO_API_KEY',
  filename: 'invoice.pdf',
  topMargin: 40,
  bottomMargin: 40,
});

// EXAMPLE 3: Print version
const pdfUrl3 = await generatePrintPdf({
  html: '<h1>Print Version</h1>',
  apiKey: 'YOUR_PDFCO_API_KEY',
  filename: 'print.pdf',
});

// EXAMPLE 4: With QR code
const pdfUrl4 = await generatePdfWithLetterhead({
  html: '<h1>Verified Report</h1>',
  backgroundImageUrl: 'https://...',
  apiKey: 'YOUR_PDFCO_API_KEY',
  filename: 'verified.pdf',
  verificationUrl: 'https://myapp.com/verify?id=123',
});

// EXAMPLE 5: Preview HTML
const htmlPreview = buildPdfHtml({
  html: '<h1>Preview</h1>',
  backgroundImageUrl: 'https://...',
  topMargin: 130,
  bottomMargin: 130,
});
console.log(htmlPreview);

*/
