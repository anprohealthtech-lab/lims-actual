// Script to trigger PDF generation for a specific order
// Usage: node trigger-pdf-generation.js

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing environment variables');
  console.error('VITE_SUPABASE_URL:', supabaseUrl ? '✓' : '✗');
  console.error('SUPABASE_SERVICE_ROLE_KEY:', supabaseServiceKey ? '✓' : '✗');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const orderId = '6f8b9be5-1a5f-49e4-8e60-5cdf7fcc648b';
const labId = '2f8d0329-d584-4423-91f6-9ab326b700ae';

async function triggerPDFGeneration() {
  console.log('═══════════════════════════════════════');
  console.log('🚀 Triggering PDF Generation');
  console.log('Order ID:', orderId);
  console.log('Lab ID:', labId);
  console.log('═══════════════════════════════════════\n');

  try {
    // Step 1: Delete existing job if any
    console.log('🗑️  Step 1: Cleaning up existing job...');
    const { error: deleteError } = await supabase
      .from('pdf_generation_queue')
      .delete()
      .eq('order_id', orderId);

    if (deleteError) {
      console.error('⚠️  Warning: Could not delete existing job:', deleteError.message);
    } else {
      console.log('✅ Existing job cleaned up\n');
    }

    // Step 2: Verify order exists and all results are verified
    console.log('📋 Step 2: Verifying order and results...');
    const { data: results, error: resultsError } = await supabase
      .from('results')
      .select('id, verification_status')
      .eq('order_id', orderId);

    if (resultsError) {
      console.error('❌ Failed to fetch results:', resultsError.message);
      process.exit(1);
    }

    console.log(`Found ${results.length} results`);
    const verified = results.filter(r => r.verification_status === 'verified').length;
    console.log(`Verified: ${verified}/${results.length}`);

    if (verified !== results.length) {
      console.error('❌ Not all results are verified!');
      console.log('Result statuses:', results.map(r => r.verification_status));
      process.exit(1);
    }
    console.log('✅ All results verified\n');

    // Step 3: Insert job into queue manually
    console.log('📝 Step 3: Creating job in queue...');
    const { data: job, error: insertError } = await supabase
      .from('pdf_generation_queue')
      .insert({
        order_id: orderId,
        lab_id: labId,
        status: 'pending',
        priority: 0,
        progress_stage: 'Ready to generate',
        progress_percent: 0,
        retry_count: 0
      })
      .select()
      .single();

    if (insertError) {
      console.error('❌ Failed to create job:', insertError.message);
      process.exit(1);
    }

    console.log('✅ Job created:', job.id);
    console.log('Status:', job.status, '\n');

    // Step 4: Update order status
    console.log('📊 Step 4: Updating order status...');
    const { error: updateError } = await supabase
      .from('orders')
      .update({ report_generation_status: 'queued' })
      .eq('id', orderId);

    if (updateError) {
      console.error('⚠️  Warning: Could not update order status:', updateError.message);
    } else {
      console.log('✅ Order status updated\n');
    }

    // Step 5: Trigger the edge function
    console.log('🔥 Step 5: Calling Supabase Edge Function...');
    console.log('Function: generate-pdf-auto');
    console.log('Payload:', JSON.stringify({ orderId }, null, 2), '\n');

    const { data, error } = await supabase.functions.invoke('generate-pdf-auto', {
      body: { orderId }
    });

    if (error) {
      console.error('❌ Edge function failed:', error);
      console.error('Error details:', JSON.stringify(error, null, 2));
      
      // Check job status after failure
      const { data: failedJob } = await supabase
        .from('pdf_generation_queue')
        .select('*')
        .eq('order_id', orderId)
        .single();
      
      console.log('\n📋 Job status after failure:');
      console.log(JSON.stringify(failedJob, null, 2));
      
      process.exit(1);
    }

    console.log('✅ Edge function completed successfully!\n');
    console.log('Response:', JSON.stringify(data, null, 2));

    // Step 6: Check final job status
    console.log('\n📋 Step 6: Checking final job status...');
    const { data: finalJob, error: jobError } = await supabase
      .from('pdf_generation_queue')
      .select('*')
      .eq('order_id', orderId)
      .single();

    if (jobError) {
      console.error('❌ Could not fetch final job status:', jobError.message);
    } else {
      console.log('Job Status:', finalJob.status);
      console.log('Progress:', finalJob.progress_percent + '%');
      console.log('Stage:', finalJob.progress_stage);
      if (finalJob.error_message) {
        console.log('Error:', finalJob.error_message);
      }
    }

    // Step 7: Check order report status
    console.log('\n📊 Step 7: Checking order status...');
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('report_generation_status, report_auto_generated_at')
      .eq('id', orderId)
      .single();

    if (orderError) {
      console.error('❌ Could not fetch order:', orderError.message);
    } else {
      console.log('Report Generation Status:', order.report_generation_status);
      console.log('Generated At:', order.report_auto_generated_at || 'N/A');
    }

    console.log('\n═══════════════════════════════════════');
    console.log('✅ Script completed successfully!');
    console.log('═══════════════════════════════════════');

  } catch (error) {
    console.error('\n❌ Unexpected error:', error);
    process.exit(1);
  }
}

// Run the script
triggerPDFGeneration();
