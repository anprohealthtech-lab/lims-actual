-- Migration: Hydrate lab_analytes fully in global sync RPCs
-- Date: 2026-04-17
-- Problem:
--   Older helper RPCs add_global_analytes_to_lab / sync_global_analytes_to_all_labs
--   were creating bare lab_analytes rows with only a few fields populated.
--   That causes lab_analytes to disagree with analytes on calculated parameters,
--   AI settings, ranges, and other defaults.
--
-- Rule after this migration:
--   1. New rows created by these RPCs are fully hydrated from analytes.
--   2. Lab-specific override columns remain blank unless explicitly customized.
--   3. Existing lab_analytes rows are not overwritten by these helper RPCs.

CREATE OR REPLACE FUNCTION public.add_global_analytes_to_lab(target_lab_id UUID)
RETURNS TABLE(added_count INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
    analyte_count INTEGER := 0;
BEGIN
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
        display_name,
        default_value,
        lab_specific_reference_range,
        lab_specific_interpretation_low,
        lab_specific_interpretation_normal,
        lab_specific_interpretation_high
    )
    SELECT
        target_lab_id,
        a.id,
        TRUE,
        TRUE,
        a.name,
        a.unit,
        a.category,
        a.reference_range,
        a.low_critical,
        a.high_critical,
        a.interpretation_low,
        a.interpretation_normal,
        a.interpretation_high,
        a.method,
        a.description,
        a.ref_range_knowledge,
        a.ai_processing_type,
        a.ai_prompt_override,
        COALESCE(a.group_ai_mode, 'individual'),
        COALESCE(a.is_calculated, false),
        a.formula,
        COALESCE(a.formula_variables, '[]'::jsonb),
        a.formula_description,
        COALESCE(a.value_type, 'numeric'),
        COALESCE(a.expected_normal_values, '[]'::jsonb),
        COALESCE(a.expected_value_flag_map, '{}'::jsonb),
        a.code,
        a.is_critical,
        a.normal_range_min,
        a.normal_range_max,
        NULL,
        NULL,
        a.reference_range,
        a.interpretation_low,
        a.interpretation_normal,
        a.interpretation_high
    FROM public.analytes a
    WHERE
        a.is_global = TRUE
        AND a.is_active = TRUE
        AND NOT EXISTS (
            SELECT 1
            FROM public.lab_analytes la
            WHERE la.lab_id = target_lab_id
              AND la.analyte_id = a.id
        );

    GET DIAGNOSTICS analyte_count = ROW_COUNT;

    RETURN QUERY SELECT analyte_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_global_analytes_to_all_labs()
RETURNS TABLE(lab_id UUID, added_count INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
    lab_record RECORD;
    analyte_count INTEGER;
BEGIN
    FOR lab_record IN
        SELECT id FROM public.labs WHERE is_active = TRUE
    LOOP
        SELECT * INTO analyte_count
        FROM public.add_global_analytes_to_lab(lab_record.id);

        RETURN QUERY SELECT lab_record.id, analyte_count;
    END LOOP;
END;
$function$;

COMMENT ON FUNCTION public.add_global_analytes_to_lab(UUID) IS
'Adds missing global analytes to one lab by creating fully hydrated lab_analytes rows copied from analytes.';

COMMENT ON FUNCTION public.sync_global_analytes_to_all_labs() IS
'Adds missing global analytes to every active lab using fully hydrated lab_analytes rows.';
