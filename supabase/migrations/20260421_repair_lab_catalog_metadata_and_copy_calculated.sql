-- Repair onboarding/sync metadata drift and provide reusable calculated-param copying between labs.
-- Adds:
--   1) public.repair_lab_catalog_metadata(target_lab_id uuid)
--   2) public.copy_calculated_params_between_labs(source_lab_id uuid, target_lab_id uuid)

CREATE OR REPLACE FUNCTION public.repair_lab_catalog_metadata(target_lab_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_hydrated_lab_analytes integer := 0;
  v_customized_lab_analytes integer := 0;
  v_inserted_group_analytes integer := 0;
  v_updated_group_analytes integer := 0;
  v_inserted_sections integer := 0;
  v_updated_sections integer := 0;
  v_backfilled_group_links integer := 0;
  v_updated_analyte_counts integer := 0;
BEGIN
  -- 1. Ensure every analyte referenced by the lab's global-linked groups exists in lab_analytes.
  INSERT INTO public.lab_analytes (
    lab_id,
    analyte_id,
    is_active,
    visible,
    name,
    unit,
    category,
    reference_range,
    low_critical,
    high_critical,
    interpretation_low,
    interpretation_normal,
    interpretation_high,
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
    code
  )
  SELECT DISTINCT
    target_lab_id,
    a.id,
    true,
    true,
    a.name,
    a.unit,
    a.category,
    a.reference_range,
    a.low_critical,
    a.high_critical,
    a.interpretation_low,
    a.interpretation_normal,
    a.interpretation_high,
    a.description,
    COALESCE(a.ref_range_knowledge, '{}'::jsonb),
    a.ai_processing_type,
    a.ai_prompt_override,
    COALESCE(a.group_ai_mode::text, 'individual'),
    COALESCE(a.is_calculated, false),
    a.formula,
    COALESCE(a.formula_variables, '[]'::jsonb),
    a.formula_description,
    COALESCE(a.value_type::text, 'numeric'),
    COALESCE(a.expected_normal_values, '[]'::jsonb),
    COALESCE(a.expected_value_flag_map, '{}'::jsonb),
    a.code
  FROM public.test_groups tg
  JOIN public.global_test_catalog_analytes gtca
    ON gtca.catalog_id = tg.global_test_catalog_id
  JOIN public.analytes a
    ON a.id = gtca.analyte_id
  WHERE tg.lab_id = target_lab_id
    AND tg.global_test_catalog_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.lab_analytes la
      WHERE la.lab_id = target_lab_id
        AND la.analyte_id = a.id
    );

  GET DIAGNOSTICS v_hydrated_lab_analytes = ROW_COUNT;

  -- 2. Backfill lab-specific/custom catalog metadata when it is missing on lab_analytes.
  UPDATE public.lab_analytes la
  SET
    lab_specific_name = CASE
      WHEN gtca.custom_name IS NOT NULL
       AND (la.lab_specific_name IS NULL OR btrim(la.lab_specific_name) = '')
      THEN gtca.custom_name
      ELSE la.lab_specific_name
    END,
    lab_specific_unit = CASE
      WHEN gtca.custom_unit IS NOT NULL
       AND (la.lab_specific_unit IS NULL OR btrim(la.lab_specific_unit) = '')
      THEN gtca.custom_unit
      ELSE la.lab_specific_unit
    END,
    lab_specific_interpretation_low = CASE
      WHEN gtca.custom_interpretation_low IS NOT NULL
       AND (la.lab_specific_interpretation_low IS NULL OR btrim(la.lab_specific_interpretation_low) = '')
      THEN gtca.custom_interpretation_low
      ELSE la.lab_specific_interpretation_low
    END,
    lab_specific_interpretation_normal = CASE
      WHEN gtca.custom_interpretation_normal IS NOT NULL
       AND (la.lab_specific_interpretation_normal IS NULL OR btrim(la.lab_specific_interpretation_normal) = '')
      THEN gtca.custom_interpretation_normal
      ELSE la.lab_specific_interpretation_normal
    END,
    lab_specific_interpretation_high = CASE
      WHEN gtca.custom_interpretation_high IS NOT NULL
       AND (la.lab_specific_interpretation_high IS NULL OR btrim(la.lab_specific_interpretation_high) = '')
      THEN gtca.custom_interpretation_high
      ELSE la.lab_specific_interpretation_high
    END,
    lab_specific_method = CASE
      WHEN gtca.custom_method IS NOT NULL
       AND (la.lab_specific_method IS NULL OR btrim(la.lab_specific_method) = '')
      THEN gtca.custom_method
      ELSE la.lab_specific_method
    END,
    lab_specific_reference_range = CASE
      WHEN gtca.custom_reference_range IS NOT NULL
       AND (la.lab_specific_reference_range IS NULL OR btrim(la.lab_specific_reference_range) = '')
      THEN gtca.custom_reference_range
      ELSE la.lab_specific_reference_range
    END,
    display_name = CASE
      WHEN gtca.display_name IS NOT NULL
       AND (la.display_name IS NULL OR btrim(la.display_name) = '')
      THEN gtca.display_name
      ELSE la.display_name
    END,
    default_value = CASE
      WHEN gtca.default_value IS NOT NULL
       AND (la.default_value IS NULL OR btrim(la.default_value) = '')
      THEN gtca.default_value
      ELSE la.default_value
    END,
    value_type = CASE
      WHEN gtca.custom_value_type IS NOT NULL
       AND (la.value_type IS NULL OR btrim(la.value_type) = '')
      THEN gtca.custom_value_type
      ELSE la.value_type
    END,
    expected_normal_values = CASE
      WHEN gtca.custom_expected_normal_values IS NOT NULL
       AND gtca.custom_expected_normal_values <> '[]'::jsonb
       AND (la.expected_normal_values IS NULL OR la.expected_normal_values = '[]'::jsonb)
      THEN gtca.custom_expected_normal_values
      ELSE la.expected_normal_values
    END,
    expected_value_flag_map = CASE
      WHEN gtca.custom_expected_value_codes IS NOT NULL
       AND gtca.custom_expected_value_codes <> '{}'::jsonb
       AND (la.expected_value_flag_map IS NULL OR la.expected_value_flag_map = '{}'::jsonb)
      THEN gtca.custom_expected_value_codes
      ELSE la.expected_value_flag_map
    END,
    updated_at = now()
  FROM public.test_groups tg
  JOIN public.global_test_catalog_analytes gtca
    ON gtca.catalog_id = tg.global_test_catalog_id
  WHERE tg.lab_id = target_lab_id
    AND tg.global_test_catalog_id IS NOT NULL
    AND la.lab_id = target_lab_id
    AND la.analyte_id = gtca.analyte_id
    AND (
      (gtca.custom_name IS NOT NULL AND (la.lab_specific_name IS NULL OR btrim(la.lab_specific_name) = ''))
      OR (gtca.custom_unit IS NOT NULL AND (la.lab_specific_unit IS NULL OR btrim(la.lab_specific_unit) = ''))
      OR (gtca.custom_interpretation_low IS NOT NULL AND (la.lab_specific_interpretation_low IS NULL OR btrim(la.lab_specific_interpretation_low) = ''))
      OR (gtca.custom_interpretation_normal IS NOT NULL AND (la.lab_specific_interpretation_normal IS NULL OR btrim(la.lab_specific_interpretation_normal) = ''))
      OR (gtca.custom_interpretation_high IS NOT NULL AND (la.lab_specific_interpretation_high IS NULL OR btrim(la.lab_specific_interpretation_high) = ''))
      OR (gtca.custom_method IS NOT NULL AND (la.lab_specific_method IS NULL OR btrim(la.lab_specific_method) = ''))
      OR (gtca.custom_reference_range IS NOT NULL AND (la.lab_specific_reference_range IS NULL OR btrim(la.lab_specific_reference_range) = ''))
      OR (gtca.display_name IS NOT NULL AND (la.display_name IS NULL OR btrim(la.display_name) = ''))
      OR (gtca.default_value IS NOT NULL AND (la.default_value IS NULL OR btrim(la.default_value) = ''))
      OR (gtca.custom_value_type IS NOT NULL AND (la.value_type IS NULL OR btrim(la.value_type) = ''))
      OR (gtca.custom_expected_normal_values IS NOT NULL AND gtca.custom_expected_normal_values <> '[]'::jsonb AND (la.expected_normal_values IS NULL OR la.expected_normal_values = '[]'::jsonb))
      OR (gtca.custom_expected_value_codes IS NOT NULL AND gtca.custom_expected_value_codes <> '{}'::jsonb AND (la.expected_value_flag_map IS NULL OR la.expected_value_flag_map = '{}'::jsonb))
    );

  GET DIAGNOSTICS v_customized_lab_analytes = ROW_COUNT;

  -- 3. Insert missing test_group_analytes rows with full catalog metadata.
  INSERT INTO public.test_group_analytes (
    test_group_id,
    analyte_id,
    display_order,
    is_visible,
    custom_reference_range,
    is_header,
    header_name,
    sort_order,
    section_heading,
    analyte_name,
    test_group_name,
    lab_id,
    lab_analyte_id
  )
  SELECT
    tg.id,
    gtca.analyte_id,
    COALESCE(gtca.display_order, gtca.sort_order, 0),
    COALESCE(gtca.is_visible, true),
    gtca.custom_reference_range,
    COALESCE(gtca.is_header, false),
    gtca.header_name,
    COALESCE(gtca.sort_order, 0),
    gtca.section_heading,
    COALESCE(la.display_name, la.lab_specific_name, la.name, a.name),
    tg.name,
    target_lab_id,
    la.id
  FROM public.test_groups tg
  JOIN public.global_test_catalog_analytes gtca
    ON gtca.catalog_id = tg.global_test_catalog_id
  JOIN public.analytes a
    ON a.id = gtca.analyte_id
  LEFT JOIN public.lab_analytes la
    ON la.lab_id = target_lab_id
   AND la.analyte_id = gtca.analyte_id
  WHERE tg.lab_id = target_lab_id
    AND tg.global_test_catalog_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.test_group_analytes tga
      WHERE tga.test_group_id = tg.id
        AND tga.analyte_id = gtca.analyte_id
    );

  GET DIAGNOSTICS v_inserted_group_analytes = ROW_COUNT;

  -- 4. Force-refresh group analyte ordering and section/header metadata.
  UPDATE public.test_group_analytes tga
  SET
    display_order = COALESCE(gtca.display_order, gtca.sort_order, 0),
    is_visible = COALESCE(gtca.is_visible, true),
    custom_reference_range = gtca.custom_reference_range,
    is_header = COALESCE(gtca.is_header, false),
    header_name = gtca.header_name,
    sort_order = COALESCE(gtca.sort_order, 0),
    section_heading = gtca.section_heading,
    analyte_name = COALESCE(la.display_name, la.lab_specific_name, la.name, a.name),
    test_group_name = tg.name,
    lab_id = target_lab_id,
    lab_analyte_id = la.id
  FROM public.test_groups tg
  JOIN public.global_test_catalog_analytes gtca
    ON gtca.catalog_id = tg.global_test_catalog_id
  JOIN public.analytes a
    ON a.id = gtca.analyte_id
  LEFT JOIN public.lab_analytes la
    ON la.lab_id = target_lab_id
   AND la.analyte_id = gtca.analyte_id
  WHERE tga.test_group_id = tg.id
    AND tga.analyte_id = gtca.analyte_id
    AND tg.lab_id = target_lab_id
    AND tg.global_test_catalog_id IS NOT NULL
    AND (
      tga.display_order IS DISTINCT FROM COALESCE(gtca.display_order, gtca.sort_order, 0)
      OR tga.is_visible IS DISTINCT FROM COALESCE(gtca.is_visible, true)
      OR tga.custom_reference_range IS DISTINCT FROM gtca.custom_reference_range
      OR tga.is_header IS DISTINCT FROM COALESCE(gtca.is_header, false)
      OR tga.header_name IS DISTINCT FROM gtca.header_name
      OR tga.sort_order IS DISTINCT FROM COALESCE(gtca.sort_order, 0)
      OR tga.section_heading IS DISTINCT FROM gtca.section_heading
      OR tga.analyte_name IS DISTINCT FROM COALESCE(la.display_name, la.lab_specific_name, la.name, a.name)
      OR tga.test_group_name IS DISTINCT FROM tg.name
      OR tga.lab_id IS DISTINCT FROM target_lab_id
      OR tga.lab_analyte_id IS DISTINCT FROM la.id
    );

  GET DIAGNOSTICS v_updated_group_analytes = ROW_COUNT;

  -- 5. Update existing lab_template_sections from global metadata.
  UPDATE public.lab_template_sections lts
  SET
    section_name = gcs.section_name,
    display_order = gcs.display_order,
    default_content = gcs.default_content,
    predefined_options = COALESCE(gcs.predefined_options, '[]'::jsonb),
    is_required = COALESCE(gcs.is_required, false),
    is_editable = COALESCE(gcs.is_editable, true),
    placeholder_key = gcs.placeholder_key,
    allow_images = COALESCE(gcs.allow_images, false),
    allow_technician_entry = COALESCE(gcs.allow_technician_entry, false),
    updated_at = now()
  FROM public.test_groups tg
  JOIN public.global_test_catalog_sections gcs
    ON gcs.catalog_id = tg.global_test_catalog_id
  WHERE lts.lab_id = target_lab_id
    AND lts.test_group_id = tg.id
    AND lts.section_type = gcs.section_type
    AND tg.lab_id = target_lab_id
    AND tg.global_test_catalog_id IS NOT NULL
    AND (
      lts.section_name IS DISTINCT FROM gcs.section_name
      OR lts.display_order IS DISTINCT FROM gcs.display_order
      OR lts.default_content IS DISTINCT FROM gcs.default_content
      OR lts.predefined_options IS DISTINCT FROM COALESCE(gcs.predefined_options, '[]'::jsonb)
      OR lts.is_required IS DISTINCT FROM COALESCE(gcs.is_required, false)
      OR lts.is_editable IS DISTINCT FROM COALESCE(gcs.is_editable, true)
      OR lts.placeholder_key IS DISTINCT FROM gcs.placeholder_key
      OR lts.allow_images IS DISTINCT FROM COALESCE(gcs.allow_images, false)
      OR lts.allow_technician_entry IS DISTINCT FROM COALESCE(gcs.allow_technician_entry, false)
    );

  GET DIAGNOSTICS v_updated_sections = ROW_COUNT;

  -- 6. Insert missing lab_template_sections rows.
  INSERT INTO public.lab_template_sections (
    lab_id,
    test_group_id,
    section_type,
    section_name,
    display_order,
    default_content,
    predefined_options,
    is_required,
    is_editable,
    placeholder_key,
    allow_images,
    allow_technician_entry
  )
  SELECT
    target_lab_id,
    tg.id,
    gcs.section_type,
    gcs.section_name,
    gcs.display_order,
    gcs.default_content,
    COALESCE(gcs.predefined_options, '[]'::jsonb),
    COALESCE(gcs.is_required, false),
    COALESCE(gcs.is_editable, true),
    gcs.placeholder_key,
    COALESCE(gcs.allow_images, false),
    COALESCE(gcs.allow_technician_entry, false)
  FROM public.test_groups tg
  JOIN public.global_test_catalog_sections gcs
    ON gcs.catalog_id = tg.global_test_catalog_id
  WHERE tg.lab_id = target_lab_id
    AND tg.global_test_catalog_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.lab_template_sections lts
      WHERE lts.lab_id = target_lab_id
        AND lts.test_group_id = tg.id
        AND lts.section_type = gcs.section_type
    );

  GET DIAGNOSTICS v_inserted_sections = ROW_COUNT;

  -- 7. General backfill of missing lab_analyte_id and lab_id on group analytes.
  UPDATE public.test_group_analytes tga
  SET
    lab_analyte_id = la.id,
    lab_id = target_lab_id
  FROM public.test_groups tg,
       public.lab_analytes la
  WHERE tg.id = tga.test_group_id
    AND tg.lab_id = target_lab_id
    AND la.lab_id = target_lab_id
    AND la.analyte_id = tga.analyte_id
    AND (
      tga.lab_analyte_id IS NULL
      OR tga.lab_analyte_id <> la.id
      OR tga.lab_id IS DISTINCT FROM target_lab_id
    );

  GET DIAGNOSTICS v_backfilled_group_links = ROW_COUNT;

  -- 8. Refresh analyte_count on all lab groups.
  UPDATE public.test_groups tg
  SET
    analyte_count = COALESCE(src.cnt, 0),
    updated_at = now()
  FROM (
    SELECT test_group_id, COUNT(*)::integer AS cnt
    FROM public.test_group_analytes
    GROUP BY test_group_id
  ) src
  WHERE tg.lab_id = target_lab_id
    AND tg.id = src.test_group_id
    AND tg.analyte_count IS DISTINCT FROM src.cnt;

  GET DIAGNOSTICS v_updated_analyte_counts = ROW_COUNT;

  RETURN jsonb_build_object(
    'lab_id', target_lab_id,
    'hydrated_lab_analytes', v_hydrated_lab_analytes,
    'customized_lab_analytes', v_customized_lab_analytes,
    'inserted_test_group_analytes', v_inserted_group_analytes,
    'updated_test_group_analytes', v_updated_group_analytes,
    'inserted_lab_template_sections', v_inserted_sections,
    'updated_lab_template_sections', v_updated_sections,
    'backfilled_group_links', v_backfilled_group_links,
    'updated_analyte_counts', v_updated_analyte_counts
  );
