-- Lab-level Accession collection workflow configuration.
-- JSON shape is intentionally flexible so labs can define sample-type specific
-- collection checks without adding a database column for each question.

ALTER TABLE public.labs
  ADD COLUMN IF NOT EXISTS accession_collection_config jsonb NOT NULL DEFAULT
  '{"sample_type_flows":{}}'::jsonb;

ALTER TABLE public.samples
  ADD COLUMN IF NOT EXISTS collection_form_response jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.labs.accession_collection_config IS
  'Accession sample-type collection flow config. Example: {"sample_type_flows":{"Serum":{"items":[{"label":"Sample volume proper","type":"boolean","required":true}]}}}.';

COMMENT ON COLUMN public.samples.collection_form_response IS
  'JSON response captured during Accession collection, including sample-type checks and per-test-group sample conditions.';
