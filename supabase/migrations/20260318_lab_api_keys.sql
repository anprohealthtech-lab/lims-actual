-- Lab API Keys for LIS Bridge Authentication
-- Allows third-party bridge apps to insert into analyzer_raw_messages
-- without needing the service role key. Only a lab-scoped API key is needed.

CREATE TABLE public.lab_api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_id uuid NOT NULL REFERENCES public.labs(id) ON DELETE CASCADE,
  key_hash text NOT NULL UNIQUE,   -- SHA-256 hash of the actual key (plaintext never stored)
  label text NOT NULL,             -- e.g. "Beckman Analyzer - Room 3"
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  created_by uuid REFERENCES public.users(id)
);

ALTER TABLE public.lab_api_keys ENABLE ROW LEVEL SECURITY;

-- Lab users can view/manage their own lab's keys
CREATE POLICY "Lab users can manage their api keys"
  ON public.lab_api_keys
  FOR ALL
  USING (lab_id IN (SELECT lab_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (lab_id IN (SELECT lab_id FROM public.users WHERE id = auth.uid()));

-- Index for fast key validation on every ingest request
CREATE INDEX idx_lab_api_keys_hash ON public.lab_api_keys (key_hash) WHERE is_active = true;
