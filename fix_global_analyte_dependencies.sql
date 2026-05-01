-- =============================================================================
-- FIX: Global analyte_dependencies — Wrong sources, Missing rows, Circular refs
-- =============================================================================
-- Generated from audit_calculated_params.sql Query 1 results.
-- Run this ONCE on production. All changes target lab_id IS NULL (global rows).
-- =============================================================================

BEGIN;

-- =============================================
-- 1. FIX WRONG SOURCE ANALYTES
-- =============================================

-- 1a. A/G Ratio (dcd42086): ALB → Albumin, Urine → should be Albumin (serum, g/dL)
UPDATE public.analyte_dependencies
SET source_analyte_id = '6217b735-713b-47fa-b360-b10a3fe9cb06'  -- Albumin (g/dL)
WHERE calculated_analyte_id = 'dcd42086-269f-4e3a-bbd3-8d8d543d4ec6'
  AND variable_name = 'ALB'
  AND source_analyte_id = '03c0772d-6528-4995-9f9a-afc6527a5d31'  -- Albumin, Urine
  AND lab_id IS NULL;

-- 1b. A/G Ratio (dcd42086): GLOB → IgE Total → should be Globulin (calculated)
UPDATE public.analyte_dependencies
SET source_analyte_id = '7aba69a7-e72c-4297-a1f9-03afb025878a'  -- Globulin (TP - ALB)
WHERE calculated_analyte_id = 'dcd42086-269f-4e3a-bbd3-8d8d543d4ec6'
  AND variable_name = 'GLOB'
  AND source_analyte_id = '3abfd761-791b-44bd-9441-1dd902b79836'  -- IgE Total
  AND lab_id IS NULL;

-- 1c. Albumin/Globulin Ratio (316af87e): GLOB → IgE Total → should be Globulin (calculated)
UPDATE public.analyte_dependencies
SET source_analyte_id = '7aba69a7-e72c-4297-a1f9-03afb025878a'  -- Globulin (TP - ALB)
WHERE calculated_analyte_id = '316af87e-28b1-49b8-86d2-7186c0b9153d'
  AND variable_name = 'GLOB'
  AND source_analyte_id = '3abfd761-791b-44bd-9441-1dd902b79836'  -- IgE Total
  AND lab_id IS NULL;


-- =============================================
-- 2. DELETE WRONG/CIRCULAR DEPENDENCY ROWS
-- =============================================

-- 2a. eGFR (eccf3ed7): Remove CREAT → Creatinine, Urine (wrong specimen type)
DELETE FROM public.analyte_dependencies
WHERE calculated_analyte_id = 'eccf3ed7-b615-4d8b-b050-d2c8a1d36baa'
  AND variable_name = 'CREAT'
  AND source_analyte_id = 'ff13b96d-749b-4c0b-83b5-86795fb0cf25'  -- Creatinine, Urine
  AND lab_id IS NULL;

-- 2b. eGFR (eccf3ed7): Remove CREAT → uACR (completely wrong analyte)
DELETE FROM public.analyte_dependencies
WHERE calculated_analyte_id = 'eccf3ed7-b615-4d8b-b050-d2c8a1d36baa'
  AND variable_name = 'CREAT'
  AND source_analyte_id = 'e06a45f2-7766-453a-ac0c-58926399ff07'  -- uACR
  AND lab_id IS NULL;

