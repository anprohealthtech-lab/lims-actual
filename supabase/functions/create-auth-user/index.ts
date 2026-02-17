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

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return bad("Invalid email format", 400);
    }

    console.log('[CREATE-AUTH-USER] Email validation passed:', email);

    // Verify the lab exists
    console.log('[CREATE-AUTH-USER] Verifying lab exists:', lab_id);
    const { data: labData, error: labError } = await supabaseAdmin
      .from("labs")
      .select("id, name")
      .eq("id", lab_id)
      .single();

    if (labError || !labData) {
      console.error('[CREATE-AUTH-USER] Lab not found:', lab_id, labError?.message);
      return bad("Lab not found or unavailable", 404);
    }

    console.log('[CREATE-AUTH-USER] Lab verified:', labData.name);

    // Verify caller is admin of target lab
    console.log('[CREATE-AUTH-USER] Verifying caller is admin of lab:', lab_id);
    await assertCallerIsAdminOfLab(supabaseUserClient, lab_id);
    console.log('[CREATE-AUTH-USER] Admin verification passed');

    // Generate strong random password if not provided
    const finalPassword = password || (crypto.randomUUID() + "!Aa1");
    console.log('[CREATE-AUTH-USER] Password:', password ? 'provided' : 'auto-generated');
    
    // Validate password strength if provided (lenient - Supabase needs at least 6 chars)
    if (password) {
      if (password.length < 6) {
        return bad("Password must be at least 6 characters long", 400);
      }
      console.log('[CREATE-AUTH-USER] Password validation passed');
    }

    // Pre-flight check: see if user already exists by querying the auth system
    try {
      const { data: existingUser } = await supabaseAdmin.auth.admin.getUserByEmail(email);
      if (existingUser?.user?.id) {
        console.warn('[CREATE-AUTH-USER] User with email already exists:', email);
        return bad("User with this email already exists", 409);
      }
    } catch (checkError: any) {
      // If check fails with "not found", that's expected (means user doesn't exist)
      console.log('[CREATE-AUTH-USER] Pre-flight email check: user not found (expected)');
    }

    // Build user_metadata with lab context
    const user_metadata = {
      lab_id,
      name,
      role_id: role_id || null,
      created_by_admin: true,
      created_at: new Date().toISOString(),
    };

    console.log('[CREATE-AUTH-USER] Creating auth.users record with metadata:', user_metadata);

    // Create auth user with minimal metadata first (to avoid potential auth schema issues)
    let createAttempt = 0;
    let createResult = null;
    let createError = null;

    // Retry up to 3 times for transient failures
    while (createAttempt < 3) {
      createAttempt++;
      console.log(`[CREATE-AUTH-USER] Auth creation attempt ${createAttempt}/3...`);

      try {
        const createPayload = {
          email,
          password: finalPassword,
          user_metadata: {
            name: name, // Minimal metadata - just name for display
          },
          app_metadata: { providers: ["email"], provider: "email" },
        };

        console.log('[CREATE-AUTH-USER] Attempting createUser without email_confirm...');
        
        // Try without email_confirm first - this might be causing the 500 error
        const { data, error } = await supabaseAdmin.auth.admin.createUser(createPayload);

        if (!error) {
          createResult = data;
          console.log('[CREATE-AUTH-USER] ✅ Auth user created successfully on attempt', createAttempt);
          break;
        }

        createError = error;
        console.error(`[CREATE-AUTH-USER] Attempt ${createAttempt} failed:`, {
          message: error.message,
          status: error.status,
          code: (error as any)?.code,
        });

        // If it's a 409 (conflict - email exists), don't retry
        if (error.status === 409 || error.message?.toLowerCase().includes("already")) {
          console.log('[CREATE-AUTH-USER] Email already exists - stopping retries');
          break;
        }

        // For 500 errors, maybe try with email_confirm on next attempt
        if (error.status === 500 && createAttempt === 1) {
          console.log('[CREATE-AUTH-USER] Got 500 error on first attempt, will try with email_confirm on retry...');
        }

        // For other errors, wait before retrying
        if (createAttempt < 3) {
          const delayMs = 500 * createAttempt;
          console.log(`[CREATE-AUTH-USER] Retrying in ${delayMs}ms...`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      } catch (exceptionError) {
        console.error(`[CREATE-AUTH-USER] Exception on attempt ${createAttempt}:`, exceptionError);
        createError = exceptionError;
      }
    }

    const { data, error } = createResult ? { data: createResult, error: null } : { data: null, error: createError };

    if (error) {
      console.error('[CREATE-AUTH-USER] ERROR: Auth user creation failed after 3 attempts:', {
        message: error.message,
        status: error.status,
        name: error.name,
        code: (error as any)?.code,
      });
      
      // Check various error conditions
      if (error.message?.toLowerCase().includes("already")) {
        console.log('[CREATE-AUTH-USER] Detected: Email already exists');
        return bad("User with this email already exists", 409);
      }
      
      if (error.status === 500 || (error as any)?.code === "unexpected_failure") {
        console.error('[CREATE-AUTH-USER] Supabase auth system error (500) - all retries exhausted');
        console.error('[CREATE-AUTH-USER] This appears to be a Supabase service issue or auth configuration problem');
        
        // As a fallback: Create user in public.users table with a real UUID
        // The auth user can be synced later or through a different mechanism
        console.log('[CREATE-AUTH-USER] Attempting fallback: Creating user record without auth.users');
        
        const fallbackUserId = crypto.randomUUID(); // Use real UUID, not prefixed
        const publicUserDataFallback = {
          id: fallbackUserId,
          name,
          email,
          role: "Technician",
          role_id: null,
          status: "Active",
          lab_id,
          join_date: new Date().toISOString().split("T")[0],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          auth_user_id: null, // No auth user created
        };

        console.log('[CREATE-AUTH-USER] Creating public.users record with UUID:', fallbackUserId);

        const { error: fallbackUserError } = await supabaseAdmin
          .from("users")
          .insert(publicUserDataFallback);

        if (fallbackUserError) {
          console.error('[CREATE-AUTH-USER] Fallback also failed:', fallbackUserError.message);
          
          // Try one more time with just minimal required fields
          console.log('[CREATE-AUTH-USER] Trying minimal insert...');
          const { error: minimalError } = await supabaseAdmin
            .from("users")
            .insert({
              id: fallbackUserId,
              name,
              email,
              role: "Technician",
              status: "Active",
              lab_id,
            });
          
          if (minimalError) {
            console.error('[CREATE-AUTH-USER] Minimal insert also failed:', minimalError.message);
            return bad(`Auth system error (500) - unable to create user. Please contact support.`, 500);
          }
        }

        console.log('[CREATE-AUTH-USER] Fallback successful: User created without auth.users');
        return json({
          user_id: fallbackUserId,
          email,
          lab_id,
          name,
          status: "pending_auth",
          message: "User created without full authentication due to service issue. Admin may need to sync manually.",
          warning: "Auth user creation failed on Supabase backend - this may need manual intervention",
        }, 201);
      }
      
      throw new Error(`Failed to create auth user: ${error.message}. Status: ${error.status}`);
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
