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
  }
  message?: string
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Get sample_id from query params OR request body
    const url = new URL(req.url)
    let sampleId = url.searchParams.get('id') || url.searchParams.get('sample_id')
    
    // If not in query params, check request body
    if (!sampleId && req.method === 'POST') {
      try {
        const body = await req.json()
        sampleId = body.id || body.sample_id
      } catch (e) {
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

    // Query orders table by sample_id first (for QR codes like "31-Jan-2026-001")
    // Then fallback to UUID id if it looks like a UUID
    // Use service role to bypass RLS
    
    // Check if sampleId looks like a UUID (contains hyphens and hex chars)
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sampleId)
    
    let order = null
    let orderError = null
    
    if (isUUID) {
      // If it's a UUID, search by id OR sample_id
      const result = await supabaseClient
        .from('orders')
        .select(`
          id,
          sample_id,
          created_at,
          patient:patients (
            name,
            gender,
            age
          ),
          doctor
        `)
        .or(`id.eq.${sampleId},sample_id.eq.${sampleId}`)
        .maybeSingle()
      order = result.data
      orderError = result.error
    } else {
      // Not a UUID, search by sample_id only (avoid UUID parsing error)
      const result = await supabaseClient
        .from('orders')
        .select(`
          id,
          sample_id,
          created_at,
          patient:patients (
            name,
            gender,
            age
          ),
          doctor
        `)
        .eq('sample_id', sampleId)
        .maybeSingle()
      order = result.data
      orderError = result.error
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

    // Get the report PDF URL
    const { data: report } = await supabaseClient
      .from('reports')
      .select('pdf_url')
      .eq('order_id', order.id)
      .single()

    // Return verification data (only minimal necessary info)
    const response: VerificationResponse = {
      status: 'verified',
      data: {
        sample_id: order.sample_id,
        created_at: order.created_at,
        patient_name: order.patient?.name || 'Unknown',
        patient_gender: order.patient?.gender,
        patient_age: order.patient?.age,
        doctor: order.doctor || 'Self',
        pdf_url: report?.pdf_url || undefined
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
