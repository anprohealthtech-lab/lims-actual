/**
 * PDF Report Generator using jsPDF
 * Install: npm install jspdf jspdf-autotable qrcode
 *
 * Supports:
 * - Header/Footer images or text
 * - Configurable colors for flags
 * - Calculated value markers
 * - Signature blocks
 * - Watermark
 * - QR code for verification
 */

import { jsPDF } from 'jspdf'
import 'jspdf-autotable'
import { generateVerificationCode, getVerificationUrl, generateQRCodeDataUrl } from './qrVerification'

export async function generateReport(order, results, settings = {}, qrDataUrl = null) {
  const doc = new jsPDF()
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  let y = 20

  // Parse settings with defaults
  const config = {
    labName: settings.lab_name || 'Diagnostic Laboratory',
    labAddress: settings.lab_address || '',
    labPhone: settings.lab_phone || '',
    labEmail: settings.lab_email || '',
    labLicense: settings.lab_license || '',
    footerText: settings.footer_text || 'This is a computer-generated report.',
    baseFontSize: parseInt(settings.base_font_size) || 12,
    flagColorsEnabled: settings.flag_colors_enabled !== 'false',
    flagColorHigh: settings.flag_color_high || '#dc2626',
    flagColorLow: settings.flag_color_low || '#ea580c',
    flagColorNormal: settings.flag_color_normal || '#16a34a',
    boldAbnormal: settings.bold_abnormal_values !== 'false',
    showAsterisk: settings.show_flag_asterisk !== 'false',
    showCalcMarker: settings.show_calculated_marker !== 'false',
    signatureEnabled: settings.signature_enabled !== 'false',
    signatureCount: Math.min(3, Math.max(1, parseInt(settings.signature_count) || 2)),
    signatureNames: [
      settings.signature_1_name || 'Lab Technician',
      settings.signature_2_name || 'Pathologist',
      settings.signature_3_name || ''
    ],
    watermarkEnabled: settings.watermark_enabled === 'true',
    watermarkOpacity: parseFloat(settings.watermark_opacity) || 0.15,
    qrEnabled: settings.qr_enabled !== 'false',
    qrPosition: settings.qr_position || 'bottom_right',
    verifyBaseUrl: settings.verify_base_url || '',
  }

  // === WATERMARK (behind content) ===
  if (config.watermarkEnabled && settings.watermark_image_url) {
    // Note: jsPDF doesn't easily support watermarks, would need to add image with low opacity
    // For simplicity, we skip image watermark in this basic version
  }

  // === HEADER ===
  doc.setFontSize(18)
  doc.setFont('helvetica', 'bold')
  doc.text(config.labName, pageWidth / 2, y, { align: 'center' })
  y += 7

  doc.setFontSize(config.baseFontSize - 2)
  doc.setFont('helvetica', 'normal')

  if (config.labAddress) {
    doc.text(config.labAddress, pageWidth / 2, y, { align: 'center' })
    y += 5
  }

  const contactParts = []
  if (config.labPhone) contactParts.push(`Phone: ${config.labPhone}`)
  if (config.labEmail) contactParts.push(`Email: ${config.labEmail}`)
  if (contactParts.length > 0) {
    doc.text(contactParts.join(' | '), pageWidth / 2, y, { align: 'center' })
    y += 5
  }

  if (config.labLicense) {
    doc.setFontSize(config.baseFontSize - 3)
    doc.setFont('helvetica', 'italic')
    doc.text(`Reg No: ${config.labLicense}`, pageWidth / 2, y, { align: 'center' })
    y += 5
  }

  // Horizontal line
  y += 3
  doc.setLineWidth(0.5)
  doc.line(15, y, pageWidth - 15, y)
  y += 8

  // === TITLE ===
  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.text('LABORATORY REPORT', pageWidth / 2, y, { align: 'center' })
  y += 10

  // === PATIENT INFO ===
  doc.setFontSize(config.baseFontSize)
  doc.setFont('helvetica', 'normal')

  const patientInfo = [
    [`Patient Name: ${order.patient_name}`, `Order No: ${order.order_number}`],
    [`Doctor: ${order.doctor_name || 'N/A'}`, `Date: ${formatDate(order.order_date || order.created_at)}`],
    [`Barcode: ${order.barcode || order.order_number.replace(/-/g, '')}`, `Priority: ${order.priority || 'Normal'}`]
  ]

  doc.autoTable({
    startY: y,
    body: patientInfo,
    theme: 'plain',
    styles: { fontSize: config.baseFontSize, cellPadding: 2 },
    columnStyles: {
      0: { cellWidth: 90 },
      1: { cellWidth: 90 }
    }
  })

  y = doc.lastAutoTable.finalY + 8

  // === GROUP RESULTS BY TEST ===
  const testGroups = {}
  results.forEach(r => {
    if (!testGroups[r.test_name]) {
      testGroups[r.test_name] = []
    }
    testGroups[r.test_name].push(r)
  })

  // === RESULTS TABLES ===
  Object.entries(testGroups).forEach(([testName, testResults]) => {
    // Test name header
    doc.setFontSize(config.baseFontSize + 1)
    doc.setFont('helvetica', 'bold')
    doc.text(testName, 15, y)
    y += 2

    // Build table data
    const tableData = testResults.map(r => {
      let displayValue = r.value || ''

      // Add asterisk for abnormal
      if (config.showAsterisk && ['high', 'low', 'critical', 'critical_high', 'critical_low'].includes(r.flag)) {
        displayValue = displayValue + ' *'
      }

      // Add [Cal] marker for calculated values
      if (config.showCalcMarker && r.is_calculated) {
        displayValue = displayValue + ' [Cal]'
      }

      return [
        r.analyte,
        displayValue,
        r.unit || '',
        r.reference_range || '',
        (r.flag || 'normal').toUpperCase()
      ]
    })

    doc.autoTable({
      startY: y,
      head: [['Analyte', 'Result', 'Unit', 'Reference Range', 'Flag']],
      body: tableData,
      theme: 'striped',
      headStyles: {
        fillColor: [66, 133, 244],
        textColor: 255,
        fontStyle: 'bold',
        fontSize: config.baseFontSize - 1
      },
      bodyStyles: { fontSize: config.baseFontSize - 1 },
      columnStyles: {
        0: { cellWidth: 50 },
        1: { cellWidth: 30, halign: 'center' },
        2: { cellWidth: 25, halign: 'center' },
        3: { cellWidth: 40, halign: 'center' },
        4: { cellWidth: 25, halign: 'center' }
      },
      didParseCell: function(data) {
        if (data.section === 'body') {
          const flag = data.row.raw[4]?.toLowerCase() || ''

          // Color the flag column
          if (data.column.index === 4 && config.flagColorsEnabled) {
            if (flag === 'high' || flag.includes('critical')) {
              data.cell.styles.textColor = hexToRgb(config.flagColorHigh)
              data.cell.styles.fontStyle = config.boldAbnormal ? 'bold' : 'normal'
            } else if (flag === 'low') {
              data.cell.styles.textColor = hexToRgb(config.flagColorLow)
              data.cell.styles.fontStyle = config.boldAbnormal ? 'bold' : 'normal'
            } else if (flag === 'normal') {
              data.cell.styles.textColor = hexToRgb(config.flagColorNormal)
            }
          }

          // Also color the result value column for abnormal
          if (data.column.index === 1 && config.flagColorsEnabled && config.boldAbnormal) {
            if (flag === 'high' || flag.includes('critical')) {
              data.cell.styles.textColor = hexToRgb(config.flagColorHigh)
              data.cell.styles.fontStyle = 'bold'
            } else if (flag === 'low') {
              data.cell.styles.textColor = hexToRgb(config.flagColorLow)
              data.cell.styles.fontStyle = 'bold'
            }
          }
        }
      }
    })

    y = doc.lastAutoTable.finalY + 8

    // Check for page break
    if (y > pageHeight - 80) {
      doc.addPage()
      y = 20
    }
  })

  // === SIGNATURE SECTION ===
  if (config.signatureEnabled) {
    y = Math.max(y, pageHeight - 70)

    doc.setLineWidth(0.3)
    doc.line(15, y, pageWidth - 15, y)
    y += 12

    doc.setFontSize(config.baseFontSize - 1)
    doc.setFont('helvetica', 'normal')

    const sigWidth = (pageWidth - 40) / config.signatureCount
    for (let i = 0; i < config.signatureCount; i++) {
      const sigName = config.signatureNames[i] || `Signature ${i + 1}`
      const xPos = 20 + (sigWidth * i) + (sigWidth / 2)

      doc.text(sigName, xPos, y, { align: 'center' })
      doc.text('Signature: ________________', xPos, y + 12, { align: 'center' })
      doc.text('Date: ________________', xPos, y + 18, { align: 'center' })
    }
  }

  // === QR CODE FOR VERIFICATION ===
  if (config.qrEnabled && qrDataUrl) {
    const qrSize = 25
    const verificationCode = generateVerificationCode(order, results)

    let qrX, qrY
    if (config.qrPosition === 'bottom_left') {
      qrX = 15
      qrY = pageHeight - 40
    } else if (config.qrPosition === 'top_right') {
      qrX = pageWidth - qrSize - 15
      qrY = 20
    } else {
      // default: bottom_right
      qrX = pageWidth - qrSize - 15
      qrY = pageHeight - 40
    }

    try {
      doc.addImage(qrDataUrl, 'PNG', qrX, qrY, qrSize, qrSize)

      // Add verification code text below QR
      doc.setFontSize(7)
      doc.setFont('helvetica', 'normal')
      doc.text(`Verify: ${verificationCode}`, qrX + qrSize / 2, qrY + qrSize + 4, { align: 'center' })
    } catch (e) {
      console.warn('Failed to add QR code:', e)
    }
  }

  // === FOOTER ===
  const footerY = pageHeight - 12
  doc.setFontSize(config.baseFontSize - 4)
  doc.setFont('helvetica', 'italic')
  doc.text(config.footerText, pageWidth / 2, footerY, { align: 'center' })

  return doc
}

