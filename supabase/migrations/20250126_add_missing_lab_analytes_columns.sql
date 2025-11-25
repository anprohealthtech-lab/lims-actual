-- Add missing columns to lab_analytes table to support full customization
-- This allows labs to customize all analyte properties, not just reference ranges

-- Add columns that were missing from lab_analytes
ALTER TABLE public.lab_analytes
ADD COLUMN IF NOT EXISTS category character varying,
ADD COLUMN IF NOT EXISTS method text,
ADD COLUMN IF NOT EXISTS description text,
ADD COLUMN IF NOT EXISTS is_critical boolean,
ADD COLUMN IF NOT EXISTS normal_range_min numeric,
ADD COLUMN IF NOT EXISTS normal_range_max numeric;

-- Update existing lab_analytes records to copy values from analytes table
UPDATE public.lab_analytes la
SET 
  category = a.category,
  reference_range = COALESCE(la.reference_range, a.reference_range),
  unit = COALESCE(la.unit, a.unit),
  name = COALESCE(la.name, a.name),
  low_critical = COALESCE(la.low_critical, 
    CASE 
      WHEN a.low_critical ~ '^[0-9.]+$' THEN a.low_critical::numeric 
      ELSE NULL 
    END),
  high_critical = COALESCE(la.high_critical,
    CASE 
      WHEN a.high_critical ~ '^[0-9.]+$' THEN a.high_critical::numeric 
      ELSE NULL 
    END),
  interpretation_low = COALESCE(la.interpretation_low, a.interpretation_low),
  interpretation_normal = COALESCE(la.interpretation_normal, a.interpretation_normal),
  interpretation_high = COALESCE(la.interpretation_high, a.interpretation_high),
  reference_range_male = COALESCE(la.reference_range_male, a.reference_range_male),
  reference_range_female = COALESCE(la.reference_range_female, a.reference_range_female)
FROM public.analytes a
WHERE la.analyte_id = a.id
  AND (la.category IS NULL 
       OR la.reference_range IS NULL 
       OR la.unit IS NULL 
       OR la.name IS NULL);

-- Create or replace trigger function to sync updates from analytes to lab_analytes
-- This ensures lab_analytes stay in sync UNLESS they have lab_specific_* overrides
CREATE OR REPLACE FUNCTION public.sync_analyte_updates_to_lab_analytes()
RETURNS TRIGGER AS $$
BEGIN
  -- Update all lab_analytes linked to this analyte
  -- Only update fields that don't have lab_specific_* overrides
  UPDATE public.lab_analytes
  SET
    name = CASE WHEN lab_specific_name IS NULL THEN NEW.name ELSE name END,
    unit = CASE WHEN lab_specific_unit IS NULL THEN NEW.unit ELSE unit END,
    reference_range = CASE WHEN lab_specific_reference_range IS NULL THEN NEW.reference_range ELSE reference_range END,
    low_critical = CASE 
      WHEN lab_specific_reference_range IS NULL THEN 
        CASE 
          WHEN NEW.low_critical ~ '^[0-9.]+$' THEN NEW.low_critical::numeric 
          ELSE NULL 
        END
      ELSE low_critical 
    END,
    high_critical = CASE 
      WHEN lab_specific_reference_range IS NULL THEN 
        CASE 
          WHEN NEW.high_critical ~ '^[0-9.]+$' THEN NEW.high_critical::numeric 
          ELSE NULL 
        END
      ELSE high_critical 
    END,
    interpretation_low = CASE WHEN lab_specific_interpretation_low IS NULL THEN NEW.interpretation_low ELSE interpretation_low END,
    interpretation_normal = CASE WHEN lab_specific_interpretation_normal IS NULL THEN NEW.interpretation_normal ELSE interpretation_normal END,
    interpretation_high = CASE WHEN lab_specific_interpretation_high IS NULL THEN NEW.interpretation_high ELSE interpretation_high END,
    category = NEW.category, -- Always sync category (no lab_specific_category field)
    reference_range_male = NEW.reference_range_male,
    reference_range_female = NEW.reference_range_female,
    updated_at = now()
  WHERE analyte_id = NEW.id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop existing trigger if exists and create new one
DROP TRIGGER IF EXISTS trigger_sync_analyte_updates ON public.analytes;
CREATE TRIGGER trigger_sync_analyte_updates
  AFTER UPDATE ON public.analytes
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_analyte_updates_to_lab_analytes();

-- Create index for better performance on lab_analytes lookups
CREATE INDEX IF NOT EXISTS idx_lab_analytes_lab_id ON public.lab_analytes(lab_id);
CREATE INDEX IF NOT EXISTS idx_lab_analytes_analyte_id ON public.lab_analytes(analyte_id);
CREATE INDEX IF NOT EXISTS idx_lab_analytes_lab_analyte ON public.lab_analytes(lab_id, analyte_id);
