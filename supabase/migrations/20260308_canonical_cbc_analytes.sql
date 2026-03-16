-- ============================================================
-- MIGRATION: Canonical CBC Analytes — 3-Part & 5-Part
-- Date: 2026-03-08
-- ============================================================
-- Problem: The analytes table has 50+ duplicate CBC analytes
--   (10+ Hemoglobin entries, BASO used for both % and absolute, etc.)
--   The existing global_test_catalog CBC entries reference random
--   lab-specific analyte IDs with inconsistent units/ranges.
--
-- Solution:
--   1. Insert 20 clean canonical analytes (fixed UUIDs for idempotency)
--   2. Upsert two global_test_catalog entries:
--        CBC_3PART  — 9 analytes (core only)
--        CBC_5PART  — 20 analytes (core + 5-part diff + ESR)
--   3. Backfill lab_analytes so ALL existing labs get the new analytes
--
-- Auto-link: The existing trg_auto_link_new_test_group trigger will
--   automatically link CBC_3PART / CBC_5PART analytes when labs
--   create new test groups with those codes.
-- ============================================================

BEGIN;

-- ── STEP 1: Insert 20 canonical analytes ─────────────────────
-- Fixed UUID prefix a1cbc000-... ensures idempotent re-runs.
-- Codes use distinct suffixes (_PCT / _ABS) to avoid the existing
-- ambiguity where BASO / NEUT / LYMPH etc. served double duty.

INSERT INTO public.analytes (
  id,
  name,
  code,
  unit,
  category,
  is_active,
  is_global,
  to_be_copied,
  reference_range,
  reference_range_male,
  reference_range_female,
  low_critical,
  high_critical,
  interpretation_normal,
  interpretation_low,
  interpretation_high
) VALUES

-- ── Core CBC (shared by 3-Part and 5-Part) ───────────────────
-- Columns: id, name, code, unit, category, is_active, is_global, to_be_copied,
--          reference_range, reference_range_male, reference_range_female,
--          low_critical, high_critical, interpretation_normal, interpretation_low, interpretation_high

-- 1. Hemoglobin → shortKey "HB" (abbreviations map) → {{Hemoglobin}} / {{ANALYTE_HB_VALUE}}
('a1cbc000-0000-0000-0000-000000000001'::uuid,'Hemoglobin','HGB','g/dL','Hematology',true,true,false,'12.0 - 17.5','13.5 - 17.5','12.0 - 15.5','7.0','20.0','Normal','Low — Risk of Anemia','High — Polycythemia'),

-- 2. Total Leukocyte Count → initials → "TLC" → {{TotalLeukocyteCount}} / {{ANALYTE_TLC_VALUE}}
('a1cbc000-0000-0000-0000-000000000002'::uuid,'Total Leukocyte Count','TLC','/cmm','Hematology',true,true,false,'4000 - 10500','4000 - 10500','4000 - 10500','1500','20000','Normal','Leukopenia','Leukocytosis'),

-- 3. Platelet Count → abbreviations map → "PLT" → {{PlateletCount}} / {{ANALYTE_PLT_VALUE}}
('a1cbc000-0000-0000-0000-000000000003'::uuid,'Platelet Count','PLT','/cmm','Hematology',true,true,false,'150000 - 450000',null,null,'50000','1000000','Normal','Thrombocytopenia','Thrombocytosis'),

-- 4. Hematocrit → abbreviations map → "HCT" → {{Hematocrit}} / {{ANALYTE_HCT_VALUE}}
-- "(Direct)" method note is in the template label only, not the analyte name
('a1cbc000-0000-0000-0000-000000000004'::uuid,'Hematocrit','HCT','%','Hematology',true,true,false,'36 - 52','42 - 52','36 - 46','20','60','Normal','Low','High — Polycythemia'),

-- 5. Red Blood Cell Count → abbreviations map → "RBC" → {{RedBloodCellCount}} / {{ANALYTE_RBC_VALUE}}
('a1cbc000-0000-0000-0000-000000000005'::uuid,'Red Blood Cell Count','RBC','10⁶/µL','Hematology',true,true,false,'4.2 - 5.9','4.5 - 5.9','4.2 - 5.4','2.0','7.0','Normal','Low','High'),

-- 6. MCV → parens extract "MCV" → {{MeanCorpuscularVolumeMCV}} / {{ANALYTE_MCV_VALUE}}
('a1cbc000-0000-0000-0000-000000000006'::uuid,'Mean Corpuscular Volume (MCV)','MCV','fL','Hematology',true,true,false,'78 - 100','78 - 100','78 - 100','60','120','Normal','Microcytic','Macrocytic'),

