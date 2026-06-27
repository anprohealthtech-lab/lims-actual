// utils/barcodeGenerator.ts
// Barcode generation for sample tubes using Code 128 format

import { jsPDF } from 'jspdf';

/**
 * Generate Code 128 barcode as data URL
 * Uses canvas-based rendering for maximum compatibility
 * 
 * @param data - Data to encode (typically sample ID)
 * @param options - Barcode rendering options
 * @returns Data URL of the barcode image
 */
export function generateBarcode(
  data: string,
  options?: {
    width?: number;
    height?: number;
    displayValue?: boolean;
    fontSize?: number;
    margin?: number;
  }
): string {
  const {
    width = 2,
    height = 50,
    displayValue = true,
    fontSize = 12,
    margin = 10
  } = options || {};

  try {
    // Dynamic import of JsBarcode to avoid SSR issues
    if (typeof window === 'undefined') {
      console.warn('Barcode generation is only available in browser');
      return '';
    }

    const canvas = document.createElement('canvas');
    
    // Dynamically import JsBarcode
    import('jsbarcode').then(({ default: JsBarcode }) => {
      JsBarcode(canvas, data, {
        format: 'CODE128',
        width,
        height,
        displayValue,
        fontSize,
        margin,
        background: '#ffffff',
        lineColor: '#000000'
      });
    });

    return canvas.toDataURL('image/png');
  } catch (error) {
    console.error('Error generating barcode:', error);
    return '';
  }
}

/**
 * Generate barcode synchronously (requires JsBarcode to be pre-loaded)
 * Use this when JsBarcode is already imported in your component
 */
export function generateBarcodeSync(
  JsBarcode: any,
  data: string,
  options?: {
    width?: number;
    height?: number;
    displayValue?: boolean;
    fontSize?: number;
    margin?: number;
  }
): string {
  const {
    width = 2,
    height = 50,
    displayValue = true,
    fontSize = 12,
    margin = 10
  } = options || {};

  const canvas = document.createElement('canvas');
  
  JsBarcode(canvas, data, {
    format: 'CODE128',
    width,
    height,
    displayValue,
    fontSize,
    margin,
    background: '#ffffff',
    lineColor: '#000000'
  });

  return canvas.toDataURL('image/png');
}

/**
 * Validate if a string can be encoded as Code 128
 */
export function isValidBarcodeData(data: string): boolean {
  // Code 128 can encode all ASCII characters (0-127)
  if (!data || data.length === 0) return false;
  
  for (let i = 0; i < data.length; i++) {
    const charCode = data.charCodeAt(i);
    if (charCode > 127) {
      return false;
    }
  }
  
  return true;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface BarcodeLabelMetadata {
  sampleType?: string;
  patientName?: string;
  collectionDate?: string;
  collectionTime?: string;
  gender?: string;
  age?: string | number;
  referredBy?: string;
}

export interface PrintableBarcodeLabel {
  sampleId: string;
  barcodeDataUrl: string;
  metadata?: BarcodeLabelMetadata;
}

const LABEL_WIDTH_MM = 50.8;
const LABEL_HEIGHT_MM = 25.4;

function cleanPdfText(value: unknown): string {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').trim();
}

function fitPdfText(doc: jsPDF, value: unknown, maxWidthMm: number): string {
  const text = cleanPdfText(value);
  if (doc.getTextWidth(text) <= maxWidthMm) return text;

  let fitted = text;
  while (fitted.length > 0 && doc.getTextWidth(`${fitted}..`) > maxWidthMm) {
    fitted = fitted.slice(0, -1);
  }

  return fitted ? `${fitted}..` : '';
}

function drawBarcodeLabelPdfPage(doc: jsPDF, label: PrintableBarcodeLabel): void {
  const metadata = label.metadata || {};
  const genderAgeStr = [metadata.gender, metadata.age ? `${metadata.age} Y` : ''].filter(Boolean).join(' ');
  const dateTimeStr = [metadata.collectionDate, metadata.collectionTime].filter(Boolean).join(' ');

  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, LABEL_WIDTH_MM, LABEL_HEIGHT_MM, 'F');
  doc.setTextColor(0, 0, 0);

  const left = 1.75;
  const right = LABEL_WIDTH_MM - 1.75;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.text(fitPdfText(doc, `${metadata.sampleType || 'Sample'}.`, right - left), left, 3.7);

  doc.setFontSize(7.6);
  const genderAgeWidth = genderAgeStr ? Math.min(doc.getTextWidth(genderAgeStr), 12) : 0;
  const nameMaxWidth = right - left - genderAgeWidth - (genderAgeStr ? 2 : 0);
  doc.text(fitPdfText(doc, metadata.patientName || 'Patient', nameMaxWidth), left, 7.2);

  if (genderAgeStr) {
    doc.text(fitPdfText(doc, genderAgeStr, 12), right, 7.2, { align: 'right' });
  }

  doc.addImage(label.barcodeDataUrl, 'PNG', 3, 8.1, 44.8, 9.7);

  doc.setFontSize(6.8);
  doc.text(fitPdfText(doc, label.sampleId, 21), left, 20);
  doc.text(fitPdfText(doc, dateTimeStr, 24), right, 20, { align: 'right' });

  if (metadata.referredBy) {
    doc.setFontSize(6.6);
    doc.text(fitPdfText(doc, metadata.referredBy, right - left), left, 23);
  }
}

