-- Add ai_prompt_override and group_ai_mode to lab_analytes
-- so lab_analytes is a complete source of truth without needing to join analytes table.
-- These mirror the same columns on the analytes table.

ALTER TABLE lab_analytes
  ADD COLUMN IF NOT EXISTS ai_prompt_override text,
  ADD COLUMN IF NOT EXISTS group_ai_mode text;

COMMENT ON COLUMN lab_analytes.ai_prompt_override IS
  'Lab-specific AI prompt override. Overrides global analyte ai_prompt_override when set.';

COMMENT ON COLUMN lab_analytes.group_ai_mode IS
  'Lab-specific AI processing mode (individual/group/batch). Overrides global analyte group_ai_mode when set.';
