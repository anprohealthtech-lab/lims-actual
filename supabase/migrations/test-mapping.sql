-- LIMS Bridge - Test Mapping & Order Queue Tables
-- Run this migration in your Supabase SQL editor

-- ============================================
-- TEST MAPPINGS TABLE
-- Maps LIMS test codes to analyzer-specific codes
-- ============================================
CREATE TABLE IF NOT EXISTS test_mappings (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    lab_id UUID NOT NULL REFERENCES labs(id),
    analyzer_id TEXT NOT NULL DEFAULT 'default',    -- Identifier for the analyzer type
    lims_code TEXT NOT NULL,                        -- Your LIMS code (e.g., 'CBC', 'WBC')
    analyzer_code TEXT NOT NULL,                    -- Analyzer's code (e.g., '5001', 'WBC1')
    loinc_code TEXT,                                -- Optional LOINC for standardization
    test_name TEXT NOT NULL,                        -- Human-readable name
    ai_confidence FLOAT,                            -- 0-1 confidence from AI mapping
    verified BOOLEAN DEFAULT FALSE,                 -- Human-verified flag
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Unique constraint for upserts
    UNIQUE(lab_id, analyzer_id, lims_code)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_test_mappings_lookup 
ON test_mappings(lab_id, analyzer_id, lims_code);

-- ============================================
-- PENDING ORDERS TABLE
-- Orders queued for AI mapping before sending to analyzer
-- ============================================
CREATE TABLE IF NOT EXISTS pending_orders (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    lab_id UUID NOT NULL REFERENCES labs(id),
    sample_barcode TEXT NOT NULL,
    patient_id TEXT,
    patient_name TEXT,
    date_of_birth TEXT,
    gender TEXT,
    requested_tests TEXT[] NOT NULL,                -- LIMS codes requested
    resolved_tests JSONB,                           -- AI-mapped codes: [{lims_code, analyzer_code, confidence}]
    target_analyzer TEXT DEFAULT 'default',
    status TEXT DEFAULT 'pending_mapping',          -- pending_mapping, mapped, sent, acknowledged, error
    ai_status TEXT DEFAULT 'pending',               -- pending, processing, completed, error
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    sent_at TIMESTAMPTZ,
    
    -- Index for processing queue
    CONSTRAINT valid_status CHECK (status IN ('pending_mapping', 'mapped', 'sent', 'acknowledged', 'error')),
    CONSTRAINT valid_ai_status CHECK (ai_status IN ('pending', 'processing', 'completed', 'error'))
);

-- Index for queue processing
CREATE INDEX IF NOT EXISTS idx_pending_orders_queue 
ON pending_orders(lab_id, status, ai_status);

-- ============================================
-- ANALYZER PROFILES TABLE (Optional)
-- Store configuration for different analyzer types
-- ============================================
CREATE TABLE IF NOT EXISTS analyzer_profiles (
    id TEXT PRIMARY KEY,                            -- e.g., 'sysmex-xn1000', 'beckman-au680'
    name TEXT NOT NULL,
    manufacturer TEXT,
    protocol TEXT DEFAULT 'HL7',                    -- HL7, ASTM, LIS2A
    test_code_format TEXT,                          -- numeric, alphanumeric, proprietary
    supported_tests TEXT[],                         -- List of test codes
    connection_settings JSONB,                      -- Baud rate, parity, etc.
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================
ALTER TABLE test_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_orders ENABLE ROW LEVEL SECURITY;

-- Policy: Labs can only see their own mappings
CREATE POLICY "Labs can manage own mappings" ON test_mappings
    FOR ALL USING (lab_id = auth.uid()::uuid OR auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Labs can manage own orders" ON pending_orders
    FOR ALL USING (lab_id = auth.uid()::uuid OR auth.jwt() ->> 'role' = 'service_role');

-- ============================================
-- SAMPLE DATA (Common test mappings)
-- Uncomment and customize for your analyzers
-- ============================================
/*
INSERT INTO test_mappings (lab_id, analyzer_id, lims_code, analyzer_code, test_name, verified) VALUES
    ('your-lab-uuid', 'sysmex-xn1000', 'CBC', 'CBC', 'Complete Blood Count', true),
    ('your-lab-uuid', 'sysmex-xn1000', 'WBC', 'WBC', 'White Blood Cell Count', true),
    ('your-lab-uuid', 'sysmex-xn1000', 'RBC', 'RBC', 'Red Blood Cell Count', true),
    ('your-lab-uuid', 'sysmex-xn1000', 'HGB', 'HGB', 'Hemoglobin', true),
    ('your-lab-uuid', 'sysmex-xn1000', 'PLT', 'PLT', 'Platelet Count', true);
*/

-- ============================================
-- TRIGGER: Auto-update updated_at
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER test_mappings_updated_at
    BEFORE UPDATE ON test_mappings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
