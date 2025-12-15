-- Migration: Add index for lab_id on reports table and backfill existing records
-- Date: 2025-12-10
-- Purpose: Enable efficient lab-level filtering on reports table

-- =====================================================
-- Step 1: Create index for lab_id (for efficient filtering)
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_reports_lab_id 
ON public.reports USING btree (lab_id) 
TABLESPACE pg_default
WHERE lab_id IS NOT NULL;

-- Composite index for lab + date queries (common pattern)
CREATE INDEX IF NOT EXISTS idx_reports_lab_generated_date 
ON public.reports USING btree (lab_id, generated_date DESC) 
TABLESPACE pg_default
WHERE lab_id IS NOT NULL;

-- Composite index for lab + status queries
CREATE INDEX IF NOT EXISTS idx_reports_lab_status 
ON public.reports USING btree (lab_id, status) 
TABLESPACE pg_default
WHERE lab_id IS NOT NULL;

-- Composite index for lab + patient queries
CREATE INDEX IF NOT EXISTS idx_reports_lab_patient 
ON public.reports USING btree (lab_id, patient_id) 
TABLESPACE pg_default
WHERE lab_id IS NOT NULL;

-- =====================================================
-- Step 2: Create trigger function to auto-populate lab_id
-- =====================================================
CREATE OR REPLACE FUNCTION public.set_reports_lab_id()
RETURNS TRIGGER AS $$
BEGIN
  -- If lab_id is not provided, get it from the order
  IF NEW.lab_id IS NULL AND NEW.order_id IS NOT NULL THEN
    SELECT lab_id INTO NEW.lab_id
    FROM public.orders
    WHERE id = NEW.order_id;
  END IF;
  
  -- If still NULL and patient_id exists, try to get from patient's most recent order
  IF NEW.lab_id IS NULL AND NEW.patient_id IS NOT NULL THEN
    SELECT lab_id INTO NEW.lab_id
    FROM public.orders
    WHERE patient_id = NEW.patient_id
      AND lab_id IS NOT NULL
    ORDER BY created_at DESC
    LIMIT 1;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to auto-populate lab_id on INSERT
DROP TRIGGER IF EXISTS set_reports_lab_id_trigger ON public.reports;
CREATE TRIGGER set_reports_lab_id_trigger
  BEFORE INSERT ON public.reports
  FOR EACH ROW
  EXECUTE FUNCTION public.set_reports_lab_id();

-- =====================================================
-- Step 3: Backfill lab_id from orders table
-- =====================================================
-- Update reports where lab_id is NULL but order_id exists
UPDATE public.reports r
SET lab_id = o.lab_id
FROM public.orders o
WHERE r.order_id = o.id
  AND r.lab_id IS NULL
  AND o.lab_id IS NOT NULL;

-- Log how many records were updated
DO $$
DECLARE
  updated_count INTEGER;
  remaining_null INTEGER;
BEGIN
  SELECT COUNT(*) INTO updated_count 
  FROM public.reports 
  WHERE lab_id IS NOT NULL;
  
  SELECT COUNT(*) INTO remaining_null 
  FROM public.reports 
  WHERE lab_id IS NULL;
  
  RAISE NOTICE 'Reports backfill complete: % records have lab_id, % still NULL', updated_count, remaining_null;
END $$;

-- =====================================================
-- Step 3: Add comment for documentation
-- =====================================================
COMMENT ON COLUMN public.reports.lab_id IS 'Lab ID for multi-lab filtering. Backfilled from orders table. Foreign key to labs(id).';

-- =====================================================
-- Optional: If you want to make lab_id NOT NULL in future
-- (Only run after verifying all records are backfilled)
-- =====================================================
-- ALTER TABLE public.reports ALTER COLUMN lab_id SET NOT NULL;
