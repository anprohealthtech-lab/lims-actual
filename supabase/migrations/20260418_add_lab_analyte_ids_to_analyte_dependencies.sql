-- Migration: Add exact lab_analyte links to analyte_dependencies
-- Date: 2026-04-18
-- Problem:
--   analyte_dependencies currently relies on global analyte_id + lab_id.
--   That becomes ambiguous when a lab can end up with multiple lab_analytes rows
--   for the same global analyte_id.
--
-- Goal:
--   1. Preserve existing analyte_id columns for backward compatibility.
--   2. Add exact calculated/source lab_analyte references.
--   3. Auto-populate exact references when they are unambiguous.
--   4. Keep existing rows working while newer UI/editor flows use exact IDs.

ALTER TABLE public.analyte_dependencies
  ADD COLUMN IF NOT EXISTS calculated_lab_analyte_id uuid NULL REFERENCES public.lab_analytes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_lab_analyte_id uuid NULL REFERENCES public.lab_analytes(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.analyte_dependencies.calculated_lab_analyte_id IS
  'Exact lab_analytes row for the calculated analyte. Preferred over calculated_analyte_id when present.';

COMMENT ON COLUMN public.analyte_dependencies.source_lab_analyte_id IS
  'Exact lab_analytes row for the source analyte. Preferred over source_analyte_id when present.';

CREATE INDEX IF NOT EXISTS analyte_dependencies_calc_lab_analyte_idx
  ON public.analyte_dependencies (calculated_lab_analyte_id);

CREATE INDEX IF NOT EXISTS analyte_dependencies_source_lab_analyte_idx
  ON public.analyte_dependencies (source_lab_analyte_id);

CREATE OR REPLACE FUNCTION public.sync_analyte_dependency_lab_links()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_calc record;
  v_src record;
  v_calc_match_count integer := 0;
  v_src_match_count integer := 0;
BEGIN
  -- Exact calculated lab_analyte_id provided: sync analyte_id + lab_id from it
  IF NEW.calculated_lab_analyte_id IS NOT NULL THEN
    SELECT id, lab_id, analyte_id
    INTO v_calc
    FROM public.lab_analytes
    WHERE id = NEW.calculated_lab_analyte_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Invalid calculated_lab_analyte_id: %', NEW.calculated_lab_analyte_id;
    END IF;

    NEW.calculated_analyte_id := v_calc.analyte_id;
    NEW.lab_id := COALESCE(NEW.lab_id, v_calc.lab_id);

    IF NEW.lab_id IS DISTINCT FROM v_calc.lab_id THEN
      RAISE EXCEPTION 'calculated_lab_analyte_id lab_id does not match analyte_dependencies.lab_id';
    END IF;
  END IF;

  -- Exact source lab_analyte_id provided: sync source analyte_id and validate lab scope
  IF NEW.source_lab_analyte_id IS NOT NULL THEN
    SELECT id, lab_id, analyte_id
    INTO v_src
    FROM public.lab_analytes
    WHERE id = NEW.source_lab_analyte_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Invalid source_lab_analyte_id: %', NEW.source_lab_analyte_id;
    END IF;

    NEW.source_analyte_id := v_src.analyte_id;
    NEW.lab_id := COALESCE(NEW.lab_id, v_src.lab_id);

    IF NEW.lab_id IS DISTINCT FROM v_src.lab_id THEN
      RAISE EXCEPTION 'source_lab_analyte_id lab_id does not match analyte_dependencies.lab_id';
    END IF;
  END IF;

  -- Backward-compatible auto-resolution:
  -- if lab_id + analyte_id uniquely identifies a lab_analytes row, hydrate exact IDs.
  IF NEW.lab_id IS NOT NULL AND NEW.calculated_lab_analyte_id IS NULL AND NEW.calculated_analyte_id IS NOT NULL THEN
    SELECT COUNT(*)
    INTO v_calc_match_count
    FROM public.lab_analytes la
    WHERE la.lab_id = NEW.lab_id
      AND la.analyte_id = NEW.calculated_analyte_id;

    IF v_calc_match_count = 1 THEN
      SELECT la.id
      INTO NEW.calculated_lab_analyte_id
      FROM public.lab_analytes la
      WHERE la.lab_id = NEW.lab_id
        AND la.analyte_id = NEW.calculated_analyte_id
      LIMIT 1;
    END IF;
  END IF;

  IF NEW.lab_id IS NOT NULL AND NEW.source_lab_analyte_id IS NULL AND NEW.source_analyte_id IS NOT NULL THEN
    SELECT COUNT(*)
    INTO v_src_match_count
    FROM public.lab_analytes la
    WHERE la.lab_id = NEW.lab_id
      AND la.analyte_id = NEW.source_analyte_id;

    IF v_src_match_count = 1 THEN
      SELECT la.id
      INTO NEW.source_lab_analyte_id
      FROM public.lab_analytes la
      WHERE la.lab_id = NEW.lab_id
        AND la.analyte_id = NEW.source_analyte_id
      LIMIT 1;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_analyte_dependency_lab_links ON public.analyte_dependencies;

CREATE TRIGGER trg_sync_analyte_dependency_lab_links
BEFORE INSERT OR UPDATE
ON public.analyte_dependencies
FOR EACH ROW
EXECUTE FUNCTION public.sync_analyte_dependency_lab_links();

-- Backfill exact references where the mapping is unique within a lab.
UPDATE public.analyte_dependencies ad
SET calculated_lab_analyte_id = matched.id
FROM (
  SELECT DISTINCT ON (lab_id, analyte_id)
    lab_id,
    analyte_id,
    id
  FROM public.lab_analytes
  WHERE (lab_id, analyte_id) IN (
    SELECT lab_id, analyte_id
    FROM public.lab_analytes
    GROUP BY lab_id, analyte_id
    HAVING COUNT(*) = 1
  )
  ORDER BY lab_id, analyte_id, id
) AS matched
WHERE ad.lab_id IS NOT NULL
  AND ad.calculated_lab_analyte_id IS NULL
  AND ad.lab_id = matched.lab_id
  AND ad.calculated_analyte_id = matched.analyte_id;

UPDATE public.analyte_dependencies ad
SET source_lab_analyte_id = matched.id
FROM (
  SELECT DISTINCT ON (lab_id, analyte_id)
    lab_id,
    analyte_id,
    id
  FROM public.lab_analytes
  WHERE (lab_id, analyte_id) IN (
    SELECT lab_id, analyte_id
    FROM public.lab_analytes
    GROUP BY lab_id, analyte_id
    HAVING COUNT(*) = 1
  )
  ORDER BY lab_id, analyte_id, id
) AS matched
WHERE ad.lab_id IS NOT NULL
  AND ad.source_lab_analyte_id IS NULL
  AND ad.lab_id = matched.lab_id
  AND ad.source_analyte_id = matched.analyte_id;

-- Replace uniqueness so exact lab_analyte mappings can coexist even when
-- multiple lab_analytes rows share the same global analyte_id in one lab.
DROP INDEX IF EXISTS public.analyte_dependencies_lab_unique_idx;
DROP INDEX IF EXISTS public.analyte_dependencies_global_unique_idx;

CREATE UNIQUE INDEX IF NOT EXISTS analyte_dependencies_global_fallback_unique_idx
  ON public.analyte_dependencies (calculated_analyte_id, source_analyte_id)
  WHERE lab_id IS NULL
    AND calculated_lab_analyte_id IS NULL
    AND source_lab_analyte_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS analyte_dependencies_lab_fallback_unique_idx
  ON public.analyte_dependencies (calculated_analyte_id, source_analyte_id, lab_id)
  WHERE lab_id IS NOT NULL
    AND calculated_lab_analyte_id IS NULL
    AND source_lab_analyte_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS analyte_dependencies_lab_exact_unique_idx
  ON public.analyte_dependencies (calculated_lab_analyte_id, source_lab_analyte_id, lab_id)
  WHERE lab_id IS NOT NULL
    AND calculated_lab_analyte_id IS NOT NULL
    AND source_lab_analyte_id IS NOT NULL;

COMMENT ON FUNCTION public.sync_analyte_dependency_lab_links() IS
  'Keeps analyte_dependencies exact lab_analyte links and analyte_id columns synchronized. Hydrates exact IDs automatically when lab_id + analyte_id is unambiguous.';
