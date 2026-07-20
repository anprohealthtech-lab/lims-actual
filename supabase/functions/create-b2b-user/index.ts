// Purpose: Create auth user for B2B account portal access
// Route: POST /create-b2b-user
// Body:
// {
//   "email": "user@hospital.com",
//   "password": "SecureP@ss123",
//   "account_id": "uuid",
//   "account_name": "Hospital Name",
//   "lab_id": "uuid"
// }

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { email, password, account_id, account_name, name, lab_id } = await req.json();
    const displayName = account_name || name || 'B2B Account';

    // Validate required fields
    if (!email || !password || !account_id || !lab_id) {
      return json({ error: 'Missing required fields: email, password, account_id, lab_id' }, 400);
    }

    // Initialize Supabase admin client
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    );

    console.log('[CREATE-B2B-USER] Creating B2B user:', { email, account_id, lab_id });

    // Create auth user with B2B metadata
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // Skip email verification for B2B accounts
      user_metadata: {
        role: 'b2b_account',
        account_id,
        account_name: displayName,
        lab_id,
        created_at: new Date().toISOString(),
      },
      app_metadata: {
        provider: 'email',
        providers: ['email'],
      },
    });

    if (authError) {
      console.error('[CREATE-B2B-USER] Auth error:', authError);
      
      // Check if user already exists
      const authMessage = authError.message || '';
      const authCode = (authError as any)?.code;
      if (
        authCode === 'email_exists' ||
        authError.status === 409 ||
        authMessage.toLowerCase().includes('already') ||
        authMessage.toLowerCase().includes('registered')
      ) {
        return json({
          error: 'A user with this email is already registered. Use a different portal email, or reset/update the existing login.',
          code: 'email_exists',
          email,
        }, 409);
      }
      
      return json({
        error: `Failed to create auth user: ${authMessage || 'Unknown auth error'}`,
        code: authCode || 'auth_create_failed',
      }, authError.status || 500);
    }

    const userId = authData.user?.id;
    if (!userId) {
      throw new Error('User creation returned no ID');
    }

    console.log('[CREATE-B2B-USER] Auth user created:', userId);

    // Optionally create a record in public.users table for tracking
    // This is optional - B2B users don't need full user records
    // They only need auth.users with proper metadata
    try {
      const { error: userRecordError } = await supabaseAdmin
        .from('users')
        .insert({
          id: userId,
          email,
          name: displayName || email,
          role: 'B2B Account', // Custom role for B2B
          status: 'Active',
          lab_id,
          join_date: new Date().toISOString().split('T')[0],
        });

      if (userRecordError) {
        console.warn('[CREATE-B2B-USER] Could not create public.users record:', userRecordError);
        // Don't fail - auth user is created, which is sufficient
      }
    } catch (e) {
      console.warn('[CREATE-B2B-USER] Public user record creation failed:', e);
      // Continue - not critical
    }

    // Record the portal password so lab admins can look it up later
    // (portal_credentials is admin-read-only via RLS, written only with service role)
    try {
      const { error: credError } = await supabaseAdmin
        .from('portal_credentials')
        .upsert({
          lab_id,
          credential_type: 'b2b_portal',
          auth_user_id: userId,
          account_id,
          email,
          password_text: password,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'lab_id,credential_type,email' });
      if (credError) console.warn('[CREATE-B2B-USER] Could not store portal credential:', credError.message);
    } catch (credErr) {
      console.warn('[CREATE-B2B-USER] Credential store failed:', credErr);
    }

    console.log('[CREATE-B2B-USER] SUCCESS: B2B user created');

    return json({
        success: true,
        user_id: userId,
        email,
        account_id,
        message: 'B2B portal access created successfully',
      });

  } catch (error) {
    console.error('[CREATE-B2B-USER] ERROR:', error);
    return json({
      error: error instanceof Error ? error.message : 'Unknown error',
      code: 'unexpected_error',
    }, 500);
  }
});
