-- Migration: Add sample-type scope to analytes and lab_analytes
-- Date: 2026-06-18 19:30
-- Why:
--   The same analyte can have different units/reference ranges by specimen
--   (for example Glucose in Serum vs Urine vs CSF). test_groups already carry
--   sample_type, but analytes/lab_analytes did not, so linking by analyte_id
--   alone could attach the wrong lab-specific reference range.

ALTER TYPE public.sample_type ADD VALUE IF NOT EXISTS 'Fluoride Plasma';
ALTER TYPE public.sample_type ADD VALUE IF NOT EXISTS 'Citrated Plasma';
ALTER TYPE public.sample_type ADD VALUE IF NOT EXISTS 'Capillary Blood';

ALTER TABLE public.analytes
  ADD COLUMN IF NOT EXISTS sample_type text;

ALTER TABLE public.analytes
  ADD COLUMN IF NOT EXISTS method text,
  ADD COLUMN IF NOT EXISTS is_critical boolean,
  ADD COLUMN IF NOT EXISTS normal_range_min numeric,
  ADD COLUMN IF NOT EXISTS normal_range_max numeric;

ALTER TABLE public.lab_analytes
  ADD COLUMN IF NOT EXISTS sample_type text;

ALTER TABLE public.lab_analytes
  ADD COLUMN IF NOT EXISTS sample_type_key text
  GENERATED ALWAYS AS (lower(COALESCE(NULLIF(btrim(sample_type), ''), '__generic__'))) STORED;

ALTER TABLE public.global_test_catalog_analytes
  ADD COLUMN IF NOT EXISTS sample_type text;

COMMENT ON COLUMN public.analytes.sample_type IS
'Optional specimen/sample scope for this global analyte definition. NULL means generic/all sample types.';

COMMENT ON COLUMN public.lab_analytes.sample_type IS
'Optional specimen/sample scope for this lab-specific analyte. Prefer matching test_groups.sample_type; NULL means generic fallback.';

COMMENT ON COLUMN public.global_test_catalog_analytes.sample_type IS
'Optional specimen/sample scope for this catalog analyte row. NULL inherits the catalog/test group sample type.';

-- Keep global catalog specimen choices aligned with current sample types.
ALTER TABLE public.global_test_catalog
  DROP CONSTRAINT IF EXISTS global_test_catalog_specimen_type_check;

ALTER TABLE public.global_test_catalog
  ADD CONSTRAINT global_test_catalog_specimen_type_check
  CHECK (
    specimen_type_default IS NULL
    OR specimen_type_default = ANY (ARRAY[
      'Serum',
      'Plasma',
      'Whole Blood',
      'EDTA Blood',
      'Citrated Blood',
      'Citrated Plasma',
      'Fluoride Plasma',
      'Capillary Blood',
      'Urine',
      'Urine (Random)',
      'Urine (24hr)',
      'Stool',
      'CSF',
      'Sputum',
      'Swab',
      'Aspirate',
      'Biopsy',
      'Tissue',
      'Other'
    ])
  );

-- The original constraint prevented Serum/Urine/CSF variants of the same
-- analyte in one lab. Replace it with sample-aware uniqueness.
ALTER TABLE public.lab_analytes
  DROP CONSTRAINT IF EXISTS unique_lab_analyte;

ALTER TABLE public.lab_analytes
  DROP CONSTRAINT IF EXISTS lab_analytes_lab_id_analyte_id_key;

DROP INDEX IF EXISTS public.idx_lab_analytes_lab_analyte_sample;
DROP INDEX IF EXISTS public.uq_lab_analytes_lab_analyte_sample;
DROP INDEX IF EXISTS public.lab_analytes_lab_id_analyte_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_lab_analytes_lab_analyte_sample
ON public.lab_analytes (lab_id, analyte_id, sample_type_key);

CREATE INDEX IF NOT EXISTS idx_lab_analytes_sample_lookup
ON public.lab_analytes (lab_id, analyte_id, sample_type_key);

CREATE INDEX IF NOT EXISTS idx_analytes_sample_lookup
ON public.analytes (
  lower(COALESCE(NULLIF(btrim(sample_type), ''), '__generic__'))
);

CREATE INDEX IF NOT EXISTS idx_global_test_catalog_analytes_sample_type
ON public.global_test_catalog_analytes(catalog_id, sample_type)
WHERE sample_type IS NOT NULL;

-- Best-effort backfill: when an existing lab_analytes row is already attached
-- only to one sample type, mark it with that type. Mixed-use rows remain NULL
-- as generic fallback until the lab splits them intentionally.
WITH linked_sample_types AS (
  SELECT
    tga.lab_analyte_id,
    MIN(tg.sample_type::text) AS sample_type,
    COUNT(DISTINCT tg.sample_type::text) AS sample_type_count
  FROM public.test_group_analytes tga
  JOIN public.test_groups tg ON tg.id = tga.test_group_id
  WHERE tga.lab_analyte_id IS NOT NULL
    AND COALESCE(tga.is_visible, true) = true
    AND tg.sample_type IS NOT NULL
  GROUP BY tga.lab_analyte_id
)
UPDATE public.lab_analytes la
SET sample_type = linked_sample_types.sample_type,
    updated_at = NOW()
