-- Add lab_analyte_id to test_group_analytes
-- WHY: test_group_analytes.analyte_id points to the global `analytes` table.
-- If a lab has the same analyte linked twice in lab_analytes (rare but possible),
-- any join through analyte_id produces duplicate rows and returns the wrong config.
-- Storing lab_analyte_id directly removes the ambiguity.
-- BACKWARD COMPAT: analyte_id is kept for result_values FK and historical data.

-- Step 1: Add the column (nullable so existing rows don't break)
ALTER TABLE public.test_group_analytes
  ADD COLUMN IF NOT EXISTS lab_analyte_id UUID REFERENCES public.lab_analytes(id) ON DELETE SET NULL;

-- Step 2: Backfill lab_analyte_id for all existing rows
-- Join through test_groups to get lab_id, then find the matching lab_analyte.
-- If there are duplicates (same analyte, same lab), we take the earliest created_at.
UPDATE public.test_group_analytes tga
SET lab_analyte_id = (
  SELECT la.id
  FROM public.lab_analytes la
  INNER JOIN public.test_groups tg ON tg.id = tga.test_group_id
  WHERE la.analyte_id = tga.analyte_id
    AND la.lab_id = tg.lab_id
  ORDER BY la.created_at ASC
  LIMIT 1
)
WHERE tga.lab_analyte_id IS NULL
  AND tga.analyte_id IS NOT NULL;

-- Step 3: Index for fast lookup by lab_analyte_id
CREATE INDEX IF NOT EXISTS idx_tga_lab_analyte_id
  ON public.test_group_analytes(lab_analyte_id);

COMMENT ON COLUMN public.test_group_analytes.lab_analyte_id IS
'Direct FK to lab_analytes.id — the exact lab-specific analyte config for this test group slot. '
'When set, use this instead of joining through analyte_id → lab_analytes (which could return multiple rows if duplicates exist). '
'analyte_id is retained for backward compatibility with result_values and historical queries.';

-- ============================================================================
-- Part B: Add lab_analyte_id to result_values
-- WHY: result_values.analyte_id points to the global analytes table.
-- Storing lab_analyte_id directly lets us pull the exact lab-specific config
-- (reference ranges, formulas, flag maps) without a second query or ambiguity.
-- ============================================================================

-- Step 4: Add the column (nullable — existing rows stay intact)
ALTER TABLE public.result_values
  ADD COLUMN IF NOT EXISTS lab_analyte_id UUID REFERENCES public.lab_analytes(id) ON DELETE SET NULL;

-- Step 5: Backfill lab_analyte_id for all existing result_values rows
-- Uses lab_id + analyte_id to find the matching lab_analyte.
-- If duplicates exist, take the earliest created_at.
UPDATE public.result_values rv
SET lab_analyte_id = (
  SELECT la.id
  FROM public.lab_analytes la
  WHERE la.analyte_id = rv.analyte_id
    AND la.lab_id = rv.lab_id
  ORDER BY la.created_at ASC
  LIMIT 1
)
WHERE rv.lab_analyte_id IS NULL
  AND rv.analyte_id IS NOT NULL
  AND rv.lab_id IS NOT NULL;

-- Step 6: Index for fast lookup
CREATE INDEX IF NOT EXISTS idx_rv_lab_analyte_id
  ON public.result_values(lab_analyte_id);

COMMENT ON COLUMN public.result_values.lab_analyte_id IS
'Direct FK to lab_analytes.id — the exact lab-specific analyte config used when this value was recorded. '
'When set, use this to pull reference ranges, formulas, flag maps directly. '
'analyte_id is retained for backward compatibility and global analyte identity.';

