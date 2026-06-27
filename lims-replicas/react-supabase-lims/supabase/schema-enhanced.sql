-- LIMS Mini - Enhanced Schema with Test Groups, Analytes & Expected Values
-- Run this for full-featured setup

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- TEST GROUPS (Categories)
-- ============================================
CREATE TABLE test_groups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  code TEXT UNIQUE,
  description TEXT,
  display_order INT DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- GLOBAL ANALYTES (Master List)
-- ============================================
CREATE TABLE analytes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  short_name TEXT,
  unit TEXT,

  -- Result type: 'numeric', 'text', 'dropdown', 'boolean'
  result_type TEXT DEFAULT 'numeric',

  -- For dropdown type - expected values
  expected_values JSONB DEFAULT '[]'::jsonb,
  -- Format: ["Negative", "Positive"] or [{"value": "1+", "label": "1+ (Trace)"}, ...]

  -- Default reference ranges (can be overridden per test)
  default_ref_range TEXT,
  default_ref_range_male TEXT,
  default_ref_range_female TEXT,
  default_ref_range_child TEXT,

  -- Critical ranges
  critical_low TEXT,
  critical_high TEXT,

  -- Display
  decimal_places INT DEFAULT 2,
  display_order INT DEFAULT 0,

  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- TEST CATALOG
