-- Migration: Packages, Report Sections, and Calculated Parameters
-- Date: 2025-12-15
-- Features: 
--   1. Package integration into orders/invoices
--   2. Pre-defined report sections for manual entry (PBS, Radiology)
--   3. Calculated parameters with formula support

-- ============================================
-- PART 1: PACKAGE INTEGRATION
-- ============================================

-- Track which package originated an order_test
ALTER TABLE order_tests 
ADD COLUMN IF NOT EXISTS source_package_id uuid REFERENCES packages(id);

-- Link invoice items to packages for reporting
ALTER TABLE invoice_items 
ADD COLUMN IF NOT EXISTS package_id uuid REFERENCES packages(id);

-- Ensure packages table has lab_id (already exists but make it NOT NULL for new records)
-- Note: Existing records with NULL lab_id should be migrated manually

-- ============================================
-- PART 2: EDITABLE REPORT SECTIONS
-- ============================================

-- Section definitions (admin-configured per template)
CREATE TABLE IF NOT EXISTS lab_template_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_id uuid NOT NULL REFERENCES labs(id) ON DELETE CASCADE,
  template_id uuid REFERENCES lab_templates(id) ON DELETE SET NULL,
  test_group_id uuid REFERENCES test_groups(id) ON DELETE SET NULL,
  section_type text NOT NULL CHECK (section_type IN ('findings', 'impression', 'recommendation', 'technique', 'clinical_history', 'conclusion', 'custom')),
  section_name text NOT NULL,
  display_order integer NOT NULL DEFAULT 0,
  default_content text,
  predefined_options jsonb DEFAULT '[]'::jsonb, -- ["No abnormality detected", "Mild hepatomegaly noted", ...]
  is_required boolean DEFAULT false,
  is_editable boolean DEFAULT true,
  placeholder_key text, -- 'findings' -> {{section:findings}}
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES users(id),
  
  CONSTRAINT unique_section_per_template UNIQUE (template_id, section_name),
  CONSTRAINT unique_section_per_test_group UNIQUE (test_group_id, section_name)
);

