WITH desired_permissions(permission_name, permission_code, description, category) AS (
  VALUES
    ('View Users', 'users.view', 'View user management screens and user records', 'User Management'),
    ('Create Users', 'users.create', 'Create new users and invite staff', 'User Management'),
    ('Edit Users', 'users.edit', 'Edit user roles, assignments, and profile fields', 'User Management'),
    ('Deactivate Users', 'users.deactivate', 'Deactivate or suspend users', 'User Management'),
    ('Reset User Passwords', 'users.reset_password', 'Reset passwords for other users', 'User Management'),
    ('View Settings', 'settings.view', 'Open settings pages and read configuration', 'Settings'),
    ('Edit Lab Settings', 'settings.edit_lab', 'Change lab-level settings', 'Settings'),
    ('Manage Report Sections', 'settings.manage_report_sections', 'Configure report sections and templates', 'Settings'),
    ('View Results Workbench', 'results.view', 'Open result entry and verification workbenches', 'Results'),
    ('Enter General Results', 'results.enter_general', 'Enter non-radiology results', 'Results'),
    ('Enter Radiology Results', 'results.enter_radiology', 'Enter radiology findings and results', 'Results'),
    ('Verify Results', 'results.verify', 'Verify and approve non-radiology results', 'Results'),
    ('Verify Radiology Results', 'results.verify_radiology', 'Verify radiology findings and reports', 'Results'),
    ('Verify Section Only Results', 'results.verify_section_only', 'Verify section-only reports', 'Results'),
    ('Unapprove Results', 'results.unapprove', 'Revert approved results back to pending', 'Results'),
    ('Edit Technician Sections', 'sections.edit_technician', 'Edit technician-allowed report sections', 'Report Sections'),
    ('Edit Doctor Sections', 'sections.edit_doctor', 'Edit doctor report sections during verification', 'Report Sections'),
    ('Edit Radiology Sections', 'sections.edit_radiology', 'Edit radiology report sections', 'Report Sections'),
    ('Connect WhatsApp', 'whatsapp.connect', 'Connect and manage WhatsApp session access', 'WhatsApp'),
    ('Send WhatsApp Messages', 'whatsapp.send', 'Send messages and reports through WhatsApp', 'WhatsApp')
),
updated_existing AS (
  UPDATE public.permissions p
  SET
    permission_name = d.permission_name,
    permission_code = d.permission_code,
    description = d.description,
    category = d.category,
    is_active = true
  FROM desired_permissions d
  WHERE p.permission_code = d.permission_code
     OR p.permission_name = d.permission_name
  RETURNING p.id
)
INSERT INTO public.permissions (permission_name, permission_code, description, category)
SELECT d.permission_name, d.permission_code, d.description, d.category
FROM desired_permissions d
WHERE NOT EXISTS (
  SELECT 1
  FROM public.permissions p
  WHERE p.permission_code = d.permission_code
     OR p.permission_name = d.permission_name
);

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT ur.id, p.id
FROM public.user_roles ur
JOIN public.permissions p ON p.permission_code IN (
  'users.view',
  'users.create',
  'users.edit',
  'users.deactivate',
  'users.reset_password',
  'settings.view',
  'settings.edit_lab',
  'settings.manage_report_sections',
  'results.view',
  'results.enter_general',
  'results.enter_radiology',
  'results.verify',
  'results.verify_radiology',
  'results.verify_section_only',
  'results.unapprove',
  'sections.edit_technician',
  'sections.edit_doctor',
  'sections.edit_radiology',
  'whatsapp.connect',
  'whatsapp.send'
)
WHERE ur.role_code = 'admin'
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT ur.id, p.id
FROM public.user_roles ur
JOIN public.permissions p ON p.permission_code IN (
  'users.view',
  'users.create',
  'users.edit',
  'users.deactivate',
  'users.reset_password',
  'settings.view',
  'settings.edit_lab',
  'settings.manage_report_sections',
  'results.view',
  'results.enter_general',
  'results.enter_radiology',
  'results.verify',
  'results.verify_radiology',
  'results.verify_section_only',
  'results.unapprove',
  'sections.edit_technician',
  'sections.edit_doctor',
  'sections.edit_radiology',
  'whatsapp.connect',
  'whatsapp.send'
)
WHERE ur.role_code IN ('lab_manager', 'manager')
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT ur.id, p.id
FROM public.user_roles ur
JOIN public.permissions p ON p.permission_code IN (
  'results.view',
  'results.enter_general',
  'sections.edit_technician'
)
WHERE ur.role_code = 'technician'
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT ur.id, p.id
FROM public.user_roles ur
JOIN public.permissions p ON p.permission_code IN (
  'results.view',
  'results.verify',
  'results.verify_section_only',
  'sections.edit_doctor'
)
WHERE ur.role_code = 'doctor'
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.get_effective_permissions(p_user_id uuid)
RETURNS varchar[]
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(DISTINCT permission_code::varchar), ARRAY[]::varchar[])
  FROM (
    SELECT p.permission_code::varchar AS permission_code
    FROM public.users u
    JOIN public.user_roles ur ON ur.id = u.role_id
    JOIN public.role_permissions rp ON rp.role_id = ur.id
    JOIN public.permissions p ON p.id = rp.permission_id
    WHERE u.id = p_user_id
      AND u.status = 'Active'
      AND ur.is_active = true
      AND p.is_active = true

    UNION

    SELECT unnest(COALESCE(u.permissions, ARRAY[]::varchar[]))::varchar
    FROM public.users u
    WHERE u.id = p_user_id
      AND u.status = 'Active'
  ) merged;
