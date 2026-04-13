-- Migration: Fix sample_id uniqueness to be per-lab
-- Problem: The global UNIQUE constraint on orders.sample_id means two different
-- labs cannot both have "12-Apr-2026-001" on the same day, even though they
-- have independent counters. This causes insert failures for the second lab
-- to register an order on any given day.
-- Fix: Drop the global UNIQUE constraint and replace with UNIQUE(lab_id, sample_id).
-- The lab code prefix in sample_id (e.g. "ML001-12-Apr-2026-001") is added at
-- the application level so QR scans still resolve to the correct lab.

-- 1. Drop the global unique constraint
ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS unique_sample_id;

-- 1b. Deduplicate: within each lab keep the oldest order for a given sample_id
--     and NULL-out the sample_id on every later duplicate so the unique
--     constraint below can be created cleanly.
--     (Duplicates only exist in legacy data written before any uniqueness was
--      enforced; they will be re-assigned correct IDs by the app on next edit.)
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY lab_id, sample_id
           ORDER BY created_at, id
         ) AS rn
  FROM public.orders
  WHERE sample_id IS NOT NULL
)
UPDATE public.orders o
SET sample_id = NULL
FROM ranked r
WHERE o.id = r.id
  AND r.rn > 1;

-- 2. Add per-lab unique constraint
ALTER TABLE public.orders
  ADD CONSTRAINT unique_sample_id_per_lab UNIQUE (lab_id, sample_id);

-- 3. Update the column comment to reflect the new format
COMMENT ON COLUMN public.orders.sample_id IS
  'Unique daily sample identifier per lab. Format: LABCODE-DD-Mon-YYYY-SEQ '
  '(e.g. ML001-12-Apr-2026-001). Legacy records without prefix are still valid.';

-- ============================================================
-- PART 2: Auto-generated patient number (UHID) per lab
-- Format: LABCODE-P-00001 (e.g. ML001-P-00142)
-- Each lab has its own independent counter.
-- ============================================================

-- 4. Add patient_number column
ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS patient_number text;

-- 5. Unique per lab
ALTER TABLE public.patients
  ADD CONSTRAINT unique_patient_number_per_lab UNIQUE (lab_id, patient_number);

CREATE INDEX IF NOT EXISTS idx_patients_patient_number
  ON public.patients (lab_id, patient_number);

COMMENT ON COLUMN public.patients.patient_number IS
  'Human-readable patient ID (UHID) unique per lab. Format: LABCODE-P-NNNNN '
  '(e.g. ML001-P-00142). Auto-assigned on insert.';

-- 6. Trigger function: assign patient_number on INSERT
CREATE OR REPLACE FUNCTION public.assign_patient_number()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_lab_code text;
  v_next_seq integer;
BEGIN
  -- Skip if already set (e.g. bulk import with explicit value)
  IF NEW.patient_number IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Get lab code
  SELECT code INTO v_lab_code FROM public.labs WHERE id = NEW.lab_id;

  IF v_lab_code IS NULL THEN
    -- Fallback: leave patient_number NULL rather than fail
    RETURN NEW;
  END IF;

  -- Next sequence = count of existing patients in this lab + 1
  -- Uses advisory lock keyed on lab_id to prevent race conditions under concurrency
  PERFORM pg_advisory_xact_lock(hashtext(NEW.lab_id::text));

  SELECT COALESCE(MAX(
    CASE
      WHEN patient_number ~ ('^' || v_lab_code || '-P-[0-9]+$')
      THEN CAST(split_part(patient_number, '-P-', 2) AS integer)
      ELSE 0
    END
  ), 0) + 1
  INTO v_next_seq
  FROM public.patients
  WHERE lab_id = NEW.lab_id;

  NEW.patient_number := v_lab_code || '-P-' || LPAD(v_next_seq::text, 5, '0');

  RETURN NEW;
END;
$$;

-- 7. Attach trigger
DROP TRIGGER IF EXISTS tr_assign_patient_number ON public.patients;
CREATE TRIGGER tr_assign_patient_number
  BEFORE INSERT ON public.patients
  FOR EACH ROW
  EXECUTE FUNCTION public.assign_patient_number();

-- 8. Backfill existing patients (ordered by created_at so sequence is stable)
DO $$
DECLARE
  r RECORD;
  v_lab_code text;
  v_seq integer;
BEGIN
  FOR r IN
    SELECT p.id, p.lab_id, p.created_at
    FROM public.patients p
    WHERE p.patient_number IS NULL
    ORDER BY p.lab_id, p.created_at
  LOOP
    SELECT code INTO v_lab_code FROM public.labs WHERE id = r.lab_id;
    IF v_lab_code IS NULL THEN CONTINUE; END IF;

    SELECT COALESCE(MAX(
      CASE
        WHEN patient_number ~ ('^' || v_lab_code || '-P-[0-9]+$')
        THEN CAST(split_part(patient_number, '-P-', 2) AS integer)
        ELSE 0
      END
    ), 0) + 1
    INTO v_seq
    FROM public.patients
    WHERE lab_id = r.lab_id;

    UPDATE public.patients
    SET patient_number = v_lab_code || '-P-' || LPAD(v_seq::text, 5, '0')
    WHERE id = r.id;
  END LOOP;
END;
$$;
