-- Fix analyte codes to use short standard abbreviations
-- This updates long codes like "WHITE_BLOOD_CELL_COUNT" to "WBC"

-- Common Hematology/CBC Analytes
UPDATE analytes SET code = 'WBC' WHERE code = 'WHITE_BLOOD_CELL_COUNT' OR name ILIKE '%White Blood Cell%';
UPDATE analytes SET code = 'RBC' WHERE code = 'RED_BLOOD_CELL_COUNT' OR name ILIKE '%Red Blood Cell Count%';
UPDATE analytes SET code = 'HB' WHERE code = 'HEMOGLOBIN' OR name ILIKE '%Hemoglobin%';
UPDATE analytes SET code = 'HCT' WHERE code = 'HEMATOCRIT' OR name ILIKE '%Hematocrit%';
UPDATE analytes SET code = 'MCV' WHERE code = 'MEAN_CORPUSCULAR_VOLUME' OR name ILIKE '%MCV%' OR name ILIKE '%Mean Corpuscular Volume%';
UPDATE analytes SET code = 'MCH' WHERE code = 'MEAN_CORPUSCULAR_HEMOGLOBIN' OR (name ILIKE '%MCH%' AND name NOT ILIKE '%MCHC%') OR (name ILIKE '%Mean Corpuscular Hemoglobin%' AND name NOT ILIKE '%Concentration%');
UPDATE analytes SET code = 'MCHC' WHERE code = 'MEAN_CORPUSCULAR_HEMOGLOBIN_CONCENTRATION' OR name ILIKE '%MCHC%' OR name ILIKE '%Mean Corpuscular Hemoglobin Concentration%';
UPDATE analytes SET code = 'RDW' WHERE code ILIKE '%RDW%' OR name ILIKE '%Red Cell Distribution Width%' OR name ILIKE '%RDW%';
UPDATE analytes SET code = 'PLT' WHERE code ILIKE '%PLATELET%' OR name ILIKE '%Platelet Count%';
UPDATE analytes SET code = 'MPV' WHERE code = 'MEAN_PLATELET_VOLUME' OR name ILIKE '%Mean Platelet Volume%';

-- Differential Count
UPDATE analytes SET code = 'NEUT' WHERE code ILIKE '%NEUTROPHIL%' OR name ILIKE '%Neutrophil%';
UPDATE analytes SET code = 'LYMPH' WHERE code ILIKE '%LYMPHOCYTE%' OR name ILIKE '%Lymphocyte%';
UPDATE analytes SET code = 'MONO' WHERE code ILIKE '%MONOCYTE%' OR name ILIKE '%Monocyte%';
UPDATE analytes SET code = 'EOS' WHERE code ILIKE '%EOSINOPHIL%' OR name ILIKE '%Eosinophil%';
UPDATE analytes SET code = 'BASO' WHERE code ILIKE '%BASOPHIL%' OR name ILIKE '%Basophil%';

-- Chemistry
UPDATE analytes SET code = 'GLU' WHERE code = 'GLUCOSE' OR name ILIKE '%Glucose%';
UPDATE analytes SET code = 'BUN' WHERE code = 'BLOOD_UREA_NITROGEN' OR name ILIKE '%Blood Urea Nitrogen%' OR name ILIKE '%BUN%';
UPDATE analytes SET code = 'CREAT' WHERE code = 'CREATININE' OR name ILIKE '%Creatinine%';
UPDATE analytes SET code = 'NA' WHERE code = 'SODIUM' OR name = 'Sodium';
UPDATE analytes SET code = 'K' WHERE code = 'POTASSIUM' OR name = 'Potassium';
UPDATE analytes SET code = 'CL' WHERE code = 'CHLORIDE' OR name = 'Chloride';
UPDATE analytes SET code = 'CO2' WHERE code = 'CARBON_DIOXIDE' OR name ILIKE '%Carbon Dioxide%' OR name = 'CO2';
UPDATE analytes SET code = 'CA' WHERE code = 'CALCIUM' OR name = 'Calcium';
UPDATE analytes SET code = 'ALB' WHERE code = 'ALBUMIN' OR name = 'Albumin';
UPDATE analytes SET code = 'TP' WHERE code = 'TOTAL_PROTEIN' OR name ILIKE '%Total Protein%';
UPDATE analytes SET code = 'BILI_T' WHERE code = 'TOTAL_BILIRUBIN' OR name ILIKE '%Total Bilirubin%';
UPDATE analytes SET code = 'BILI_D' WHERE code = 'DIRECT_BILIRUBIN' OR name ILIKE '%Direct Bilirubin%';
UPDATE analytes SET code = 'ALT' WHERE code ILIKE '%ALT%' OR name ILIKE '%ALT%' OR name ILIKE '%Alanine Aminotransferase%';
UPDATE analytes SET code = 'AST' WHERE code ILIKE '%AST%' OR name ILIKE '%AST%' OR name ILIKE '%Aspartate Aminotransferase%';
UPDATE analytes SET code = 'ALP' WHERE code ILIKE '%ALP%' OR name ILIKE '%Alkaline Phosphatase%';
UPDATE analytes SET code = 'GGT' WHERE code = 'GAMMA_GLUTAMYL_TRANSFERASE' OR name ILIKE '%GGT%' OR name ILIKE '%Gamma Glutamyl%';

