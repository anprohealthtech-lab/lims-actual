-- Fix custom_fields stored as JSONB string instead of JSONB object
-- Root cause: value was stored as a JSONB text scalar (e.g. "{"key":"val"}")
-- instead of a JSONB object (e.g. {"key":"val"})

-- 1. Fix all existing rows where custom_fields is a JSONB string (not object/array)
UPDATE public.patients
SET custom_fields = (custom_fields #>> '{}')::jsonb
WHERE custom_fields IS NOT NULL
  AND jsonb_typeof(custom_fields) = 'string';

-- 2. Trigger function: auto-unwrap JSONB string values on every upsert
CREATE OR REPLACE FUNCTION public.fix_custom_fields_jsonb()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.custom_fields IS NOT NULL AND jsonb_typeof(NEW.custom_fields) = 'string' THEN
    BEGIN
      NEW.custom_fields := (NEW.custom_fields #>> '{}')::jsonb;
    EXCEPTION WHEN OTHERS THEN
      NEW.custom_fields := '{}'::jsonb;
    END;
  END IF;
  IF NEW.custom_fields IS NULL THEN
    NEW.custom_fields := '{}'::jsonb;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fix_custom_fields ON public.patients;

CREATE TRIGGER trg_fix_custom_fields
  BEFORE INSERT OR UPDATE ON public.patients
  FOR EACH ROW EXECUTE FUNCTION public.fix_custom_fields_jsonb();