-- 7. MCH → parens extract "MCH" → {{MeanCorpuscularHemoglobinMCH}} / {{ANALYTE_MCH_VALUE}}
('a1cbc000-0000-0000-0000-000000000007'::uuid,'Mean Corpuscular Hemoglobin (MCH)','MCH','pg','Hematology',true,true,false,'27 - 31',null,null,'20','36','Normal','Hypochromic','Hyperchromic'),

-- 8. MCHC → parens extract "MCHC" → {{MeanCorpuscularHemoglobinConcentrationMCHC}} / {{ANALYTE_MCHC_VALUE}}
('a1cbc000-0000-0000-0000-000000000008'::uuid,'Mean Corpuscular Hemoglobin Concentration (MCHC)','MCHC','g/dL','Hematology',true,true,false,'32 - 36',null,null,'28','38','Normal','Hypochromic','Hyperchromic'),

-- 9. RDW → parens extract "RDW" → {{RedCellDistributionWidthRDW}} / {{ANALYTE_RDW_VALUE}}
('a1cbc000-0000-0000-0000-000000000009'::uuid,'Red Cell Distribution Width (RDW)','RDW_CV','%','Hematology',true,true,false,'11.5 - 14.0',null,null,'10.0','20.0','Normal','Low','High — Anisocytosis'),

-- ── 5-Part Differential (additional 11 analytes) ─────────────

-- 10. Neutrophils % → slug "Neutrophils" → {{Neutrophils}} / {{ANALYTE_NEUTROPHILS_VALUE}}
('a1cbc000-0000-0000-0000-000000000010'::uuid,'Neutrophils (%)','NEUT_PCT','%','Hematology',true,true,false,'50 - 80',null,null,'20','90','Normal','Neutropenia','Neutrophilia'),

-- 11. Neutrophils Abs → slug "NeutrophilsAbs" → {{NeutrophilsAbs}} / {{ANALYTE_NEUTROPHILS_ABS_VALUE}}
('a1cbc000-0000-0000-0000-000000000011'::uuid,'Neutrophils (Abs)','NEUT_ABS','/cmm','Hematology',true,true,false,'1500 - 6600',null,null,'500','20000','Normal','Neutropenia','Neutrophilia'),

-- 12. Lymphocytes % → slug "Lymphocytes" → {{Lymphocytes}} / {{ANALYTE_LYMPHOCYTES_VALUE}}
('a1cbc000-0000-0000-0000-000000000012'::uuid,'Lymphocytes (%)','LYMPH_PCT','%','Hematology',true,true,false,'25 - 50',null,null,'10','70','Normal','Lymphopenia','Lymphocytosis'),

-- 13. Lymphocytes Abs → slug "LymphocytesAbs" → {{LymphocytesAbs}}
('a1cbc000-0000-0000-0000-000000000013'::uuid,'Lymphocytes (Abs)','LYMPH_ABS','/cmm','Hematology',true,true,false,'1500 - 3500',null,null,'500','6000','Normal','Lymphopenia','Lymphocytosis'),

-- 14. Monocytes % → slug "Monocytes" → {{Monocytes}}
('a1cbc000-0000-0000-0000-000000000014'::uuid,'Monocytes (%)','MONO_PCT','%','Hematology',true,true,false,'2 - 10',null,null,'1','20','Normal','Low','Monocytosis'),

-- 15. Monocytes Abs → slug "MonocytesAbs" → {{MonocytesAbs}}
('a1cbc000-0000-0000-0000-000000000015'::uuid,'Monocytes (Abs)','MONO_ABS','/cmm','Hematology',true,true,false,'200 - 1000',null,null,'50','2000','Normal','Low','Monocytosis'),

-- 16. Eosinophils % → slug "Eosinophils" → {{Eosinophils}}
('a1cbc000-0000-0000-0000-000000000016'::uuid,'Eosinophils (%)','EOS_PCT','%','Hematology',true,true,false,'0.0 - 5.0',null,null,'0','20','Normal','Low','Eosinophilia'),

-- 17. Eosinophils Abs → slug "EosinophilsAbs" → {{EosinophilsAbs}}
('a1cbc000-0000-0000-0000-000000000017'::uuid,'Eosinophils (Abs)','EOS_ABS','/cmm','Hematology',true,true,false,'20 - 700',null,null,'0','1500','Normal','Low','Eosinophilia'),

-- 18. Basophils % → slug "Basophils" → {{Basophils}}
('a1cbc000-0000-0000-0000-000000000018'::uuid,'Basophils (%)','BASO_PCT','%','Hematology',true,true,false,'0 - 2',null,null,'0','5','Normal','Low','Basophilia'),

