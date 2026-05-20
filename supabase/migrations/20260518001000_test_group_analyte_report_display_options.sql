-- Per-test-group report layout options for selected analytes.
-- Used for basic-template same-row sibling display, e.g. Differential % + Absolute Count.

ALTER TABLE public.test_group_analytes
  ADD COLUMN IF NOT EXISTS report_display_options jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.test_group_analytes.report_display_options IS
  'Per selected-analyte report layout options, such as same-row sibling analyte display.';
