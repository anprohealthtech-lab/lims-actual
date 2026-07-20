/**
 * outsourcedReportService.ts
 *
 * Manual upload of received outsourced-lab reports (PDF/image) from result entry,
 * and merging of those files into the generated report PDF at generation time.
 *
 * Storage: 'outsourced_reports' bucket (same bucket the email webhook uses).
 * Data:    'outsourced_reports' table, linked to order_id + result_id.
 * Merge:   pdf-lib (client-side, loaded on demand) — outsourced pages are appended
 *          after the in-house pages, preserving the external lab's own branding.
 */

import { supabase } from './supabase';

const BUCKET = 'outsourced_reports';

export interface OutsourcedReportFile {
  id: string;
  lab_id: string;
  order_id: string | null;
  result_id: string | null;
  patient_id: string | null;
  file_url: string;
  file_name: string | null;
  source: 'email_forward' | 'direct_connect' | 'manual_upload';
  status: string;
  merge_status: 'pending' | 'in_progress' | 'completed' | 'failed';
  received_at: string | null;
  subject: string | null;
}

export interface UploadOutsourcedReportParams {
  file: File;
  orderId: string;
  resultId: string;
  labId: string;
  patientId?: string | null;
  uploadedBy?: string | null;
  /** Free-text note, e.g. the outsourced lab's name */
  note?: string | null;
}

const ACCEPTED_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

const sanitizeFileName = (name: string): string =>
  name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);

/**
 * Upload a received outsourced report from result entry.
 * Saves the file to storage, records it in outsourced_reports (already linked to
 * order + result, so no matching step is needed), and marks the result 'received'.
 */
export const uploadOutsourcedReport = async (
  params: UploadOutsourcedReportParams,
): Promise<{ data: OutsourcedReportFile | null; error: Error | null }> => {
  const { file, orderId, resultId, labId, patientId, uploadedBy, note } = params;

  if (!ACCEPTED_TYPES.includes(file.type)) {
    return { data: null, error: new Error('Only PDF, JPG and PNG files are supported') };
  }

  try {
    const storagePath = `${labId}/${orderId}/${Date.now()}_${sanitizeFileName(file.name)}`;

    let publicUrl: string;
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, file, { contentType: file.type, upsert: false });

    if (uploadError) {
      // Older environments may not have upload policies on the outsourced bucket yet
      const fallbackPath = `outsourced-reports/${storagePath}`;
      const { error: fallbackError } = await supabase.storage
        .from('attachments')
        .upload(fallbackPath, file, { contentType: file.type, upsert: false });
      if (fallbackError) throw uploadError;
      publicUrl = supabase.storage.from('attachments').getPublicUrl(fallbackPath).data.publicUrl;
    } else {
      publicUrl = supabase.storage.from(BUCKET).getPublicUrl(storagePath).data.publicUrl;
    }

    const { data: row, error: insertError } = await supabase
      .from('outsourced_reports')
      .insert({
        lab_id: labId,
        order_id: orderId,
        result_id: resultId,
        patient_id: patientId || null,
        source: 'manual_upload',
        status: 'verified', // human attached it in context — no AI matching needed
        file_url: publicUrl,
        file_name: file.name,
        subject: note || null,
        uploaded_by: uploadedBy || null,
        matched_at: new Date().toISOString(),
        matched_by: uploadedBy || null,
        match_confidence: 1,
        merge_status: 'pending',
      })
      .select()
      .single();

    if (insertError) throw insertError;

    // Move the outsourced workflow forward: report is in hand
    await supabase
      .from('results')
      .update({ outsourced_status: 'received' })
      .eq('id', resultId)
      .neq('outsourced_status', 'merged');

    return { data: row as OutsourcedReportFile, error: null };
  } catch (err) {
    console.error('uploadOutsourcedReport failed:', err);
    return { data: null, error: err instanceof Error ? err : new Error(String(err)) };
  }
};

