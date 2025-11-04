-- Migration to align workflow system with existing schema and add missing tables
-- This migration ensures compatibility between edge functions and database schema

-- First, let's ensure workflow_versions has the columns our code expects
DO $$ 
BEGIN
    -- Add missing columns to workflow_versions if they don't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'workflow_versions' AND column_name = 'is_active') THEN
        ALTER TABLE workflow_versions ADD COLUMN is_active boolean DEFAULT false;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'workflow_versions' AND column_name = 'ai_config') THEN
        ALTER TABLE workflow_versions ADD COLUMN ai_config jsonb;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'workflow_versions' AND column_name = 'metadata') THEN
        ALTER TABLE workflow_versions ADD COLUMN metadata jsonb;
    END IF;
END $$;

-- Ensure workflows table has the columns our code expects
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'workflows' AND column_name = 'description') THEN
        ALTER TABLE workflows ADD COLUMN description text;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'workflows' AND column_name = 'type') THEN
        ALTER TABLE workflows ADD COLUMN type text DEFAULT 'test_workflow';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'workflows' AND column_name = 'category') THEN
        ALTER TABLE workflows ADD COLUMN category text;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'workflows' AND column_name = 'is_active') THEN
        ALTER TABLE workflows ADD COLUMN is_active boolean DEFAULT true;
    END IF;
END $$;

-- Create ai_protocols table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.ai_protocols (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    name text NOT NULL,
    lab_id uuid NOT NULL,
    category text NOT NULL,
    status text NOT NULL DEFAULT 'pending',
    description text,
    config jsonb DEFAULT '{}',
    ui_config jsonb,
    result_mapping jsonb,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT ai_protocols_pkey PRIMARY KEY (id),
    CONSTRAINT ai_protocols_lab_id_fkey FOREIGN KEY (lab_id) REFERENCES labs(id) ON DELETE CASCADE
);

-- Create indexes for ai_protocols
CREATE INDEX IF NOT EXISTS idx_ai_protocols_lab_id ON public.ai_protocols USING btree (lab_id);
CREATE INDEX IF NOT EXISTS idx_ai_protocols_status ON public.ai_protocols USING btree (status);
CREATE INDEX IF NOT EXISTS idx_ai_protocols_category ON public.ai_protocols USING btree (category);

-- Create test_workflow_map table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.test_workflow_map (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    lab_id uuid NOT NULL,
    test_group_id uuid,
    workflow_version_id uuid NOT NULL,
    test_code text NOT NULL,
    is_default boolean DEFAULT false,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT test_workflow_map_pkey PRIMARY KEY (id),
    CONSTRAINT test_workflow_map_lab_id_fkey FOREIGN KEY (lab_id) REFERENCES labs(id) ON DELETE CASCADE,
    CONSTRAINT test_workflow_map_test_group_id_fkey FOREIGN KEY (test_group_id) REFERENCES test_groups(id) ON DELETE CASCADE,
    CONSTRAINT test_workflow_map_workflow_version_id_fkey FOREIGN KEY (workflow_version_id) REFERENCES workflow_versions(id) ON DELETE CASCADE
);

-- Create indexes for test_workflow_map
CREATE INDEX IF NOT EXISTS idx_test_workflow_map_lab_id ON public.test_workflow_map USING btree (lab_id);
CREATE INDEX IF NOT EXISTS idx_test_workflow_map_test_code ON public.test_workflow_map USING btree (test_code);
CREATE UNIQUE INDEX IF NOT EXISTS idx_test_workflow_map_unique_default ON public.test_workflow_map USING btree (lab_id, test_code, is_default) WHERE is_default = true;

-- Create ai_issues table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.ai_issues (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    workflow_version_id uuid,
    ai_protocol_id uuid,
    issue_type text NOT NULL,
    description text NOT NULL,
    severity text NOT NULL DEFAULT 'warning',
    metadata jsonb DEFAULT '{}',
    resolved boolean DEFAULT false,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT ai_issues_pkey PRIMARY KEY (id),
    CONSTRAINT ai_issues_workflow_version_id_fkey FOREIGN KEY (workflow_version_id) REFERENCES workflow_versions(id) ON DELETE CASCADE,
    CONSTRAINT ai_issues_ai_protocol_id_fkey FOREIGN KEY (ai_protocol_id) REFERENCES ai_protocols(id) ON DELETE CASCADE,
    CONSTRAINT ai_issues_severity_check CHECK (severity IN ('info', 'warning', 'error', 'critical'))
);

