-- Migration: Sync expected_normal_values and related fields to lab_analytes
-- Date: 2026-06-18
-- Problem:
--   The sync trigger `sync_lab_analytes_on_analyte_update` doesn't propagate
--   expected_normal_values, expected_value_flag_map, value_type, and other
--   newer fields from analytes to lab_analytes.
--
-- Solution:
--   1. Update the trigger function to include these fields
--   2. Backfill existing lab_analytes where expected_normal_values is empty

-- =====================================================
-- STEP 1: Update the sync function
-- =====================================================

CREATE OR REPLACE FUNCTION sync_lab_analytes_on_analyte_update()
RETURNS TRIGGER AS $$
BEGIN
  -- Update all lab_analytes that reference this global analyte
  -- Only update fields that are NOT lab-specific (i.e., where lab_specific_* fields are NULL)

  UPDATE lab_analytes
  SET
    -- Update name only if not customized
    name = CASE
      WHEN lab_specific_name IS NULL THEN NEW.name
      ELSE name
    END,

    -- Update unit only if not customized
    unit = CASE
      WHEN lab_specific_unit IS NULL THEN NEW.unit
      ELSE unit
    END,

    -- Update reference ranges only if not customized
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

    -- Update critical values only if not customized
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

    -- Update interpretations only if not customized
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

    -- Always sync is_active status
    is_active = NEW.is_active,

    -- NEW: Sync value_type and expected values if not customized at lab level
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

    -- Sync AI fields if not customized
    ai_processing_type = COALESCE(ai_processing_type, NEW.ai_processing_type),
    ai_prompt_override = COALESCE(ai_prompt_override, NEW.ai_prompt_override),
    group_ai_mode = COALESCE(group_ai_mode, NEW.group_ai_mode),

    -- Sync calculated fields if not customized
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

    -- Sync code and other metadata
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

  WHERE lab_analytes.analyte_id = NEW.id;

  -- Log the sync
  RAISE NOTICE 'Synced % lab_analytes records for global analyte % (%)',
    (SELECT COUNT(*) FROM lab_analytes WHERE lab_analytes.analyte_id = NEW.id),
    NEW.id,
    NEW.name;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- STEP 2: Update the trigger to fire on more field changes
-- =====================================================

DROP TRIGGER IF EXISTS trigger_sync_lab_analyte_on_analyte_update ON analytes;

CREATE TRIGGER trigger_sync_lab_analyte_on_analyte_update
AFTER UPDATE ON analytes
FOR EACH ROW
WHEN (
  -- Trigger when actual data fields change (not just updated_at)
  OLD.name IS DISTINCT FROM NEW.name OR
  OLD.unit IS DISTINCT FROM NEW.unit OR
  OLD.reference_range IS DISTINCT FROM NEW.reference_range OR
  OLD.reference_range_male IS DISTINCT FROM NEW.reference_range_male OR
  OLD.reference_range_female IS DISTINCT FROM NEW.reference_range_female OR
  OLD.low_critical IS DISTINCT FROM NEW.low_critical OR
  OLD.high_critical IS DISTINCT FROM NEW.high_critical OR
  OLD.interpretation_low IS DISTINCT FROM NEW.interpretation_low OR
  OLD.interpretation_normal IS DISTINCT FROM NEW.interpretation_normal OR
  OLD.interpretation_high IS DISTINCT FROM NEW.interpretation_high OR
  OLD.is_active IS DISTINCT FROM NEW.is_active OR
  -- NEW: Also trigger on these fields
  OLD.value_type IS DISTINCT FROM NEW.value_type OR
  OLD.expected_normal_values IS DISTINCT FROM NEW.expected_normal_values OR
  OLD.expected_value_flag_map IS DISTINCT FROM NEW.expected_value_flag_map OR
  OLD.ai_processing_type IS DISTINCT FROM NEW.ai_processing_type OR
  OLD.ai_prompt_override IS DISTINCT FROM NEW.ai_prompt_override OR
  OLD.group_ai_mode IS DISTINCT FROM NEW.group_ai_mode OR
  OLD.is_calculated IS DISTINCT FROM NEW.is_calculated OR
  OLD.formula IS DISTINCT FROM NEW.formula OR
  OLD.formula_variables IS DISTINCT FROM NEW.formula_variables OR
  OLD.formula_description IS DISTINCT FROM NEW.formula_description OR
  OLD.code IS DISTINCT FROM NEW.code OR
  OLD.category IS DISTINCT FROM NEW.category OR
  OLD.description IS DISTINCT FROM NEW.description OR
  OLD.ref_range_knowledge IS DISTINCT FROM NEW.ref_range_knowledge
)
EXECUTE FUNCTION sync_lab_analytes_on_analyte_update();

