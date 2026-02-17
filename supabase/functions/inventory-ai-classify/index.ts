// ============================================================================
// AI Inventory Classification - Phase 1
// Classifies inventory items WITHOUT test context
//
// Input: Batch of items (max 10)
// Output: Classification for each item:
//   - category: qc_control | test_specific | general
//   - suggested_tests: string[] (common test names AI infers)
//   - consumption_hint: string (e.g., "1 kit = 100 tests")
//   - confidence: number (0-1)
// ============================================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface InventoryItem {
  id: string;
  name: string;
  code?: string;
  type: string;
  unit: string;
  current_stock: number;
  primary_mapping_instruction?: string;
}

interface ClassificationResult {
  item_id: string;
  category: 'qc_control' | 'test_specific' | 'general';
  suggested_tests: string[];
  consumption_hint: string;
  confidence: number;
  reasoning: string;
}

interface ClassifyRequest {
  lab_id: string;
  items?: InventoryItem[];
  batch_size?: number;
}

// Call Gemini for classification
async function classifyWithGemini(
  items: InventoryItem[],
  apiKey: string
): Promise<ClassificationResult[]> {
  const itemDescriptions = items.map((item, idx) => {
    let desc = `${idx + 1}. "${item.name}"`;
    if (item.code) desc += ` (Code: ${item.code})`;
    desc += ` - Type: ${item.type}, Unit: ${item.unit}`;
    if (item.primary_mapping_instruction) {
      desc += ` - User hint: "${item.primary_mapping_instruction}"`;
    }
    return desc;
  }).join('\n');

  const prompt = `You are an expert in diagnostic laboratory inventory management. Classify each inventory item into one of three categories and provide additional context.

## Items to Classify:
${itemDescriptions}

## Classification Categories:

1. **qc_control** - Quality control materials, calibrators, control sera, reference materials
   - Examples: Control Serum L1, Calibrator Set, QC Material, Reference Standard
   - These are used for QC runs, not patient tests

2. **test_specific** - Reagents, kits, and consumables used for specific diagnostic tests
   - Examples: TSH Reagent Kit, CBC Reagent, Glucose Test Strips, HbA1c Kit
   - These are consumed when performing specific tests

3. **general** - General lab consumables NOT tied to specific tests
   - Examples: Printer Paper, Gloves, Labels, Sanitizer, Office Supplies
   - These are general operational items

## For Each Item, Provide:
1. category: qc_control | test_specific | general
2. suggested_tests: Array of common test names this item might be used for (empty for qc_control and general)
3. consumption_hint: How this item is typically consumed (e.g., "1 kit = 100 tests", "1 per sample", "general use")
4. confidence: 0.0 to 1.0 confidence in classification
5. reasoning: Brief explanation

## Response Format (JSON array):
[
  {
    "item_index": 1,
    "category": "test_specific",
    "suggested_tests": ["TSH", "Thyroid Function Test", "T3", "T4"],
    "consumption_hint": "1 kit = 100 tests",
    "confidence": 0.95,
    "reasoning": "TSH reagent kit is clearly for thyroid function testing"
  }
]

Respond ONLY with the JSON array, no other text.`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 4096,
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

  const classifications = JSON.parse(jsonMatch[0]);

  // Map back to item IDs
  return classifications.map((c: any) => ({
    item_id: items[c.item_index - 1].id,
    category: c.category,
    suggested_tests: c.suggested_tests || [],
    consumption_hint: c.consumption_hint || '',
    confidence: c.confidence || 0.8,
    reasoning: c.reasoning || '',
  }));
}

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { lab_id, items: providedItems, batch_size = 10 }: ClassifyRequest = await req.json();

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

    let items: InventoryItem[];

    if (providedItems && providedItems.length > 0) {
      // Use provided items
      items = providedItems.slice(0, batch_size);
    } else {
      // Fetch items pending classification
      const { data: fetchedItems, error: fetchError } = await supabase
        .rpc('fn_inventory_get_batch_for_classification', {
          p_lab_id: lab_id,
          p_batch_size: batch_size,
        });

      if (fetchError) throw fetchError;

      if (!fetchedItems || fetchedItems.length === 0) {
        return new Response(
          JSON.stringify({
            success: true,
            message: 'No items pending classification',
            classified: 0,
            results: [],
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      items = fetchedItems;
    }

    console.log(`Classifying ${items.length} items for lab ${lab_id}`);

    // Classify with Gemini
    const classifications = await classifyWithGemini(items, geminiApiKey);

    // Update each item in database
    const results: any[] = [];
    for (const classification of classifications) {
      const { error: updateError } = await supabase.rpc('fn_inventory_update_classification', {
        p_item_id: classification.item_id,
        p_category: classification.category,
        p_suggested_tests: classification.suggested_tests,
        p_consumption_hint: classification.consumption_hint,
        p_confidence: classification.confidence,
      });

      if (updateError) {
        console.error(`Error updating item ${classification.item_id}:`, updateError);
        results.push({
          ...classification,
          updated: false,
          error: updateError.message,
        });
      } else {
        results.push({
          ...classification,
          updated: true,
        });
      }
    }

    // Count by category
    const categoryCounts = {
      qc_control: results.filter(r => r.category === 'qc_control').length,
      test_specific: results.filter(r => r.category === 'test_specific').length,
      general: results.filter(r => r.category === 'general').length,
    };

    return new Response(
      JSON.stringify({
        success: true,
        classified: results.length,
        categories: categoryCounts,
        results,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Classification error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'Classification failed',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
