-- LIMS Mini - Multi-Tenant Schema
-- Run this INSTEAD of schema.sql for multi-tenant setup
-- Each lab is isolated with lab_id based RLS

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Labs table (tenants)
CREATE TABLE labs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  address TEXT,
  phone TEXT,
  email TEXT,
  license_number TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Users with lab association
CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  lab_id UUID REFERENCES labs(id) NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT DEFAULT 'technician', -- 'lab_admin', 'technician', 'pathologist'
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_lab ON users(lab_id);

-- Patients table (tenant isolated)
CREATE TABLE patients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lab_id UUID REFERENCES labs(id) NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  gender TEXT,
  dob DATE,
  address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_patients_lab ON patients(lab_id);
CREATE INDEX idx_patients_phone ON patients(phone);

-- Test catalog (tenant isolated)
CREATE TABLE test_catalog (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lab_id UUID REFERENCES labs(id) NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  department TEXT,
  sample_type TEXT,
  price DECIMAL(10,2) DEFAULT 0,
  analytes JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(lab_id, code)
);

CREATE INDEX idx_test_catalog_lab ON test_catalog(lab_id);

-- Orders table (tenant isolated)
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lab_id UUID REFERENCES labs(id) NOT NULL,
  order_number TEXT NOT NULL,
  barcode TEXT,
  patient_id UUID REFERENCES patients(id),
  doctor_name TEXT,
  priority TEXT DEFAULT 'Normal',
  status TEXT DEFAULT 'registered',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(lab_id, order_number)
);

CREATE INDEX idx_orders_lab ON orders(lab_id);
CREATE INDEX idx_orders_number ON orders(order_number);
CREATE INDEX idx_orders_status ON orders(status);

-- Order tests (tenant isolated)
CREATE TABLE order_tests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lab_id UUID REFERENCES labs(id) NOT NULL,
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  test_id UUID REFERENCES test_catalog(id),
  test_code TEXT,
  test_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_order_tests_lab ON order_tests(lab_id);
CREATE INDEX idx_order_tests_order ON order_tests(order_id);

-- Results table (tenant isolated)
CREATE TABLE results (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lab_id UUID REFERENCES labs(id) NOT NULL,
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
  entered_by UUID REFERENCES users(id),
  entered_at TIMESTAMPTZ DEFAULT NOW(),
  verified_by UUID REFERENCES users(id),
  verified_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_results_lab ON results(lab_id);
CREATE INDEX idx_results_order ON results(order_id);
CREATE INDEX idx_results_verification ON results(verification_status);

-- Settings table (tenant isolated)
CREATE TABLE settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lab_id UUID REFERENCES labs(id) NOT NULL,
  key TEXT NOT NULL,
  value TEXT,
  value_json JSONB,
  description TEXT,
  category TEXT DEFAULT 'general',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(lab_id, key)
);

CREATE INDEX idx_settings_lab ON settings(lab_id);

-- Branding assets (tenant isolated)
CREATE TABLE branding_assets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lab_id UUID REFERENCES labs(id) NOT NULL,
  asset_type TEXT NOT NULL,
  asset_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_type TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  is_default BOOLEAN DEFAULT FALSE,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_branding_lab ON branding_assets(lab_id);

-- ============================================
-- HELPER FUNCTION: Get current user's lab_id
-- ============================================
CREATE OR REPLACE FUNCTION get_user_lab_id()
RETURNS UUID AS $$
  SELECT lab_id FROM users WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ============================================
-- ROW LEVEL SECURITY (Tenant Isolation)
-- ============================================
ALTER TABLE labs ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE results ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE branding_assets ENABLE ROW LEVEL SECURITY;

-- Labs: users can only see their own lab
CREATE POLICY "Users can view own lab" ON labs
  FOR SELECT USING (id = get_user_lab_id());

-- Users: users can only see users in their lab
CREATE POLICY "Users can view lab members" ON users
  FOR SELECT USING (lab_id = get_user_lab_id());

-- Lab admins can manage users
CREATE POLICY "Lab admins can manage users" ON users
  FOR ALL USING (
    lab_id = get_user_lab_id()
    AND EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'lab_admin')
  );

