-- Backfill calculated parameters for a specific lab
-- Sets: lab_analytes (is_calculated, formula, formula_variables, formula_description)
--       analyte_dependencies (lab-scoped rows cloned from global)
--
-- Usage: Replace the lab_id value below with the target lab UUID.

DO $$
DECLARE
  v_lab_id uuid := 'faba93ed-d96f-4876-9050-636c20ece666';  -- <<< SET YOUR LAB ID HERE
  v_hydrated integer := 0;
  v_deps_cloned integer := 0;
  v_updated integer := 0;
BEGIN
  RAISE NOTICE '=== Backfilling calculated params for lab %', v_lab_id;

  -- Step 1: Ensure lab_analytes rows exist for ALL calculated analytes in global table
  -- that are linked to this lab's test groups.
  INSERT INTO public.lab_analytes (
    lab_id, analyte_id, is_active, visible,
    name, unit, category, reference_range,
    low_critical, high_critical,
    interpretation_low, interpretation_normal, interpretation_high,
    description, ref_range_knowledge,
    ai_processing_type, ai_prompt_override, group_ai_mode,
    is_calculated, formula, formula_variables, formula_description,
    value_type, expected_normal_values, expected_value_flag_map,
    code
  )
  SELECT
    v_lab_id, a.id, true, true,
    a.name, a.unit, a.category, a.reference_range,
    a.low_critical, a.high_critical,
    a.interpretation_low, a.interpretation_normal, a.interpretation_high,
    a.description, COALESCE(a.ref_range_knowledge, '{}'::jsonb),
    a.ai_processing_type, a.ai_prompt_override, COALESCE(a.group_ai_mode, 'individual')::text,
    COALESCE(a.is_calculated, false), a.formula, COALESCE(a.formula_variables, '[]'::jsonb), a.formula_description,
    COALESCE(a.value_type, 'numeric'), COALESCE(a.expected_normal_values, '[]'::jsonb), COALESCE(a.expected_value_flag_map, '{}'::jsonb),
    a.code
  FROM public.analytes a
  WHERE a.is_calculated = true
    AND a.id IN (
      SELECT DISTINCT tga.analyte_id
      FROM public.test_group_analytes tga
      JOIN public.test_groups tg ON tg.id = tga.test_group_id
      WHERE tg.lab_id = v_lab_id
    )
  ON CONFLICT (lab_id, analyte_id) DO NOTHING;

  GET DIAGNOSTICS v_hydrated = ROW_COUNT;
  RAISE NOTICE '  ✅ Inserted % new lab_analytes rows for calculated analytes', v_hydrated;

  -- Step 2: Update existing lab_analytes that are missing calculated fields
  UPDATE public.lab_analytes la
  SET
    is_calculated       = COALESCE(a.is_calculated, false),
    formula             = COALESCE(la.formula, a.formula),
    formula_variables   = CASE WHEN la.formula_variables IS NULL OR la.formula_variables = '[]'::jsonb
                               THEN COALESCE(a.formula_variables, '[]'::jsonb)
                               ELSE la.formula_variables END,
    formula_description = COALESCE(la.formula_description, a.formula_description)
  FROM public.analytes a
  WHERE la.analyte_id = a.id
    AND la.lab_id = v_lab_id
    AND a.is_calculated = true
    AND (la.is_calculated IS NOT TRUE OR la.formula IS NULL);

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RAISE NOTICE '  🔄 Updated % existing lab_analytes with calculated fields', v_updated;

  -- Step 3: Clone global analyte_dependencies (lab_id IS NULL) → lab-scoped rows
  -- The trigger trg_sync_analyte_dependency_lab_links will auto-resolve
  -- calculated_lab_analyte_id and source_lab_analyte_id.
  --
  -- DEDUPLICATION: A lab may have both a canonical CBC analyte and a legacy analyte
  -- that both map to the same variable_name (e.g., two TLC analytes both satisfying
  -- variable_name = 'TLC'). Cloning both would create duplicate variable_name rows,
  -- causing the calculation engine to overwrite the scope variable with the last
  -- processed dep, silently using the wrong source.
  --
  -- Fix: per (calculated_analyte_id, variable_name), prefer the canonical CBC source
  -- (analyte_id starts with 'a1cbc000-'). If no canonical match, take exactly one.
  INSERT INTO public.analyte_dependencies (
    calculated_analyte_id, source_analyte_id, variable_name, lab_id
  )
  SELECT DISTINCT ON (ad.calculated_analyte_id, ad.variable_name)
    ad.calculated_analyte_id,
    ad.source_analyte_id,
    ad.variable_name,
    v_lab_id
  FROM public.analyte_dependencies ad
  WHERE ad.lab_id IS NULL
    AND ad.calculated_analyte_id IN (
      SELECT la.analyte_id
      FROM public.lab_analytes la
      WHERE la.lab_id = v_lab_id
        AND la.is_calculated = true
    )
    -- Only clone if source analyte also exists in this lab's lab_analytes
    AND ad.source_analyte_id IN (
      SELECT la2.analyte_id
      FROM public.lab_analytes la2
      WHERE la2.lab_id = v_lab_id
    )
    -- Skip if already exists for this lab (any source for this variable_name)
    AND NOT EXISTS (
      SELECT 1
      FROM public.analyte_dependencies existing
      WHERE existing.lab_id = v_lab_id
        AND existing.calculated_analyte_id = ad.calculated_analyte_id
        AND existing.variable_name = ad.variable_name
    )
  -- Canonical CBC analytes (a1cbc000-...) first; within same priority, pick lowest id
  ORDER BY
    ad.calculated_analyte_id,
    ad.variable_name,
    CASE WHEN ad.source_analyte_id::text LIKE 'a1cbc000-%' THEN 0 ELSE 1 END,
    ad.source_analyte_id;

  GET DIAGNOSTICS v_deps_cloned = ROW_COUNT;
  RAISE NOTICE '  🔗 Cloned % analyte_dependencies from global', v_deps_cloned;

  -- Step 4: Backfill lab_analyte_id in test_group_analytes where missing
  UPDATE public.test_group_analytes tga
  SET lab_analyte_id = la.id
  FROM public.lab_analytes la, public.test_groups tg
  WHERE tg.id = tga.test_group_id
    AND tga.analyte_id = la.analyte_id
    AND la.lab_id = v_lab_id
    AND tg.lab_id = v_lab_id
    AND tga.lab_analyte_id IS NULL;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RAISE NOTICE '  📍 Backfilled lab_analyte_id for % test_group_analytes rows', v_updated;

  RAISE NOTICE '=== Done! Summary: % lab_analytes created, % dependencies cloned', v_hydrated, v_deps_cloned;
END;
$$;

-- Verification queries (run after the above):

-- Check calculated analytes for the lab
-- SELECT la.id, la.analyte_id, la.name, la.is_calculated, la.formula, la.formula_variables
-- FROM lab_analytes la
-- WHERE la.lab_id = 'faba93ed-d96f-4876-9050-636c20ece666'
--   AND la.is_calculated = true;

-- Check lab-scoped dependencies
-- SELECT ad.id, a_calc.name AS calculated, a_src.name AS source, ad.variable_name,
--        ad.calculated_lab_analyte_id, ad.source_lab_analyte_id
-- FROM analyte_dependencies ad
-- JOIN analytes a_calc ON a_calc.id = ad.calculated_analyte_id
-- JOIN analytes a_src ON a_src.id = ad.source_analyte_id
-- WHERE ad.lab_id = 'faba93ed-d96f-4876-9050-636c20ece666';
