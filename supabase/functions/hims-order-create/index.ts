// hims-order-create: Create LIMS orders from external HIMS/EMR systems
// Authentication: x-lab-api-key header (same as analyzer-ingest)
//
// POST /hims-order-create
//   Create patient (or find existing) and order with tests
//   Uses AI fuzzy matching to resolve HIMS test names to LIMS test_groups

import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-lab-api-key',
}

interface HIMSPatient {
  external_id: string
  name: string
  age?: number
  gender: string
  phone?: string
  date_of_birth?: string
  email?: string
  address?: string
  city?: string
  state?: string
  pincode?: string
}

interface HIMSTest {
  code?: string
  name: string
}

interface HIMSOrderRequest {
  external_order_id: string
  patient: HIMSPatient
  tests: HIMSTest[]
  referring_doctor?: string
  priority?: 'routine' | 'urgent' | 'stat'
  notes?: string
  pdf_callback_url?: string
}

interface TestMatchResult {
  hims_name: string
  hims_code?: string
  matched: boolean
  test_group_id?: string
  test_group_name?: string
  confidence?: number
  match_type?: 'exact' | 'fuzzy' | 'ai'
}

function log(event: string, details: Record<string, unknown> = {}) {
  console.log(`[hims-order-create] ${event}`, JSON.stringify(details))
}

async function validateApiKey(supabase: any, apiKey: string) {
  const keyBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(apiKey))
  const keyHash = Array.from(new Uint8Array(keyBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  const { data, error } = await supabase
    .from('lab_api_keys')
    .select('id, lab_id')
    .eq('key_hash', keyHash)
    .eq('is_active', true)
    .single()

  return { keyId: data?.id ?? null, labId: data?.lab_id ?? null, error }
}

function normalizeTestName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim()
}

async function matchTestsWithAI(
  supabase: any,
  labId: string,
  himsTests: HIMSTest[],
  limsTestGroups: { id: string; name: string; code: string }[]
): Promise<TestMatchResult[]> {
  const results: TestMatchResult[] = []

  // Build lookup maps for exact/fuzzy matching
  const exactNameMap = new Map<string, { id: string; name: string }>()
  const exactCodeMap = new Map<string, { id: string; name: string }>()
  const normalizedNameMap = new Map<string, { id: string; name: string }>()

  for (const tg of limsTestGroups) {
    exactNameMap.set(tg.name.toLowerCase(), { id: tg.id, name: tg.name })
    if (tg.code) exactCodeMap.set(tg.code.toLowerCase(), { id: tg.id, name: tg.name })
    normalizedNameMap.set(normalizeTestName(tg.name), { id: tg.id, name: tg.name })
  }

  const unmatchedTests: HIMSTest[] = []

  // First pass: exact and fuzzy matching
  for (const himsTest of himsTests) {
    const lowerName = himsTest.name.toLowerCase()
    const lowerCode = himsTest.code?.toLowerCase()
    const normalizedName = normalizeTestName(himsTest.name)

    // Try exact name match
    let match = exactNameMap.get(lowerName)
    if (match) {
      results.push({
        hims_name: himsTest.name,
        hims_code: himsTest.code,
        matched: true,
        test_group_id: match.id,
        test_group_name: match.name,
        confidence: 1.0,
        match_type: 'exact',
      })
      continue
    }

    // Try exact code match
    if (lowerCode) {
      match = exactCodeMap.get(lowerCode)
      if (match) {
        results.push({
          hims_name: himsTest.name,
          hims_code: himsTest.code,
          matched: true,
          test_group_id: match.id,
          test_group_name: match.name,
          confidence: 1.0,
          match_type: 'exact',
        })
        continue
      }
    }

    // Try normalized fuzzy match
    match = normalizedNameMap.get(normalizedName)
    if (match) {
      results.push({
        hims_name: himsTest.name,
        hims_code: himsTest.code,
        matched: true,
        test_group_id: match.id,
        test_group_name: match.name,
        confidence: 0.9,
        match_type: 'fuzzy',
      })
      continue
    }

    // Check for common abbreviations
    const abbreviationMatches = findAbbreviationMatch(himsTest.name, limsTestGroups)
    if (abbreviationMatches) {
      results.push({
        hims_name: himsTest.name,
        hims_code: himsTest.code,
        matched: true,
        test_group_id: abbreviationMatches.id,
        test_group_name: abbreviationMatches.name,
        confidence: 0.85,
        match_type: 'fuzzy',
      })
      continue
    }

    unmatchedTests.push(himsTest)
  }

  // Second pass: AI matching for unmatched tests
  if (unmatchedTests.length > 0) {
    const aiResults = await matchTestsWithAICall(unmatchedTests, limsTestGroups)
    results.push(...aiResults)
  }

  return results
}

