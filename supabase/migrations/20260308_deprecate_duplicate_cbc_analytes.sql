-- ============================================================
-- MIGRATION: Deprecate duplicate CBC analytes for new labs
-- Date: 2026-03-08
-- ============================================================
-- Sets is_global = FALSE and to_be_copied = FALSE on all OLD
-- duplicate CBC analytes so they are NOT auto-assigned to new labs.
--
-- SAFE: Existing lab_analytes, result_values, and test_group_analytes
-- records remain untouched. Old analytes stay active (is_active = TRUE)
-- so existing results continue to work. Only new lab onboarding is affected.
--
-- The 20 canonical analytes (a1cbc000-... UUIDs) are NOT touched.
-- ============================================================

BEGIN;

UPDATE public.analytes
SET
  is_global    = false,
  to_be_copied = false,
  updated_at   = now()
WHERE
  -- Exclude our new canonical analytes
  id::text NOT LIKE 'a1cbc000%'
  -- Target only old CBC-related analytes by the codes they used
  AND code IN (
    'HB', 'HGB', 'HAEMOG',        -- Hemoglobin variants
    'HCT', 'HEMATOCRIT',           -- Hematocrit variants
    'WBC', 'WBC_COUNT', 'LEUKOCYTES', -- WBC variants
    'RBC', 'RBC_COUNT',            -- RBC variants
    'PLT',                          -- Platelet variants
    'MCH', 'MEAN_CORPUSCULAR_HEMOGLOBIN', -- MCH variants
    'MCHC', 'MEAN_CORPUSCULAR_HEMOGLOBIN_CONCENTRATION', -- MCHC variants
    'MCV', 'MEAN_CORPUSCULAR_VOLUME', -- MCV variants
    'RDW',                          -- RDW variants
    'NEUT',                         -- Neutrophils (old dual-use code)
    'LYMPH', 'LYMPHOCYTE_ABSOLUTE', 'LYMPHOCYTE_PERCENTAGE', 'LYMPHOCYTE_ABSOLUTE_COUNT', -- Lymphocytes
    'MONO',                         -- Monocytes (old dual-use code)
    'EOS', 'EOSINOPHILS',           -- Eosinophils (old dual-use code)
    'BASO', 'BASOPHILS',            -- Basophils (old dual-use code)
    'ERYTHR'                        -- ESR (old code)
  );

-- Verification
SELECT
  code,
  COUNT(*) FILTER (WHERE is_global = false AND to_be_copied = false) AS deprecated,
  COUNT(*) FILTER (WHERE is_global = true) AS still_global,
  COUNT(*) AS total
FROM public.analytes
WHERE code IN (
  'HB','HGB','HAEMOG','HCT','HEMATOCRIT','WBC','WBC_COUNT','LEUKOCYTES',
  'RBC','RBC_COUNT','PLT','MCH','MEAN_CORPUSCULAR_HEMOGLOBIN',
  'MCHC','MEAN_CORPUSCULAR_HEMOGLOBIN_CONCENTRATION','MCV','MEAN_CORPUSCULAR_VOLUME',
  'RDW','NEUT','LYMPH','LYMPHOCYTE_ABSOLUTE','LYMPHOCYTE_PERCENTAGE',
  'LYMPHOCYTE_ABSOLUTE_COUNT','MONO','EOS','EOSINOPHILS','BASO','BASOPHILS','ERYTHR'
)
  AND id::text NOT LIKE 'a1cbc000%'
GROUP BY code
ORDER BY code;

COMMIT;