export async function downloadReport(order, results, settings) {
  let qrDataUrl = null

  if (settings.qr_enabled !== 'false') {
    const verificationCode = generateVerificationCode(order, results)
    const verifyUrl = getVerificationUrl(order.order_number, verificationCode, settings.verify_base_url)
    qrDataUrl = await generateQRCodeDataUrl(verifyUrl)
  }

  const doc = await generateReport(order, results, settings, qrDataUrl)
  doc.save(`Lab_Report_${order.order_number}.pdf`)
}

export async function openReportInNewTab(order, results, settings) {
  let qrDataUrl = null

  if (settings.qr_enabled !== 'false') {
    const verificationCode = generateVerificationCode(order, results)
    const verifyUrl = getVerificationUrl(order.order_number, verificationCode, settings.verify_base_url)
    qrDataUrl = await generateQRCodeDataUrl(verifyUrl)
  }

  const doc = await generateReport(order, results, settings, qrDataUrl)
  const pdfBlob = doc.output('blob')
  const url = URL.createObjectURL(pdfBlob)
  window.open(url, '_blank')
}

// Helper functions
function formatDate(dateStr) {
  if (!dateStr) return 'N/A'
  const date = new Date(dateStr)
  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  })
}

function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return result ? [
    parseInt(result[1], 16),
    parseInt(result[2], 16),
    parseInt(result[3], 16)
  ] : [0, 0, 0]
}

