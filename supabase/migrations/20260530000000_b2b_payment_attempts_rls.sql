-- Allow B2B portal users to view their own payment attempts.
DROP POLICY IF EXISTS "B2B users can view own payment attempts" ON public.b2b_payment_attempts;

CREATE POLICY "B2B users can view own payment attempts"
  ON public.b2b_payment_attempts
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (
    (auth.jwt() -> 'user_metadata' ->> 'role') = 'b2b_account'
    AND account_id = ((auth.jwt() -> 'user_metadata' ->> 'account_id')::text)::uuid
  );

GRANT SELECT ON public.b2b_payment_attempts TO authenticated;
