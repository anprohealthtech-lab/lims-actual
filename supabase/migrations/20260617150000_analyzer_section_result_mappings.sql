-- Analyzer section-result mappings
-- Allows inbound analyzer/LIS text codes to update section-only report content.

ALTER TABLE public.test_mappings
  ADD COLUMN IF NOT EXISTS section_id uuid REFERENCES public.lab_template_sections(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'test_mappings_mapping_type_check'
      AND conrelid = 'public.test_mappings'::regclass
  ) THEN
    ALTER TABLE public.test_mappings
      DROP CONSTRAINT test_mappings_mapping_type_check;
  END IF;

  ALTER TABLE public.test_mappings
    ADD CONSTRAINT test_mappings_mapping_type_check
    CHECK (
      mapping_type IN (
        'order_service',
        'result_analyte',
        'result_section',
        'specimen_mode',
        'histogram',
        'flag',
        'control'
      )
    );
END $$;

CREATE INDEX IF NOT EXISTS idx_test_mappings_result_section_lookup
  ON public.test_mappings(lab_id, analyzer_connection_id, mapping_type, direction, analyzer_code)
  WHERE mapping_type = 'result_section';

CREATE INDEX IF NOT EXISTS idx_test_mappings_section_id
  ON public.test_mappings(section_id)
  WHERE section_id IS NOT NULL;

COMMENT ON COLUMN public.test_mappings.section_id IS
  'For mapping_type=result_section, optional target lab_template_sections.id for inbound narrative/report text.';
