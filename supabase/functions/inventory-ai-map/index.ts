// ============================================================================
// AI Inventory Mapping - Phase 2
// Maps classified items to actual test_groups with consumption rules
//
// Input: Classified items (test_specific or qc_control category)
// Context: test_groups, qc_lots from database
// Output: Mappings to test_groups, consumption rules, QC lot links
// ============================================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ClassifiedItem {
  id: string;
  name: string;
  code?: string;
  type: string;
  unit: string;
  current_stock: number;
  ai_category: string;
  ai_suggested_tests: string[];
  ai_consumption_hint: string;
  primary_mapping_instruction?: string;
  consumption_scope?: string;
  consumption_per_use?: number;
  pack_contains?: number;
}

interface TestGroup {
  id: string;
  name: string;
  code?: string;
  department?: string;
  methodology?: string;
}

interface QCLot {
  id: string;
  lot_number: string;
  material_name: string;
  manufacturer?: string;
  lot_type: string;
  level?: string;
}

interface MappingResult {
  item_id: string;
  item_name: string;
  mappings: Array<{
    test_group_id: string;
    test_group_name: string;
    quantity_per_test: number;
    confidence: number;
    reasoning: string;
  }>;
  consumption_rule: {
    scope: string;
    per_use: number;
    pack_contains: number | null;
  };
  qc_lot_link?: {
    qc_lot_id: string;
    lot_number: string;
    confidence: number;
  };
}

interface MapRequest {
  lab_id: string;
  item_ids?: string[];
  batch_size?: number;
}

