-- Auto-fill order_test_id (and order_test_group_id) on results and result_values
-- when order_id + test_group_id are present but order_test_id is null.
--
-- This ensures analyzer-interface rows (which have no order_test_id at insert time)
-- still appear in v_order_test_progress_enhanced, which joins via results.order_test_id.

-- ─────────────────────────────────────────────
-- 1. Trigger function shared by both tables
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_auto_fill_order_test_id()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_order_test_id      uuid;
  v_order_test_group_id uuid;
BEGIN
  -- Only act when order_test_id is missing but we have enough context to look it up
  IF NEW.order_test_id IS NULL
     AND NEW.order_id   IS NOT NULL
     AND NEW.test_group_id IS NOT NULL
  THEN
    -- Primary: look up via order_tests
    SELECT id
      INTO v_order_test_id
      FROM order_tests
     WHERE order_id      = NEW.order_id
       AND test_group_id = NEW.test_group_id
     LIMIT 1;

    -- Fallback for results table: pull from a child result_values row
    IF v_order_test_id IS NULL AND TG_TABLE_NAME = 'results' AND NEW.id IS NOT NULL THEN
      SELECT order_test_id
        INTO v_order_test_id
        FROM result_values
       WHERE result_id    = NEW.id
         AND order_test_id IS NOT NULL
       LIMIT 1;
    END IF;

    IF v_order_test_id IS NOT NULL THEN
      NEW.order_test_id := v_order_test_id;
    END IF;
  END IF;

  -- Fill order_test_group_id if the column exists on this table and is null
  -- (result_values has order_test_group_id; results does too)
  BEGIN
    IF NEW.order_test_group_id IS NULL
       AND NEW.order_id        IS NOT NULL
       AND NEW.test_group_id   IS NOT NULL
    THEN
      SELECT id
        INTO v_order_test_group_id
        FROM order_test_groups
       WHERE order_id      = NEW.order_id
         AND test_group_id = NEW.test_group_id
       LIMIT 1;

      IF v_order_test_group_id IS NOT NULL THEN
        NEW.order_test_group_id := v_order_test_group_id;
      END IF;
    END IF;
  EXCEPTION WHEN undefined_column THEN
    -- table doesn't have order_test_group_id — skip silently
    NULL;
  END;

  RETURN NEW;
END;
$$;

-- ─────────────────────────────────────────────
-- 2. Attach to results table
-- ─────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_auto_fill_order_test_id_results ON results;

CREATE TRIGGER trg_auto_fill_order_test_id_results
  BEFORE INSERT OR UPDATE ON results
  FOR EACH ROW
  EXECUTE FUNCTION fn_auto_fill_order_test_id();

-- ─────────────────────────────────────────────
-- 3. Attach to result_values table
-- ─────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_auto_fill_order_test_id_result_values ON result_values;

CREATE TRIGGER trg_auto_fill_order_test_id_result_values
  BEFORE INSERT OR UPDATE ON result_values
  FOR EACH ROW
  EXECUTE FUNCTION fn_auto_fill_order_test_id();

-- ─────────────────────────────────────────────
-- 4. Back-fill existing rows that are already missing order_test_id
-- ─────────────────────────────────────────────

-- Fix results rows
UPDATE results r
   SET order_test_id = ot.id
  FROM order_tests ot
 WHERE r.order_test_id IS NULL
   AND r.test_group_id IS NOT NULL
   AND ot.order_id      = r.order_id
   AND ot.test_group_id = r.test_group_id;

-- Fix result_values rows
UPDATE result_values rv
   SET order_test_id = ot.id
  FROM order_tests ot
 WHERE rv.order_test_id IS NULL
   AND rv.test_group_id IS NOT NULL
   AND ot.order_id      = rv.order_id
   AND ot.test_group_id = rv.test_group_id;

-- Fix order_test_group_id on result_values
UPDATE result_values rv
   SET order_test_group_id = otg.id
  FROM order_test_groups otg
 WHERE rv.order_test_group_id IS NULL
   AND rv.test_group_id       IS NOT NULL
   AND otg.order_id            = rv.order_id
   AND otg.test_group_id       = rv.test_group_id;

-- Fix results headers using their child result_values (most reliable path —
-- result_values.order_test_id is already populated above)
UPDATE results r
   SET order_test_id = rv.order_test_id
  FROM (
    SELECT DISTINCT ON (result_id) result_id, order_test_id
    FROM result_values
    WHERE order_test_id IS NOT NULL
  ) rv
 WHERE rv.result_id    = r.id
   AND r.order_test_id IS NULL;
