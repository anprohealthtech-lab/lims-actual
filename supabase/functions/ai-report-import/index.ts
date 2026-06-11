/**
 * ai-report-import — Supabase Edge Function (Deno)
 *
 * Two-stage AI pipeline:
 *   Stage 1 → Gemini 2.5 Flash (vision)  — extract structured data from lab report image/PDF
 *   Stage 2 → Claude Haiku 4.5           — match extracted analytes to DB analytes → CRUD-ready JSON
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const GEMINI_VISION_MODEL = 'gemini-2.5-flash'
const CLAUDE_HAIKU_MODEL = 'claude-haiku-4-5-20251001'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ExistingAnalyte {
  id: string
  lab_analyte_id: string
  name: string
  code: string
  unit: string
  reference_range: string
  reference_range_male?: string | null
  reference_range_female?: string | null
}

interface ExistingTGA {
  id?: string
  analyte_id: string
  lab_analyte_id?: string | null
  sort_order: number
  section_heading: string
}

interface ExtractedAnalyte {
  extracted_name: string
  unit: string
  reference_range?: string
  reference_range_male?: string
  reference_range_female?: string
  reference_range_pediatric?: string
  section_header?: string
  position: number
}

interface GeminiExtractedData {
  test_name?: string
  methodology?: string
  sample_type?: string
  analytes: ExtractedAnalyte[]
}

// ─── Stage 1: Gemini 2.5 Flash vision extraction ─────────────────────────────

function buildGeminiExtractionPrompt(): string {
  return `You are a medical laboratory data extraction specialist. Analyze this lab report image/PDF and extract all structured data.

Extract the following and return ONLY a JSON object with no extra text:

1. Test name / panel name (if shown)
2. Methodology / technique (if shown, e.g., "Impedance", "Flow Cytometry", "Photometry")
3. Sample type (if shown, e.g., "EDTA Blood", "Serum", "Urine")
4. ALL analytes/parameters listed, in the ORDER they appear

For each analyte:
- extracted_name: Exact parameter name as written
- unit: Unit of measurement
- reference_range: Combined range if single range (e.g., "4.5-11.0")
- reference_range_male: Male-specific if shown separately
- reference_range_female: Female-specific if shown separately
- reference_range_pediatric: Pediatric range if shown
- section_header: The group/section heading this analyte falls under (null if none)
- position: 1-based index in report order

Return JSON:
{
  "test_name": "string or null",
  "methodology": "string or null",
  "sample_type": "string or null",
  "analytes": [
    {
      "extracted_name": "Haemoglobin",
      "unit": "g/dL",
      "reference_range": null,
      "reference_range_male": "13.0-17.0",
      "reference_range_female": "11.0-15.0",
      "reference_range_pediatric": null,
      "section_header": "Red Blood Cell Parameters",
      "position": 1
    }
  ]
}

Rules:
- Capture ALL parameters visible, including calculated ones
- Preserve exact names as written (do not normalise)
- If a single unified range exists, use reference_range; if M/F split, use reference_range_male / reference_range_female
- Section headers are bold/underlined group labels appearing above sets of analytes`
}

async function callGeminiVision(
  fileBase64: string,
  mimeType: string,
  geminiApiKey: string
): Promise<GeminiExtractedData> {
  const body = {
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType, data: fileBase64 } },
          { text: buildGeminiExtractionPrompt() },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      topP: 0.9,
      maxOutputTokens: 16384,
      responseMimeType: 'application/json',
    },
  }

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_VISION_MODEL}:generateContent?key=${geminiApiKey}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  )

  if (!resp.ok) {
    const errText = await resp.text()
    throw new Error(`Gemini vision error ${resp.status}: ${errText}`)
  }

  const data = await resp.json()
  const text: string = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? ''

  if (!text) throw new Error('Gemini returned empty response')

  // Extract the JSON object robustly — handles leading/trailing text or code fences
  const objMatch = text.match(/\{[\s\S]*\}/)
  if (!objMatch) {
    console.error('[ai-report-import] Gemini raw response (no JSON found):', text.slice(0, 500))
    throw new Error('Could not extract JSON from Gemini response')
  }

  try {
    return JSON.parse(objMatch[0]) as GeminiExtractedData
  } catch (e) {
    console.error('[ai-report-import] Gemini JSON parse error. Raw (first 1000 chars):', objMatch[0].slice(0, 1000))
    throw new Error(`Gemini response JSON parse failed: ${e instanceof Error ? e.message : String(e)}`)
  }
}

// ─── Stage 2: Claude Haiku 4.5 matching & CRUD payload generation ─────────────

function buildHaikuPrompt(
  extracted: GeminiExtractedData,
  existingAnalytes: ExistingAnalyte[],
  existingTga: ExistingTGA[],
  currentTestGroup: { methodology: string; sample_type: string }
): string {
  const tgaMap = Object.fromEntries(
    existingTga.map(t => [t.lab_analyte_id || `legacy:${t.analyte_id}`, t])
  )

  return `You are a laboratory informatics specialist. Match extracted lab report data to existing DB analytes and generate precise CRUD update payloads.

## Current Test Group Values
${JSON.stringify(currentTestGroup)}

## Extracted From Report (Stage 1 output)
${JSON.stringify(extracted)}

## Lab Analyte Catalog (lab_analyte_id is the primary identity; use only these IDs)
${JSON.stringify(existingAnalytes)}

## Analytes Currently Attached To This Test Group
Keys are lab_analyte_id. Legacy rows without one use "legacy:<analyte_id>".
${JSON.stringify(tgaMap)}

## Instructions

**1. Test Group Fields**
Compare extracted methodology and sample_type to current values.
Only include in test_group_updates if extracted value is non-null and meaningfully different.

**2. Analyte Matching**
For each extracted analyte find the best match using name/code/unit similarity across the full lab analyte catalog.
Handle common variants: Haemoglobin↔Hemoglobin, TLC/Total Leucocyte Count↔WBC,
Platelet Count↔PLT, Haematocrit↔Hematocrit, MCHC, MCV, MCH, RBC, etc.
- match_confidence: 0.0–1.0. Use ≥0.75 as valid-match threshold.
- Below 0.75 → put in unmatched_analytes.

**3. CRUD Payloads**
- lab_analyte_updates: Only fields where extracted value DIFFERS from current DB value (unit, reference_range, reference_range_male, reference_range_female). Omit unchanged fields.
- Check attachment by lab_analyte_id first. analyte_id is compatibility data and must not be used as lab_analyte_id.
- needs_attachment: true if the analyte exists in the lab catalog but is NOT currently attached to this test group.
- tga_updates: for attached analytes, include section_heading if different and sort_order if different. For unattached analytes, include the extracted section_heading and sort_order so a new test_group_analytes row can be created correctly.
- has_lab_analyte_changes: true only if lab_analyte_updates has ≥1 key
- has_tga_changes: true only if tga_updates has ≥1 key OR needs_attachment is true
- current_values: Always fill from DB (not extracted) — used by diff UI.
- is_currently_attached: true if found in existing test_group_analytes config, else false.
- Include every valid matched extracted analyte, even when it has no changes. The server will calculate the final diff and use the complete match list to detect attached analytes missing from the report.

Return ONLY this JSON structure (no extra text or markdown):
{
  "test_group_updates": { "methodology": "...", "sample_type": "..." },
  "has_test_group_changes": true,
  "analyte_changes": [
    {
      "extracted_name": "Haemoglobin",
      "analyte_id": "<uuid from DB>",
      "lab_analyte_id": "<uuid from DB>",
      "matched_name": "Hemoglobin",
      "matched_code": "HB",
      "match_confidence": 0.97,
      "is_currently_attached": true,
      "needs_attachment": false,
      "lab_analyte_updates": {
        "reference_range_male": "13.0-17.0",
        "reference_range_female": "11.0-15.0"
      },
      "tga_updates": { "section_heading": "Red Blood Cell Parameters", "sort_order": 1 },
      "current_values": {
        "unit": "g/dL",
        "reference_range": "12-16",
        "reference_range_male": "13-17",
        "reference_range_female": "11-15",
        "section_heading": "",
        "sort_order": 0
      },
      "has_lab_analyte_changes": true,
      "has_tga_changes": true
    }
  ],
  "unmatched_analytes": [
    {
      "extracted_name": "MPV",
      "unit": "fL",
      "reference_range": "7.5-12.5",
      "reference_range_male": null,
      "reference_range_female": null,
      "reference_range_pediatric": null,
      "section_header": "Platelet Parameters",
      "position": 9
    }
  ],
  "extraction_notes": "Optional notes about ambiguous matches"
}`
}

async function callClaudeHaiku(
  prompt: string,
  anthropicApiKey: string
): Promise<unknown> {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': anthropicApiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: CLAUDE_HAIKU_MODEL,
      max_tokens: 8192,
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  if (!resp.ok) {
    const errText = await resp.text()
    throw new Error(`Claude Haiku error ${resp.status}: ${errText}`)
  }

  const data = await resp.json()
  const text: string = data?.content?.[0]?.text?.trim() ?? ''

  if (!text) throw new Error('Claude Haiku returned empty response')

  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const objMatch = cleaned.match(/\{[\s\S]*\}/)
  if (!objMatch) {
    console.error('[ai-report-import] Claude Haiku raw response (no JSON found):', text.slice(0, 500))
    throw new Error('Could not extract JSON from Claude Haiku response')
  }

  try {
    return JSON.parse(objMatch[0])
  } catch (e) {
    console.error('[ai-report-import] Claude Haiku JSON parse error. Raw (first 1000 chars):', objMatch[0].slice(0, 1000))
    throw new Error(`Claude Haiku response JSON parse failed: ${e instanceof Error ? e.message : String(e)}`)
  }
}

// ─── Handler ──────────────────────────────────────────────────────────────────

function comparable(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
}

function buildDeterministicResult(
  rawResult: Record<string, unknown>,
  extracted: GeminiExtractedData,
  existingAnalytes: ExistingAnalyte[],
  existingTga: ExistingTGA[],
  currentTestGroup: { methodology: string; sample_type: string }
): Record<string, unknown> {
  const catalogByLabId = new Map(existingAnalytes.map(a => [a.lab_analyte_id, a]))
  const extractedByName = new Map((extracted.analytes ?? []).map(a => [comparable(a.extracted_name), a]))
  const attachedByLabId = new Map(
    existingTga.filter(t => t.lab_analyte_id).map(t => [t.lab_analyte_id as string, t])
  )
  const legacyAttachedByAnalyteId = new Map(
    existingTga.filter(t => !t.lab_analyte_id).map(t => [t.analyte_id, t])
  )
  const matchedLabIds = new Set<string>()
  const matchedExtractedNames = new Set<string>()
  const analyteChanges: Record<string, unknown>[] = []

  for (const raw of (Array.isArray(rawResult.analyte_changes) ? rawResult.analyte_changes : [])) {
    const match = raw as Record<string, unknown>
    const labAnalyteId = String(match.lab_analyte_id ?? '')
    const catalog = catalogByLabId.get(labAnalyteId)
    const extractedName = comparable(match.extracted_name)
    const item = extractedByName.get(extractedName)
    const confidence = Number(match.match_confidence ?? 0)
    if (!catalog || !item || confidence < 0.75) continue

    const attached = attachedByLabId.get(labAnalyteId) || legacyAttachedByAnalyteId.get(catalog.id)
    const labUpdates: Record<string, string> = {}
    const fields: Array<[keyof ExtractedAnalyte, keyof ExistingAnalyte]> = [
      ['unit', 'unit'],
      ['reference_range', 'reference_range'],
      ['reference_range_male', 'reference_range_male'],
      ['reference_range_female', 'reference_range_female'],
    ]
    for (const [source, target] of fields) {
      const proposed = item[source]
      if (proposed && comparable(proposed) !== comparable(catalog[target])) {
        labUpdates[target] = String(proposed).trim()
      }
    }

    const section = String(item.section_header ?? '').trim()
    const order = Number(item.position ?? 0)
    const currentSection = String(attached?.section_heading ?? '')
    const currentOrder = Number(attached?.sort_order ?? 0)
    const tgaUpdates: Record<string, string | number> = {}
    if (!attached || comparable(section) !== comparable(currentSection)) tgaUpdates.section_heading = section
    if (!attached || order !== currentOrder) tgaUpdates.sort_order = order

    matchedLabIds.add(labAnalyteId)
    matchedExtractedNames.add(extractedName)
    const needsAttachment = !attached
    const hasLabChanges = Object.keys(labUpdates).length > 0
    const hasTgaChanges = Object.keys(tgaUpdates).length > 0 || needsAttachment
    if (!hasLabChanges && !hasTgaChanges) continue

    analyteChanges.push({
      extracted_name: item.extracted_name,
      analyte_id: catalog.id,
      lab_analyte_id: catalog.lab_analyte_id,
      matched_name: catalog.name,
      matched_code: catalog.code ?? '',
      match_confidence: confidence,
      is_currently_attached: Boolean(attached),
      needs_attachment: needsAttachment,
      lab_analyte_updates: labUpdates,
      tga_updates: tgaUpdates,
      current_values: {
        unit: catalog.unit ?? '',
        reference_range: catalog.reference_range ?? '',
        reference_range_male: catalog.reference_range_male ?? '',
        reference_range_female: catalog.reference_range_female ?? '',
        section_heading: currentSection,
        sort_order: currentOrder,
      },
      has_lab_analyte_changes: hasLabChanges,
      has_tga_changes: hasTgaChanges,
    })
  }

  const unmatched = (extracted.analytes ?? []).filter(
    item => !matchedExtractedNames.has(comparable(item.extracted_name))
  )

  const missingAttached = existingTga.flatMap(tga => {
    const catalog = tga.lab_analyte_id
      ? catalogByLabId.get(tga.lab_analyte_id)
      : existingAnalytes.find(a => a.id === tga.analyte_id)
    if (!catalog || matchedLabIds.has(catalog.lab_analyte_id)) return []
    return [{
      tga_id: tga.id,
      analyte_id: catalog.id,
      lab_analyte_id: catalog.lab_analyte_id,
      name: catalog.name,
      code: catalog.code ?? '',
      section_heading: tga.section_heading ?? '',
      sort_order: tga.sort_order ?? 0,
    }]
  })

  const testGroupUpdates: Record<string, string> = {}
  if (extracted.methodology && comparable(extracted.methodology) !== comparable(currentTestGroup.methodology)) {
    testGroupUpdates.methodology = extracted.methodology.trim()
  }
  if (extracted.sample_type && comparable(extracted.sample_type) !== comparable(currentTestGroup.sample_type)) {
    testGroupUpdates.sample_type = extracted.sample_type.trim()
  }

  return {
    test_group_updates: testGroupUpdates,
    has_test_group_changes: Object.keys(testGroupUpdates).length > 0,
    analyte_changes: analyteChanges,
    unmatched_analytes: unmatched,
    missing_attached_analytes: missingAttached,
    extraction_notes: rawResult.extraction_notes,
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    const geminiApiKey = Deno.env.get('ALLGOOGLE_KEY') || Deno.env.get('GEMINI_API_KEY')
    const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY')

    if (!geminiApiKey) {
      return new Response(JSON.stringify({ error: 'Gemini API key not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    if (!anthropicApiKey) {
      return new Response(JSON.stringify({ error: 'Anthropic API key not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const body = await req.json()
    const { file_base64, file_mime_type, test_group, existing_analytes, existing_tga } = body

    if (!file_base64 || !file_mime_type) {
      return new Response(JSON.stringify({ error: 'file_base64 and file_mime_type are required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supportedTypes = [
      'image/jpeg', 'image/png', 'image/webp', 'image/gif',
      'image/heic', 'image/heif', 'application/pdf',
    ]
    if (!supportedTypes.includes(file_mime_type)) {
      return new Response(JSON.stringify({ error: `Unsupported file type: ${file_mime_type}` }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    console.log(`[ai-report-import] Stage 1: Gemini vision (${file_mime_type})`)
    const extracted = await callGeminiVision(file_base64, file_mime_type, geminiApiKey)
    console.log(`[ai-report-import] Extracted ${extracted.analytes?.length ?? 0} analytes`)

    const currentTestGroup = {
      methodology: test_group?.methodology ?? '',
      sample_type: test_group?.sample_type ?? test_group?.sampleType ?? '',
    }

    console.log('[ai-report-import] Stage 2: Claude Haiku matching')
    const prompt = buildHaikuPrompt(
      extracted,
      existing_analytes ?? [],
      existing_tga ?? [],
      currentTestGroup
    )
    const aiResult = await callClaudeHaiku(prompt, anthropicApiKey) as Record<string, unknown>
    const result = buildDeterministicResult(
      aiResult,
      extracted,
      existing_analytes ?? [],
      existing_tga ?? [],
      currentTestGroup
    )

    const enriched = {
      ...result,
      test_group_current: currentTestGroup,
    }

    console.log(
      `[ai-report-import] Done. changes=${(result.analyte_changes as unknown[])?.length ?? 0}, ` +
      `unmatched=${(result.unmatched_analytes as unknown[])?.length ?? 0}`
    )

    return new Response(JSON.stringify(enriched), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('[ai-report-import] Error:', err)
    return new Response(
      JSON.stringify({ error: 'Import failed', message: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