export function generateBarcodeLabelsPDFBlob(
  labels: PrintableBarcodeLabel[],
  options?: { title?: string }
): Blob {
  const doc = new jsPDF({
    unit: 'mm',
    format: [LABEL_WIDTH_MM, LABEL_HEIGHT_MM],
    orientation: 'landscape',
    compress: true,
    putOnlyUsedFonts: true,
  });

  if (options?.title) {
    doc.setProperties({ title: options.title });
  }

  labels.forEach((label, index) => {
    if (index > 0) {
      doc.addPage([LABEL_WIDTH_MM, LABEL_HEIGHT_MM], 'landscape');
    }
    drawBarcodeLabelPdfPage(doc, label);
  });

  return doc.output('blob');
}

function generateBarcodeLabelMarkup(label: PrintableBarcodeLabel): string {
  const metadata = label.metadata || {};
  const genderAgeStr = [metadata.gender, metadata.age ? `${metadata.age} Y` : ''].filter(Boolean).join(' ');
  const dateTimeStr = [metadata.collectionDate, metadata.collectionTime].filter(Boolean).join(' ');

  return `
    <section class="barcode-label">
      ${metadata.sampleType ? `<div class="sample-type">${escapeHtml(metadata.sampleType)}.</div>` : ''}
      <div class="patient-row">
        <span class="patient-name">${escapeHtml(metadata.patientName || 'Patient')}</span>
        ${genderAgeStr ? `<span class="gender-age">${escapeHtml(genderAgeStr)}</span>` : ''}
      </div>
      <div class="barcode">
        <img src="${label.barcodeDataUrl}" alt="Barcode" />
      </div>
      <div class="info-row">
        <span class="sample-id">${escapeHtml(label.sampleId)}</span>
        <span class="datetime">${escapeHtml(dateTimeStr)}</span>
      </div>
      ${metadata.referredBy ? `<div class="referred-by">${escapeHtml(metadata.referredBy)}</div>` : ''}
    </section>
  `;
}

export function generateBarcodeLabelsHTML(
  labels: PrintableBarcodeLabel[],
  options?: {
    title?: string;
    preferredPrinterName?: string | null;
  }
): string {
  const title = options?.title || '';
  const preferredPrinterName = options?.preferredPrinterName?.trim();

  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${escapeHtml(title)}</title>
        <style>
          * {
            box-sizing: border-box;
          }
          @page {
            size: 50.8mm 25.4mm;
            margin: 0;
          }
          html,
          body {
            margin: 0;
            padding: 0;
            color: #000;
            background: #fff;
          }
          body {
            font-family: 'Arial', 'Helvetica', sans-serif;
          }
          .print-note {
            display: none;
          }
          .barcode-label {
            width: 50.8mm;
            height: 25.4mm;
            padding: 1mm 1.75mm;
            margin: 0;
            overflow: hidden;
            color: #000;
            background: #fff;
            page-break-after: always;
            break-after: page;
          }
          .barcode-label:last-child {
            page-break-after: auto;
            break-after: auto;
          }
          .sample-type {
            font-size: 9px;
            font-weight: bold;
            color: #000;
            margin-bottom: 1px;
          }
          .patient-row {
            display: flex;
            justify-content: space-between;
            align-items: baseline;
            margin-bottom: 1px;
          }
          .patient-name {
            font-size: 10px;
            font-weight: bold;
            color: #000;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          .gender-age {
            font-size: 10px;
            font-weight: bold;
            color: #000;
            margin-left: 2mm;
            white-space: nowrap;
          }
          .barcode {
            margin: 1px 0;
            height: 9.5mm;
            overflow: hidden;
            text-align: center;
          }
          .barcode img {
            max-width: 100%;
            height: 9.5mm;
            object-fit: contain;
          }
          .info-row {
            display: flex;
            justify-content: space-between;
            align-items: baseline;
            font-size: 9px;
            font-weight: bold;
            color: #000;
            margin-top: 1px;
          }
          .sample-id {
            font-weight: bold;
          }
          .datetime {
            font-size: 9px;
            font-weight: bold;
          }
          .referred-by {
            font-size: 9px;
            font-weight: bold;
            color: #000;
            margin-top: 1px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }
          @media screen {
            body {
              padding: 12px;
              background: #f3f4f6;
            }
            .print-note {
              display: block;
              max-width: 50.8mm;
              margin: 0 0 8px;
              padding: 8px;
              font-size: 11px;
              color: #111827;
              background: #fff;
              border: 1px solid #d1d5db;
            }
            .barcode-label {
              margin-bottom: 10px;
              box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12);
            }
          }
          @media print {
            * {
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
            html,
            body {
              width: 50.8mm !important;
              min-height: 0 !important;
              height: auto !important;
              margin: 0 !important;
              padding: 0 !important;
              background: #fff !important;
              overflow: hidden !important;
            }
            .print-note {
              display: none !important;
            }
            .barcode-label {
              box-sizing: border-box !important;
              width: 50.8mm !important;
              height: 25.4mm !important;
              margin: 0 !important;
              page-break-after: auto !important;
              break-after: auto !important;
              page-break-inside: avoid !important;
              break-inside: avoid !important;
            }
          }
        </style>
      </head>
      <body>
        ${preferredPrinterName ? `<div class="print-note">Select printer: <strong>${escapeHtml(preferredPrinterName)}</strong></div>` : ''}
        ${labels.map(generateBarcodeLabelMarkup).join('\n')}
      </body>
    </html>
  `;
}

/**
 * Generate printable barcode label HTML
 * Can be used with window.print() or react-to-print
 */
export function generateBarcodeLabelHTML(
  sampleId: string,
  barcodeDataUrl: string,
  metadata?: BarcodeLabelMetadata
): string {
  return generateBarcodeLabelsHTML([{ sampleId, barcodeDataUrl, metadata }]);
}
