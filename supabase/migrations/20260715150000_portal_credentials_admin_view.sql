-- Stores portal login passwords (staff + B2B portal) so lab admins can look them up.
-- Supabase Auth only keeps hashes, so passwords are recorded here at the moment an
-- admin sets them (user creation, admin reset, B2B portal creation). Rows are written
-- exclusively by edge functions using the service role; clients can only SELECT, and
-- only when they are an admin/owner/lab_manager of the same lab.

CREATE TABLE IF NOT EXISTS public.portal_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_id uuid NOT NULL,
  credential_type text NOT NULL CHECK (credential_type IN ('staff', 'b2b_portal', 'patient_portal')),
  auth_user_id uuid,
  account_id uuid,
  email text NOT NULL,
  password_text text NOT NULL,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT portal_credentials_lab_type_email_key UNIQUE (lab_id, credential_type, email)
);

CREATE INDEX IF NOT EXISTS idx_portal_credentials_lab_user ON public.portal_credentials (lab_id, auth_user_id);
CREATE INDEX IF NOT EXISTS idx_portal_credentials_lab_account ON public.portal_credentials (lab_id, account_id);

ALTER TABLE public.portal_credentials ENABLE ROW LEVEL SECURITY;

-- Read-only for lab admins. No INSERT/UPDATE/DELETE policies: only the service role
-- (edge functions) can write.
DROP POLICY IF EXISTS "portal_credentials_admin_select" ON public.portal_credentials;
CREATE POLICY "portal_credentials_admin_select" ON public.portal_credentials
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.users u
      LEFT JOIN public.user_roles r ON r.id = u.role_id
      WHERE (u.id = auth.uid() OR u.auth_user_id = auth.uid())
        AND u.lab_id = portal_credentials.lab_id
        AND r.role_code IN ('admin', 'owner', 'lab_manager')
    )
  );
