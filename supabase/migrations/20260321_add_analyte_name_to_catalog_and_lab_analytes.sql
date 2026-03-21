-- Add analyte_name + test_group_name to global_test_catalog_analytes,
-- analyte_name + test_group_name to test_group_analytes (lab),
-- and analyte_name to lab_analytes.
-- All kept in sync via triggers. Enables pure name×name joins —
-- no UUID dependency when filling lab test group metadata.

-- ── global_test_catalog_analytes ─────────────────────────────
ALTER TABLE public.global_test_catalog_analytes
  ADD COLUMN IF NOT EXISTS analyte_name    text,
  ADD COLUMN IF NOT EXISTS test_group_name text;

-- Backfill existing rows
UPDATE public.global_test_catalog_analytes gtca
SET
  analyte_name    = a.name,
  test_group_name = gtc.name
FROM public.analytes a,
     public.global_test_catalog gtc
WHERE a.id   = gtca.analyte_id
  AND gtc.id = gtca.catalog_id
  AND (gtca.analyte_name IS NULL OR gtca.test_group_name IS NULL);

CREATE OR REPLACE FUNCTION sync_gtca_names()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.analyte_name    := (SELECT name FROM public.analytes              WHERE id = NEW.analyte_id);
  NEW.test_group_name := (SELECT name FROM public.global_test_catalog   WHERE id = NEW.catalog_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_gtca_names ON public.global_test_catalog_analytes;
CREATE TRIGGER trg_sync_gtca_names
  BEFORE INSERT OR UPDATE OF analyte_id, catalog_id ON public.global_test_catalog_analytes
  FOR EACH ROW EXECUTE FUNCTION sync_gtca_names();

-- ── test_group_analytes (lab) ────────────────────────────────
ALTER TABLE public.test_group_analytes
  ADD COLUMN IF NOT EXISTS analyte_name    text,
  ADD COLUMN IF NOT EXISTS test_group_name text;

-- Backfill existing rows
UPDATE public.test_group_analytes tga
SET
  analyte_name    = a.name,
  test_group_name = tg.name
FROM public.analytes a,
     public.test_groups tg
WHERE a.id  = tga.analyte_id
  AND tg.id = tga.test_group_id
  AND (tga.analyte_name IS NULL OR tga.test_group_name IS NULL);

CREATE OR REPLACE FUNCTION sync_tga_names()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.analyte_name    := (SELECT name FROM public.analytes     WHERE id = NEW.analyte_id);
  NEW.test_group_name := (SELECT name FROM public.test_groups  WHERE id = NEW.test_group_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_tga_names ON public.test_group_analytes;
CREATE TRIGGER trg_sync_tga_names
  BEFORE INSERT OR UPDATE OF analyte_id, test_group_id ON public.test_group_analytes
  FOR EACH ROW EXECUTE FUNCTION sync_tga_names();

-- ── lab_analytes ─────────────────────────────────────────────
ALTER TABLE public.lab_analytes
  ADD COLUMN IF NOT EXISTS analyte_name text;

-- Backfill existing rows
UPDATE public.lab_analytes la
SET analyte_name = a.name
FROM public.analytes a
WHERE a.id = la.analyte_id
  AND la.analyte_name IS NULL;

CREATE OR REPLACE FUNCTION sync_la_analyte_name()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.analyte_name := (SELECT name FROM public.analytes WHERE id = NEW.analyte_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_la_analyte_name ON public.lab_analytes;
CREATE TRIGGER trg_sync_la_analyte_name
  BEFORE INSERT OR UPDATE OF analyte_id ON public.lab_analytes
  FOR EACH ROW EXECUTE FUNCTION sync_la_analyte_name();
