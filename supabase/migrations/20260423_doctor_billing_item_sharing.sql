-- Add doctor_billing_item_sharing table so shareable billing items
-- can have per-doctor sharing % overrides (same as test_groups via doctor_test_sharing)

BEGIN;

CREATE TABLE IF NOT EXISTS public.doctor_billing_item_sharing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_id uuid NOT NULL REFERENCES public.labs(id) ON DELETE CASCADE,
  doctor_id uuid NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
  billing_item_type_id uuid NOT NULL REFERENCES public.lab_billing_item_types(id) ON DELETE CASCADE,
  sharing_percent numeric(5,2) NOT NULL CHECK (sharing_percent BETWEEN 0 AND 100),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(doctor_id, billing_item_type_id)
);

CREATE INDEX IF NOT EXISTS idx_doctor_billing_item_sharing_doctor_id
  ON public.doctor_billing_item_sharing(doctor_id);
CREATE INDEX IF NOT EXISTS idx_doctor_billing_item_sharing_lab_id
  ON public.doctor_billing_item_sharing(lab_id);

ALTER TABLE public.doctor_billing_item_sharing ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their lab's doctor billing item sharing"
  ON public.doctor_billing_item_sharing FOR SELECT
  USING (lab_id IN (SELECT lab_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "Users can insert their lab's doctor billing item sharing"
  ON public.doctor_billing_item_sharing FOR INSERT
  WITH CHECK (lab_id IN (SELECT lab_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "Users can update their lab's doctor billing item sharing"
  ON public.doctor_billing_item_sharing FOR UPDATE
  USING (lab_id IN (SELECT lab_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "Users can delete their lab's doctor billing item sharing"
  ON public.doctor_billing_item_sharing FOR DELETE
  USING (lab_id IN (SELECT lab_id FROM public.users WHERE id = auth.uid()));

COMMIT;
