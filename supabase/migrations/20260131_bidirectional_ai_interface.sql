-- ============================================================================
-- LIMS v2 - Bi-Directional AI Machine Interface Schema
-- ============================================================================
-- Enhances existing schema for bi-directional analyzer communication
-- Version: 2.0 - Unified Bi-Directional Interface
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. ANALYZER PROFILES - Add missing columns to existing table
-- Existing: id, name, manufacturer, protocol, test_code_format, supported_tests, connection_settings, created_at, updated_at
-- ============================================================================

DO $$
BEGIN
    -- model column (not in existing schema)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'analyzer_profiles' AND column_name = 'model') THEN
        ALTER TABLE public.analyzer_profiles ADD COLUMN model TEXT;
    END IF;
    
    -- protocol_version
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'analyzer_profiles' AND column_name = 'protocol_version') THEN
        ALTER TABLE public.analyzer_profiles ADD COLUMN protocol_version TEXT;
    END IF;
    
    -- message_encoding
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'analyzer_profiles' AND column_name = 'message_encoding') THEN
        ALTER TABLE public.analyzer_profiles ADD COLUMN message_encoding TEXT DEFAULT 'UTF-8';
    END IF;
    
    -- field_delimiter
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'analyzer_profiles' AND column_name = 'field_delimiter') THEN
        ALTER TABLE public.analyzer_profiles ADD COLUMN field_delimiter TEXT DEFAULT '|';
    END IF;
    
    -- component_delimiter
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'analyzer_profiles' AND column_name = 'component_delimiter') THEN
        ALTER TABLE public.analyzer_profiles ADD COLUMN component_delimiter TEXT DEFAULT '^';
    END IF;
    
    -- segment_terminator
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'analyzer_profiles' AND column_name = 'segment_terminator') THEN
        ALTER TABLE public.analyzer_profiles ADD COLUMN segment_terminator TEXT DEFAULT E'\r';
    END IF;
    
    -- ai_parsing_hints
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'analyzer_profiles' AND column_name = 'ai_parsing_hints') THEN
        ALTER TABLE public.analyzer_profiles ADD COLUMN ai_parsing_hints JSONB DEFAULT '{}'::jsonb;
    END IF;
    
    -- sample_messages
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'analyzer_profiles' AND column_name = 'sample_messages') THEN
        ALTER TABLE public.analyzer_profiles ADD COLUMN sample_messages JSONB DEFAULT '[]'::jsonb;
    END IF;
    
    -- is_active
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'analyzer_profiles' AND column_name = 'is_active') THEN
        ALTER TABLE public.analyzer_profiles ADD COLUMN is_active BOOLEAN DEFAULT true;
    END IF;
END $$;

-- Seed common analyzer profiles (use existing columns only: id, name, manufacturer, protocol, supported_tests)
INSERT INTO public.analyzer_profiles (id, name, manufacturer, protocol, supported_tests) VALUES
    ('sysmex-xn1000', 'Sysmex XN-1000 Hematology', 'Sysmex', 'HL7', ARRAY['CBC', 'WBC', 'RBC', 'HGB', 'HCT', 'PLT', 'MCV', 'MCH', 'MCHC', 'RDW']),
    ('beckman-au680', 'Beckman AU680 Chemistry', 'Beckman Coulter', 'HL7', ARRAY['GLU', 'BUN', 'CREA', 'UA', 'AST', 'ALT', 'ALP', 'BIL', 'TP', 'ALB']),
    ('roche-cobas6000', 'Roche Cobas 6000', 'Roche', 'ASTM', ARRAY['GLU', 'HBA1C', 'LIP', 'AMY', 'CK', 'LDH']),
    ('bio-rad-d10', 'Bio-Rad D-10 HbA1c', 'Bio-Rad', 'ASTM', ARRAY['HBA1C', 'HBA1', 'HBF', 'HBA2']),
    ('generic-hl7', 'Generic HL7 Compatible Analyzer', 'Generic', 'HL7', NULL)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    manufacturer = EXCLUDED.manufacturer,
    protocol = EXCLUDED.protocol,
    supported_tests = COALESCE(EXCLUDED.supported_tests, analyzer_profiles.supported_tests);