/** Reports attached to a specific result (manual uploads from result entry). */
export const getOutsourcedReportsForResult = async (resultId: string) => {
  const { data, error } = await supabase
    .from('outsourced_reports')
    .select('id, lab_id, order_id, result_id, patient_id, file_url, file_name, source, status, merge_status, received_at, subject')
    .eq('result_id', resultId)
    .order('received_at', { ascending: true });
  return { data: (data || []) as OutsourcedReportFile[], error };
};

/** All mergeable reports linked to an order (manual uploads + matched email reports). */
export const getOutsourcedReportsForOrder = async (orderId: string) => {
  const { data, error } = await supabase
    .from('outsourced_reports')
    .select('id, lab_id, order_id, result_id, patient_id, file_url, file_name, source, status, merge_status, received_at, subject')
    .eq('order_id', orderId)
    .neq('status', 'failed')
    .not('file_url', 'is', null)
    .order('received_at', { ascending: true });
  return { data: (data || []) as OutsourcedReportFile[], error };
};

/**
 * Remove a manually uploaded report (wrong file, replace, etc.).
 * Resets the linked result back to 'awaiting_report' when no other file remains.
 */
export const removeOutsourcedReport = async (report: OutsourcedReportFile) => {
  try {
    const { error: deleteError } = await supabase
      .from('outsourced_reports')
      .delete()
      .eq('id', report.id);
    if (deleteError) throw deleteError;

    // Best-effort storage cleanup (public URL → bucket path)
    const match = report.file_url.match(/\/object\/public\/([^/]+)\/(.+)$/);
    if (match) {
      await supabase.storage.from(match[1]).remove([decodeURIComponent(match[2])]);
    }

    if (report.result_id) {
      const { data: remaining } = await supabase
        .from('outsourced_reports')
        .select('id')
        .eq('result_id', report.result_id)
        .limit(1);
      if (!remaining || remaining.length === 0) {
        await supabase
          .from('results')
          .update({ outsourced_status: 'awaiting_report' })
          .eq('id', report.result_id)
          .in('outsourced_status', ['received', 'merged']);
      }
    }

    return { error: null };
  } catch (err) {
    console.error('removeOutsourcedReport failed:', err);
    return { error: err instanceof Error ? err : new Error(String(err)) };
  }
};

/** Outsourced tests on the order whose report has not arrived yet (guardrail). */
export const getPendingOutsourcedTests = async (orderId: string) => {
  const { data, error } = await supabase
    .from('results')
    .select('id, test_name, outsourced_status')
    .eq('order_id', orderId)
    .not('outsourced_to_lab_id', 'is', null)
    .in('outsourced_status', ['pending_send', 'sent', 'awaiting_report']);
  return { data: data || [], error };
};

// ============ Merge at PDF generation time ============

export interface OutsourcedMergeOutcome {
  blob: Blob;
  appendedCount: number;
  skipped: Array<{ fileName: string; reason: string }>;
  /** Outsourced tests still awaiting their report (not blocking, surfaced as a warning) */
  pendingOutsourced: Array<{ id: string; test_name: string }>;
}

const A4 = { width: 595.28, height: 841.89 };

/**
 * Append all outsourced report files linked to the order after the in-house pages.
 * - PDFs: pages copied as-is (external lab branding preserved — no letterhead overlay).
 * - Images: placed centered on an A4 page.
 * Honors lab_outsourcing_settings.merge_mode ('print_only' | 'ecopy_only' | 'both').
 *
 * Returns null when there is nothing to merge (or the lab's merge_mode excludes this
 * variant) so callers can upload the original blob untouched. Per-file failures are
 * skipped — report generation must never fail because of a bad outsourced file.
 */
