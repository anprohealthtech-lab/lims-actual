-- =============================================================
-- Global Analyzer Profiles Seed
-- These are lab-agnostic machine templates used by the AI
-- mapping engine and HL7/ASTM message generator.
--
-- Corrections vs user draft:
--   - RS232 → ASTM  (RS232 is physical layer; ASTM is the messaging protocol)
--   - Removed "Fully FAITHFUL FAITH-100" (not a real instrument)
--   - Added connection_settings with baud rate for serial/ASTM devices
--   - Added is_active = true explicitly
--   - ON CONFLICT (id) DO UPDATE handles re-runs safely
-- =============================================================

INSERT INTO public.analyzer_profiles
  (id, name, manufacturer, model, protocol, supported_tests, connection_settings, ai_parsing_hints, is_active)
VALUES

-- ========================
-- HEMATOLOGY
-- ========================
(
  'mindray-bc6800',
  'Mindray BC-6800',
  'Mindray', 'BC-6800', 'HL7',
  ARRAY['CBC','WBC','RBC','HGB','HCT','MCV','MCH','MCHC','PLT','NEU','LYM','MON','EOS','BAS'],
  '{"default_port": 5000}'::jsonb,
  '{
    "category": "hematology",
    "result_format": "OBX_per_parameter",
    "barcode_field": "PID-3",
    "layout": "tabular_cbc",
    "common_aliases": ["BC6800","BC-6800"],
    "notes": "5-part differential hematology"
  }'::jsonb,
  true
),
(
  'mindray-bc6800plus',
  'Mindray BC-6800 Plus',
  'Mindray', 'BC-6800 Plus', 'HL7',
  ARRAY['CBC','WBC','RBC','HGB','HCT','MCV','MCH','MCHC','PLT','NEU','LYM','MON','EOS','BAS','RET'],
  '{"default_port": 5000}'::jsonb,
  '{
    "category": "hematology",
    "result_format": "OBX_per_parameter",
    "barcode_field": "PID-3",
    "layout": "tabular_cbc",
    "common_aliases": ["BC6800Plus","BC-6800Plus"],
    "notes": "5-part differential with reticulocyte"
  }'::jsonb,
  true
),
(
  'mindray-bc5150',
  'Mindray BC-5150',
  'Mindray', 'BC-5150', 'HL7',
  ARRAY['CBC','WBC','RBC','HGB','HCT','MCV','MCH','MCHC','PLT','NEU','LYM','MON','EOS','BAS'],
  '{"default_port": 5000}'::jsonb,
  '{
    "category": "hematology",
    "result_format": "OBX_per_parameter",
    "barcode_field": "PID-3",
    "layout": "tabular_cbc",
    "common_aliases": ["BC5150","BC-5150"],
    "notes": "5-part hematology analyzer"
  }'::jsonb,
  true
),
(
  'mindray-bc30s',
  'Mindray BC-30s',
  'Mindray', 'BC-30s',
  'ASTM',  -- communicates over RS232 serial using ASTM E1381/LIS2-A2
  ARRAY['CBC','WBC','RBC','HGB','HCT','MCV','MCH','MCHC','PLT','LYM','MID','GRA'],
  '{"baud_rate": 9600, "data_bits": 8, "stop_bits": 1, "parity": "none"}'::jsonb,
  '{
    "category": "hematology",
    "result_format": "astm_records",
    "barcode_field": "sample_id",
    "layout": "compact_cbc",
    "common_aliases": ["BC30s","BC-30s"],
    "notes": "3-part hematology, serial ASTM"
  }'::jsonb,
  true
),
(
  'sysmex-xn1000',
  'Sysmex XN-1000',
  'Sysmex', 'XN-1000', 'HL7',
  ARRAY['CBC','WBC','RBC','HGB','HCT','MCV','MCH','MCHC','PLT','NEUT','LYMPH','MONO','EO','BASO'],
  '{"default_port": 5000}'::jsonb,
  '{
    "category": "hematology",
    "result_format": "OBX_per_parameter",
    "barcode_field": "PID-3",
    "layout": "tabular_cbc",
    "common_aliases": ["XN1000","XN-1000"],
    "notes": "5-part hematology"
  }'::jsonb,
  true
),
(
  'sysmex-xp100',
  'Sysmex XP-100',
  'Sysmex', 'XP-100',
  'ASTM',
  ARRAY['CBC','WBC','RBC','HGB','HCT','MCV','MCH','MCHC','PLT'],
  '{"baud_rate": 9600, "data_bits": 8, "stop_bits": 1, "parity": "none"}'::jsonb,
  '{
    "category": "hematology",
    "result_format": "astm_records",
    "barcode_field": "sample_id",
    "layout": "compact_cbc",
    "common_aliases": ["XP100","XP-100"],
    "notes": "3-part routine CBC, serial ASTM"
  }'::jsonb,
  true
),
(
  'horiba-abx-micros-es60',
  'Horiba ABX Micros ES60',
  'Horiba', 'ABX Micros ES60',
  'ASTM',
  ARRAY['CBC','WBC','RBC','HGB','HCT','MCV','MCH','MCHC','PLT','LYM','MID','GRA'],
  '{"baud_rate": 9600, "data_bits": 8, "stop_bits": 1, "parity": "none"}'::jsonb,
  '{
    "category": "hematology",
    "result_format": "astm_records",
    "barcode_field": "sample_id",
    "layout": "compact_cbc",
    "common_aliases": ["Micros ES60","ABX ES60"],
    "notes": "3-part CBC, serial ASTM"
  }'::jsonb,
  true
),
(
  'nihon-kohden-celltac-g',
  'Nihon Kohden Celltac G',
  'Nihon Kohden', 'Celltac G',
  'ASTM',
  ARRAY['CBC','WBC','RBC','HGB','HCT','MCV','MCH','MCHC','PLT'],
  '{"baud_rate": 9600, "data_bits": 8, "stop_bits": 1, "parity": "none"}'::jsonb,
  '{
    "category": "hematology",
    "result_format": "astm_records",
    "barcode_field": "sample_id",
    "layout": "compact_cbc",
    "common_aliases": ["Celltac G"],
    "notes": "routine hematology, serial ASTM"
  }'::jsonb,
  true
),

