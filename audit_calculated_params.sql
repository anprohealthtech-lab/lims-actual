-- =============================================================================
-- AUDIT: Global Calculated Parameters — Formula & Dependency Correctness
-- =============================================================================
-- Run this to see ALL calculated analytes, their formulas, and linked dependencies.
-- Look for:
--   1. Wrong source analyte names (e.g., "Albumin, Urine" instead of "Albumin")
--   2. Missing dependencies (formula has variables not mapped)
--   3. Orphan dependencies (mapped variables not in formula)
--   4. Chain dependencies (source is also calculated — needs ordering)
-- =============================================================================

-- QUERY 1: Full audit of all global calculated analytes + their dependencies
SELECT
  a.id AS calculated_analyte_id,
  a.name AS calculated_name,
  a.formula,
  a.formula_variables,
  a.formula_description,
  ad.variable_name,
  ad.source_analyte_id,
  a_src.name AS source_analyte_name,
  a_src.unit AS source_unit,
  a_src.is_calculated AS source_is_also_calculated,
  a_src.formula AS source_formula,
  CASE
    WHEN ad.id IS NULL THEN '❌ MISSING DEPENDENCY ROW'
    WHEN a_src.id IS NULL THEN '❌ SOURCE ANALYTE NOT FOUND'
    ELSE '✅ OK'
  END AS dependency_status
FROM public.analytes a
LEFT JOIN public.analyte_dependencies ad
  ON ad.calculated_analyte_id = a.id AND ad.lab_id IS NULL
LEFT JOIN public.analytes a_src
  ON a_src.id = ad.source_analyte_id
WHERE a.is_calculated = true
ORDER BY a.name, ad.variable_name;


-- QUERY 2: Find calculated analytes with MISSING dependencies
-- (formula_variables has entries but no matching analyte_dependencies row)
SELECT
  a.id,
  a.name,
  a.formula,
  a.formula_variables,
  var.value AS missing_variable,
  '❌ No dependency row for this variable' AS issue
FROM public.analytes a
CROSS JOIN LATERAL jsonb_array_elements_text(a.formula_variables) AS var(value)
WHERE a.is_calculated = true
  AND NOT EXISTS (
    SELECT 1
    FROM public.analyte_dependencies ad
    WHERE ad.calculated_analyte_id = a.id
      AND ad.lab_id IS NULL
      AND ad.variable_name = var.value
  )
ORDER BY a.name, var.value;


-- QUERY 3: Find dependencies pointing to WRONG analytes
-- (common issue: "Albumin, Urine" instead of "Albumin" in LFT context)
-- Shows all source analytes per variable so you can spot mismatches
SELECT
  a.name AS calculated_name,
  ad.variable_name,
  a_src.name AS current_source,
  a_src.unit AS source_unit,
  a_src.category AS source_category,
  ad.source_analyte_id,
  -- Show potential better matches
  (
    SELECT string_agg(alt.name || ' (' || alt.unit || ', ' || COALESCE(alt.category, '?') || ') [' || alt.id || ']', E'\n')
    FROM public.analytes alt
    WHERE alt.id != a_src.id
      AND (
        alt.name ILIKE '%' || ad.variable_name || '%'
        OR UPPER(alt.code) = UPPER(ad.variable_name)
      )
      AND alt.is_active = true
    LIMIT 5
  ) AS alternative_matches
FROM public.analyte_dependencies ad
JOIN public.analytes a ON a.id = ad.calculated_analyte_id
JOIN public.analytes a_src ON a_src.id = ad.source_analyte_id
WHERE ad.lab_id IS NULL
  AND a.is_calculated = true
ORDER BY a.name, ad.variable_name;


-- QUERY 4: Chain analysis — calculated params that depend on OTHER calculated params
-- These need proper execution order
SELECT
  a.name AS calculated_name,
  a.formula,
  ad.variable_name,
  a_src.name AS source_name,
  a_src.formula AS source_formula,
  '⚠️ SOURCE IS ALSO CALCULATED — needs chain ordering' AS note
FROM public.analyte_dependencies ad
JOIN public.analytes a ON a.id = ad.calculated_analyte_id
JOIN public.analytes a_src ON a_src.id = ad.source_analyte_id
WHERE ad.lab_id IS NULL
  AND a.is_calculated = true
  AND a_src.is_calculated = true
ORDER BY a.name;


-- QUERY 5: Lab-specific audit (set your lab_id)
-- Shows what the lab currently has vs what global has
/*
SELECT
  a.name AS calculated_name,
  a.formula AS global_formula,
  la.formula AS lab_formula,
  la.is_calculated AS lab_is_calculated,
  la.formula_variables AS lab_formula_vars,
  ad_global.variable_name AS global_dep_var,
  a_src_g.name AS global_source,
  ad_lab.variable_name AS lab_dep_var,
  a_src_l.name AS lab_source,
  CASE
    WHEN ad_lab.id IS NULL AND ad_global.id IS NOT NULL THEN '❌ LAB MISSING THIS DEP'
    WHEN a_src_g.id != a_src_l.id THEN '⚠️ DIFFERENT SOURCE'
    ELSE '✅ OK'
  END AS status
FROM public.analytes a
JOIN public.lab_analytes la ON la.analyte_id = a.id AND la.lab_id = 'YOUR_LAB_ID'
LEFT JOIN public.analyte_dependencies ad_global
  ON ad_global.calculated_analyte_id = a.id AND ad_global.lab_id IS NULL
LEFT JOIN public.analytes a_src_g ON a_src_g.id = ad_global.source_analyte_id
LEFT JOIN public.analyte_dependencies ad_lab
  ON ad_lab.calculated_analyte_id = a.id AND ad_lab.lab_id = 'YOUR_LAB_ID'
  AND ad_lab.variable_name = ad_global.variable_name
LEFT JOIN public.analytes a_src_l ON a_src_l.id = ad_lab.source_analyte_id
WHERE a.is_calculated = true
ORDER BY a.name, ad_global.variable_name;
*/
