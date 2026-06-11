-- Analyzer interface results preserve the instrument-provided abnormal flag.
-- Record that provenance explicitly instead of rejecting the result_values insert.
ALTER TABLE public.result_values
  DROP CONSTRAINT IF EXISTS result_values_flag_source_check;

ALTER TABLE public.result_values
  ADD CONSTRAINT result_values_flag_source_check
  CHECK (
    flag_source IS NULL
    OR flag_source IN (
      'auto_numeric',
      'auto_text',
      'auto_rule',
      'ai',
      'manual',
      'inherited',
      'analyzer'
    )
  );
