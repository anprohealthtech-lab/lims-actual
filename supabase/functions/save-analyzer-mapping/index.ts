import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface SaveMappingRequest {
  id?: string | null
  lab_id: string
  analyzer_id?: string | null
  analyzer_profile_id?: string | null
  analyzer_connection_id: string
  analyte_id: string
  lab_analyte_id: string
  test_group_id: string
  lims_code: string
  analyzer_code: string
  analyzer_display?: string | null
  analyzer_code_system?: string | null
  test_name: string
  direction?: 'inbound' | 'outbound' | 'bidirectional'
  verified?: boolean
  ai_confidence?: number | null
  ai_source?: string | null
  metadata?: Record<string, unknown>
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!supabaseUrl || !anonKey || !serviceKey) {
      return json({ error: 'Supabase function environment is not configured' }, 500)
    }

    const authHeader = req.headers.get('authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    if (!token) return json({ error: 'Missing authorization token' }, 401)

    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    })
    const admin = createClient(supabaseUrl, serviceKey)

    const { data: authData, error: authError } = await authClient.auth.getUser(token)
    if (authError || !authData.user) {
      return json({ error: 'Invalid authorization token' }, 401)
    }

    const body = await req.json() as SaveMappingRequest
    const required: Array<keyof SaveMappingRequest> = [
      'lab_id',
      'analyzer_connection_id',
      'analyte_id',
      'lab_analyte_id',
      'test_group_id',
      'lims_code',
      'analyzer_code',
      'test_name',
    ]
    for (const key of required) {
      if (!String(body[key] ?? '').trim()) {
        return json({ error: `${key} is required` }, 400)
      }
    }

    const normalizedEmail = String(authData.user.email || '').toLowerCase()
    const metadataLabId = String(authData.user.user_metadata?.lab_id || '')
    const { data: appUser, error: appUserError } = await admin
      .from('users')
      .select('id, lab_id, status')
      .or(`id.eq.${authData.user.id},auth_user_id.eq.${authData.user.id},email.eq.${normalizedEmail}`)
      .maybeSingle()

    if (appUserError) return json({ error: appUserError.message }, 500)

    const userLabId = appUser?.lab_id || metadataLabId
    if (!userLabId || userLabId !== body.lab_id || (appUser?.status && appUser.status !== 'Active')) {
      return json({ error: 'User is not allowed to manage mappings for this lab' }, 403)
    }

    const [{ data: connection }, { data: labAnalyte }, { data: testGroup }] = await Promise.all([
      admin
        .from('analyzer_connections')
        .select('id, lab_id, profile_id')
        .eq('id', body.analyzer_connection_id)
        .eq('lab_id', body.lab_id)
        .maybeSingle(),
      admin
        .from('lab_analytes')
        .select('id, lab_id, analyte_id')
        .eq('id', body.lab_analyte_id)
        .eq('lab_id', body.lab_id)
        .maybeSingle(),
      admin
        .from('test_groups')
        .select('id, lab_id')
        .eq('id', body.test_group_id)
        .eq('lab_id', body.lab_id)
        .maybeSingle(),
    ])

    if (!connection) return json({ error: 'Analyzer connection does not belong to this lab' }, 403)
    if (!labAnalyte || labAnalyte.analyte_id !== body.analyte_id) {
      return json({ error: 'Lab analyte does not belong to this lab/analyte' }, 403)
    }
    if (!testGroup) return json({ error: 'Test group does not belong to this lab' }, 403)

    const payload = {
      lab_id: body.lab_id,
      analyzer_id: body.analyzer_id || body.analyzer_profile_id || connection.profile_id || body.analyzer_connection_id,
      analyzer_profile_id: body.analyzer_profile_id || connection.profile_id || null,
      analyzer_connection_id: body.analyzer_connection_id,
      analyte_id: body.analyte_id,
      lab_analyte_id: body.lab_analyte_id,
      test_group_id: body.test_group_id,
      lims_code: body.lims_code.trim(),
      analyzer_code: body.analyzer_code.trim(),
      analyzer_display: body.analyzer_display?.trim() || body.test_name,
      analyzer_code_system: body.analyzer_code_system?.trim() || 'LOCAL',
      test_name: body.test_name.trim(),
      mapping_type: 'result_analyte',
      direction: body.direction || 'inbound',
      supports_order_send: false,
      supports_result_receive: true,
      verified: body.verified ?? true,
      ai_confidence: body.ai_confidence ?? null,
      ai_source: body.ai_source || null,
      metadata: body.metadata || {},
      updated_at: new Date().toISOString(),
    }

    let result
    if (body.id) {
      result = await admin
        .from('test_mappings')
        .update(payload)
        .eq('id', body.id)
        .eq('lab_id', body.lab_id)
        .select('id')
        .single()
    } else {
      result = await admin
        .from('test_mappings')
        .insert(payload)
        .select('id')
        .single()
    }

    if (result.error) return json({ error: result.error.message, code: result.error.code }, 400)
    return json({ success: true, id: result.data.id })
  } catch (err) {
    console.error('[save-analyzer-mapping] Error:', err)
    return json({ error: 'Failed to save analyzer mapping', message: err instanceof Error ? err.message : String(err) }, 500)
  }
})
