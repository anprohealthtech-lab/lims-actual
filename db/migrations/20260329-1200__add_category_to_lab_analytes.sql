-- Add category column to lab_analytes
-- Allows labs to override the global analyte category at the lab level.
-- Fetch falls back to global analytes.category if this is null.

ALTER TABLE lab_analytes
  ADD COLUMN IF NOT EXISTS category text;

COMMENT ON COLUMN lab_analytes.category IS
  'Lab-specific category override. Falls back to global analytes.category if null.';
