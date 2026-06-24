// hims-report-callback: Send finalized PDF reports back to HIMS
// Triggered when order status changes to 'Approved' or 'Delivered'
// Can be called via webhook or directly with order_id

import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function log(event: string, details: Record<string, unknown> = {}) {
  console.log(`[hims-report-callback] ${event}`, JSON.stringify(details))
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const requestId = crypto.randomUUID()

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Accept both direct calls { order_id } and Supabase webhook format { record: { id } }
    const body = await req.json()
    const record = body.record ?? body
    const orderId: string = record.id ?? body.order_id

    if (!orderId) {
      return json({ error: 'Missing order_id' }, 400)
    }

    log('callback_triggered', { request_id: requestId, order_id: orderId })

    // Fetch order with callback URL
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select(`
        id,
        sample_id,
        patient_name,
        status,
        external_order_id,
        external_system_type,
        pdf_callback_url,
        pdf_callback_status,
        pdf_callback_attempts,
        lab_id
      `)
      .eq('id', orderId)
      .single()

    if (orderError || !order) {
      log('order_not_found', { request_id: requestId, order_id: orderId, error: orderError })
      return json({ error: 'Order not found' }, 404)
    }

    // Check if callback is needed
    if (!order.pdf_callback_url) {
      log('no_callback_url', { request_id: requestId, order_id: orderId })
      return json({ success: true, message: 'No callback URL configured' })
    }

    if (order.pdf_callback_status === 'sent') {
      log('already_sent', { request_id: requestId, order_id: orderId })
      return json({ success: true, message: 'Callback already sent' })
    }

    // Check if order is in a reportable status
    const reportableStatuses = ['Approved', 'Delivered', 'Report Ready', 'Completed']
    if (!reportableStatuses.includes(order.status)) {
      log('not_reportable', { request_id: requestId, order_id: orderId, status: order.status })
      return json({ success: false, message: `Order status "${order.status}" is not reportable` })
    }

    // Generate or fetch PDF
    let pdfUrl: string | null = null
    let pdfBase64: string | null = null

    // Try to get existing PDF from storage
    const pdfPath = `reports/${order.lab_id}/${orderId}.pdf`
    const { data: signedUrlData } = await supabase.storage
      .from('reports')
      .createSignedUrl(pdfPath, 3600) // 1 hour expiry

    if (signedUrlData?.signedUrl) {
      pdfUrl = signedUrlData.signedUrl

      // Optionally fetch and encode as base64
      try {
        const pdfResponse = await fetch(signedUrlData.signedUrl)
        if (pdfResponse.ok) {
          const pdfBuffer = await pdfResponse.arrayBuffer()
          pdfBase64 = btoa(String.fromCharCode(...new Uint8Array(pdfBuffer)))
        }
      } catch (e) {
        log('pdf_fetch_warning', { request_id: requestId, order_id: orderId, error: String(e) })
      }
    } else {
      // Try to generate PDF if not exists
      try {
        const generateResponse = await fetch(
          `${Deno.env.get('SUPABASE_URL')}/functions/v1/generate-pdf-letterhead`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
            },
            body: JSON.stringify({ order_id: orderId }),
          }
        )

        if (generateResponse.ok) {
          const genResult = await generateResponse.json()
          pdfUrl = genResult.url || genResult.pdf_url
        }
      } catch (e) {
        log('pdf_generate_warning', { request_id: requestId, order_id: orderId, error: String(e) })
      }
    }

    // Prepare callback payload
    const callbackPayload = {
      external_order_id: order.external_order_id,
      lims_order_id: order.id,
      sample_id: order.sample_id,
      patient_name: order.patient_name,
      status: 'completed',
      timestamp: new Date().toISOString(),
      pdf_url: pdfUrl,
      ...(pdfBase64 && { pdf_base64: pdfBase64 }),
    }

    // Send callback
    const attempts = (order.pdf_callback_attempts || 0) + 1

    try {
      const callbackResponse = await fetch(order.pdf_callback_url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(callbackPayload),
      })

      if (callbackResponse.ok) {
        // Success - update order
        await supabase
          .from('orders')
          .update({
            pdf_callback_status: 'sent',
            pdf_callback_sent_at: new Date().toISOString(),
            pdf_callback_attempts: attempts,
            pdf_callback_last_error: null,
          })
          .eq('id', orderId)

        log('callback_success', {
          request_id: requestId,
          order_id: orderId,
          external_order_id: order.external_order_id,
          callback_url: order.pdf_callback_url,
        })

        return json({
          success: true,
          message: 'Report callback sent successfully',
          external_order_id: order.external_order_id,
        })
      } else {
        const errorText = await callbackResponse.text()
        throw new Error(`HTTP ${callbackResponse.status}: ${errorText}`)
      }
    } catch (callbackError) {
      const errorMessage = String(callbackError)

      // Update with error
      await supabase
        .from('orders')
        .update({
          pdf_callback_status: attempts >= 3 ? 'failed' : 'pending',
          pdf_callback_attempts: attempts,
          pdf_callback_last_error: errorMessage,
        })
        .eq('id', orderId)

      log('callback_failed', {
        request_id: requestId,
        order_id: orderId,
        attempt: attempts,
        error: errorMessage,
      })

      return json({
        success: false,
        error: 'Callback delivery failed',
        attempt: attempts,
        details: errorMessage,
      }, attempts >= 3 ? 500 : 202)
    }
  } catch (error) {
    log('exception', { request_id: requestId, error: String(error) })
    return json({ error: 'Internal server error', details: String(error) }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
