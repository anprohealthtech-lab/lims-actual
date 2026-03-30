-- Add expected_value_codes column to analytes and lab_analytes tables
-- This supports the qualitative analyte type with quick-code shortcuts.
--
-- expected_value_codes: jsonb map of { "code": "full_value" }
--   e.g. { "P": "Positive", "N": "Negative", "NR": "Non-Reactive" }
-- When value_type = 'qualitative' and this map is set, result entry shows a
-- free-text input where typing a code auto-fills the corresponding value.
-- Flag auto-calculation is skipped for value_type = 'qualitative'.

ALTER TABLE analytes
  ADD COLUMN IF NOT EXISTS expected_value_codes jsonb;

ALTER TABLE lab_analytes
  ADD COLUMN IF NOT EXISTS expected_value_codes jsonb;

COMMENT ON COLUMN analytes.expected_value_codes IS
  'Map of short codes to full values for qualitative analytes, e.g. {"P":"Positive","N":"Negative"}';

COMMENT ON COLUMN lab_analytes.expected_value_codes IS
  'Lab-specific override of expected_value_codes. Overrides global analyte codes when set.';
