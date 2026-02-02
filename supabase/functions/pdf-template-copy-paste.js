/**
 * 📋 COPY-PASTE TEMPLATE
 * ======================
 * 
 * Copy this entire file and customize the `YOUR_CONFIG` section below.
 * Then run it to generate your PDF!
 * 
 * No setup required - just replace YOUR_* values and run.
 */

// ============================================================
// ⚙️ YOUR CONFIGURATION - EDIT THIS SECTION
// ============================================================

const YOUR_CONFIG = {
    // Your PDF.co API key (get it from https://pdf.co/)
    apiKey: 'YOUR_PDFCO_API_KEY_HERE',

    // Your letterhead background image URL (or null for no background)
    // Must be A4 size: 210mm × 297mm (2480px × 3508px at 300dpi)
    backgroundImageUrl: 'https://your-cdn.com/letterhead-a4.png',
    // backgroundImageUrl: null, // ← Uncomment for no background

    // Output filename
    filename: 'my-report.pdf',

    // Top margin (pixels to reserve for header graphic)
    topMargin: 130,

    // Bottom margin (pixels to reserve for footer graphic)
    bottomMargin: 130,

    // Your HTML content
    html: `
    <h1>Medical Report</h1>
    
    <div style="margin: 20px 0;">
      <p><strong>Patient Name:</strong> John Doe</p>
      <p><strong>Report Date:</strong> January 28, 2026</p>
      <p><strong>Sample ID:</strong> S12345</p>
    </div>
    
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
          <td>14.5 g/dL</td>
          <td>13.0 - 17.0 g/dL</td>
          <td>Normal</td>
        </tr>
        <tr>
          <td>WBC Count</td>
          <td>8,500 /μL</td>
          <td>4,000 - 11,000 /μL</td>
          <td>Normal</td>
        </tr>
        <tr>
          <td>Platelet Count</td>
          <td>250,000 /μL</td>
          <td>150,000 - 400,000 /μL</td>
          <td>Normal</td>
        </tr>
      </tbody>
    </table>
    
    <div style="margin-top: 40px;">
      <p><strong>Interpretation:</strong></p>
      <p>All test results are within normal limits.</p>
    </div>
    
    <div style="margin-top: 60px; text-align: right;">
      <p><strong>Dr. Jane Smith</strong></p>
      <p>Medical Director</p>
    </div>
  `,

    // Optional: Custom CSS for additional styling
    customCss: `
    /* Add your custom styles here */
    h1 {
      color: #2563eb;
      border-bottom: 2px solid #2563eb;
      padding-bottom: 10px;
    }
    
    h2 {
      color: #374151;
      margin-top: 30px;
      margin-bottom: 15px;
    }
    
    table {
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    }
  `,

    // Optional: Verification URL for QR code (set to null to disable)
    verificationUrl: 'https://myapp.com/verify?id=RPT-12345',
    // verificationUrl: null, // ← Uncomment to disable QR code

    // Optional: Enable grayscale/print mode (true = black & white)
    grayscale: false,
};

// ============================================================
// 🚀 COPY THE HELPER SCRIPT BELOW
// ============================================================
// Option 1: Copy from pdf-co-helper-standalone.js
// Option 2: Use the inline version below