-- 19. Basophils Abs → slug "BasophilsAbs" → {{BasophilsAbs}}
('a1cbc000-0000-0000-0000-000000000019'::uuid,'Basophils (Abs)','BASO_ABS','/cmm','Hematology',true,true,false,'0 - 100',null,null,'0','500','Normal','Low','Basophilia'),

-- 20. ESR → slug "ESRAfter1hour" → {{ESRAfter1hour}}
('a1cbc000-0000-0000-0000-000000000020'::uuid,'ESR (After 1 hour)','ESR','mm/hr','Hematology',true,true,false,'0 - 20','0 - 13','0 - 20',null,'100','Normal',
  null,
  'Elevated — Inflammation / Infection'
)

ON CONFLICT (id) DO UPDATE SET
  name                    = EXCLUDED.name,
  code                    = EXCLUDED.code,
  unit                    = EXCLUDED.unit,
  category                = EXCLUDED.category,
  is_active               = EXCLUDED.is_active,
  is_global               = EXCLUDED.is_global,
  to_be_copied            = EXCLUDED.to_be_copied,
  reference_range         = EXCLUDED.reference_range,
  reference_range_male    = EXCLUDED.reference_range_male,
  reference_range_female  = EXCLUDED.reference_range_female,
  low_critical            = EXCLUDED.low_critical,
  high_critical           = EXCLUDED.high_critical,
  interpretation_normal   = EXCLUDED.interpretation_normal,
  interpretation_low      = EXCLUDED.interpretation_low,
  interpretation_high     = EXCLUDED.interpretation_high,
  updated_at              = now();

-- ── STEP 2: Upsert global_test_catalog — 3-Part CBC ──────────
-- 9 analytes: HGB, TLC, PLT, HCT, RBC, MCV, MCH, MCHC, RDW_CV
-- Order in the JSONB array controls report display order.

INSERT INTO public.global_test_catalog (
  name,
  code,
  category,
  description,
  analytes,
  default_price,
  specimen_type_default,
  department_default,
  default_ai_processing_type,
  group_level_prompt,
  ai_config
) VALUES (
  'Complete Blood Count (3-Part)',
  'CBC_3PART',
  'Hematology',
  'Basic CBC measuring Hemoglobin, Total Leukocyte Count, Platelet Count, and five Blood Indices (Hematocrit, RBC Count, MCV, MCH, MCHC, RDW). Suitable for routine health screening, pre-operative workup, and anemia evaluation.',
  '[
    "a1cbc000-0000-0000-0000-000000000001",
    "a1cbc000-0000-0000-0000-000000000002",
    "a1cbc000-0000-0000-0000-000000000003",
    "a1cbc000-0000-0000-0000-000000000004",
    "a1cbc000-0000-0000-0000-000000000005",
    "a1cbc000-0000-0000-0000-000000000006",
    "a1cbc000-0000-0000-0000-000000000007",
    "a1cbc000-0000-0000-0000-000000000008",
    "a1cbc000-0000-0000-0000-000000000009"
  ]'::jsonb,
  200,
  'EDTA Blood',
  'Hematology',
  'THERMAL_SLIP_OCR',
  'Extract all CBC values from thermal slip / analyzer screen. Capture: Hemoglobin (g/dL), Total Leukocyte Count (/cmm), Platelet Count (/cmm), Hematocrit (%), RBC (10⁶/µL), MCV (fL), MCH (pg), MCHC (g/dL), RDW-CV (%). Preserve decimal precision. Flag values outside biological reference intervals.',
  '{
    "model": "claude-3-5-haiku-20241022",
    "confidence": 0.95,
    "reason": "Standard 3-Part hematology analyzer with 9 quantitative parameters",
    "config": {
      "capture_mode": "AUTO_INSTRUMENT_EXTRACTION",
      "expected_parameters": [
        "Hemoglobin", "TLC", "Platelet Count",
        "Hematocrit", "RBC", "MCV", "MCH", "MCHC", "RDW"
      ],
      "validation_rules": {
        "decimal_precision": 2,
        "flag_extreme_values": true,
        "allow_partial_capture": true
      }
    },
    "warnings": [
      "Verify analyzer calibration before accepting results",
      "Manual review if Hb < 7 or WBC > 20000"
    ],
    "needs_manual_upload": false,
    "generated_at": "2026-03-08T00:00:00.000Z"
  }'::jsonb
)
ON CONFLICT (code) DO UPDATE SET
  name                      = EXCLUDED.name,
  category                  = EXCLUDED.category,
  description               = EXCLUDED.description,
  analytes                  = EXCLUDED.analytes,
  default_price             = EXCLUDED.default_price,
  specimen_type_default     = EXCLUDED.specimen_type_default,
  department_default        = EXCLUDED.department_default,
  default_ai_processing_type = EXCLUDED.default_ai_processing_type,
  group_level_prompt        = EXCLUDED.group_level_prompt,
  ai_config                 = EXCLUDED.ai_config,
  updated_at                = now();

