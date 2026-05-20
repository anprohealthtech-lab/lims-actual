// analyzer-ingest: single endpoint for LIS bridge apps.
// Authentication: x-lab-api-key header.
//
// Routes:
//   POST /analyzer-ingest
//     Store raw analyzer message.
//   GET /analyzer-ingest/pending
//     Fetch push-style mapped orders. Excludes analyzer-initiated worklist rows.
//   GET /analyzer-ingest/worklist?sample_barcode=...
//     Fetch one ORR^O02 worklist response for analyzer-initiated flows.
//   POST /analyzer-ingest/ack
//     Confirm push delivery or NAK.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-lab-api-key',
}

async function validateKey(supabase: any, apiKey: string) {
  const keyBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(apiKey))
  const keyHash = Array.from(new Uint8Array(keyBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  const { data, error } = await supabase
    .from('lab_api_keys')
    .select('id, lab_id')
    .eq('key_hash', keyHash)
    .eq('is_active', true)
    .single()

  return { keyRow: data ?? null, keyId: data?.id ?? null, labId: data?.lab_id ?? null, error }
}

function touchKey(supabase: any, keyId: string) {
  supabase
    .from('lab_api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', keyId)
    .then(() => {})
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const url = new URL(req.url)
  const path = url.pathname.replace(/\/$/, '')

  const apiKey = req.headers.get('x-lab-api-key')
  if (!apiKey) return json({ error: 'Missing x-lab-api-key header' }, 401)

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  const { keyId, labId, error: keyError } = await validateKey(supabase, apiKey)
  if (keyError || !labId) return json({ error: 'Invalid or inactive API key' }, 403)

  const { data: labRow } = await supabase
    .from('labs')
    .select('lab_interface_enabled')
    .eq('id', labId)
    .single()

  if (!labRow?.lab_interface_enabled) {
    return json({ error: 'Lab interface not enabled for this lab' }, 403)
  }

  touchKey(supabase, keyId)

  if (req.method === 'POST' && !path.endsWith('/pending') && !path.endsWith('/worklist') && !path.endsWith('/ack')) {
    try {
      const body = await req.json()
      const { raw_content, direction = 'INBOUND', analyzer_connection_id, sample_barcode } = body

      if (!raw_content) return json({ error: 'Missing raw_content' }, 400)
      if (!['INBOUND', 'OUTBOUND'].includes(direction)) {
        return json({ error: 'direction must be INBOUND or OUTBOUND' }, 400)
      }

      const { data: inserted, error: insertError } = await supabase
        .from('analyzer_raw_messages')
        .insert({
          lab_id: labId,
          direction,
          raw_content,
          ai_status: 'pending',
          ...(analyzer_connection_id && { analyzer_connection_id }),
          ...(sample_barcode && { sample_barcode }),
        })
        .select('id')
        .single()

      if (insertError) {
        console.error('Insert error:', insertError)
        return json({ error: 'Failed to store message' }, 500)
      }

      return json({ success: true, message_id: inserted.id })
    } catch (err) {
      console.error(err)
      return json({ error: 'Internal server error' }, 500)
    }
  }

  if (req.method === 'GET' && path.endsWith('/pending')) {
    try {
      const { data: orders, error: fetchError } = await supabase
        .from('analyzer_order_queue')
        .select(`
          id,
          order_id,
          sample_barcode,
          hl7_message,
          message_control_id,
          priority,
          requested_tests,
          resolved_tests,
          flow_type,
          response_message_type,
          hl7_payload,
          analyzer_connection_id,
          created_at
        `)
        .eq('lab_id', labId)
        .eq('status', 'mapped')
        .eq('flow_type', 'lims_push')
        .order('priority', { ascending: true })
        .order('created_at', { ascending: true })
        .limit(20)

      if (fetchError) {
        console.error('Fetch error:', fetchError)
        return json({ error: 'Failed to fetch pending orders' }, 500)
      }

      if (orders && orders.length > 0) {
        const ids = orders.map((o: any) => o.id)
        await supabase
          .from('analyzer_order_queue')
          .update({ status: 'sending', sending_started_at: new Date().toISOString() })
          .in('id', ids)
      }

      return json({ orders: orders ?? [], count: orders?.length ?? 0 })
    } catch (err) {
      console.error(err)
      return json({ error: 'Internal server error' }, 500)
    }
  }

  if (req.method === 'GET' && path.endsWith('/worklist')) {
    try {
      const sampleBarcode = url.searchParams.get('sample_barcode')?.trim()
      const analyzerConnectionId = url.searchParams.get('analyzer_connection_id')?.trim()
      const rawQuery = url.searchParams.get('raw_query') ?? null

      if (!sampleBarcode) return json({ error: 'Missing sample_barcode' }, 400)

      let query = supabase
        .from('analyzer_order_queue')
        .select(`
          id,
          order_id,
          sample_barcode,
          hl7_message,
          message_control_id,
          priority,
          requested_tests,
          resolved_tests,
          flow_type,
          response_message_type,
          hl7_payload,
          analyzer_connection_id,
          served_count,
          created_at
        `)
        .eq('lab_id', labId)
        .eq('sample_barcode', sampleBarcode)
        .eq('status', 'mapped')
        .eq('flow_type', 'analyzer_initiated')
        .order('priority', { ascending: true })
        .order('created_at', { ascending: true })
        .limit(1)

      if (analyzerConnectionId) query = query.eq('analyzer_connection_id', analyzerConnectionId)

      const { data: rows, error: fetchError } = await query
      if (fetchError) {
        console.error('Worklist fetch error:', fetchError)
        return json({ error: 'Failed to fetch worklist order' }, 500)
      }

      const order = rows?.[0] ?? null
      if (!order) {
        return json({ found: false, sample_barcode: sampleBarcode, message: 'No mapped worklist order for barcode' }, 404)
      }

      const now = new Date().toISOString()
      await supabase
        .from('analyzer_order_queue')
        .update({
          served_at: now,
          served_count: Number(order.served_count ?? 0) + 1,
          worklist_query: {
            sample_barcode: sampleBarcode,
            analyzer_connection_id: analyzerConnectionId,
            raw_query: rawQuery,
            received_at: now,
          },
        })
        .eq('id', order.id)

      await supabase.from('analyzer_comm_log').insert({
        lab_id: labId,
        analyzer_connection_id: order.analyzer_connection_id,
        direction: 'SEND',
        message_type: order.response_message_type || 'ORR^O02',
        message_control_id: order.message_control_id,
        message_preview: String(order.hl7_message ?? '').slice(0, 500),
        message_size: String(order.hl7_message ?? '').length,
        success: true,
        order_id: order.order_id,
        queue_id: order.id,
      })

      return json({ found: true, order })
    } catch (err) {
      console.error(err)
      return json({ error: 'Internal server error' }, 500)
    }
  }

  if (req.method === 'POST' && path.endsWith('/ack')) {
    try {
      const body = await req.json()
      const { queue_id, ack, error_reason } = body

      if (!queue_id) return json({ error: 'Missing queue_id' }, 400)

      const { data: entry, error: entryError } = await supabase
        .from('analyzer_order_queue')
        .select('id, lab_id, order_id')
        .eq('id', queue_id)
        .eq('lab_id', labId)
        .single()

      if (entryError || !entry) return json({ error: 'Queue entry not found or not yours' }, 404)

      const newStatus = ack ? 'sent' : 'rejected'
      const now = new Date().toISOString()

      await supabase
        .from('analyzer_order_queue')
        .update({
          status: newStatus,
          sent_at: ack ? now : null,
          ...(error_reason && { last_error: error_reason }),
        })
        .eq('id', queue_id)

      await supabase.from('analyzer_comm_log').insert({
        lab_id: labId,
        direction: 'SEND',
        message_type: ack ? 'ACK' : 'NAK',
        queue_id,
        order_id: entry.order_id,
        success: ack,
        ...(error_reason && { error_message: error_reason }),
      })

      return json({ success: true, status: newStatus })
    } catch (err) {
      console.error(err)
      return json({ error: 'Internal server error' }, 500)
    }
  }

  return json({ error: 'Not found' }, 404)
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
