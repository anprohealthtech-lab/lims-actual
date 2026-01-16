// Direct PDF.co API Test Script for NOC (Plain White Background)
// Usage: node test-pdfco-noc.js

const PDFCO_API_KEY = 'landinquiryfirm@gmail.com_AEu7lrDUacQsWOHuJ757dQDYPrJz6XbsYQcX2HrSVXf1LX8cvBn94TPzmfpeVgrT';
const PDFCO_API_URL = 'https://api.pdf.co/v1/pdf/convert/from/html';

// Signatures
const SIG_ANAND = 'https://ik.imagekit.io/18tsendxqy/labs/9253fbeb-0907-4977-bde1-99fbf91c9bdf/lab_user_signatures/Upscale_and_properly_202601021006_pnN-qdjdD.jpeg?tr=e-removedotbg,w-120,fo-auto';
const SIG_MOHIT = 'https://ik.imagekit.io/18tsendxqy/Screenshot%202026-01-13%20142052.png?tr=e-removedotbg,w-120,fo-auto';
const SIG_KOKILABEN = 'https://ik.imagekit.io/18tsendxqy/Screenshot%202026-01-13%20141655.png?tr=e-removedotbg,w-120,fo-auto';

async function buildBodyHtml() {
  return `
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>No Objection Certificate</title>
  <style>
    /* ===== Print/Page setup ===== */
    @page {
      size: A4;
      margin: 0; 
    }

    html, body {
      height: 100%;
      margin: 0;
      padding: 0;
      width: 100%;
    }

    body {
      font-family: "Times New Roman", Times, serif;
      font-size: 12pt;
      line-height: 1.4; /* Reduced from 1.5 */
      color: #000;
      background: #fff;
    }

    /* Content Wrapper acting as the page */
    .content-container {
      /* Reduced top/bottom padding to fit content */
      padding: 20mm 25mm 20mm 25mm; 
      position: relative;
      box-sizing: border-box;
      width: 100%;
      height: 100%;
    }

    /* ===== Typography ===== */
    .center {
      text-align: center;
    }

    .title {
      font-weight: 700;
      letter-spacing: 0.5px;
      margin: 0 0 15px 0; /* Reduced from 20px */
      text-transform: uppercase;
      font-size: 14pt;
      text-decoration: underline;
    }

    .block {
      margin: 0 0 10px 0; /* Reduced from 14px */
      text-align: justify;
    }

    .to-line {
      margin: 0;
      font-weight: bold;
    }

    .subject {
      font-weight: 700;
      margin-top: 8px; /* Reduced */
      margin-bottom: 12px; /* Reduced from 20px */
      text-decoration: underline;
    }

    .owners-list {
      margin: 8px 0 10px 0; /* Reduced */
      padding-left: 0;
      list-style: none; 
      font-weight: bold;
    }

    .owners-list li {
      margin: 3px 0;
    }

    /* ===== Signatures ===== */
    .section-heading {
      margin-top: 20px; /* Reduced from 30px */
      margin-bottom: 10px; /* Reduced from 15px */
      font-weight: 700;
    }

    .signatures {
      margin-top: 5px;
      display: flex;
      flex-direction: column;
      gap: 15px; /* Reduced from 20px */
    }

    .sig-row {
      margin: 0 0 8px 0; 
    }

    .sig-name {
      margin: 0;
      font-weight: bold;
    }

    /* Signature Image Style */
    .sig-image {
      max-height: 45px; /* Slightly reduced */
      display: block;
      margin-bottom: 2px;
    }
    
    /* Footer Date/Place */
    .footer-fields {
      margin-top: 25px; /* Reduced from 40px */
      display: flex;
      flex-direction: column;
      gap: 4px; /* Reduced gap */
      font-weight: bold;
    }

    /* Keep layout stable on print */
    * {
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
  </style>
</head>

<body>
  <!-- Standard White Page Content -->
  <div class="content-container">
    <h2 class="title center">NO OBJECTION CERTIFICATE</h2>

    <div class="block">
      <p class="to-line">To,</p>
      <p class="to-line">Whomsoever It May Concern</p>
    </div>

    <div class="subject">
      Subject: No Objection Certificate for use of premises for Company Registration
    </div>

    <p class="block">
      We, the undersigned owners of the premises situated at <strong>85, Arcus Sky City, Arcus Villa Sky City, Shela, Ahmedabad, Gujarat – 380058</strong>:
    </p>

    <ul class="owners-list">
      <li>1. Ms. Kokilaben Danabhai Parmar</li>
      <li>2. Mr. Priyadarshi Anand</li>
      <li>3. Mr. Priyadarshi Mohit Jayeshkumar</li>
    </ul>

    <p class="block">
      hereby give our <strong>No Objection</strong> and consent to <strong>Anpro Solutions Private Limited</strong> to use the said premises as its
      <strong>Registered Office / Business Address</strong> for the purpose of company incorporation and registration with the
      Ministry of Corporate Affairs (MCA) and for all related statutory, legal, and business purposes.
    </p>

    <p class="block">We further confirm that:</p>

    <p class="block">1. The company is permitted to use the above address for correspondence and official records.</p>
    <p class="block">2. This consent is granted voluntarily and without any coercion.</p>
    <p class="block">
      3. This NOC may be produced before MCA, ROC, or any other statutory authority as and when required.
    </p>

    <p class="block">
      We shall have no objection whatsoever in the use of the said address by <strong>Anpro Solutions Private Limited</strong> for
      the above-mentioned purpose.
    </p>

    <div class="section-heading">Owners’ Signatures:</div>

    <div class="signatures">
      
      <!-- Owner 1 -->
      <div class="sig-row">
        <img src="${SIG_KOKILABEN}" class="sig-image" alt="Signature">
        <p class="sig-name">Ms. Kokilaben Danabhai Parmar</p>
      </div>

      <!-- Owner 2 -->
      <div class="sig-row">
        <img src="${SIG_ANAND}" class="sig-image" alt="Signature">
        <p class="sig-name">Mr. Priyadarshi Anand</p>
      </div>

      <!-- Owner 3 -->
      <div class="sig-row">
        <img src="${SIG_MOHIT}" class="sig-image" alt="Signature">
        <p class="sig-name">Mr. Priyadarshi Mohit Jayeshkumar</p>
      </div>
    
    </div>

    <div class="footer-fields">
      <div>Place: Ahmedabad</div>
      <div>Date: 08/01/ 2026</div>
    </div>
  </div>
</body>
</html>
  `;
}