-- All other tables: tenant isolation by lab_id
CREATE POLICY "Tenant isolation" ON patients
  FOR ALL USING (lab_id = get_user_lab_id());

CREATE POLICY "Tenant isolation" ON orders
  FOR ALL USING (lab_id = get_user_lab_id());

CREATE POLICY "Tenant isolation" ON order_tests
  FOR ALL USING (lab_id = get_user_lab_id());

CREATE POLICY "Tenant isolation" ON results
  FOR ALL USING (lab_id = get_user_lab_id());

CREATE POLICY "Tenant isolation" ON test_catalog
  FOR ALL USING (lab_id = get_user_lab_id());

CREATE POLICY "Tenant isolation" ON settings
  FOR ALL USING (lab_id = get_user_lab_id());

CREATE POLICY "Tenant isolation" ON branding_assets
  FOR ALL USING (lab_id = get_user_lab_id());

-- ============================================
-- AUTO-FILL lab_id ON INSERT
-- ============================================
CREATE OR REPLACE FUNCTION auto_set_lab_id()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.lab_id IS NULL THEN
    NEW.lab_id := get_user_lab_id();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER auto_lab_id_patients BEFORE INSERT ON patients FOR EACH ROW EXECUTE FUNCTION auto_set_lab_id();
CREATE TRIGGER auto_lab_id_orders BEFORE INSERT ON orders FOR EACH ROW EXECUTE FUNCTION auto_set_lab_id();
CREATE TRIGGER auto_lab_id_order_tests BEFORE INSERT ON order_tests FOR EACH ROW EXECUTE FUNCTION auto_set_lab_id();
CREATE TRIGGER auto_lab_id_results BEFORE INSERT ON results FOR EACH ROW EXECUTE FUNCTION auto_set_lab_id();
CREATE TRIGGER auto_lab_id_test_catalog BEFORE INSERT ON test_catalog FOR EACH ROW EXECUTE FUNCTION auto_set_lab_id();
CREATE TRIGGER auto_lab_id_settings BEFORE INSERT ON settings FOR EACH ROW EXECUTE FUNCTION auto_set_lab_id();
CREATE TRIGGER auto_lab_id_branding BEFORE INSERT ON branding_assets FOR EACH ROW EXECUTE FUNCTION auto_set_lab_id();

