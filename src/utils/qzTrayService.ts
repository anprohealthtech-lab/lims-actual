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

/**
 * Queue a report PDF for the LIMS Bridge Utility.
 */
export async function printPDFFromUrl(
  printerName: string,
  pdfUrl: string
): Promise<void> {
  await enqueueReportPrint(printerName, pdfUrl);
}