$$;

CREATE OR REPLACE FUNCTION public.user_has_permission(
  p_user_id uuid,
  p_permission_code varchar
) RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_permission_code = ANY(public.get_effective_permissions(p_user_id));
$$;

CREATE OR REPLACE FUNCTION public.current_user_has_permission(p_permission_code text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH current_lims_user AS (
    SELECT u.id
    FROM public.users u
    WHERE u.id = auth.uid()
       OR u.auth_user_id = auth.uid()
    ORDER BY CASE WHEN u.id = auth.uid() THEN 0 ELSE 1 END
    LIMIT 1
  )
  SELECT EXISTS (
    SELECT 1
    FROM current_lims_user clu
    WHERE public.user_has_permission(clu.id, p_permission_code)
  );
$$;

CREATE OR REPLACE VIEW public.v_users_with_permissions AS
SELECT
  u.id,
  u.name,
  u.email,
  u.username,
  u.contact_number,
  u.gender,
  u.status,
  u.join_date,
  u.last_login,
  u.lab_id,
  u.department_id,
  u.auth_user_id,
  u.is_phlebotomist,
  ur.id AS role_id,
  ur.role_name,
  ur.role_code,
  public.get_effective_permissions(u.id) AS permissions,
  array_agg(DISTINCT uc.location_id) FILTER (WHERE uc.location_id IS NOT NULL) AS assigned_centers,
  COALESCE(u.permissions, ARRAY[]::varchar[]) AS extra_permissions
FROM public.users u
LEFT JOIN public.user_roles ur ON u.role_id = ur.id
LEFT JOIN public.user_centers uc ON u.id = uc.user_id
WHERE u.status = 'Active'
GROUP BY
  u.id, u.name, u.email, u.username, u.contact_number, u.gender,
  u.status, u.join_date, u.last_login, u.lab_id, u.department_id,
  u.auth_user_id, u.is_phlebotomist, u.permissions, ur.id, ur.role_name, ur.role_code;

GRANT EXECUTE ON FUNCTION public.get_effective_permissions(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_has_permission(uuid, varchar) TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_has_permission(text) TO authenticated;

COMMENT ON FUNCTION public.get_effective_permissions IS 'Returns merged role permissions and per-user extra permissions';
COMMENT ON FUNCTION public.user_has_permission IS 'Checks if a user has a specific effective permission';
COMMENT ON FUNCTION public.current_user_has_permission IS 'Checks effective permission for the currently authenticated user';
COMMENT ON VIEW public.v_users_with_permissions IS 'User details with role, extra permissions, and effective merged permissions';
