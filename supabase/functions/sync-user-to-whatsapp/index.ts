// Supabase Edge Function: Sync User to WhatsApp Backend
// Syncs admin user creation to external WhatsApp backend via HTTP API
// Triggered after user creation in create-lab-with-admin or can be called manually

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// WhatsApp backend API endpoint
const WHATSAPP_API_BASE = Deno.env.get('WHATSAPP_API_BASE_URL') || 'https://lionfish-app-nmodi.ondigitalocean.app'
const WHATSAPP_API_KEY = Deno.env.get('WHATSAPP_API_KEY') || 'whatsapp-lims-secure-api-key-2024'

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabaseClient = createClient(supabaseUrl, supabaseKey)

    // Parse request body
    const { userId, labId } = await req.json()

    if (!userId) {
      throw new Error('userId is required')
    }

    console.log('📲 Syncing user to WhatsApp backend:', userId)

    // Fetch user and lab data from Supabase
    // userId can be either users.id (UUID) or auth_user_id (UUID)
    // We'll try users.id first, then fall back to auth_user_id
    let user
    let userError
    
    // First try: Look up by users.id (primary key)
    const resultById = await supabaseClient
      .from('users')
      .select('id, name, email, phone, role, lab_id')
      .eq('id', userId)
      .maybeSingle()
    
    if (resultById.data) {
      user = resultById.data
      userError = null
      console.log('✅ Found user by id:', user.id)
    } else {
      // Second try: Look up by auth_user_id
      const resultByAuth = await supabaseClient
        .from('users')
        .select('id, name, email, phone, role, lab_id')
        .eq('auth_user_id', userId)
        .maybeSingle()
      
      user = resultByAuth.data
      userError = resultByAuth.error
      if (user) {
        console.log('✅ Found user by auth_user_id:', user.id)
      }
    }

    if (userError || !user) {
      throw new Error(`User not found: ${userError?.message || 'No matching user'}`)
    }

    const effectiveLabId = labId || user.lab_id

    const { data: lab, error: labError } = await supabaseClient
      .from('labs')
      .select('id, name, address, city, state, phone, email')
      .eq('id', effectiveLabId)
      .single()

    if (labError || !lab) {
      console.warn('⚠️ Lab not found, proceeding with user data only')
    }

    console.log('✅ Fetched user and lab data')

    // Generate unique username: use email (most unique) or name with id suffix
    // WhatsApp backend requires unique usernames
    const baseUsername = user.email?.split('@')[0] || user.name?.replace(/\s+/g, '_') || 'user'
    const uniqueUsername = `${baseUsername}_${user.id.substring(0, 8)}`

    // Prepare user data for WhatsApp backend API
    const whatsappUserPayload = {
      id: user.id,
      email: user.email,
      username: uniqueUsername,
      clinic_name: lab?.name || 'Lab',
      contact_whatsapp: user.phone || lab?.phone || '',
      role: user.role?.toLowerCase() || 'receptionist',
      is_active: true,
      whatsapp_enabled: true,
    }

    console.log('📤 Sending to WhatsApp API:', JSON.stringify(whatsappUserPayload))

    // Call WhatsApp backend HTTP API
    const apiResponse = await fetch(`${WHATSAPP_API_BASE}/api/external/users/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': WHATSAPP_API_KEY,
      },
      body: JSON.stringify(whatsappUserPayload),
    })

    const responseText = await apiResponse.text()
    console.log('📥 WhatsApp API response:', apiResponse.status, responseText)

    if (!apiResponse.ok) {
      throw new Error(`WhatsApp API error: ${apiResponse.status} - ${responseText}`)
    }

    let responseData
    try {
      responseData = JSON.parse(responseText)
    } catch {
      responseData = { message: responseText }
    }

    // Update user sync status in Supabase
    const { error: updateError } = await supabaseClient
      .from('users')
      .update({
        whatsapp_sync_status: 'synced',
        whatsapp_last_sync: new Date().toISOString(),
        whatsapp_sync_error: null,
      })
      .eq('id', userId)

    if (updateError) {
      console.warn('⚠️ Failed to update sync status:', updateError.message)
    }

    console.log('✅ User synced to WhatsApp backend successfully')

    return new Response(
      JSON.stringify({
        success: true,
        message: 'User synced to WhatsApp backend',
        userId: user.id,
        whatsappResponse: responseData,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('❌ Sync error:', error)

    // Try to update sync status with error
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!
      const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      const supabaseClient = createClient(supabaseUrl, supabaseKey)
      
      const body = await req.clone().json().catch(() => ({}))
      if (body.userId) {
        await supabaseClient
          .from('users')
          .update({
            whatsapp_sync_status: 'failed',
            whatsapp_sync_error: String(error),
          })
          .eq('id', body.userId)
      }
    } catch {
      // Ignore status update errors
    }

    return new Response(
      JSON.stringify({
        success: false,
        error: 'Sync failed',
        details: String(error),
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
