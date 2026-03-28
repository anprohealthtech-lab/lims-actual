-- Add ai_processing_type to lab_analytes so labs can override it per-analyte
ALTER TABLE public.lab_analytes
  ADD COLUMN IF NOT EXISTS ai_processing_type text
    CHECK (ai_processing_type IS NULL OR length(ai_processing_type) < 500);

-- Backfill from the global analytes table for all existing rows
UPDATE public.lab_analytes la
SET ai_processing_type = a.ai_processing_type
FROM public.analytes a
WHERE la.analyte_id = a.id
  AND a.ai_processing_type IS NOT NULL
  AND la.ai_processing_type IS NULL;
