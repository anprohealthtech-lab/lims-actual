-- ============================================================
-- Feature: Custom per-lab patient fields
-- Backward safe: all nullable/defaulted, existing data unaffected
-- ============================================================

-- 1) Add custom_fields JSONB column to patients
ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS custom_fields JSONB DEFAULT '{}'::jsonb;

-- GIN index for fast searches on custom field values
CREATE INDEX IF NOT EXISTS idx_patients_custom_fields
  ON public.patients USING GIN (custom_fields);

-- 2) Per-lab field configuration table
CREATE TABLE IF NOT EXISTS public.lab_patient_field_configs (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_id      UUID        NOT NULL REFERENCES public.labs(id) ON DELETE CASCADE,
  field_key   TEXT        NOT NULL,   -- e.g. "abha_id", "animal_type"
  label       TEXT        NOT NULL,   -- e.g. "ABHA ID", "Animal Type"
  field_type  TEXT        NOT NULL DEFAULT 'text', -- 'text'|'select'|'number'
  options     JSONB,                  -- for select: ["Dog","Cat","Bird"]
  searchable  BOOLEAN     NOT NULL DEFAULT false,
  required    BOOLEAN     NOT NULL DEFAULT false,
  sort_order  INTEGER     NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (lab_id, field_key)
);

-- RLS
ALTER TABLE public.lab_patient_field_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lab_members_read_own_config"
  ON public.lab_patient_field_configs FOR SELECT
  USING (lab_id IN (SELECT lab_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "lab_admins_manage_config"
  ON public.lab_patient_field_configs FOR ALL
  USING (lab_id IN (SELECT lab_id FROM public.users WHERE id = auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lab_patient_field_configs TO authenticated;

COMMENT ON TABLE public.lab_patient_field_configs IS
  'Per-lab custom patient field definitions. Values stored in patients.custom_fields JSONB.';
COMMENT ON COLUMN public.patients.custom_fields IS
  'Lab-specific custom field values, keyed by lab_patient_field_configs.field_key';
