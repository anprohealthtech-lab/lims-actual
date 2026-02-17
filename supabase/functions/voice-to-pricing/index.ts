// ============================================================================
// Voice-to-Pricing - Ephemeral voice input for doctor sharing & outsourced pricing
//
// Modes:
// 1. doctor_sharing: "Set Dr. Kumar sharing to 20 percent"
// 2. outsourced_pricing: "CBC cost from Metropolis is 150 rupees"
// 3. test_pricing: "Set TSH price to 500 rupees"
// ============================================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Mode-specific types
interface DoctorSharingAction {
  doctor_name: string;
  sharing_percent?: number;
  discount_handling?: 'no_adjustment' | 'exclude_from_base' | 'deduct_from_commission' | 'split_50_50';
  outsource_handling?: 'no_adjustment' | 'exclude_from_base' | 'deduct_from_commission';
  test_name?: string; // For test-specific overrides
  test_sharing_percent?: number;
  confidence: number;
}

interface OutsourcedPricingAction {
  test_name: string;
  lab_name?: string;
  cost: number;
  currency?: string;
  confidence: number;
}

interface TestPricingAction {
  test_name: string;
  price: number;
  location_name?: string;
  currency?: string;
  confidence: number;
}

interface VoiceToPricingRequest {
  audio_base64: string;
  mime_type: string;
  lab_id: string;
  mode: 'doctor_sharing' | 'outsourced_pricing' | 'test_pricing';
  context?: {
    doctors?: Array<{ id: string; name: string }>;
    outsourced_labs?: Array<{ id: string; name: string }>;
    tests?: Array<{ id: string; name: string; code?: string }>;
    locations?: Array<{ id: string; name: string }>;
  };
}

// Build prompt based on mode
function buildPrompt(
  mode: string,
  context: VoiceToPricingRequest['context']
): string {
  const baseInstructions = `You are a diagnostic lab pricing assistant. Transcribe this audio and extract pricing/sharing configuration commands.`;

  if (mode === 'doctor_sharing') {
    const doctorsList = context?.doctors?.slice(0, 50).map(d => `- ${d.name}`).join('\n') || 'No doctors listed';
    const testsList = context?.tests?.slice(0, 50).map(t => `- ${t.name}${t.code ? ` (${t.code})` : ''}`).join('\n') || '';

    return `${baseInstructions}

## Available Doctors:
${doctorsList}

## Available Tests (for test-specific sharing):
${testsList}

## Supported Commands:
- Set default sharing percentage: "Set Dr. Kumar sharing to 20 percent"
- Set test-specific sharing: "Dr. Patel gets 25 percent for CBC"
- Set discount handling: "Dr. Kumar discount handling is deduct from commission"
- Set outsource handling: "Exclude outsource cost for Dr. Sharma"
- Multiple: "Dr. Kumar 20 percent, Dr. Patel 15 percent"

## Extract Fields:
- doctor_name: Match to available doctors
- sharing_percent: 0-100 (supports decimals like 0.5)
- discount_handling: no_adjustment | exclude_from_base | deduct_from_commission | split_50_50
- outsource_handling: no_adjustment | exclude_from_base | deduct_from_commission
- test_name: For test-specific overrides
- test_sharing_percent: Override percent for specific test
- confidence: 0.0-1.0

## Response Format (JSON):
{
  "transcript": "exact transcription",
  "actions": [
    {
      "doctor_name": "Dr. Kumar",
      "sharing_percent": 20,
      "discount_handling": null,
      "outsource_handling": null,
      "test_name": null,
      "test_sharing_percent": null,
      "confidence": 0.95
    }
  ]
}

Respond ONLY with JSON.`;
  }

  if (mode === 'outsourced_pricing') {
    const labsList = context?.outsourced_labs?.slice(0, 30).map(l => `- ${l.name}`).join('\n') || 'No labs listed';
    const testsList = context?.tests?.slice(0, 100).map(t => `- ${t.name}${t.code ? ` (${t.code})` : ''}`).join('\n') || '';

    return `${baseInstructions}

## Available Outsourced Labs:
${labsList}

## Available Tests:
${testsList}

## Supported Commands:
- "CBC cost from Metropolis is 150 rupees"
- "TSH test costs 200 from SRL"
- "Vitamin D 350 rupees outsourced to Thyrocare"
- Multiple: "CBC 150, TSH 200, Lipid Profile 400 all from Metropolis"

## Extract Fields:
- test_name: Match to available tests
- lab_name: Match to available labs (optional if lab is implied)
- cost: Numeric cost in rupees
- currency: INR (default)
- confidence: 0.0-1.0

## Response Format (JSON):
{
  "transcript": "exact transcription",
  "actions": [
    {
      "test_name": "CBC",
      "lab_name": "Metropolis",
      "cost": 150,
      "currency": "INR",
      "confidence": 0.95
    }
  ]
}

Respond ONLY with JSON.`;
  }

  if (mode === 'test_pricing') {
    const testsList = context?.tests?.slice(0, 100).map(t => `- ${t.name}${t.code ? ` (${t.code})` : ''}`).join('\n') || '';
    const locationsList = context?.locations?.slice(0, 20).map(l => `- ${l.name}`).join('\n') || '';

    return `${baseInstructions}

## Available Tests:
${testsList}

## Available Locations:
${locationsList}

## Supported Commands:
- "Set TSH price to 500 rupees"
- "CBC is 350 at Main Lab"
- "Update Lipid Profile to 800"
- Multiple: "CBC 350, TSH 500, Thyroid Profile 1200"

## Extract Fields:
- test_name: Match to available tests
- price: Numeric price in rupees
- location_name: Specific location (optional)
- currency: INR (default)
- confidence: 0.0-1.0

## Response Format (JSON):
{
  "transcript": "exact transcription",
  "actions": [
    {
      "test_name": "TSH",
      "price": 500,
      "location_name": null,
      "currency": "INR",
      "confidence": 0.95
    }
  ]
}

Respond ONLY with JSON.`;
  }

  return baseInstructions;
}

