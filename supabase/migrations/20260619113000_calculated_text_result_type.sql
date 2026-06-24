-- Add calculation result mode so calculated analytes can produce either
-- numeric formula results or rule-based text results.

ALTER TABLE public.analytes
  ADD COLUMN IF NOT EXISTS calculation_result_type text NOT NULL DEFAULT 'numeric'
  CHECK (calculation_result_type IN ('numeric', 'text'));

ALTER TABLE public.lab_analytes
  ADD COLUMN IF NOT EXISTS calculation_result_type text NOT NULL DEFAULT 'numeric'
  CHECK (calculation_result_type IN ('numeric', 'text'));

COMMENT ON COLUMN public.analytes.calculation_result_type IS
  'Controls how formula is evaluated: numeric math expression or text rule JSON.';

COMMENT ON COLUMN public.lab_analytes.calculation_result_type IS
  'Lab-specific override for calculated analyte result type: numeric or text.';
