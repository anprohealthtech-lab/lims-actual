-- Migration: global_test_catalog_analytes junction table + group_interpretation
-- Replaces the flat analytes UUID array in global_test_catalog with a proper
-- junction table that carries section_heading, sort_order, and display metadata.
-- Adds group_interpretation (rich HTML text) to both global catalog and lab test_groups.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Junction table: global_test_catalog_analytes
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.global_test_catalog_analytes (
  id           uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  catalog_id   uuid    NOT NULL REFERENCES public.global_test_catalog(id) ON DELETE CASCADE,
  analyte_id   uuid    NOT NULL REFERENCES public.analytes(id) ON DELETE CASCADE,
  section_heading      text,
  sort_order           integer NOT NULL DEFAULT 0,
  display_order        integer,
  is_visible           boolean NOT NULL DEFAULT true,
  is_header            boolean DEFAULT false,
  header_name          text,
  custom_reference_range text,
  created_at   timestamptz DEFAULT now(),
  CONSTRAINT global_test_catalog_analytes_unique UNIQUE (catalog_id, analyte_id)
);

CREATE INDEX IF NOT EXISTS idx_gtca_catalog_id  ON public.global_test_catalog_analytes(catalog_id);
CREATE INDEX IF NOT EXISTS idx_gtca_analyte_id  ON public.global_test_catalog_analytes(analyte_id);
CREATE INDEX IF NOT EXISTS idx_gtca_sort_order  ON public.global_test_catalog_analytes(catalog_id, sort_order);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Migrate existing JSONB analyte IDs → junction table (sequential sort_order)
--    Only inserts IDs that actually exist in the analytes table (FK-safe).
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.global_test_catalog_analytes (catalog_id, analyte_id, sort_order)
SELECT
  gtc.id                                   AS catalog_id,
  (elem.value)::uuid                       AS analyte_id,
  (elem.ordinality - 1)::integer           AS sort_order
FROM public.global_test_catalog gtc,
     jsonb_array_elements_text(
       CASE
         WHEN jsonb_typeof(gtc.analytes) = 'array' THEN gtc.analytes
         ELSE '[]'::jsonb
       END
     ) WITH ORDINALITY AS elem(value, ordinality)
-- Guard 1: must look like a UUID (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
WHERE elem.value ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
-- Guard 2: must actually exist in the analytes table
  AND EXISTS (
    SELECT 1 FROM public.analytes a WHERE a.id = (elem.value)::uuid
  )
ON CONFLICT (catalog_id, analyte_id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Add group_interpretation to global_test_catalog
--    Stores rich HTML (from CKEditor). Super admin sets this via direct DB / script.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.global_test_catalog
  ADD COLUMN IF NOT EXISTS group_interpretation text;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Add group_interpretation to test_groups (lab copies)
--    Populated from global catalog during onboarding; lab can override via UI.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.test_groups
  ADD COLUMN IF NOT EXISTS group_interpretation text;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. RLS — read access for authenticated users; write only for service role
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.global_test_catalog_analytes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "global_test_catalog_analytes_read"
  ON public.global_test_catalog_analytes FOR SELECT
  USING (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Comments
-- ─────────────────────────────────────────────────────────────────────────────
COMMENT ON TABLE  public.global_test_catalog_analytes                         IS 'Junction table linking global test catalog entries to analytes with ordering and section metadata';
COMMENT ON COLUMN public.global_test_catalog_analytes.section_heading         IS 'Groups analytes under a heading in the report (e.g. "Red Blood Cell Indices")';
COMMENT ON COLUMN public.global_test_catalog_analytes.sort_order              IS 'Display order within the test group';
COMMENT ON COLUMN public.global_test_catalog_analytes.is_header               IS 'If true, this row renders as a section header, not a result row';
COMMENT ON COLUMN public.global_test_catalog_analytes.custom_reference_range  IS 'Override reference range for this test group context';
COMMENT ON COLUMN public.global_test_catalog.group_interpretation             IS 'Rich HTML interpretation text shown after results in reports. Set by super admin.';
COMMENT ON COLUMN public.test_groups.group_interpretation                     IS 'Rich HTML interpretation text shown after results in reports. Copied from global catalog on onboarding; lab can override.';