-- Lipid Panel
UPDATE analytes SET code = 'CHOL' WHERE code = 'TOTAL_CHOLESTEROL' OR name ILIKE '%Total Cholesterol%';
UPDATE analytes SET code = 'HDL' WHERE code = 'HDL_CHOLESTEROL' OR name ILIKE '%HDL%';
UPDATE analytes SET code = 'LDL' WHERE code = 'LDL_CHOLESTEROL' OR name ILIKE '%LDL%';
UPDATE analytes SET code = 'TRIG' WHERE code = 'TRIGLYCERIDES' OR name ILIKE '%Triglyceride%';

-- Thyroid
UPDATE analytes SET code = 'TSH' WHERE code ILIKE '%TSH%' OR name ILIKE '%TSH%' OR name ILIKE '%Thyroid Stimulating%';
UPDATE analytes SET code = 'T3' WHERE code = 'T3' OR name = 'T3' OR name ILIKE '%Triiodothyronine%';
UPDATE analytes SET code = 'T4' WHERE code = 'T4' OR name = 'T4' OR name ILIKE '%Thyroxine%';
UPDATE analytes SET code = 'FT3' WHERE code = 'FREE_T3' OR name ILIKE '%Free T3%';
UPDATE analytes SET code = 'FT4' WHERE code = 'FREE_T4' OR name ILIKE '%Free T4%';

-- Coagulation
UPDATE analytes SET code = 'PT' WHERE code = 'PROTHROMBIN_TIME' OR name ILIKE '%Prothrombin Time%' OR name = 'PT';
UPDATE analytes SET code = 'INR' WHERE code = 'INR' OR name = 'INR';
UPDATE analytes SET code = 'APTT' WHERE code ILIKE '%APTT%' OR name ILIKE '%APTT%' OR name ILIKE '%Activated Partial Thromboplastin%';

-- Cardiac
UPDATE analytes SET code = 'TROP' WHERE code ILIKE '%TROPONIN%' OR name ILIKE '%Troponin%';
UPDATE analytes SET code = 'CK' WHERE code = 'CREATINE_KINASE' OR name ILIKE '%Creatine Kinase%' OR name = 'CK';
UPDATE analytes SET code = 'CKMB' WHERE code = 'CK_MB' OR name ILIKE '%CK-MB%' OR name ILIKE '%CK MB%';

-- Diabetes
UPDATE analytes SET code = 'HBA1C' WHERE code = 'HEMOGLOBIN_A1C' OR name ILIKE '%HbA1c%' OR name ILIKE '%Hemoglobin A1c%';

-- Urine
UPDATE analytes SET code = 'U_GLU' WHERE code = 'URINE_GLUCOSE' OR name ILIKE '%Urine%Glucose%';
UPDATE analytes SET code = 'U_PROT' WHERE code = 'URINE_PROTEIN' OR name ILIKE '%Urine%Protein%';
UPDATE analytes SET code = 'U_KET' WHERE code = 'URINE_KETONES' OR name ILIKE '%Urine%Ketone%';

-- If code is still very long (>10 chars), try to shorten using first letters
UPDATE analytes 
SET code = LEFT(REGEXP_REPLACE(UPPER(name), '[^A-Z]', '', 'g'), 6)
WHERE LENGTH(code) > 10 OR code = '';

COMMENT ON TABLE analytes IS 'Updated analyte codes to use standard medical abbreviations (WBC, RBC, HB, etc.) instead of long descriptive names';