-- ── STEP 3: Upsert global_test_catalog — 5-Part CBC ──────────
-- 20 analytes: core (9) + differential % (5) + absolute (5) + ESR (1)
-- Pairs each diff cell type: % then Abs, matching the template layout:
--   Parameter | [%] | Expected Values | [Abs] | Expected Values

INSERT INTO public.global_test_catalog (
  name,
  code,
  category,
  description,
  analytes,
  default_price,
  specimen_type_default,
  department_default,
  default_ai_processing_type,
  group_level_prompt,
  ai_config
) VALUES (
  'Complete Blood Count (5-Part Differential)',
  'CBC_5PART',
  'Hematology',
  'Comprehensive CBC with 5-Part Differential WBC Count. Measures Hemoglobin, Total Leukocyte Count, Platelet Count, and Blood Indices (HCT, RBC, MCV, MCH, MCHC, RDW). Reports full WBC differential — Neutrophils, Lymphocytes, Monocytes, Eosinophils, Basophils — as both percentage and absolute count (/cmm). Includes ESR (After 1 hour). Used for comprehensive hematological assessment, infection workup, anemia classification, and blood disorder screening.',
  '[
    "a1cbc000-0000-0000-0000-000000000001",
    "a1cbc000-0000-0000-0000-000000000002",
    "a1cbc000-0000-0000-0000-000000000003",
    "a1cbc000-0000-0000-0000-000000000004",
    "a1cbc000-0000-0000-0000-000000000005",
    "a1cbc000-0000-0000-0000-000000000006",
    "a1cbc000-0000-0000-0000-000000000007",
    "a1cbc000-0000-0000-0000-000000000008",
    "a1cbc000-0000-0000-0000-000000000009",
    "a1cbc000-0000-0000-0000-000000000010",
    "a1cbc000-0000-0000-0000-000000000011",
    "a1cbc000-0000-0000-0000-000000000012",
    "a1cbc000-0000-0000-0000-000000000013",
    "a1cbc000-0000-0000-0000-000000000014",
    "a1cbc000-0000-0000-0000-000000000015",
    "a1cbc000-0000-0000-0000-000000000016",
    "a1cbc000-0000-0000-0000-000000000017",
    "a1cbc000-0000-0000-0000-000000000018",
    "a1cbc000-0000-0000-0000-000000000019",
    "a1cbc000-0000-0000-0000-000000000020"
  ]'::jsonb,
  350,
  'EDTA Blood',
  'Hematology',
  'THERMAL_SLIP_OCR',
  'Extract full 5-Part CBC from thermal slip / analyzer screen. Capture ALL sections:
(1) CORE: Hemoglobin (g/dL), Total Leukocyte Count (/cmm), Platelet Count (/cmm);
(2) BLOOD INDICES: Hematocrit (%), RBC (10⁶/µL), MCV (fL), MCH (pg), MCHC (g/dL), RDW-CV (%);
(3) DIFFERENTIAL WBC COUNT — capture BOTH percentage [%] AND absolute count [/cmm] for each:
    Neutrophils, Lymphocytes, Monocytes, Eosinophils, Basophils;
