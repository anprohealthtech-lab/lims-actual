-- Add sample_type_colors JSONB column to labs table
-- Allows labs to customize tube/container colors per sample type

ALTER TABLE labs
ADD COLUMN IF NOT EXISTS sample_type_colors JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN labs.sample_type_colors IS
'Lab-specific sample type color overrides. Format: {"serum": "#DC2626", "edta": "#9333EA"}. When set, overrides default hardcoded colors in SampleTypeIndicator.';
