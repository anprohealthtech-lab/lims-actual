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

// Call Anthropic Claude for mapping
async function mapWithAnthropic(
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

  const prompt = `Map inventory items to test groups.

TEST GROUPS: ${testGroupList || 'None'}
QC LOTS: ${qcLotList || 'None'}

ITEMS:
${itemDescriptions}

RULES:
- test_specific → map to test_groups, scope="per_test"
- qc_control → map to test_groups, scope="manual", link to QC lots

OUTPUT JSON ONLY:
[
  {
    "item_index": 1,
    "mappings": [{"test_group_id": "uuid", "test_group_name": "Name", "quantity_per_test": 1, "confidence": 0.9, "reasoning": "reason"}],
    "consumption_rule": {"scope": "per_test", "per_use": 1, "pack_contains": null},
    "qc_lot_link": {"qc_lot_id": "uuid", "lot_number": "LOT123", "confidence": 0.8}
  }
]`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 16384,
      temperature: 0.2,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Anthropic API error:', errorText);
    throw new Error(`Anthropic API error: ${response.status}`);
  }

  const data = await response.json();
  let text = data.content?.[0]?.text || '';

  // Extract JSON from response - handle various formats
  let jsonText = '';

  // First, try to extract content from markdown code blocks
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch) {
    text = codeBlockMatch[1].trim();
  } else {
    // If no code blocks found, try to remove any leading/trailing markdown
    text = text.replace(/^```(?:json)?\s*/m, '').replace(/\s*```$/m, '').trim();
  }

  // Now find the JSON array in the cleaned text
  const startBracket = text.indexOf('[');
  if (startBracket !== -1) {
    let bracketCount = 0;
    let inString = false;
    let escapeNext = false;

    for (let i = startBracket; i < text.length; i++) {
      const char = text[i];

      if (escapeNext) {
        escapeNext = false;
        continue;
      }

      if (char === '\\') {
        escapeNext = true;
        continue;
      }

      if (char === '"') {
        inString = !inString;
        continue;
      }

      if (!inString) {
        if (char === '[') bracketCount++;
        else if (char === ']') bracketCount--;

        if (bracketCount === 0) {
          jsonText = text.substring(startBracket, i + 1);
          break;
        }
      }
    }
  }

  // If bracket matching failed, try a simpler approach
  if (!jsonText) {
    const simpleMatch = text.match(/\[[\s\S]*\]/);
    if (simpleMatch) {
      jsonText = simpleMatch[0];
    }
  }

  if (!jsonText) {
    console.error('No JSON found in response. Full response length:', text.length);
    console.error('First 500 chars:', text.substring(0, 500));
    console.error('Last 500 chars:', text.substring(Math.max(0, text.length - 500)));
    throw new Error('Failed to find JSON in Anthropic response');
  }

  // Clean up any remaining artifacts
  jsonText = jsonText
    .replace(/^\s*[\r\n]+/gm, '') // Remove leading/trailing whitespace
    .replace(/\s*[\r\n]+\s*$/gm, '')
    .trim();

  // Try to fix common JSON issues
  jsonText = jsonText
    .replace(/,\s*}/g, '}') // Remove trailing commas before }
    .replace(/,\s*]/g, ']') // Remove trailing commas before ]
    .replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":'); // Quote unquoted keys

  let results;
  try {
    results = JSON.parse(jsonText);
  } catch (parseError: any) {
    console.error('JSON parse error:', parseError.message);
    console.error('Error position:', parseError.message.match(/position (\d+)/)?.[1]);
    console.error('JSON text length:', jsonText.length);
    console.error('JSON text around error (chars 820-840):', jsonText.substring(820, 840));
    console.error('JSON text (first 1000 chars):', jsonText.substring(0, 1000));

    // Try to extract partial results if possible
    try {
      // Try to find the last complete object in the array
      const lastCompleteObjectMatch = jsonText.match(/(\{[\s\S]*?\})(?=\s*,\s*\{|\s*\])/g);
      if (lastCompleteObjectMatch && lastCompleteObjectMatch.length > 0) {
        const lastCompleteObject = lastCompleteObjectMatch[lastCompleteObjectMatch.length - 1];
        const partialArray = '[' + lastCompleteObject + ']';
        results = JSON.parse(partialArray);
        console.log('Successfully parsed partial results, length:', results.length);
      } else {
        // Try to fix common truncation issues
        const fixedJson = jsonText
          .replace(/,\s*$/, '') // Remove trailing comma
          .replace(/\{\s*$/, '') // Remove incomplete object start
          .replace(/\[\s*$/, '') // Remove incomplete array start
          + ']}'; // Add closing brackets

        results = JSON.parse(fixedJson);
        console.log('Successfully parsed fixed truncated JSON, length:', results.length);
      }
    } catch (partialError) {
      console.error('Partial parsing also failed:', partialError.message);
      throw new Error(`Invalid JSON from Anthropic: ${parseError.message}. JSON length: ${jsonText.length}`);
    }
  }

  // Ensure results is an array
  if (!Array.isArray(results)) {
    console.error('Anthropic response is not an array:', typeof results, results);
    throw new Error('Anthropic response must be a JSON array');
  }

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
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY not configured');
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

    // Map with Anthropic Claude
    const mappingResults = await mapWithAnthropic(
      items as ClassifiedItem[],
      testGroups || [],
      qcLots || [],
      apiKey
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
          console.error('inventory-ai-map mapping RPC failed', {
            item_id: result.item_id,
            test_group_id: mapping.test_group_id,
            test_group_name: mapping.test_group_name,
            error: mapError,
          });

          const isDuplicate = (mapError as any)?.code === '23505'
            || `${mapError.message || ''}`.toLowerCase().includes('duplicate key');

          if (isDuplicate) {
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

      const sourceItem = items.find((item) => item.id === result.item_id) as any;
      const shouldAutoConsumeViaTest = sourceItem?.ai_category === 'test_specific' && processedItem.mappings_created > 0;
      const forcedScope = sourceItem?.ai_category === 'qc_control'
        ? 'qc_only'
        : (shouldAutoConsumeViaTest ? 'per_test' : 'manual');

      // Only enable production auto-consumption when the item was actually mapped.
      const { error: updateError } = await supabase
        .from('inventory_items')
        .update({
          consumption_scope: forcedScope,
          consumption_per_use: shouldAutoConsumeViaTest
            ? result.consumption_rule.per_use
            : null,
          pack_contains: result.consumption_rule.pack_contains,
          updated_at: new Date().toISOString(),
        })
        .eq('id', result.item_id);

      if (updateError) {
        processedItem.errors.push(`Failed to update consumption: ${updateError.message}`);
      } else {
        processedItem.consumption_updated = true;
        processedItem.consumption_rule = {
          ...result.consumption_rule,
          scope: forcedScope,
        };
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
