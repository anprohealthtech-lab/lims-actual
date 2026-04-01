-- Backfill lab_analyte_id in test_group_analytes for rows created after
-- 20260331_add_lab_analyte_id_to_test_group_analytes.sql ran.
--
-- WHY: The onboarding-lab function was inserting into test_group_analytes without
-- setting lab_analyte_id. The original migration backfilled rows that existed at
-- deploy time, but any rows inserted after that (by onboarding) still have NULL.
-- This migration re-runs the same backfill to catch those rows.

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