-- ========================
-- BIOCHEMISTRY / CHEMISTRY
-- ========================
(
  'erba-xl640',
  'Erba XL-640',
  'Erba', 'XL-640', 'HL7',
  ARRAY['LFT','KFT','Lipid','Glucose','HbA1c','Urea','Creatinine','Uric Acid','Bilirubin','SGOT','SGPT','ALP','Protein','Albumin'],
  '{"default_port": 5000}'::jsonb,
  '{
    "category": "biochemistry",
    "result_format": "OBX_per_parameter",
    "barcode_field": "sample_id",
    "layout": "chemistry_panel",
    "common_aliases": ["XL640","XL-640","Transasia XL-640"],
    "notes": "fully automated chemistry analyzer"
  }'::jsonb,
  true
),
(
  'erba-em200',
  'Erba EM 200',
  'Erba', 'EM 200',
  'ASTM',
  ARRAY['LFT','KFT','Lipid','Glucose','Urea','Creatinine','Uric Acid','Bilirubin','SGOT','SGPT','ALP'],
  '{"baud_rate": 9600, "data_bits": 8, "stop_bits": 1, "parity": "none"}'::jsonb,
  '{
    "category": "biochemistry",
    "result_format": "astm_records",
    "barcode_field": "sample_id",
    "layout": "chemistry_panel",
    "common_aliases": ["EM200","EM 200"],
    "notes": "semi-automated chemistry, serial ASTM"
  }'::jsonb,
  true
),
(
  'roche-cobas-c311',
  'Roche cobas c 311',
  'Roche', 'cobas c 311', 'HL7',
  ARRAY['Clinical Chemistry','ISE','HbA1c','Glucose','Urea','Creatinine','LFT','KFT','Lipid'],
  '{"default_port": 5000}'::jsonb,
  '{
    "category": "biochemistry",
    "result_format": "OBX_per_parameter",
    "barcode_field": "sample_id",
    "layout": "chemistry_panel",
    "common_aliases": ["Cobas c311","c311"],
    "notes": "chemistry + ISE/HbA1c depending on setup"
  }'::jsonb,
  true
),
(
  'roche-cobas-c111',
  'Roche cobas c 111',
  'Roche', 'cobas c 111', 'HL7',
  ARRAY['Clinical Chemistry','Glucose','Urea','Creatinine','LFT','KFT','Lipid','HbA1c'],
  '{"default_port": 5000}'::jsonb,
  '{
    "category": "biochemistry",
    "result_format": "OBX_per_parameter",
    "barcode_field": "sample_id",
    "layout": "chemistry_panel",
    "common_aliases": ["Cobas c111","c111"],
    "notes": "small lab chemistry platform"
  }'::jsonb,
  true
),
(
  'beckman-au480',
  'Beckman Coulter AU480',
  'Beckman Coulter', 'AU480', 'HL7',
  ARRAY['Clinical Chemistry','LFT','KFT','Lipid','Glucose','Urea','Creatinine','Amylase','CRP'],
  '{"default_port": 5000}'::jsonb,
  '{
    "category": "biochemistry",
    "result_format": "OBX_per_parameter",
    "barcode_field": "sample_id",
    "layout": "chemistry_panel",
    "common_aliases": ["AU480"],
    "notes": "fully automated chemistry analyzer"
  }'::jsonb,
  true
),
(
  'randox-imola',
  'Randox Imola',
  'Randox', 'Imola', 'ASTM',
  ARRAY['Clinical Chemistry','LFT','KFT','Lipid','Glucose','Urea','Creatinine'],
  '{"baud_rate": 9600, "data_bits": 8, "stop_bits": 1, "parity": "none"}'::jsonb,
  '{
    "category": "biochemistry",
    "result_format": "astm_records",
    "barcode_field": "sample_id",
    "layout": "chemistry_panel",
    "common_aliases": ["Imola"],
    "notes": "interfaced via ASTM/LIS middleware"
  }'::jsonb,
  true
),