-- Create indexes for ai_issues
CREATE INDEX IF NOT EXISTS idx_ai_issues_workflow_version_id ON public.ai_issues USING btree (workflow_version_id);
CREATE INDEX IF NOT EXISTS idx_ai_issues_ai_protocol_id ON public.ai_issues USING btree (ai_protocol_id);
CREATE INDEX IF NOT EXISTS idx_ai_issues_severity ON public.ai_issues USING btree (severity);
CREATE INDEX IF NOT EXISTS idx_ai_issues_resolved ON public.ai_issues USING btree (resolved);

-- Create ai_usage_logs table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.ai_usage_logs (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    user_id uuid,
    lab_id uuid,
    processing_type text NOT NULL,
    input_data jsonb DEFAULT '{}',
    confidence numeric DEFAULT 0,
    tokens_used integer,
    cost_estimate numeric,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT ai_usage_logs_pkey PRIMARY KEY (id),
    CONSTRAINT ai_usage_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL,
    CONSTRAINT ai_usage_logs_lab_id_fkey FOREIGN KEY (lab_id) REFERENCES labs(id) ON DELETE CASCADE
);

-- Create indexes for ai_usage_logs
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_user_id ON public.ai_usage_logs USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_lab_id ON public.ai_usage_logs USING btree (lab_id);
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_processing_type ON public.ai_usage_logs USING btree (processing_type);
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_created_at ON public.ai_usage_logs USING btree (created_at);

-- Enable RLS on new tables
ALTER TABLE public.ai_protocols ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.test_workflow_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_usage_logs ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for ai_protocols
CREATE POLICY IF NOT EXISTS "ai_protocols_lab_isolation" ON public.ai_protocols
    FOR ALL USING (
        lab_id IN (
            SELECT users.lab_id FROM users WHERE users.id = auth.uid()
        )
    )
    WITH CHECK (
        lab_id IN (
            SELECT users.lab_id FROM users WHERE users.id = auth.uid()
        )
    );

-- Create RLS policies for test_workflow_map
CREATE POLICY IF NOT EXISTS "test_workflow_map_lab_isolation" ON public.test_workflow_map
    FOR ALL USING (
        lab_id IN (
            SELECT users.lab_id FROM users WHERE users.id = auth.uid()
        )
    )
    WITH CHECK (
        lab_id IN (
            SELECT users.lab_id FROM users WHERE users.id = auth.uid()
        )
    );

-- Create RLS policies for ai_issues
CREATE POLICY IF NOT EXISTS "ai_issues_workflow_access" ON public.ai_issues
    FOR ALL USING (
        (workflow_version_id IS NULL) OR
        (workflow_version_id IN (
            SELECT wv.id FROM workflow_versions wv
            JOIN workflows w ON w.id = wv.workflow_id
            WHERE w.lab_id IN (
                SELECT users.lab_id FROM users WHERE users.id = auth.uid()
            )
        )) OR
        (ai_protocol_id IN (
            SELECT ap.id FROM ai_protocols ap
            WHERE ap.lab_id IN (
                SELECT users.lab_id FROM users WHERE users.id = auth.uid()
            )
        ))
    );

-- Create RLS policies for ai_usage_logs
CREATE POLICY IF NOT EXISTS "ai_usage_logs_lab_isolation" ON public.ai_usage_logs
    FOR ALL USING (
        (lab_id IS NULL) OR
        (lab_id IN (
            SELECT users.lab_id FROM users WHERE users.id = auth.uid()
        ))
    )
    WITH CHECK (
        (lab_id IS NULL) OR
        (lab_id IN (
            SELECT users.lab_id FROM users WHERE users.id = auth.uid()
        ))
    );

-- Update existing workflow_versions to have is_active based on active column
UPDATE workflow_versions SET is_active = active WHERE is_active IS NULL AND active IS NOT NULL;

-- Update existing workflows to have is_active based on active column  
UPDATE workflows SET is_active = active WHERE is_active IS NULL AND active IS NOT NULL;