COMMENT ON TRIGGER trigger_sync_lab_analyte_on_analyte_update ON analytes IS
'Propagates changes from global analytes to all lab_analytes, preserving lab customizations.
Includes expected_normal_values, value_type, AI fields, and calculated params.';

-- =====================================================
-- STEP 3: Backfill existing lab_analytes with empty expected_normal_values
-- =====================================================

UPDATE public.lab_analytes la
SET
  value_type = CASE
    WHEN la.value_type IS NULL OR btrim(la.value_type) = '' THEN a.value_type
    ELSE la.value_type
  END,
  expected_normal_values = CASE
    WHEN la.expected_normal_values IS NULL OR la.expected_normal_values = '[]'::jsonb
    THEN COALESCE(a.expected_normal_values, '[]'::jsonb)
    ELSE la.expected_normal_values
  END,
  expected_value_flag_map = CASE
    WHEN la.expected_value_flag_map IS NULL OR la.expected_value_flag_map = '{}'::jsonb
    THEN COALESCE(a.expected_value_flag_map, '{}'::jsonb)
    ELSE la.expected_value_flag_map
  END,
  updated_at = NOW()
FROM public.analytes a
WHERE a.id = la.analyte_id
  AND (
    (la.expected_normal_values IS NULL OR la.expected_normal_values = '[]'::jsonb)
    AND a.expected_normal_values IS NOT NULL
    AND a.expected_normal_values != '[]'::jsonb
  );

-- =====================================================
-- STEP 4: Update the initial sync function to include all fields
-- =====================================================

CREATE OR REPLACE FUNCTION sync_lab_analyte_from_global()
RETURNS TRIGGER AS $$
DECLARE
  v_lab_id UUID;
  v_analyte_record RECORD;
  v_existing_count INT;
BEGIN
  -- Get lab_id from test_groups table
  SELECT test_groups.lab_id INTO v_lab_id
  FROM test_groups
  WHERE test_groups.id = NEW.test_group_id;

  IF v_lab_id IS NULL THEN
    RAISE WARNING 'Test group % has no lab_id, skipping lab_analytes sync', NEW.test_group_id;
    RETURN NEW;
  END IF;

  -- Check if lab_analyte already exists
  SELECT COUNT(*) INTO v_existing_count
  FROM lab_analytes
  WHERE lab_analytes.lab_id = v_lab_id
    AND lab_analytes.analyte_id = NEW.analyte_id;

  -- If already exists, skip creation
  IF v_existing_count > 0 THEN
    RAISE NOTICE 'lab_analytes record already exists for lab % and analyte %', v_lab_id, NEW.analyte_id;
    RETURN NEW;
  END IF;

  -- Fetch global analyte data
  SELECT * INTO v_analyte_record
  FROM analytes
  WHERE analytes.id = NEW.analyte_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Analyte % not found in global analytes table', NEW.analyte_id;
  END IF;

  -- Create lab_analytes record by copying ALL fields from global analyte
  INSERT INTO lab_analytes (
    id,
    lab_id,
    analyte_id,
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
    gen_random_uuid(),
    v_lab_id,
    NEW.analyte_id,
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
  );

  RAISE NOTICE 'Created lab_analytes record for lab % and analyte % (%)',
    v_lab_id, NEW.analyte_id, v_analyte_record.name;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION sync_lab_analyte_from_global() IS
'Auto-creates fully hydrated lab_analytes record when a test group is linked to a global analyte.
Includes expected_normal_values, value_type, AI fields, and calculated params.';