(4) ESR After 1 hour (mm/hr).
Preserve decimal precision. Flag values with L/H marker if outside biological reference interval.
Verify differential percentages sum to approximately 100%.',
  '{
    "model": "claude-3-5-haiku-20241022",
    "confidence": 0.95,
    "reason": "Standard 5-Part hematology analyzer with 20 quantitative parameters including full differential",
    "config": {
      "capture_mode": "AUTO_INSTRUMENT_EXTRACTION",
      "expected_parameters": [
        "Hemoglobin", "TLC", "Platelet_Count",
        "Hematocrit", "RBC", "MCV", "MCH", "MCHC", "RDW_CV",
        "Neutrophils_pct", "Neutrophils_abs",
        "Lymphocytes_pct", "Lymphocytes_abs",
        "Monocytes_pct", "Monocytes_abs",
        "Eosinophils_pct", "Eosinophils_abs",
        "Basophils_pct", "Basophils_abs",
        "ESR"
      ],
      "validation_rules": {
        "decimal_precision": 2,
        "flag_extreme_values": true,
        "allow_partial_capture": false,
        "differential_must_sum_to_100": true,
        "differential_sum_tolerance": 2
      }
    },
    "warnings": [
      "All abnormal hemograms must be reviewed and confirmed microscopically",
      "Peripheral blood smear and malarial parasite exam are separate tests",
      "Verify differential % sum = 100 ± 2%"
    ],
    "needs_manual_upload": false,
    "generated_at": "2026-03-08T00:00:00.000Z"
  }'::jsonb
)
ON CONFLICT (code) DO UPDATE SET
  name                      = EXCLUDED.name,
  category                  = EXCLUDED.category,
  description               = EXCLUDED.description,
  analytes                  = EXCLUDED.analytes,
  default_price             = EXCLUDED.default_price,
  specimen_type_default     = EXCLUDED.specimen_type_default,
  department_default        = EXCLUDED.department_default,
  default_ai_processing_type = EXCLUDED.default_ai_processing_type,
  group_level_prompt        = EXCLUDED.group_level_prompt,
  ai_config                 = EXCLUDED.ai_config,
  updated_at                = now();

-- ── STEP 4: Backfill lab_analytes for ALL existing labs ───────
-- New labs already get analytes automatically via on_lab_insert_create_lab_analytes.
-- Existing labs need the 20 new canonical analytes added to their lab_analytes.

INSERT INTO public.lab_analytes (lab_id, analyte_id, is_active, visible)
SELECT
  l.id,
  a.id,
  true,
  true
FROM public.labs l
CROSS JOIN public.analytes a
WHERE a.id IN (
  'a1cbc000-0000-0000-0000-000000000001',
  'a1cbc000-0000-0000-0000-000000000002',
  'a1cbc000-0000-0000-0000-000000000003',
  'a1cbc000-0000-0000-0000-000000000004',
  'a1cbc000-0000-0000-0000-000000000005',
  'a1cbc000-0000-0000-0000-000000000006',
  'a1cbc000-0000-0000-0000-000000000007',
  'a1cbc000-0000-0000-0000-000000000008',
  'a1cbc000-0000-0000-0000-000000000009',
  'a1cbc000-0000-0000-0000-000000000010',
  'a1cbc000-0000-0000-0000-000000000011',
  'a1cbc000-0000-0000-0000-000000000012',
  'a1cbc000-0000-0000-0000-000000000013',
  'a1cbc000-0000-0000-0000-000000000014',
  'a1cbc000-0000-0000-0000-000000000015',
  'a1cbc000-0000-0000-0000-000000000016',
  'a1cbc000-0000-0000-0000-000000000017',
  'a1cbc000-0000-0000-0000-000000000018',
  'a1cbc000-0000-0000-0000-000000000019',
  'a1cbc000-0000-0000-0000-000000000020'
)
ON CONFLICT (lab_id, analyte_id) DO NOTHING;

COMMIT;

-- ── VERIFICATION (run separately after migration) ─────────────

-- 1. Confirm all 20 canonical analytes were inserted
SELECT id, name, code, unit, reference_range
FROM analytes
WHERE id::text LIKE 'a1cbc000%'
ORDER BY id;

-- 2. Confirm both global catalog entries
SELECT id, name, code, jsonb_array_length(analytes) AS analyte_count,
       specimen_type_default, department_default, default_ai_processing_type
FROM global_test_catalog
WHERE code IN ('CBC_3PART', 'CBC_5PART');

-- 3. Confirm all analyte IDs in the catalog actually exist in analytes table
WITH catalog_analytes AS (
  SELECT gtc.code AS catalog_code, elem::text::uuid AS analyte_id
  FROM global_test_catalog gtc,
  jsonb_array_elements_text(gtc.analytes) AS elem
  WHERE gtc.code IN ('CBC_3PART', 'CBC_5PART')
)
SELECT
  ca.catalog_code,
  ca.analyte_id,
  a.name,
  a.code,
  CASE WHEN a.id IS NULL THEN '❌ MISSING' ELSE '✅ OK' END AS status
FROM catalog_analytes ca
LEFT JOIN analytes a ON a.id = ca.analyte_id
ORDER BY ca.catalog_code, ca.analyte_id;

-- 4. Confirm lab_analytes backfill — count per lab
SELECT
  l.name AS lab_name,
  COUNT(la.id) AS new_canonical_analytes_added
FROM labs l
JOIN lab_analytes la ON la.lab_id = l.id
WHERE la.analyte_id::text LIKE 'a1cbc000%'
GROUP BY l.name
ORDER BY l.name;
