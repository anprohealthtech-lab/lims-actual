/**
 * Compatibility facade for the old QZ Tray service.
 *
 * Phase 1 of the print bridge replaces browser -> QZ direct printing with:
 *
 *   browser -> print_jobs queue -> LIMS Bridge Utility -> local printer
 *
 * Existing components still import qzTrayService during this phase. These
 * exports keep that surface stable while queueing jobs for the utility.
 */

import {
  connect,
  disconnect,
  enqueueBarcodeLabelPrint,
  enqueueReportPrint,
  getConnectionStatus,
  isConnected,
  onConnectionStatusChange,
  type BarcodeLabelData,
  type PrintBridgeStatus,
} from './printBridgeService';
import JsBarcode from 'jsbarcode';
import { generateBarcodeLabelsHTML, generateBarcodeSync } from './barcodeGenerator';

export type QZConnectionStatus = PrintBridgeStatus;
export type { BarcodeLabelData };

export {
  connect,
  disconnect,
  getConnectionStatus,
  isConnected,
  onConnectionStatusChange,
};

/**
 * Queue a barcode label for the LIMS Bridge Utility.
 */
export async function printBarcodeLabel(
  printerName: string,
  data: BarcodeLabelData
): Promise<void> {
  await enqueueBarcodeLabelPrint(printerName, data);
}

export function printBarcodeLabelsInBrowser(
  labels: BarcodeLabelData[],
  preferredPrinterName?: string | null
): void {
  if (labels.length === 0) return;

  const printWindow = window.open('', '_blank', 'width=320,height=520');
  if (!printWindow) {
    alert('Browser blocked the print window. Please allow pop-ups for this site and try again.');
    return;
  }

  const printableLabels = labels.map((label) => {
    const collectionDate = label.date || new Date().toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: '2-digit',
    }).replace(/ /g, '-');
    const collectionTime = label.collectionTime || new Date().toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

    return {
      sampleId: label.labelId || label.sampleId,
      barcodeDataUrl: generateBarcodeSync(JsBarcode, label.sampleId, {
        width: 2,
        height: 50,
        displayValue: true,
        fontSize: 12,
        margin: 5,
      }),
      metadata: {
        sampleType: label.sampleType,
        patientName: label.patientName || 'Sample',
        collectionDate,
        collectionTime,
        gender: label.gender,
        age: label.age,
        referredBy: label.referredBy,
      },
    };
  });

  const html = generateBarcodeLabelsHTML(printableLabels, {
    title: preferredPrinterName ? `Print labels - ${preferredPrinterName}` : 'Print labels',
    preferredPrinterName,
  });

  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => {
    printWindow.print();
    printWindow.close();
  }, 500);
}

/**
 * Queue a report PDF for the LIMS Bridge Utility.
 */
export async function printPDFFromUrl(
  printerName: string,
  pdfUrl: string
): Promise<void> {
  await enqueueReportPrint(printerName, pdfUrl);
}