-- Update model column for seeded profiles (since it was just added)
UPDATE public.analyzer_profiles SET model = 'XN-1000' WHERE id = 'sysmex-xn1000' AND model IS NULL;
UPDATE public.analyzer_profiles SET model = 'AU680' WHERE id = 'beckman-au680' AND model IS NULL;
UPDATE public.analyzer_profiles SET model = 'Cobas 6000' WHERE id = 'roche-cobas6000' AND model IS NULL;
UPDATE public.analyzer_profiles SET model = 'D-10' WHERE id = 'bio-rad-d10' AND model IS NULL;
UPDATE public.analyzer_profiles SET model = 'HL7 Analyzer' WHERE id = 'generic-hl7' AND model IS NULL;

-- ============================================================================
-- 2. ANALYZER CONNECTIONS - Add profile link columns
-- Existing: id, lab_id, name, connection_type, config, status, created_at, updated_at
-- ============================================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'analyzer_connections' AND column_name = 'profile_id') THEN
        ALTER TABLE public.analyzer_connections ADD COLUMN profile_id TEXT REFERENCES public.analyzer_profiles(id);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'analyzer_connections' AND column_name = 'host_mode') THEN
        ALTER TABLE public.analyzer_connections ADD COLUMN host_mode TEXT DEFAULT 'server';
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'analyzer_connections' AND column_name = 'auto_reconnect') THEN
        ALTER TABLE public.analyzer_connections ADD COLUMN auto_reconnect BOOLEAN DEFAULT true;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'analyzer_connections' AND column_name = 'health_check_interval_sec') THEN
        ALTER TABLE public.analyzer_connections ADD COLUMN health_check_interval_sec INTEGER DEFAULT 60;
    END IF;
END $$;

-- ============================================================================
-- 3. TEST MAPPINGS - Add missing columns to existing table
-- Existing: id, lab_id, analyzer_id, lims_code, analyzer_code, loinc_code, test_name, ai_confidence, verified, created_at, updated_at
-- Note: Uses 'analyzer_id' (text) NOT 'analyzer_profile_id' - we'll add the new column as FK
-- ============================================================================

DO $$
BEGIN
    -- analyzer_profile_id (FK to analyzer_profiles)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'test_mappings' AND column_name = 'analyzer_profile_id') THEN
        ALTER TABLE public.test_mappings ADD COLUMN analyzer_profile_id TEXT REFERENCES public.analyzer_profiles(id);
    END IF;
    
    -- analyzer_connection_id (FK to analyzer_connections)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'test_mappings' AND column_name = 'analyzer_connection_id') THEN
        ALTER TABLE public.test_mappings ADD COLUMN analyzer_connection_id UUID REFERENCES public.analyzer_connections(id);
    END IF;
    
    -- analyte_id (FK to analytes)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'test_mappings' AND column_name = 'analyte_id') THEN
        ALTER TABLE public.test_mappings ADD COLUMN analyte_id UUID REFERENCES public.analytes(id);
    END IF;
    
    -- test_group_id (FK to test_groups)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'test_mappings' AND column_name = 'test_group_id') THEN
        ALTER TABLE public.test_mappings ADD COLUMN test_group_id UUID REFERENCES public.test_groups(id);
    END IF;
    
    -- ucum_unit
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'test_mappings' AND column_name = 'ucum_unit') THEN
        ALTER TABLE public.test_mappings ADD COLUMN ucum_unit TEXT;
    END IF;
    
    -- ai_source
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'test_mappings' AND column_name = 'ai_source') THEN
        ALTER TABLE public.test_mappings ADD COLUMN ai_source TEXT;
    END IF;
    
    -- usage_count
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'test_mappings' AND column_name = 'usage_count') THEN
        ALTER TABLE public.test_mappings ADD COLUMN usage_count INTEGER DEFAULT 0;
    END IF;
    
    -- last_used_at
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'test_mappings' AND column_name = 'last_used_at') THEN
        ALTER TABLE public.test_mappings ADD COLUMN last_used_at TIMESTAMPTZ;
    END IF;
    
    -- verified_by
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'test_mappings' AND column_name = 'verified_by') THEN
        ALTER TABLE public.test_mappings ADD COLUMN verified_by UUID REFERENCES public.users(id);
    END IF;
    
    -- verified_at
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'test_mappings' AND column_name = 'verified_at') THEN
        ALTER TABLE public.test_mappings ADD COLUMN verified_at TIMESTAMPTZ;
    END IF;
    
    -- supports_order_send
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'test_mappings' AND column_name = 'supports_order_send') THEN
        ALTER TABLE public.test_mappings ADD COLUMN supports_order_send BOOLEAN DEFAULT true;
    END IF;
    
    -- supports_result_receive
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'test_mappings' AND column_name = 'supports_result_receive') THEN
        ALTER TABLE public.test_mappings ADD COLUMN supports_result_receive BOOLEAN DEFAULT true;
    END IF;
