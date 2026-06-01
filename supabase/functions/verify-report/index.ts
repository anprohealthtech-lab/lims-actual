// Secure Report Verification Edge Function
// Purpose: Allow public verification of reports via QR code without exposing orders table
// This function uses service role (server-side only) to query the database securely

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

// CORS headers for public access
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface VerificationResponse {
  status: 'verified' | 'not_found' | 'error'
  data?: {
    sample_id: string
    created_at: string
    patient_name: string
    patient_gender?: string
    patient_age?: string
    doctor?: string
    pdf_url?: string
    lab_name?: string
    lab_city?: string
    lab_code?: string
    patient_number?: string
  }
  message?: string
}

const ORDER_SELECT = `
  id,
  sample_id,
  created_at,
  lab_id,
  patient:patients (
    name,
    gender,
    age,
    patient_number
  ),
  doctor
`

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Get sample_id from query params OR request body
    const url = new URL(req.url)
    let sampleId = url.searchParams.get('id') || url.searchParams.get('sample_id')
    let labId = url.searchParams.get('lab_id')
    let labCode = url.searchParams.get('lab_code') || url.searchParams.get('lab')

    // If POST, merge request body with query params.
    if (req.method === 'POST') {
      try {
        const body = await req.json()
        sampleId = sampleId || body.id || body.sample_id
        labId = body.lab_id || labId
        labCode = body.lab_code || body.lab || labCode
      } catch (_e) {
        // Body parsing failed, continue with null sampleId
      }
    }

    if (!sampleId) {
      return new Response(
        JSON.stringify({
          status: 'error',
          message: 'Missing sample_id parameter'
        } as VerificationResponse),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    // Create Supabase client with SERVICE ROLE (server-side only)
    // This bypasses RLS and allows secure querying
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    )

    // Check if sampleId looks like a UUID (contains hyphens and hex chars in UUID format)
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sampleId)

    if (!labId && labCode) {
      const { data: scopedLab, error: labLookupError } = await supabaseClient
        .from('labs')
        .select('id')
        .eq('code', labCode)
        .maybeSingle()

      if (labLookupError) {
        throw labLookupError
      }

      labId = scopedLab?.id || null
    }

    let order = null
    let orderError = null
    let isAmbiguous = false

    if (isUUID) {
      // Prefer immutable order UUIDs. They are globally unique, unlike sample_id.
      const result = await supabaseClient
        .from('orders')
        .select(ORDER_SELECT)
        .eq('id', sampleId)
        .maybeSingle()
      order = result.data
      orderError = result.error

      if (!order && !orderError) {
        let query = supabaseClient
          .from('orders')
          .select(ORDER_SELECT)
          .eq('sample_id', sampleId)
          .limit(2)

        if (labId) query = query.eq('lab_id', labId)

        const fallback = await query
        order = fallback.data?.[0] || null
        orderError = fallback.error
        isAmbiguous = !labId && (fallback.data?.length || 0) > 1
      }
    } else {
      // Legacy/public URLs may still pass sample_id. Scope by lab when
      // provided; otherwise detect duplicates instead of returning a random lab.
      let query = supabaseClient
        .from('orders')
        .select(ORDER_SELECT)
        .eq('sample_id', sampleId)
        .limit(2)

      if (labId) query = query.eq('lab_id', labId)

      const result = await query
      order = result.data?.[0] || null
      orderError = result.error
      isAmbiguous = !labId && (result.data?.length || 0) > 1
    }

    if (isAmbiguous) {
      return new Response(
        JSON.stringify({
          status: 'error',
          message: 'Sample ID exists in more than one lab. Please verify using the QR code from the report or include lab_code.'
        } as VerificationResponse),
        {
          status: 409,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    if (orderError || !order) {
      console.log('Order not found:', sampleId, orderError)
      return new Response(
        JSON.stringify({
          status: 'not_found',
          message: 'Report not found in our records'
        } as VerificationResponse),
        {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    // Fetch the issuing lab's public info
    const { data: lab } = await supabaseClient
      .from('labs')
      .select('name, city, code')
      .eq('id', order.lab_id)
      .maybeSingle()

    // Get the report PDF URL
    const { data: report } = await supabaseClient
      .from('reports')
      .select('pdf_url')
      .eq('order_id', order.id)
      .single()

    const patient = Array.isArray(order.patient) ? order.patient[0] : order.patient

    // Return verification data (only minimal necessary info)
    const response: VerificationResponse = {
      status: 'verified',
      data: {
        sample_id: order.sample_id,
        created_at: order.created_at,
        patient_name: patient?.name || 'Unknown',
        patient_gender: patient?.gender,
        patient_age: patient?.age,
        doctor: order.doctor || 'Self',
        pdf_url: report?.pdf_url || undefined,
        lab_name: lab?.name || undefined,
        lab_city: lab?.city || undefined,
        lab_code: lab?.code || undefined,
        patient_number: patient?.patient_number || undefined,
      }
    }

    return new Response(
      JSON.stringify(response),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )

  } catch (error) {
    console.error('Verification error:', error)
    return new Response(
      JSON.stringify({
        status: 'error',
        message: 'Internal server error during verification'
      } as VerificationResponse),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }
})
