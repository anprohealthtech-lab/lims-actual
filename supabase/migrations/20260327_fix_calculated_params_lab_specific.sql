-- Migration: Move calculated parameter config to lab_analytes level
--
-- Problem: is_calculated/formula/formula_variables are on the global `analytes` table.
-- Any lab editing a formula modifies it globally for all labs.
-- analyte_dependencies also has no lab_id, making it global.
--
-- Fix:
--   1. Add calculated fields to lab_analytes (lab-specific overrides)
--   2. Add lab_id to analyte_dependencies + replace old unique constraint
--   3. Copy existing global calculated configs down to lab_analytes
--   4. Seed lab-specific analyte_dependencies from global ones
--   5. Create helper view

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Add calculated-parameter columns to lab_analytes
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.lab_analytes
  ADD COLUMN IF NOT EXISTS is_calculated       boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS formula             text,
  ADD COLUMN IF NOT EXISTS formula_variables   jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS formula_description text;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Add lab_id to analyte_dependencies
--    NULL = global fallback (backwards-compatible)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.analyte_dependencies
  ADD COLUMN IF NOT EXISTS lab_id uuid REFERENCES public.labs(id) ON DELETE CASCADE;

-- Drop old constraint that only covered (calculated_analyte_id, source_analyte_id)
-- without lab_id — blocks inserting lab-specific rows for the same analyte pair
ALTER TABLE public.analyte_dependencies
  DROP CONSTRAINT IF EXISTS unique_dependency;

-- Partial unique index for global rows (lab_id IS NULL)
CREATE UNIQUE INDEX IF NOT EXISTS analyte_dependencies_global_unique_idx
  ON public.analyte_dependencies (calculated_analyte_id, source_analyte_id)
  WHERE lab_id IS NULL;

-- Partial unique index for lab-specific rows
CREATE UNIQUE INDEX IF NOT EXISTS analyte_dependencies_lab_unique_idx
  ON public.analyte_dependencies (calculated_analyte_id, source_analyte_id, lab_id)
  WHERE lab_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS analyte_dependencies_lab_id_idx
  ON public.analyte_dependencies (lab_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Seed lab_analytes calculated fields from global analytes
--    for every lab that already has the analyte in lab_analytes
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE public.lab_analytes la
SET
  is_calculated       = a.is_calculated,
  formula             = a.formula,
  formula_variables   = a.formula_variables,
  formula_description = a.formula_description
FROM public.analytes a
WHERE la.analyte_id = a.id
  AND a.is_calculated = true
  AND la.is_calculated IS DISTINCT FROM true;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Seed lab-specific analyte_dependencies from global ones
--    for every lab that has both the calculated analyte and its sources
--    registered in lab_analytes
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO public.analyte_dependencies
  (calculated_analyte_id, source_analyte_id, variable_name, lab_id)
SELECT DISTINCT
  ad.calculated_analyte_id,
  ad.source_analyte_id,
  ad.variable_name,
  la_calc.lab_id
FROM public.analyte_dependencies ad
JOIN public.lab_analytes la_calc ON la_calc.analyte_id = ad.calculated_analyte_id
JOIN public.lab_analytes la_src
  ON la_src.analyte_id = ad.source_analyte_id
  AND la_src.lab_id = la_calc.lab_id
WHERE ad.lab_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.analyte_dependencies x
    WHERE x.calculated_analyte_id = ad.calculated_analyte_id
      AND x.source_analyte_id     = ad.source_analyte_id
      AND x.lab_id                = la_calc.lab_id
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Helper view: resolved calculated config per lab analyte
--    Prefers lab_analytes values; falls back to global analytes
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.resolved_lab_analyte_calculated AS
SELECT
  la.id AS lab_analyte_id,
  la.lab_id,
  la.analyte_id,
  COALESCE(la.is_calculated, a.is_calculated, false) AS is_calculated,
  COALESCE(la.formula, a.formula) AS formula,
  COALESCE(la.formula_variables, a.formula_variables, '[]'::jsonb) AS formula_variables,
  COALESCE(la.formula_description, a.formula_description) AS formula_description
FROM public.lab_analytes la
JOIN public.analytes a ON a.id = la.analyte_id;

COMMENT ON VIEW public.resolved_lab_analyte_calculated IS
  'Calculated-parameter config resolved per-lab: lab_analytes values take priority over global analytes values.';
