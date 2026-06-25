/**
 * QR Code Generation for Report Verification
 * Uses qrcode library: npm install qrcode
 */

import QRCode from 'qrcode'

/**
 * Generate a verification hash for a report
 * Simple hash based on order details - can be verified without database lookup
 */
export function generateVerificationCode(order, results) {
  const data = {
    orderNumber: order.order_number,
    patientName: order.patient_name,
    resultCount: results.length,
    timestamp: order.created_at || new Date().toISOString()
  }

  // Simple hash - in production, use a proper HMAC with secret key
  const str = JSON.stringify(data)
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32bit integer
  }

  // Convert to alphanumeric code
  const code = Math.abs(hash).toString(36).toUpperCase().padStart(8, '0')
  return code
}

/**
 * Build verification URL
 */
export function getVerificationUrl(orderNumber, verificationCode, baseUrl) {
  const base = baseUrl || window.location.origin
  return `${base}/verify?order=${encodeURIComponent(orderNumber)}&code=${verificationCode}`
}

/**
 * Generate QR code as data URL (for embedding in PDF)
 */
export async function generateQRCodeDataUrl(verificationUrl, options = {}) {
  const qrOptions = {
    width: options.width || 100,
    margin: options.margin || 1,
    color: {
      dark: options.darkColor || '#000000',
      light: options.lightColor || '#ffffff'
    },
    errorCorrectionLevel: 'M'
  }

  try {
    const dataUrl = await QRCode.toDataURL(verificationUrl, qrOptions)
    return dataUrl
  } catch (err) {
    console.error('QR generation failed:', err)
    return null
  }
}

/**
 * Generate QR code as canvas (for direct rendering)
 */
export async function generateQRCodeCanvas(verificationUrl, canvas, options = {}) {
  const qrOptions = {
    width: options.width || 100,
    margin: options.margin || 1,
    errorCorrectionLevel: 'M'
  }

  try {
    await QRCode.toCanvas(canvas, verificationUrl, qrOptions)
    return true
  } catch (err) {
    console.error('QR generation failed:', err)
    return false
  }
}

/**
 * Verify a report code (client-side verification)
 * Returns true if the code matches the expected hash
 */
export function verifyReportCode(order, results, providedCode) {
  const expectedCode = generateVerificationCode(order, results)
  return expectedCode === providedCode
}