-- ============================================
CREATE TABLE test_catalog (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  short_name TEXT,

  -- Grouping
  group_id UUID REFERENCES test_groups(id),
  department TEXT,

  -- Sample
  sample_type TEXT,
  sample_volume TEXT,
  container TEXT,

  -- Pricing & TAT
  price DECIMAL(10,2) DEFAULT 0,
  tat_hours INT,

  -- Test-specific analytes with overrides
  analytes JSONB DEFAULT '[]'::jsonb,
  /* Format: [
    {
      "analyte_id": "uuid" or null for inline,
      "name": "Hemoglobin",
      "code": "HGB",
      "unit": "g/dL",
      "result_type": "numeric",
      "expected_values": [],
      "reference_range": "12-16",
      "reference_range_male": "13-17",
      "reference_range_female": "12-15",
      "reference_range_child": "11-14",
      "critical_low": "7",
      "critical_high": "20",
      "is_calculated": false,
      "formula": null,
      "display_order": 1
    }
  ] */

  instructions TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_test_catalog_group ON test_catalog(group_id);

-- ============================================
-- PATIENTS
-- ============================================
CREATE TABLE patients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  gender TEXT, -- 'male', 'female', 'other'
  dob DATE,
  age_years INT,
  age_months INT,
  address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_patients_phone ON patients(phone);
CREATE INDEX idx_patients_name ON patients(name);

-- ============================================
-- ORDERS
-- ============================================
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_number TEXT NOT NULL UNIQUE,
  barcode TEXT,
  patient_id UUID REFERENCES patients(id),
  doctor_name TEXT,
  doctor_phone TEXT,
  priority TEXT DEFAULT 'Normal',
  status TEXT DEFAULT 'registered',
  notes TEXT,
  collected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_orders_number ON orders(order_number);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_created ON orders(created_at DESC);

-- ============================================
-- ORDER TESTS
-- ============================================
CREATE TABLE order_tests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  test_id UUID REFERENCES test_catalog(id),
  test_code TEXT,
  test_name TEXT,
  price DECIMAL(10,2),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_order_tests_order ON order_tests(order_id);

-- ============================================
-- RESULTS
-- ============================================
CREATE TABLE results (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  test_code TEXT NOT NULL,
  test_name TEXT,
  analyte_code TEXT,
  analyte TEXT NOT NULL,

  -- Result value
  value TEXT,
  numeric_value DECIMAL(15,4), -- For sorting/comparison
  unit TEXT,

  -- Reference range used
  reference_range TEXT,

  -- Flag: 'normal', 'low', 'high', 'critical_low', 'critical_high', 'abnormal'
  flag TEXT DEFAULT 'normal',

  -- Metadata
  result_type TEXT DEFAULT 'numeric',
  is_calculated BOOLEAN DEFAULT FALSE,

  -- Workflow
  verification_status TEXT DEFAULT 'pending',
  entered_by UUID,
  entered_at TIMESTAMPTZ DEFAULT NOW(),
  verified_by UUID,
  verified_at TIMESTAMPTZ,
  notes TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_results_order ON results(order_id);
CREATE INDEX idx_results_verification ON results(verification_status);

-- ============================================
-- SETTINGS
-- ============================================
CREATE TABLE settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key TEXT NOT NULL UNIQUE,
  value TEXT,
  value_json JSONB,
  description TEXT,
  category TEXT DEFAULT 'general',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- BRANDING ASSETS
-- ============================================
CREATE TABLE branding_assets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  asset_type TEXT NOT NULL,
  asset_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_type TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  is_default BOOLEAN DEFAULT FALSE,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- RLS POLICIES
-- ============================================
ALTER TABLE test_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytes ENABLE ROW LEVEL SECURITY;
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE results ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE branding_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for authenticated" ON test_groups FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Allow all for authenticated" ON analytes FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Allow all for authenticated" ON patients FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Allow all for authenticated" ON orders FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Allow all for authenticated" ON order_tests FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Allow all for authenticated" ON results FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Allow all for authenticated" ON test_catalog FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Allow all for authenticated" ON settings FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Allow all for authenticated" ON branding_assets FOR ALL USING (auth.role() = 'authenticated');

-- ============================================
-- SEED: TEST GROUPS
-- ============================================
INSERT INTO test_groups (name, code, display_order) VALUES
  ('Hematology', 'HEMA', 1),
  ('Biochemistry', 'BIOC', 2),
  ('Clinical Pathology', 'CLIP', 3),
  ('Immunology', 'IMMU', 4),
  ('Microbiology', 'MICR', 5),
  ('Serology', 'SERO', 6);

-- ============================================
-- SEED: GLOBAL ANALYTES
-- ============================================
INSERT INTO analytes (code, name, unit, result_type, default_ref_range, expected_values, decimal_places) VALUES
  -- Hematology
  ('HGB', 'Hemoglobin', 'g/dL', 'numeric', '12-16', '[]', 1),
  ('WBC', 'WBC Count', 'x10^3/uL', 'numeric', '4-11', '[]', 2),
  ('RBC', 'RBC Count', 'x10^6/uL', 'numeric', '4.5-5.5', '[]', 2),
  ('PLT', 'Platelet Count', 'x10^3/uL', 'numeric', '150-400', '[]', 0),
  ('HCT', 'Hematocrit', '%', 'numeric', '36-48', '[]', 1),
  ('MCV', 'MCV', 'fL', 'numeric', '80-100', '[]', 1),
  ('MCH', 'MCH', 'pg', 'numeric', '27-33', '[]', 1),
  ('MCHC', 'MCHC', 'g/dL', 'numeric', '32-36', '[]', 1),

  -- Biochemistry
  ('GLU_F', 'Glucose (Fasting)', 'mg/dL', 'numeric', '70-100', '[]', 0),
  ('GLU_PP', 'Glucose (PP)', 'mg/dL', 'numeric', '< 140', '[]', 0),
  ('UREA', 'Urea', 'mg/dL', 'numeric', '15-40', '[]', 1),
  ('CREAT', 'Creatinine', 'mg/dL', 'numeric', '0.7-1.3', '[]', 2),
  ('URIC', 'Uric Acid', 'mg/dL', 'numeric', '3.5-7.2', '[]', 1),
  ('CHOL', 'Total Cholesterol', 'mg/dL', 'numeric', '< 200', '[]', 0),
  ('TRIG', 'Triglycerides', 'mg/dL', 'numeric', '< 150', '[]', 0),
  ('HDL', 'HDL Cholesterol', 'mg/dL', 'numeric', '> 40', '[]', 0),
  ('LDL', 'LDL Cholesterol', 'mg/dL', 'numeric', '< 100', '[]', 0),
  ('TBIL', 'Bilirubin Total', 'mg/dL', 'numeric', '0.1-1.2', '[]', 2),
  ('DBIL', 'Bilirubin Direct', 'mg/dL', 'numeric', '0-0.3', '[]', 2),
  ('AST', 'SGOT/AST', 'U/L', 'numeric', '10-40', '[]', 0),
  ('ALT', 'SGPT/ALT', 'U/L', 'numeric', '7-56', '[]', 0),
  ('ALP', 'Alkaline Phosphatase', 'U/L', 'numeric', '44-147', '[]', 0),
  ('TP', 'Total Protein', 'g/dL', 'numeric', '6-8', '[]', 1),
  ('ALB', 'Albumin', 'g/dL', 'numeric', '3.5-5', '[]', 1),
  ('GLOB', 'Globulin', 'g/dL', 'numeric', '2-3.5', '[]', 1),

  -- Thyroid
  ('TSH', 'TSH', 'mIU/L', 'numeric', '0.4-4.0', '[]', 2),
  ('T3', 'T3', 'ng/dL', 'numeric', '80-200', '[]', 1),
  ('T4', 'T4', 'ug/dL', 'numeric', '5-12', '[]', 1),
  ('FT3', 'Free T3', 'pg/mL', 'numeric', '2.3-4.2', '[]', 2),
  ('FT4', 'Free T4', 'ng/dL', 'numeric', '0.8-1.8', '[]', 2),

  -- Urine - Dropdown examples
  ('URIN_COL', 'Color', '', 'dropdown', 'Pale Yellow', '["Pale Yellow", "Yellow", "Dark Yellow", "Amber", "Red", "Brown"]', 0),
  ('URIN_APP', 'Appearance', '', 'dropdown', 'Clear', '["Clear", "Slightly Turbid", "Turbid", "Cloudy"]', 0),
  ('URIN_PRO', 'Protein', '', 'dropdown', 'Negative', '["Negative", "Trace", "1+", "2+", "3+", "4+"]', 0),
  ('URIN_GLU', 'Glucose', '', 'dropdown', 'Negative', '["Negative", "Trace", "1+", "2+", "3+", "4+"]', 0),
  ('URIN_KET', 'Ketones', '', 'dropdown', 'Negative', '["Negative", "Trace", "Small", "Moderate", "Large"]', 0),
  ('URIN_BLD', 'Blood', '', 'dropdown', 'Negative', '["Negative", "Trace", "1+", "2+", "3+"]', 0),
  ('URIN_PH', 'pH', '', 'numeric', '4.5-8', '[]', 1),
  ('URIN_SG', 'Specific Gravity', '', 'numeric', '1.005-1.030', '[]', 3),
  ('URIN_RBC', 'RBC', '/HPF', 'numeric', '0-2', '[]', 0),
  ('URIN_PUS', 'Pus Cells', '/HPF', 'numeric', '0-5', '[]', 0),
  ('URIN_EPI', 'Epithelial Cells', '/HPF', 'dropdown', 'Few', '["Nil", "Few", "Moderate", "Many"]', 0),

  -- Serology
  ('HBS_AG', 'HBsAg', '', 'dropdown', 'Negative', '["Negative", "Positive"]', 0),
  ('HIV', 'HIV I & II', '', 'dropdown', 'Negative', '["Negative", "Positive", "Indeterminate"]', 0),
  ('VDRL', 'VDRL', '', 'dropdown', 'Non-Reactive', '["Non-Reactive", "Reactive", "Weakly Reactive"]', 0),
  ('WIDAL_O', 'Widal TO', '', 'dropdown', 'Negative', '["Negative", "1:20", "1:40", "1:80", "1:160", "1:320"]', 0),
  ('WIDAL_H', 'Widal TH', '', 'dropdown', 'Negative', '["Negative", "1:20", "1:40", "1:80", "1:160", "1:320"]', 0),
  ('RA_FACTOR', 'RA Factor', '', 'dropdown', 'Negative', '["Negative", "Positive"]', 0),
  ('CRP', 'CRP', 'mg/L', 'dropdown', 'Negative', '["Negative", "Positive", "6", "12", "24", "48", "96"]', 0),
  ('ASO', 'ASO Titre', 'IU/mL', 'dropdown', '< 200', '["< 200", "200", "400", "800", "1600"]', 0);

-- ============================================
-- SEED: TEST CATALOG WITH FULL ANALYTES
-- ============================================
INSERT INTO test_catalog (code, name, department, sample_type, price, analytes) VALUES
  ('CBC', 'Complete Blood Count', 'Hematology', 'EDTA Blood', 300, '[
    {"name": "Hemoglobin", "code": "HGB", "unit": "g/dL", "result_type": "numeric", "reference_range": "12-16", "reference_range_male": "13-17", "reference_range_female": "12-15", "display_order": 1},
    {"name": "WBC Count", "code": "WBC", "unit": "x10^3/uL", "result_type": "numeric", "reference_range": "4-11", "display_order": 2},
    {"name": "RBC Count", "code": "RBC", "unit": "x10^6/uL", "result_type": "numeric", "reference_range": "4.5-5.5", "display_order": 3},
    {"name": "Platelet Count", "code": "PLT", "unit": "x10^3/uL", "result_type": "numeric", "reference_range": "150-400", "display_order": 4},
    {"name": "Hematocrit", "code": "HCT", "unit": "%", "result_type": "numeric", "reference_range": "36-48", "display_order": 5},
    {"name": "MCV", "code": "MCV", "unit": "fL", "result_type": "numeric", "reference_range": "80-100", "is_calculated": true, "formula": "Hematocrit/RBC Count*10", "display_order": 6},
    {"name": "MCH", "code": "MCH", "unit": "pg", "result_type": "numeric", "reference_range": "27-33", "is_calculated": true, "formula": "Hemoglobin/RBC Count*10", "display_order": 7},
    {"name": "MCHC", "code": "MCHC", "unit": "g/dL", "result_type": "numeric", "reference_range": "32-36", "is_calculated": true, "formula": "Hemoglobin/Hematocrit*100", "display_order": 8}
  ]'::jsonb),

  ('LFT', 'Liver Function Test', 'Biochemistry', 'Serum', 500, '[
    {"name": "Bilirubin Total", "code": "TBIL", "unit": "mg/dL", "result_type": "numeric", "reference_range": "0.1-1.2", "display_order": 1},
    {"name": "Bilirubin Direct", "code": "DBIL", "unit": "mg/dL", "result_type": "numeric", "reference_range": "0-0.3", "display_order": 2},
    {"name": "Bilirubin Indirect", "unit": "mg/dL", "result_type": "numeric", "reference_range": "0.1-0.9", "is_calculated": true, "formula": "Bilirubin Total - Bilirubin Direct", "display_order": 3},
    {"name": "SGOT/AST", "code": "AST", "unit": "U/L", "result_type": "numeric", "reference_range": "10-40", "display_order": 4},
    {"name": "SGPT/ALT", "code": "ALT", "unit": "U/L", "result_type": "numeric", "reference_range": "7-56", "display_order": 5},
    {"name": "Alkaline Phosphatase", "code": "ALP", "unit": "U/L", "result_type": "numeric", "reference_range": "44-147", "display_order": 6},
    {"name": "Total Protein", "code": "TP", "unit": "g/dL", "result_type": "numeric", "reference_range": "6-8", "display_order": 7},
    {"name": "Albumin", "code": "ALB", "unit": "g/dL", "result_type": "numeric", "reference_range": "3.5-5", "display_order": 8},
    {"name": "Globulin", "code": "GLOB", "unit": "g/dL", "result_type": "numeric", "reference_range": "2-3.5", "is_calculated": true, "formula": "Total Protein - Albumin", "display_order": 9},
    {"name": "A/G Ratio", "unit": "", "result_type": "numeric", "reference_range": "1-2", "is_calculated": true, "formula": "Albumin / Globulin", "display_order": 10}
  ]'::jsonb),

  ('KFT', 'Kidney Function Test', 'Biochemistry', 'Serum', 400, '[
    {"name": "Urea", "code": "UREA", "unit": "mg/dL", "result_type": "numeric", "reference_range": "15-40", "display_order": 1},
    {"name": "Creatinine", "code": "CREAT", "unit": "mg/dL", "result_type": "numeric", "reference_range": "0.7-1.3", "display_order": 2},
    {"name": "Uric Acid", "code": "URIC", "unit": "mg/dL", "result_type": "numeric", "reference_range": "3.5-7.2", "display_order": 3},
    {"name": "BUN", "unit": "mg/dL", "result_type": "numeric", "reference_range": "7-20", "is_calculated": true, "formula": "Urea * 0.467", "display_order": 4}
  ]'::jsonb),

  ('LIPID', 'Lipid Profile', 'Biochemistry', 'Serum (Fasting)', 450, '[
    {"name": "Total Cholesterol", "code": "CHOL", "unit": "mg/dL", "result_type": "numeric", "reference_range": "< 200", "display_order": 1},
    {"name": "Triglycerides", "code": "TRIG", "unit": "mg/dL", "result_type": "numeric", "reference_range": "< 150", "display_order": 2},
    {"name": "HDL Cholesterol", "code": "HDL", "unit": "mg/dL", "result_type": "numeric", "reference_range": "> 40", "display_order": 3},
    {"name": "LDL Cholesterol", "code": "LDL", "unit": "mg/dL", "result_type": "numeric", "reference_range": "< 100", "is_calculated": true, "formula": "Total Cholesterol - HDL Cholesterol - Triglycerides/5", "display_order": 4},
    {"name": "VLDL Cholesterol", "unit": "mg/dL", "result_type": "numeric", "reference_range": "< 30", "is_calculated": true, "formula": "Triglycerides / 5", "display_order": 5},
    {"name": "TC/HDL Ratio", "unit": "", "result_type": "numeric", "reference_range": "< 4.5", "is_calculated": true, "formula": "Total Cholesterol / HDL Cholesterol", "display_order": 6}
  ]'::jsonb),

  ('URINE', 'Urine Routine & Microscopy', 'Clinical Pathology', 'Urine', 150, '[
    {"name": "Color", "code": "URIN_COL", "unit": "", "result_type": "dropdown", "expected_values": ["Pale Yellow", "Yellow", "Dark Yellow", "Amber", "Red", "Brown"], "reference_range": "Pale Yellow", "display_order": 1},
    {"name": "Appearance", "code": "URIN_APP", "unit": "", "result_type": "dropdown", "expected_values": ["Clear", "Slightly Turbid", "Turbid", "Cloudy"], "reference_range": "Clear", "display_order": 2},
    {"name": "pH", "code": "URIN_PH", "unit": "", "result_type": "numeric", "reference_range": "4.5-8", "display_order": 3},
    {"name": "Specific Gravity", "code": "URIN_SG", "unit": "", "result_type": "numeric", "reference_range": "1.005-1.030", "display_order": 4},
    {"name": "Protein", "code": "URIN_PRO", "unit": "", "result_type": "dropdown", "expected_values": ["Negative", "Trace", "1+", "2+", "3+", "4+"], "reference_range": "Negative", "display_order": 5},
    {"name": "Glucose", "code": "URIN_GLU", "unit": "", "result_type": "dropdown", "expected_values": ["Negative", "Trace", "1+", "2+", "3+", "4+"], "reference_range": "Negative", "display_order": 6},
    {"name": "Ketones", "code": "URIN_KET", "unit": "", "result_type": "dropdown", "expected_values": ["Negative", "Trace", "Small", "Moderate", "Large"], "reference_range": "Negative", "display_order": 7},
    {"name": "Blood", "code": "URIN_BLD", "unit": "", "result_type": "dropdown", "expected_values": ["Negative", "Trace", "1+", "2+", "3+"], "reference_range": "Negative", "display_order": 8},
    {"name": "RBC", "code": "URIN_RBC", "unit": "/HPF", "result_type": "numeric", "reference_range": "0-2", "display_order": 9},
    {"name": "Pus Cells", "code": "URIN_PUS", "unit": "/HPF", "result_type": "numeric", "reference_range": "0-5", "display_order": 10},
    {"name": "Epithelial Cells", "code": "URIN_EPI", "unit": "/HPF", "result_type": "dropdown", "expected_values": ["Nil", "Few", "Moderate", "Many"], "reference_range": "Few", "display_order": 11}
  ]'::jsonb),

  ('WIDAL', 'Widal Test', 'Serology', 'Serum', 250, '[
    {"name": "Salmonella Typhi O", "code": "WIDAL_O", "unit": "", "result_type": "dropdown", "expected_values": ["Negative", "1:20", "1:40", "1:80", "1:160", "1:320"], "reference_range": "Negative", "display_order": 1},
    {"name": "Salmonella Typhi H", "code": "WIDAL_H", "unit": "", "result_type": "dropdown", "expected_values": ["Negative", "1:20", "1:40", "1:80", "1:160", "1:320"], "reference_range": "Negative", "display_order": 2},
    {"name": "Salmonella Paratyphi AH", "unit": "", "result_type": "dropdown", "expected_values": ["Negative", "1:20", "1:40", "1:80", "1:160", "1:320"], "reference_range": "Negative", "display_order": 3},
    {"name": "Salmonella Paratyphi BH", "unit": "", "result_type": "dropdown", "expected_values": ["Negative", "1:20", "1:40", "1:80", "1:160", "1:320"], "reference_range": "Negative", "display_order": 4}
  ]'::jsonb),

  ('HIV', 'HIV I & II Antibody', 'Serology', 'Serum', 300, '[
    {"name": "HIV I & II", "code": "HIV", "unit": "", "result_type": "dropdown", "expected_values": ["Negative", "Positive", "Indeterminate"], "reference_range": "Negative", "display_order": 1}
  ]'::jsonb),

  ('HBS', 'HBsAg', 'Serology', 'Serum', 250, '[
    {"name": "HBsAg", "code": "HBS_AG", "unit": "", "result_type": "dropdown", "expected_values": ["Negative", "Positive"], "reference_range": "Negative", "display_order": 1}
  ]'::jsonb),

  ('TSH', 'Thyroid Stimulating Hormone', 'Immunology', 'Serum', 350, '[
    {"name": "TSH", "code": "TSH", "unit": "mIU/L", "result_type": "numeric", "reference_range": "0.4-4.0", "display_order": 1}
  ]'::jsonb),

  ('TFT', 'Thyroid Function Test', 'Immunology', 'Serum', 800, '[
    {"name": "TSH", "code": "TSH", "unit": "mIU/L", "result_type": "numeric", "reference_range": "0.4-4.0", "display_order": 1},
    {"name": "T3", "code": "T3", "unit": "ng/dL", "result_type": "numeric", "reference_range": "80-200", "display_order": 2},
    {"name": "T4", "code": "T4", "unit": "ug/dL", "result_type": "numeric", "reference_range": "5-12", "display_order": 3},
    {"name": "Free T3", "code": "FT3", "unit": "pg/mL", "result_type": "numeric", "reference_range": "2.3-4.2", "display_order": 4},
    {"name": "Free T4", "code": "FT4", "unit": "ng/dL", "result_type": "numeric", "reference_range": "0.8-1.8", "display_order": 5}
  ]'::jsonb),

  ('FBS', 'Fasting Blood Sugar', 'Biochemistry', 'Fluoride Blood', 100, '[
    {"name": "Glucose (Fasting)", "code": "GLU_F", "unit": "mg/dL", "result_type": "numeric", "reference_range": "70-100", "display_order": 1}
  ]'::jsonb),

  ('HBA1C', 'Glycated Hemoglobin', 'Biochemistry', 'EDTA Blood', 400, '[
    {"name": "HbA1c", "unit": "%", "result_type": "numeric", "reference_range": "< 5.7", "display_order": 1},
    {"name": "Estimated Avg Glucose", "unit": "mg/dL", "result_type": "numeric", "reference_range": "", "is_calculated": true, "formula": "HbA1c * 28.7 - 46.7", "display_order": 2}
  ]'::jsonb);

-- ============================================
-- SEED: DEFAULT SETTINGS
-- ============================================
INSERT INTO settings (key, value, description, category) VALUES
  ('lab_name', 'Diagnostic Laboratory', 'Laboratory name', 'lab_info'),
  ('lab_address', '', 'Laboratory address', 'lab_info'),
  ('lab_phone', '', 'Contact phone', 'lab_info'),
  ('lab_email', '', 'Contact email', 'lab_info'),
  ('lab_license', '', 'License/Registration number', 'lab_info'),
  ('base_font_size', '12', 'Base font size', 'report_style'),
  ('flag_colors_enabled', 'true', 'Enable colored flags', 'report_style'),
  ('flag_color_high', '#dc2626', 'HIGH color', 'report_style'),
  ('flag_color_low', '#ea580c', 'LOW color', 'report_style'),
  ('flag_color_normal', '#16a34a', 'NORMAL color', 'report_style'),
  ('bold_abnormal_values', 'true', 'Bold abnormal', 'report_style'),
  ('show_flag_asterisk', 'true', 'Show asterisk for flagged', 'report_style'),
  ('show_calculated_marker', 'true', 'Show [Cal] marker', 'report_style'),
  ('signature_enabled', 'true', 'Enable signatures', 'signature'),
  ('signature_count', '2', 'Signature slots', 'signature'),
  ('signature_1_name', 'Lab Technician', 'First signature', 'signature'),
  ('signature_2_name', 'Pathologist', 'Second signature', 'signature'),
  ('qr_enabled', 'true', 'Enable QR code', 'qr'),
  ('qr_position', 'bottom_right', 'QR position', 'qr'),
  ('footer_text', 'This is a computer-generated report.', 'Footer', 'report_style');

-- ============================================
-- TRIGGERS
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_patients_updated_at BEFORE UPDATE ON patients FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_orders_updated_at BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_settings_updated_at BEFORE UPDATE ON settings FOR EACH ROW EXECUTE FUNCTION update_updated_at();
