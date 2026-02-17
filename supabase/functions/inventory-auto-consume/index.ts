/**
 * Inventory Auto-Consumption
 *
 * Automatically consumes inventory when a test result is saved.
 * Triggered from ResultsInput after successful result save.
 *
 * Features:
 * - Looks up test-item mappings at BOTH test_group AND analyte level
 * - Skips outsourced tests (no local consumption)
 * - Creates consumption transactions
 * - Auto-generates stock alerts via database trigger
 * - Supports granular analyte-level consumption mapping
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
  // Optional: specific analyte IDs being processed (for analyte-level consumption)
  analyteIds?: string[]
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
    mappingLevel: 'test_group' | 'analyte'
  }>
}

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
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const body: AutoConsumeRequest = await req.json()
    const { resultId, orderId, testGroupId, labId, userId, analyteIds } = body

    // Validate required fields
    if (!orderId || !testGroupId || !labId) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: orderId, testGroupId, labId' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`\n📦 Inventory Auto-Consume`)
    console.log(`  - Order ID: ${orderId}`)
    console.log(`  - Test Group ID: ${testGroupId}`)
    console.log(`  - Result ID: ${resultId || 'not provided'}`)
    console.log(`  - Lab ID: ${labId}`)
    console.log(`  - Analyte IDs: ${analyteIds?.length || 0} provided`)

    // 1. Check if test is outsourced (skip consumption)
    const { data: orderTest, error: orderTestError } = await supabase
      .from('order_tests')
      .select('outsourced_lab_id')
      .eq('order_id', orderId)
      .eq('test_group_id', testGroupId)
      .maybeSingle()

    if (orderTestError) {
      console.error('Error checking order_tests:', orderTestError)
    }

    if (orderTest?.outsourced_lab_id) {
      console.log('  ⏭️ Skipping - test is outsourced')
      const result: ConsumeResult = {
        success: true,
        message: 'Skipped - outsourced test',
        itemsConsumed: 0,
        alertsGenerated: 0,
        skippedReason: 'outsourced',
      }
      return new Response(
        JSON.stringify(result),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 2. Get consumption mappings - BOTH test_group level AND analyte level
    const mappingsToProcess: Array<{
      item_id: string
      quantity_per_test: number
      unit: string | null
      mapping_level: 'test_group' | 'analyte'
      analyte_id: string | null
      inventory_items: {
        id: string
        name: string
        current_stock: number
        min_stock: number
        unit: string
      }
    }> = []

    // 2a. Get TEST GROUP level mappings
    const { data: testGroupMappings, error: tgMappingsError } = await supabase
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
          pack_contains,
          consumption_per_use
        )
      `)
      .eq('test_group_id', testGroupId)
      .eq('lab_id', labId)
      .eq('is_active', true)
      .is('analyte_id', null) // Only test_group level (no analyte specified)

    if (tgMappingsError) {
      console.error('Error fetching test group mappings:', tgMappingsError)
    } else if (testGroupMappings) {
      testGroupMappings.forEach((m: any) => {
        mappingsToProcess.push({
          ...m,
          mapping_level: 'test_group',
        })
      })
      console.log(`  📋 Found ${testGroupMappings.length} test-group level mappings`)
    }

    // 2b. Get ANALYTE level mappings (if analyteIds provided or fetch from result)
    let targetAnalyteIds = analyteIds || []

    // If no analyteIds provided, try to get them from the result
    if (targetAnalyteIds.length === 0 && resultId) {
      const { data: resultValues } = await supabase
        .from('result_values')
        .select('analyte_id')
        .eq('result_id', resultId)
        .not('analyte_id', 'is', null)

      if (resultValues) {
        targetAnalyteIds = resultValues.map((rv: any) => rv.analyte_id).filter(Boolean)
        console.log(`  📋 Found ${targetAnalyteIds.length} analytes from result`)
      }
    }

    // If we still don't have analyte IDs, get them from test_group_analytes
    if (targetAnalyteIds.length === 0) {
      const { data: testGroupAnalytes } = await supabase
        .from('test_group_analytes')
        .select('analyte_id')
        .eq('test_group_id', testGroupId)

      if (testGroupAnalytes) {
        targetAnalyteIds = testGroupAnalytes.map((tga: any) => tga.analyte_id).filter(Boolean)
        console.log(`  📋 Found ${targetAnalyteIds.length} analytes from test_group_analytes`)
      }
    }

    if (targetAnalyteIds.length > 0) {
      const { data: analyteMappings, error: analyteMappingsError } = await supabase
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
            pack_contains,
            consumption_per_use
          )
        `)
        .in('analyte_id', targetAnalyteIds)
        .eq('lab_id', labId)
        .eq('is_active', true)

      if (analyteMappingsError) {
        console.error('Error fetching analyte mappings:', analyteMappingsError)
      } else if (analyteMappings) {
        analyteMappings.forEach((m: any) => {
          mappingsToProcess.push({
            ...m,
            mapping_level: 'analyte',
          })
        })
        console.log(`  📋 Found ${analyteMappings.length} analyte-level mappings`)
      }
    }

    // No mappings found
    if (mappingsToProcess.length === 0) {
      console.log('  ℹ️ No consumption mappings configured for this test/analytes')
      const result: ConsumeResult = {
        success: true,
        message: 'No consumption mappings configured',
        itemsConsumed: 0,
        alertsGenerated: 0,
        skippedReason: 'no_mappings',
      }
      return new Response(
        JSON.stringify(result),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`  📋 Total mappings to process: ${mappingsToProcess.length}`)

    // 2c. Idempotency check - skip if already consumed for this result/order+test combo
    {
      let idempotencyQuery = supabase
        .from('inventory_transactions')
        .select('id', { count: 'exact', head: true })
        .eq('order_id', orderId)
        .eq('test_group_id', testGroupId)
        .eq('type', 'out')

      if (resultId) {
        idempotencyQuery = idempotencyQuery.eq('result_id', resultId)
      }

      const { count: existingCount } = await idempotencyQuery

      if (existingCount && existingCount > 0) {
        console.log(`  ⏭️ Skipping - already consumed for this ${resultId ? 'result' : 'order+test'} (${existingCount} existing transactions)`)
        const result: ConsumeResult = {
          success: true,
          message: 'Already consumed for this result',
          itemsConsumed: 0,
          alertsGenerated: 0,
          skippedReason: 'already_consumed',
        }
        return new Response(
          JSON.stringify(result),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }

    // 3. Deduplicate by item_id (avoid consuming same item twice if mapped at both levels)
    const itemConsumption = new Map<string, {
      item: any
      totalQuantity: number
      mappingLevel: 'test_group' | 'analyte'
      unit: string
    }>()

    for (const mapping of mappingsToProcess) {
      const item = mapping.inventory_items
      const existing = itemConsumption.get(item.id)

      // Convert quantity_per_test (in uses/items) to the item's native unit
      // e.g. if item is tracked in "box" with pack_contains=100,
      // and quantity_per_test=1 (1 item per test), actual deduction = 1/100 = 0.01 box
      let actualDeduction = mapping.quantity_per_test
      const packContains = (item as any).pack_contains
      if (packContains && packContains > 0) {
        actualDeduction = mapping.quantity_per_test / packContains
        console.log(`    📐 Unit conversion: ${mapping.quantity_per_test} uses ÷ ${packContains} per pack = ${actualDeduction} ${item.unit}`)
      }

      if (existing) {
        // Add to existing consumption (multiple analytes may use same item)
        existing.totalQuantity += actualDeduction
      } else {
        itemConsumption.set(item.id, {
          item,
          totalQuantity: actualDeduction,
          mappingLevel: mapping.mapping_level,
          unit: mapping.unit || item.unit,
        })
      }
    }

    // 4. Create consumption transactions with FIFO batch tracking
    const consumedItems: ConsumeResult['consumedItems'] = []
    const transactions: Array<{
      lab_id: string
      item_id: string
      type: 'out'
      quantity: number
      reason: string
      order_id: string
      result_id?: string
      test_group_id: string
      performed_by?: string
      batch_number?: string
      expiry_date?: string
      unit_price?: number
    }> = []

    for (const [itemId, consumption] of itemConsumption) {
      const { item, totalQuantity, mappingLevel, unit } = consumption
      const newStock = item.current_stock - totalQuantity

      // FIFO: fetch oldest batch info for this item
      let batchInfo: { batch_number?: string; expiry_date?: string; unit_price?: number } = {}
      const { data: oldestBatch } = await supabase
        .from('inventory_transactions')
        .select('batch_number, expiry_date, unit_price')
        .eq('item_id', itemId)
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

      transactions.push({
        lab_id: labId,
        item_id: itemId,
        type: 'out',
        quantity: -totalQuantity, // Negative for consumption
        reason: `Test consumption (${mappingLevel})`,
        order_id: orderId,
        result_id: resultId || undefined,
        test_group_id: testGroupId,
        performed_by: userId || undefined,
        ...batchInfo,
      })

      consumedItems.push({
        itemId,
        itemName: item.name,
        quantity: totalQuantity,
        newStock,
        mappingLevel,
      })

      console.log(`    - ${item.name}: -${totalQuantity} ${unit} (${item.current_stock} → ${newStock}) [${mappingLevel}]`)
    }

    // 5. Insert transactions (triggers will update stock and create alerts)
    const { error: insertError } = await supabase
      .from('inventory_transactions')
      .insert(transactions)

    if (insertError) {
      console.error('Error inserting transactions:', insertError)
      return new Response(
        JSON.stringify({ error: 'Failed to create consumption transactions', details: insertError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`  ✅ Created ${transactions.length} test-specific consumption transactions`)

    // 5b. Also consume GENERAL items with consumption_scope = 'per_test'
    // These are items like pipette tips that are used for every test but not mapped specifically
    const { data: generalItems, error: generalError } = await supabase
      .from('inventory_items')
      .select('id, name, current_stock, consumption_per_use, pack_contains, unit')
      .eq('lab_id', labId)
      .eq('consumption_scope', 'per_test')
      .eq('is_active', true)
      .gt('consumption_per_use', 0)
      .gt('current_stock', 0)

    if (!generalError && generalItems && generalItems.length > 0) {
      // Filter out items already consumed via mapping (to avoid double consumption)
      const alreadyConsumedIds = new Set(consumedItems.map(c => c.itemId))
      const generalToConsume = generalItems.filter((gi: any) => !alreadyConsumedIds.has(gi.id))

      if (generalToConsume.length > 0) {
        // FIFO: fetch oldest batch for each general item
        const generalTransactions = await Promise.all(generalToConsume.map(async (gi: any) => {
          const { data: batch } = await supabase
            .from('inventory_transactions')
            .select('batch_number, expiry_date, unit_price')
            .eq('item_id', gi.id)
            .eq('type', 'in')
            .not('batch_number', 'is', null)
            .order('expiry_date', { ascending: true, nullsFirst: false })
            .order('created_at', { ascending: true })
            .limit(1)
            .maybeSingle()

          // Convert consumption_per_use to native unit via pack_contains
          const deduction = gi.pack_contains && gi.pack_contains > 0
            ? gi.consumption_per_use / gi.pack_contains
            : gi.consumption_per_use

          return {
            lab_id: labId,
            item_id: gi.id,
            type: 'out' as const,
            quantity: -deduction,
            reason: 'General test consumption',
            order_id: orderId,
            result_id: resultId || undefined,
            test_group_id: testGroupId,
            performed_by: userId || undefined,
            ...(batch ? {
              batch_number: batch.batch_number,
              expiry_date: batch.expiry_date,
              unit_price: batch.unit_price,
            } : {}),
          }
        }))

        const { error: generalInsertError } = await supabase
          .from('inventory_transactions')
          .insert(generalTransactions)

        if (!generalInsertError) {
          generalToConsume.forEach((gi: any) => {
            const actualDeduction = gi.pack_contains && gi.pack_contains > 0
              ? gi.consumption_per_use / gi.pack_contains
              : gi.consumption_per_use
            consumedItems.push({
              itemId: gi.id,
              itemName: gi.name,
              quantity: actualDeduction,
              newStock: gi.current_stock - actualDeduction,
              mappingLevel: 'test_group', // Mark as general
            })
          })
          console.log(`  ✅ Created ${generalTransactions.length} general item consumption transactions`)
        }
      }
    }

    // 6. Count any alerts that were generated (by the trigger)
    const { count: alertCount } = await supabase
      .from('stock_alerts')
      .select('*', { count: 'exact', head: true })
      .eq('lab_id', labId)
      .eq('status', 'active')
      .gte('created_at', new Date(Date.now() - 5000).toISOString()) // Last 5 seconds

    console.log(`  🔔 ${alertCount || 0} new alerts generated`)

    const result: ConsumeResult = {
      success: true,
      message: `Consumed ${consumedItems.length} items (${transactions.length} mapped + ${consumedItems.length - transactions.length} general)`,
      itemsConsumed: consumedItems.length,
      alertsGenerated: alertCount || 0,
      consumedItems,
    }

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: any) {
    console.error('Auto-consume error:', error)
    return new Response(
      JSON.stringify({ error: 'Auto-consumption failed', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
