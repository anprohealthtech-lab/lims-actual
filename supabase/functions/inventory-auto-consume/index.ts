/**
 * Inventory Auto-Consumption
 *
 * Automatically consumes inventory when a test result is saved.
 *
 * Functional rules:
 * - Skip outsourced tests
 * - Prefer analyte-level mappings over test-group mappings for the same item
 * - Consume only the remaining delta for a result/test/item combination
 * - Optionally consume explicit global per-test items configured on inventory_items
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface AutoConsumeRequest {
  resultId?: string
  orderId: string
  testGroupId: string
  labId: string
  userId?: string
  analyteIds?: string[]
}

interface ConsumptionCandidate {
  itemId: string
  itemName: string
  desiredQuantity: number
  mappingLevel: 'test_group' | 'analyte' | 'scope'
  unit: string
  currentStock: number
  packContains?: number | null
}

interface ExistingTxRow {
  quantity: number | null
}

interface ConsumeResult {
  success: boolean
  message: string
  itemsConsumed: number
  alertsGenerated: number
  skippedReason?: string
  consumedItems?: Array<{
    itemId: string
    itemName: string
    quantity: number
    newStock: number
    mappingLevel: 'test_group' | 'analyte' | 'scope'
  }>
}

const roundQuantity = (value: number) => Math.round(value * 1_000_000) / 1_000_000

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ error: 'Supabase configuration missing' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const body: AutoConsumeRequest = await req.json()
    const { resultId, orderId, testGroupId, labId, userId, analyteIds } = body

    if (!orderId || !testGroupId || !labId) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: orderId, testGroupId, labId' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const { data: orderTest } = await supabase
      .from('order_tests')
      .select('outsourced_lab_id')
      .eq('order_id', orderId)
      .eq('test_group_id', testGroupId)
      .maybeSingle()

    if (orderTest?.outsourced_lab_id) {
      const result: ConsumeResult = {
        success: true,
        message: 'Skipped - outsourced test',
        itemsConsumed: 0,
        alertsGenerated: 0,
        skippedReason: 'outsourced',
      }

      return new Response(
        JSON.stringify(result),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    let targetAnalyteIds = analyteIds || []

    if (targetAnalyteIds.length === 0 && resultId) {
      const { data: resultValues } = await supabase
        .from('result_values')
        .select('analyte_id')
        .eq('result_id', resultId)
        .not('analyte_id', 'is', null)

      targetAnalyteIds = (resultValues || []).map((row: any) => row.analyte_id).filter(Boolean)
    }

    const { data: testGroupMappings, error: tgError } = await supabase
      .from('inventory_test_mapping')
      .select(`
        item_id,
        quantity_per_test,
        unit,
        analyte_id,
        inventory_items!inner (
          id,
          name,
          current_stock,
          min_stock,
          unit,
          pack_contains
        )
      `)
      .eq('test_group_id', testGroupId)
      .eq('lab_id', labId)
      .eq('is_active', true)

    if (tgError) {
      throw tgError
    }

    const mappedByItem = new Map<string, ConsumptionCandidate>()
    const analyteItemIds = new Set<string>()

    for (const rawMapping of testGroupMappings || []) {
      const mapping = rawMapping as any
      const item = mapping.inventory_items
      if (!item) continue

      const packContains = item.pack_contains && item.pack_contains > 0
        ? Number(item.pack_contains)
        : null
      const quantityPerTest = Number(mapping.quantity_per_test || 0)
      const actualDeduction = packContains ? quantityPerTest / packContains : quantityPerTest

      if (!(actualDeduction > 0)) continue

      if (mapping.analyte_id) {
        analyteItemIds.add(item.id)
        if (targetAnalyteIds.length === 0 || !targetAnalyteIds.includes(mapping.analyte_id)) {
          continue
        }

        const existing = mappedByItem.get(item.id)
        if (existing) {
          existing.desiredQuantity = roundQuantity(existing.desiredQuantity + actualDeduction)
          existing.mappingLevel = 'analyte'
        } else {
          mappedByItem.set(item.id, {
            itemId: item.id,
            itemName: item.name,
            desiredQuantity: roundQuantity(actualDeduction),
            mappingLevel: 'analyte',
            unit: mapping.unit || item.unit,
            currentStock: Number(item.current_stock || 0),
            packContains,
          })
        }
        continue
      }

      if (mappedByItem.has(item.id)) continue

      mappedByItem.set(item.id, {
        itemId: item.id,
        itemName: item.name,
        desiredQuantity: roundQuantity(actualDeduction),
        mappingLevel: 'test_group',
        unit: mapping.unit || item.unit,
        currentStock: Number(item.current_stock || 0),
        packContains,
      })
    }

    for (const itemId of analyteItemIds) {
      const candidate = mappedByItem.get(itemId)
      if (candidate?.mappingLevel === 'test_group') {
        mappedByItem.delete(itemId)
      }
    }

    const { data: scopedItems, error: scopeError } = await supabase
      .from('inventory_items')
      .select('id, name, current_stock, consumption_per_use, pack_contains, unit')
      .eq('lab_id', labId)
      .eq('consumption_scope', 'per_test')
      .eq('is_active', true)
      .gt('consumption_per_use', 0)

    if (scopeError) {
      throw scopeError
    }

    for (const rawItem of scopedItems || []) {
      const item = rawItem as any
      if (mappedByItem.has(item.id)) continue

      const packContains = item.pack_contains && item.pack_contains > 0
        ? Number(item.pack_contains)
        : null
      const perUse = Number(item.consumption_per_use || 0)
      const actualDeduction = packContains ? perUse / packContains : perUse

      if (!(actualDeduction > 0)) continue

      mappedByItem.set(item.id, {
        itemId: item.id,
        itemName: item.name,
        desiredQuantity: roundQuantity(actualDeduction),
        mappingLevel: 'scope',
        unit: item.unit,
        currentStock: Number(item.current_stock || 0),
        packContains,
      })
    }

    const candidates = Array.from(mappedByItem.values())

    if (candidates.length === 0) {
      const result: ConsumeResult = {
        success: true,
        message: 'No consumption mappings configured',
        itemsConsumed: 0,
        alertsGenerated: 0,
        skippedReason: 'no_mappings',
      }

      return new Response(
        JSON.stringify(result),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const transactions: Array<Record<string, unknown>> = []
    const consumedItems: ConsumeResult['consumedItems'] = []

    for (const candidate of candidates) {
      let existingQuery = supabase
        .from('inventory_transactions')
        .select('quantity')
        .eq('lab_id', labId)
        .eq('order_id', orderId)
        .eq('test_group_id', testGroupId)
        .eq('item_id', candidate.itemId)
        .eq('type', 'out')

      if (resultId) {
        existingQuery = existingQuery.eq('result_id', resultId)
      }

      const { data: existingRows, error: existingError } = await existingQuery
      if (existingError) throw existingError

      const alreadyConsumed = roundQuantity(
        ((existingRows as ExistingTxRow[] | null) || []).reduce(
          (sum, row) => sum + Math.abs(Number(row.quantity || 0)),
          0,
        ),
      )

      const remainingQuantity = roundQuantity(candidate.desiredQuantity - alreadyConsumed)
      if (!(remainingQuantity > 0)) {
        continue
      }

      let batchInfo: { batch_number?: string; expiry_date?: string; unit_price?: number } = {}
      const { data: oldestBatch } = await supabase
        .from('inventory_transactions')
        .select('batch_number, expiry_date, unit_price')
        .eq('item_id', candidate.itemId)
        .eq('type', 'in')
        .not('batch_number', 'is', null)
        .order('expiry_date', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()

      if (oldestBatch) {
        batchInfo = {
          batch_number: oldestBatch.batch_number,
          expiry_date: oldestBatch.expiry_date,
          unit_price: oldestBatch.unit_price,
        }
      }

      const source = candidate.mappingLevel === 'scope' ? 'auto_test_scope' : 'auto_test_mapping'
      transactions.push({
        lab_id: labId,
        item_id: candidate.itemId,
        type: 'out',
        quantity: remainingQuantity,
        reason: candidate.mappingLevel === 'scope'
          ? 'Test consumption (scope)'
          : `Test consumption (${candidate.mappingLevel})`,
        order_id: orderId,
        result_id: resultId || null,
        test_group_id: testGroupId,
        performed_by: userId || null,
        ai_input: {
          source,
          mapping_level: candidate.mappingLevel,
          desired_quantity: candidate.desiredQuantity,
          already_consumed: alreadyConsumed,
          consumed_delta: remainingQuantity,
          analyte_ids: targetAnalyteIds,
        },
        ...batchInfo,
      })

      consumedItems.push({
        itemId: candidate.itemId,
        itemName: candidate.itemName,
        quantity: remainingQuantity,
        newStock: roundQuantity(candidate.currentStock - remainingQuantity),
        mappingLevel: candidate.mappingLevel,
      })
    }

    if (transactions.length === 0) {
      const result: ConsumeResult = {
        success: true,
        message: 'No new inventory to consume for this result',
        itemsConsumed: 0,
        alertsGenerated: 0,
        skippedReason: 'already_consumed',
      }

      return new Response(
        JSON.stringify(result),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const { error: insertError } = await supabase
      .from('inventory_transactions')
      .insert(transactions)

    if (insertError) {
      return new Response(
        JSON.stringify({ error: 'Failed to create consumption transactions', details: insertError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const { count: alertCount } = await supabase
      .from('stock_alerts')
      .select('*', { count: 'exact', head: true })
      .eq('lab_id', labId)
      .eq('status', 'active')
      .gte('created_at', new Date(Date.now() - 5000).toISOString())

    const result: ConsumeResult = {
      success: true,
      message: `Consumed ${consumedItems.length} items`,
      itemsConsumed: consumedItems.length,
      alertsGenerated: alertCount || 0,
      consumedItems,
    }

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (error: any) {
    console.error('Auto-consume error:', error)
    return new Response(
      JSON.stringify({ error: 'Auto-consumption failed', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
