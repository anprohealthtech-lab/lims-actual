-- Add 'basic' as a valid value for test_groups.default_template_style
-- Also update the labs table constraint if one exists

-- Drop old check constraint on test_groups and recreate with 'basic' included
ALTER TABLE test_groups
  DROP CONSTRAINT IF EXISTS test_groups_default_template_style_check;

ALTER TABLE test_groups
  ADD CONSTRAINT test_groups_default_template_style_check
  CHECK (default_template_style IN ('beautiful', 'classic', 'basic'));

-- Update the labs table constraint if it exists
ALTER TABLE labs
  DROP CONSTRAINT IF EXISTS labs_default_template_style_check;

ALTER TABLE labs
  ADD CONSTRAINT labs_default_template_style_check
  CHECK (default_template_style IN ('beautiful', 'classic', 'basic'));