END;
$function$;

COMMENT ON FUNCTION public.repair_lab_catalog_metadata(uuid) IS
'Repairs onboarding/sync drift for one lab by hydrating missing lab_analytes, refreshing test_group_analytes metadata (section headings, order, headers, visibility, lab_analyte_id), and force-syncing lab_template_sections names and display order from the global catalog.';


CREATE OR REPLACE FUNCTION public.copy_calculated_params_between_labs(source_lab_id uuid, target_lab_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_inserted_calculated integer := 0;
  v_updated_calculated integer := 0;
  v_inserted_source_analytes integer := 0;
  v_deleted_deps integer := 0;
  v_inserted_deps integer := 0;
  v_backfilled_group_links integer := 0;
BEGIN
  -- 1. Ensure target lab has calculated analytes from source lab.
  INSERT INTO public.lab_analytes (
    lab_id,
    analyte_id,
    is_active,
    visible,
    name,
    unit,
    category,
    reference_range,
    low_critical,
    high_critical,
    interpretation_low,
    interpretation_normal,
    interpretation_high,
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
    code
  )
  SELECT
    target_lab_id,
    src.analyte_id,
    true,
    true,
    COALESCE(src.name, a.name),
    COALESCE(src.unit, a.unit),
    COALESCE(src.category, a.category),
    COALESCE(src.reference_range, a.reference_range),
    COALESCE(src.low_critical, a.low_critical),
    COALESCE(src.high_critical, a.high_critical),
    COALESCE(src.interpretation_low, a.interpretation_low),
    COALESCE(src.interpretation_normal, a.interpretation_normal),
    COALESCE(src.interpretation_high, a.interpretation_high),
    COALESCE(src.description, a.description),
    COALESCE(src.ref_range_knowledge, '{}'::jsonb),
    COALESCE(src.ai_processing_type, a.ai_processing_type),
    COALESCE(src.ai_prompt_override, a.ai_prompt_override),
    COALESCE(src.group_ai_mode::text, a.group_ai_mode::text, 'individual'),
    COALESCE(src.is_calculated, false),
    src.formula,
    COALESCE(src.formula_variables, '[]'::jsonb),
    src.formula_description,
    COALESCE(src.value_type::text, a.value_type::text, 'numeric'),
    COALESCE(src.expected_normal_values, a.expected_normal_values, '[]'::jsonb),
    COALESCE(src.expected_value_flag_map, a.expected_value_flag_map, '{}'::jsonb),
    COALESCE(src.code, a.code)
  FROM public.lab_analytes src
  JOIN public.analytes a
    ON a.id = src.analyte_id
  WHERE src.lab_id = source_lab_id
    AND COALESCE(src.is_calculated, false) = true
    AND src.formula IS NOT NULL
    AND btrim(src.formula) <> ''
  ON CONFLICT (lab_id, analyte_id) DO NOTHING;

  GET DIAGNOSTICS v_inserted_calculated = ROW_COUNT;

  -- 2. Force formulas in target lab to match source lab.
  UPDATE public.lab_analytes tgt
  SET
    is_calculated = src.is_calculated,
    formula = src.formula,
    formula_variables = COALESCE(src.formula_variables, '[]'::jsonb),
    formula_description = src.formula_description,
    updated_at = now()
  FROM public.lab_analytes src
  WHERE src.lab_id = source_lab_id
    AND tgt.lab_id = target_lab_id
    AND tgt.analyte_id = src.analyte_id
    AND COALESCE(src.is_calculated, false) = true
    AND src.formula IS NOT NULL
    AND btrim(src.formula) <> '';

  GET DIAGNOSTICS v_updated_calculated = ROW_COUNT;

  -- 3. Ensure dependency source analytes exist in target lab.
  INSERT INTO public.lab_analytes (
    lab_id,
    analyte_id,
    is_active,
    visible,
    name,
    unit,
    category,
    reference_range,
    low_critical,
    high_critical,
    interpretation_low,
    interpretation_normal,
    interpretation_high,
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
    code
  )
  SELECT DISTINCT
    target_lab_id,
    dep.source_analyte_id,
    true,
    true,
    a.name,
    a.unit,
    a.category,
    a.reference_range,
    a.low_critical,
    a.high_critical,
    a.interpretation_low,
    a.interpretation_normal,
    a.interpretation_high,
    a.description,
    COALESCE(a.ref_range_knowledge, '{}'::jsonb),
    a.ai_processing_type,
    a.ai_prompt_override,
    COALESCE(a.group_ai_mode::text, 'individual'),
    COALESCE(a.is_calculated, false),
    a.formula,
    COALESCE(a.formula_variables, '[]'::jsonb),
    a.formula_description,
    COALESCE(a.value_type::text, 'numeric'),
    COALESCE(a.expected_normal_values, '[]'::jsonb),
    COALESCE(a.expected_value_flag_map, '{}'::jsonb),
    a.code
  FROM public.analyte_dependencies dep
  JOIN public.lab_analytes src_calc
    ON src_calc.lab_id = source_lab_id
   AND src_calc.analyte_id = dep.calculated_analyte_id
  JOIN public.analytes a
    ON a.id = dep.source_analyte_id
  WHERE dep.lab_id = source_lab_id
  ON CONFLICT (lab_id, analyte_id) DO NOTHING;

  GET DIAGNOSTICS v_inserted_source_analytes = ROW_COUNT;

  -- 4. Replace target lab dependency rows with source lab dependency rows.
  DELETE FROM public.analyte_dependencies
  WHERE lab_id = target_lab_id
    AND calculated_analyte_id IN (
      SELECT analyte_id
      FROM public.lab_analytes
      WHERE lab_id = source_lab_id
        AND COALESCE(is_calculated, false) = true
        AND formula IS NOT NULL
        AND btrim(formula) <> ''
    );

  GET DIAGNOSTICS v_deleted_deps = ROW_COUNT;

  INSERT INTO public.analyte_dependencies (
    calculated_analyte_id,
    source_analyte_id,
    variable_name,
    lab_id
  )
  SELECT DISTINCT
    dep.calculated_analyte_id,
    dep.source_analyte_id,
    dep.variable_name,
    target_lab_id
  FROM public.analyte_dependencies dep
  JOIN public.lab_analytes src_calc
    ON src_calc.lab_id = source_lab_id
   AND src_calc.analyte_id = dep.calculated_analyte_id
  WHERE dep.lab_id = source_lab_id;

  GET DIAGNOSTICS v_inserted_deps = ROW_COUNT;

  -- 5. Backfill lab_analyte_id links in target lab.
  UPDATE public.test_group_analytes tga
  SET lab_analyte_id = la.id
  FROM public.lab_analytes la,
       public.test_groups tg
  WHERE tg.id = tga.test_group_id
    AND tg.lab_id = target_lab_id
    AND la.lab_id = target_lab_id
    AND la.analyte_id = tga.analyte_id
    AND (tga.lab_analyte_id IS NULL OR tga.lab_analyte_id <> la.id);

  GET DIAGNOSTICS v_backfilled_group_links = ROW_COUNT;

  RETURN jsonb_build_object(
    'source_lab_id', source_lab_id,
    'target_lab_id', target_lab_id,
    'inserted_calculated_lab_analytes', v_inserted_calculated,
    'updated_calculated_lab_analytes', v_updated_calculated,
    'inserted_source_lab_analytes', v_inserted_source_analytes,
    'deleted_target_dependencies', v_deleted_deps,
    'inserted_target_dependencies', v_inserted_deps,
    'backfilled_group_links', v_backfilled_group_links
  );
END;
$function$;

COMMENT ON FUNCTION public.copy_calculated_params_between_labs(uuid, uuid) IS
'Copies calculated-analyte formulas and analyte_dependencies from one lab to another, preserving the source lab as the formula/dependency source of truth for the target lab.';
