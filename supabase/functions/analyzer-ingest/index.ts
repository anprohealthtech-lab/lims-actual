// analyzer-ingest: Single endpoint for LIS bridge apps — handles all bi-directional traffic.
// Authentication: x-lab-api-key header (lab-scoped, revokable — service role never exposed to bridge).
//
// Routes (determined by method + URL path suffix):
//   POST   /analyzer-ingest          → inbound: store raw analyzer message
//   GET    /analyzer-ingest/pending  → outbound: fetch mapped HL7 orders waiting to be sent
//   POST   /analyzer-ingest/ack      → outbound: confirm delivery + ACK/NAK from analyzer

import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-lab-api-key',
}

// Shared: hash the API key and validate against lab_api_keys
async function validateKey(supabase: any, apiKey: string) {
  const keyBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(apiKey))
  const keyHash = Array.from(new Uint8Array(keyBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')

  const { data, error } = await supabase
    .from('lab_api_keys')
    .select('id, lab_id')
    .eq('key_hash', keyHash)
    .eq('is_active', true)
    .single()

  return { keyRow: data ?? null, keyId: data?.id ?? null, labId: data?.lab_id ?? null, error }
}

// Touch last_used_at — fire and forget
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
  const path = url.pathname.replace(/\/$/, '') // strip trailing slash

  const apiKey = req.headers.get('x-lab-api-key')
  if (!apiKey) {
    return json({ error: 'Missing x-lab-api-key header' }, 401)
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  )

  const { keyId, labId, error: keyError } = await validateKey(supabase, apiKey)
  if (keyError || !labId) {
    return json({ error: 'Invalid or inactive API key' }, 403)
  }

  // Gate: lab_interface_enabled must be true for this lab
  const { data: labRow } = await supabase
    .from('labs')
    .select('lab_interface_enabled')
    .eq('id', labId)
    .single()

  if (!labRow?.lab_interface_enabled) {
    return json({ error: 'Lab interface not enabled for this lab' }, 403)
  }

  touchKey(supabase, keyId)

  // ─────────────────────────────────────────────────────────────────
  // ROUTE 1: POST /analyzer-ingest
  // Inbound — bridge sends raw analyzer message to LIMS
  // ─────────────────────────────────────────────────────────────────
  if (req.method === 'POST' && !path.endsWith('/pending') && !path.endsWith('/ack')) {
    try {
      const body = await req.json()
      const { raw_content, direction = 'INBOUND', analyzer_connection_id, sample_barcode } = body

      if (!raw_content) return json({ error: 'Missing raw_content' }, 400)
      if (!['INBOUND', 'OUTBOUND'].includes(direction))
        return json({ error: 'direction must be INBOUND or OUTBOUND' }, 400)

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

  // ─────────────────────────────────────────────────────────────────
  // ROUTE 2: GET /analyzer-ingest/pending
  // Outbound — bridge polls for HL7 orders ready to send to analyzer
  // Returns up to 20 orders with status = 'mapped' for this lab
  // ─────────────────────────────────────────────────────────────────
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
          analyzer_connection_id,
          created_at
        `)
        .eq('lab_id', labId)
        .eq('status', 'mapped')
        .order('priority', { ascending: true })   // STAT (1) before Routine (5)
        .order('created_at', { ascending: true })  // oldest first
        .limit(20)

      if (fetchError) {
        console.error('Fetch error:', fetchError)
        return json({ error: 'Failed to fetch pending orders' }, 500)
      }

      // Mark fetched orders as 'sending' so they aren't double-dispatched
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

  // ─────────────────────────────────────────────────────────────────
  // ROUTE 3: POST /analyzer-ingest/ack
  // Outbound — bridge reports delivery result back to LIMS
  // Called after TCP send; ack=true means analyzer accepted, ack=false = NAK/timeout
  // ─────────────────────────────────────────────────────────────────
  if (req.method === 'POST' && path.endsWith('/ack')) {
    try {
      const body = await req.json()
      const { queue_id, ack, error_reason } = body

      if (!queue_id) return json({ error: 'Missing queue_id' }, 400)

      // Verify this queue entry belongs to this lab
      const { data: entry, error: entryError } = await supabase
        .from('analyzer_order_queue')
        .select('id, lab_id, order_id')
        .eq('id', queue_id)
        .eq('lab_id', labId)
        .single()

      if (entryError || !entry) {
        return json({ error: 'Queue entry not found or not yours' }, 404)
      }

      const newStatus = ack ? 'sent' : 'failed'
      const now = new Date().toISOString()

      await supabase
        .from('analyzer_order_queue')
        .update({
          status: newStatus,
          sent_at: ack ? now : null,
          ...(error_reason && { error_message: error_reason }),
        })
        .eq('id', queue_id)

      // Log to comm log
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