-- 2c. LDL Cholesterol (8243b56b): Remove HDL → TC/HDL Ratio (that's a calculated ratio, not HDL)
DELETE FROM public.analyte_dependencies
WHERE calculated_analyte_id = '8243b56b-001d-4f70-aa84-3b8104e96cc0'
  AND variable_name = 'HDL'
  AND source_analyte_id = 'bb51f4de-f951-48e0-aec3-2490b3a899c1'  -- TC/HDL Ratio
  AND lab_id IS NULL;

-- 2d. MCH (1d1ea395): Remove HGB → MCH itself (CIRCULAR reference!)
DELETE FROM public.analyte_dependencies
WHERE calculated_analyte_id = '1d1ea395-33bf-4d88-bb11-e79dac4f9c38'
  AND variable_name = 'HGB'
  AND source_analyte_id = 'c9821e72-9091-4ebb-9c87-b8f9995e71eb'  -- MCH (self-ref)
  AND lab_id IS NULL;

-- 2e. MCH (1d1ea395): Remove RBC → Red Blood Cells /HPF (urine microscopy, not CBC RBC)
DELETE FROM public.analyte_dependencies
WHERE calculated_analyte_id = '1d1ea395-33bf-4d88-bb11-e79dac4f9c38'
  AND variable_name = 'RBC'
  AND source_analyte_id = '97ee10de-a6fc-41a7-87e6-283825133957'  -- Red Blood Cells /HPF
  AND lab_id IS NULL;

-- 2f. MCV (ef9c4414): Remove RBC → Red Blood Cells /HPF (urine microscopy)
DELETE FROM public.analyte_dependencies
WHERE calculated_analyte_id = 'ef9c4414-540b-4102-9d08-12d3b26e74d8'
  AND variable_name = 'RBC'
  AND source_analyte_id = '97ee10de-a6fc-41a7-87e6-283825133957'  -- Red Blood Cells /HPF
  AND lab_id IS NULL;


-- =============================================
-- 3. ADD MISSING DEPENDENCY ROWS
-- =============================================

-- 3a. BUN (3cb76acd): Missing UREA dependency
INSERT INTO public.analyte_dependencies (calculated_analyte_id, source_analyte_id, variable_name, lab_id)
VALUES ('3cb76acd-c18a-4871-9386-ffb1711ec4aa', '73a95ac0-d644-4bd2-b688-ee0b4d486191', 'UREA', NULL)
ON CONFLICT DO NOTHING;

-- 3b. BUN (40fcfe2f): Missing UREA dependency
INSERT INTO public.analyte_dependencies (calculated_analyte_id, source_analyte_id, variable_name, lab_id)
VALUES ('40fcfe2f-84b5-477e-8ba2-1a9bb72161d4', '73a95ac0-d644-4bd2-b688-ee0b4d486191', 'UREA', NULL)
ON CONFLICT DO NOTHING;

-- 3c. eGFR (aeb43300): Missing all dependencies — uses CREAT1, AGE, GENDER_MALE
--     Map CREAT1 → Serum Creatinine (d237a138)
INSERT INTO public.analyte_dependencies (calculated_analyte_id, source_analyte_id, variable_name, lab_id)
VALUES ('aeb43300-3b2e-4970-821c-69b908f34fae', 'd237a138-075f-40f7-8323-e73160d9b59a', 'CREAT1', NULL)
ON CONFLICT DO NOTHING;
-- Note: AGE and GENDER_MALE are patient context variables injected at runtime, not analyte deps

-- 3d. MCH (97e3c13b): Missing HGB and RBC dependencies
INSERT INTO public.analyte_dependencies (calculated_analyte_id, source_analyte_id, variable_name, lab_id)
VALUES
  ('97e3c13b-d1b9-4b51-9986-2e37a45bf5db', 'a1cbc000-0000-0000-0000-000000000001', 'HGB', NULL),  -- Hemoglobin
  ('97e3c13b-d1b9-4b51-9986-2e37a45bf5db', 'a1cbc000-0000-0000-0000-000000000005', 'RBC', NULL)   -- Red Blood Cell Count
ON CONFLICT DO NOTHING;

-- 3e. VLDL cholesterol (4dc3221e): Missing TG dependency
INSERT INTO public.analyte_dependencies (calculated_analyte_id, source_analyte_id, variable_name, lab_id)
VALUES ('4dc3221e-e59e-410b-8609-67404f24d41b', '5f607ce4-28ad-437e-ad27-9bf376e851e1', 'TG', NULL)
ON CONFLICT DO NOTHING;

-- 3f. BUN/Creatinine Ratio (e11bb032): Missing BUN dependency (chain — BUN is calculated)
INSERT INTO public.analyte_dependencies (calculated_analyte_id, source_analyte_id, variable_name, lab_id)
VALUES
  ('e11bb032-cdb8-4005-96b9-fabaf890de10', '14eea9ca-5ab7-45d2-bf9d-437aa491a538', 'BUN', NULL),  -- BUN (UREA/2.14)
  ('e11bb032-cdb8-4005-96b9-fabaf890de10', '478f3329-ac8f-4e65-a681-a81ff2829f4f', 'BUN', NULL),  -- BUN (UREA1*0.467)
  ('e11bb032-cdb8-4005-96b9-fabaf890de10', '1182936b-5073-4171-8166-f6afd96751d8', 'BUN', NULL)   -- BUN (UREA/2.14)
ON CONFLICT DO NOTHING;


-- =============================================
-- 4. FIX BROKEN formula_variables AND formulas
-- =============================================
-- The sync triggers have a type mismatch bug on low_critical/high_critical.
-- We only update formula + formula_variables here, so sync is not needed.
ALTER TABLE public.analytes DISABLE TRIGGER trigger_sync_analyte_updates;
ALTER TABLE public.analytes DISABLE TRIGGER trigger_sync_lab_analyte_on_analyte_update;

-- 4a. eGFR (aeb43300): formula_variables has ["AGE","GENDER_MALE","CREAT","CREAT","CREAT","CREAT1"]
--     but formula only uses CREAT1, AGE, GENDER_MALE.
--     Also formula has trailing junk "...^AGE))CREAT1" — remove it.
UPDATE public.analytes
SET formula_variables = '["CREAT1", "AGE", "GENDER_MALE"]'::jsonb,
    formula = 'GENDER_MALE ? (142 * (CREAT1 <= 0.9 ? (CREAT1 / 0.9)^(-0.302) : (CREAT1 / 0.9)^(-1.2)) * (0.9938^AGE)) : (142 * 1.012 * (CREAT1 <= 0.7 ? (CREAT1 / 0.7)^(-0.241) : (CREAT1 / 0.7)^(-1.2)) * (0.9938^AGE))'
WHERE id = 'aeb43300-3b2e-4970-821c-69b908f34fae';

-- 4b. MCV (ef9c4414): formula_variables has ["HCT","RBC","RBC1"] but formula is "(HCT / RBC1) * 10"
--     Remove stale "RBC" entry.
UPDATE public.analytes
SET formula_variables = '["HCT", "RBC1"]'::jsonb
WHERE id = 'ef9c4414-540b-4102-9d08-12d3b26e74d8';

-- 4c. BUN/Creatinine (e11bb032): formula_variables has ["BUN","CREAT1","CREAT1"] — deduplicate
UPDATE public.analytes
SET formula_variables = '["BUN", "CREAT1"]'::jsonb
WHERE id = 'e11bb032-cdb8-4005-96b9-fabaf890de10';

-- Re-enable triggers
ALTER TABLE public.analytes ENABLE TRIGGER trigger_sync_analyte_updates;
ALTER TABLE public.analytes ENABLE TRIGGER trigger_sync_lab_analyte_on_analyte_update;

COMMIT;


-- =============================================
-- 5. CBC DIFFERENTIAL — ABS COUNT FORMULAS & DEPS
-- =============================================
-- All 5 differential Abs analytes use the same pattern:
--   ABS = TLC * DIFF_PCT / 100
-- Global CBC IDs (canonical a1cbc000-... series):
--   TLC         a1cbc000-0000-0000-0000-000000000002  Total Leukocyte Count
--   NEUT_PCT    a1cbc000-0000-0000-0000-000000000010  Neutrophils (%)
--   NEUT_ABS    a1cbc000-0000-0000-0000-000000000011  Neutrophils (Abs)
--   LYMPH_PCT   a1cbc000-0000-0000-0000-000000000012  Lymphocytes (%)
--   LYMPH_ABS   a1cbc000-0000-0000-0000-000000000013  Lymphocytes (Abs)
--   MONO_PCT    a1cbc000-0000-0000-0000-000000000014  Monocytes (%)
--   MONO_ABS    a1cbc000-0000-0000-0000-000000000015  Monocytes (Abs)
--   EOS_PCT     a1cbc000-0000-0000-0000-000000000016  Eosinophils (%)
--   EOS_ABS     a1cbc000-0000-0000-0000-000000000017  Eosinophils (Abs)
--   BASO_PCT    a1cbc000-0000-0000-0000-000000000018  Basophils (%)
--   BASO_ABS    a1cbc000-0000-0000-0000-000000000019  Basophils (Abs)

-- 5a. Set formula + formula_variables on the global analytes (without firing sync triggers)
ALTER TABLE public.analytes DISABLE TRIGGER trigger_sync_analyte_updates;
ALTER TABLE public.analytes DISABLE TRIGGER trigger_sync_lab_analyte_on_analyte_update;

UPDATE public.analytes SET
  is_calculated    = true,
  formula          = 'TLC * NEUT_PCT / 100',
  formula_variables = '["TLC", "NEUT_PCT"]'::jsonb
WHERE id = 'a1cbc000-0000-0000-0000-000000000011';  -- Neutrophils (Abs)

UPDATE public.analytes SET
  is_calculated    = true,
  formula          = 'TLC * LYMPH_PCT / 100',
  formula_variables = '["TLC", "LYMPH_PCT"]'::jsonb
WHERE id = 'a1cbc000-0000-0000-0000-000000000013';  -- Lymphocytes (Abs)

UPDATE public.analytes SET
  is_calculated    = true,
  formula          = 'TLC * MONO_PCT / 100',
  formula_variables = '["TLC", "MONO_PCT"]'::jsonb
WHERE id = 'a1cbc000-0000-0000-0000-000000000015';  -- Monocytes (Abs)

UPDATE public.analytes SET
  is_calculated    = true,
  formula          = 'TLC * EOS_PCT / 100',
  formula_variables = '["TLC", "EOS_PCT"]'::jsonb
WHERE id = 'a1cbc000-0000-0000-0000-000000000017';  -- Eosinophils (Abs)

UPDATE public.analytes SET
  is_calculated    = true,
  formula          = 'TLC * BASO_PCT / 100',
  formula_variables = '["TLC", "BASO_PCT"]'::jsonb
WHERE id = 'a1cbc000-0000-0000-0000-000000000019';  -- Basophils (Abs)

ALTER TABLE public.analytes ENABLE TRIGGER trigger_sync_analyte_updates;
ALTER TABLE public.analytes ENABLE TRIGGER trigger_sync_lab_analyte_on_analyte_update;

-- 5b. Clear ALL existing global deps for the 5 Abs analytes
--     (removes stale/wrong/duplicate rows that pointed to non-CBC analytes)
DELETE FROM public.analyte_dependencies
WHERE lab_id IS NULL
  AND calculated_analyte_id IN (
    'a1cbc000-0000-0000-0000-000000000011',  -- Neutrophils (Abs)
    'a1cbc000-0000-0000-0000-000000000013',  -- Lymphocytes (Abs)
    'a1cbc000-0000-0000-0000-000000000015',  -- Monocytes (Abs)
    'a1cbc000-0000-0000-0000-000000000017',  -- Eosinophils (Abs)
    'a1cbc000-0000-0000-0000-000000000019'   -- Basophils (Abs)
  );

-- 5c. Insert correct global deps — TLC + matching % analyte for each Abs analyte
INSERT INTO public.analyte_dependencies (calculated_analyte_id, source_analyte_id, variable_name, lab_id) VALUES
  -- Neutrophils (Abs) = TLC * NEUT_PCT / 100
  ('a1cbc000-0000-0000-0000-000000000011', 'a1cbc000-0000-0000-0000-000000000002', 'TLC',      NULL),
  ('a1cbc000-0000-0000-0000-000000000011', 'a1cbc000-0000-0000-0000-000000000010', 'NEUT_PCT', NULL),
  -- Lymphocytes (Abs) = TLC * LYMPH_PCT / 100
  ('a1cbc000-0000-0000-0000-000000000013', 'a1cbc000-0000-0000-0000-000000000002', 'TLC',       NULL),
  ('a1cbc000-0000-0000-0000-000000000013', 'a1cbc000-0000-0000-0000-000000000012', 'LYMPH_PCT', NULL),
  -- Monocytes (Abs) = TLC * MONO_PCT / 100
  ('a1cbc000-0000-0000-0000-000000000015', 'a1cbc000-0000-0000-0000-000000000002', 'TLC',      NULL),
  ('a1cbc000-0000-0000-0000-000000000015', 'a1cbc000-0000-0000-0000-000000000014', 'MONO_PCT', NULL),
  -- Eosinophils (Abs) = TLC * EOS_PCT / 100
  ('a1cbc000-0000-0000-0000-000000000017', 'a1cbc000-0000-0000-0000-000000000002', 'TLC',     NULL),
  ('a1cbc000-0000-0000-0000-000000000017', 'a1cbc000-0000-0000-0000-000000000016', 'EOS_PCT', NULL),
  -- Basophils (Abs) = TLC * BASO_PCT / 100
  ('a1cbc000-0000-0000-0000-000000000019', 'a1cbc000-0000-0000-0000-000000000002', 'TLC',      NULL),
  ('a1cbc000-0000-0000-0000-000000000019', 'a1cbc000-0000-0000-0000-000000000018', 'BASO_PCT', NULL)
ON CONFLICT DO NOTHING;

-- 5d. Sync formula down to all existing lab_analytes for these 5 Abs analytes
--     (updates any lab that already had stale formula/formula_variables)
UPDATE public.lab_analytes la
SET
  is_calculated     = true,
  formula           = a.formula,
  formula_variables = a.formula_variables
FROM public.analytes a
WHERE la.analyte_id = a.id
  AND a.id IN (
    'a1cbc000-0000-0000-0000-000000000011',
    'a1cbc000-0000-0000-0000-000000000013',
    'a1cbc000-0000-0000-0000-000000000015',
    'a1cbc000-0000-0000-0000-000000000017',
    'a1cbc000-0000-0000-0000-000000000019'
  );

-- 5e. Clone corrected global deps to all lab-scoped rows
--     (replaces stale lab-level deps cloned from the old wrong globals)
DELETE FROM public.analyte_dependencies
WHERE lab_id IS NOT NULL
  AND calculated_analyte_id IN (
    'a1cbc000-0000-0000-0000-000000000011',
    'a1cbc000-0000-0000-0000-000000000013',
    'a1cbc000-0000-0000-0000-000000000015',
    'a1cbc000-0000-0000-0000-000000000017',
    'a1cbc000-0000-0000-0000-000000000019'
  );

INSERT INTO public.analyte_dependencies (calculated_analyte_id, source_analyte_id, variable_name, lab_id)
SELECT ad.calculated_analyte_id, ad.source_analyte_id, ad.variable_name, la_calc.lab_id
FROM public.analyte_dependencies ad
JOIN public.lab_analytes la_calc ON la_calc.analyte_id = ad.calculated_analyte_id
JOIN public.lab_analytes la_src
  ON la_src.analyte_id = ad.source_analyte_id
  AND la_src.lab_id = la_calc.lab_id
WHERE ad.lab_id IS NULL
  AND ad.calculated_analyte_id IN (
    'a1cbc000-0000-0000-0000-000000000011',
    'a1cbc000-0000-0000-0000-000000000013',
    'a1cbc000-0000-0000-0000-000000000015',
    'a1cbc000-0000-0000-0000-000000000017',
    'a1cbc000-0000-0000-0000-000000000019'
  )
ON CONFLICT DO NOTHING;

-- =============================================
-- VERIFICATION: Re-run after fix to confirm
-- =============================================

-- Check the fixed A/G Ratio + Albumin/Globulin Ratio
SELECT a.name, ad.variable_name, a_src.name AS source_name, a_src.unit
FROM analyte_dependencies ad
JOIN analytes a ON a.id = ad.calculated_analyte_id
JOIN analytes a_src ON a_src.id = ad.source_analyte_id
WHERE ad.calculated_analyte_id IN (
  'dcd42086-269f-4e3a-bbd3-8d8d543d4ec6',
  '316af87e-28b1-49b8-86d2-7186c0b9153d'
)
AND ad.lab_id IS NULL
ORDER BY a.name, ad.variable_name;

-- Check no more missing dependencies
SELECT a.name, a.formula, var.value AS variable
FROM analytes a
CROSS JOIN LATERAL jsonb_array_elements_text(a.formula_variables) AS var(value)
WHERE a.is_calculated = true
  AND NOT EXISTS (
    SELECT 1 FROM analyte_dependencies ad
    WHERE ad.calculated_analyte_id = a.id
      AND ad.lab_id IS NULL
      AND ad.variable_name = var.value
  )
  AND var.value NOT IN ('AGE', 'GENDER_MALE')  -- context vars, not analyte deps
ORDER BY a.name;