FROM linked_sample_types
WHERE la.id = linked_sample_types.lab_analyte_id
  AND linked_sample_types.sample_type_count = 1
  AND NULLIF(btrim(COALESCE(la.sample_type, '')), '') IS NULL;

-- Keep legacy global sync from overwriting sample-specific lab rows with
-- unrelated global defaults. Generic global analyte updates still propagate to
-- generic lab rows and to rows whose sample type matches the global row.
CREATE OR REPLACE FUNCTION sync_lab_analytes_on_analyte_update()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE lab_analytes
  SET
    name = CASE
      WHEN lab_specific_name IS NULL THEN NEW.name
      ELSE name
    END,
    unit = CASE
      WHEN lab_specific_unit IS NULL THEN NEW.unit
      ELSE unit
    END,
    reference_range = CASE
      WHEN lab_specific_reference_range IS NULL THEN NEW.reference_range
      ELSE reference_range
    END,
    reference_range_male = CASE
      WHEN lab_specific_reference_range IS NULL THEN NEW.reference_range_male
      ELSE reference_range_male
    END,
    reference_range_female = CASE
      WHEN lab_specific_reference_range IS NULL THEN NEW.reference_range_female
      ELSE reference_range_female
    END,
    low_critical = CASE
      WHEN lab_specific_interpretation_low IS NULL THEN NEW.low_critical
      ELSE low_critical
    END,
    high_critical = CASE
      WHEN lab_specific_interpretation_high IS NULL THEN NEW.high_critical
      ELSE high_critical
    END,
    critical_low = CASE
      WHEN lab_specific_interpretation_low IS NULL THEN NEW.low_critical
      ELSE critical_low
    END,
    critical_high = CASE
      WHEN lab_specific_interpretation_high IS NULL THEN NEW.high_critical
      ELSE critical_high
    END,
    interpretation_low = CASE
      WHEN lab_specific_interpretation_low IS NULL THEN NEW.interpretation_low
      ELSE interpretation_low
    END,
    interpretation_normal = CASE
      WHEN lab_specific_interpretation_normal IS NULL THEN NEW.interpretation_normal
      ELSE interpretation_normal
    END,
    interpretation_high = CASE
      WHEN lab_specific_interpretation_high IS NULL THEN NEW.interpretation_high
      ELSE interpretation_high
    END,
    is_active = NEW.is_active,
    sample_type = COALESCE(NULLIF(btrim(lab_analytes.sample_type), ''), NEW.sample_type),
    value_type = CASE
      WHEN value_type IS NULL OR value_type = '' THEN NEW.value_type
      ELSE value_type
    END,
    expected_normal_values = CASE
      WHEN expected_normal_values IS NULL OR expected_normal_values = '[]'::jsonb THEN COALESCE(NEW.expected_normal_values, '[]'::jsonb)
      ELSE expected_normal_values
    END,
    expected_value_flag_map = CASE
      WHEN expected_value_flag_map IS NULL OR expected_value_flag_map = '{}'::jsonb THEN COALESCE(NEW.expected_value_flag_map, '{}'::jsonb)
      ELSE expected_value_flag_map
    END,
    ai_processing_type = COALESCE(ai_processing_type, NEW.ai_processing_type),
    ai_prompt_override = COALESCE(ai_prompt_override, NEW.ai_prompt_override),
    group_ai_mode = COALESCE(group_ai_mode, NEW.group_ai_mode),
    is_calculated = CASE
      WHEN is_calculated IS NULL OR is_calculated = false THEN COALESCE(NEW.is_calculated, false)
      ELSE is_calculated
    END,
    formula = CASE
      WHEN formula IS NULL OR formula = '' THEN NEW.formula
      ELSE formula
    END,
    formula_variables = CASE
      WHEN formula_variables IS NULL OR formula_variables = '[]'::jsonb THEN COALESCE(NEW.formula_variables, '[]'::jsonb)
      ELSE formula_variables
    END,
    formula_description = CASE
      WHEN formula_description IS NULL OR formula_description = '' THEN NEW.formula_description
      ELSE formula_description
    END,
    code = CASE
      WHEN code IS NULL OR code = '' THEN NEW.code
      ELSE code
    END,
    category = CASE
      WHEN category IS NULL OR category = '' THEN NEW.category
      ELSE category
    END,
    description = CASE
      WHEN description IS NULL OR description = '' THEN NEW.description
      ELSE description
    END,
    ref_range_knowledge = CASE
      WHEN ref_range_knowledge IS NULL OR ref_range_knowledge = '{}'::jsonb THEN COALESCE(NEW.ref_range_knowledge, '{}'::jsonb)
      ELSE ref_range_knowledge
    END,
    updated_at = NOW()
  WHERE lab_analytes.analyte_id = NEW.id
    AND (
      (
        NULLIF(btrim(COALESCE(NEW.sample_type, '')), '') IS NULL
        AND NULLIF(btrim(COALESCE(lab_analytes.sample_type, '')), '') IS NULL
      )
      OR (
        NULLIF(btrim(COALESCE(NEW.sample_type, '')), '') IS NOT NULL
        AND (
          lower(COALESCE(NULLIF(btrim(lab_analytes.sample_type), ''), '__generic__')) =
            lower(NULLIF(btrim(NEW.sample_type), ''))
          OR NULLIF(btrim(COALESCE(lab_analytes.sample_type, '')), '') IS NULL
        )
      )
    );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sync_lab_analyte_from_global()
