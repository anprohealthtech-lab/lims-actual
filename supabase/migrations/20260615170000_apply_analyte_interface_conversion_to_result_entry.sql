-- Allow each lab analyte's interface conversion to be enabled independently
-- for AI extraction, manual AI result entry, and Quick Result Entry.

ALTER TABLE public.lab_analyte_interface_config
  ADD COLUMN IF NOT EXISTS apply_to_ai_result_entry BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS apply_to_manual_result_entry BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS apply_to_quick_result_entry BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.lab_analyte_interface_config.apply_to_ai_result_entry IS
  'Apply multiply_by/add_offset when AI-extracted values are placed in the result entry form.';
COMMENT ON COLUMN public.lab_analyte_interface_config.apply_to_manual_result_entry IS
  'Apply multiply_by/add_offset when a technician leaves a manually edited value in AI Result Entry.';
COMMENT ON COLUMN public.lab_analyte_interface_config.apply_to_quick_result_entry IS
  'Apply multiply_by/add_offset when a technician leaves a value in Quick Result Entry.';