async function testPDFCoGeneration() {
  console.log('🧪 Testing PDF.co NOC Generation (Plain White)\n');
  console.log('='.repeat(80));

  const TEST_BODY_HTML = await buildBodyHtml();

  const payload = {
    name: 'noc-certificate-white.pdf',
    html: TEST_BODY_HTML,
    paperSize: 'A4',
    orientation: 'Portrait',
    margins: '0px 0px 0px 0px',
    printBackground: true,
    async: false
  };

  console.log('\n📦 Payload Summary:');
  console.log('  - Background:', 'None (White)');
  console.log('  - Layout:', 'Standard A4 Margins');

  console.log('\n📤 Sending request to PDF.co...');

  try {
    const response = await fetch(PDFCO_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': PDFCO_API_KEY
      },
      body: JSON.stringify(payload)
    });

    const responseText = await response.text();

    if (!response.ok) {
      console.error('\n❌ PDF.co API Error:', response.status);
      console.log(responseText);
      return;
    }

    const result = JSON.parse(responseText);

    if (result.error) {
      console.error('\n❌ PDF.co Error:', result.message);
      return;
    }

    console.log('\n✅ PDF Generated Successfully!');
    console.log('  📄 PDF URL:', result.url);
    console.log('\n🔗 Open to verify white NOC:\n  ', result.url);

  } catch (error) {
    console.error('\n❌ Error:', error.message);
  }
}

testPDFCoGeneration();
