// Purpose: Sync auth.users record to public.users table
// This is a fallback/helper function to manually sync records if webhook doesn't fire
// Route: POST /sync-auth-to-users

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

type SyncPayload = {
  user_id: string;
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

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
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

    const body = (await req.json()) as SyncPayload;
    const { user_id } = body;

    if (!user_id) return bad("user_id is required");

    const supabaseAdmin = getSupabaseAdmin();

    // Get auth user details
    const { data: { user: authUser }, error: authError } = await supabaseAdmin.auth.admin.getUserById(user_id);

    if (authError || !authUser) {
      return bad(`Auth user not found: ${authError?.message || "unknown error"}`, 404);
    }

    // Extract metadata
    const name = authUser.user_metadata?.name || authUser.email || "Unknown";
    const email = authUser.email || "";
    const lab_id = authUser.user_metadata?.lab_id;
    const role_id = authUser.user_metadata?.role_id;

    if (!lab_id) {
      return bad("User metadata missing lab_id", 400);
    }

    // Get default role if not specified
    let finalRoleId = role_id;
    if (!finalRoleId) {
      const { data: roles } = await supabaseAdmin
        .from("user_roles")
        .select("id")
        .eq("role_code", "technician")
        .single();
      finalRoleId = roles?.id;
    }

    // Create or update public.users record
    const { data: syncedUser, error: syncError } = await supabaseAdmin
      .from("users")
      .upsert({
        id: user_id,
        name,
        email,
        role: "Technician", // Default role from enum
        role_id: finalRoleId,
        status: "Active",
        lab_id,
        join_date: new Date().toISOString().split("T")[0],
        created_at: authUser.created_at,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: "id",
      });

    if (syncError) {
      return bad(`Failed to sync user: ${syncError.message}`, 400);
    }

    return json({
      success: true,
      user_id,
      message: "User synced to public.users successfully",
      synced_user: syncedUser,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("Error in sync-auth-to-users:", msg);
    return bad(msg, 400);
  }
});
