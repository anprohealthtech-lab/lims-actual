import { database, supabase } from './supabase';

export type PrintBridgeStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface BarcodeLabelData {
  sampleId: string;
  patientName: string;
  sampleType?: string;
  date?: string;
  labelId?: string;
}

export interface PrintJobInsertResult {
  id: string;
}

let connectionStatus: PrintBridgeStatus = 'connected';
let connectionListeners: Array<(status: PrintBridgeStatus) => void> = [];

function emitStatus(status: PrintBridgeStatus) {
  connectionStatus = status;
  connectionListeners.forEach((fn) => fn(status));
}

export function onConnectionStatusChange(fn: (status: PrintBridgeStatus) => void) {
  connectionListeners.push(fn);
  fn(connectionStatus);

  return () => {
    connectionListeners = connectionListeners.filter((listener) => listener !== fn);
  };
}

export function getConnectionStatus(): PrintBridgeStatus {
  return connectionStatus;
}

export async function connect(): Promise<void> {
  emitStatus('connected');
}

export async function disconnect(): Promise<void> {
  emitStatus('disconnected');
}

export function isConnected(): boolean {
  return connectionStatus === 'connected';
}

function escapeZpl(value: string): string {
  return value.replace(/[\^~]/g, ' ');
}

function fit(value: string | undefined, length: number): string {
  const text = escapeZpl(value || '');
  return text.length > length ? `${text.slice(0, Math.max(0, length - 2))}..` : text;
}

/**
 * Generate ZPL for a 2" x 1" thermal label at 203 dpi.
 * Compatible with Zebra, TSC, and most ZPL-capable label printers.
 */
export function generateBarcodeLabelZPL(data: BarcodeLabelData): string {
  const { sampleId, patientName, sampleType, date, labelId } = data;
  const dateStr = date || new Date().toLocaleDateString('en-GB');
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

async function resolvePrintContext() {
  const [{ data: authData }, labId, locationId] = await Promise.all([
    supabase.auth.getUser(),
    database.getCurrentUserLabId(),
    database.getCurrentUserPrimaryLocation(),
  ]);

  if (!labId) {
    throw new Error('Cannot queue print job: current user lab could not be resolved.');
  }

  return {
    labId,
    locationId: locationId || null,
    userId: authData.user?.id || null,
  };
}

async function insertPrintJob(input: {
  printerRole: 'barcode_label' | 'report' | 'invoice_thermal';
  jobType: 'raw_zpl' | 'pdf_url' | 'pdf_base64' | 'html';
  payload: Record<string, unknown>;
  copies?: number;
  priority?: number;
  orderId?: string | null;
  sampleId?: string | null;
  reportId?: string | null;
  invoiceId?: string | null;
  idempotencyKey?: string | null;
}): Promise<PrintJobInsertResult> {
  const context = await resolvePrintContext();

  const { data, error } = await supabase
    .from('print_jobs')
    .insert({
      lab_id: context.labId,
      location_id: context.locationId,
      printer_role: input.printerRole,
      job_type: input.jobType,
      status: 'pending',
      priority: input.priority ?? 5,
      payload: input.payload,
      copies: input.copies ?? 1,
      requested_by: context.userId,
      order_id: input.orderId ?? null,
      sample_id: input.sampleId ?? null,
      report_id: input.reportId ?? null,
      invoice_id: input.invoiceId ?? null,
      idempotency_key: input.idempotencyKey ?? null,
    })
    .select('id')
    .single();

  if (error) {
    throw new Error(`Failed to queue print job: ${error.message}`);
  }

  return { id: data.id };
}

export async function enqueueBarcodeLabelPrint(
  printerName: string,
  data: BarcodeLabelData
): Promise<PrintJobInsertResult> {
  const zpl = generateBarcodeLabelZPL(data);

  return insertPrintJob({
    printerRole: 'barcode_label',
    jobType: 'raw_zpl',
    payload: {
      printer_name: printerName.trim(),
      language: 'zpl',
      zpl,
      sample_id: data.labelId || data.sampleId,
      sample_barcode: data.sampleId,
      patient_name: data.patientName,
      sample_type: data.sampleType || null,
      label_date: data.date || null,
    },
    sampleId: data.labelId || null,
    priority: 3,
    idempotencyKey: data.labelId
      ? `barcode-label:${data.labelId}:${data.sampleId}`
      : null,
  });
}

export async function enqueueReportPrint(
  printerName: string,
  pdfUrl: string
): Promise<PrintJobInsertResult> {
  return insertPrintJob({
    printerRole: 'report',
    jobType: 'pdf_url',
    payload: {
      printer_name: printerName.trim(),
      pdf_url: pdfUrl,
      paper: 'A4',
      fit_to_page: true,
    },
    priority: 5,
  });
}

export async function enqueueThermalHtmlPrint(input: {
  printerName: string;
  html: string;
  widthMm?: 58 | 80;
  invoiceId?: string | null;
}): Promise<PrintJobInsertResult> {
  return insertPrintJob({
    printerRole: 'invoice_thermal',
    jobType: 'html',
    payload: {
      printer_name: input.printerName.trim(),
      html: input.html,
      width_mm: input.widthMm ?? 80,
    },
    invoiceId: input.invoiceId ?? null,
    priority: 4,
  });
}