-- ========================
-- IMMUNOASSAY / CLIA
-- ========================
(
  'abbott-architect-i1000sr',
  'Abbott ARCHITECT i1000SR',
  'Abbott', 'ARCHITECT i1000SR', 'HL7',
  ARRAY['Thyroid','Vitamin D','Ferritin','Beta hCG','Troponin','PSA','HBsAg','HIV','Immunoassay'],
  '{"default_port": 5000}'::jsonb,
  '{
    "category": "immunoassay",
    "result_format": "OBX_per_parameter",
    "barcode_field": "sample_id",
    "layout": "assay_result_table",
    "common_aliases": ["Architect i1000SR","i1000SR"],
    "notes": "chemiluminescent immunoassay"
  }'::jsonb,
  true
),
(
  'snibe-maglumi-800',
  'Snibe MAGLUMI 800',
  'Snibe', 'MAGLUMI 800', 'HL7',
  ARRAY['Thyroid','Vitamin D','Ferritin','Beta hCG','Tumor Markers','Hormones','Infectious Markers','Immunoassay'],
  '{"default_port": 5000}'::jsonb,
  '{
    "category": "immunoassay",
    "result_format": "OBX_per_parameter",
    "barcode_field": "sample_id",
    "layout": "assay_result_table",
    "common_aliases": ["MAGLUMI800","MAGLUMI 800"],
    "notes": "CLIA analyzer, common in Indian labs"
  }'::jsonb,
  true
),
(
  'snibe-maglumi-x8',
  'Snibe MAGLUMI X8',
  'Snibe', 'MAGLUMI X8', 'HL7',
  ARRAY['Thyroid','Vitamin D','Ferritin','Beta hCG','Tumor Markers','Hormones','Immunoassay'],
  '{"default_port": 5000}'::jsonb,
  '{
    "category": "immunoassay",
    "result_format": "OBX_per_parameter",
    "barcode_field": "sample_id",
    "layout": "assay_result_table",
    "common_aliases": ["MAGLUMI X8","X8"],
    "notes": "high-throughput CLIA"
  }'::jsonb,
  true
),
(
  'siemens-advia-centaur-cp',
  'Siemens ADVIA Centaur CP',
  'Siemens', 'ADVIA Centaur CP', 'HL7',
  ARRAY['Thyroid','Fertility','Cardiac','Tumor Markers','Infectious Markers','Immunoassay'],
  '{"default_port": 5000}'::jsonb,
  '{
    "category": "immunoassay",
    "result_format": "OBX_per_parameter",
    "barcode_field": "sample_id",
    "layout": "assay_result_table",
    "common_aliases": ["Centaur CP","ADVIA Centaur CP"],
    "notes": "immunoassay platform"
  }'::jsonb,
  true
),
(
  'mindray-cl1200i',
  'Mindray CL-1200i',
  'Mindray', 'CL-1200i', 'HL7',
  ARRAY['Thyroid','Fertility','Cardiac','Inflammation','Immunoassay'],
  '{"default_port": 5000}'::jsonb,
  '{
    "category": "immunoassay",
    "result_format": "OBX_per_parameter",
    "barcode_field": "sample_id",
    "layout": "assay_result_table",
    "common_aliases": ["CL1200i","CL-1200i"],
    "notes": "CLIA immunoassay analyzer"
  }'::jsonb,
  true
),

