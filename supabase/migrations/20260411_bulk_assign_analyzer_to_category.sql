-- Bulk assign (or unlink) an analyzer connection to all test groups
-- in a given category for a given lab.
--
-- Usage:
--   SELECT public.bulk_assign_analyzer_to_category(
--     '<lab-uuid>',
--     'Biochemistry',
--     '<analyzer-connection-uuid>'   -- or NULL to unlink all
--   );
--
-- Returns: number of test_groups updated

CREATE OR REPLACE FUNCTION public.bulk_assign_analyzer_to_category(
  p_lab_id                  UUID,
  p_category                TEXT,
  p_analyzer_connection_id  UUID  -- pass NULL to unlink
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_affected INTEGER;
BEGIN
  UPDATE public.test_groups
  SET
    analyzer_connection_id = p_analyzer_connection_id,
    updated_at             = now()
  WHERE lab_id   = p_lab_id
    AND category = p_category
    AND is_active = true;

  GET DIAGNOSTICS v_affected = ROW_COUNT;
  RETURN v_affected;
END;
$$;

COMMENT ON FUNCTION public.bulk_assign_analyzer_to_category IS
  'Assigns or removes an analyzer_connection_id on every active test_group
   in p_category for p_lab_id. Pass NULL for p_analyzer_connection_id to unlink.
   Returns the number of rows updated.';
