/**
 * QR Code Generation for Report Verification
 * Uses Google Charts API to generate QR codes
 */

/**
 * Generate verification code for a report
 */
function generateVerificationCode(order, results) {
  const data = {
    orderNumber: order.order_number,
    patientName: order.patient_name,
    resultCount: results.length,
    timestamp: order.created_at || new Date().toISOString()
  };

  // Simple hash
  const str = JSON.stringify(data);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }

  // Convert to alphanumeric code
  const code = Math.abs(hash).toString(36).toUpperCase();
  return code.padStart(8, '0').substring(0, 8);
}

/**
 * Build verification URL
 */
function getVerificationUrl(orderNumber, verificationCode) {
  const baseUrl = getSetting('verify_base_url');

  if (baseUrl) {
    return `${baseUrl}/verify?order=${encodeURIComponent(orderNumber)}&code=${verificationCode}`;
  }

  // Default: Use Google Sites or Apps Script web app URL
  const webAppUrl = getSetting('web_app_url');
  if (webAppUrl) {
    return `${webAppUrl}?page=verify&order=${encodeURIComponent(orderNumber)}&code=${verificationCode}`;
  }

  // Fallback: Just return the verification details
  return `Order: ${orderNumber} | Code: ${verificationCode}`;
}

/**
 * Generate QR code image URL using Google Charts API
 * Returns a URL that can be fetched to get the QR image
 */
function getQRCodeImageUrl(data, size) {
  size = size || 150;
  const encodedData = encodeURIComponent(data);
  return `https://chart.googleapis.com/chart?cht=qr&chs=${size}x${size}&chl=${encodedData}&choe=UTF-8`;
}

/**
 * Get QR code as blob for embedding in documents
 */
function getQRCodeBlob(verificationUrl, size) {
  const qrUrl = getQRCodeImageUrl(verificationUrl, size || 100);
  try {
    const response = UrlFetchApp.fetch(qrUrl);
    return response.getBlob();
  } catch (e) {
    console.error('Failed to generate QR code:', e);
    return null;
  }
}

/**
 * Add QR code to a Google Doc body
 */
function addQRCodeToDoc(body, order, results, position) {
  const qrEnabled = getSetting('qr_enabled');
  if (qrEnabled === 'false' || qrEnabled === false) return;

  const verificationCode = generateVerificationCode(order, results);
  const verificationUrl = getVerificationUrl(order.order_number, verificationCode);
  const qrBlob = getQRCodeBlob(verificationUrl, 80);

  if (!qrBlob) return;

  position = position || getSetting('qr_position') || 'bottom_right';

  // Add QR code section
  const para = body.appendParagraph('');

  if (position.includes('right')) {
    para.setAlignment(DocumentApp.HorizontalAlignment.RIGHT);
  } else {
    para.setAlignment(DocumentApp.HorizontalAlignment.LEFT);
  }

  const img = para.appendInlineImage(qrBlob);
  img.setWidth(70);
  img.setHeight(70);

  // Add verification code text
  const codePara = body.appendParagraph(`Verify: ${verificationCode}`);
  codePara.setAlignment(para.getAlignment());
  codePara.editAsText().setFontSize(8).setItalic(true);
}

/**
 * Verify a report code
 * Can be called from a web app or menu
 */
function verifyReport(orderNumber, providedCode) {
  const order = findOrderByNumber(orderNumber);
  if (!order) {
    return { valid: false, error: 'Order not found' };
  }

  const results = getResultsForOrder(orderNumber);
  if (results.length === 0) {
    return { valid: false, error: 'No results found' };
  }

  const expectedCode = generateVerificationCode(order, results);
  const isValid = expectedCode === providedCode;

  if (isValid) {
    return {
      valid: true,
      orderNumber: order.order_number,
      patientName: order.patient_name,
      doctorName: order.doctor_name,
      orderDate: order.order_date,
      testCount: results.length,
      verifiedCount: results.filter(r => r.verification_status === 'verified').length
    };
  } else {
    return { valid: false, error: 'Invalid verification code' };
  }
}

/**
 * Show verification dialog
 */
function showVerifyDialog() {
  const html = HtmlService.createHtmlOutputFromFile('VerifyDialog')
    .setWidth(400)
    .setHeight(350)
    .setTitle('Verify Report');
  SpreadsheetApp.getUi().showModalDialog(html, 'Verify Report');
}
