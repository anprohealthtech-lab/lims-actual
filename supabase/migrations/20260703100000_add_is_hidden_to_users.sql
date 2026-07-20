-- Add is_hidden column to users table for soft delete functionality
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_hidden boolean DEFAULT false;

-- Update the v_users_with_permissions view to include is_hidden
CREATE OR REPLACE VIEW public.v_users_with_permissions AS
SELECT
  u.id,
  u.name,
  u.email,
  u.contact_number,
  u.gender,
  u.status,
  u.join_date,
  u.last_login,
  u.lab_id,
  u.is_phlebotomist,
  u.is_hidden,
  r.name as role_name,
  r.code as role_code,
  COALESCE(r.permissions, '{}') as permissions,
  COALESCE(
    (SELECT array_agg(l.name)
     FROM user_location_assignments ula
     JOIN locations l ON ula.location_id = l.id
     WHERE ula.user_id = u.id),
    '{}'
  ) as assigned_centers
FROM users u
LEFT JOIN roles r ON u.role_id = r.id;

-- Grant permissions
GRANT SELECT ON public.v_users_with_permissions TO authenticated;

COMMENT ON COLUMN public.users.is_hidden IS 'When true, user is soft-deleted and should not appear in user management lists';
