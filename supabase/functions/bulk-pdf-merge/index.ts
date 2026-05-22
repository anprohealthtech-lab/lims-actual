import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { PDFDocument } from 'https://esm.sh/pdf-lib@1.17.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const getGeneratedPdfUrl = (order: {
  smart_report_url?: string | null;
  reports?: { pdf_url?: string | null; print_pdf_url?: string | null }[] | { pdf_url?: string | null; print_pdf_url?: string | null } | null;
}) => {
  const reports = Array.isArray(order.reports) ? order.reports : order.reports ? [order.reports] : [];
  const reportUrl = reports.find((report) => report?.print_pdf_url || report?.pdf_url);
  return reportUrl?.print_pdf_url || reportUrl?.pdf_url || order.smart_report_url || null;
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

    const { request_id } = await req.json();
    if (!request_id) throw new Error('request_id is required');

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

    await supabase
      .from('bulk_pdf_download_requests')
      .update({ status: 'processing' })
      .eq('id', request_id);

    const orderIds: string[] = downloadReq.order_ids;

    const { data: orders, error: ordersError } = await supabase
      .from('orders')
      .select(`
        id,
        order_display,
        order_date,
        patient_name,
        smart_report_url,
        reports!reports_order_id_fkey(pdf_url, print_pdf_url)
      `)
      .in('id', orderIds)
      .eq('lab_id', labId)
      .order('order_date', { ascending: true })
      .order('patient_name', { ascending: true });

    if (ordersError) throw new Error(`Failed to fetch orders: ${ordersError.message}`);

    const mergedPdf = await PDFDocument.create();
    let processed = 0;
    let failed = 0;

    for (const order of orders || []) {
      try {
        // Use only already-generated PDF URLs. This function must not generate reports.
        const pdfUrl = getGeneratedPdfUrl(order);

        if (!pdfUrl) {
          failed++;
          continue;
        }

        const pdfRes = await fetch(pdfUrl);
        if (!pdfRes.ok) {
          failed++;
          continue;
        }

        const pdfBytes = await pdfRes.arrayBuffer();
        const sourcePdf = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
        const pages = await mergedPdf.copyPages(sourcePdf, sourcePdf.getPageIndices());
        pages.forEach((page) => mergedPdf.addPage(page));
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
          error_message: 'No PDFs could be merged. Reports may not be generated yet.',
          processed_orders: 0,
          failed_orders: orderIds.length,
          completed_at: new Date().toISOString(),
        })
        .eq('id', request_id);

      return new Response(
        JSON.stringify({ error: 'No PDFs available for merging' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
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

    const expiresAt = new Date(Date.now() + 86400 * 1000).toISOString();

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

    return new Response(
      JSON.stringify({
        success: true,
        merged_pdf_url: signedUrlData.signedUrl,
        processed,
        failed,
        expires_at: expiresAt,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('bulk-pdf-merge error:', err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
