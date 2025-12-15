import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing required environment variables');
  console.error('VITE_SUPABASE_URL:', supabaseUrl ? '✓ Set' : '✗ Missing');
  console.error('SUPABASE_SERVICE_ROLE_KEY:', supabaseServiceKey ? '✓ Set' : '✗ Missing');
}

const supabase = supabaseUrl && supabaseServiceKey 
  ? createClient(supabaseUrl, supabaseServiceKey)
  : null;

/**
 * On-Demand PDF Generation Function
 * Called when user clicks "Generate Now" button
 * 
 * Flow:
 * 1. Verify job exists in queue
 * 2. Mark as processing
 * 3. Return success (actual generation happens client-side)
 * 
 * Note: Heavy PDF generation with Puppeteer/PDF.co happens client-side
 * This function just manages the queue state
 */
const handler: Handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    console.error('❌ Invalid method:', event.httpMethod);
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  if (!supabase) {
    console.error('❌ Supabase client not initialized - check environment variables');
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Service configuration error',
        details: 'Database connection not available'
      })
    };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { orderId } = body;

    console.log('═══════════════════════════════════════');
    console.log('📥 PDF Generation Request Received');
    console.log('Order ID:', orderId);
    console.log('Timestamp:', new Date().toISOString());

    if (!orderId) {
      console.error('❌ Missing orderId in request body');
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'orderId is required' })
      };
    }

    // Get job from queue
    const { data: job, error: jobError } = await supabase
      .from('pdf_generation_queue')
      .select('*')
      .eq('order_id', orderId)
      .single();

    if (jobError || !job) {
      console.error('❌ Job not found:', jobError);
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Job not found in queue', details: jobError?.message })
      };
    }

    // Check if already processing or completed
    if (job.status === 'processing') {
      return {
        statusCode: 409,
        headers,
        body: JSON.stringify({ error: 'Job already processing' })
      };
    }

    if (job.status === 'completed') {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ 
          message: 'PDF already generated',
          status: 'completed'
        })
      };
    }

    // Mark as processing using RPC
    console.log('📝 Marking job as processing...');
    const workerId = `on-demand-${Date.now()}`;
    
    const { error: markError } = await supabase.rpc('get_next_pdf_job', { 
      worker_id: workerId 
    });

    if (markError) {
      console.error('❌ Failed to mark as processing:', markError);
      // Continue anyway, might already be marked
    }

    // Update progress: Starting
    await supabase.rpc('update_pdf_job_progress', {
      job_id: job.id,
      stage: 'Fetching order data...',
      percent: 10
    });

    // Fetch order and related data using SQL function
    console.log('📊 Fetching order data...');
    const { data: contextData, error: contextError } = await supabase.rpc(
      'get_report_template_context',
      { order_id_param: orderId }
    );

    if (contextError) {
      console.error('❌ Failed to fetch context:', contextError);
      await supabase.rpc('fail_pdf_job', {
        job_id: job.id,
        error_msg: `Failed to fetch order context: ${contextError.message}`
      });
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ 
          error: 'Context fetch failed',
          details: contextError.message 
        })
      };
    }

    if (!contextData || contextData.length === 0) {
      console.error('❌ No context data returned');
      await supabase.rpc('fail_pdf_job', {
        job_id: job.id,
        error_msg: 'No order data found'
      });
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Order data not found' })
      };
    }

    const templateContext = contextData[0];

    // Update progress: Fetching templates
    await supabase.rpc('update_pdf_job_progress', {
      job_id: job.id,
      stage: 'Fetching lab templates...',
      percent: 20
    });

    // Fetch lab templates
    const { data: templates, error: templateError } = await supabase
      .from('lab_templates')
      .select('*')
      .eq('lab_id', job.lab_id)
      .order('is_default', { ascending: false });

    if (templateError) {
      console.error('❌ Failed to fetch templates:', templateError);
      await supabase.rpc('fail_pdf_job', {
        job_id: job.id,
        error_msg: `Failed to fetch lab templates: ${templateError.message}`
      });
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Template fetch failed' })
      };
    }

    // Update progress: Generating PDF
    await supabase.rpc('update_pdf_job_progress', {
      job_id: job.id,
      stage: 'Generating PDF with PDF.co...',
      percent: 30
    });

    // Call PDF generation function
    const { data: pdfData, error: pdfError } = await supabase.functions.invoke(
      'generate-pdf-report',
      {
        body: {
          orderId,
          reportData: {
            patient: templateContext.patient,
            report: {
              orderId: templateContext.orderId,
              sampleId: templateContext.order?.sampleId,
              sampleCollectedAt: templateContext.order?.sampleCollectedAt,
              locationName: templateContext.order?.locationName,
              referringDoctorName: templateContext.order?.referringDoctorName,
            },
            testResults: templateContext.analytes || [],
            labTemplateRecord: templates?.[0] || null,
            templateContext: templateContext,
          },
          isDraft: false,
          allTemplates: templates || [],
          jobId: job.id,
        }
      }
    );

    if (pdfError || !pdfData?.pdfUrl) {
      console.error('❌ PDF generation failed:', pdfError);
      await supabase.rpc('fail_pdf_job', {
        job_id: job.id,
        error_msg: `PDF generation failed: ${pdfError?.message || 'No URL returned'}`
      });
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'PDF generation failed' })
      };
    }

    // Mark job as completed
    console.log('✅ PDF generated successfully:', pdfData.pdfUrl);
    await supabase.rpc('complete_pdf_job', {
      job_id: job.id,
      pdf_url: pdfData.pdfUrl
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        orderId,
        pdfUrl: pdfData.pdfUrl,
        message: 'PDF generated successfully'
      })
    };

  } catch (error) {
    console.error('❌ PDF generation error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'PDF generation failed',
        details: error instanceof Error ? error.message : String(error)
      })
    };
  }
};

export { handler };
