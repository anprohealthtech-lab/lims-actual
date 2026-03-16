-- Add print_options JSONB column to test_groups for per-test-group print style overrides.
-- Keys mirror pdf_layout_settings.printOptions on labs table.
-- NULL value means "inherit from lab default" for each key.
ALTER TABLE test_groups
  ADD COLUMN IF NOT EXISTS print_options JSONB DEFAULT NULL;

COMMENT ON COLUMN test_groups.print_options IS
  'Per-test-group print style overrides. Keys: tableBorders (bool), flagColumn (bool), flagAsterisk (bool), flagAsteriskCritical (bool), headerBackground (css color), alternateRows (bool), baseFontSize (int). NULL = inherit lab default.';