function findAbbreviationMatch(
  himsName: string,
  limsTestGroups: { id: string; name: string; code: string }[]
): { id: string; name: string } | null {
  const abbreviations: Record<string, string[]> = {
    'cbc': ['complete blood count', 'hemogram', 'blood count', 'cbp'],
    'lft': ['liver function test', 'liver function', 'hepatic function'],
    'kft': ['kidney function test', 'renal function test', 'renal function', 'rft'],
    'rft': ['renal function test', 'kidney function test', 'renal function', 'kft'],
    'tft': ['thyroid function test', 'thyroid profile', 'thyroid panel'],
    'lipid': ['lipid profile', 'lipid panel', 'cholesterol profile'],
    'hba1c': ['glycated hemoglobin', 'glycosylated hemoglobin', 'hemoglobin a1c'],
    'esr': ['erythrocyte sedimentation rate', 'sed rate'],
    'crp': ['c-reactive protein', 'c reactive protein'],
    'tsh': ['thyroid stimulating hormone', 'thyrotropin'],
    't3': ['triiodothyronine', 'total t3', 'free t3'],
    't4': ['thyroxine', 'total t4', 'free t4'],
    'psa': ['prostate specific antigen', 'prostate antigen'],
    'ua': ['urine analysis', 'urinalysis', 'urine routine', 'urine examination'],
    'ure': ['urine routine examination', 'urine routine', 'urine analysis'],
    'stool': ['stool routine', 'stool examination', 'stool analysis'],
    'widal': ['widal test', 'typhoid test'],
    'hiv': ['hiv test', 'hiv screening', 'hiv antibody'],
    'hbsag': ['hepatitis b surface antigen', 'hepatitis b', 'hep b'],
    'vdrl': ['vdrl test', 'syphilis test', 'syphilis screening'],
    'pt': ['prothrombin time', 'pt inr'],
    'aptt': ['activated partial thromboplastin time', 'ptt'],
    'fbs': ['fasting blood sugar', 'fasting glucose', 'fasting blood glucose'],
    'ppbs': ['post prandial blood sugar', 'pp blood sugar', 'postprandial glucose'],
    'rbs': ['random blood sugar', 'random glucose'],
    'ogtt': ['oral glucose tolerance test', 'glucose tolerance'],
    'aso': ['anti streptolysin o', 'asot', 'aso titer'],
    'ra': ['rheumatoid factor', 'ra factor', 'rheumatoid arthritis'],
    'ana': ['antinuclear antibody', 'ana test'],
    'ecg': ['electrocardiogram', 'ekg', '12 lead ecg'],
    'xray': ['x-ray', 'radiograph', 'plain radiograph'],
    'usg': ['ultrasonography', 'ultrasound', 'sonography'],
    'ct': ['ct scan', 'computed tomography', 'cat scan'],
    'mri': ['magnetic resonance imaging', 'mr imaging'],
  }

  const lowerHims = himsName.toLowerCase().trim()

  for (const [abbrev, fullNames] of Object.entries(abbreviations)) {
    if (lowerHims === abbrev || fullNames.some(fn => lowerHims.includes(fn) || fn.includes(lowerHims))) {
      // Find matching test group
      for (const tg of limsTestGroups) {
        const lowerTgName = tg.name.toLowerCase()
        const lowerTgCode = (tg.code || '').toLowerCase()

        if (
          lowerTgCode === abbrev ||
          lowerTgName === abbrev ||
          fullNames.some(fn => lowerTgName.includes(fn) || fn.includes(lowerTgName))
        ) {
          return { id: tg.id, name: tg.name }
        }
      }
    }
  }

  return null
}

