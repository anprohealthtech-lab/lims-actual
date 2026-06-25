-- LIMS Mini - Supabase Schema
-- Run this in your Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Patients table
CREATE TABLE patients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  gender TEXT,
  dob DATE,
  address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_patients_phone ON patients(phone);
CREATE INDEX idx_patients_name ON patients(name);

-- Test catalog with analytes including calculated fields
CREATE TABLE test_catalog (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  department TEXT,
  sample_type TEXT,
  price DECIMAL(10,2) DEFAULT 0,
  analytes JSONB DEFAULT '[]'::jsonb,
  -- analytes format: [{ name, unit, reference_range, is_calculated?, formula?, gender_specific?: { male, female } }]
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Orders table
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_number TEXT NOT NULL UNIQUE,
  barcode TEXT,
  patient_id UUID REFERENCES patients(id),
  doctor_name TEXT,
  priority TEXT DEFAULT 'Normal',
  status TEXT DEFAULT 'registered',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_orders_number ON orders(order_number);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_created ON orders(created_at);

-- Order tests (line items)
CREATE TABLE order_tests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  test_id UUID REFERENCES test_catalog(id),
  test_code TEXT,
  test_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_order_tests_order ON order_tests(order_id);

-- Results table
CREATE TABLE results (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  test_code TEXT NOT NULL,
  test_name TEXT,
  analyte TEXT NOT NULL,
  value TEXT,
  unit TEXT,
  reference_range TEXT,
  flag TEXT DEFAULT 'normal',
  is_calculated BOOLEAN DEFAULT FALSE,
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

-- Settings table (key-value store for all lab settings)
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

-- Branding assets (header, footer, logo, signatures)
CREATE TABLE branding_assets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  asset_type TEXT NOT NULL, -- 'header', 'footer', 'logo', 'watermark', 'letterhead', 'signature'
  asset_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_type TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  is_default BOOLEAN DEFAULT FALSE,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_branding_assets_type ON branding_assets(asset_type);

-- Insert default settings
INSERT INTO settings (key, value, description, category) VALUES
  -- Lab Information
  ('lab_name', 'Diagnostic Laboratory', 'Laboratory name', 'lab_info'),
  ('lab_address', '', 'Laboratory address', 'lab_info'),
  ('lab_phone', '', 'Contact phone', 'lab_info'),
  ('lab_email', '', 'Contact email', 'lab_info'),
  ('lab_license', '', 'License/Registration number', 'lab_info'),

  -- Report Layout
  ('header_height', '90', 'Header height in pixels', 'pdf_layout'),
  ('footer_height', '80', 'Footer height in pixels', 'pdf_layout'),
  ('margin_top', '100', 'Top margin in pixels', 'pdf_layout'),
  ('margin_bottom', '80', 'Bottom margin in pixels', 'pdf_layout'),
  ('margin_left', '20', 'Left margin', 'pdf_layout'),
  ('margin_right', '20', 'Right margin', 'pdf_layout'),

  -- Result Display
  ('base_font_size', '12', 'Base font size for reports', 'report_style'),
  ('flag_colors_enabled', 'true', 'Enable colored flags', 'report_style'),
  ('flag_color_high', '#dc2626', 'Color for HIGH values', 'report_style'),
  ('flag_color_low', '#ea580c', 'Color for LOW values', 'report_style'),
  ('flag_color_normal', '#16a34a', 'Color for NORMAL values', 'report_style'),
  ('bold_abnormal_values', 'true', 'Bold abnormal values', 'report_style'),
  ('show_flag_asterisk', 'true', 'Show asterisk for flagged values', 'report_style'),
  ('show_calculated_marker', 'true', 'Show [Cal] marker', 'report_style'),

  -- Signature Settings
  ('signature_enabled', 'true', 'Enable signature section', 'signature'),
  ('signature_count', '2', 'Number of signature slots (1-3)', 'signature'),
  ('signature_1_name', 'Lab Technician', 'First signature label', 'signature'),
  ('signature_2_name', 'Pathologist', 'Second signature label', 'signature'),

  -- Watermark
  ('watermark_enabled', 'false', 'Enable watermark', 'watermark'),
  ('watermark_opacity', '0.15', 'Watermark opacity', 'watermark'),
  ('watermark_position', 'center', 'Watermark position', 'watermark'),

  -- Footer
  ('footer_text', 'This is a computer-generated report.', 'Report footer text', 'report_style');

-- Insert sample test catalog with calculated fields
INSERT INTO test_catalog (code, name, department, price, analytes) VALUES
  ('CBC', 'Complete Blood Count', 'Hematology', 300, '[
    {"name": "Hemoglobin", "unit": "g/dL", "reference_range": "12-16", "gender_specific": {"male": "13-17", "female": "12-15"}},
    {"name": "WBC", "unit": "x10^3/uL", "reference_range": "4-11"},
    {"name": "RBC", "unit": "x10^6/uL", "reference_range": "4.5-5.5"},
    {"name": "Platelets", "unit": "x10^3/uL", "reference_range": "150-400"},
    {"name": "Hematocrit", "unit": "%", "reference_range": "36-48"},
    {"name": "MCV", "unit": "fL", "reference_range": "80-100", "is_calculated": true, "formula": "Hematocrit/RBC*10"},
    {"name": "MCH", "unit": "pg", "reference_range": "27-33", "is_calculated": true, "formula": "Hemoglobin/RBC*10"},
    {"name": "MCHC", "unit": "g/dL", "reference_range": "32-36", "is_calculated": true, "formula": "Hemoglobin/Hematocrit*100"}
  ]'::jsonb),
  ('LFT', 'Liver Function Test', 'Biochemistry', 500, '[
    {"name": "Bilirubin Total", "unit": "mg/dL", "reference_range": "0.1-1.2"},
    {"name": "Bilirubin Direct", "unit": "mg/dL", "reference_range": "0-0.3"},
    {"name": "Bilirubin Indirect", "unit": "mg/dL", "reference_range": "0.1-0.9", "is_calculated": true, "formula": "Bilirubin Total - Bilirubin Direct"},
    {"name": "SGOT/AST", "unit": "U/L", "reference_range": "10-40"},
    {"name": "SGPT/ALT", "unit": "U/L", "reference_range": "7-56"},
    {"name": "Alkaline Phosphatase", "unit": "U/L", "reference_range": "44-147"},
    {"name": "Total Protein", "unit": "g/dL", "reference_range": "6-8"},
    {"name": "Albumin", "unit": "g/dL", "reference_range": "3.5-5"},
    {"name": "Globulin", "unit": "g/dL", "reference_range": "2-3.5", "is_calculated": true, "formula": "Total Protein - Albumin"},
    {"name": "A/G Ratio", "unit": "", "reference_range": "1-2", "is_calculated": true, "formula": "Albumin / Globulin"}
  ]'::jsonb),
  ('KFT', 'Kidney Function Test', 'Biochemistry', 400, '[
    {"name": "Urea", "unit": "mg/dL", "reference_range": "15-40"},
    {"name": "Creatinine", "unit": "mg/dL", "reference_range": "0.7-1.3"},
    {"name": "Uric Acid", "unit": "mg/dL", "reference_range": "3.5-7.2"},
    {"name": "BUN", "unit": "mg/dL", "reference_range": "7-20", "is_calculated": true, "formula": "Urea * 0.467"}
  ]'::jsonb),
  ('LIPID', 'Lipid Profile', 'Biochemistry', 450, '[
    {"name": "Total Cholesterol", "unit": "mg/dL", "reference_range": "< 200"},
    {"name": "Triglycerides", "unit": "mg/dL", "reference_range": "< 150"},
    {"name": "HDL Cholesterol", "unit": "mg/dL", "reference_range": "> 40"},
    {"name": "LDL Cholesterol", "unit": "mg/dL", "reference_range": "< 100", "is_calculated": true, "formula": "Total Cholesterol - HDL - Triglycerides/5"},
    {"name": "VLDL Cholesterol", "unit": "mg/dL", "reference_range": "< 30", "is_calculated": true, "formula": "Triglycerides / 5"},
    {"name": "TC/HDL Ratio", "unit": "", "reference_range": "< 4.5", "is_calculated": true, "formula": "Total Cholesterol / HDL"}
  ]'::jsonb),
  ('TSH', 'Thyroid Stimulating Hormone', 'Immunology', 350, '[
    {"name": "TSH", "unit": "mIU/L", "reference_range": "0.4-4.0"}
  ]'::jsonb),
  ('HBA1C', 'Glycated Hemoglobin', 'Biochemistry', 400, '[
    {"name": "HbA1c", "unit": "%", "reference_range": "< 5.7"},
    {"name": "Estimated Avg Glucose", "unit": "mg/dL", "reference_range": "", "is_calculated": true, "formula": "HbA1c * 28.7 - 46.7"}
  ]'::jsonb),
  ('FBS', 'Fasting Blood Sugar', 'Biochemistry', 100, '[
    {"name": "Glucose (Fasting)", "unit": "mg/dL", "reference_range": "70-100"}
  ]'::jsonb);

-- Row Level Security (RLS)
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE results ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE branding_assets ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users (single-lab setup)
CREATE POLICY "Allow all for authenticated users" ON patients FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Allow all for authenticated users" ON orders FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Allow all for authenticated users" ON order_tests FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Allow all for authenticated users" ON results FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Allow all for authenticated users" ON test_catalog FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Allow all for authenticated users" ON settings FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Allow all for authenticated users" ON branding_assets FOR ALL USING (auth.role() = 'authenticated');

-- Auto-update timestamps
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