// Inline helper (minimal version)
async function generatePdf(config) {
    const { html, backgroundImageUrl, apiKey, filename, topMargin, bottomMargin, customCss, verificationUrl, grayscale } = config;

    // Build QR code
    const qrTop = backgroundImageUrl ? topMargin + 20 : 50;
    const qrHtml = verificationUrl
        ? `<div style="position: absolute; top: ${qrTop}px; right: 25px; z-index: 9999;">
         <img src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(verificationUrl)}" 
              alt="Verify" style="width: 75px; height: 75px; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.1);" />
       </div>`
        : '';

    // Build letterhead CSS
    const letterheadCss = backgroundImageUrl
        ? `
    html, body { margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    #page-bg {
      position: fixed; top: 0; left: 0; width: 210mm; height: 297mm; z-index: 0; pointer-events: none;
      background-image: url('${backgroundImageUrl}'); background-repeat: no-repeat;
      background-position: top left; background-size: 210mm 297mm;
    }
    .pdf-content { position: relative; z-index: 1; background: transparent !important; }
    table { background: rgba(255, 255, 255, 0.88) !important; }
    `
        : '';

    // Build body
    const bodyContent = backgroundImageUrl
        ? `${qrHtml}<div id="page-bg"></div>
       <table style="width: 100%; border: none; border-collapse: collapse;">
         <thead style="display: table-header-group;"><tr><td style="border: none; padding: 0;"><div style="height: ${topMargin}px;"></div></td></tr></thead>
         <tfoot style="display: table-footer-group;"><tr><td style="border: none; padding: 0;"><div style="height: ${bottomMargin}px;"></div></td></tr></tfoot>
         <tbody><tr><td style="border: none; padding: 0 20px;"><main class="pdf-content">${html}</main></td></tr></tbody>
       </table>`
        : `${qrHtml}<main class="pdf-content" style="padding: 20px;">${html}</main>`;

    // Build full HTML
    const fullHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8">
    <style>
      * { box-sizing: border-box; }
      body { font-family: Arial, sans-serif; color: #1f2937; font-size: 14px; line-height: 1.6; margin: 0; padding: 0; }
      h1, h2, h3 { color: #111827; margin: 0 0 0.5rem; }
      table { width: 100%; border-collapse: collapse; margin: 0.75rem 0; }
      table th, table td { border: 1px solid #d1d5db; padding: 10px 12px; text-align: left; }
      table thead th { background-color: #f1f5f9; }
      tr { page-break-inside: avoid !important; }
      ${letterheadCss}
      ${customCss || ''}
    </style>
  </head><body>${bodyContent}</body></html>`;

    // Send to PDF.co
    console.log('📤 Sending to PDF.co...');
    const response = await fetch('https://api.pdf.co/v1/pdf/convert/from/html', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
        },
        body: JSON.stringify({
            name: filename,
            html: fullHtml,
            async: true,
            margins: backgroundImageUrl ? '0px 20px 0px 20px' : `${topMargin}px 20px ${bottomMargin}px 20px`,
            paperSize: 'A4',
            displayHeaderFooter: false,
            scale: 1.0,
            mediaType: grayscale ? 'print' : 'screen',
            printBackground: !grayscale,
        }),
    });

    if (!response.ok) throw new Error(`PDF.co error: ${response.status}`);

    const result = await response.json();
    if (result.error) throw new Error(`PDF.co error: ${result.message}`);
    if (result.url) return result.url;

    // Poll for async job
    if (result.jobId) {
        console.log('📊 Polling job...');
        for (let i = 0; i < 60; i++) {
            await new Promise(r => setTimeout(r, 5000));
            const statusRes = await fetch(`https://api.pdf.co/v1/job/check?jobid=${result.jobId}`, {
                headers: { 'x-api-key': apiKey }
            });
            const status = await statusRes.json();
            if (status.status === 'success' && status.url) return status.url;
            if (status.status === 'error') throw new Error(`PDF failed: ${status.message}`);
        }
        throw new Error('Timeout');
    }

    throw new Error('No URL returned');
}

// ============================================================
// ▶️ RUN IT!
// ============================================================

// For Node.js / Deno / Edge Functions:
(async () => {
    try {
        console.log('🚀 Starting PDF generation...');
        console.log('📋 Config:', {
            filename: YOUR_CONFIG.filename,
            hasBackground: !!YOUR_CONFIG.backgroundImageUrl,
            hasQR: !!YOUR_CONFIG.verificationUrl,
            grayscale: YOUR_CONFIG.grayscale,
        });

        const pdfUrl = await generatePdf(YOUR_CONFIG);

        console.log('✅ SUCCESS! PDF generated:');
        console.log('🔗 URL:', pdfUrl);
        console.log('\n📥 Download your PDF from the URL above');

    } catch (error) {
        console.error('❌ ERROR:', error.message);
        console.error('\n⚠️ Check:');
        console.error('  1. API key is correct');
        console.error('  2. Background image URL is accessible');
        console.error('  3. You have PDF.co quota remaining');
    }
})();

// For Browser:
// Uncomment the lines below and remove the async IIFE above
/*
generatePdf(YOUR_CONFIG)
  .then(pdfUrl => {
    console.log('✅ PDF generated:', pdfUrl);
    alert('PDF generated! URL: ' + pdfUrl);
  })
  .catch(error => {
    console.error('❌ Error:', error);
    alert('Error: ' + error.message);
  });
*/

// ============================================================
// 💡 USAGE TIPS
// ============================================================

/*

STEP 1: Get PDF.co API Key
---------------------------
1. Go to https://pdf.co/
2. Sign up (free tier: 150 requests/month)
3. Copy your API key
4. Paste it in YOUR_CONFIG.apiKey above

STEP 2: Prepare Letterhead Image (Optional)
--------------------------------------------
1. Create A4-sized image: 210mm × 297mm
   Recommended resolution: 2480px × 3508px at 300dpi
2. Upload to a CDN (ImageKit, S3, etc.)
3. Get public HTTPS URL
4. Paste in YOUR_CONFIG.backgroundImageUrl

STEP 3: Customize HTML
-----------------------
Edit YOUR_CONFIG.html with your content
Use standard HTML tags: <h1>, <p>, <table>, etc.

STEP 4: Run the Script
-----------------------
# For Node.js:
node pdf-template.js

# For Deno:
deno run --allow-net pdf-template.js

# For Browser:
Open in browser and uncomment browser section

STEP 5: Get Your PDF
---------------------
The script will print the PDF URL.
Download it from there!

*/

// ============================================================
// 🔍 TROUBLESHOOTING
// ============================================================

/*

Problem: "API error: 401"
Solution: Check your API key is correct

Problem: "Background image not showing"
Solution: Verify image URL is public and HTTPS

Problem: "Content overlapping header"
Solution: Increase topMargin value (e.g., 150 instead of 130)

Problem: "Timeout"
Solution: Reduce HTML size or simplify content

Problem: "Wrong page size"
Solution: Ensure background image is exactly 210mm × 297mm

*/