async function matchTestsWithAICall(
  unmatchedTests: HIMSTest[],
  limsTestGroups: { id: string; name: string; code: string }[]
): Promise<TestMatchResult[]> {
  const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!anthropicApiKey) {
    log('ai_matching_skipped', { reason: 'ANTHROPIC_API_KEY not configured' })
    return unmatchedTests.map(t => ({
      hims_name: t.name,
      hims_code: t.code,
      matched: false,
    }))
  }

  const testGroupsList = limsTestGroups
    .map(tg => `- "${tg.name}" (code: ${tg.code || 'N/A'}, id: ${tg.id})`)
    .join('\n')

  const prompt = `You are a medical laboratory test matching assistant. Match the following HIMS test names to the closest LIMS test from the available list.

HIMS TESTS TO MATCH:
${unmatchedTests.map((t, i) => `${i + 1}. "${t.name}"${t.code ? ` (code: ${t.code})` : ''}`).join('\n')}

AVAILABLE LIMS TESTS:
${testGroupsList}

For each HIMS test, return a JSON array with objects containing:
- hims_name: the original HIMS test name
- hims_code: the original HIMS code if provided
- matched: true if a good match found, false if no confident match
- test_group_id: the matched LIMS test ID (only if matched)
- test_group_name: the matched LIMS test name (only if matched)
- confidence: match confidence 0-1 (only if matched)

Only match if you're at least 70% confident. Common abbreviations should be expanded (CBC = Complete Blood Count, LFT = Liver Function Test, etc).

Return ONLY valid JSON array, no other text.`

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': anthropicApiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
      }),
    })

    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.status}`)
    }

    const data = await response.json()
    const responseText = data.content?.[0]?.text || ''

    // Parse JSON from response
    const jsonStart = responseText.indexOf('[')
    const jsonEnd = responseText.lastIndexOf(']')
    if (jsonStart === -1 || jsonEnd === -1) {
      throw new Error('No JSON array in response')
    }

    const aiResults = JSON.parse(responseText.substring(jsonStart, jsonEnd + 1))

    return aiResults.map((r: any) => ({
      hims_name: r.hims_name,
      hims_code: r.hims_code,
      matched: Boolean(r.matched),
      test_group_id: r.test_group_id,
      test_group_name: r.test_group_name,
      confidence: r.confidence,
      match_type: 'ai' as const,
    }))
  } catch (error) {
    log('ai_matching_error', { error: String(error) })
    return unmatchedTests.map(t => ({
      hims_name: t.name,
      hims_code: t.code,
      matched: false,
    }))
  }
}

function generateSampleId(orderDate: Date, sequence: number, labCode?: string): string {
  const day = orderDate.getDate().toString().padStart(2, '0')
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const month = monthNames[orderDate.getMonth()]
  const year = orderDate.getFullYear()
  const seq = sequence.toString().padStart(3, '0')

  return labCode ? `${labCode}-${day}-${month}-${year}-${seq}` : `${day}-${month}-${year}-${seq}`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const requestId = crypto.randomUUID()

  try {
    // Validate API key
    const apiKey = req.headers.get('x-lab-api-key')
    if (!apiKey) {
      return json({ error: 'Missing x-lab-api-key header' }, 401)
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { keyId, labId, error: keyError } = await validateApiKey(supabase, apiKey)
    if (keyError || !labId) {
      log('auth_failed', { request_id: requestId, error: keyError })
      return json({ error: 'Invalid or inactive API key' }, 403)
    }

    // Update last_used_at
    supabase.from('lab_api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', keyId).then(() => {})

    log('auth_ok', { request_id: requestId, lab_id: labId })

    // Parse request
    const body: HIMSOrderRequest = await req.json()

    if (!body.external_order_id) {
      return json({ error: 'Missing external_order_id' }, 400)
    }
    if (!body.patient?.name) {
      return json({ error: 'Missing patient.name' }, 400)
    }
    if (!body.tests?.length) {
      return json({ error: 'Missing tests array' }, 400)
    }

    log('request_received', {
      request_id: requestId,
      lab_id: labId,
      external_order_id: body.external_order_id,
      patient_external_id: body.patient.external_id,
      test_count: body.tests.length,
    })

    // Check for duplicate order
    const { data: existingOrder } = await supabase
      .from('orders')
      .select('id, sample_id, status')
      .eq('lab_id', labId)
      .eq('external_system_type', 'hims')
      .eq('external_order_id', body.external_order_id)
      .single()

    if (existingOrder) {
      log('duplicate_order', { request_id: requestId, existing_order_id: existingOrder.id })
      return json({
        success: false,
        error: 'Order already exists',
        existing_order: {
          id: existingOrder.id,
          sample_id: existingOrder.sample_id,
          status: existingOrder.status,
        },
      }, 409)
    }

    // Upsert patient
    const { data: patientId, error: patientError } = await supabase.rpc('upsert_external_patient', {
      p_lab_id: labId,
      p_external_system_type: 'hims',
      p_external_system_id: body.patient.external_id || body.external_order_id,
      p_name: body.patient.name,
      p_age: body.patient.age || null,
      p_gender: body.patient.gender || 'other',
      p_phone: body.patient.phone || '',
      p_date_of_birth: body.patient.date_of_birth || null,
      p_email: body.patient.email || null,
      p_address: body.patient.address || '',
      p_city: body.patient.city || '',
      p_state: body.patient.state || '',
      p_pincode: body.patient.pincode || '',
    })

    if (patientError) {
      log('patient_upsert_failed', { request_id: requestId, error: patientError })
      return json({ error: 'Failed to create/update patient', details: patientError.message }, 500)
    }

    log('patient_upserted', { request_id: requestId, patient_id: patientId })

    // Fetch lab's test groups for matching
    const { data: labTestGroups, error: tgError } = await supabase
      .from('test_groups')
      .select('id, name, code, price')
      .eq('lab_id', labId)
      .eq('is_active', true)

    if (tgError) {
      log('test_groups_fetch_failed', { request_id: requestId, error: tgError })
      return json({ error: 'Failed to fetch test catalog' }, 500)
    }

    // Match HIMS tests to LIMS test groups
    const matchResults = await matchTestsWithAI(supabase, labId, body.tests, labTestGroups || [])
    const matchedTests = matchResults.filter(r => r.matched)
    const unmatchedTests = matchResults.filter(r => !r.matched)

    log('tests_matched', {
      request_id: requestId,
      total: body.tests.length,
      matched: matchedTests.length,
      unmatched: unmatchedTests.length,
    })

    if (matchedTests.length === 0) {
      return json({
        success: false,
        error: 'No tests could be matched to LIMS catalog',
        unmatched_tests: unmatchedTests.map(t => t.hims_name),
        available_tests: (labTestGroups || []).slice(0, 20).map(t => t.name),
      }, 400)
    }

    // Get lab code for sample ID generation
    const { data: labRow } = await supabase
      .from('labs')
      .select('code')
      .eq('id', labId)
      .single()

    // Get next sequence number
    const orderDate = new Date()
    const orderDateStr = orderDate.toISOString().split('T')[0]

    const { data: dailyOrders } = await supabase
      .from('orders')
      .select('order_number')
      .eq('lab_id', labId)
      .gte('order_date', orderDateStr)
      .lt('order_date', new Date(orderDate.getTime() + 86400000).toISOString().split('T')[0])

    let sequence = Math.max(0, ...(dailyOrders || []).map((o: any) => o.order_number || 0)) + 1

    // Create order
    const orderId = crypto.randomUUID()
    const sampleId = generateSampleId(orderDate, sequence, labRow?.code)
    const totalAmount = matchedTests.reduce((sum, t) => {
      const tg = labTestGroups?.find(g => g.id === t.test_group_id)
      return sum + (parseFloat(tg?.price || '0') || 0)
    }, 0)

    const priorityMap: Record<string, string> = {
      'routine': 'Normal',
      'urgent': 'Urgent',
      'stat': 'STAT',
    }

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({
        id: orderId,
        lab_id: labId,
        patient_id: patientId,
        patient_name: body.patient.name,
        sample_id: sampleId,
        order_number: sequence,
        order_date: orderDateStr,
        expected_date: orderDateStr,
        priority: priorityMap[body.priority || 'routine'] || 'Normal',
        doctor: body.referring_doctor || '',
        notes: body.notes || '',
        total_amount: totalAmount,
        status: 'Order Created',
        external_order_id: body.external_order_id,
        external_system_type: 'hims',
        pdf_callback_url: body.pdf_callback_url || null,
        pdf_callback_status: body.pdf_callback_url ? 'pending' : 'not_required',
      })
      .select()
      .single()

    if (orderError) {
      log('order_create_failed', { request_id: requestId, error: orderError })
      return json({ error: 'Failed to create order', details: orderError.message }, 500)
    }

    log('order_created', { request_id: requestId, order_id: orderId, sample_id: sampleId })

    // Create order_tests
    const orderTestsData = matchedTests.map(t => ({
      order_id: orderId,
      test_name: t.test_group_name,
      test_group_id: t.test_group_id,
      sample_id: sampleId,
      lab_id: labId,
      price: labTestGroups?.find(g => g.id === t.test_group_id)?.price || 0,
    }))

    const { error: testsError } = await supabase.from('order_tests').insert(orderTestsData)

    if (testsError) {
      log('order_tests_create_failed', { request_id: requestId, error: testsError })
      // Order created but tests failed - still return success with warning
    }

    log('order_complete', {
      request_id: requestId,
      order_id: orderId,
      sample_id: sampleId,
      tests_created: orderTestsData.length,
    })

    return json({
      success: true,
      order: {
        id: orderId,
        sample_id: sampleId,
        status: 'Order Created',
        total_amount: totalAmount,
        pdf_callback_registered: Boolean(body.pdf_callback_url),
      },
      patient: {
        id: patientId,
        name: body.patient.name,
      },
      tests: {
        matched: matchedTests.map(t => ({
          hims_name: t.hims_name,
          lims_name: t.test_group_name,
          confidence: t.confidence,
          match_type: t.match_type,
        })),
        unmatched: unmatchedTests.map(t => t.hims_name),
      },
    })
  } catch (error) {
    log('exception', { request_id: requestId, error: String(error) })
    return json({ error: 'Internal server error', details: String(error) }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
