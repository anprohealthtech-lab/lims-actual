import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { PDFDocument } from 'https://esm.sh/pdf-lib@1.17.1';

const PDFCO_MERGE_URL = 'https://api.pdf.co/v1/pdf/merge';
const PDFCO_JOB_STATUS_URL = 'https://api.pdf.co/v1/job/check';
const PDFCO_JOB_POLL_ATTEMPTS = 90;
const PDFCO_JOB_POLL_DELAY_MS = 2000;
const PDFCO_MERGE_CHUNK_SIZE = 20;
const FALLBACK_MERGE_MAX_INPUT_BYTES = 90 * 1024 * 1024;

declare const EdgeRuntime: {
  waitUntil: (promise: Promise<unknown>) => void;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const getGeneratedPrintPdfUrl = (order: {
  reports?: { report_type?: string | null; pdf_url?: string | null; print_pdf_url?: string | null }[] | { report_type?: string | null; pdf_url?: string | null; print_pdf_url?: string | null } | null;
}) => {
  const reports = Array.isArray(order.reports) ? order.reports : order.reports ? [order.reports] : [];
  const finalReports = reports.filter((report) => report?.report_type !== 'draft');
  const draftReports = reports.filter((report) => report?.report_type === 'draft');
  const reportWithPrintUrl =
    finalReports.find((report) => !!report?.print_pdf_url) ||
    draftReports.find((report) => !!report?.print_pdf_url);
	return reportWithPrintUrl?.print_pdf_url || null;
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isFetchablePdfUrl = async (url: string): Promise<boolean> => {
  try {
    const response = await fetch(url, { headers: { Range: 'bytes=0-0' } });
    await response.body?.cancel();
    return response.ok;
  } catch {
    return false;
  }
};

const pollPdfCoJob = async (jobId: string, apiKey: string, fallbackUrl?: string): Promise<string> => {
  for (let attempt = 0; attempt < PDFCO_JOB_POLL_ATTEMPTS; attempt++) {
    await sleep(PDFCO_JOB_POLL_DELAY_MS);
    const response = await fetch(`${PDFCO_JOB_STATUS_URL}?jobid=${encodeURIComponent(jobId)}`, {
      headers: { 'x-api-key': apiKey },
    });

    if (!response.ok) {
      throw new Error(`PDF.co merge status check failed: ${response.status}`);
    }

    const result = await response.json();
    const status = String(result.status || '').toLowerCase();
    if (status === 'success' && (result.url || fallbackUrl)) {
      return result.url || fallbackUrl!;
    }

    if (status === 'failed' || status === 'aborted' || result.error) {
      throw new Error(`PDF.co merge failed: ${result.message || 'Unknown PDF.co error'}`);
    }
  }

  throw new Error('PDF.co merge timed out');
};

const mergeWithPdfCo = async (pdfUrls: string[], requestId: string): Promise<string> => {
  const apiKey = Deno.env.get('PDFCO_API_KEY');
  if (!apiKey) throw new Error('PDFCO_API_KEY is not configured');

  const response = await fetch(PDFCO_MERGE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({
      url: pdfUrls.join(','),
      name: `${requestId}_merged.pdf`,
      async: true,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`PDF.co merge request failed: ${response.status} ${errorText}`);
  }

  const result = await response.json();
  if (result.error) throw new Error(`PDF.co merge failed: ${result.message || 'Unknown PDF.co error'}`);
  const jobId = result.jobId || result.jobid;
  if (jobId) return pollPdfCoJob(jobId, apiKey, result.url);
  if (result.url) return result.url;

  throw new Error('PDF.co merge did not return a URL or job ID');
};

const mergeWithPdfCoInChunks = async (pdfUrls: string[], requestId: string): Promise<string> => {
  let round = 1;
  let currentUrls = pdfUrls;

  while (currentUrls.length > 1) {
    const mergedRoundUrls: string[] = [];

    for (let index = 0; index < currentUrls.length; index += PDFCO_MERGE_CHUNK_SIZE) {
      const chunk = currentUrls.slice(index, index + PDFCO_MERGE_CHUNK_SIZE);
      const chunkName = `${requestId}_r${round}_${Math.floor(index / PDFCO_MERGE_CHUNK_SIZE) + 1}`;
      console.log(`PDF.co chunk merge ${chunkName}: ${chunk.length} PDFs`);
      mergedRoundUrls.push(await mergeWithPdfCo(chunk, chunkName));
    }

    currentUrls = mergedRoundUrls;
    round++;
  }

  return currentUrls[0];
};

const processMergeRequest = async (
  supabase: any,
  request_id: string,
  labId: string,
  orderIds: string[],
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

    let processed = 0;
    let failed = 0;
    const pdfUrls: string[] = [];

	    for (const order of sortedOrders) {
      try {
        // Merge only print PDFs. Falling back to eCopy/smart_report_url loses
        // the print header/footer spacing these bulk files are meant to keep.
        const pdfUrl = getGeneratedPrintPdfUrl(order);

        if (!pdfUrl) {
          failed++;
          continue;
        }

        const isFetchable = await isFetchablePdfUrl(pdfUrl);
        if (!isFetchable) {
          failed++;
          console.warn(`Skipping inaccessible print PDF for order ${order.id}: ${pdfUrl}`);
          continue;
        }

        pdfUrls.push(pdfUrl);
        processed++;

        await supabase
          .from('bulk_pdf_download_requests')
          .update({ processed_orders: processed })
          .eq('id', request_id);
      } catch (e) {
        console.error(`Failed to process order ${order.id}:`, e);
        failed++;
      }
    }

    if (processed === 0) {
      await supabase
        .from('bulk_pdf_download_requests')
        .update({
          status: 'failed',
          error_message: 'No print PDFs could be merged. Print reports may not be generated yet.',
          processed_orders: 0,
          failed_orders: orderIds.length,
          completed_at: new Date().toISOString(),
        })
        .eq('id', request_id);

      return new Response(
        JSON.stringify({ error: 'No print PDFs available for merging' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let mergedPdfUrl: string;
    const pdfCoApiKey = Deno.env.get('PDFCO_API_KEY');
    let expiresAt = new Date(Date.now() + 86400 * 1000).toISOString();

    if (pdfCoApiKey) {
      mergedPdfUrl = await mergeWithPdfCoInChunks(pdfUrls, request_id);
      // PDF.co output links are temporary. Avoid downloading the final large
      // merged file into Edge Function memory; expose the ready PDF.co URL.
      expiresAt = new Date(Date.now() + 55 * 60 * 1000).toISOString();
    } else {
      const mergedPdf = await PDFDocument.create();
      let inputBytes = 0;

      for (const pdfUrl of pdfUrls) {
        const pdfRes = await fetch(pdfUrl);
        if (!pdfRes.ok) continue;

        const pdfBytes = await pdfRes.arrayBuffer();
        inputBytes += pdfBytes.byteLength;
        if (inputBytes > FALLBACK_MERGE_MAX_INPUT_BYTES) {
          throw new Error('Merged PDF is too large for in-memory Edge Function merging. Configure PDFCO_API_KEY or merge a smaller selection.');
        }

        const sourcePdf = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
        const pages = await mergedPdf.copyPages(sourcePdf, sourcePdf.getPageIndices());
        pages.forEach((page) => mergedPdf.addPage(page));
      }

      const mergedPdfBytes = await mergedPdf.save();
      const fileName = `bulk-downloads/${labId}/${request_id}_merged.pdf`;

      const { error: uploadError } = await supabase.storage
        .from('reports')
        .upload(fileName, mergedPdfBytes, {
          contentType: 'application/pdf',
          upsert: true,
        });

      if (uploadError) throw new Error(`PDF upload failed: ${uploadError.message}`);

      const { data: signedUrlData, error: signedError } = await supabase.storage
        .from('reports')
        .createSignedUrl(fileName, 86400);

      if (signedError || !signedUrlData) throw new Error('Failed to create signed URL');
      mergedPdfUrl = signedUrlData.signedUrl;
    }

    await supabase
      .from('bulk_pdf_download_requests')
      .update({
        status: 'completed',
        zip_url: mergedPdfUrl,
        processed_orders: processed,
        failed_orders: failed,
        completed_at: new Date().toISOString(),
        expires_at: expiresAt,
      })
      .eq('id', request_id);
  } catch (err) {
    console.error('bulk-pdf-merge error:', err);
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

    const { request_id, sort_mode } = await req.json();
    if (!request_id) throw new Error('request_id is required');
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

    EdgeRuntime.waitUntil(processMergeRequest(supabase, request_id, labId, orderIds, sortMode));

    return new Response(
      JSON.stringify({ success: true, status: 'processing', request_id }),
      { status: 202, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('bulk-pdf-merge start error:', err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
