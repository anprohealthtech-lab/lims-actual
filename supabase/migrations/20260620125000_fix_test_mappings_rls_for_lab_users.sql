-- Fix test_mappings RLS for app users.
--
-- The original policy compared test_mappings.lab_id with auth.uid(), but
-- auth.uid() is the authenticated user id, not the lab id. The application
-- resolves lab context from public.users/user metadata, so inserts
-- from the Test Group analyzer mapping UI were rejected by RLS.

ALTER TABLE public.test_mappings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Labs can manage own mappings" ON public.test_mappings;
DROP POLICY IF EXISTS "Lab users can manage test mappings" ON public.test_mappings;

CREATE POLICY "Lab users can manage test mappings"
  ON public.test_mappings
  FOR ALL
  USING (
    auth.jwt() ->> 'role' = 'service_role'
    OR lab_id = NULLIF(auth.jwt() -> 'user_metadata' ->> 'lab_id', '')::uuid
    OR lab_id IN (
      SELECT u.lab_id
      FROM public.users u
      WHERE u.lab_id IS NOT NULL
        AND (
          u.id = auth.uid()
          OR u.auth_user_id = auth.uid()
          OR lower(u.email) = lower(COALESCE(auth.jwt() ->> 'email', ''))
        )
        AND COALESCE(u.status, 'Active') = 'Active'
    )
  )
  WITH CHECK (
    auth.jwt() ->> 'role' = 'service_role'
    OR lab_id = NULLIF(auth.jwt() -> 'user_metadata' ->> 'lab_id', '')::uuid
    OR lab_id IN (
      SELECT u.lab_id
      FROM public.users u
      WHERE u.lab_id IS NOT NULL
        AND (
          u.id = auth.uid()
          OR u.auth_user_id = auth.uid()
          OR lower(u.email) = lower(COALESCE(auth.jwt() ->> 'email', ''))
        )
        AND COALESCE(u.status, 'Active') = 'Active'
    )
  );
