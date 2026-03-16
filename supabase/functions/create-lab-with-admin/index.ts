// Purpose: Public endpoint to create a new lab with admin user
// This is used for new lab onboarding
// Route: POST /create-lab-with-admin
// Body:
// {
//   "lab_name": "Lab Name",
//   "address": "Lab Address",
//   "city": "City",
//   "state": "State",
//   "pincode": "123456",
//   "phone": "+91...",
//   "email": "lab@example.com",
//   "admin_name": "Admin Name",
//   "admin_email": "admin@example.com",
//   "admin_password": "password" (optional - auto-generated if not provided)
// }

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

interface CreateLabPayload {
  lab_name: string;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  country_code?: string;
  phone?: string;
  email?: string;
  gstin?: string;
  admin_name: string;
  admin_email: string;
  admin_password?: string;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...corsHeaders,
    },
  });

const bad = (msg: string, status = 400) => json({ error: msg }, status);

const getSupabaseAdmin = () => {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, serviceKey, { auth: { persistSession: false } });
};

Deno.serve(async (req: Request) => {
  // Handle CORS preflight request
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  try {
    if (req.method !== "POST") return bad("Use POST", 405);

    const supabaseAdmin = getSupabaseAdmin();

    const body = (await req.json()) as CreateLabPayload;
    const {
      lab_name,
      address,
      city,
      state,
      pincode,
      country_code,
      phone,
      email,
      gstin,
      admin_name,
      admin_email,
      admin_password,
    } = body;

    // Build full phone with country code
    const fullPhone = phone ? `${country_code || '+91'}${phone.replace(/^(\+\d+)/, '')}` : null;

    console.log('[CREATE-LAB-WITH-ADMIN] Request:', { lab_name, admin_email });

    // Validate required fields
    if (!lab_name) return bad("lab_name is required");
    if (!admin_name) return bad("admin_name is required");
    if (!admin_email) return bad("admin_email is required");

    // Validate email format (basic check)
    if (!admin_email.includes('@') || !admin_email.includes('.')) {
      return bad("admin_email must be a valid email address (e.g., user@example.com)");
    }

    // Check if admin email already exists in public.users
    const { data: existingUsers } = await supabaseAdmin
      .from("users")
      .select("id, lab_id")
      .eq("email", admin_email)
      .limit(1);

    if (existingUsers && existingUsers.length > 0) {
      return bad("A user with this email already exists", 409);
    }

    // Check for orphaned auth.users record (from previous failed attempts)
    // GoTrue may have created the auth user but the trigger/subsequent step failed
    console.log('[CREATE-LAB-WITH-ADMIN] Checking for orphaned auth user...');
    try {
      const { data: authListResult } = await supabaseAdmin.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
      });
      const orphanedAuthUser = authListResult?.users?.find(
        (u: { email?: string }) => u.email?.toLowerCase() === admin_email.toLowerCase()
      );
      if (orphanedAuthUser) {
        console.warn('[CREATE-LAB-WITH-ADMIN] Found orphaned auth user, cleaning up:', orphanedAuthUser.id);
        // Delete the orphaned auth user so we can recreate cleanly
        const { error: deleteOrphanError } = await supabaseAdmin.auth.admin.deleteUser(orphanedAuthUser.id);
        if (deleteOrphanError) {
          console.error('[CREATE-LAB-WITH-ADMIN] Failed to delete orphaned auth user:', deleteOrphanError);
          return bad("An orphaned auth account exists for this email. Please contact support.", 409);
        }
        // Also clean up any partial public.users record
        await supabaseAdmin.from("users").delete().eq("id", orphanedAuthUser.id);
        // Clean up any labs/locations created by previous failed attempts for this email
        console.log('[CREATE-LAB-WITH-ADMIN] Orphaned auth user cleaned up successfully');
      }
    } catch (listErr) {
      console.warn('[CREATE-LAB-WITH-ADMIN] Could not check for orphaned auth users:', listErr);
      // Continue anyway
    }

    // 1. Create the lab with inactive status
    console.log('[CREATE-LAB-WITH-ADMIN] Creating lab...');
    
    // Generate a unique lab code from the lab name
    const labCodePrefix = lab_name.replace(/[^a-zA-Z]/g, '').substring(0, 3).toUpperCase() || 'LAB';
    const labCodeSuffix = Math.floor(1000 + Math.random() * 9000); // 4 digit random
    const labCode = `${labCodePrefix}${labCodeSuffix}`;
    
    const { data: labData, error: labError } = await supabaseAdmin
      .from("labs")
      .insert({
        name: lab_name,
        code: labCode,
        address: address || null,
        city: city || null,
        state: state || null,
        pincode: pincode || null,
        phone: fullPhone || null,
        email: email || admin_email,
        gstin: gstin || null,
        is_active: true,
        plan_status: 'trial', // New labs start with 5-day trial
        plan_started_at: new Date().toISOString(),
        active_upto: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(), // 5 days from now
        // Default PDF settings
        pdf_layout_settings: {
          headerTextColor: 'white',
          resultColors: {
            high: '#dc2626',
            low: '#2563eb',
            critical: '#7c2d12',
            abnormal: '#ea580c',
            normal: '#16a34a'
          }
        }
      })
      .select()
      .single();

    if (labError) {
      console.error('[CREATE-LAB-WITH-ADMIN] ERROR: Failed to create lab:', labError);
      throw new Error(`Failed to create lab: ${labError.message}`);
    }

    const labId = labData.id;
    console.log('[CREATE-LAB-WITH-ADMIN] Lab created with ID:', labId);

    // 2. Create default location for the lab
    console.log('[CREATE-LAB-WITH-ADMIN] Creating default location...');
    const { data: locationData, error: locationError } = await supabaseAdmin
      .from("locations")
      .insert({
        lab_id: labId,
        name: `${lab_name} - Main`,
        code: 'MAIN',
        type: 'diagnostic_center',
        address: address || null,
        city: city || null,
        state: state || null,
        pincode: pincode || null,
        phone: fullPhone || null,
        email: email || admin_email,
        is_active: true,
        is_collection_center: true,
        is_processing_center: true,
        can_receive_samples: true,
        supports_cash_collection: true,
        is_main_lab: true,
      })
      .select('id')
      .single();

    if (locationError) {
      console.warn('[CREATE-LAB-WITH-ADMIN] WARNING: Failed to create default location:', locationError.message);
      // Don't fail the entire operation
    } else {
      console.log('[CREATE-LAB-WITH-ADMIN] Default location created with ID:', locationData?.id);
      
      // Update lab with default_processing_location_id
      if (locationData?.id) {
        const { error: updateLabError } = await supabaseAdmin
          .from("labs")
          .update({ default_processing_location_id: locationData.id })
          .eq("id", labId);
        
        if (updateLabError) {
          console.warn('[CREATE-LAB-WITH-ADMIN] WARNING: Failed to set default location on lab:', updateLabError.message);
        } else {
          console.log('[CREATE-LAB-WITH-ADMIN] Lab default location set');
        }
      }
    }

    // 3. Get admin role ID
    const { data: adminRole } = await supabaseAdmin
      .from("user_roles")
      .select("id")
      .eq("role_code", "admin")
      .single();

    const adminRoleId = adminRole?.id;
    console.log('[CREATE-LAB-WITH-ADMIN] Admin role ID:', adminRoleId || 'not found');

    // 4. Create auth user for admin
    const finalPassword = admin_password || (crypto.randomUUID().substring(0, 12) + "!Aa1");
    console.log('[CREATE-LAB-WITH-ADMIN] Creating auth user...');

    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: admin_email,
      password: finalPassword,
      email_confirm: true,
      user_metadata: {
        lab_id: labId,
        name: admin_name,
        role: 'Admin',
        role_id: adminRoleId || null,
        created_at: new Date().toISOString(),
      },
      app_metadata: { providers: ["email"], provider: "email" },
    });

    if (authError) {
      console.error('[CREATE-LAB-WITH-ADMIN] ERROR: Failed to create auth user:', authError);
      // Rollback: Delete the lab and location
      if (locationData?.id) {
        await supabaseAdmin.from("locations").delete().eq("id", locationData.id);
      }
      await supabaseAdmin.from("labs").delete().eq("id", labId);
      throw new Error(`Failed to create admin user: ${authError.message}`);
    }

    const adminUserId = authData.user?.id;
    console.log('[CREATE-LAB-WITH-ADMIN] Auth user created with ID:', adminUserId);

    // 5. Upsert public.users record (trigger may have already created a row)
    const { error: userError } = await supabaseAdmin
      .from("users")
      .upsert({
        id: adminUserId,
        name: admin_name,
        email: admin_email,
        role: "Admin",
        role_id: adminRoleId,
        status: "Active",
        lab_id: labId,
        department: "Administration",
        join_date: new Date().toISOString().split("T")[0],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id' });

    if (userError) {
      console.error('[CREATE-LAB-WITH-ADMIN] ERROR: Failed to create public user:', userError);
      // Rollback
      await supabaseAdmin.auth.admin.deleteUser(adminUserId!);
      await supabaseAdmin.from("labs").delete().eq("id", labId);
      throw new Error(`Failed to create user record: ${userError.message}`);
    }

    console.log('[CREATE-LAB-WITH-ADMIN] Public user created');

    // 6. Run lab onboarding (populate test groups, analytes, packages, invoice templates)
    // This is REQUIRED for a usable new lab. If onboarding fails, rollback the created entities.
    console.log('[CREATE-LAB-WITH-ADMIN] Running lab onboarding (required)...');
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      // Rollback
      await supabaseAdmin.from("users").delete().eq("id", adminUserId!);
      await supabaseAdmin.auth.admin.deleteUser(adminUserId!);
      await supabaseAdmin.from("locations").delete().eq("lab_id", labId);
      await supabaseAdmin.from("labs").delete().eq("id", labId);
      throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY for onboarding");
    }

    let onboardingOk = false;
    let onboardingLastError = '';
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const onboardingResponse = await fetch(`${supabaseUrl}/functions/v1/onboarding-lab`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${serviceRoleKey}`,
          },
          body: JSON.stringify({ lab_id: labId, mode: 'sync' }),
        });

        if (onboardingResponse.ok) {
          const onboardingResult = await onboardingResponse.json();
          console.log('[CREATE-LAB-WITH-ADMIN] Onboarding complete. Stats:', JSON.stringify(onboardingResult.stats));
          onboardingOk = true;
          break;
        }

        onboardingLastError = `onboarding-lab returned ${onboardingResponse.status}: ${await onboardingResponse.text()}`;
        console.warn(`[CREATE-LAB-WITH-ADMIN] Onboarding attempt ${attempt}/3 failed: ${onboardingLastError}`);
      } catch (onboardingErr) {
        onboardingLastError = onboardingErr instanceof Error ? onboardingErr.message : String(onboardingErr);
        console.warn(`[CREATE-LAB-WITH-ADMIN] Onboarding attempt ${attempt}/3 error: ${onboardingLastError}`);
      }

      // small backoff before retry
      await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }

    if (!onboardingOk) {
      // Rollback to avoid partially initialized labs
      console.error('[CREATE-LAB-WITH-ADMIN] ERROR: onboarding failed, rolling back lab/admin creation');
      await supabaseAdmin.from("users").delete().eq("id", adminUserId!);
      await supabaseAdmin.auth.admin.deleteUser(adminUserId!);
      await supabaseAdmin.from("locations").delete().eq("lab_id", labId);
      await supabaseAdmin.from("labs").delete().eq("id", labId);
      throw new Error(`Failed to initialize lab catalog data: ${onboardingLastError || 'unknown onboarding error'}`);
    }

    console.log('[CREATE-LAB-WITH-ADMIN] SUCCESS: Lab and admin created');

    return json({
      success: true,
      lab: {
        id: labId,
        name: lab_name,
        status: 'trial',
        trial_ends_at: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
      },
      admin: {
        id: adminUserId,
        email: admin_email,
        name: admin_name,
        temporary_password: admin_password ? undefined : finalPassword,
      },
      message: "Lab created successfully with a 5-day free trial. Subscribe to continue after trial ends.",
    });

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[CREATE-LAB-WITH-ADMIN] ERROR:", msg);
    return bad(msg, 400);
  }
});
