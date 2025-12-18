// Purpose: Admin-only endpoint to create auth.users with metadata
// Then webhook auto-syncs to public.users table
// Route: POST /create-auth-user
// Body:
// {
//   "email": "user@example.com",
//   "password": "StrongP@ssw0rd!", (optional - auto-generated if not provided)
//   "lab_id": "uuid",
//   "name": "User Name",
//   "role_id": "uuid"  (optional - for role_by_org mapping)
// }

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

type CreateAuthUserPayload = {
  email: string;
  password?: string;
  lab_id: string;
  name: string;
  role_id?: string;
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });

const bad = (msg: string, status = 400) => json({ error: msg }, status);

const getSupabaseAdmin = () => {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, serviceKey, { auth: { persistSession: false } });
};

const getSupabaseForUser = (req: Request) => {
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anonKey) throw new Error("Missing SUPABASE_URL or SUPABASE_ANON_KEY");
  const authHeader = req.headers.get("Authorization") || "";
  return createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, detectSessionInUrl: false },
  });
};

async function assertCallerIsAdminOfLab(
  supabaseUserClient: ReturnType<typeof createClient>,
  lab_id: string
) {
  // Query uses caller JWT (RLS enforced) to check if user belongs to lab with admin role
  const { data: userData, error: userError } = await supabaseUserClient
    .from("users")
    .select("id, lab_id, role_id, role:user_roles(role_code)")
    .eq("id", (await supabaseUserClient.auth.getUser()).data.user?.id)
    .single();

  if (userError) throw new Error(`Auth check failed: ${userError.message}`);
  if (!userData) throw new Error("User not found");
  if (userData.lab_id !== lab_id) throw new Error("User is not a member of target lab");
  
  // Check if user has admin-level role
  const roleCode = (userData.role as any)?.role_code;
  if (!["admin", "owner"].includes(roleCode)) {
    throw new Error("User must have admin or owner role");
  }
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight request
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  try {
    if (req.method !== "POST") return bad("Use POST", 405);

    const supabaseAdmin = getSupabaseAdmin();
    const supabaseUserClient = getSupabaseForUser(req);

    const body = (await req.json()) as CreateAuthUserPayload;
    const { email, password, lab_id, name, role_id } = body;

    console.log('[CREATE-AUTH-USER] Request:', { email, lab_id, name, role_id: role_id || 'auto' });

    if (!email) return bad("email is required");
    if (!lab_id) return bad("lab_id is required");
    if (!name) return bad("name is required");

    // Verify caller is admin of target lab
    console.log('[CREATE-AUTH-USER] Verifying caller is admin of lab:', lab_id);
    await assertCallerIsAdminOfLab(supabaseUserClient, lab_id);
    console.log('[CREATE-AUTH-USER] Admin verification passed');

    // Generate strong random password if not provided
    const finalPassword = password || (crypto.randomUUID() + "!Aa1");
    console.log('[CREATE-AUTH-USER] Password:', password ? 'provided' : 'auto-generated');

    // Build user_metadata with lab context
    const user_metadata = {
      lab_id,
      name,
      role_id: role_id || null,
      created_by_admin: true,
      created_at: new Date().toISOString(),
    };

    console.log('[CREATE-AUTH-USER] Creating auth.users record with metadata:', user_metadata);

    // Try creating auth user with minimal data first (to bypass potential trigger issues)
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: finalPassword,
      email_confirm: true, // Skip email verification - admin created
      user_metadata: {}, // Start with empty metadata to avoid trigger issues
      app_metadata: { providers: ["email"], provider: "email" },
    });

    if (error) {
      console.error('[CREATE-AUTH-USER] ERROR: Auth user creation failed:', {
        message: error.message,
        status: error.status,
        name: error.name,
        details: JSON.stringify(error)
      });
      // Check if user already exists
      if (error.message?.includes("already")) {
        return bad("User with this email already exists", 409);
      }
      throw new Error(`Failed to create auth user: ${error.message}`);
    }

    const newUserId = data.user?.id;
    if (!newUserId) throw new Error("User creation returned no id");
    
    console.log('[CREATE-AUTH-USER] Auth user created with ID:', newUserId);

    // Now update user metadata
    try {
      await supabaseAdmin.auth.admin.updateUserById(newUserId, {
        user_metadata
      });
      console.log('[CREATE-AUTH-USER] User metadata updated successfully');
    } catch (metaError) {
      console.warn('[CREATE-AUTH-USER] WARNING: Failed to update metadata:', metaError);
      // Don't fail the operation
    }

    // Get default technician role ID
    let technicianRoleId: string | null = null;
    if (!role_id) {
      console.log('[CREATE-AUTH-USER] Fetching default technician role...');
      const { data: roles, error: roleError } = await supabaseAdmin
        .from("user_roles")
        .select("id")
        .eq("role_code", "technician")
        .single();
      
      if (roleError) {
        console.warn('[CREATE-AUTH-USER] WARNING: Failed to fetch technician role:', roleError.message);
      }
      
      technicianRoleId = roles?.id || null;
      console.log('[CREATE-AUTH-USER] Default role ID:', technicianRoleId || 'not found');
    }

    const publicUserData = {
      id: newUserId,
      name,
      email,
      role: "Technician", // Use enum value directly
      role_id: role_id || technicianRoleId,
      status: "Active",
      lab_id,
      join_date: new Date().toISOString().split("T")[0],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    console.log('[CREATE-AUTH-USER] Creating public.users record manually:', publicUserData);

    // Create public.users record manually (trigger is unreliable)
    const { error: userError } = await supabaseAdmin
      .from("users")
      .insert(publicUserData);

    if (userError) {
      console.error('[CREATE-AUTH-USER] ERROR: Database error creating public.users:', {
        message: userError.message,
        details: userError.details,
        hint: userError.hint,
        code: userError.code
      });
      throw new Error(`Database error creating new user: ${userError.message}`);
    }
    
    console.log('[CREATE-AUTH-USER] SUCCESS: Public user record created');

    // Note: Trigger may also create a record, but our manual insert handles it

    console.log('[CREATE-AUTH-USER] SUCCESS: User creation completed successfully');

    return json({
      user_id: newUserId,
      email,
      lab_id,
      name,
      status: "auth_created",
      message: "Auth user created successfully. Public record auto-synced. Edit user to add additional details.",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[CREATE-AUTH-USER] ERROR:", msg);
    console.error("[CREATE-AUTH-USER] Stack trace:", e instanceof Error ? e.stack : 'No stack trace');
    return bad(msg, 400);
  }
});
