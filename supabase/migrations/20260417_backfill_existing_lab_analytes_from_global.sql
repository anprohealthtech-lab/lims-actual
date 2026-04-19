-- Migration: Safely backfill existing lab_analytes from global analytes
-- Date: 2026-04-17
-- Problem:
--   Older onboarding/sync flows created partial lab_analytes rows.
--   New sync logic now hydrates correctly, but existing rows remain stale.
--
-- Goal:
--   Fill obviously stubbed or missing base fields from analytes without
--   overwriting genuine lab-specific customization already stored in lab_analytes.

UPDATE public.lab_analytes la
SET
  name = CASE
    WHEN la.name IS NULL OR btrim(la.name) = '' THEN a.name
    ELSE la.name
  END,
  unit = CASE
    WHEN la.unit IS NULL OR btrim(la.unit) = '' THEN a.unit
    ELSE la.unit
  END,
  category = CASE
    WHEN la.category IS NULL OR btrim(la.category) = '' THEN a.category
    ELSE la.category
  END,
  reference_range = CASE
    WHEN la.reference_range IS NULL OR btrim(la.reference_range) = '' THEN a.reference_range
    ELSE la.reference_range
  END,
  low_critical = COALESCE(la.low_critical, a.low_critical),
  high_critical = COALESCE(la.high_critical, a.high_critical),
  interpretation_low = CASE
    WHEN la.interpretation_low IS NULL OR btrim(la.interpretation_low) = '' THEN a.interpretation_low
    ELSE la.interpretation_low
  END,
  interpretation_normal = CASE
    WHEN la.interpretation_normal IS NULL OR btrim(la.interpretation_normal) = '' THEN a.interpretation_normal
    ELSE la.interpretation_normal
  END,
  interpretation_high = CASE
    WHEN la.interpretation_high IS NULL OR btrim(la.interpretation_high) = '' THEN a.interpretation_high
    ELSE la.interpretation_high
  END,
  description = CASE
    WHEN la.description IS NULL OR btrim(la.description) = '' THEN a.description
    ELSE la.description
  END,
  ref_range_knowledge = CASE
    WHEN la.ref_range_knowledge IS NULL OR la.ref_range_knowledge = '{}'::jsonb THEN a.ref_range_knowledge
    ELSE la.ref_range_knowledge
  END,
  ai_processing_type = COALESCE(la.ai_processing_type, a.ai_processing_type),
  ai_prompt_override = COALESCE(la.ai_prompt_override, a.ai_prompt_override),
  group_ai_mode = CASE
    WHEN la.group_ai_mode IS NULL THEN a.group_ai_mode::text
    ELSE la.group_ai_mode
  END,
  is_calculated = CASE
    WHEN a.is_calculated = true
         AND COALESCE(la.is_calculated, false) = false
         AND (la.formula IS NULL OR btrim(la.formula) = '')
    THEN true
    ELSE la.is_calculated
  END,
  formula = CASE
    WHEN (la.formula IS NULL OR btrim(la.formula) = '') THEN a.formula
    ELSE la.formula
  END,
  formula_variables = CASE
    WHEN la.formula_variables IS NULL
         OR la.formula_variables = '[]'::jsonb
    THEN COALESCE(a.formula_variables, '[]'::jsonb)
    ELSE la.formula_variables
  END,
  formula_description = CASE
    WHEN la.formula_description IS NULL OR btrim(la.formula_description) = '' THEN a.formula_description
    ELSE la.formula_description
  END,
  value_type = CASE
    WHEN la.value_type IS NULL OR btrim(la.value_type) = '' THEN a.value_type
    ELSE la.value_type
  END,
  expected_normal_values = CASE
    WHEN la.expected_normal_values IS NULL
         OR la.expected_normal_values = '[]'::jsonb
    THEN COALESCE(a.expected_normal_values, '[]'::jsonb)
    ELSE la.expected_normal_values
  END,
  expected_value_flag_map = CASE
    WHEN la.expected_value_flag_map IS NULL
         OR la.expected_value_flag_map = '{}'::jsonb
    THEN COALESCE(a.expected_value_flag_map, '{}'::jsonb)
    ELSE la.expected_value_flag_map
  END,
  code = CASE
    WHEN la.code IS NULL OR btrim(la.code) = '' THEN a.code
    ELSE la.code
  END
FROM public.analytes a
WHERE a.id = la.analyte_id
  AND (
    la.name IS NULL OR btrim(la.name) = ''
    OR la.unit IS NULL OR btrim(la.unit) = ''
    OR la.category IS NULL OR btrim(la.category) = ''
    OR la.reference_range IS NULL OR btrim(la.reference_range) = ''
    OR la.interpretation_low IS NULL OR btrim(la.interpretation_low) = ''
    OR la.interpretation_normal IS NULL OR btrim(la.interpretation_normal) = ''
    OR la.interpretation_high IS NULL OR btrim(la.interpretation_high) = ''
    OR la.description IS NULL OR btrim(la.description) = ''
    OR la.ref_range_knowledge IS NULL OR la.ref_range_knowledge = '{}'::jsonb
    OR la.ai_processing_type IS NULL
    OR la.ai_prompt_override IS NULL
    OR la.group_ai_mode IS NULL
    OR (a.is_calculated = true AND COALESCE(la.is_calculated, false) = false AND (la.formula IS NULL OR btrim(la.formula) = ''))
    OR la.formula IS NULL OR btrim(la.formula) = ''
    OR la.formula_variables IS NULL OR la.formula_variables = '[]'::jsonb
    OR la.formula_description IS NULL OR btrim(la.formula_description) = ''
    OR la.value_type IS NULL OR btrim(la.value_type) = ''
    OR la.expected_normal_values IS NULL OR la.expected_normal_values = '[]'::jsonb
    OR la.expected_value_flag_map IS NULL OR la.expected_value_flag_map = '{}'::jsonb
    OR la.code IS NULL OR btrim(la.code) = ''
  );
