-- Allow multiple lab analytes/tests to share the same analyzer/LIMS code.
-- Example: fasting glucose and PPBS can both use GLUC on the same analyzer.
-- But one concrete lab_analyte_id cannot have two mappings for the same analyzer.

ALTER TABLE public.test_mappings
  DROP CONSTRAINT IF EXISTS test_mappings_lab_id_analyzer_id_lims_code_key;

CREATE INDEX IF NOT EXISTS idx_test_mappings_lookup
  ON public.test_mappings(lab_id, analyzer_id, lims_code);

CREATE UNIQUE INDEX IF NOT EXISTS test_mappings_lab_analyte_analyzer_key
  ON public.test_mappings(lab_id, analyzer_id, lab_analyte_id)
  WHERE lab_analyte_id IS NOT NULL;
