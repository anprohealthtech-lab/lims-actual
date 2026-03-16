-- Add a stored generated column custom_fields_text to patients
-- This allows PostgREST ilike filtering without ::text cast (which PostgREST does not support in filters)
ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS custom_fields_text TEXT
  GENERATED ALWAYS AS (custom_fields::text) STORED;

-- Index for fast text search
CREATE INDEX IF NOT EXISTS idx_patients_custom_fields_text
  ON public.patients (lab_id, custom_fields_text);