-- ========================
-- COAGULATION
-- ========================
(
  'stago-sta-compact-max',
  'Stago STA Compact Max',
  'Stago', 'STA Compact Max', 'HL7',
  ARRAY['PT','INR','aPTT','Fibrinogen','D-Dimer','Coagulation'],
  '{"default_port": 5000}'::jsonb,
  '{
    "category": "coagulation",
    "result_format": "OBX_per_parameter",
    "barcode_field": "sample_id",
    "layout": "coag_result_table",
    "common_aliases": ["STA Compact Max"],
    "notes": "automated hemostasis system"
  }'::jsonb,
  true
),
(
  'stago-start-max',
  'Stago STart Max',
  'Stago', 'STart Max',
  'ASTM',
  ARRAY['PT','INR','aPTT','Fibrinogen','Coagulation'],
  '{"baud_rate": 9600, "data_bits": 8, "stop_bits": 1, "parity": "none"}'::jsonb,
  '{
    "category": "coagulation",
    "result_format": "astm_records",
    "barcode_field": "sample_id",
    "layout": "coag_result_table",
    "common_aliases": ["STart Max"],
    "notes": "semi-automated coagulation, serial ASTM"
  }'::jsonb,
  true
),

-- ========================
-- URINALYSIS
-- ========================
(
  'dirui-h500',
  'Dirui H-500',
  'Dirui', 'H-500',
  'ASTM',
  ARRAY['Urine Routine','pH','Specific Gravity','Protein','Glucose','Ketone','Blood','Leukocyte','Nitrite','Bilirubin','Urobilinogen'],
  '{"baud_rate": 9600, "data_bits": 8, "stop_bits": 1, "parity": "none"}'::jsonb,
  '{
    "category": "urinalysis",
    "result_format": "astm_records",
    "barcode_field": "sample_id",
    "layout": "urine_strip_table",
    "common_aliases": ["H500","H-500"],
    "notes": "urine strip analyzer, serial ASTM"
  }'::jsonb,
  true
),
(
  'siemens-clinitek-status-plus',
  'Siemens CLINITEK Status+',
  'Siemens', 'CLINITEK Status+',
  'ASTM',
  ARRAY['Urine Routine','pH','Specific Gravity','Protein','Glucose','Ketone','Blood','Leukocyte','Nitrite','Bilirubin'],
  '{"baud_rate": 9600, "data_bits": 8, "stop_bits": 1, "parity": "none"}'::jsonb,
  '{
    "category": "urinalysis",
    "result_format": "astm_records",
    "barcode_field": "sample_id",
    "layout": "urine_strip_table",
    "common_aliases": ["CLINITEK Status+","Clinitek Status Plus"],
    "notes": "urine chemistry analyzer, serial ASTM"
  }'::jsonb,
  true
),

