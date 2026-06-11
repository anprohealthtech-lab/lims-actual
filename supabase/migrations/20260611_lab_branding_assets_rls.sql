-- Allow lab users to read their lab's branding assets
CREATE POLICY "Lab users can read their lab branding assets"
ON public.lab_branding_assets
FOR SELECT
USING (
  lab_id IN (
    SELECT u.lab_id FROM public.users u
    WHERE u.email = auth.jwt() ->> 'email'
    AND u.status = 'Active'
  )
);

-- Allow B2B account users to read the lab's branding assets (for logo display)
CREATE POLICY "B2B accounts can read lab branding assets"
ON public.lab_branding_assets
FOR SELECT
USING (
  (auth.jwt() -> 'user_metadata' ->> 'role') = 'b2b_account'
  AND lab_id = (
    SELECT a.lab_id FROM public.accounts a
    WHERE a.id = (auth.jwt() -> 'user_metadata' ->> 'account_id')::uuid
  )
);
