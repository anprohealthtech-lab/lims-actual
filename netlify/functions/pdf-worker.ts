import type { Handler, HandlerEvent, HandlerContext } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY!;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Worker instance identifier
const WORKER_ID = `netlify-worker-${process.env.NETLIFY_DEV ? 'dev' : 'prod'}-${Date.now()}`;

interface PDFJob {
  job_id: string;
  order_id: string;
  lab_id: string;
  retry_count: number;
}

/**
 * Netlify Scheduled Function: PDF Generation Worker
 * Runs every 30 seconds to process pending PDF generation jobs
 * 
 * Cron schedule: every 30 seconds (Netlify minimum is 1 minute)
 */
const handler: Handler = async (event: HandlerEvent, context: HandlerContext) => {
  console.log('🚀 PDF Worker started:', WORKER_ID);
  
  try {
    // Get next pending job from queue
    const { data: jobData, error: jobError } = await supabase.rpc('get_next_pdf_job', {
      worker_id: WORKER_ID
    });

    if (jobError) {
      console.error('❌ Error fetching job:', jobError);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to fetch job', details: jobError.message })
      };
    }

    // No jobs available
    if (!jobData || jobData.length === 0) {
      console.log('✅ No pending jobs in queue');
      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'No pending jobs' })
      };
    }

    const job: PDFJob = jobData[0];
    console.log('📄 Processing job:', job.job_id, 'for order:', job.order_id);

    // Update progress: Fetching context
    await updateProgress(job.job_id, 'Fetching order context...', 10);

    // Fetch template context
    const { data: contextData, error: contextError } = await supabase.functions.invoke(
      'get-template-context',
      {
        body: { orderId: job.order_id }
      }
    );

    if (contextError || !contextData?.context) {
      console.error('❌ Failed to fetch context:', contextError);
      await markFailed(job.job_id, `Failed to fetch template context: ${contextError?.message || 'Unknown error'}`);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Context fetch failed' })
      };
    }

    const templateContext = contextData.context;

    // Update progress: Fetching templates
    await updateProgress(job.job_id, 'Fetching lab templates...', 20);

    // Fetch lab templates
    const { data: templates, error: templateError } = await supabase
      .from('lab_templates')
      .select('*')
      .eq('lab_id', job.lab_id)
      .order('is_default', { ascending: false });

    if (templateError) {
      console.error('❌ Failed to fetch templates:', templateError);
      await markFailed(job.job_id, `Failed to fetch lab templates: ${templateError.message}`);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Template fetch failed' })
      };
    }

    // Update progress: Generating PDF
    await updateProgress(job.job_id, 'Generating PDF with PDF.co...', 30);

    // Call PDF generation function
    const { data: pdfData, error: pdfError } = await supabase.functions.invoke(
      'generate-pdf-report',
      {
        body: {
          orderId: job.order_id,
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
          jobId: job.job_id, // Pass job ID for progress updates
        }
      }
    );

    if (pdfError || !pdfData?.pdfUrl) {
      console.error('❌ PDF generation failed:', pdfError);
      await markFailed(job.job_id, `PDF generation failed: ${pdfError?.message || 'No URL returned'}`);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'PDF generation failed' })
      };
    }

    // Mark job as completed
    console.log('✅ PDF generated successfully:', pdfData.pdfUrl);
    await markComplete(job.job_id, pdfData.pdfUrl);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        orderId: job.order_id,
        pdfUrl: pdfData.pdfUrl,
        message: 'PDF generated successfully'
      })
    };

  } catch (error) {
    console.error('❌ Worker error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Worker error',
        details: error instanceof Error ? error.message : String(error)
      })
    };
  }
};

// Helper functions
async function updateProgress(jobId: string, stage: string, percent: number) {
  const { error } = await supabase.rpc('update_pdf_job_progress', {
    job_id: jobId,
    stage,
    percent
  });

  if (error) {
    console.warn('⚠️ Failed to update progress:', error.message);
  }
}

async function markComplete(jobId: string, pdfUrl: string) {
  const { error } = await supabase.rpc('complete_pdf_job', {
    job_id: jobId,
    pdf_url: pdfUrl
  });

  if (error) {
    console.error('❌ Failed to mark job complete:', error.message);
    throw error;
  }
}

async function markFailed(jobId: string, errorMessage: string) {
  const { error } = await supabase.rpc('fail_pdf_job', {
    job_id: jobId,
    error_msg: errorMessage
  });

  if (error) {
    console.error('❌ Failed to mark job as failed:', error.message);
  }
}

export { handler };