-- ========================
-- ELECTROLYTE
-- ========================
(
  'roche-avl-9180',
  'Roche AVL 9180',
  'Roche', 'AVL 9180',
  'ASTM',
  ARRAY['Na','K','Cl','iCa','Li','Electrolytes'],
  '{"baud_rate": 9600, "data_bits": 8, "stop_bits": 1, "parity": "none"}'::jsonb,
  '{
    "category": "electrolyte",
    "result_format": "astm_records",
    "barcode_field": "sample_id",
    "layout": "electrolyte_panel",
    "common_aliases": ["AVL 9180","9180"],
    "notes": "electrolyte ISE analyzer, serial ASTM"
  }'::jsonb,
  true
),
(
  'erba-lyte',
  'Erba Lyte',
  'Erba', 'Lyte',
  'ASTM',
  ARRAY['Na','K','Cl','Electrolytes'],
  '{"baud_rate": 9600, "data_bits": 8, "stop_bits": 1, "parity": "none"}'::jsonb,
  '{
    "category": "electrolyte",
    "result_format": "astm_records",
    "barcode_field": "sample_id",
    "layout": "electrolyte_panel",
    "common_aliases": ["Erba Lyte"],
    "notes": "ISE electrolyte analyzer, serial ASTM"
  }'::jsonb,
  true
),

-- ========================
-- BLOOD GAS / CRITICAL CARE
-- ========================
(
  'radiometer-abl90-flex',
  'Radiometer ABL90 FLEX',
  'Radiometer', 'ABL90 FLEX', 'HL7',
  ARRAY['pH','pCO2','pO2','Na','K','Cl','iCa','Glucose','Lactate','Blood Gas'],
  '{"default_port": 5000}'::jsonb,
  '{
    "category": "blood_gas",
    "result_format": "OBX_per_parameter",
    "barcode_field": "sample_id",
    "layout": "blood_gas_panel",
    "common_aliases": ["ABL90 FLEX","ABL90"],
    "notes": "blood gas and critical care analyzer"
  }'::jsonb,
  true
),
(
  'radiometer-abl90-flex-plus',
  'Radiometer ABL90 FLEX PLUS',
  'Radiometer', 'ABL90 FLEX PLUS', 'HL7',
  ARRAY['pH','pCO2','pO2','Na','K','Cl','iCa','Glucose','Lactate','Bilirubin','Creatinine','Urea','Blood Gas'],
  '{"default_port": 5000}'::jsonb,
  '{
    "category": "blood_gas",
    "result_format": "OBX_per_parameter",
    "barcode_field": "sample_id",
    "layout": "blood_gas_panel",
    "common_aliases": ["ABL90 FLEX PLUS","ABL90 Plus"],
    "notes": "expanded blood gas / acute care analyzer"
  }'::jsonb,
  true
),

-- ========================
-- POCT GLUCOSE
-- ========================
(
  'roche-accuchek-inform-ii',
  'Roche Accu-Chek Inform II',
  'Roche', 'Accu-Chek Inform II',
  'MANUAL_AI_OCR',  -- no direct LIS interface; use screen OCR
  ARRAY['Glucose'],
  '{}'::jsonb,
  '{
    "category": "poct_glucose",
    "result_format": "screen_ocr",
    "barcode_field": "onscreen_operator_or_patient_id",
    "layout": "single_value_screen",
    "common_aliases": ["Accu-Chek Inform II","Inform II"],
    "notes": "POCT glucose meter, no direct LIS — use AI OCR capture"
  }'::jsonb,
  true
)

ON CONFLICT (id) DO UPDATE SET
  name             = EXCLUDED.name,
  manufacturer     = EXCLUDED.manufacturer,
  model            = EXCLUDED.model,
  protocol         = EXCLUDED.protocol,
  supported_tests  = EXCLUDED.supported_tests,
  connection_settings = EXCLUDED.connection_settings,
  ai_parsing_hints = EXCLUDED.ai_parsing_hints,
  is_active        = EXCLUDED.is_active,
  updated_at       = now();