END $$;

-- Create indexes if they don't exist
CREATE INDEX IF NOT EXISTS idx_test_mappings_profile ON public.test_mappings(lab_id, analyzer_profile_id, lims_code);
CREATE INDEX IF NOT EXISTS idx_test_mappings_analyzer ON public.test_mappings(lab_id, analyzer_id, analyzer_code);
CREATE INDEX IF NOT EXISTS idx_test_mappings_analyte ON public.test_mappings(analyte_id);

-- ============================================================================
-- 4. OUTBOUND ORDER QUEUE (Orders waiting to send to analyzers)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.analyzer_order_queue (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    lab_id UUID NOT NULL REFERENCES public.labs(id) ON DELETE CASCADE,
    analyzer_connection_id UUID REFERENCES public.analyzer_connections(id),
    
    -- Order Reference
    order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
    order_test_id UUID REFERENCES public.order_tests(id) ON DELETE SET NULL,
    sample_barcode TEXT NOT NULL,
    
    -- Patient Info (snapshot for HL7 message)
    patient_id UUID REFERENCES public.patients(id),
    patient_name TEXT,
    patient_dob DATE,
    patient_gender TEXT,
    
    -- Test Mapping
    requested_tests TEXT[] NOT NULL,                -- LIMS codes requested
    resolved_tests JSONB,                           -- AI-mapped codes: [{lims_code, analyzer_code, confidence}]
    
    -- Message Generation
    hl7_message TEXT,                               -- Generated HL7/ASTM message
    message_control_id TEXT,                        -- HL7 MSH-10 for ACK tracking
    
    -- Queue Status
    status TEXT DEFAULT 'pending' CHECK (status IN (
        'pending',           -- Awaiting AI mapping
        'mapped',            -- Tests mapped, ready to send
        'sending',           -- Being transmitted
        'sent',              -- Sent, awaiting ACK
        'acknowledged',      -- ACK received
        'rejected',          -- NAK or error
        'cancelled',         -- User cancelled
        'completed'          -- Results received
    )),
    
    -- AI Processing
    ai_status TEXT DEFAULT 'pending' CHECK (ai_status IN ('pending', 'processing', 'completed', 'error')),
    ai_mapping_log JSONB,                           -- AI mapping decisions
    
    -- Timing
    priority INTEGER DEFAULT 5,                     -- 1=STAT, 5=Routine, 9=Low
    created_at TIMESTAMPTZ DEFAULT now(),
    mapped_at TIMESTAMPTZ,
    sent_at TIMESTAMPTZ,
    ack_received_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    
    -- Error tracking
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    last_error TEXT,
    next_retry_at TIMESTAMPTZ
);

CREATE INDEX idx_order_queue_pending ON public.analyzer_order_queue(lab_id, status, priority) 
    WHERE status IN ('pending', 'mapped', 'sending');
CREATE INDEX idx_order_queue_barcode ON public.analyzer_order_queue(sample_barcode);
CREATE INDEX idx_order_queue_control_id ON public.analyzer_order_queue(message_control_id);

-- ============================================================================
-- 5. INBOUND MESSAGE PROCESSING (Enhanced analyzer_raw_messages)
-- ============================================================================

-- Add new columns to existing analyzer_raw_messages if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'analyzer_raw_messages' AND column_name = 'message_type'
    ) THEN
        ALTER TABLE public.analyzer_raw_messages 
        ADD COLUMN message_type TEXT,               -- ORM, ORU, ACK, NAK
        ADD COLUMN message_control_id TEXT,         -- For ACK correlation
        ADD COLUMN linked_queue_id UUID REFERENCES public.analyzer_order_queue(id),
        ADD COLUMN processing_time_ms INTEGER,
        ADD COLUMN retry_count INTEGER DEFAULT 0;
    END IF;
END $$;

-- Index for ACK correlation
CREATE INDEX IF NOT EXISTS idx_raw_messages_control_id ON public.analyzer_raw_messages(message_control_id);