// Call Gemini for mapping
async function mapWithGemini(
  items: ClassifiedItem[],
  testGroups: TestGroup[],
  qcLots: QCLot[],
  apiKey: string
): Promise<MappingResult[]> {
  // Build context strings
  const testGroupList = testGroups.map(tg => {
    let desc = `- "${tg.name}"`;
    if (tg.code) desc += ` (${tg.code})`;
    if (tg.department) desc += ` [${tg.department}]`;
    if (tg.methodology) desc += ` - ${tg.methodology}`;
    desc += ` | ID: ${tg.id}`;
    return desc;
  }).join('\n');

  const qcLotList = qcLots.map(lot => {
    let desc = `- "${lot.material_name}" (Lot: ${lot.lot_number})`;
    if (lot.manufacturer) desc += ` by ${lot.manufacturer}`;
    desc += ` | Type: ${lot.lot_type}`;
    if (lot.level) desc += ` | Level: ${lot.level}`;
    desc += ` | ID: ${lot.id}`;
    return desc;
  }).join('\n');

  const itemDescriptions = items.map((item, idx) => {
    let desc = `${idx + 1}. "${item.name}"`;
    if (item.code) desc += ` (Code: ${item.code})`;
    desc += `\n   Category: ${item.ai_category}`;
    desc += `\n   Type: ${item.type}, Unit: ${item.unit}, Stock: ${item.current_stock}`;
    if (item.ai_suggested_tests?.length > 0) {
      desc += `\n   AI Suggested Tests: ${item.ai_suggested_tests.join(', ')}`;
    }
    if (item.ai_consumption_hint) {
      desc += `\n   Consumption Hint: ${item.ai_consumption_hint}`;
    }
    if (item.primary_mapping_instruction) {
      desc += `\n   User Instruction: "${item.primary_mapping_instruction}"`;
    }
    return desc;
  }).join('\n\n');

  const prompt = `You are an expert in diagnostic laboratory inventory-to-test mapping. Your task is to:
1. Map inventory items to the correct test groups
2. Set consumption rules (how much is used per test)
3. Link QC items to their corresponding QC lots

## Available Test Groups:
${testGroupList || 'No test groups available'}

## Available QC Lots:
${qcLotList || 'No QC lots available'}

## Items to Map:
${itemDescriptions}

## Mapping Rules:

### For test_specific items:
- Match to relevant test_groups based on name, methodology, reagent type
- Set quantity_per_test (usually 1 for kits, may vary for reagents)
- Determine consumption_scope: "per_test" for most reagents/kits
- Calculate pack_contains if item is a kit (e.g., "100 test kit" → pack_contains: 100)
- consumption_per_use is typically 1 for discrete items, or actual amount for liquid reagents

### For qc_control items:
- consumption_scope: "manual" (QC consumption tracked separately)
- Try to match to a QC lot based on name/material similarity
- Map to test groups that this QC validates

### Consumption Rule Logic:
- If unit is "kit", "box", "pack" and contains X tests → pack_contains: X, per_use: 1/X (or 1)
- If unit is "ml", "L" → pack_contains: null, per_use: amount per test
- If unit is "pcs", "test" → pack_contains: null, per_use: 1

## Response Format (JSON array):
[
  {
    "item_index": 1,
    "item_id": "uuid-here",
    "mappings": [
      {
        "test_group_id": "uuid-of-test",
        "test_group_name": "Test Name",
        "quantity_per_test": 1,
        "confidence": 0.9,
        "reasoning": "TSH reagent directly maps to TSH test"
      }
    ],
    "consumption_rule": {
      "scope": "per_test",
      "per_use": 1,
      "pack_contains": 100
    },
    "qc_lot_link": {
      "qc_lot_id": "uuid-of-lot",
      "lot_number": "LOT123",
      "confidence": 0.85
    }
  }
]

Notes:
- qc_lot_link is only for qc_control items (null for test_specific)
- mappings can be empty if no clear match
- Provide multiple mappings if item is used for multiple tests
- Be conservative with confidence scores

Respond ONLY with the JSON array, no other text.`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 8192,
        },
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Gemini API error:', errorText);
    throw new Error(`Gemini API error: ${response.status}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

  // Extract JSON from response
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    console.error('No JSON found in response:', text);
    throw new Error('Failed to parse Gemini response');
  }

  const results = JSON.parse(jsonMatch[0]);

  // Map back with item names
  return results.map((r: any) => ({
    item_id: items[r.item_index - 1]?.id || r.item_id,
    item_name: items[r.item_index - 1]?.name || 'Unknown',
    mappings: r.mappings || [],
    consumption_rule: r.consumption_rule || { scope: 'manual', per_use: 1, pack_contains: null },
    qc_lot_link: r.qc_lot_link || null,
  }));
}

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { lab_id, item_ids, batch_size = 10 }: MapRequest = await req.json();

    if (!lab_id) {
      throw new Error('lab_id is required');
    }

    // Get API key
    const geminiApiKey = Deno.env.get('GEMINI_API_KEY');
    if (!geminiApiKey) {
      throw new Error('GEMINI_API_KEY not configured');
    }

    // Create Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch items to map
    let query = supabase
      .from('inventory_items')
      .select('*')
      .eq('lab_id', lab_id)
      .eq('is_active', true)
      .in('ai_category', ['test_specific', 'qc_control'])
      .eq('ai_classification_status', 'classified');

    if (item_ids && item_ids.length > 0) {
      query = query.in('id', item_ids);
    } else {
      query = query.limit(batch_size);
    }

    const { data: items, error: itemsError } = await query;
    if (itemsError) throw itemsError;

    if (!items || items.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: 'No items pending mapping',
          mapped: 0,
          results: [],
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Mapping ${items.length} items for lab ${lab_id}`);

    // Fetch test groups
    const { data: testGroups, error: tgError } = await supabase
      .from('test_groups')
      .select('id, name, code, department, methodology')
      .eq('lab_id', lab_id)
      .eq('is_active', true)
      .limit(200);

    if (tgError) throw tgError;

    // Fetch QC lots
    const { data: qcLots, error: qcError } = await supabase
      .from('qc_lots')
      .select('id, lot_number, material_name, manufacturer, lot_type, level')
      .eq('lab_id', lab_id)
      .eq('is_active', true)
      .limit(100);

    if (qcError) throw qcError;

    console.log(`Context: ${testGroups?.length || 0} test groups, ${qcLots?.length || 0} QC lots`);

    // Map with Gemini
    const mappingResults = await mapWithGemini(
      items as ClassifiedItem[],
      testGroups || [],
      qcLots || [],
      geminiApiKey
    );

    // Process results and update database
    const processedResults: any[] = [];
    let totalMappings = 0;
    let qcLinksCreated = 0;

    for (const result of mappingResults) {
      const processedItem: any = {
        item_id: result.item_id,
        item_name: result.item_name,
        mappings_created: 0,
        qc_lot_linked: false,
        consumption_updated: false,
        errors: [],
      };

      // Update consumption rules on the item
      const { error: updateError } = await supabase
        .from('inventory_items')
        .update({
          consumption_scope: result.consumption_rule.scope,
          consumption_per_use: result.consumption_rule.per_use,
          pack_contains: result.consumption_rule.pack_contains,
          updated_at: new Date().toISOString(),
        })
        .eq('id', result.item_id);

      if (updateError) {
        processedItem.errors.push(`Failed to update consumption: ${updateError.message}`);
      } else {
        processedItem.consumption_updated = true;
        processedItem.consumption_rule = result.consumption_rule;
      }

      // Create test mappings
      for (const mapping of result.mappings) {
        if (!mapping.test_group_id) continue;

        const { error: mapError } = await supabase.rpc('fn_inventory_create_ai_mapping', {
          p_lab_id: lab_id,
          p_item_id: result.item_id,
          p_test_group_id: mapping.test_group_id,
          p_analyte_id: null,
          p_quantity_per_test: mapping.quantity_per_test,
          p_confidence: mapping.confidence,
          p_reasoning: mapping.reasoning,
        });

        if (mapError) {
          // Duplicate means mapping already exists; treat as non-fatal/idempotent.
          if ((mapError as any)?.code === '23505' || `${mapError.message || ''}`.toLowerCase().includes('duplicate key')) {
            processedItem.errors.push(`Mapping to ${mapping.test_group_name}: already exists`);
          } else {
            processedItem.errors.push(`Mapping to ${mapping.test_group_name}: ${mapError.message}`);
          }
        } else {
          processedItem.mappings_created++;
          totalMappings++;
        }
      }

      // Link QC lot if applicable
      if (result.qc_lot_link?.qc_lot_id) {
        const { error: linkError } = await supabase.rpc('fn_inventory_link_qc_lot', {
          p_item_id: result.item_id,
          p_qc_lot_id: result.qc_lot_link.qc_lot_id,
        });

        if (linkError) {
          processedItem.errors.push(`QC link: ${linkError.message}`);
        } else {
          processedItem.qc_lot_linked = true;
          processedItem.qc_lot = result.qc_lot_link;
          qcLinksCreated++;
        }
      }

      processedResults.push(processedItem);
    }

    return new Response(
      JSON.stringify({
        success: true,
        items_processed: items.length,
        total_mappings_created: totalMappings,
        qc_links_created: qcLinksCreated,
        results: processedResults,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Mapping error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'Mapping failed',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
