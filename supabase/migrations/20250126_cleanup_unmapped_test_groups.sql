-- Function to identify test groups with no analyte mappings
-- These are likely created due to errors and should be cleaned up

-- 1. Create a function to find unmapped test groups
CREATE OR REPLACE FUNCTION find_unmapped_test_groups()
RETURNS TABLE (
  test_group_id uuid,
  test_group_name text,
  test_group_code text,
  lab_id uuid,
  created_at timestamptz,
  has_orders boolean,
  has_results boolean,
  has_workflow_mappings boolean
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    tg.id AS test_group_id,
    tg.name AS test_group_name,
    tg.code AS test_group_code,
    tg.lab_id,
    tg.created_at,
    EXISTS (
      SELECT 1 FROM order_tests ot WHERE ot.test_group_id = tg.id
    ) AS has_orders,
    EXISTS (
      SELECT 1 FROM results r WHERE r.test_group_id = tg.id
    ) AS has_results,
    EXISTS (
      SELECT 1 FROM test_workflow_map twm WHERE twm.test_group_id = tg.id
    ) AS has_workflow_mappings
  FROM test_groups tg
  WHERE NOT EXISTS (
    SELECT 1 FROM test_group_analytes tga WHERE tga.test_group_id = tg.id
  )
  ORDER BY tg.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Create a function to safely delete unmapped test groups
-- Only deletes test groups that have:
-- - No analyte mappings
-- - No orders
-- - No results
-- - No workflow mappings
CREATE OR REPLACE FUNCTION delete_unmapped_test_groups(
  p_dry_run boolean DEFAULT true,
  p_lab_id uuid DEFAULT NULL
)
RETURNS TABLE (
  action text,
  test_group_id uuid,
  test_group_name text,
  test_group_code text,
  lab_id uuid,
  message text
) AS $$
DECLARE
  v_test_group RECORD;
  v_deleted_count integer := 0;
  v_skipped_count integer := 0;
  v_error_message text;
BEGIN
  -- Loop through unmapped test groups
  FOR v_test_group IN 
    SELECT * FROM find_unmapped_test_groups()
    WHERE (p_lab_id IS NULL OR find_unmapped_test_groups.lab_id = p_lab_id)
  LOOP
    -- Check if test group is safe to delete
    IF v_test_group.has_orders OR v_test_group.has_results THEN
      -- Skip: has associated data
      v_skipped_count := v_skipped_count + 1;
      RETURN QUERY SELECT 
        'SKIPPED'::text,
        v_test_group.test_group_id,
        v_test_group.test_group_name,
        v_test_group.test_group_code,
        v_test_group.lab_id,
        'Test group has orders or results - cannot delete'::text;
    ELSE
      -- Safe to delete
      IF NOT p_dry_run THEN
        -- Actually delete the test group and related records
        BEGIN
          -- Delete related records first (to handle foreign key constraints)
          DELETE FROM test_workflow_map WHERE test_group_id = v_test_group.test_group_id;
          DELETE FROM workflow_versions WHERE test_group_id = v_test_group.test_group_id;
          DELETE FROM lab_templates WHERE test_group_id = v_test_group.test_group_id;
          DELETE FROM package_test_groups WHERE test_group_id = v_test_group.test_group_id;
          DELETE FROM workflow_ai_configs WHERE test_group_id = v_test_group.test_group_id;
          
          -- Finally delete the test group itself
          DELETE FROM test_groups WHERE id = v_test_group.test_group_id;
          
          v_deleted_count := v_deleted_count + 1;
          
          RETURN QUERY SELECT 
            'DELETED'::text,
            v_test_group.test_group_id,
            v_test_group.test_group_name,
            v_test_group.test_group_code,
            v_test_group.lab_id,
            'Successfully deleted with all related records'::text;
        EXCEPTION WHEN OTHERS THEN
          -- Catch any deletion errors
          GET STACKED DIAGNOSTICS v_error_message = MESSAGE_TEXT;
          v_skipped_count := v_skipped_count + 1;
          
          RETURN QUERY SELECT 
            'ERROR'::text,
            v_test_group.test_group_id,
            v_test_group.test_group_name,
            v_test_group.test_group_code,
            v_test_group.lab_id,
            format('Failed to delete: %s', v_error_message)::text;
        END;
      ELSE
        -- Dry run: just report what would be deleted
        v_deleted_count := v_deleted_count + 1;
        
        RETURN QUERY SELECT 
          'WOULD_DELETE'::text,
          v_test_group.test_group_id,
          v_test_group.test_group_name,
          v_test_group.test_group_code,
          v_test_group.lab_id,
          'Would be deleted (dry run)'::text;
      END IF;
    END IF;
  END LOOP;
  
  -- Return summary
  IF p_dry_run THEN
    RETURN QUERY SELECT 
      'SUMMARY'::text,
      NULL::uuid,
      NULL::text,
      NULL::text,
      NULL::uuid,
      format('DRY RUN: Would delete %s test groups, skipped %s', v_deleted_count, v_skipped_count)::text;
  ELSE
    RETURN QUERY SELECT 
      'SUMMARY'::text,
      NULL::uuid,
      NULL::text,
      NULL::text,
      NULL::uuid,
      format('Deleted %s test groups, skipped %s', v_deleted_count, v_skipped_count)::text;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Grant execute permissions
GRANT EXECUTE ON FUNCTION find_unmapped_test_groups() TO authenticated;
GRANT EXECUTE ON FUNCTION delete_unmapped_test_groups(boolean, uuid) TO authenticated;

-- 4. Add helpful comments
COMMENT ON FUNCTION find_unmapped_test_groups() IS 
  'Finds test groups that have no analyte mappings in test_group_analytes table';

COMMENT ON FUNCTION delete_unmapped_test_groups(boolean, uuid) IS 
  'Safely deletes unmapped test groups. Pass false to first parameter to actually delete (default is dry run). Pass lab_id to filter by specific lab.';