-- ============================================================================
-- 6. AI MAPPING CACHE (Fast lookups without calling AI)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.ai_mapping_cache (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    lab_id UUID NOT NULL REFERENCES public.labs(id) ON DELETE CASCADE,
    
    -- Cache Key
    cache_key TEXT NOT NULL,                        -- Hash of input parameters
    cache_type TEXT NOT NULL,                       -- 'test_code', 'result_parse', 'message_format'
    
    -- Cached Result
    input_data JSONB NOT NULL,
    output_data JSONB NOT NULL,
    confidence FLOAT,
    
    -- Cache Management
    hit_count INTEGER DEFAULT 0,
    last_hit_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ DEFAULT now(),
    
    UNIQUE(lab_id, cache_key, cache_type)
);

CREATE INDEX idx_mapping_cache_lookup ON public.ai_mapping_cache(lab_id, cache_key, cache_type);

-- ============================================================================
-- 7. COMMUNICATION LOG (Audit trail for all bi-directional messages)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.analyzer_comm_log (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    lab_id UUID NOT NULL REFERENCES public.labs(id) ON DELETE CASCADE,
    analyzer_connection_id UUID REFERENCES public.analyzer_connections(id),
    
    -- Message Info
    direction TEXT NOT NULL CHECK (direction IN ('SEND', 'RECEIVE')),
    message_type TEXT,                              -- ORM, ORU, ACK, QRY, etc.
    message_control_id TEXT,
    
    -- Content (truncated for logs, full in analyzer_raw_messages)
    message_preview TEXT,                           -- First 500 chars
    message_size INTEGER,
    
    -- Timing
    timestamp TIMESTAMPTZ DEFAULT now(),
    processing_time_ms INTEGER,
    
    -- Status
    success BOOLEAN,
    error_code TEXT,
    error_message TEXT,
    
    -- References
    order_id UUID REFERENCES public.orders(id),
    queue_id UUID REFERENCES public.analyzer_order_queue(id),
    raw_message_id UUID REFERENCES public.analyzer_raw_messages(id)
);

CREATE INDEX idx_comm_log_time ON public.analyzer_comm_log(lab_id, timestamp DESC);
CREATE INDEX idx_comm_log_order ON public.analyzer_comm_log(order_id);

-- ============================================================================
-- 8. FUNCTIONS: AI Mapping with Cache
-- ============================================================================

-- Function to check cache before calling AI
-- Uses analyzer_id (existing column) OR analyzer_profile_id (new column)
CREATE OR REPLACE FUNCTION get_cached_mapping(
    p_lab_id UUID,
    p_lims_code TEXT,
    p_analyzer_id TEXT
) RETURNS TABLE (
    analyzer_code TEXT,
    confidence FLOAT,
    from_cache BOOLEAN
) AS $$
BEGIN
    -- Try test_mappings first (verified mappings)
    -- Check both analyzer_id and analyzer_profile_id for compatibility
    RETURN QUERY
    SELECT 
        tm.analyzer_code,
        COALESCE(tm.ai_confidence, 1.0)::FLOAT,
        TRUE
    FROM public.test_mappings tm
    WHERE tm.lab_id = p_lab_id 
      AND (tm.analyzer_id = p_analyzer_id OR tm.analyzer_profile_id = p_analyzer_id)
      AND tm.lims_code = p_lims_code
      AND (tm.verified = TRUE OR COALESCE(tm.usage_count, 0) > 5)
    LIMIT 1;
    
    IF FOUND THEN
        -- Update usage stats
        UPDATE public.test_mappings 
        SET usage_count = COALESCE(usage_count, 0) + 1, last_used_at = now()
        WHERE lab_id = p_lab_id 
          AND (analyzer_id = p_analyzer_id OR analyzer_profile_id = p_analyzer_id)
          AND lims_code = p_lims_code;
        RETURN;
    END IF;
    
    -- Return empty if not found (will need AI call)
    RETURN;
END;
$$ LANGUAGE plpgsql;

