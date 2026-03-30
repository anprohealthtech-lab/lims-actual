-- Add default_value column to lab_analytes
-- When set, result entry modals pre-fill this value for new (unsaved) results.
-- The tech can change or clear it before submitting.
-- Only stored at lab_analytes level — each lab sets its own workflow defaults.
-- Example: HIV Rapid → default_value = 'Non-Reactive'

ALTER TABLE lab_analytes
  ADD COLUMN IF NOT EXISTS default_value text;

COMMENT ON COLUMN lab_analytes.default_value IS
  'Pre-filled value shown in result entry for new results. Tech can override before submitting.';
