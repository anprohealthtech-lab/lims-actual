// Purpose: Admin-only endpoint to reset any lab user's password directly
// No email sent — password is changed immediately by an admin
// Route: POST /admin-reset-password
// Body: { "target_user_id": "uuid", "new_password": "string" }

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

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

const getEffectivePermissions = async (
  supabaseAdmin: ReturnType<typeof createClient>,
  roleId: string | null,
  extraPermissions: string[] | null | undefined,
) => {
  const { data: rolePermissions } = roleId
    ? await supabaseAdmin
        .from("role_permissions")
        .select("permissions(permission_code)")
        .eq("role_id", roleId)
    : { data: [] as any[] };

  const roleCodes = (rolePermissions || [])
    .map((entry: any) => entry.permissions?.permission_code)
    .filter(Boolean);

  return new Set([...(extraPermissions || []), ...roleCodes]);
};

Deno.serve(async (req: Request) => {
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
    const supabaseUser = getSupabaseForUser(req);

    const body = await req.json();
    const { target_user_id, new_password } = body as {
      target_user_id: string;
      new_password: string;
    };

    if (!target_user_id) return bad("target_user_id is required");
    if (!new_password) return bad("new_password is required");
    if (new_password.length < 6) return bad("Password must be at least 6 characters");

    // Identify the calling admin
    const { data: { user: callerAuth }, error: callerAuthError } = await supabaseUser.auth.getUser();
    if (callerAuthError || !callerAuth) return bad("Unauthorized", 401);

    // Look up caller's lab and role
    const { data: caller, error: callerError } = await supabaseAdmin
      .from("users")
      .select("id, lab_id, role_id, permissions, role:user_roles(role_code)")
      .or(`id.eq.${callerAuth.id},auth_user_id.eq.${callerAuth.id}`)
      .maybeSingle();

    if (callerError || !caller) return bad("Caller user not found", 403);

    const callerRole = (caller.role as any)?.role_code;
    const callerPermissions = await getEffectivePermissions(
      supabaseAdmin,
      (caller as any).role_id || null,
      (caller as any).permissions || [],
    );

    if (!["admin", "owner", "lab_manager"].includes(callerRole) && !callerPermissions.has("users.reset_password")) {
      return bad("Only admins and lab managers can reset passwords", 403);
    }

    // Look up the target user — must be in the same lab
    const { data: target, error: targetError } = await supabaseAdmin
      .from("users")
      .select("id, lab_id, name, email, auth_user_id, role")
      .eq("id", target_user_id)
      .single();

    if (targetError || !target) return bad("Target user not found", 404);
    if (target.lab_id !== caller.lab_id) return bad("Cannot reset password for users outside your lab", 403);

    // Prevent resetting own password through this endpoint (use profile settings instead)
    if (target_user_id === callerAuth.id) {
      return bad("Use your profile settings to change your own password", 400);
    }

    // The auth_user_id is the auth.users id (= public.users.id in this schema)
    const authUserId = target.auth_user_id || target.id;

    console.log(`[ADMIN-RESET-PASSWORD] Resetting password for user ${target.email} (${authUserId}) by admin ${callerAuth.email}`);

    const { error: resetError } = await supabaseAdmin.auth.admin.updateUserById(authUserId, {
      password: new_password,
    });

    if (resetError) {
      console.error("[ADMIN-RESET-PASSWORD] Reset failed:", resetError.message);
      throw new Error(`Failed to reset password: ${resetError.message}`);
    }

    console.log(`[ADMIN-RESET-PASSWORD] Password reset successfully for ${target.email}`);

    // Record the new password so lab admins can look it up later
    // (portal_credentials is admin-read-only via RLS, written only with service role)
    try {
      const credentialType = (target as any).role === "B2B Account" ? "b2b_portal" : "staff";
      const { error: credError } = await supabaseAdmin
        .from("portal_credentials")
        .upsert({
          lab_id: target.lab_id,
          credential_type: credentialType,
          auth_user_id: authUserId,
          email: target.email,
          password_text: new_password,
          updated_by: callerAuth.id,
          updated_at: new Date().toISOString(),
        }, { onConflict: "lab_id,credential_type,email" });
      if (credError) console.warn("[ADMIN-RESET-PASSWORD] Could not store credential:", credError.message);
    } catch (credErr) {
      console.warn("[ADMIN-RESET-PASSWORD] Credential store failed:", credErr);
    }

    return json({
      success: true,
      message: `Password reset successfully for ${target.name}`,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[ADMIN-RESET-PASSWORD] ERROR:", msg);
    return bad(msg, 500);
  }
});
