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

function logIngest(event: string, details: Record<string, unknown> = {}) {
  console.log(`[analyzer-ingest] ${event} ${JSON.stringify(details)}`)
}

function errorDetails(error: unknown) {
  if (error instanceof Error) return { message: error.message, name: error.name }
  if (typeof error === 'object' && error !== null) return error
  return { message: String(error) }
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

  const requestId = crypto.randomUUID()
  const url = new URL(req.url)
  const path = url.pathname.replace(/\/$/, '')
  logIngest('request_received', {
    request_id: requestId,
    method: req.method,
    path,
    search: url.search,
  })

  const apiKey = req.headers.get('x-lab-api-key')
  if (!apiKey) {
    logIngest('auth_missing_key', { request_id: requestId, method: req.method, path })
    return json({ error: 'Missing x-lab-api-key header' }, 401)
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  const { keyId, labId, error: keyError } = await validateKey(supabase, apiKey)
  if (keyError || !labId) {
    logIngest('auth_failed', {
      request_id: requestId,
      method: req.method,
      path,
      error: keyError ? errorDetails(keyError) : null,
    })
    return json({ error: 'Invalid or inactive API key' }, 403)
  }
  logIngest('auth_ok', { request_id: requestId, lab_id: labId, key_id: keyId, method: req.method, path })

  const { data: labRow } = await supabase
    .from('labs')
    .select('lab_interface_enabled')
    .eq('id', labId)
    .single()

  if (!labRow?.lab_interface_enabled) {
    logIngest('lab_interface_disabled', { request_id: requestId, lab_id: labId })
    return json({ error: 'Lab interface not enabled for this lab' }, 403)
  }

  touchKey(supabase, keyId)

  if (req.method === 'POST' && !path.endsWith('/pending') && !path.endsWith('/worklist') && !path.endsWith('/ack')) {
    try {
	      const body = await req.json()
	      const { raw_content, direction = 'INBOUND', analyzer_connection_id, sample_barcode } = body

	      if (!raw_content) {
	        logIngest('raw_message_missing_content', { request_id: requestId, lab_id: labId, direction })
	        return json({ error: 'Missing raw_content' }, 400)
	      }
	      if (!['INBOUND', 'OUTBOUND'].includes(direction)) {
	        logIngest('raw_message_bad_direction', { request_id: requestId, lab_id: labId, direction })
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
	        logIngest('raw_message_insert_failed', {
	          request_id: requestId,
	          lab_id: labId,
	          analyzer_connection_id,
	          sample_barcode,
	          direction,
	          error: errorDetails(insertError),
	        })
	        return json({ error: 'Failed to store message' }, 500)
	      }

	      logIngest('raw_message_inserted', {
	        request_id: requestId,
	        lab_id: labId,
	        message_id: inserted.id,
	        analyzer_connection_id,
	        sample_barcode,
	        direction,
	        raw_size: String(raw_content).length,
	      })
	      return json({ success: true, message_id: inserted.id })
	    } catch (err) {
	      logIngest('raw_message_exception', { request_id: requestId, lab_id: labId, error: errorDetails(err) })
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
	          analyzer_connection:analyzer_connections (
	            id,
	            name,
	            connection_type,
	            host_mode,
	            config,
	            status
	          ),
	          created_at
	        `)
        .eq('lab_id', labId)
        .eq('status', 'mapped')
        .eq('flow_type', 'lims_push')
        .order('priority', { ascending: true })
        .order('created_at', { ascending: true })
        .limit(20)

	      if (fetchError) {
	        logIngest('pending_fetch_failed', {
	          request_id: requestId,
	          lab_id: labId,
	          error: errorDetails(fetchError),
	        })
	        return json({ error: 'Failed to fetch pending orders' }, 500)
	      }

	      if (orders && orders.length > 0) {
	        const ids = orders.map((o: any) => o.id)
        await supabase
          .from('analyzer_order_queue')
	          .update({ status: 'sending', sending_started_at: new Date().toISOString() })
	          .in('id', ids)
	      }

	      logIngest('pending_poll', {
	        request_id: requestId,
	        lab_id: labId,
	        count: orders?.length ?? 0,
	        queue_ids: (orders ?? []).map((o: any) => o.id),
	        analyzer_connection_ids: [...new Set((orders ?? []).map((o: any) => o.analyzer_connection_id).filter(Boolean))],
	        sample_barcodes: (orders ?? []).map((o: any) => o.sample_barcode),
	      })
	      return json({ orders: orders ?? [], count: orders?.length ?? 0 })
	    } catch (err) {
	      logIngest('pending_exception', { request_id: requestId, lab_id: labId, error: errorDetails(err) })
	      return json({ error: 'Internal server error' }, 500)
	    }
	  }

  if (req.method === 'GET' && path.endsWith('/worklist')) {
    try {
      const sampleBarcode = url.searchParams.get('sample_barcode')?.trim()
      const analyzerConnectionId = url.searchParams.get('analyzer_connection_id')?.trim()
	      const rawQuery = url.searchParams.get('raw_query') ?? null

	      if (!sampleBarcode) {
	        logIngest('worklist_missing_barcode', { request_id: requestId, lab_id: labId, analyzer_connection_id: analyzerConnectionId })
	        return json({ error: 'Missing sample_barcode' }, 400)
	      }

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
	          analyzer_connection:analyzer_connections (
	            id,
	            name,
	            connection_type,
	            host_mode,
	            config,
	            status
	          ),
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
	        logIngest('worklist_fetch_failed', {
	          request_id: requestId,
	          lab_id: labId,
	          sample_barcode: sampleBarcode,
	          analyzer_connection_id: analyzerConnectionId,
	          error: errorDetails(fetchError),
	        })
	        return json({ error: 'Failed to fetch worklist order' }, 500)
	      }

	      const order = rows?.[0] ?? null
	      if (!order) {
	        logIngest('worklist_not_found', {
	          request_id: requestId,
	          lab_id: labId,
	          sample_barcode: sampleBarcode,
	          analyzer_connection_id: analyzerConnectionId,
	        })
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

	      logIngest('worklist_served', {
	        request_id: requestId,
	        lab_id: labId,
	        queue_id: order.id,
	        order_id: order.order_id,
	        sample_barcode: sampleBarcode,
	        analyzer_connection_id: order.analyzer_connection_id,
	        served_count: Number(order.served_count ?? 0) + 1,
	      })
	      return json({ found: true, order })
	    } catch (err) {
	      logIngest('worklist_exception', { request_id: requestId, lab_id: labId, error: errorDetails(err) })
	      return json({ error: 'Internal server error' }, 500)
	    }
	  }

  if (req.method === 'POST' && path.endsWith('/ack')) {
    try {
	      const body = await req.json()
	      const { queue_id, ack, error_reason } = body

	      if (!queue_id) {
	        logIngest('ack_missing_queue_id', { request_id: requestId, lab_id: labId, ack })
	        return json({ error: 'Missing queue_id' }, 400)
	      }

      const { data: entry, error: entryError } = await supabase
        .from('analyzer_order_queue')
        .select('id, lab_id, order_id')
        .eq('id', queue_id)
        .eq('lab_id', labId)
        .single()

	      if (entryError || !entry) {
	        logIngest('ack_queue_not_found', {
	          request_id: requestId,
	          lab_id: labId,
	          queue_id,
	          ack,
	          error: entryError ? errorDetails(entryError) : null,
	        })
	        return json({ error: 'Queue entry not found or not yours' }, 404)
	      }

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

	      logIngest('ack_recorded', {
	        request_id: requestId,
	        lab_id: labId,
	        queue_id,
	        order_id: entry.order_id,
	        ack: Boolean(ack),
	        status: newStatus,
	        error_reason: error_reason || null,
	      })
	      return json({ success: true, status: newStatus })
	    } catch (err) {
	      logIngest('ack_exception', { request_id: requestId, lab_id: labId, error: errorDetails(err) })
	      return json({ error: 'Internal server error' }, 500)
	    }
	  }

	  logIngest('not_found', { request_id: requestId, lab_id: labId, method: req.method, path })
	  return json({ error: 'Not found' }, 404)
	})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
