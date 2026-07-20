import { createClient } from "npm:@supabase/supabase-js@2.50.5";

type AdminAction =
  | "overview"
  | "assign_users_to_lab"
  | "extend_trial"
  | "set_lab_status"
  | "copy_lab_catalog"
  | "sync_catalog"
  | "repair_section_order"
  | "repair_dependencies";

type RequestBody = {
  action?: AdminAction;
  lab_id?: string;
  user_emails?: string[];
  user_ids?: string[];
  days?: number;
  plan_status?: "trial" | "active" | "inactive" | "suspended";
  source_lab_id?: string;
  target_lab_id?: string;
  category?: string;
  department?: string;
  search?: string;
  overwrite_existing?: boolean;
  include_billing_item_types?: boolean;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });

const fail = (message: string, status = 400) => json({ success: false, error: message }, status);

const getEnv = (key: string) => {
  const value = Deno.env.get(key);
  if (!value) throw new Error(`Missing ${key}`);
  return value;
};

const supabaseUrl = () => getEnv("SUPABASE_URL");
const serviceRoleKey = () => getEnv("SUPABASE_SERVICE_ROLE_KEY");

const getAdminClient = () =>
  createClient(supabaseUrl(), serviceRoleKey(), {
    auth: { persistSession: false },
  });

