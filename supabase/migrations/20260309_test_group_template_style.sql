-- Per-test-group PDF layout style override
-- NULL = use lab's default_template_style
-- 'beautiful' = force 3-column color matrix (ignores linked custom template)
-- 'classic'   = force plain table (ignores linked custom template)

ALTER TABLE test_groups
ADD COLUMN IF NOT EXISTS default_template_style TEXT
  CHECK (default_template_style IN ('beautiful', 'classic'));

COMMENT ON COLUMN test_groups.default_template_style IS
'Per-test-group PDF layout override. NULL = use lab default. beautiful = 3-column color matrix. classic = plain table. When set, overrides both the lab default and any linked custom template.';
