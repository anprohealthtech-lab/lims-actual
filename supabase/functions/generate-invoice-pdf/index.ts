// Supabase Edge Function for Invoice PDF Generation
// This keeps PDF.co API key secure on the server side

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const PDFCO_API_KEY = Deno.env.get('PDFCO_API_KEY');
const PDFCO_HTML_TO_PDF_URL = 'https://api.pdf.co/v1/pdf/convert/from/html';

interface RequestBody {
  html: string;
  filename: string;
  invoiceId?: string;
  labId?: string;
}

serve(async (req) => {
  // CORS headers
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    });
  }

  try {
    // Validate API key
    if (!PDFCO_API_KEY) {
      throw new Error('PDFCO_API_KEY not configured in edge function secrets');
    }

    // Parse request
    const { html, filename, invoiceId, labId }: RequestBody = await req.json();

    if (!html) {
      throw new Error('HTML content is required');
    }

    console.log('Starting PDF generation for invoice:', invoiceId);

    // Step 1: Call PDF.co API to convert HTML to PDF
    const pdfcoResponse = await fetch(PDFCO_HTML_TO_PDF_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': PDFCO_API_KEY,
      },
      body: JSON.stringify({
        html: html,
        name: filename || 'invoice.pdf',
        margins: '10mm 10mm 15mm 15mm', // top right bottom left
        paperSize: 'A4',
        orientation: 'Portrait',
        printBackground: true,
        header: '',
        footer: '',
        async: false, // Synchronous generation
      }),
    });

    if (!pdfcoResponse.ok) {
      const errorText = await pdfcoResponse.text();
      throw new Error(`PDF.co API error: ${pdfcoResponse.status} - ${errorText}`);
    }

    const pdfcoResult = await pdfcoResponse.json();

    if (!pdfcoResult.url) {
      throw new Error(`PDF.co generation failed: ${pdfcoResult.error || 'Unknown error'}`);
    }

    console.log('PDF.co generated PDF:', pdfcoResult.url);

    // Step 2: Download the generated PDF from PDF.co
    const pdfResponse = await fetch(pdfcoResult.url);

    if (!pdfResponse.ok) {
      throw new Error(`Failed to download PDF from PDF.co: ${pdfResponse.status}`);
    }

    const pdfBuffer = await pdfResponse.arrayBuffer();

    // Step 3: Upload to Supabase Storage
    if (invoiceId && labId) {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      
      const supabase = createClient(supabaseUrl, supabaseServiceKey);

      const sanitizedFilename = filename.replace(/[^a-zA-Z0-9-]/g, '_');
      const filePath = `${labId}/invoices/${sanitizedFilename}_${invoiceId}.pdf`;

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('invoices')
        .upload(filePath, pdfBuffer, {
          contentType: 'application/pdf',
          upsert: true,
        });

      if (uploadError) {
        throw new Error(`Failed to upload to storage: ${uploadError.message}`);
      }

      // Get public URL
      const { data: urlData } = supabase.storage
        .from('invoices')
        .getPublicUrl(filePath);

      console.log('PDF uploaded to storage:', urlData.publicUrl);

      // Return storage URL
      return new Response(
        JSON.stringify({
          success: true,
          pdfUrl: urlData.publicUrl,
          filePath: filePath,
          pageCount: pdfcoResult.pageCount || 1,
        }),
        {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }

    // If no storage upload requested, return PDF directly
    return new Response(pdfBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Access-Control-Allow-Origin': '*',
      },
    });

  } catch (error) {
    console.error('Invoice PDF generation error:', error);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'PDF generation failed',
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
});
