-- Machine Interface & AI Parsing Schema for LIMS
-- Generated: 2026-01-17

-- 1. Enable Vector extension for AI/RAG Memory
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- 2. Analyzer Connections (Physical machines)
CREATE TABLE IF NOT EXISTS public.analyzer_connections (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    lab_id uuid REFERENCES public.labs(id) NOT NULL,
    name text NOT NULL, -- e.g. "Sysmex XN-1000 Hematology"
    connection_type text CHECK (connection_type IN ('tcp', 'serial', 'file')),
    config jsonb DEFAULT '{}'::jsonb, -- Stores IP, Port, BaudRate, etc.
    status text DEFAULT 'offline',
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- RLS for Connections
ALTER TABLE public.analyzer_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Labs can view their own connections" ON public.analyzer_connections
    FOR SELECT USING (lab_id IN (SELECT lab_id FROM public.users WHERE id = auth.uid()));
CREATE POLICY "Labs can manage their own connections" ON public.analyzer_connections
    FOR ALL USING (lab_id IN (SELECT lab_id FROM public.users WHERE id = auth.uid()));


-- 3. Raw Messages Inbox (The "Data Lake" for Machine Data)
CREATE TABLE IF NOT EXISTS public.analyzer_raw_messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    lab_id uuid REFERENCES public.labs(id) NOT NULL,
    analyzer_connection_id uuid REFERENCES public.analyzer_connections(id),
    
    direction text CHECK (direction IN ('INBOUND', 'OUTBOUND')) NOT NULL,
    raw_content text NOT NULL, -- The raw HL7 / ASTM data string
    
    -- AI Processing Status
    ai_status text DEFAULT 'pending' CHECK (ai_status IN ('pending', 'processing', 'completed', 'failed', 'review_needed')),
    ai_confidence numeric,
    ai_result jsonb, -- The structured JSON result from Gemini
    
    -- Extracted Metadata (for quick indexing/lookup)
    sample_barcode text,
    order_id uuid REFERENCES public.orders(id),
    
    created_at timestamptz DEFAULT now()
);

-- RLS for Messages
ALTER TABLE public.analyzer_raw_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Labs can view/insert their messages" ON public.analyzer_raw_messages
    FOR ALL USING (lab_id IN (SELECT lab_id FROM public.users WHERE id = auth.uid()));


-- 4. Analyzer Knowledge Base (RAG Memory)
-- This stores successful mappings (e.g., "WBC-X" = "White Blood Count") so AI learns.
CREATE TABLE IF NOT EXISTS public.analyzer_knowledge (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    lab_id uuid REFERENCES public.labs(id) NOT NULL,
    
    knowledge_type text NOT NULL CHECK (knowledge_type IN ('protocol', 'mapping', 'correction')),
    title text,
    content text NOT NULL, -- The semantic text to embed
    embedding vector(1536), -- Gemini/OpenAI embedding vector
    
    metadata jsonb DEFAULT '{}'::jsonb,
    confidence_score numeric DEFAULT 1.0,
    
    created_at timestamptz DEFAULT now()
);

-- RLS for Knowledge
ALTER TABLE public.analyzer_knowledge ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Labs can access their knowledge base" ON public.analyzer_knowledge
    FOR ALL USING (lab_id IN (SELECT lab_id FROM public.users WHERE id = auth.uid()));

-- Indexes for Performance
CREATE INDEX IF NOT EXISTS idx_analyzer_con_lab ON public.analyzer_connections(lab_id);
CREATE INDEX IF NOT EXISTS idx_analyzer_msg_lab ON public.analyzer_raw_messages(lab_id);
CREATE INDEX IF NOT EXISTS idx_analyzer_msg_barcode ON public.analyzer_raw_messages(sample_barcode);
CREATE INDEX IF NOT EXISTS idx_analyzer_msg_status ON public.analyzer_raw_messages(ai_status);

-- Optional: Vector Index (ivfflat) for RAG speed
-- Note: Often requires a minimum number of rows to build successfully.
-- CREATE INDEX IF NOT EXISTS idx_knowledge_embedding ON public.analyzer_knowledge USING ivfflat (embedding vector_cosine_ops);