-- Function to save new AI mapping
CREATE OR REPLACE FUNCTION save_ai_mapping(
    p_lab_id UUID,
    p_lims_code TEXT,
    p_analyzer_code TEXT,
    p_analyzer_id TEXT,
    p_confidence FLOAT,
    p_analyte_id UUID DEFAULT NULL,
    p_test_name TEXT DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
    v_id UUID;
BEGIN
    -- Insert with both analyzer_id and analyzer_profile_id for compatibility
    INSERT INTO public.test_mappings (
        lab_id, lims_code, analyzer_code, analyzer_id, analyzer_profile_id,
        ai_confidence, ai_source, analyte_id, usage_count, test_name
    ) VALUES (
        p_lab_id, p_lims_code, p_analyzer_code, p_analyzer_id, p_analyzer_id,
        p_confidence, 'gemini', p_analyte_id, 1, COALESCE(p_test_name, p_lims_code)
    )
    ON CONFLICT (id) DO NOTHING
    RETURNING id INTO v_id;
    
    -- If insert failed due to existing record, update it
    IF v_id IS NULL THEN
        UPDATE public.test_mappings 
        SET 
            analyzer_code = p_analyzer_code,
            ai_confidence = GREATEST(COALESCE(ai_confidence, 0), p_confidence),
            usage_count = COALESCE(usage_count, 0) + 1,
            last_used_at = now(),
            updated_at = now()
        WHERE lab_id = p_lab_id 
          AND (analyzer_id = p_analyzer_id OR analyzer_profile_id = p_analyzer_id)
          AND lims_code = p_lims_code
        RETURNING id INTO v_id;
    END IF;
    
    RETURN v_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 9. VIEWS: Dashboard & Monitoring
-- ============================================================================

-- Connection Status Overview
CREATE OR REPLACE VIEW public.v_analyzer_status AS
SELECT 
    ac.id,
    ac.lab_id,
    ac.name,
    ac.status,
    ap.manufacturer,
    ap.model,
    ap.protocol,
    (SELECT COUNT(*) FROM public.analyzer_order_queue aoq 
     WHERE aoq.analyzer_connection_id = ac.id 
       AND aoq.status IN ('pending', 'mapped', 'sending')) as pending_orders,
    (SELECT COUNT(*) FROM public.analyzer_raw_messages arm 
     WHERE arm.analyzer_connection_id = ac.id 
       AND arm.ai_status = 'pending') as pending_results,
    (SELECT MAX(acl.timestamp) FROM public.analyzer_comm_log acl 
     WHERE acl.analyzer_connection_id = ac.id) as last_activity
FROM public.analyzer_connections ac
LEFT JOIN public.analyzer_profiles ap ON ac.profile_id = ap.id;

-- Queue Status Summary
CREATE OR REPLACE VIEW public.v_order_queue_summary AS
SELECT 
    lab_id,
    status,
    COUNT(*) as count,
    AVG(EXTRACT(EPOCH FROM (now() - created_at))) as avg_age_seconds
FROM public.analyzer_order_queue
WHERE created_at > now() - INTERVAL '24 hours'
GROUP BY lab_id, status;

-- ============================================================================
-- 10. ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE public.analyzer_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analyzer_order_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_mapping_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analyzer_comm_log ENABLE ROW LEVEL SECURITY;

-- Drop and recreate policies to avoid conflicts
DROP POLICY IF EXISTS "Profiles are readable by all" ON public.analyzer_profiles;
CREATE POLICY "Profiles are readable by all" ON public.analyzer_profiles
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "Labs manage own queue" ON public.analyzer_order_queue;
CREATE POLICY "Labs manage own queue" ON public.analyzer_order_queue
    FOR ALL USING (lab_id IN (SELECT lab_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Labs access own cache" ON public.ai_mapping_cache;
CREATE POLICY "Labs access own cache" ON public.ai_mapping_cache
    FOR ALL USING (lab_id IN (SELECT lab_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Labs view own comm log" ON public.analyzer_comm_log;
CREATE POLICY "Labs view own comm log" ON public.analyzer_comm_log
    FOR ALL USING (lab_id IN (SELECT lab_id FROM public.users WHERE id = auth.uid()));

-- ============================================================================
-- 11. TRIGGERS: Auto-update timestamps
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply triggers only to new tables (analyzer_profiles and test_mappings already have their own)
DROP TRIGGER IF EXISTS trg_analyzer_order_queue_updated ON public.analyzer_order_queue;
CREATE TRIGGER trg_analyzer_order_queue_updated 
    BEFORE UPDATE ON public.analyzer_order_queue
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMIT;
