// ============================================================================
// Voice-to-Inventory - Ephemeral voice input for quick stock updates
//
// Supported commands:
// - "Add 5 boxes CBC reagent batch ABC123"
// - "Remove 2 pipette tips"
// - "Set TSH kit stock to 10"
// - "5 boxes glucose strips expiring March 2026"
// ============================================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface InventoryAction {
  action: 'add' | 'remove' | 'set';
  item_name: string;
  quantity: number;
  unit?: string;
  batch_number?: string;
  expiry_date?: string;
  reason?: string;
  confidence: number;
}

interface VoiceToInventoryRequest {
  audio_base64: string;
  mime_type: string;
  lab_id: string;
  existing_items?: Array<{ id: string; name: string; code?: string; unit: string }>;
}

// Call Gemini with audio for transcription and extraction
async function processAudioWithGemini(
  audioBase64: string,
  mimeType: string,
  existingItems: Array<{ id: string; name: string; code?: string; unit: string }>,
  apiKey: string
): Promise<{ transcript: string; actions: InventoryAction[] }> {
  // Build context of existing items
  const itemsList = existingItems.slice(0, 100).map(i =>
    `- ${i.name}${i.code ? ` (${i.code})` : ''} [unit: ${i.unit}]`
  ).join('\n');

  const prompt = `You are a diagnostic lab inventory assistant. Transcribe this audio and extract inventory stock update commands.

## Existing Inventory Items:
${itemsList || 'No existing items'}

## Your Task:
1. Transcribe the spoken audio exactly
2. Extract inventory actions from the speech

## Supported Actions:
- **add**: Add stock (e.g., "Add 5 boxes of CBC reagent")
- **remove**: Remove/use stock (e.g., "Remove 2 pipette tips")
- **set**: Set exact stock level (e.g., "Set glucose strips to 10")

## Extract These Fields:
- action: add | remove | set
- item_name: Match to existing items when possible, otherwise use spoken name
- quantity: The number mentioned
- unit: box, pcs, ml, kit, etc. (default to item's existing unit)
- batch_number: If mentioned (e.g., "batch ABC123")
- expiry_date: If mentioned (e.g., "expiring March 2026" → "2026-03")
- reason: Any reason mentioned (e.g., "damaged", "expired", "purchase")
- confidence: 0.0-1.0 how confident you are

## Response Format (JSON):
{
  "transcript": "exact transcription of audio",
  "actions": [
    {
      "action": "add",
      "item_name": "CBC Reagent Kit",
      "quantity": 5,
      "unit": "box",
      "batch_number": "ABC123",
      "expiry_date": "2026-03",
      "reason": "Purchase from supplier",
      "confidence": 0.95
    }
  ]
}

## Rules:
- If multiple items mentioned, return multiple actions
- Match item names to existing items when clearly referring to them
- Return empty actions array if no inventory commands detected
- Include batch/expiry only if explicitly mentioned

Respond ONLY with JSON, no other text.`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            {
              inline_data: {
                mime_type: mimeType,
                data: audioBase64,
              },
            },
            { text: prompt },
          ],
        }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 2048,
        },
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Gemini API error:', errorText);
    throw new Error(`Gemini API error: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

  // Extract JSON from response
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.error('No JSON found in response:', text);
    return { transcript: text, actions: [] };
  }

  try {
    const result = JSON.parse(jsonMatch[0]);
    return {
      transcript: result.transcript || '',
      actions: result.actions || [],
    };
  } catch (e) {
    console.error('JSON parse error:', e);
    return { transcript: text, actions: [] };
  }
}

// Match extracted item to existing items
function matchToExistingItem(
  itemName: string,
  existingItems: Array<{ id: string; name: string; code?: string; unit: string }>
): { id: string; name: string; unit: string } | null {
  const searchLower = itemName.toLowerCase();

  // Exact match first
  const exactMatch = existingItems.find(
    i => i.name.toLowerCase() === searchLower ||
         i.code?.toLowerCase() === searchLower
  );
  if (exactMatch) return exactMatch;

  // Partial match
  const partialMatch = existingItems.find(
    i => i.name.toLowerCase().includes(searchLower) ||
         searchLower.includes(i.name.toLowerCase()) ||
         i.code?.toLowerCase().includes(searchLower)
  );
  if (partialMatch) return partialMatch;

  return null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { audio_base64, mime_type, lab_id, existing_items = [] }: VoiceToInventoryRequest = await req.json();

    if (!audio_base64 || !lab_id) {
      throw new Error('audio_base64 and lab_id are required');
    }

    const geminiApiKey = Deno.env.get('ALLGOOGLE_KEY') || Deno.env.get('GEMINI_API_KEY');
    if (!geminiApiKey) {
      throw new Error('ALLGOOGLE_KEY or GEMINI_API_KEY not configured');
    }

    console.log(`Processing voice for inventory, lab: ${lab_id}`);

    // Process audio with Gemini
    const { transcript, actions } = await processAudioWithGemini(
      audio_base64,
      mime_type || 'audio/webm',
      existing_items,
      geminiApiKey
    );

    // Match actions to existing items
    const matchedActions = actions.map(action => {
      const match = matchToExistingItem(action.item_name, existing_items);
      return {
        ...action,
        matched_item_id: match?.id || null,
        matched_item_name: match?.name || action.item_name,
        unit: action.unit || match?.unit || 'pcs',
        is_new_item: !match,
      };
    });

    return new Response(
      JSON.stringify({
        success: true,
        transcript,
        actions: matchedActions,
        actions_count: matchedActions.length,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Voice-to-inventory error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'Processing failed',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