/**
 * Calculate value for calculated analytes
 * Simple formula evaluator for basic math operations
 */
export function calculateAnalyteValue(formula, existingResults) {
  if (!formula) return null

  try {
    // Build context from existing results
    const context = {}
    existingResults.forEach(r => {
      // Normalize analyte name as variable
      const varName = r.analyte.replace(/[^a-zA-Z0-9]/g, '_')
      const value = parseFloat(r.value) || 0
      context[varName] = value
      context[r.analyte] = value
    })

    // Replace analyte names with values in formula
    let evalFormula = formula

    // Sort by length descending to replace longer names first
    const sortedKeys = Object.keys(context).sort((a, b) => b.length - a.length)

    sortedKeys.forEach(key => {
      const regex = new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')
      evalFormula = evalFormula.replace(regex, context[key])
    })

    // Simple safe eval for basic math (+-*/())
    if (!/^[\d\s+\-*/().]+$/.test(evalFormula)) {
      console.warn('Formula contains invalid characters:', evalFormula)
      return null
    }

    const result = Function('"use strict"; return (' + evalFormula + ')')()

    if (isNaN(result) || !isFinite(result)) return null

    return Math.round(result * 100) / 100
  } catch (e) {
    console.error('Error calculating formula:', formula, e)
    return null
  }
}
