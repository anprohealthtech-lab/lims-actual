/**
 * PDF.CO HELPER - USAGE EXAMPLES
 * ================================
 * 
 * This file demonstrates how to use the pdf-co-helper.ts script
 * in your own application.
 */

import { generatePdfWithLetterhead, generatePrintPdf, buildPdfHtml } from './pdf-co-helper.ts';

// ============================================================
// EXAMPLE 1: Basic PDF with Letterhead Background
// ============================================================

async function example1_BasicLetterheadPdf() {
  const htmlContent = `
    <div class="report-header">
      <h1>Medical Report</h1>
      <p>Patient: John Doe</p>
      <p>Date: January 28, 2026</p>
    </div>
    
    <div class="report-body">
      <h2>Test Results</h2>
      <table>
        <thead>
          <tr>
            <th>Test Name</th>
            <th>Value</th>
            <th>Reference Range</th>
            <th>Flag</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Hemoglobin</td>
            <td>14.5</td>
            <td>13.0 - 17.0</td>
            <td>Normal</td>
          </tr>
          <tr>
            <td>WBC Count</td>
            <td>8500</td>
            <td>4000 - 11000</td>
            <td>Normal</td>
          </tr>
        </tbody>
      </table>
    </div>
  `;

  const pdfUrl = await generatePdfWithLetterhead({
    html: htmlContent,
    backgroundImageUrl: 'https://ik.imagekit.io/yourdomain/letterhead-a4.png',
    apiKey: 'YOUR_PDFCO_API_KEY_HERE',
    filename: 'medical-report-123.pdf',
    topMargin: 130,    // Space for header graphic
    bottomMargin: 130, // Space for footer graphic
  });

  console.log('PDF generated at:', pdfUrl);
  return pdfUrl;
}

// ============================================================
// EXAMPLE 2: PDF WITHOUT Letterhead (Clean layout)
// ============================================================

async function example2_CleanPdfNoLetterhead() {
  const htmlContent = `
    <h1>Invoice #INV-2024-001</h1>
    <p>Date: January 28, 2026</p>
    
    <table>
      <thead>
        <tr>
          <th>Item</th>
          <th>Quantity</th>
          <th>Price</th>
          <th>Total</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Product A</td>
          <td>2</td>
          <td>$50.00</td>
          <td>$100.00</td>
        </tr>
        <tr>
          <td>Product B</td>
          <td>1</td>
          <td>$75.00</td>
          <td>$75.00</td>
        </tr>
      </tbody>
    </table>
    
    <p><strong>Total: $175.00</strong></p>
  `;

  const pdfUrl = await generatePdfWithLetterhead({
    html: htmlContent,
    backgroundImageUrl: null, // No letterhead
    apiKey: 'YOUR_PDFCO_API_KEY_HERE',
    filename: 'invoice-001.pdf',
    topMargin: 40,    // Standard margins
    bottomMargin: 40,
  });

  console.log('Clean PDF generated at:', pdfUrl);
  return pdfUrl;
}

// ============================================================
// EXAMPLE 3: Print Version (Black & White, No Background)
// ============================================================

async function example3_PrintFriendlyPdf() {
  const htmlContent = `
    <h1>Lab Report - Print Version</h1>
    <p>Patient: Jane Smith</p>
    <p>Sample ID: S12345</p>
    
    <h2>Results</h2>
    <table>
      <thead>
        <tr>
          <th>Parameter</th>
          <th>Result</th>
          <th>Normal Range</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Glucose</td>
          <td>95 mg/dL</td>
          <td>70-100 mg/dL</td>
        </tr>
        <tr>
          <td>Cholesterol</td>
          <td>185 mg/dL</td>
          <td>&lt;200 mg/dL</td>
        </tr>
      </tbody>
    </table>
  `;

  // Use the dedicated print function (auto-applies grayscale)
  const pdfUrl = await generatePrintPdf({
    html: htmlContent,
    apiKey: 'YOUR_PDFCO_API_KEY_HERE',
    filename: 'lab-report-print.pdf',
    topMargin: 30,
    bottomMargin: 30,
  });

  console.log('Print PDF generated at:', pdfUrl);
  return pdfUrl;
}

// ============================================================
// EXAMPLE 4: PDF with QR Code for Verification
// ============================================================

async function example4_PdfWithQRCode() {
  const htmlContent = `
    <h1>Authenticated Report</h1>
    <p>Report ID: RPT-2024-XYZ</p>
    <p>This report can be verified by scanning the QR code.</p>
    
    <div class="content">
      <h2>Summary</h2>
      <p>All tests completed successfully.</p>
      <p>Results are within normal range.</p>
    </div>
  `;

  const pdfUrl = await generatePdfWithLetterhead({
    html: htmlContent,
    backgroundImageUrl: 'https://ik.imagekit.io/yourdomain/letterhead.png',
    apiKey: 'YOUR_PDFCO_API_KEY_HERE',
    filename: 'verified-report.pdf',
    topMargin: 130,
    bottomMargin: 130,
    verificationUrl: 'https://yourapp.com/verify?id=RPT-2024-XYZ', // QR code links here
  });

  console.log('PDF with QR code generated at:', pdfUrl);
  return pdfUrl;
}

