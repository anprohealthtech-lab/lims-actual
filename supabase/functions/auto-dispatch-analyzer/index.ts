// Auto-Dispatch Analyzer
// Triggered by Supabase webhook on orders INSERT (or UPDATE when sample is collected).
// Reads each test group's linked analyzer_connection_id, groups tests by analyzer,
// and calls dispatch-order-to-analyzer for each group automatically.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Accept both direct calls { order_id } and Supabase webhook format { record: { id } }
    const body = await req.json()
    const order = body.record ?? body
    const orderId: string = order.id ?? body.order_id

    if (!orderId) {
      return new Response(JSON.stringify({ error: 'Missing order_id' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      })
    }

    // 1. Fetch full order with patient and sample barcode
    const { data: orderData, error: orderError } = await supabase
      .from('orders')
      .select(`
        id, lab_id, patient_id, priority, order_number,
        sample_id,
        patients(name, date_of_birth, gender),
        samples(barcode),
        labs!inner(lab_interface_enabled)
      `)
      .eq('id', orderId)
      .single()

    if (orderError || !orderData) {
      throw new Error(`Order not found: ${orderId}`)
    }

    // Gate: only process labs with lab_interface_enabled = true
    if (!(orderData as any).labs?.lab_interface_enabled) {
      return new Response(JSON.stringify({
        success: false,
        message: 'Lab interface not enabled for this lab. Upgrade to activate analyzer auto-dispatch.',
        order_id: orderId,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // samples is a 1-to-many reverse FK array — pick first non-null barcode
    const samplesArr: { barcode: string }[] = Array.isArray((orderData as any).samples)
      ? (orderData as any).samples
      : (orderData as any).samples ? [(orderData as any).samples] : []
    const sampleBarcodeFromTable = samplesArr.find((s) => s.barcode)?.barcode

    // Priority: actual samples.barcode → orders.sample_id (human ID) → order_number → UUID tail
    let sampleBarcode: string =
      sampleBarcodeFromTable ??
      (orderData as any).sample_id ??
      (orderData as any).order_number?.toString() ??
      orderId.split('-').pop()

    const patient = (orderData as any).patients
    const priority = orderData.priority === 'STAT' ? 1 : 5

    // 2a. Fetch via order_test_groups (legacy / panel pathway)
    const { data: otgRows, error: otgError } = await supabase
      .from('order_test_groups')
      .select(`
        id,
        test_group_id,
        test_groups!inner(
          id, code, name, analyzer_connection_id
        )
      `)
      .eq('order_id', orderId)
      .not('test_groups.analyzer_connection_id', 'is', null)

    if (otgError) throw new Error(`order_test_groups query failed: ${otgError.message}`)

    // 2b. Fetch via order_tests (primary pathway — test_group_id FK → test_groups)
    const { data: otRows, error: otError } = await supabase
      .from('order_tests')
      .select(`
        id,
        test_group_id,
        test_groups!inner(
          id, code, name, analyzer_connection_id
        )
      `)
      .eq('order_id', orderId)
      .eq('is_canceled', false)
      .not('test_groups.analyzer_connection_id', 'is', null)

    if (otError) throw new Error(`order_tests query failed: ${otError.message}`)

    // Normalise both sources into a common shape
    type TGLink = { rowId: string; tgId: string; tg: { id: string; code: string; name: string; analyzer_connection_id: string } }

    const allLinks: TGLink[] = [
      ...(otgRows ?? []).map((r: any) => ({ rowId: r.id, tgId: r.test_group_id, tg: r.test_groups })),
      ...(otRows ?? []).map((r: any) => ({ rowId: r.id, tgId: r.test_group_id, tg: r.test_groups })),
    ]

    // De-duplicate by test_group_id (same panel can appear in both tables)
    const seenTGIds = new Set<string>()
    const uniqueLinks: TGLink[] = allLinks.filter((l) => {
      if (seenTGIds.has(l.tgId)) return false
      seenTGIds.add(l.tgId)
      return true
    })

    if (uniqueLinks.length === 0) {
      // Race condition: order_tests may not be inserted yet (webhook fires on orders INSERT).
      // Wait 4 seconds and retry once before giving up.
      await new Promise((r) => setTimeout(r, 4000))

      // Also re-fetch the sample barcode — samples table may not be written yet at webhook time
      if (!sampleBarcodeFromTable) {
        const { data: freshSamples } = await supabase
          .from('samples')
          .select('barcode')
          .eq('order_id', orderId)
          .not('barcode', 'is', null)
          .limit(1)
        if (freshSamples?.[0]?.barcode) {
          sampleBarcode = freshSamples[0].barcode
        }
      }

      const { data: otRowsRetry } = await supabase
        .from('order_tests')
        .select(`id, test_group_id, test_groups!inner(id, code, name, analyzer_connection_id)`)
        .eq('order_id', orderId)
        .eq('is_canceled', false)
        .not('test_groups.analyzer_connection_id', 'is', null)

      const { data: otgRowsRetry } = await supabase
        .from('order_test_groups')
        .select(`id, test_group_id, test_groups!inner(id, code, name, analyzer_connection_id)`)
        .eq('order_id', orderId)
        .not('test_groups.analyzer_connection_id', 'is', null)

      const retryLinks: TGLink[] = [
        ...(otgRowsRetry ?? []).map((r: any) => ({ rowId: r.id, tgId: r.test_group_id, tg: r.test_groups })),
        ...(otRowsRetry ?? []).map((r: any) => ({ rowId: r.id, tgId: r.test_group_id, tg: r.test_groups })),
      ].filter((l) => {
        if (seenTGIds.has(l.tgId)) return false
        seenTGIds.add(l.tgId)
        return true
      })

      if (retryLinks.length === 0) {
        return new Response(JSON.stringify({
          success: true,
          message: 'No test groups with analyzer_connection_id configured — nothing to dispatch.',
          order_id: orderId,
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      uniqueLinks.push(...retryLinks)
    }

    // If barcode is still a fallback value (no real sample barcode found at webhook time),
    // do one final re-fetch regardless of whether retry was needed.
    if (!sampleBarcodeFromTable) {
      const { data: freshSamples } = await supabase
        .from('samples')
        .select('barcode')
        .eq('order_id', orderId)
        .not('barcode', 'is', null)
        .limit(1)
      if (freshSamples?.[0]?.barcode) {
        sampleBarcode = freshSamples[0].barcode
      }
    }

    // 3. Group test group codes by analyzer_connection_id
    const byAnalyzer = new Map<string, { tests: string[]; testGroupIds: string[] }>()

    for (const link of uniqueLinks) {
      const tg = link.tg
      const connId: string = tg.analyzer_connection_id
      const code: string = tg.code || tg.name

      if (!byAnalyzer.has(connId)) {
        byAnalyzer.set(connId, { tests: [], testGroupIds: [] })
      }
      const group = byAnalyzer.get(connId)!
      group.tests.push(code)
      group.testGroupIds.push(tg.id)
    }

    // 4. Check for existing queue entries to avoid double-dispatch
    const { data: existingQueue } = await supabase
      .from('analyzer_order_queue')
      .select('analyzer_connection_id')
      .eq('order_id', orderId)
      .in('status', ['pending', 'mapped', 'sending', 'sent', 'acknowledged'])

    const alreadyDispatched = new Set(
      (existingQueue ?? []).map((q: any) => q.analyzer_connection_id)
    )

    // 5. Dispatch to each analyzer
    const results: any[] = []

    for (const [analyzerConnectionId, group] of byAnalyzer) {
      if (alreadyDispatched.has(analyzerConnectionId)) {
        results.push({
          analyzer_connection_id: analyzerConnectionId,
          skipped: true,
          reason: 'Already queued',
        })
        continue
      }

      try {
        const { data: dispatchResult, error: dispatchError } = await supabase.functions.invoke(
          'dispatch-order-to-analyzer',
          {
            headers: {
              Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''}`,
            },
            body: {
              order_id: orderId,
              sample_barcode: sampleBarcode,
              analyzer_connection_id: analyzerConnectionId,
              tests: group.tests,
              patient: patient
                ? {
                    name: patient.name ?? '',
                    dob: patient.date_of_birth || null,
                    gender: patient.gender ?? '',
                  }
                : undefined,
              priority,
            },
          }
        )

        if (dispatchError) {
          // Try to extract the actual error message from the response body
          const errBody = (dispatchResult as any)
          console.error(`dispatch-order-to-analyzer FAILED:`, JSON.stringify(dispatchError), `body:`, JSON.stringify(errBody))
          throw new Error(`dispatch failed: ${JSON.stringify(dispatchError)} body: ${JSON.stringify(errBody)}`)
        }

        results.push({
          analyzer_connection_id: analyzerConnectionId,
          tests: group.tests,
          ...dispatchResult,
        })

        console.log(`✅ Dispatched order ${orderId} to analyzer ${analyzerConnectionId}: ${group.tests.join(', ')}`)
      } catch (err: any) {
        console.error(`❌ Failed to dispatch to analyzer ${analyzerConnectionId}:`, err.message)
        results.push({
          analyzer_connection_id: analyzerConnectionId,
          tests: group.tests,
          error: err.message,
        })
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        order_id: orderId,
        sample_barcode: sampleBarcode,
        dispatched_to: results.length,
        results,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error: any) {
    console.error('Auto-dispatch error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})
