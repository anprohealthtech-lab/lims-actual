-- Fix: protect lab-specific category from being overwritten by global analyte sync trigger.
-- Previously the trigger always set lab_analytes.category = analytes.category on every
-- analyte update, wiping any lab-specific category the user had saved.
-- Now it only syncs category when the lab_analytes row has no category set (NULL or empty).

CREATE OR REPLACE FUNCTION public.sync_analyte_updates_to_lab_analytes()
RETURNS TRIGGER AS $$
BEGIN
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
    -- Only sync category if the lab has NOT customised it (protect lab-specific choice)
    category = CASE WHEN (category IS NULL OR category = '') THEN NEW.category ELSE category END,
    reference_range_male = NEW.reference_range_male,
    reference_range_female = NEW.reference_range_female,
    updated_at = now()
  WHERE analyte_id = NEW.id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
