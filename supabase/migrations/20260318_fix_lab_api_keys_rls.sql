-- Fix RLS INSERT policy on lab_api_keys (add explicit WITH CHECK)
DROP POLICY IF EXISTS "Lab users can manage their api keys" ON public.lab_api_keys;

CREATE POLICY "Lab users can manage their api keys"
  ON public.lab_api_keys
  FOR ALL
  USING (lab_id IN (SELECT lab_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (lab_id IN (SELECT lab_id FROM public.users WHERE id = auth.uid()));