-- Doctor-filled content (per result instance) - final_content is immutable after verification
CREATE TABLE IF NOT EXISTS result_section_content (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  result_id uuid NOT NULL REFERENCES results(id) ON DELETE CASCADE,
  section_id uuid NOT NULL REFERENCES lab_template_sections(id) ON DELETE RESTRICT,
  selected_options jsonb DEFAULT '[]'::jsonb, -- Indices or values of chosen predefined sentences
  custom_text text, -- Free-text additions
  final_content text NOT NULL, -- Merged output for PDF (IMMUTABLE after verification)
  is_finalized boolean DEFAULT false, -- Set to true after verification, prevents edits
  edited_by uuid REFERENCES users(id),
  edited_at timestamptz DEFAULT now(),
  finalized_at timestamptz,
  finalized_by uuid REFERENCES users(id),
  
  CONSTRAINT unique_section_per_result UNIQUE (result_id, section_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_template_sections_lab ON lab_template_sections(lab_id);
CREATE INDEX IF NOT EXISTS idx_template_sections_template ON lab_template_sections(template_id);
CREATE INDEX IF NOT EXISTS idx_template_sections_test_group ON lab_template_sections(test_group_id);
CREATE INDEX IF NOT EXISTS idx_result_section_content_result ON result_section_content(result_id);

-- RLS Policies for lab_template_sections
ALTER TABLE lab_template_sections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view sections for their lab" ON lab_template_sections
  FOR SELECT TO authenticated
  USING (lab_id IN (SELECT lab_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Users can manage sections for their lab" ON lab_template_sections
  FOR ALL TO authenticated
  USING (lab_id IN (SELECT lab_id FROM users WHERE id = auth.uid()));

-- RLS Policies for result_section_content
ALTER TABLE result_section_content ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view section content for their lab" ON result_section_content
  FOR SELECT TO authenticated
  USING (result_id IN (
    SELECT r.id FROM results r 
    WHERE r.lab_id IN (SELECT lab_id FROM users WHERE id = auth.uid())
  ));

CREATE POLICY "Users can manage section content for their lab" ON result_section_content
  FOR ALL TO authenticated
  USING (result_id IN (
    SELECT r.id FROM results r 
    WHERE r.lab_id IN (SELECT lab_id FROM users WHERE id = auth.uid())
  ));

-- Prevent editing finalized section content
CREATE OR REPLACE FUNCTION prevent_finalized_section_edit()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.is_finalized = true AND NEW.final_content != OLD.final_content THEN
    RAISE EXCEPTION 'Cannot modify final_content after section is finalized';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_finalized_section_edit
  BEFORE UPDATE ON result_section_content
  FOR EACH ROW
  EXECUTE FUNCTION prevent_finalized_section_edit();

-- ============================================
-- PART 3: CALCULATED PARAMETERS
-- ============================================

-- Add calculation fields to analytes
ALTER TABLE analytes 
ADD COLUMN IF NOT EXISTS is_calculated boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS formula text, -- 'TC - HDL - (TG / 5)'
ADD COLUMN IF NOT EXISTS formula_variables jsonb DEFAULT '[]'::jsonb, -- ['TC', 'HDL', 'TG']
ADD COLUMN IF NOT EXISTS formula_description text; -- Human-readable description of the formula

-- Dependency tracking (which analytes feed into calculated analytes)
CREATE TABLE IF NOT EXISTS analyte_dependencies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  calculated_analyte_id uuid NOT NULL REFERENCES analytes(id) ON DELETE CASCADE,
  source_analyte_id uuid NOT NULL REFERENCES analytes(id) ON DELETE RESTRICT,
  variable_name text NOT NULL, -- 'TC', 'HDL', 'TG' - used in formula
  created_at timestamptz DEFAULT now(),
  
  CONSTRAINT unique_dependency UNIQUE (calculated_analyte_id, source_analyte_id),
  CONSTRAINT no_self_reference CHECK (calculated_analyte_id != source_analyte_id)
);

-- Index for dependency lookups
CREATE INDEX IF NOT EXISTS idx_analyte_deps_calculated ON analyte_dependencies(calculated_analyte_id);
CREATE INDEX IF NOT EXISTS idx_analyte_deps_source ON analyte_dependencies(source_analyte_id);

-- Add calculated tracking to result_values
ALTER TABLE result_values 
ADD COLUMN IF NOT EXISTS is_auto_calculated boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS calculation_inputs jsonb, -- {'TC': 200, 'HDL': 50, 'TG': 150}
ADD COLUMN IF NOT EXISTS calculated_at timestamptz;

-- Function to check for circular dependencies
CREATE OR REPLACE FUNCTION check_circular_dependency(
  p_calculated_analyte_id uuid,
  p_source_analyte_id uuid
) RETURNS boolean AS $$
DECLARE
  v_has_cycle boolean := false;
  v_visited uuid[] := ARRAY[p_calculated_analyte_id];
  v_current uuid;
  v_queue uuid[] := ARRAY[p_source_analyte_id];
BEGIN
  -- BFS to detect cycles
  WHILE array_length(v_queue, 1) > 0 LOOP
    v_current := v_queue[1];
    v_queue := v_queue[2:];
    
    -- Check if we've circled back to the calculated analyte
    IF v_current = p_calculated_analyte_id THEN
      RETURN true;
    END IF;
    
    -- Check if already visited
    IF v_current = ANY(v_visited) THEN
      CONTINUE;
    END IF;
    
    v_visited := array_append(v_visited, v_current);
    
    -- Add all analytes that this analyte depends on (if it's calculated)
    SELECT array_agg(ad.source_analyte_id) INTO v_queue
    FROM analyte_dependencies ad
    WHERE ad.calculated_analyte_id = v_current
    AND ad.source_analyte_id != ALL(v_visited);
    
    IF v_queue IS NULL THEN
      v_queue := ARRAY[]::uuid[];
    END IF;
  END LOOP;
  
  RETURN false;
END;
$$ LANGUAGE plpgsql;

-- Trigger to prevent circular dependencies
CREATE OR REPLACE FUNCTION prevent_circular_dependency()
RETURNS TRIGGER AS $$
BEGIN
  IF check_circular_dependency(NEW.calculated_analyte_id, NEW.source_analyte_id) THEN
    RAISE EXCEPTION 'Circular dependency detected: analyte % would create a cycle', 
      (SELECT name FROM analytes WHERE id = NEW.source_analyte_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_circular_dependency
  BEFORE INSERT OR UPDATE ON analyte_dependencies
  FOR EACH ROW
  EXECUTE FUNCTION prevent_circular_dependency();

-- ============================================
-- PART 4: TEST GROUP ANALYTE CONFIGURATION
-- ============================================

-- Enhance test_group_analytes with configuration options
ALTER TABLE test_group_analytes 
ADD COLUMN IF NOT EXISTS display_order integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS is_visible boolean DEFAULT true,
ADD COLUMN IF NOT EXISTS attachment_required boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS custom_reference_range text,
ADD COLUMN IF NOT EXISTS is_header boolean DEFAULT false, -- For grouping display
ADD COLUMN IF NOT EXISTS header_name text;

-- Index for ordering
CREATE INDEX IF NOT EXISTS idx_test_group_analytes_order ON test_group_analytes(test_group_id, display_order);

-- ============================================
-- PART 5: HELPER VIEWS
-- ============================================

-- View to get calculated analytes with their dependencies
CREATE OR REPLACE VIEW v_calculated_analytes AS
SELECT 
  a.id,
  a.name,
  a.formula,
  a.formula_description,
  a.category,
  json_agg(json_build_object(
    'source_id', ad.source_analyte_id,
    'source_name', sa.name,
    'variable_name', ad.variable_name
  )) as dependencies
FROM analytes a
LEFT JOIN analyte_dependencies ad ON a.id = ad.calculated_analyte_id
LEFT JOIN analytes sa ON ad.source_analyte_id = sa.id
WHERE a.is_calculated = true
GROUP BY a.id, a.name, a.formula, a.formula_description, a.category;

-- View to get template sections with test group info
CREATE OR REPLACE VIEW v_template_sections AS
SELECT 
  lts.*,
  lt.template_name,
  tg.name as test_group_name
FROM lab_template_sections lts
LEFT JOIN lab_templates lt ON lts.template_id = lt.id
LEFT JOIN test_groups tg ON lts.test_group_id = tg.id;

-- ============================================
-- COMMENTS
-- ============================================

COMMENT ON TABLE lab_template_sections IS 'Pre-defined report sections for manual entry (PBS findings, Radiology impressions, etc.)';
COMMENT ON TABLE result_section_content IS 'Doctor-filled content for report sections. final_content is immutable after finalization.';
COMMENT ON TABLE analyte_dependencies IS 'Tracks which analytes are used in calculated parameter formulas';
COMMENT ON COLUMN analytes.formula IS 'Mathematical formula using variable names from formula_variables. Evaluated with mathjs.';
COMMENT ON COLUMN result_values.is_auto_calculated IS 'True if this value was computed from a formula, not entered manually';
COMMENT ON FUNCTION check_circular_dependency IS 'Prevents circular dependencies in analyte calculations (A->B->C->A)';