const parseAdminEmails = () =>
  new Set(
    (Deno.env.get("ADMIN_EMAILS") || "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );

const requireAdmin = async (req: Request) => {
  const allowedEmails = parseAdminEmails();
  if (allowedEmails.size === 0) {
    throw new Error("ADMIN_EMAILS is not configured");
  }

  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("Missing Authorization bearer token");

  const supabaseAdmin = getAdminClient();
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user?.email) {
    throw new Error("Invalid admin session");
  }

  const email = data.user.email.toLowerCase();
  if (!allowedEmails.has(email)) {
    throw new Error(`${email} is not allowed to use admin-ops`);
  }

  return { supabaseAdmin, actor: data.user };
};

const requireLabId = (body: RequestBody) => {
  if (!body.lab_id) throw new Error("lab_id is required");
  return body.lab_id;
};

const chunk = <T,>(items: T[], size: number) => {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

const REST_IN_FILTER_CHUNK_SIZE = 50;

const overview = async (supabaseAdmin: ReturnType<typeof getAdminClient>) => {
  const [{ data: labs, error: labsError }, { data: users, error: usersError }] = await Promise.all([
    supabaseAdmin
      .from("labs")
      .select("id, name, code, city, phone, email, is_active, plan_status, active_upto, created_at")
      .order("created_at", { ascending: false })
      .limit(1000),
    supabaseAdmin
      .from("users")
      .select("id, name, email, role, status, lab_id")
      .order("name", { ascending: true })
      .limit(2000),
  ]);

  if (labsError) throw new Error(labsError.message);
  if (usersError) throw new Error(usersError.message);

  return json({ success: true, labs: labs || [], users: users || [] });
};

const ensureLabExists = async (supabaseAdmin: ReturnType<typeof getAdminClient>, labId: string) => {
  const { data, error } = await supabaseAdmin
    .from("labs")
    .select("id, name, active_upto")
    .eq("id", labId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Lab not found");
  return data;
};

const assignUsersToLab = async (
  supabaseAdmin: ReturnType<typeof getAdminClient>,
  body: RequestBody,
) => {
  const labId = requireLabId(body);
  await ensureLabExists(supabaseAdmin, labId);

  const emails = (body.user_emails || []).map((email) => email.trim().toLowerCase()).filter(Boolean);
  const ids = (body.user_ids || []).map((id) => id.trim()).filter(Boolean);
  if (emails.length === 0 && ids.length === 0) {
    throw new Error("Provide user_emails or user_ids");
  }

  const { data: adminRole } = await supabaseAdmin
    .from("user_roles")
    .select("id")
    .eq("role_code", "admin")
    .maybeSingle();

  let query = supabaseAdmin
    .from("users")
    .select("id, auth_user_id, name, email, role, lab_id");

  if (emails.length > 0 && ids.length > 0) {
    query = query.or(`email.in.(${emails.join(",")}),id.in.(${ids.join(",")})`);
  } else if (emails.length > 0) {
    query = query.in("email", emails);
  } else {
    query = query.in("id", ids);
  }

  const { data: users, error: usersError } = await query;
  if (usersError) throw new Error(usersError.message);
  if (!users || users.length === 0) throw new Error("No matching existing users found");

  const updated: Array<Record<string, unknown>> = [];
  for (const user of users) {
    const { error: updateError } = await supabaseAdmin
      .from("users")
      .update({
        lab_id: labId,
        role: "Admin",
        role_id: adminRole?.id || null,
        status: "Active",
        department: "Administration",
        updated_at: new Date().toISOString(),
      })
      .eq("id", user.id);

    if (updateError) throw new Error(`Failed to update ${user.email}: ${updateError.message}`);

    const authUserId = user.auth_user_id || user.id;
    const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(authUserId);
    if (authUser?.user) {
      await supabaseAdmin.auth.admin.updateUserById(authUserId, {
        user_metadata: {
          ...(authUser.user.user_metadata || {}),
          lab_id: labId,
          role: "Admin",
          role_id: adminRole?.id || null,
        },
      });
    }

    updated.push({
      id: user.id,
      email: user.email,
      previous_lab_id: user.lab_id,
      new_lab_id: labId,
    });
  }

  return json({
    success: true,
    message: `Updated ${updated.length} user(s) to selected lab.`,
    updated,
  });
};

const extendTrial = async (
  supabaseAdmin: ReturnType<typeof getAdminClient>,
  body: RequestBody,
) => {
  const labId = requireLabId(body);
  const lab = await ensureLabExists(supabaseAdmin, labId);
  const days = Math.max(1, Math.min(365, Number(body.days || 7)));
  const base = lab.active_upto && new Date(lab.active_upto) > new Date()
    ? new Date(lab.active_upto)
    : new Date();
  const activeUpto = new Date(base.getTime() + days * 86400000).toISOString();

  const { error } = await supabaseAdmin
    .from("labs")
    .update({
      plan_status: "trial",
      is_active: true,
      active_upto: activeUpto,
      updated_at: new Date().toISOString(),
    })
    .eq("id", labId);

  if (error) throw new Error(error.message);
  return json({
    success: true,
    message: `Trial extended by ${days} day(s).`,
    active_upto: activeUpto,
  });
};

const setLabStatus = async (
  supabaseAdmin: ReturnType<typeof getAdminClient>,
  body: RequestBody,
) => {
  const labId = requireLabId(body);
  const planStatus = body.plan_status || "active";
  await ensureLabExists(supabaseAdmin, labId);

  const patch: Record<string, unknown> = {
    plan_status: planStatus,
    is_active: planStatus === "active" || planStatus === "trial",
    updated_at: new Date().toISOString(),
  };
  if (planStatus === "active") patch.active_upto = null;

  const { error } = await supabaseAdmin.from("labs").update(patch).eq("id", labId);
  if (error) throw new Error(error.message);

  return json({
    success: true,
    message: `Lab status set to ${planStatus}.`,
    plan_status: planStatus,
  });
};

const normalizeKey = (value: unknown) => String(value || "").trim().toLowerCase();

const copyLabCatalog = async (
  supabaseAdmin: ReturnType<typeof getAdminClient>,
  body: RequestBody,
) => {
  const sourceLabId = body.source_lab_id;
  const targetLabId = body.target_lab_id || body.lab_id;
  if (!sourceLabId) throw new Error("source_lab_id is required");
  if (!targetLabId) throw new Error("target_lab_id is required");
  if (sourceLabId === targetLabId) throw new Error("Source and target labs must be different");

  await ensureLabExists(supabaseAdmin, sourceLabId);
  await ensureLabExists(supabaseAdmin, targetLabId);

  const overwriteExisting = body.overwrite_existing === true;
  const categoryFilter = normalizeKey(body.category);
  const departmentFilter = normalizeKey(body.department);
  const searchFilter = normalizeKey(body.search);

  const testGroupColumns = [
    "id",
    "name",
    "code",
    "category",
    "clinical_purpose",
    "price",
    "turnaround_time",
    "sample_type",
    "requires_fasting",
    "is_active",
    "default_ai_processing_type",
    "group_level_prompt",
    "to_be_copied",
    "description",
    "department",
    "tat_hours",
    "test_type",
    "gender",
    "sample_color",
    "barcode_suffix",
    "lmp_required",
    "id_required",
    "consent_form",
    "pre_collection_guidelines",
    "flabs_id",
    "only_female",
    "only_male",
    "only_billing",
    "start_from_next_page",
    "ai_config",
    "ref_range_ai_config",
    "required_patient_inputs",
    "methodology",
    "analyte_count",
    "default_template_style",
    "print_options",
    "collection_charge",
    "report_priority",
    "group_interpretation",
    "is_section_only",
    "global_test_catalog_id",
    "collection_checklist",
    "sample_condition_options",
    "default_sample_condition",
  ].join(", ");

  const { data: sourceTestGroups, error: sourceTestGroupsError } = await supabaseAdmin
    .from("test_groups")
    .select(testGroupColumns)
    .eq("lab_id", sourceLabId)
    .order("name", { ascending: true })
    .limit(5000);

  if (sourceTestGroupsError) throw new Error(sourceTestGroupsError.message);

  const sourceTestGroupRows = (sourceTestGroups || []) as unknown as Array<Record<string, unknown>>;
  const selectedTestGroups = sourceTestGroupRows.filter((group) => {
    if (categoryFilter && normalizeKey(group.category) !== categoryFilter) return false;
    if (departmentFilter && normalizeKey(group.department) !== departmentFilter) return false;
    if (searchFilter) {
      const haystack = [group.name, group.code, group.category, group.department]
        .map((value) => normalizeKey(value))
        .join(" ");
      if (!haystack.includes(searchFilter)) return false;
    }
    return true;
  });

  if (selectedTestGroups.length === 0) {
    return json({
      success: true,
      message: "No matching source test groups found.",
      stats: {
        source_test_groups_seen: sourceTestGroups?.length || 0,
        selected_test_groups: 0,
      },
    });
  }

  const sourceTestGroupIds = selectedTestGroups.map((group) => group.id);
  const sourceAnalyteRows: Array<Record<string, unknown>> = [];
  for (const groupChunk of chunk(sourceTestGroupIds, REST_IN_FILTER_CHUNK_SIZE)) {
    const { data, error } = await supabaseAdmin
      .from("test_group_analytes")
      .select("id, test_group_id, analyte_id, display_order, is_visible, attachment_required, custom_reference_range, is_header, header_name, sort_order, section_heading, analyte_name, test_group_name, lab_analyte_id, report_display_options")
      .in("test_group_id", groupChunk);
    if (error) throw new Error(error.message);
    sourceAnalyteRows.push(...(data || []));
  }

  const sourceAnalyteIds = [...new Set(sourceAnalyteRows.map((row) => row.analyte_id).filter(Boolean) as string[])];
  const labAnalyteColumns = [
    "id",
    "lab_id",
    "analyte_id",
    "is_active",
    "visible",
    "lab_specific_reference_range",
    "lab_specific_interpretation_low",
    "lab_specific_interpretation_normal",
    "lab_specific_interpretation_high",
    "lab_specific_unit",
    "lab_specific_name",
    "reference_range_male",
    "reference_range_female",
    "reference_range",
    "critical_low",
    "critical_high",
    "interpretation_low",
    "interpretation_normal",
    "interpretation_high",
    "unit",
    "name",
    "low_critical",
    "high_critical",
    "category",
    "method",
    "description",
    "is_critical",
    "normal_range_min",
    "normal_range_max",
    "value_type",
    "expected_normal_values",
    "flag_rules",
    "code",
    "ref_range_knowledge",
    "lab_specific_method",
    "expected_value_flag_map",
    "display_name",
    "analyte_name",
    "is_calculated",
    "formula",
    "formula_variables",
    "formula_description",
    "calculation_result_type",
    "ai_processing_type",
    "expected_value_codes",
    "default_value",
    "ai_prompt_override",
    "group_ai_mode",
  ].join(", ");

  const sourceLabAnalytes: Array<Record<string, unknown>> = [];
  if (sourceAnalyteIds.length > 0) {
    for (const analyteChunk of chunk(sourceAnalyteIds, REST_IN_FILTER_CHUNK_SIZE)) {
      const { data, error } = await supabaseAdmin
        .from("lab_analytes")
        .select(labAnalyteColumns)
        .eq("lab_id", sourceLabId)
        .in("analyte_id", analyteChunk);
      if (error) throw new Error(error.message);
      sourceLabAnalytes.push(...((data || []) as unknown as Array<Record<string, unknown>>));
    }
  }

  const targetLabAnalytes: Array<Record<string, unknown>> = [];
  if (sourceAnalyteIds.length > 0) {
    for (const analyteChunk of chunk(sourceAnalyteIds, REST_IN_FILTER_CHUNK_SIZE)) {
      const { data, error } = await supabaseAdmin
        .from("lab_analytes")
        .select("id, analyte_id")
        .eq("lab_id", targetLabId)
        .in("analyte_id", analyteChunk);
      if (error) throw new Error(error.message);
      targetLabAnalytes.push(...((data || []) as Array<Record<string, unknown>>));
    }
  }

  const targetLabAnalyteByAnalyteId = new Map(
    targetLabAnalytes.map((row) => [String(row.analyte_id), String(row.id)]),
  );
  const sourceLabAnalyteByAnalyteId = new Map(
    sourceLabAnalytes.map((row) => [String(row.analyte_id), row]),
  );

  let insertedLabAnalytes = 0;
  let updatedLabAnalytes = 0;
  for (const analyteId of sourceAnalyteIds) {
    const sourceLabAnalyte = sourceLabAnalyteByAnalyteId.get(analyteId);
    if (!sourceLabAnalyte) continue;

    const patch = { ...sourceLabAnalyte };
    delete patch.id;
    delete patch.lab_id;
    patch.lab_id = targetLabId;
    patch.updated_at = new Date().toISOString();

    const existingId = targetLabAnalyteByAnalyteId.get(analyteId);
    if (existingId) {
      if (!overwriteExisting) continue;
      const { error } = await supabaseAdmin
        .from("lab_analytes")
        .update(patch)
        .eq("id", existingId);
      if (error) throw new Error(error.message);
      updatedLabAnalytes++;
    } else {
      const { data, error } = await supabaseAdmin
        .from("lab_analytes")
        .insert(patch)
        .select("id, analyte_id")
        .single();
      if (error) throw new Error(error.message);
      targetLabAnalyteByAnalyteId.set(String(data.analyte_id), String(data.id));
      insertedLabAnalytes++;
    }
  }

  const { data: targetTestGroups, error: targetTestGroupsError } = await supabaseAdmin
    .from("test_groups")
    .select("id, code, name")
    .eq("lab_id", targetLabId)
    .limit(5000);
  if (targetTestGroupsError) throw new Error(targetTestGroupsError.message);

  const targetGroupByCode = new Map<string, Record<string, unknown>>(
    ((targetTestGroups || []) as Array<Record<string, unknown>>).map((group) => [normalizeKey(group.code), group]),
  );
  const targetGroupBySourceGroupId = new Map<string, string>();

  let insertedTestGroups = 0;
  let updatedTestGroups = 0;
  for (const sourceGroup of selectedTestGroups) {
    const existing = targetGroupByCode.get(normalizeKey(sourceGroup.code));
    const patch = { ...sourceGroup };
    delete patch.id;
    patch.lab_id = targetLabId;
    patch.updated_at = new Date().toISOString();
    patch.default_outsourced_lab_id = null;
    patch.analyzer_connection_id = null;
    patch.is_outsourced = false;

    if (existing) {
      targetGroupBySourceGroupId.set(String(sourceGroup.id), String(existing.id));
      if (!overwriteExisting) continue;
      const { error } = await supabaseAdmin
        .from("test_groups")
        .update(patch)
        .eq("id", existing.id);
      if (error) throw new Error(error.message);
      updatedTestGroups++;
    } else {
      const { data, error } = await supabaseAdmin
        .from("test_groups")
        .insert(patch)
        .select("id, code")
        .single();
      if (error) throw new Error(error.message);
      targetGroupBySourceGroupId.set(String(sourceGroup.id), String(data.id));
      targetGroupByCode.set(normalizeKey(data.code), data as Record<string, unknown>);
      insertedTestGroups++;
    }
  }

  const targetGroupIds = [...targetGroupBySourceGroupId.values()];
  const existingTargetAnalyteRows: Array<Record<string, unknown>> = [];
  for (const groupChunk of chunk(targetGroupIds, REST_IN_FILTER_CHUNK_SIZE)) {
    const { data, error } = await supabaseAdmin
      .from("test_group_analytes")
      .select("id, test_group_id, analyte_id")
      .in("test_group_id", groupChunk);
    if (error) throw new Error(error.message);
    existingTargetAnalyteRows.push(...(data || []));
  }

  const targetTgaByGroupAndAnalyte = new Map(
    existingTargetAnalyteRows.map((row) => [`${row.test_group_id}:${row.analyte_id}`, row]),
  );

  let insertedTestGroupAnalytes = 0;
  let updatedTestGroupAnalytes = 0;
  for (const sourceRow of sourceAnalyteRows) {
    const targetGroupId = targetGroupBySourceGroupId.get(String(sourceRow.test_group_id));
    if (!targetGroupId) continue;

    const key = `${targetGroupId}:${sourceRow.analyte_id}`;
    const existing = targetTgaByGroupAndAnalyte.get(key);
    const patch = {
      test_group_id: targetGroupId,
      analyte_id: sourceRow.analyte_id,
      display_order: sourceRow.display_order,
      is_visible: sourceRow.is_visible,
      attachment_required: sourceRow.attachment_required,
      custom_reference_range: sourceRow.custom_reference_range,
      is_header: sourceRow.is_header,
      header_name: sourceRow.header_name,
      sort_order: sourceRow.sort_order,
      section_heading: sourceRow.section_heading,
      analyte_name: sourceRow.analyte_name,
      test_group_name: sourceRow.test_group_name,
      lab_id: targetLabId,
      lab_analyte_id: targetLabAnalyteByAnalyteId.get(String(sourceRow.analyte_id)) || null,
      report_display_options: sourceRow.report_display_options || {},
    };

    if (existing) {
      if (!overwriteExisting) continue;
      const { error } = await supabaseAdmin
        .from("test_group_analytes")
        .update(patch)
        .eq("id", existing.id);
      if (error) throw new Error(error.message);
      updatedTestGroupAnalytes++;
    } else {
      const { data, error } = await supabaseAdmin
        .from("test_group_analytes")
        .insert(patch)
        .select("id, test_group_id, analyte_id")
        .single();
      if (error) throw new Error(error.message);
      targetTgaByGroupAndAnalyte.set(`${data.test_group_id}:${data.analyte_id}`, data);
      insertedTestGroupAnalytes++;
    }
  }

  const sourceSections: Array<Record<string, unknown>> = [];
  for (const groupChunk of chunk(sourceTestGroupIds, REST_IN_FILTER_CHUNK_SIZE)) {
    const { data, error } = await supabaseAdmin
      .from("lab_template_sections")
      .select("id, test_group_id, section_type, section_name, display_order, default_content, predefined_options, is_required, is_editable, placeholder_key, allow_images, allow_technician_entry, section_config, font_size")
      .eq("lab_id", sourceLabId)
      .in("test_group_id", groupChunk);
    if (error) throw new Error(error.message);
    sourceSections.push(...(data || []));
  }

  const existingTargetSections: Array<Record<string, unknown>> = [];
  for (const groupChunk of chunk(targetGroupIds, REST_IN_FILTER_CHUNK_SIZE)) {
    const { data, error } = await supabaseAdmin
      .from("lab_template_sections")
      .select("id, test_group_id, section_type, section_name, placeholder_key")
      .eq("lab_id", targetLabId)
      .in("test_group_id", groupChunk);
    if (error) throw new Error(error.message);
    existingTargetSections.push(...(data || []));
  }

  const sectionKey = (row: Record<string, unknown>, targetGroupId = row.test_group_id) =>
    `${targetGroupId}:${normalizeKey(row.section_type)}:${normalizeKey(row.placeholder_key) || normalizeKey(row.section_name)}`;

  const targetSectionByKey = new Map(existingTargetSections.map((row) => [sectionKey(row), row]));
  let insertedSections = 0;
  let updatedSections = 0;
  for (const sourceSection of sourceSections) {
    const targetGroupId = targetGroupBySourceGroupId.get(String(sourceSection.test_group_id));
    if (!targetGroupId) continue;
    const key = sectionKey(sourceSection, targetGroupId);
    const existing = targetSectionByKey.get(key);
    const patch = {
      lab_id: targetLabId,
      template_id: null,
      test_group_id: targetGroupId,
      section_type: sourceSection.section_type,
      section_name: sourceSection.section_name,
      display_order: sourceSection.display_order,
      default_content: sourceSection.default_content,
      predefined_options: sourceSection.predefined_options || [],
      is_required: sourceSection.is_required,
      is_editable: sourceSection.is_editable,
      placeholder_key: sourceSection.placeholder_key,
      allow_images: sourceSection.allow_images,
      allow_technician_entry: sourceSection.allow_technician_entry,
      section_config: sourceSection.section_config,
      font_size: sourceSection.font_size,
      updated_at: new Date().toISOString(),
    };

    if (existing) {
      if (!overwriteExisting) continue;
      const { error } = await supabaseAdmin
        .from("lab_template_sections")
        .update(patch)
        .eq("id", existing.id);
      if (error) throw new Error(error.message);
      updatedSections++;
    } else {
      const { data, error } = await supabaseAdmin
        .from("lab_template_sections")
        .insert(patch)
        .select("id, test_group_id, section_type, section_name, placeholder_key")
        .single();
      if (error) throw new Error(error.message);
      targetSectionByKey.set(sectionKey(data), data);
      insertedSections++;
    }
  }

  let insertedBillingItemTypes = 0;
  let updatedBillingItemTypes = 0;
  if (body.include_billing_item_types === true) {
    const { data: sourceBillingTypes, error: sourceBillingError } = await supabaseAdmin
      .from("lab_billing_item_types")
      .select("name, description, default_amount, is_shareable_with_doctor, is_shareable_with_phlebotomist, is_active")
      .eq("lab_id", sourceLabId)
      .limit(1000);
    if (sourceBillingError) throw new Error(sourceBillingError.message);

    const { data: targetBillingTypes, error: targetBillingError } = await supabaseAdmin
      .from("lab_billing_item_types")
      .select("id, name")
      .eq("lab_id", targetLabId)
      .limit(1000);
    if (targetBillingError) throw new Error(targetBillingError.message);

    const targetBillingByName = new Map((targetBillingTypes || []).map((row) => [normalizeKey(row.name), row]));
    for (const sourceType of sourceBillingTypes || []) {
      const existing = targetBillingByName.get(normalizeKey(sourceType.name));
      const patch = {
        ...sourceType,
        lab_id: targetLabId,
        updated_at: new Date().toISOString(),
      };

      if (existing) {
        if (!overwriteExisting) continue;
        const { error } = await supabaseAdmin
          .from("lab_billing_item_types")
          .update(patch)
          .eq("id", existing.id);
        if (error) throw new Error(error.message);
        updatedBillingItemTypes++;
      } else {
        const { data, error } = await supabaseAdmin
          .from("lab_billing_item_types")
          .insert(patch)
          .select("id, name")
          .single();
        if (error) throw new Error(error.message);
        targetBillingByName.set(normalizeKey(data.name), data);
        insertedBillingItemTypes++;
      }
    }
  }

  return json({
    success: true,
    message: `Copied ${insertedTestGroups} new test group(s), ${insertedTestGroupAnalytes} analyte link(s), and ${insertedSections} section(s).`,
    stats: {
      source_test_groups_seen: sourceTestGroups?.length || 0,
      selected_test_groups: selectedTestGroups.length,
      inserted_test_groups: insertedTestGroups,
      updated_test_groups: updatedTestGroups,
      inserted_lab_analytes: insertedLabAnalytes,
      updated_lab_analytes: updatedLabAnalytes,
      inserted_test_group_analytes: insertedTestGroupAnalytes,
      updated_test_group_analytes: updatedTestGroupAnalytes,
      inserted_lab_template_sections: insertedSections,
      updated_lab_template_sections: updatedSections,
      inserted_billing_item_types: insertedBillingItemTypes,
      updated_billing_item_types: updatedBillingItemTypes,
    },
  });
};

const syncCatalog = async (body: RequestBody) => {
  const labId = requireLabId(body);
  const response = await fetch(`${supabaseUrl()}/functions/v1/onboarding-lab`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceRoleKey()}`,
    },
    body: JSON.stringify({ lab_id: labId, mode: "sync" }),
  });

  const text = await response.text();
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    throw new Error(`onboarding-lab failed (${response.status}): ${text}`);
  }

  return json({
    success: true,
    message: "Catalog sync completed.",
    ...data,
  });
};

const repairSectionOrder = async (
  supabaseAdmin: ReturnType<typeof getAdminClient>,
  body: RequestBody,
) => {
  const labId = requireLabId(body);
  await ensureLabExists(supabaseAdmin, labId);

  const { data: testGroups, error: testGroupsError } = await supabaseAdmin
    .from("test_groups")
    .select("id, name, global_test_catalog_id")
    .eq("lab_id", labId)
    .not("global_test_catalog_id", "is", null);

  if (testGroupsError) throw new Error(testGroupsError.message);
  if (!testGroups || testGroups.length === 0) {
    return json({
      success: true,
      message: "No global-linked test groups found for this lab.",
      stats: {
        linked_test_groups: 0,
        inserted_test_group_analytes: 0,
        updated_test_group_analytes: 0,
      },
    });
  }

  const testGroupIds = testGroups.map((group) => group.id);
  const catalogIds = [...new Set(testGroups.map((group) => group.global_test_catalog_id).filter(Boolean))];
  const groupByCatalogId = new Map(testGroups.map((group) => [group.global_test_catalog_id, group]));

  const catalogAnalytes: Array<{
    catalog_id: string;
    analyte_id: string;
    section_heading: string | null;
    sort_order: number | null;
    display_order: number | null;
    is_visible: boolean | null;
    is_header: boolean | null;
    header_name: string | null;
    custom_reference_range: string | null;
  }> = [];

  for (const catalogChunk of chunk(catalogIds, REST_IN_FILTER_CHUNK_SIZE)) {
    const { data, error } = await supabaseAdmin
      .from("global_test_catalog_analytes")
      .select("catalog_id, analyte_id, section_heading, sort_order, display_order, is_visible, is_header, header_name, custom_reference_range")
      .in("catalog_id", catalogChunk);

    if (error) throw new Error(error.message);
    catalogAnalytes.push(...(data || []));
  }

  const existingTgaRows: Array<{
    id: string;
    test_group_id: string;
    analyte_id: string;
    sort_order: number | null;
    display_order: number | null;
    section_heading: string | null;
    is_visible: boolean | null;
    is_header: boolean | null;
    header_name: string | null;
    custom_reference_range: string | null;
    lab_id: string | null;
    lab_analyte_id: string | null;
  }> = [];

  for (const groupChunk of chunk(testGroupIds, REST_IN_FILTER_CHUNK_SIZE)) {
    const { data, error } = await supabaseAdmin
      .from("test_group_analytes")
      .select("id, test_group_id, analyte_id, sort_order, display_order, section_heading, is_visible, is_header, header_name, custom_reference_range, lab_id, lab_analyte_id")
      .in("test_group_id", groupChunk);

    if (error) throw new Error(error.message);
    existingTgaRows.push(...(data || []));
  }

  const existingByGroupAndAnalyte = new Map(
    existingTgaRows.map((row) => [`${row.test_group_id}:${row.analyte_id}`, row]),
  );

  const allCatalogAnalyteIds = [...new Set(catalogAnalytes.map((row) => row.analyte_id).filter(Boolean))];
  const labAnalyteByAnalyteId = new Map<string, { id: string; analyte_id: string; name: string | null; display_name: string | null; lab_specific_name: string | null }>();

  for (const analyteChunk of chunk(allCatalogAnalyteIds, REST_IN_FILTER_CHUNK_SIZE)) {
    const { data, error } = await supabaseAdmin
      .from("lab_analytes")
      .select("id, analyte_id, name, display_name, lab_specific_name")
      .eq("lab_id", labId)
      .in("analyte_id", analyteChunk);

    if (error) throw new Error(error.message);
    for (const row of data || []) {
      if (!labAnalyteByAnalyteId.has(row.analyte_id)) {
        labAnalyteByAnalyteId.set(row.analyte_id, row);
      }
    }
  }

  const globalAnalyteNameById = new Map<string, string>();
  for (const analyteChunk of chunk(allCatalogAnalyteIds, REST_IN_FILTER_CHUNK_SIZE)) {
    const { data, error } = await supabaseAdmin
      .from("analytes")
      .select("id, name")
      .in("id", analyteChunk);

    if (error) throw new Error(error.message);
    for (const row of data || []) {
      globalAnalyteNameById.set(row.id, row.name);
    }
  }

  let updatedCount = 0;
  let insertedCount = 0;
  const insertPayload: Array<Record<string, unknown>> = [];

  for (const catalogAnalyte of catalogAnalytes) {
    const group = groupByCatalogId.get(catalogAnalyte.catalog_id);
    if (!group) continue;

    const key = `${group.id}:${catalogAnalyte.analyte_id}`;
    const existing = existingByGroupAndAnalyte.get(key);
    const labAnalyte = labAnalyteByAnalyteId.get(catalogAnalyte.analyte_id);
    const desired = {
      sort_order: catalogAnalyte.sort_order ?? 0,
      display_order: catalogAnalyte.display_order ?? catalogAnalyte.sort_order ?? 0,
      section_heading: catalogAnalyte.section_heading ?? null,
      is_visible: catalogAnalyte.is_visible ?? true,
      is_header: catalogAnalyte.is_header ?? false,
      header_name: catalogAnalyte.header_name ?? null,
      custom_reference_range: catalogAnalyte.custom_reference_range ?? null,
      lab_id: labId,
      lab_analyte_id: labAnalyte?.id ?? null,
    };

    if (existing) {
      if (
        existing.sort_order === desired.sort_order &&
        existing.display_order === desired.display_order &&
        existing.section_heading === desired.section_heading &&
        existing.is_visible === desired.is_visible &&
        existing.is_header === desired.is_header &&
        existing.header_name === desired.header_name &&
        existing.custom_reference_range === desired.custom_reference_range &&
        existing.lab_id === desired.lab_id &&
        existing.lab_analyte_id === desired.lab_analyte_id
      ) {
        continue;
      }

      const { error } = await supabaseAdmin
        .from("test_group_analytes")
        .update(desired)
        .eq("id", existing.id);

      if (error) throw new Error(error.message);
      updatedCount++;
    } else {
      insertPayload.push({
        test_group_id: group.id,
        analyte_id: catalogAnalyte.analyte_id,
        analyte_name:
          labAnalyte?.display_name ||
          labAnalyte?.lab_specific_name ||
          labAnalyte?.name ||
          globalAnalyteNameById.get(catalogAnalyte.analyte_id) ||
          null,
        test_group_name: group.name,
        ...desired,
      });
    }
  }

  for (const payloadChunk of chunk(insertPayload, 500)) {
    const { error } = await supabaseAdmin
      .from("test_group_analytes")
      .insert(payloadChunk);

    if (error) throw new Error(error.message);
    insertedCount += payloadChunk.length;
  }

  return json({
    success: true,
    message: "Section heading and order repair completed.",
    stats: {
      linked_test_groups: testGroups.length,
      global_catalog_analytes_seen: catalogAnalytes.length,
      inserted_test_group_analytes: insertedCount,
      updated_test_group_analytes: updatedCount,
    },
  });
};

const repairDependencies = async (
  supabaseAdmin: ReturnType<typeof getAdminClient>,
  body: RequestBody,
) => {
  const labId = requireLabId(body);
  await ensureLabExists(supabaseAdmin, labId);

  const { data: initialLabAnalytes, error: initialLabAnalytesError } = await supabaseAdmin
    .from("lab_analytes")
    .select("id, analyte_id")
    .eq("lab_id", labId);

  if (initialLabAnalytesError) throw new Error(initialLabAnalytesError.message);

  const initialAnalyteIds = [
    ...new Set((initialLabAnalytes || []).map((row) => row.analyte_id).filter(Boolean)),
  ];

  let metadataSyncedCount = 0;
  for (const analyteChunk of chunk(initialAnalyteIds, REST_IN_FILTER_CHUNK_SIZE)) {
    const { data: globalAnalytes, error: globalError } = await supabaseAdmin
      .from("analytes")
      .select("id, is_calculated, formula, formula_variables, formula_description, calculation_result_type, value_type")
      .in("id", analyteChunk);

    if (globalError) throw new Error(globalError.message);

    const globalById = new Map((globalAnalytes || []).map((row) => [row.id, row]));
    for (const labAnalyte of initialLabAnalytes || []) {
      const globalAnalyte = globalById.get(labAnalyte.analyte_id);
      if (!globalAnalyte) continue;

      const { error: updateError } = await supabaseAdmin
        .from("lab_analytes")
        .update({
          is_calculated: globalAnalyte.is_calculated || false,
          formula: globalAnalyte.formula,
          formula_variables: globalAnalyte.formula_variables,
          formula_description: globalAnalyte.formula_description,
          calculation_result_type: globalAnalyte.calculation_result_type,
          value_type: globalAnalyte.value_type,
          updated_at: new Date().toISOString(),
        })
        .eq("id", labAnalyte.id);

      if (updateError) throw new Error(updateError.message);
      metadataSyncedCount++;
    }
  }

  const { data: labAnalytes, error: labAnalytesError } = await supabaseAdmin
    .from("lab_analytes")
    .select("id, analyte_id, is_calculated, formula, formula_variables")
    .eq("lab_id", labId);

  if (labAnalytesError) throw new Error(labAnalytesError.message);

  const allAnalyteIds = [...new Set((labAnalytes || []).map((row) => row.analyte_id).filter(Boolean))];
  const calculatedAnalyteIds = [
    ...new Set((labAnalytes || []).filter((row) => row.is_calculated).map((row) => row.analyte_id).filter(Boolean)),
  ];

  const { count: deletedCount, error: deleteError } = await supabaseAdmin
    .from("analyte_dependencies")
    .delete({ count: "exact" })
    .eq("lab_id", labId);

  if (deleteError) throw new Error(deleteError.message);

  let clonedCount = 0;
  if (calculatedAnalyteIds.length > 0 && allAnalyteIds.length > 0) {
    const allAnalyteSet = new Set(allAnalyteIds);
    const depsToInsert: Array<{
      calculated_analyte_id: string;
      source_analyte_id: string;
      variable_name: string;
      lab_id: string;
    }> = [];

    for (const calcChunk of chunk(calculatedAnalyteIds, REST_IN_FILTER_CHUNK_SIZE)) {
      const { data: globalDeps, error: depsError } = await supabaseAdmin
        .from("analyte_dependencies")
        .select("calculated_analyte_id, source_analyte_id, variable_name")
        .is("lab_id", null)
        .in("calculated_analyte_id", calcChunk);

      if (depsError) throw new Error(depsError.message);

      for (const dep of globalDeps || []) {
        if (allAnalyteSet.has(dep.source_analyte_id)) {
          depsToInsert.push({
            calculated_analyte_id: dep.calculated_analyte_id,
            source_analyte_id: dep.source_analyte_id,
            variable_name: dep.variable_name,
            lab_id: labId,
          });
        }
      }
    }

    for (const depChunk of chunk(depsToInsert, 500)) {
      const { error: insertError } = await supabaseAdmin
        .from("analyte_dependencies")
        .insert(depChunk);
      if (insertError) throw new Error(insertError.message);
      clonedCount += depChunk.length;
    }
  }

  let syncedCount = 0;
  for (const calcChunk of chunk(calculatedAnalyteIds, REST_IN_FILTER_CHUNK_SIZE)) {
    if (calcChunk.length === 0) continue;
    const { data: globalAnalytes, error: globalError } = await supabaseAdmin
      .from("analytes")
      .select("id, formula, formula_variables")
      .in("id", calcChunk)
      .eq("is_calculated", true);

    if (globalError) throw new Error(globalError.message);

    for (const analyte of globalAnalytes || []) {
      const matchingRows = (labAnalytes || []).filter((row) => row.analyte_id === analyte.id);
      for (const labAnalyte of matchingRows) {
        const oldFormulaVariables = JSON.stringify(labAnalyte.formula_variables ?? null);
        const newFormulaVariables = JSON.stringify(analyte.formula_variables ?? null);
        if (labAnalyte.formula === analyte.formula && oldFormulaVariables === newFormulaVariables) {
          continue;
        }

        const { error: updateError } = await supabaseAdmin
          .from("lab_analytes")
          .update({
            formula: analyte.formula,
            formula_variables: analyte.formula_variables,
            updated_at: new Date().toISOString(),
          })
          .eq("id", labAnalyte.id);

        if (updateError) throw new Error(updateError.message);
        syncedCount++;
      }
    }
  }

  return json({
    success: true,
    message: "Dependency repair completed.",
    stats: {
      synced_calculation_metadata: metadataSyncedCount,
      deleted_lab_dependencies: deletedCount || 0,
      cloned_global_dependencies: clonedCount,
      synced_lab_analyte_formulas: syncedCount,
      calculated_analytes_seen: calculatedAnalyteIds.length,
      lab_analytes_seen: allAnalyteIds.length,
    },
  });
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return fail("Use POST", 405);
  }

  try {
    const { supabaseAdmin, actor } = await requireAdmin(req);
    const body = (await req.json()) as RequestBody;
    const action = body.action;
    if (!action) throw new Error("action is required");

    console.log("[admin-ops]", action, {
      actor: actor.email,
      lab_id: body.lab_id || null,
    });

    switch (action) {
      case "overview":
        return await overview(supabaseAdmin);
      case "assign_users_to_lab":
        return await assignUsersToLab(supabaseAdmin, body);
      case "extend_trial":
        return await extendTrial(supabaseAdmin, body);
      case "set_lab_status":
        return await setLabStatus(supabaseAdmin, body);
      case "copy_lab_catalog":
        return await copyLabCatalog(supabaseAdmin, body);
      case "sync_catalog":
        return await syncCatalog(body);
      case "repair_section_order":
        return await repairSectionOrder(supabaseAdmin, body);
      case "repair_dependencies":
        return await repairDependencies(supabaseAdmin, body);
      default:
        return fail(`Unknown action: ${action}`, 400);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[admin-ops] error", message);
    return fail(message, message.includes("allowed") || message.includes("session") ? 403 : 400);
  }
});
