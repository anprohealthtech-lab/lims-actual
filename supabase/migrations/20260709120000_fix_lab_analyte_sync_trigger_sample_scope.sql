-- Fix lab analyte sync trigger so catalog/test-group linking is idempotent.
-- The previous version looked up existing lab_analytes by test group sample type,
-- then inserted using the analyte's own sample_type when present. That could miss
-- an existing row and violate uq_lab_analytes_lab_analyte_sample.

CREATE OR REPLACE FUNCTION public.sync_lab_analyte_from_global()
RETURNS TRIGGER AS $$
DECLARE
  v_lab_id UUID;
  v_test_sample_type text;
  v_effective_sample_type text;
  v_analyte_record RECORD;
  v_lab_analyte_id UUID;
BEGIN
  IF NEW.lab_analyte_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT test_groups.lab_id, test_groups.sample_type::text
  INTO v_lab_id, v_test_sample_type
  FROM public.test_groups
  WHERE test_groups.id = NEW.test_group_id;

  IF v_lab_id IS NULL THEN
    RAISE WARNING 'Test group % has no lab_id, skipping lab_analytes sync', NEW.test_group_id;
    RETURN NEW;
  END IF;

  SELECT * INTO v_analyte_record
  FROM public.analytes
  WHERE analytes.id = NEW.analyte_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Analyte % not found in global analytes table', NEW.analyte_id;
  END IF;

  v_effective_sample_type := COALESCE(
    NULLIF(btrim(v_analyte_record.sample_type), ''),
    NULLIF(btrim(v_test_sample_type), '')
  );

  SELECT la.id INTO v_lab_analyte_id
  FROM public.lab_analytes la
  WHERE la.lab_id = v_lab_id
    AND la.analyte_id = NEW.analyte_id
    AND lower(COALESCE(NULLIF(btrim(la.sample_type), ''), '__generic__')) =
        lower(COALESCE(v_effective_sample_type, '__generic__'))
  ORDER BY la.created_at ASC
  LIMIT 1;

  IF v_lab_analyte_id IS NULL THEN
    INSERT INTO public.lab_analytes (
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
      v_effective_sample_type,
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
    ON CONFLICT (lab_id, analyte_id, sample_type_key) DO UPDATE
    SET updated_at = NOW()
    RETURNING id INTO v_lab_analyte_id;
  END IF;

  NEW.lab_analyte_id = v_lab_analyte_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
