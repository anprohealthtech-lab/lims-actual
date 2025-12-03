import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const pdfCoApiKey = process.env.PDFCO_API_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

export const handler: Handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { order_id, outsourced_report_url } = JSON.parse(event.body || '{}');

    if (!order_id || !outsourced_report_url) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing order_id or outsourced_report_url' }) };
    }

    console.log(`Merging reports for Order ID: ${order_id}`);

    // 1. Get existing report URL
    const { data: report, error: reportError } = await supabase
      .from('reports')
      .select('id, pdf_url, patient_id')
      .eq('order_id', order_id)
      .single();

    if (reportError || !report) {
      console.error('Error fetching report:', reportError);
      return { statusCode: 404, body: JSON.stringify({ error: 'Report not found for this order' }) };
    }

    const existingPdfUrl = report.pdf_url;
    
    // If no existing PDF, just update with the outsourced one (or handle as error depending on logic)
    // Assuming we want to merge, we need an existing PDF. If not, maybe just set the outsourced one?
    // User said "merge and replace", implying existence. 
    // If existingPdfUrl is null, we can't merge. Let's assume we just use the outsourced one in that case.
    
    let finalPdfUrl = outsourced_report_url;

    if (existingPdfUrl) {
      console.log(`Found existing PDF: ${existingPdfUrl}`);
      
      // 2. Call PDF.co Merge API
      const mergeUrl = 'https://api.pdf.co/v1/pdf/merge';
      const payload = {
        url: `${existingPdfUrl},${outsourced_report_url}`,
        name: `merged_report_${order_id}.pdf`,
        async: false
      };

      const pdfCoResponse = await fetch(mergeUrl, {
        method: 'POST',
        headers: {
          'x-api-key': pdfCoApiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!pdfCoResponse.ok) {
        const errorText = await pdfCoResponse.text();
        throw new Error(`PDF.co Merge Failed: ${errorText}`);
      }

      const pdfCoResult = await pdfCoResponse.json();
      
      if (pdfCoResult.error) {
        throw new Error(`PDF.co Error: ${pdfCoResult.message}`);
      }

      const mergedTempUrl = pdfCoResult.url;
      console.log(`Merged PDF generated at: ${mergedTempUrl}`);

      // 3. Download the merged PDF
      const mergedPdfRes = await fetch(mergedTempUrl);
      if (!mergedPdfRes.ok) throw new Error('Failed to download merged PDF');
      const mergedPdfBuffer = await mergedPdfRes.arrayBuffer();

      // 4. Upload to Supabase Storage (replace existing or new file)
      // We'll create a new filename to avoid caching issues and keep history if needed
      const timestamp = Date.now();
      const fileName = `${order_id}_merged_${timestamp}.pdf`;
      const filePath = `${report.patient_id}/${fileName}`; // Assuming structure based on patient_id or just root

      // Note: User sample URL: https://.../storage/v1/object/public/reports/f7190a40..._1764440206517.pdf
      // It seems they store directly in 'reports' bucket, maybe flat or with folders.
      // Let's try to match the pattern or just put in root if unsure, but patient_id folder is safer.
      // Actually, looking at sample: `reports/f7190a40...` seems like `reports` is bucket, and filename is `order_id_timestamp.pdf`.
      
      const storagePath = `${order_id}_${timestamp}.pdf`;

      const { data: uploadData, error: uploadError } = await supabase
        .storage
        .from('reports')
        .upload(storagePath, mergedPdfBuffer, {
          contentType: 'application/pdf',
          upsert: true
        });

      if (uploadError) {
        throw new Error(`Supabase Upload Failed: ${uploadError.message}`);
      }

      // 5. Get Public URL
      const { data: { publicUrl } } = supabase
        .storage
        .from('reports')
        .getPublicUrl(storagePath);

      finalPdfUrl = publicUrl;
      console.log(`New Merged PDF uploaded to: ${finalPdfUrl}`);
    }

    // 6. Update Reports Table
    const { error: updateError } = await supabase
      .from('reports')
      .update({
        pdf_url: finalPdfUrl,
        updated_at: new Date().toISOString()
      })
      .eq('id', report.id);

    if (updateError) {
      throw new Error(`Database Update Failed: ${updateError.message}`);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Report merged and updated successfully',
        url: finalPdfUrl
      })
    };

  } catch (error) {
    console.error('Merge Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' })
    };
  }
};