// Process audio with Gemini
async function processAudioWithGemini(
  audioBase64: string,
  mimeType: string,
  mode: string,
  context: VoiceToPricingRequest['context'],
  apiKey: string
): Promise<{ transcript: string; actions: any[] }> {
  const prompt = buildPrompt(mode, context);

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

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.error('No JSON found:', text);
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

// Match names to context entities
function matchToEntity(
  name: string,
  entities: Array<{ id: string; name: string; code?: string }> | undefined
): { id: string; name: string } | null {
  if (!entities || !name) return null;

  const searchLower = name.toLowerCase().trim();

  // Exact match
  const exact = entities.find(e =>
    e.name.toLowerCase() === searchLower ||
    e.code?.toLowerCase() === searchLower
  );
  if (exact) return exact;

  // Partial match
  const partial = entities.find(e =>
    e.name.toLowerCase().includes(searchLower) ||
    searchLower.includes(e.name.toLowerCase())
  );
  if (partial) return partial;

  // Word-based match for doctor names
  const words = searchLower.split(/\s+/);
  const wordMatch = entities.find(e => {
    const entityWords = e.name.toLowerCase().split(/\s+/);
    return words.some(w => entityWords.some(ew => ew.includes(w) || w.includes(ew)));
  });

  return wordMatch || null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const {
      audio_base64,
      mime_type,
      lab_id,
      mode,
      context = {},
    }: VoiceToPricingRequest = await req.json();

    if (!audio_base64 || !lab_id || !mode) {
      throw new Error('audio_base64, lab_id, and mode are required');
    }

    if (!['doctor_sharing', 'outsourced_pricing', 'test_pricing'].includes(mode)) {
      throw new Error('Invalid mode. Use: doctor_sharing, outsourced_pricing, or test_pricing');
    }

    const geminiApiKey = Deno.env.get('GEMINI_API_KEY');
    if (!geminiApiKey) {
      throw new Error('GEMINI_API_KEY not configured');
    }

    console.log(`Processing voice for ${mode}, lab: ${lab_id}`);

    // Process audio
    const { transcript, actions } = await processAudioWithGemini(
      audio_base64,
      mime_type || 'audio/webm',
      mode,
      context,
      geminiApiKey
    );

    // Match entities based on mode
    const matchedActions = actions.map(action => {
      if (mode === 'doctor_sharing') {
        const doctorMatch = matchToEntity(action.doctor_name, context.doctors);
        const testMatch = action.test_name
          ? matchToEntity(action.test_name, context.tests)
          : null;

        return {
          ...action,
          matched_doctor_id: doctorMatch?.id || null,
          matched_doctor_name: doctorMatch?.name || action.doctor_name,
          matched_test_id: testMatch?.id || null,
          matched_test_name: testMatch?.name || action.test_name,
        };
      }

      if (mode === 'outsourced_pricing') {
        const testMatch = matchToEntity(action.test_name, context.tests);
        const labMatch = matchToEntity(action.lab_name, context.outsourced_labs);

        return {
          ...action,
          matched_test_id: testMatch?.id || null,
          matched_test_name: testMatch?.name || action.test_name,
          matched_lab_id: labMatch?.id || null,
          matched_lab_name: labMatch?.name || action.lab_name,
        };
      }

      if (mode === 'test_pricing') {
        const testMatch = matchToEntity(action.test_name, context.tests);
        const locationMatch = matchToEntity(action.location_name, context.locations);

        return {
          ...action,
          matched_test_id: testMatch?.id || null,
          matched_test_name: testMatch?.name || action.test_name,
          matched_location_id: locationMatch?.id || null,
          matched_location_name: locationMatch?.name || action.location_name,
        };
      }

      return action;
    });

    return new Response(
      JSON.stringify({
        success: true,
        mode,
        transcript,
        actions: matchedActions,
        actions_count: matchedActions.length,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Voice-to-pricing error:', error);
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