-- ============================================
-- AUTO-UPDATE timestamps
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_labs_updated_at BEFORE UPDATE ON labs FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_patients_updated_at BEFORE UPDATE ON patients FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_orders_updated_at BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_settings_updated_at BEFORE UPDATE ON settings FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- SEED DATA FUNCTION (call after creating a lab)
-- ============================================
CREATE OR REPLACE FUNCTION seed_lab_defaults(p_lab_id UUID)
RETURNS void AS $$
BEGIN
  -- Default settings
  INSERT INTO settings (lab_id, key, value, description, category) VALUES
    (p_lab_id, 'lab_name', 'Diagnostic Laboratory', 'Laboratory name', 'lab_info'),
    (p_lab_id, 'lab_address', '', 'Laboratory address', 'lab_info'),
    (p_lab_id, 'lab_phone', '', 'Contact phone', 'lab_info'),
    (p_lab_id, 'lab_email', '', 'Contact email', 'lab_info'),
    (p_lab_id, 'base_font_size', '12', 'Base font size', 'report_style'),
    (p_lab_id, 'flag_colors_enabled', 'true', 'Enable colored flags', 'report_style'),
    (p_lab_id, 'flag_color_high', '#dc2626', 'HIGH color', 'report_style'),
    (p_lab_id, 'flag_color_low', '#ea580c', 'LOW color', 'report_style'),
    (p_lab_id, 'flag_color_normal', '#16a34a', 'NORMAL color', 'report_style'),
    (p_lab_id, 'bold_abnormal_values', 'true', 'Bold abnormal', 'report_style'),
    (p_lab_id, 'signature_enabled', 'true', 'Enable signatures', 'signature'),
    (p_lab_id, 'signature_count', '2', 'Signature slots', 'signature'),
    (p_lab_id, 'signature_1_name', 'Lab Technician', 'First signature', 'signature'),
    (p_lab_id, 'signature_2_name', 'Pathologist', 'Second signature', 'signature'),
    (p_lab_id, 'footer_text', 'This is a computer-generated report.', 'Footer', 'report_style');

  -- Default test catalog
  INSERT INTO test_catalog (lab_id, code, name, department, price, analytes) VALUES
    (p_lab_id, 'CBC', 'Complete Blood Count', 'Hematology', 300, '[
      {"name": "Hemoglobin", "unit": "g/dL", "reference_range": "12-16"},
      {"name": "WBC", "unit": "x10^3/uL", "reference_range": "4-11"},
      {"name": "RBC", "unit": "x10^6/uL", "reference_range": "4.5-5.5"},
      {"name": "Platelets", "unit": "x10^3/uL", "reference_range": "150-400"},
      {"name": "Hematocrit", "unit": "%", "reference_range": "36-48"},
      {"name": "MCV", "unit": "fL", "reference_range": "80-100", "is_calculated": true, "formula": "Hematocrit/RBC*10"},
      {"name": "MCH", "unit": "pg", "reference_range": "27-33", "is_calculated": true, "formula": "Hemoglobin/RBC*10"}
    ]'::jsonb),
    (p_lab_id, 'LFT', 'Liver Function Test', 'Biochemistry', 500, '[
      {"name": "Bilirubin Total", "unit": "mg/dL", "reference_range": "0.1-1.2"},
      {"name": "SGOT/AST", "unit": "U/L", "reference_range": "10-40"},
      {"name": "SGPT/ALT", "unit": "U/L", "reference_range": "7-56"},
      {"name": "Total Protein", "unit": "g/dL", "reference_range": "6-8"},
      {"name": "Albumin", "unit": "g/dL", "reference_range": "3.5-5"},
      {"name": "Globulin", "unit": "g/dL", "reference_range": "2-3.5", "is_calculated": true, "formula": "Total Protein - Albumin"}
    ]'::jsonb),
    (p_lab_id, 'KFT', 'Kidney Function Test', 'Biochemistry', 400, '[
      {"name": "Urea", "unit": "mg/dL", "reference_range": "15-40"},
      {"name": "Creatinine", "unit": "mg/dL", "reference_range": "0.7-1.3"},
      {"name": "Uric Acid", "unit": "mg/dL", "reference_range": "3.5-7.2"}
    ]'::jsonb),
    (p_lab_id, 'LIPID', 'Lipid Profile', 'Biochemistry', 450, '[
      {"name": "Total Cholesterol", "unit": "mg/dL", "reference_range": "< 200"},
      {"name": "Triglycerides", "unit": "mg/dL", "reference_range": "< 150"},
      {"name": "HDL Cholesterol", "unit": "mg/dL", "reference_range": "> 40"},
      {"name": "LDL Cholesterol", "unit": "mg/dL", "reference_range": "< 100", "is_calculated": true, "formula": "Total Cholesterol - HDL - Triglycerides/5"}
    ]'::jsonb);
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- CREATE LAB + ADMIN USER FUNCTION
-- ============================================
CREATE OR REPLACE FUNCTION create_lab_with_admin(
  p_lab_name TEXT,
  p_lab_slug TEXT,
  p_admin_user_id UUID,
  p_admin_name TEXT,
  p_admin_email TEXT
)
RETURNS UUID AS $$
DECLARE
  v_lab_id UUID;
BEGIN
  -- Create lab
  INSERT INTO labs (name, slug) VALUES (p_lab_name, p_lab_slug) RETURNING id INTO v_lab_id;

  -- Create admin user
  INSERT INTO users (id, lab_id, name, email, role)
  VALUES (p_admin_user_id, v_lab_id, p_admin_name, p_admin_email, 'lab_admin');

  -- Seed defaults
  PERFORM seed_lab_defaults(v_lab_id);

  RETURN v_lab_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