// ============================================================
// EXAMPLE 5: Custom CSS Styling
// ============================================================

async function example5_CustomStyledPdf() {
  const htmlContent = `
    <div class="custom-header">
      <h1>Styled Report</h1>
    </div>
    
    <div class="highlight-box">
      <h2>Important Notice</h2>
      <p>This is a custom styled section with special formatting.</p>
    </div>
    
    <p>Regular content continues here...</p>
  `;

  const customCss = `
    .custom-header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 20px;
      border-radius: 8px;
      margin-bottom: 20px;
    }
    
    .custom-header h1 {
      color: white;
      margin: 0;
    }
    
    .highlight-box {
      background: #fef3c7;
      border-left: 4px solid #f59e0b;
      padding: 15px;
      margin: 20px 0;
    }
    
    .highlight-box h2 {
      color: #92400e;
      margin-top: 0;
    }
  `;

  const pdfUrl = await generatePdfWithLetterhead({
    html: htmlContent,
    backgroundImageUrl: null,
    apiKey: 'YOUR_PDFCO_API_KEY_HERE',
    filename: 'custom-styled-report.pdf',
    customCss: customCss,
    topMargin: 40,
    bottomMargin: 40,
  });

  console.log('Custom styled PDF generated at:', pdfUrl);
  return pdfUrl;
}

// ============================================================
// EXAMPLE 6: Preview HTML Before Generating PDF
// ============================================================

function example6_PreviewHtmlOnly() {
  const htmlContent = `
    <h1>Preview Mode</h1>
    <p>This HTML can be previewed before sending to PDF.co</p>
  `;

  // Build the HTML without sending to PDF.co
  const fullHtml = buildPdfHtml({
    html: htmlContent,
    backgroundImageUrl: 'https://ik.imagekit.io/yourdomain/letterhead.png',
    topMargin: 130,
    bottomMargin: 130,
    verificationUrl: 'https://yourapp.com/verify?id=123',
  });

  // Now you can:
  // 1. Save to file for debugging
  // 2. Send to browser for preview
  // 3. Inspect before generating PDF
  
  console.log('Full HTML length:', fullHtml.length);
  console.log('Preview first 500 chars:', fullHtml.substring(0, 500));
  
  return fullHtml;
}

// ============================================================
// EXAMPLE 7: Integration with Your App
// ============================================================

/**
 * Example integration into your own application
 * This shows how you might wrap the helper in your own service
 */
class MyAppPdfService {
  private apiKey: string;
  private letterheadUrl: string;

  constructor(apiKey: string, letterheadUrl: string) {
    this.apiKey = apiKey;
    this.letterheadUrl = letterheadUrl;
  }

  async generateReport(reportData: {
    title: string;
    content: string;
    reportId: string;
  }): Promise<string> {
    // Build your HTML from data
    const html = `
      <h1>${reportData.title}</h1>
      <div>${reportData.content}</div>
    `;

    // Generate PDF
    const pdfUrl = await generatePdfWithLetterhead({
      html,
      backgroundImageUrl: this.letterheadUrl,
      apiKey: this.apiKey,
      filename: `report-${reportData.reportId}.pdf`,
      topMargin: 130,
      bottomMargin: 130,
      verificationUrl: `https://myapp.com/verify/${reportData.reportId}`,
    });

    return pdfUrl;
  }
}

// Usage:
// const pdfService = new MyAppPdfService('YOUR_API_KEY', 'https://...');
// const url = await pdfService.generateReport({
//   title: 'My Report',
//   content: '<p>Content...</p>',
//   reportId: 'RPT-123'
// });

// ============================================================
// EXPORT EXAMPLES
// ============================================================

export {
  example1_BasicLetterheadPdf,
  example2_CleanPdfNoLetterhead,
  example3_PrintFriendlyPdf,
  example4_PdfWithQRCode,
  example5_CustomStyledPdf,
  example6_PreviewHtmlOnly,
  MyAppPdfService,
};

// ============================================================
// QUICK START TEMPLATE
// ============================================================

/**
 * COPY THIS TEMPLATE TO GET STARTED QUICKLY:
 */

/*
import { generatePdfWithLetterhead } from './pdf-co-helper.ts';

const myHtml = `
  <h1>Your Title Here</h1>
  <p>Your content here...</p>
`;

const pdfUrl = await generatePdfWithLetterhead({
  html: myHtml,
  backgroundImageUrl: 'YOUR_BACKGROUND_IMAGE_URL_OR_NULL',
  apiKey: 'YOUR_PDFCO_API_KEY',
  filename: 'output.pdf',
  topMargin: 130,
  bottomMargin: 130,
});

console.log('PDF URL:', pdfUrl);
*/
