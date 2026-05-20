/**
 * QZ Tray Service
 * Connects to the locally-installed QZ Tray desktop agent via WebSocket,
 * allowing the web app to send print jobs directly to specific printers
 * without showing the OS print dialog.
 *
 * Requirements:
 *  - QZ Tray must be installed on the workstation: https://qz.io/download/
 *  - public/qz-certificate.pem must be deployed with the frontend.
 *  - Supabase Edge Function qz-sign must have QZ_PRIVATE_KEY set as a secret.
 */

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore – qz-tray has no bundled TS types
import qz from 'qz-tray';

export type QZConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

let connectionStatus: QZConnectionStatus = 'disconnected';
let connectionListeners: Array<(status: QZConnectionStatus) => void> = [];
const QZ_CERTIFICATE_PATH = '/qz-certificate.pem';
const QZ_SIGN_ENDPOINT = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/qz-sign`;

let certificatePromise: Promise<string> | null = null;
let qzSecurityConfigured = false;
let connectionPromise: Promise<void> | null = null;

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

function debugPrintLog(event: string, details?: Record<string, unknown>) {
  console.info(`[QZ][Print] ${event}`, details || {});
}

function getQzConnection(): Record<string, unknown> {
  const connection = (qz as any).websocket?.connection;

  return {
    readyState: connection?.readyState,
    hasSendData: typeof connection?.sendData === 'function',
    established: connection?.established,
    version: connection?.version,
  };
}

async function sha256Prefix(value: string): Promise<string> {
  if (!globalThis.crypto?.subtle) return 'unavailable';

  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .slice(0, 8)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64.replace(/\s/g, ''));
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes.buffer;
}

function pemToDerBytes(pem: string, label: string): Uint8Array {
  const base64 = pem
    .replace(`-----BEGIN ${label}-----`, '')
    .replace(`-----END ${label}-----`, '')
    .replace(/\s/g, '');

  return new Uint8Array(base64ToArrayBuffer(base64));
}

function readDerNode(bytes: Uint8Array, offset: number) {
  const start = offset;
  const tag = bytes[offset];
  offset += 1;

  let length = bytes[offset];
  offset += 1;

  if (length & 0x80) {
    const lengthBytes = length & 0x7f;
    length = 0;

    for (let i = 0; i < lengthBytes; i += 1) {
      length = (length << 8) | bytes[offset + i];
    }

    offset += lengthBytes;
  }

  const contentStart = offset;
  const end = contentStart + length;

  return { tag, start, contentStart, end };
}

function extractSubjectPublicKeyInfo(certificatePem: string): ArrayBuffer {
  const cert = pemToDerBytes(certificatePem, 'CERTIFICATE');
  const certificate = readDerNode(cert, 0);
  const tbsCertificate = readDerNode(cert, certificate.contentStart);
  let offset = tbsCertificate.contentStart;

  const first = readDerNode(cert, offset);
  if (first.tag === 0xa0) {
    offset = first.end;
  }

  // serialNumber, signature, issuer, validity, subject
  for (let i = 0; i < 5; i += 1) {
    offset = readDerNode(cert, offset).end;
  }

  const subjectPublicKeyInfo = readDerNode(cert, offset);
  return cert.slice(subjectPublicKeyInfo.start, subjectPublicKeyInfo.end).buffer;
}

async function verifySignatureWithCertificate(
  certificatePem: string,
  payload: string,
  signatureBase64: string
): Promise<boolean | 'unavailable'> {
  if (!globalThis.crypto?.subtle) return 'unavailable';

  const publicKey = await crypto.subtle.importKey(
    'spki',
    extractSubjectPublicKeyInfo(certificatePem),
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-512',
    },
    false,
    ['verify']
  );

  return crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    publicKey,
    base64ToArrayBuffer(signatureBase64),
    new TextEncoder().encode(payload)
  );
}

function fetchCertificate(): Promise<string> {
  if (!certificatePromise) {
    debugPrintLog('certificate fetch started', {
      path: QZ_CERTIFICATE_PATH,
      origin: window.location.origin,
    });

    certificatePromise = fetch(QZ_CERTIFICATE_PATH).then(async (response) => {
      debugPrintLog('certificate fetch response', {
        path: QZ_CERTIFICATE_PATH,
        status: response.status,
        ok: response.ok,
        contentType: response.headers.get('content-type'),
      });

      if (!response.ok) {
        throw new Error(`Failed to load QZ certificate: ${response.status} ${response.statusText}`);
      }

      const certificate = await response.text();
      debugPrintLog('certificate loaded', {
        length: certificate.length,
        hasBeginMarker: certificate.includes('-----BEGIN CERTIFICATE-----'),
        sha256Prefix: await sha256Prefix(certificate),
      });

      return certificate;
    });
  } else {
    debugPrintLog('certificate fetch reused cached promise');
  }

  return certificatePromise;
}

/** Configure QZ Tray certificate and server-side signing. */
function configureSigned() {
  if (qzSecurityConfigured) {
    debugPrintLog('signed security already configured');
    return;
  }

  debugPrintLog('configuring signed security', {
    certificatePath: QZ_CERTIFICATE_PATH,
    signEndpoint: QZ_SIGN_ENDPOINT,
    hasSetSignatureAlgorithm: typeof qz.security.setSignatureAlgorithm === 'function',
  });

  if (typeof qz.security.setSignatureAlgorithm === 'function') {
    qz.security.setSignatureAlgorithm('SHA512');
    debugPrintLog('signature algorithm set', { algorithm: 'SHA512' });
  } else {
    console.warn('[QZ][Print] qz.security.setSignatureAlgorithm is unavailable; QZ Tray will use its library default.');
  }

  qz.security.setCertificatePromise((resolve: (cert: string) => void, reject: (err: string) => void) => {
    debugPrintLog('certificate promise invoked by QZ Tray');
    fetchCertificate().then(resolve).catch((error) => {
      console.error('[QZ][Print] certificate load failed', error);
      reject(error instanceof Error ? error.message : String(error));
    });
  });

  qz.security.setSignaturePromise((toSign: string) => {
    return (resolve: (sig: string) => void, reject: (err: string) => void) => {
      debugPrintLog('signature promise invoked by QZ Tray', {
        payloadLength: toSign.length,
        endpoint: QZ_SIGN_ENDPOINT,
      });

      fetch(QZ_SIGN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request: toSign }),
      })
        .then(async (response) => {
          const responseText = await response.text();
          let body: { signature?: string; error?: string } = {};

          try {
            body = responseText ? JSON.parse(responseText) : {};
          } catch {
            throw new Error(`QZ signing returned non-JSON response: ${response.status} ${response.statusText}`);
          }

          debugPrintLog('signature endpoint response', {
            status: response.status,
            ok: response.ok,
            contentType: response.headers.get('content-type'),
            hasSignature: Boolean(body.signature),
            signatureLength: body.signature?.length || 0,
          });

          if (!response.ok || !body.signature) {
            throw new Error(body.error || `QZ signing failed: ${response.status} ${response.statusText}`);
          }

          const certificate = await fetchCertificate();
          const verifiedAgainstLoadedCertificate = await verifySignatureWithCertificate(
            certificate,
            toSign,
            body.signature
          );
          debugPrintLog('signature verification check', {
            verifiedAgainstLoadedCertificate,
            payloadLength: toSign.length,
            certificateSha256Prefix: await sha256Prefix(certificate),
          });

          if (verifiedAgainstLoadedCertificate === false) {
            throw new Error('QZ signature does not verify against the loaded qz-certificate.pem');
          }

          resolve(body.signature);
        })
        .catch((error) => {
          console.error('[QZ][Print] signing failed', error);
          reject(error instanceof Error ? error.message : String(error));
        });
    };
  });

  qzSecurityConfigured = true;
  debugPrintLog('signed security configured');
}

/** Connect to QZ Tray. Resolves when connected, rejects if unavailable. */
export async function connect(): Promise<void> {
  if (qz.websocket.isActive()) {
    debugPrintLog('connect skipped: websocket already active', {
      qzActiveBeforeConnect: true,
      pageOrigin: window.location.origin,
      connection: getQzConnection(),
    });
    return;
  }

  if (connectionPromise) {
    debugPrintLog('connect skipped: existing connection attempt in progress', {
      connection: getQzConnection(),
    });
    return connectionPromise;
  }

  debugPrintLog('connecting to QZ Tray', {
    qzActiveBeforeConnect: qz.websocket.isActive(),
    pageOrigin: window.location.origin,
    userAgent: navigator.userAgent,
    connection: getQzConnection(),
  });
  emitStatus('connecting');

  configureSigned();

  qz.websocket.setClosedCallbacks(() => {
    emitStatus('disconnected');
  });

  connectionPromise = (async () => {
    await qz.websocket.connect({ retries: 2, delay: 1 });
    emitStatus('connected');
    debugPrintLog('connected to QZ Tray', {
      connection: getQzConnection(),
    });
  })();

  try {
    await connectionPromise;
  } catch (err) {
    emitStatus('error');
    console.error('[QZ][Print] connection failed', err);
    throw err;
  } finally {
    connectionPromise = null;
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

async function ensureConnected(): Promise<void> {
  if (!qz.websocket.isActive()) {
    debugPrintLog('QZ connection not ready; connecting before print', {
      qzActive: qz.websocket.isActive(),
      connection: getQzConnection(),
    });
    await connect();
  }
}

function isQzSendDataError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('sendData is not a function');
}

async function reconnectAfterStaleConnection(): Promise<void> {
  debugPrintLog('reconnecting after stale QZ connection', {
    connection: getQzConnection(),
  });

  try {
    if (qz.websocket.isActive()) {
      await qz.websocket.disconnect();
    }
  } catch (disconnectError) {
    console.warn('[QZ][Print] disconnect before retry failed', disconnectError);
  }

  await connect();
}

// ─── Barcode Label Printing ───────────────────────────────────────────────────

export interface BarcodeLabelData {
  sampleId: string;
  patientName: string;
  sampleType?: string;
  date?: string;
  labelId?: string;
}

/**
 * Generate ZPL for a 2" x 1" thermal label at 203 dpi.
 * Compatible with Zebra, TSC, and most ZPL-capable thermal printers.
 */
function generateZPL(data: BarcodeLabelData): string {
  const { sampleId, patientName, sampleType, date, labelId } = data;
  const dateStr = date || new Date().toLocaleDateString('en-GB');
  const escapeZpl = (value: string) => value.replace(/[\^~]/g, ' ');
  const fit = (value: string | undefined, length: number) => {
    const text = escapeZpl(value || '');
    return text.length > length ? `${text.slice(0, Math.max(0, length - 2))}..` : text;
  };
  const barcodeValue = fit(sampleId, 32);
  const displayId = fit(labelId || sampleId, 34);
  const displayName = fit(patientName || 'Sample', 22);
  const displayType = fit(sampleType, 20);

  return [
    '^XA',
    '^CI28',
    '^PW406',
    '^LL203',
    '^LH0,0',
    '^FO12,10^A0N,18,18^FB382,1,0,C,0',
    `^FD${displayId}^FS`,
    '^FO28,38^BY2,2,42',
    '^BCN,42,Y,N,N',
    `^FD${barcodeValue}^FS`,
    '^FO12,104^A0N,17,17^FB185,1,0,L,0',
    `^FD${displayName}^FS`,
    '^FO208,104^A0N,16,16^FB186,1,0,R,0',
    `^FD${displayType}^FS`,
    '^FO12,130^A0N,15,15^FB382,1,0,C,0',
    `^FD${fit(dateStr, 34)}^FS`,
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
  debugPrintLog('barcode print requested', {
    printerName,
    sampleId: data.sampleId,
    labelId: data.labelId,
    sampleType: data.sampleType,
    connected: qz.websocket.isActive(),
  });

  await ensureConnected();

  const config = qz.configs.create(printerName.trim());
  const zpl = generateZPL(data);
  debugPrintLog('barcode ZPL generated', {
    printerName: printerName.trim(),
    zplLength: zpl.length,
    zplPreview: zpl.slice(0, 160),
  });

  const payload = [
    {
      type: 'raw',
      format: 'plain',
      data: zpl,
    },
  ];

  try {
    await qz.print(config, payload);
  } catch (error) {
    if (!isQzSendDataError(error)) throw error;

    console.warn('[QZ][Print] stale QZ connection during barcode print; reconnecting and retrying once', error);
    await reconnectAfterStaleConnection();
    await qz.print(config, payload);
  }

  debugPrintLog('barcode print dispatched', {
    printerName: printerName.trim(),
    sampleId: data.sampleId,
    labelId: data.labelId,
  });
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
  debugPrintLog('PDF print requested', {
    printerName,
    pdfUrl,
    connected: qz.websocket.isActive(),
  });

  await ensureConnected();

  // Fetch the PDF and convert to base64
  const response = await fetch(pdfUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch PDF: ${response.status} ${response.statusText}`);
  }
  debugPrintLog('PDF fetched for printing', {
    pdfUrl,
    status: response.status,
    contentType: response.headers.get('content-type'),
  });

  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);

  const config = qz.configs.create(printerName.trim());
  debugPrintLog('PDF payload prepared', {
    printerName: printerName.trim(),
    byteLength: buffer.byteLength,
    base64Length: base64.length,
  });

  const payload = [
    {
      type: 'pixel',
      format: 'pdf',
      flavor: 'base64',
      data: base64,
    },
  ];

  try {
    await qz.print(config, payload);
  } catch (error) {
    if (!isQzSendDataError(error)) throw error;

    console.warn('[QZ][Print] stale QZ connection during PDF print; reconnecting and retrying once', error);
    await reconnectAfterStaleConnection();
    await qz.print(config, payload);
  }

  debugPrintLog('PDF print dispatched', {
    printerName: printerName.trim(),
    pdfUrl,
  });
}
