-- Lab Interface feature flag
-- Only labs that subscribe to the LIS/analyzer interface add-on have this enabled.
-- Controls: auto-dispatch, analyzer_connections, API key generation, raw message ingestion.

ALTER TABLE public.labs
  ADD COLUMN IF NOT EXISTS lab_interface_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.labs.lab_interface_enabled IS
  'Paid add-on: enables LIS analyzer interface (auto-dispatch, HL7 ingest, API keys). Set to true only for subscribed labs.';

-- Link test groups to specific analyzer connections.
-- Only meaningful when labs.lab_interface_enabled = true.

ALTER TABLE public.test_groups
  ADD COLUMN IF NOT EXISTS analyzer_connection_id uuid
    REFERENCES public.analyzer_connections(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.test_groups.analyzer_connection_id IS
  'Which analyzer connection handles this test group. Requires labs.lab_interface_enabled = true.';

CREATE INDEX IF NOT EXISTS idx_test_groups_analyzer
  ON public.test_groups(analyzer_connection_id)
  WHERE analyzer_connection_id IS NOT NULL;
