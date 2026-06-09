import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { Zip, ZipPassThrough } from 'https://esm.sh/fflate@0.8.2';

declare const EdgeRuntime: {
  waitUntil: (promise: Promise<unknown>) => void;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const getGeneratedPdfUrl = (order: {
  smart_report_url?: string | null;
  reports?: { report_type?: string | null; pdf_url?: string | null; print_pdf_url?: string | null }[] | { report_type?: string | null; pdf_url?: string | null; print_pdf_url?: string | null } | null;
}, pdfVariant: 'print' | 'ecopy' = 'print') => {
  const reports = Array.isArray(order.reports) ? order.reports : order.reports ? [order.reports] : [];
  const finalReports = reports.filter((report) => report?.report_type !== 'draft');
  const draftReports = reports.filter((report) => report?.report_type === 'draft');
  const preferredReports = [...finalReports, ...draftReports];
  const reportUrl = preferredReports.find((report) =>
    pdfVariant === 'ecopy' ? report?.pdf_url : report?.print_pdf_url || report?.pdf_url
  );

  if (pdfVariant === 'ecopy') {
    return reportUrl?.pdf_url || order.smart_report_url || null;
  }

	return reportUrl?.print_pdf_url || reportUrl?.pdf_url || order.smart_report_url || null;
};

type BulkPdfSortMode = 'sample_desc' | 'sample_asc' | 'order_id_asc' | 'order_id_desc' | 'date_desc' | 'patient_az';

const getDailySeq = (order: { order_number?: number | null; sample_id?: string | null }) => {
  if (typeof order.order_number === 'number' && Number.isFinite(order.order_number)) return order.order_number;
  const tail = String(order.sample_id || '').match(/(?:^|[/-])(\d+)\s*$/)?.[1] || '';
  const parsed = parseInt(tail, 10);
  return Number.isFinite(parsed) ? parsed : 0;
};

const compareOrders = (
  a: { id: string; order_display?: string | null; order_number?: number | null; sample_id?: string | null; order_date?: string | null; patient_name?: string | null },
  b: { id: string; order_display?: string | null; order_number?: number | null; sample_id?: string | null; order_date?: string | null; patient_name?: string | null },
  sortMode: BulkPdfSortMode,
  orderIndex: Map<string, number>,
) => {
  if (sortMode === 'patient_az') {
    return (a.patient_name || '').localeCompare(b.patient_name || '');
  }

  if (sortMode === 'date_desc') {
    const dateDiff = new Date(b.order_date || 0).getTime() - new Date(a.order_date || 0).getTime();
    if (dateDiff !== 0) return dateDiff;
  }

  if (sortMode === 'order_id_asc' || sortMode === 'order_id_desc') {
    const aRef = a.order_display || a.id;
    const bRef = b.order_display || b.id;
    return sortMode === 'order_id_asc'
      ? aRef.localeCompare(bRef, undefined, { numeric: true })
      : bRef.localeCompare(aRef, undefined, { numeric: true });
  }

  const nA = getDailySeq(a);
  const nB = getDailySeq(b);
  if (nA !== nB) return sortMode === 'sample_asc' ? nA - nB : nB - nA;
  return (orderIndex.get(a.id) ?? 0) - (orderIndex.get(b.id) ?? 0);
};

const concatChunks = (chunks: Uint8Array[], totalBytes: number) => {
  const output = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
};

const processZipRequest = async (
  supabase: any,
  request_id: string,
  labId: string,
  orderIds: string[],
  pdfVariant: 'print' | 'ecopy',
  sortMode: BulkPdfSortMode,
) => {
  try {
    const { data: orders, error: ordersError } = await supabase
      .from('orders')
      .select(`
	        id,
	        order_display,
	        order_number,
	        sample_id,
	        order_date,
	        patient_name,
	        smart_report_url,
        reports!reports_order_id_fkey(report_type, pdf_url, print_pdf_url)
      `)
      .in('id', orderIds)
      .eq('lab_id', labId);

	    if (ordersError) throw new Error(`Failed to fetch orders: ${ordersError.message}`);
    const orderIndex = new Map(orderIds.map((id, index) => [id, index]));
    const sortedOrders = [...(orders || [])].sort((a, b) => compareOrders(a, b, sortMode, orderIndex));

    const zipChunks: Uint8Array[] = [];
    let zipBytes = 0;
    let resolveZip!: (value: Uint8Array) => void;
    let rejectZip!: (reason?: unknown) => void;
    const zipDone = new Promise<Uint8Array>((resolve, reject) => {
      resolveZip = resolve;
      rejectZip = reject;
    });
    const zip = new Zip((err, chunk, final) => {
      if (err) {
        rejectZip(err);
        return;
      }

      if (chunk) {
        zipChunks.push(chunk);
        zipBytes += chunk.length;
      }

      if (final) resolveZip(concatChunks(zipChunks, zipBytes));
    });
    let processed = 0;
    let failed = 0;

	    for (const [index, order] of sortedOrders.entries()) {
      try {
        // Use only already-generated PDF URLs. This function must not generate reports.
        const pdfUrl = getGeneratedPdfUrl(order, pdfVariant);

        if (!pdfUrl) {
          failed++;
          continue;
        }

        // Fetch the PDF bytes
        const pdfRes = await fetch(pdfUrl);
        if (!pdfRes.ok) {
          failed++;
          continue;
        }

        const pdfBytes = new Uint8Array(await pdfRes.arrayBuffer());
        const safeName = (order.patient_name || 'patient').replace(/[^a-zA-Z0-9_\- ]/g, '_').trim();
        const orderRef = order.order_display || order.id.slice(-6);
	        const filename = `${String(index + 1).padStart(3, '0')}_${orderRef}_${safeName}.pdf`;

        const zipEntry = new ZipPassThrough(filename);
        zip.add(zipEntry);
        zipEntry.push(pdfBytes, true);
        processed++;
      } catch {
        failed++;
      }
    }

    if (processed === 0) {
      await supabase
        .from('bulk_pdf_download_requests')
        .update({
          status: 'failed',
          error_message: `No ${pdfVariant === 'ecopy' ? 'eCopy ' : ''}PDFs could be fetched. Reports may not be generated yet.`,
          processed_orders: 0,
          failed_orders: orderIds.length,
          completed_at: new Date().toISOString(),
        })
        .eq('id', request_id);

      return new Response(
        JSON.stringify({ error: 'No PDFs available for download' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    zip.end();
    const zipBuffer = await zipDone;

    // Upload zip to Supabase Storage
    const zipFileName = `bulk-downloads/${labId}/${request_id}.zip`;
    const { error: uploadError } = await supabase.storage
      .from('reports')
      .upload(zipFileName, zipBuffer, {
        contentType: 'application/zip',
        upsert: true,
      });

    if (uploadError) throw new Error(`Zip upload failed: ${uploadError.message}`);

    // Generate signed URL (expires in 24h)
    const { data: signedUrlData, error: signedError } = await supabase.storage
      .from('reports')
      .createSignedUrl(zipFileName, 86400);

    if (signedError || !signedUrlData) throw new Error('Failed to create signed URL');

    const expiresAt = new Date(Date.now() + 86400 * 1000).toISOString();

    // Update request record with result
    await supabase
      .from('bulk_pdf_download_requests')
      .update({
        status: 'completed',
        zip_url: signedUrlData.signedUrl,
        processed_orders: processed,
        failed_orders: failed,
        completed_at: new Date().toISOString(),
        expires_at: expiresAt,
      })
      .eq('id', request_id);
  } catch (err) {
    console.error('bulk-pdf-zip error:', err);
    await supabase
      .from('bulk_pdf_download_requests')
      .update({
        status: 'failed',
        error_message: (err as Error).message,
        completed_at: new Date().toISOString(),
      })
      .eq('id', request_id);
  }
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { request_id, pdf_variant, sort_mode } = await req.json();
    if (!request_id) throw new Error('request_id is required');
    const pdfVariant: 'print' | 'ecopy' = pdf_variant === 'ecopy' ? 'ecopy' : 'print';
    const sortMode: BulkPdfSortMode = ['sample_desc', 'sample_asc', 'order_id_asc', 'order_id_desc', 'date_desc', 'patient_az'].includes(sort_mode)
      ? sort_mode
      : 'sample_desc';

    const { data: userData } = await supabase
      .from('users')
      .select('lab_id')
      .eq('id', user.id)
      .single();
    if (!userData) throw new Error('Could not fetch user lab');
    const labId = userData.lab_id;

    const { data: downloadReq, error: reqError } = await supabase
      .from('bulk_pdf_download_requests')
      .select('*')
      .eq('id', request_id)
      .eq('lab_id', labId)
      .single();
    if (reqError || !downloadReq) throw new Error('Download request not found');

    const orderIds: string[] = downloadReq.order_ids || [];

    await supabase
      .from('bulk_pdf_download_requests')
      .update({ status: 'processing', processed_orders: 0, failed_orders: 0, error_message: null })
      .eq('id', request_id);

    EdgeRuntime.waitUntil(processZipRequest(supabase, request_id, labId, orderIds, pdfVariant, sortMode));

    return new Response(
      JSON.stringify({ success: true, status: 'processing', request_id }),
      { status: 202, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('bulk-pdf-zip start error:', err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