RETURNS TRIGGER AS $$
DECLARE
  v_lab_id UUID;
  v_test_sample_type text;
  v_analyte_record RECORD;
  v_lab_analyte_id UUID;
BEGIN
  SELECT test_groups.lab_id, test_groups.sample_type::text
  INTO v_lab_id, v_test_sample_type
  FROM test_groups
  WHERE test_groups.id = NEW.test_group_id;

  IF v_lab_id IS NULL THEN
    RAISE WARNING 'Test group % has no lab_id, skipping lab_analytes sync', NEW.test_group_id;
    RETURN NEW;
  END IF;

  SELECT * INTO v_analyte_record
  FROM analytes
  WHERE analytes.id = NEW.analyte_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Analyte % not found in global analytes table', NEW.analyte_id;
  END IF;

  SELECT la.id INTO v_lab_analyte_id
  FROM lab_analytes la
  WHERE la.lab_id = v_lab_id
    AND la.analyte_id = NEW.analyte_id
    AND (
      (
        NULLIF(btrim(COALESCE(v_test_sample_type, '')), '') IS NOT NULL
        AND lower(NULLIF(btrim(la.sample_type), '')) = lower(NULLIF(btrim(v_test_sample_type), ''))
      )
      OR (
        NULLIF(btrim(COALESCE(v_test_sample_type, '')), '') IS NULL
        AND NULLIF(btrim(COALESCE(la.sample_type, '')), '') IS NULL
      )
    )
  ORDER BY la.created_at ASC
  LIMIT 1;

  IF v_lab_analyte_id IS NULL THEN
    INSERT INTO lab_analytes (
      lab_id,
      analyte_id,
      sample_type,
      is_active,
      visible,
      name,
      unit,
      category,
      reference_range,
      reference_range_male,
      reference_range_female,
      low_critical,
      high_critical,
      critical_low,
      critical_high,
      interpretation_low,
      interpretation_normal,
      interpretation_high,
      method,
      description,
      ref_range_knowledge,
      ai_processing_type,
      ai_prompt_override,
      group_ai_mode,
      is_calculated,
      formula,
      formula_variables,
      formula_description,
      value_type,
      expected_normal_values,
      expected_value_flag_map,
      code,
      is_critical,
      normal_range_min,
      normal_range_max,
      created_at,
      updated_at
    ) VALUES (
      v_lab_id,
      NEW.analyte_id,
      COALESCE(NULLIF(btrim(v_analyte_record.sample_type), ''), NULLIF(btrim(v_test_sample_type), '')),
      v_analyte_record.is_active,
      true,
      v_analyte_record.name,
      v_analyte_record.unit,
      v_analyte_record.category,
      v_analyte_record.reference_range,
      v_analyte_record.reference_range_male,
      v_analyte_record.reference_range_female,
      v_analyte_record.low_critical,
      v_analyte_record.high_critical,
      v_analyte_record.low_critical,
      v_analyte_record.high_critical,
      v_analyte_record.interpretation_low,
      v_analyte_record.interpretation_normal,
      v_analyte_record.interpretation_high,
      v_analyte_record.method,
      v_analyte_record.description,
      COALESCE(v_analyte_record.ref_range_knowledge, '{}'::jsonb),
      v_analyte_record.ai_processing_type,
      v_analyte_record.ai_prompt_override,
      COALESCE(v_analyte_record.group_ai_mode, 'individual'),
      COALESCE(v_analyte_record.is_calculated, false),
      v_analyte_record.formula,
      COALESCE(v_analyte_record.formula_variables, '[]'::jsonb),
      v_analyte_record.formula_description,
      COALESCE(v_analyte_record.value_type, 'numeric'),
      COALESCE(v_analyte_record.expected_normal_values, '[]'::jsonb),
      COALESCE(v_analyte_record.expected_value_flag_map, '{}'::jsonb),
      v_analyte_record.code,
      v_analyte_record.is_critical,
      v_analyte_record.normal_range_min,
      v_analyte_record.normal_range_max,
      NOW(),
      NOW()
    )
    RETURNING id INTO v_lab_analyte_id;
  END IF;

  NEW.lab_analyte_id = COALESCE(NEW.lab_analyte_id, v_lab_analyte_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- BEFORE is important because the trigger can set NEW.lab_analyte_id before
-- test_group_analytes is inserted.
DROP TRIGGER IF EXISTS trigger_sync_lab_analyte_on_test_group_link ON public.test_group_analytes;
CREATE TRIGGER trigger_sync_lab_analyte_on_test_group_link
BEFORE INSERT OR UPDATE OF analyte_id, test_group_id ON public.test_group_analytes
FOR EACH ROW
EXECUTE FUNCTION sync_lab_analyte_from_global();
