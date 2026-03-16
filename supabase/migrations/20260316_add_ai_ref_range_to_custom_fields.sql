-- Add use_for_ai_ref_range flag to lab_patient_field_configs
-- When true, the patient's value for this field is injected into patient_context
-- at order creation time and included in the AI reference range prompt.

ALTER TABLE public.lab_patient_field_configs
  ADD COLUMN IF NOT EXISTS use_for_ai_ref_range BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.lab_patient_field_configs.use_for_ai_ref_range IS
  'When true, this field''s value is passed to the AI reference range resolver as custom patient context (e.g. species, breed, weight class).';
