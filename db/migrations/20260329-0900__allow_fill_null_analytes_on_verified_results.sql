-- Allow entering values for analytes that were null at the time of verification.
--
-- Problem:
--   When a result is verified (results.verification_status = 'verified') but some
--   analytes had value = NULL (e.g. auto-calculated fields whose inputs were missing),
--   subsequent attempts to fill in those null analytes fail with P0001 because:
--     1) The trigger prevent_verified_result_edit() blocks DELETE of null-value rows
--        (the frontend deletes then re-inserts to save analyte values).
--     2) The RLS insert policy blocks INSERT on verified results entirely.
--
-- Fix:
--   - Trigger: allow DELETE/UPDATE only when OLD.value IS NULL (null placeholder).
--     A null row is not a "verified value" — it's an unentered value.
--     Already-entered (non-null) values remain protected.
--   - RLS INSERT policy: allow insert when the parent result is not locked and
--     there is no existing non-null value for that analyte in the same result.

-- ============================================================================
-- 1) Update trigger to allow null-placeholder DELETE and null→value UPDATE
-- ============================================================================

CREATE OR REPLACE FUNCTION prevent_verified_result_edit()
RETURNS TRIGGER AS $$
DECLARE
  result_record RECORD;
  is_admin boolean := false;
BEGIN
  -- Get result status for this result_value
  SELECT verification_status, is_locked, locked_reason
  INTO result_record
  FROM results
  WHERE id = COALESCE(NEW.result_id, OLD.result_id);

  -- Check if current user is admin
  SELECT EXISTS (
    SELECT 1 FROM users u
    WHERE u.id = auth.uid()
    AND LOWER(u.role::text) IN ('admin', 'super_admin', 'lab_admin')
  ) INTO is_admin;

  -- Check if result is verified
  IF result_record.verification_status = 'verified' THEN
    IF TG_OP = 'DELETE' THEN
      -- Allow deleting null-value placeholder rows (value was never entered).
      -- Block deletion of rows that have actual values.
      IF OLD.value IS NOT NULL THEN
        RAISE EXCEPTION 'Cannot delete values of verified results. Use amendment process if changes are needed.';
      END IF;

    ELSIF TG_OP = 'UPDATE' THEN
      IF is_admin THEN
        -- Admin: allow filling in a null value, block changing an existing value
        IF (OLD.value IS NOT NULL AND OLD.value IS DISTINCT FROM NEW.value)
            OR (OLD.flag IS NOT NULL AND OLD.flag IS DISTINCT FROM NEW.flag) THEN
          RAISE EXCEPTION 'Cannot modify values of verified results. Only unapprove is allowed for admins.';
        END IF;
        -- Allow verify_status, verify_note, verified_at, verified_by changes
      ELSE
        -- Non-admin: allow filling in a null value, block changing an existing value
        IF (OLD.value IS NOT NULL AND OLD.value IS DISTINCT FROM NEW.value)
            OR (OLD.flag IS NOT NULL AND OLD.flag IS DISTINCT FROM NEW.flag) THEN
          RAISE EXCEPTION 'Cannot modify values of verified results. Use amendment process if changes are needed.';
        END IF;
        -- Block verify_status revert for non-admins
        IF OLD.verify_status = 'approved' AND NEW.verify_status != 'approved' THEN
          RAISE EXCEPTION 'Only admin users can unapprove verified results.';
        END IF;
      END IF;
    END IF;
  END IF;

  -- Check if result is locked
  IF result_record.is_locked = true THEN
    IF TG_OP = 'DELETE' THEN
      -- Allow deleting null-value placeholder rows (value was never entered) even on locked results.
      -- For non-null rows: only admin can delete (reopen-for-correction flow).
      IF OLD.value IS NOT NULL AND NOT is_admin THEN
        RAISE EXCEPTION 'Cannot delete values of locked results. Reason: %', result_record.locked_reason;
      END IF;
    ELSIF TG_OP = 'UPDATE' THEN
      -- Allow filling in a null value even on locked results.
      -- Block changing an already-entered (non-null) value unless admin.
      IF NOT is_admin
          AND (OLD.value IS NOT NULL AND OLD.value IS DISTINCT FROM NEW.value
               OR OLD.flag IS NOT NULL AND OLD.flag IS DISTINCT FROM NEW.flag) THEN
        RAISE EXCEPTION 'Cannot modify values of locked results. Reason: %', result_record.locked_reason;
      END IF;
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 2) Update RLS INSERT policy to allow inserting values for null analytes
--    on verified (but not locked) results.
--
--    After deleting a null placeholder row, the frontend inserts the actual value.
--    The old policy blocked all inserts on verified results.
-- ============================================================================

DROP POLICY IF EXISTS result_values_insert_policy ON result_values;

CREATE POLICY result_values_insert_policy ON result_values
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM results r
      WHERE r.id = result_values.result_id
      AND r.is_locked = false
      AND (
        -- Normal case: result not yet verified
        r.verification_status != 'verified'
        OR
        -- Filling in a null analyte on a verified result:
        -- only allowed if no existing non-null value exists for this analyte
        NOT EXISTS (
          SELECT 1 FROM result_values rv2
          WHERE rv2.result_id = result_values.result_id
            AND rv2.analyte_id = result_values.analyte_id
            AND rv2.value IS NOT NULL
        )
      )
    )
  );
