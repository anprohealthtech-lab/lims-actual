import { Handler } from '@netlify/functions';
import { Resend } from 'resend';
import { createClient } from '@supabase/supabase-js';
import { render } from '@react-email/render';
import React from 'react';
import PatientReportEmail from '../../src/emails/PatientReportEmail';
import B2BInvoiceEmail from '../../src/emails/B2BInvoiceEmail';

// Initialize Resend
const resend = new Resend(process.env.RESEND_API_KEY);

// Initialize Supabase (Service Role for logging)
const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const handler: Handler = async (event, context) => {
  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: 'Method Not Allowed' };
  }

  try {
    // 1. Validate Auth (Basic check - ideally verify JWT)
    const authHeader = event.headers.authorization;
    if (!authHeader) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
    }

    // Parse body
    const { to, subject, templateId, data, labId } = JSON.parse(event.body || '{}');

    if (!to || !subject || !templateId || !labId) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields' }) };
    }

    // 2a. Fetch Lab Details for "On Behalf Of" sending
    const { data: lab, error: labError } = await supabase
      .from('labs')
      .select('name, email')
      .eq('id', labId)
      .single();

    if (labError || !lab) {
      console.warn('Lab not found, using default sender');
    }

    const labName = lab?.name || 'LIMS Reports';
    const labEmail = lab?.email; // This will be the Reply-To

    // 2b. Render Template
    let emailHtml = '';
    if (templateId === 'patient_report') {
      emailHtml = render(React.createElement(PatientReportEmail, data));
    } else if (templateId === 'b2b_invoice') {
      emailHtml = render(React.createElement(B2BInvoiceEmail, data));
    } else {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid template ID' }) };
    }

    // 3. Send Email via Resend
    // We send FROM the platform's verified domain, but set the name to the Lab's name.
    // We set Reply-To to the Lab's actual email so patients reply to them.
    const fromAddress = `${labName} <reports@resend.dev>`; // Replace reports@resend.dev with your verified domain
    
    const { data: emailData, error: emailError } = await resend.emails.send({
      from: fromAddress,
      to: [to],
      subject: subject,
      html: emailHtml,
      replyTo: labEmail, // Critical: Replies go to the lab, not the platform
    });

    if (emailError) {
      console.error('Resend Error:', emailError);
      
      // Log failure
      await supabase.from('email_logs').insert({
        lab_id: labId,
        recipient: to,
        subject: subject,
        template_id: templateId,
        status: 'failed',
        error_message: emailError.message,
        metadata: data,
      });

      return { statusCode: 500, headers, body: JSON.stringify({ error: emailError.message }) };
    }

    // 4. Log Success
    await supabase.from('email_logs').insert({
      lab_id: labId,
      recipient: to,
      subject: subject,
      template_id: templateId,
      status: 'sent',
      provider_id: emailData?.id,
      metadata: data,
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, id: emailData?.id }),
    };

  } catch (error) {
    console.error('Function Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal Server Error' }),
    };
  }
};

export { handler };
