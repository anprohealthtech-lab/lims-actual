// print-bridge: queue endpoint for LIMS Bridge Utility local printing.
//
// Authentication: x-lab-api-key header, same lab-scoped API key model used by
// analyzer-ingest.
//
// Routes:
//   GET  /print-bridge/health
//   GET  /print-bridge/pending?device_id=optional&location_id=optional&limit=10
//   POST /print-bridge/ack

import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-lab-api-key',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function logPrint(event: string, details: Record<string, unknown> = {}) {
  console.log(`[print-bridge] ${event} ${JSON.stringify(details)}`)
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

  return { keyId: data?.id ?? null, labId: data?.lab_id ?? null, error }
}

function touchKey(supabase: any, keyId: string) {
  supabase
    .from('lab_api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', keyId)
    .then(() => {})
}

function normalizeLimit(value: string | null): number {
  const parsed = Number.parseInt(value || '10', 10)
  if (!Number.isFinite(parsed)) return 10
  return Math.max(1, Math.min(parsed, 25))
}

function objectOrEmpty(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const requestId = crypto.randomUUID()
  const url = new URL(req.url)
  const path = url.pathname.replace(/\/$/, '')

  logPrint('request_received', {
    request_id: requestId,
    method: req.method,
    path,
    search: url.search,
  })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  const apiKey = req.headers.get('x-lab-api-key')
  if (!apiKey) {
    logPrint('auth_missing_key', { request_id: requestId, method: req.method, path })
    return json({ error: 'Missing x-lab-api-key header' }, 401)
  }

  const { keyId, labId, error: keyError } = await validateKey(supabase, apiKey)
  if (keyError || !labId || !keyId) {
    logPrint('auth_failed', {
      request_id: requestId,
      method: req.method,
      path,
      error: keyError ? errorDetails(keyError) : null,
    })
    return json({ error: 'Invalid or inactive API key' }, 403)
  }

  touchKey(supabase, keyId)

  if (req.method === 'GET' && path.endsWith('/health')) {
    return json({
      success: true,
      service: 'print-bridge',
      lab_id: labId,
      time: new Date().toISOString(),
    })
  }

  if (req.method === 'GET' && path.endsWith('/pending')) {
    try {
      const limit = normalizeLimit(url.searchParams.get('limit'))
      const deviceId = url.searchParams.get('device_id')?.trim() || null
      const locationId = url.searchParams.get('location_id')?.trim() || null
      const now = new Date().toISOString()

      let query = supabase
        .from('print_jobs')
        .select(`
          id,
          lab_id,
          location_id,
          print_device_id,
          printer_role,
          job_type,
          status,
          priority,
          payload,
          copies,
          order_id,
          sample_id,
          report_id,
          invoice_id,
          attempt_count,
          created_at
        `)
        .eq('lab_id', labId)
        .eq('status', 'pending')
        .order('priority', { ascending: true })
        .order('created_at', { ascending: true })
        .limit(limit)

      if (locationId) query = query.or(`location_id.eq.${locationId},location_id.is.null`)
      if (deviceId) query = query.or(`print_device_id.eq.${deviceId},print_device_id.is.null`)

      const { data: pendingJobs, error: fetchError } = await query

      if (fetchError) {
        logPrint('pending_fetch_failed', {
          request_id: requestId,
          lab_id: labId,
          error: errorDetails(fetchError),
        })
        return json({ error: 'Failed to fetch pending print jobs' }, 500)
      }

      const ids = (pendingJobs ?? []).map((job: any) => job.id)
      if (ids.length === 0) {
        logPrint('pending_poll_empty', { request_id: requestId, lab_id: labId, device_id: deviceId })
        return json({ jobs: [], count: 0 })
      }

      const { data: claimedJobs, error: claimError } = await supabase
        .from('print_jobs')
        .update({
          status: 'claimed',
          claimed_at: now,
          ...(deviceId ? { claimed_by_device_id: deviceId } : {}),
        })
        .in('id', ids)
        .eq('status', 'pending')
        .select(`
          id,
          lab_id,
          location_id,
          print_device_id,
          printer_role,
          job_type,
          status,
          priority,
          payload,
          copies,
          order_id,
          sample_id,
          report_id,
          invoice_id,
          attempt_count,
          created_at
        `)

      if (claimError) {
        logPrint('pending_claim_failed', {
          request_id: requestId,
          lab_id: labId,
          ids,
          error: errorDetails(claimError),
        })
        return json({ error: 'Failed to claim print jobs' }, 500)
      }

      logPrint('pending_claimed', {
        request_id: requestId,
        lab_id: labId,
        device_id: deviceId,
        count: claimedJobs?.length ?? 0,
        job_ids: (claimedJobs ?? []).map((job: any) => job.id),
      })

      return json({ jobs: claimedJobs ?? [], count: claimedJobs?.length ?? 0 })
    } catch (err) {
      logPrint('pending_exception', { request_id: requestId, lab_id: labId, error: errorDetails(err) })
      return json({ error: 'Internal server error' }, 500)
    }
  }

  if (req.method === 'POST' && path.endsWith('/ack')) {
    try {
      const body = await req.json()
      const jobId = body.job_id || body.print_job_id
      const success = Boolean(body.success ?? body.ack)
      const error = body.error || body.error_reason || null
      const deviceId = body.device_id || null
      const printerName = body.printer_name || null

      if (!jobId) {
        return json({ error: 'Missing job_id' }, 400)
      }

      const { data: job, error: jobError } = await supabase
        .from('print_jobs')
        .select('id, lab_id, status, attempt_count, payload')
        .eq('id', jobId)
        .eq('lab_id', labId)
        .single()

      if (jobError || !job) {
        logPrint('ack_job_not_found', {
          request_id: requestId,
          lab_id: labId,
          job_id: jobId,
          error: jobError ? errorDetails(jobError) : null,
        })
        return json({ error: 'Print job not found or not yours' }, 404)
      }

      const now = new Date().toISOString()
      const nextStatus = success ? 'completed' : 'failed'
      const nextAttemptCount = Number(job.attempt_count ?? 0) + 1
      const ackMetadata = objectOrEmpty(body.metadata || body.result || body.payload)

      const updatePayload: Record<string, unknown> = {
        status: nextStatus,
        completed_at: success ? now : null,
        failed_at: success ? null : now,
        last_error: success ? null : error,
        attempt_count: nextAttemptCount,
        ...(deviceId ? { claimed_by_device_id: deviceId } : {}),
      }

      if (body.append_payload_metadata === true) {
        const existingPayload = objectOrEmpty(job.payload)
        updatePayload.payload = {
          ...existingPayload,
          bridge_result: {
            ...objectOrEmpty(existingPayload.bridge_result),
            ...ackMetadata,
            success,
            error,
            printer_name: printerName,
            device_id: deviceId,
            at: now,
          },
          ack: {
            success,
            error,
            printer_name: printerName,
            device_id: deviceId,
            at: now,
          },
        }
      }

      const { error: updateError } = await supabase
        .from('print_jobs')
        .update(updatePayload)
        .eq('id', jobId)
        .eq('lab_id', labId)

      if (updateError) {
        logPrint('ack_update_failed', {
          request_id: requestId,
          lab_id: labId,
          job_id: jobId,
          error: errorDetails(updateError),
        })
        return json({ error: 'Failed to update print job ACK' }, 500)
      }

      logPrint('ack_recorded', {
        request_id: requestId,
        lab_id: labId,
        job_id: jobId,
        success,
        status: nextStatus,
        device_id: deviceId,
        printer_name: printerName,
      })

      return json({ success: true, status: nextStatus })
    } catch (err) {
      logPrint('ack_exception', { request_id: requestId, lab_id: labId, error: errorDetails(err) })
      return json({ error: 'Internal server error' }, 500)
    }
  }

  logPrint('not_found', { request_id: requestId, lab_id: labId, method: req.method, path })
  return json({ error: 'Not found' }, 404)
})
