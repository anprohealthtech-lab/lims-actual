import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const CLAUDE_HAIKU_MODEL = 'claude-haiku-4-5-20251001'

type HelperAction = 'layout_order' | 'dropdown_values'

interface HelperRequest {
  action: HelperAction
  test_group: {
    name?: string
    code?: string
    category?: string
    sample_type?: string
  }
  analytes: Array<{
    analyte_id: string
    lab_analyte_id?: string | null
    name: string
    code?: string | null
    unit?: string | null
    category?: string | null
    sample_type?: string | null
    value_type?: string | null
    expected_normal_values?: string[]
    reference_range?: string | null
    sort_order?: number
    section_heading?: string | null
  }>
}

function extractJson(text: string): any {
  const stripped = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
  let depth = 0
  let start = -1
  for (let i = 0; i < stripped.length; i++) {
    const char = stripped[i]
    if (char === '{') {
      if (depth === 0) start = i
      depth++
    } else if (char === '}') {
      depth--
      if (depth === 0 && start !== -1) {
        return JSON.parse(stripped.slice(start, i + 1))
      }
    }
  }
  return JSON.parse(stripped)
}

function buildPrompt(body: HelperRequest): string {
  const compactAnalytes = (body.analytes || []).map((item) => ({
    id: item.analyte_id,
    la: item.lab_analyte_id || '',
    n: item.name,
    c: item.code || '',
    u: item.unit || '',
    cat: item.category || '',
    s: item.sample_type || '',
    vt: item.value_type || '',
    opts: item.expected_normal_values || [],
    rr: item.reference_range || '',
    order: item.sort_order || 0,
    section: item.section_heading || '',
  }))

  if (body.action === 'layout_order') {
    return `You are configuring a laboratory report template.

TEST GROUP:
${JSON.stringify(body.test_group)}

ANALYTES:
${JSON.stringify(compactAnalytes)}

Task:
- Recommend professional report display order and section heading for the analytes.
- Use the test group name and sample type (Urine, Blood, Serum, etc.) to choose standard clinical sections.
- Preserve existing section headings conceptually when they are already correct.
- Use concise section headings suitable for printed reports, for example CHEMICAL EXAMINATION, MICROSCOPIC EXAMINATION, PHYSICAL EXAMINATION, RED CELL INDICES, DIFFERENTIAL COUNT.
- Return every analyte exactly once.

Return ONLY JSON:
{
  "items": [
    {
      "analyte_id": "same id from input",
      "sort_order": 1,
      "section_heading": "SECTION HEADING"
    }
  ],
  "notes": "short optional note"
}`
  }

  return `You are configuring result-entry dropdowns for a laboratory test group.

TEST GROUP:
${JSON.stringify(body.test_group)}

ANALYTES:
${JSON.stringify(compactAnalytes)}

Task:
- Identify analytes in this test group that should use dropdown expected values instead of plain numeric entry.
- If an existing selected analyte already has the correct sample_type and just lacks dropdown options or value_type, suggest an update.
- If the selected analyte is clinically the wrong sample-specific variant for this test, suggest creating a new analyte variant and replacing it in this test group. Example: "Ketone Blood" as numeric in a urine routine test should become/create a urine ketone analyte with semi_quantitative dropdown values.
- Use value_type one of: numeric, qualitative, semi_quantitative, descriptive.
- For urine strip parameters, prefer semi_quantitative values like ["Nil","Trace","1+","2+","3+","4+"] where appropriate. For Positive/Negative tests, use qualitative.
- Do not change truly numeric quantitative analytes that need free numeric values.

Return ONLY JSON:
{
  "updates": [
    {
      "analyte_id": "input analyte id",
      "lab_analyte_id": "input lab analyte id if present",
      "value_type": "semi_quantitative",
      "expected_normal_values": ["Nil","Trace","1+","2+","3+","4+"],
      "reason": "short reason"
    }
  ],
  "create_variants": [
    {
      "replace_analyte_id": "input analyte id to replace",
      "name": "Ketone",
      "code": "KET",
      "unit": "",
      "reference_range": "Nil",
      "category": "Urinalysis",
      "sample_type": "Urine",
      "value_type": "semi_quantitative",
      "expected_normal_values": ["Nil","Trace","1+","2+","3+","4+"],
      "sort_order": 1,
      "section_heading": "CHEMICAL EXAMINATION",
      "reason": "short reason"
    }
  ],
  "notes": "short optional note"
}`
}

async function callClaude(prompt: string, apiKey: string) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: CLAUDE_HAIKU_MODEL,
      max_tokens: 8000,
      temperature: 0.2,
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Anthropic API error: ${text}`)
  }

  const data = await response.json()
  const text = data?.content?.[0]?.text?.trim()
  if (!text) throw new Error('Empty AI response')
  return extractJson(text)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) throw new Error('No authorization header')

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } },
    )

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser()
    if (authError || !user) throw new Error('Invalid authentication')

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured')

    const body = await req.json() as HelperRequest
    if (!['layout_order', 'dropdown_values'].includes(body.action)) {
      throw new Error('Unsupported helper action')
    }
    if (!Array.isArray(body.analytes) || body.analytes.length === 0) {
      throw new Error('At least one analyte is required')
    }

    const result = await callClaude(buildPrompt(body), apiKey)

    const { data: userData } = await supabaseClient
      .from('users')
      .select('lab_id')
      .eq('id', user.id)
      .single()

    await supabaseClient.from('ai_usage_logs').insert({
      user_id: user.id,
      lab_id: userData?.lab_id,
      processing_type: `test_group_${body.action}`,
      input_data: {
        test_group: body.test_group,
        analyte_count: body.analytes.length,
      },
      confidence: 0.8,
      created_at: new Date().toISOString(),
    }).then(() => {})

    return new Response(JSON.stringify({ success: true, data: result }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[ai-test-group-analyte-helper]', message)
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
