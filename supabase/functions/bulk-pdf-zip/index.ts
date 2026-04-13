import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { zipSync, strToU8 } from 'https://esm.sh/fflate@0.8.2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

    // Get user's lab_id
    const { data: userData } = await supabase
      .from('users')
      .select('lab_id')
      .eq('id', user.id)
      .single();
    if (!userData) throw new Error('Could not fetch user lab');
    const labId = userData.lab_id;

    // Fetch the download request
    const { data: downloadReq, error: reqError } = await supabase
      .from('bulk_pdf_download_requests')
      .select('*')
      .eq('id', request_id)
      .eq('lab_id', labId)
      .single();
    if (reqError || !downloadReq) throw new Error('Download request not found');

    // Mark as processing
    await supabase
      .from('bulk_pdf_download_requests')
      .update({ status: 'processing' })
      .eq('id', request_id);

    const orderIds: string[] = downloadReq.order_ids;

    // Fetch orders with patient info and reports
    const { data: orders, error: ordersError } = await supabase
      .from('orders')
      .select(`
        id,
        order_display,
        patient_name,
        smart_report_url,
        reports!reports_order_id_fkey(pdf_url, print_pdf_url)
      `)
      .in('id', orderIds)
      .eq('lab_id', labId);

    if (ordersError) throw new Error(`Failed to fetch orders: ${ordersError.message}`);

    const zipFiles: Record<string, Uint8Array> = {};
    let processed = 0;
    let failed = 0;

    for (const order of orders || []) {
      try {
        // Find best available PDF URL
        const report = Array.isArray(order.reports) ? order.reports[0] : order.reports;
        const pdfUrl = report?.print_pdf_url || report?.pdf_url || order.smart_report_url;

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
        const filename = `${orderRef}_${safeName}.pdf`;

        zipFiles[filename] = pdfBytes;
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
          error_message: 'No PDFs could be fetched. Reports may not be generated yet.',
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

    // Build zip
    const zipBuffer = zipSync(zipFiles, { level: 0 }); // level 0 = store only (PDFs are already compressed)

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

    return new Response(
      JSON.stringify({
        success: true,
        zip_url: signedUrlData.signedUrl,
        processed,
        failed,
        expires_at: expiresAt,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('bulk-pdf-zip error:', err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
