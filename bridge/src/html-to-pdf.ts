import type { SupabaseClient } from '@supabase/supabase-js';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

type HtmlToPdfVariant = 'ecopy' | 'print';

interface HtmlToPdfDocument {
  variant: HtmlToPdfVariant;
  html: string;
  output_filename: string;
  title?: string | null;
  storage_path?: string | null;
  save_to_folder?: string | null;
  paper?: 'A4' | 'Letter';
  landscape?: boolean;
  print_background?: boolean;
}

export interface HtmlToPdfPayload {
  order_id: string;
  report_id: string | null;
  documents: HtmlToPdfDocument[];
  save_to_folder: string | null;
  archive_local_copy: boolean;
  requested_at?: string;
}

export interface HtmlToPdfDocumentResult {
  variant: HtmlToPdfVariant;
  success: boolean;
  output_filename: string;
  storage_path?: string | null;
  storage_url?: string | null;
  local_path?: string | null;
  bytes?: number;
  error?: string;
}

export interface HtmlToPdfJobResult {
  success: boolean;
  order_id: string;
  report_id: string | null;
  documents: HtmlToPdfDocumentResult[];
  ecopy?: HtmlToPdfDocumentResult;
  print?: HtmlToPdfDocumentResult;
  local_archive_folder?: string | null;
  error?: string;
}

type ElectronModule = {
  app: {
    isReady: () => boolean;
    whenReady: () => Promise<void>;
  };
  BrowserWindow: new (options: Record<string, unknown>) => {
    loadFile: (filePath: string) => Promise<void>;
    webContents: {
      printToPDF: (options: Record<string, unknown>) => Promise<Buffer>;
    };
    destroy: () => void;
  };
};

function getElectron(): ElectronModule {
  try {
    const requireFn = eval('require') as NodeRequire;
    return requireFn('electron') as ElectronModule;
  } catch (error) {
    throw new Error(
      `Electron runtime is required for html_to_pdf jobs: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

function getDefaultArchiveFolder(): string {
  return process.env.REPORT_PDF_ARCHIVE_FOLDER || path.join(os.homedir(), 'Downloads', 'LIMS Reports');
}

function sanitizeFilename(value: string): string {
  const cleaned = value.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim();
  return cleaned || `report_${Date.now()}.pdf`;
}

function getPublicStorageUrl(supabaseUrl: string, bucket: string, objectPath: string): string {
  const baseUrl = supabaseUrl.replace(/\/$/, '');
  return `${baseUrl}/storage/v1/object/public/${bucket}/${objectPath}`;
}

async function renderHtmlToPdf(html: string, document: HtmlToPdfDocument): Promise<Buffer> {
  const electron = getElectron();
  if (!electron.app.isReady()) {
    await electron.app.whenReady();
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lims-html-to-pdf-'));
  const htmlPath = path.join(tempDir, 'document.html');
  let windowRef: InstanceType<ElectronModule['BrowserWindow']> | null = null;

  try {
    await fs.writeFile(htmlPath, html, 'utf8');

    windowRef = new electron.BrowserWindow({
      show: false,
      webPreferences: {
        sandbox: true,
        offscreen: true,
      },
    });

    await windowRef.loadFile(htmlPath);

    return await windowRef.webContents.printToPDF({
      pageSize: document.paper || 'A4',
      landscape: document.landscape ?? false,
      printBackground: document.print_background ?? true,
      preferCSSPageSize: true,
      marginsType: 0,
    });
  } finally {
    if (windowRef) windowRef.destroy();
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function writeLocalArchive(
  pdfBytes: Buffer,
  document: HtmlToPdfDocument,
  payload: HtmlToPdfPayload
): Promise<string | null> {
  if (payload.archive_local_copy === false) return null;

  const archiveFolder = document.save_to_folder || payload.save_to_folder || getDefaultArchiveFolder();
  await fs.mkdir(archiveFolder, { recursive: true });

  const outputPath = path.join(archiveFolder, sanitizeFilename(document.output_filename));
  await fs.writeFile(outputPath, pdfBytes);
  return outputPath;
}

async function uploadPdf(
  supabase: SupabaseClient,
  supabaseUrl: string,
  pdfBytes: Buffer,
  document: HtmlToPdfDocument
): Promise<{ storagePath: string | null; storageUrl: string | null }> {
  if (!document.storage_path) {
    return { storagePath: null, storageUrl: null };
  }

  const storagePath = document.storage_path.replace(/^\/+/, '');
  const { error } = await supabase.storage
    .from('reports')
    .upload(storagePath, pdfBytes, {
      contentType: 'application/pdf',
      upsert: true,
    });

  if (error) throw error;

  return {
    storagePath,
    storageUrl: getPublicStorageUrl(supabaseUrl, 'reports', storagePath),
  };
}

export async function processHtmlToPdfJob(input: {
  payload: HtmlToPdfPayload;
  supabase: SupabaseClient;
  supabaseUrl: string;
}): Promise<HtmlToPdfJobResult> {
  const { payload, supabase, supabaseUrl } = input;
  const documents = Array.isArray(payload.documents) ? payload.documents : [];

  if (!payload.order_id) {
    throw new Error('html_to_pdf payload is missing order_id.');
  }

  if (documents.length === 0) {
    throw new Error('html_to_pdf payload has no documents.');
  }

  const results: HtmlToPdfDocumentResult[] = [];

  for (const document of documents) {
    const outputFilename = sanitizeFilename(document.output_filename);

    try {
      if (!document.html?.trim()) {
        throw new Error('Document HTML is empty.');
      }

      const pdfBytes = await renderHtmlToPdf(document.html, document);
      const [localPath, uploadResult] = await Promise.all([
        writeLocalArchive(pdfBytes, { ...document, output_filename: outputFilename }, payload),
        uploadPdf(supabase, supabaseUrl, pdfBytes, document),
      ]);

      results.push({
        variant: document.variant,
        success: true,
        output_filename: outputFilename,
        storage_path: uploadResult.storagePath,
        storage_url: uploadResult.storageUrl,
        local_path: localPath,
        bytes: pdfBytes.byteLength,
      });
    } catch (error) {
      results.push({
        variant: document.variant,
        success: false,
        output_filename: outputFilename,
        storage_path: document.storage_path ?? null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const failed = results.filter((result) => !result.success);
  const localArchiveFolder = payload.save_to_folder || getDefaultArchiveFolder();

  return {
    success: failed.length === 0,
    order_id: payload.order_id,
    report_id: payload.report_id ?? null,
    documents: results,
    ecopy: results.find((result) => result.variant === 'ecopy'),
    print: results.find((result) => result.variant === 'print'),
    local_archive_folder: payload.archive_local_copy === false ? null : localArchiveFolder,
    error: failed.length > 0 ? failed.map((result) => `${result.variant}: ${result.error}`).join('; ') : undefined,
  };
}