export const appendOutsourcedReportsToPdf = async (
  basePdf: Blob,
  orderId: string,
  variant: 'final' | 'print',
): Promise<OutsourcedMergeOutcome | null> => {
  const { data: reports } = await getOutsourcedReportsForOrder(orderId);
  const { data: pending } = await getPendingOutsourcedTests(orderId);

  // Guardrail: warn (once, on the e-copy pass) when outsourced reports haven't arrived
  if (pending.length > 0 && variant === 'final') {
    console.warn(
      `Order ${orderId}: ${pending.length} outsourced test(s) still awaiting report`,
      pending.map((p: any) => p.test_name),
    );
    try {
      const { toast } = await import('react-hot-toast');
      toast(
        `${pending.length} outsourced test(s) still awaiting report — PDF generated without them`,
        { icon: '⚠️', duration: 6000 },
      );
    } catch {
      // non-browser context — console warning above is enough
    }
  }

  if (!reports || reports.length === 0) {
    return null;
  }

  // Lab merge preferences (default: merge into both variants)
  const { data: settings } = await supabase
    .from('lab_outsourcing_settings')
    .select('merge_mode')
    .eq('lab_id', reports[0].lab_id)
    .maybeSingle();
  const mergeMode = settings?.merge_mode || 'both';
  if (
    (mergeMode === 'print_only' && variant !== 'print') ||
    (mergeMode === 'ecopy_only' && variant !== 'final')
  ) {
    return null;
  }

  const { PDFDocument } = await import('pdf-lib');
  const mergedDoc = await PDFDocument.load(await basePdf.arrayBuffer());

  let appendedCount = 0;
  const skipped: Array<{ fileName: string; reason: string }> = [];
  const mergedIds: string[] = [];
  const mergedResultIds: string[] = [];

  for (const report of reports) {
    const label = report.file_name || report.file_url.split('/').pop() || 'file';
    try {
      const response = await fetch(report.file_url);
      if (!response.ok) throw new Error(`download failed (${response.status})`);
      const bytes = await response.arrayBuffer();
      const contentType = response.headers.get('content-type') || '';
      const isPdf =
        contentType.includes('pdf') || /\.pdf(\?|$)/i.test(report.file_url) ||
        /\.pdf$/i.test(label);

      if (isPdf) {
        const srcDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
        const pages = await mergedDoc.copyPages(srcDoc, srcDoc.getPageIndices());
        pages.forEach((page) => mergedDoc.addPage(page));
      } else {
        const isPng = contentType.includes('png') || /\.png(\?|$)/i.test(report.file_url);
        const image = isPng ? await mergedDoc.embedPng(bytes) : await mergedDoc.embedJpg(bytes);
        const page = mergedDoc.addPage([A4.width, A4.height]);
        const margin = 36;
        const scale = Math.min(
          (A4.width - margin * 2) / image.width,
          (A4.height - margin * 2) / image.height,
          1,
        );
        const w = image.width * scale;
        const h = image.height * scale;
        page.drawImage(image, {
          x: (A4.width - w) / 2,
          y: (A4.height - h) / 2,
          width: w,
          height: h,
        });
      }

      appendedCount++;
      mergedIds.push(report.id);
      if (report.result_id) mergedResultIds.push(report.result_id);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(`Skipping outsourced file "${label}" during merge: ${reason}`);
      skipped.push({ fileName: label, reason });
    }
  }

  if (appendedCount === 0) return null;

  const mergedBytes = await mergedDoc.save();
  const blob = new Blob([mergedBytes], { type: 'application/pdf' });

  // Status bookkeeping — non-blocking, idempotent across final/print variants
  try {
    await supabase
      .from('outsourced_reports')
      .update({ merge_status: 'completed' })
      .in('id', mergedIds);
    if (mergedResultIds.length > 0) {
      await supabase
        .from('results')
        .update({ outsourced_status: 'merged' })
        .in('id', mergedResultIds);
    }
    await supabase
      .from('reports')
      .update({ merged_at: new Date().toISOString() })
      .eq('order_id', orderId);
  } catch (err) {
    console.warn('Outsourced merge status update failed (non-blocking):', err);
  }

  return { blob, appendedCount, skipped, pendingOutsourced: pending as any };
};
