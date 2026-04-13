/**
 * QZ Tray Service
 * Connects to the locally-installed QZ Tray desktop agent via WebSocket,
 * allowing the web app to send print jobs directly to specific printers
 * without showing the OS print dialog.
 *
 * Requirements:
 *  - QZ Tray must be installed on the workstation: https://qz.io/download/
 *  - On first connect, QZ Tray will prompt the user to allow unsigned printing.
 *    The user should check "Remember this decision" and click Allow.
 */

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore – qz-tray has no bundled TS types
import qz from 'qz-tray';

export type QZConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

let connectionStatus: QZConnectionStatus = 'disconnected';
let connectionListeners: Array<(status: QZConnectionStatus) => void> = [];

function emitStatus(s: QZConnectionStatus) {
  connectionStatus = s;
  connectionListeners.forEach(fn => fn(s));
}

/** Register a listener for connection status changes */
export function onConnectionStatusChange(fn: (status: QZConnectionStatus) => void) {
  connectionListeners.push(fn);
  // Immediately call with current status
  fn(connectionStatus);
  return () => {
    connectionListeners = connectionListeners.filter(f => f !== fn);
  };
}

export function getConnectionStatus(): QZConnectionStatus {
  return connectionStatus;
}

/** Configure QZ Tray to allow unsigned connections (no certificate needed) */
function configureUnsigned() {
  qz.security.setCertificatePromise((_resolve: (cert: string) => void, reject: (err: string) => void) => {
    // Unsigned — resolve with empty to trigger QZ's "allow unsigned" prompt
    reject('Unsigned');
  });

  qz.security.setSignaturePromise((_toSign: string) => {
    return (_resolve: (sig: string) => void, _reject: (err: string) => void) => {
      _resolve('');
    };
  });
}

/** Connect to QZ Tray. Resolves when connected, rejects if unavailable. */
export async function connect(): Promise<void> {
  if (qz.websocket.isActive()) return;

  emitStatus('connecting');

  configureUnsigned();

  qz.websocket.setClosedCallbacks(() => {
    emitStatus('disconnected');
  });

  try {
    await qz.websocket.connect({ retries: 2, delay: 1 });
    emitStatus('connected');
  } catch (err) {
    emitStatus('error');
    throw err;
  }
}

/** Disconnect from QZ Tray */
export async function disconnect(): Promise<void> {
  if (!qz.websocket.isActive()) return;
  await qz.websocket.disconnect();
  emitStatus('disconnected');
}

/** Returns true if QZ Tray WebSocket is currently active */
export function isConnected(): boolean {
  return qz.websocket.isActive();
}

// ─── Barcode Label Printing ───────────────────────────────────────────────────

export interface BarcodeLabelData {
  sampleId: string;
  patientName: string;
  sampleType?: string;
  date?: string;
}

/**
 * Generate ZPL for a 3" × 1" thermal label (CODE128 barcode).
 * Compatible with Zebra, TSC, and most ZPL-capable thermal printers.
 */
function generateZPL(data: BarcodeLabelData): string {
  const { sampleId, patientName, sampleType, date } = data;
  const dateStr = date || new Date().toLocaleDateString('en-GB');
  // Truncate patient name to 28 chars to fit label
  const truncatedName = patientName.length > 28 ? patientName.slice(0, 26) + '..' : patientName;
  const meta = [sampleType, dateStr].filter(Boolean).join(' | ');

  return [
    '^XA',
    '^CF0,28',                              // Default font size 28
    '^FO20,15^BY2',                         // Barcode origin, bar width 2
    '^BCN,55,Y,N,N',                        // Code 128, height 55, print text below
    `^FD${sampleId}^FS`,                    // Barcode data
    '^FO20,85^A0N,22,22',                   // Patient name font
    `^FD${truncatedName}^FS`,
    '^FO20,112^A0N,18,18',                  // Meta (type | date) font
    `^FD${meta}^FS`,
    '^XZ',
  ].join('\n');
}

/**
 * Print a barcode label to the specified printer via QZ Tray.
 * Uses raw ZPL commands — no OS dialog shown.
 */
export async function printBarcodeLabel(
  printerName: string,
  data: BarcodeLabelData
): Promise<void> {
  if (!qz.websocket.isActive()) {
    throw new Error('QZ Tray is not connected. Please connect first.');
  }

  const config = qz.configs.create(printerName);
  const zpl = generateZPL(data);

  await qz.print(config, [
    {
      type: 'raw',
      format: 'plain',
      data: zpl,
    },
  ]);
}

// ─── PDF Report Printing ──────────────────────────────────────────────────────

/**
 * Fetch a PDF from a URL and print it to the specified printer via QZ Tray.
 * Sends raw PDF bytes — no OS dialog shown.
 */
export async function printPDFFromUrl(
  printerName: string,
  pdfUrl: string
): Promise<void> {
  if (!qz.websocket.isActive()) {
    throw new Error('QZ Tray is not connected. Please connect first.');
  }

  // Fetch the PDF and convert to base64
  const response = await fetch(pdfUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch PDF: ${response.status} ${response.statusText}`);
  }

  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);

  const config = qz.configs.create(printerName);

  await qz.print(config, [
    {
      type: 'pixel',
      format: 'pdf',
      flavor: 'base64',
      data: base64,
    },
  ]);
}
