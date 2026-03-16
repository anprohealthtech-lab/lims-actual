-- Fix premature PDF queue trigger for multi-group orders
-- BUG: The old trigger only counted existing `results` rows, ignoring test groups
-- that hadn't had results entered yet. E.g., order with 3 test groups, only 1 result
-- entered and verified → old check: 1/1 = TRUE → premature queue insertion.
-- The edge function then rejects it (panels not ready), causing fail/retry/fail.
--
-- FIX: Check against `order_tests` to ensure ALL test groups have verified results.
-- Also use `v_result_panel_status` (which checks result_values.verify_status at the
-- analyte level) for the most accurate readiness check.

BEGIN;

-- Replace the trigger function with a corrected version
CREATE OR REPLACE FUNCTION queue_pdf_generation()
RETURNS TRIGGER AS $$
DECLARE
  all_panels_ready BOOLEAN;
  order_lab_id UUID;
  v_job_id UUID;
  total_test_groups INTEGER;
  verified_test_groups INTEGER;
BEGIN
  -- =====================================================================
  -- Method 1: Check v_result_panel_status (most accurate)
  -- This view joins order_tests (ALL test groups) with result_values
  -- and checks analyte-level approval status.
  -- =====================================================================
  SELECT
    COUNT(*) > 0 AND COUNT(*) = COUNT(CASE WHEN panel_ready THEN 1 END)
  INTO all_panels_ready
  FROM v_result_panel_status
  WHERE order_id = NEW.order_id;

  -- =====================================================================
  -- Method 2 (fallback): If the view is missing, ensure every order_test
  -- has a corresponding verified result in the results table.
  -- =====================================================================
  IF all_panels_ready IS NULL THEN
    -- Count total test groups for this order
    SELECT COUNT(*) INTO total_test_groups
    FROM order_tests
    WHERE order_id = NEW.order_id
      AND test_group_id IS NOT NULL;

    -- Count test groups that have verified results
    SELECT COUNT(DISTINCT r.test_group_id) INTO verified_test_groups
    FROM results r
    INNER JOIN order_tests ot
      ON ot.order_id = r.order_id
      AND ot.test_group_id = r.test_group_id
    WHERE r.order_id = NEW.order_id
      AND r.verification_status = 'verified';

    all_panels_ready := (total_test_groups > 0 AND verified_test_groups >= total_test_groups);
  END IF;

  -- Get lab_id from the order
  SELECT lab_id INTO order_lab_id
  FROM orders
  WHERE id = NEW.order_id;

  -- Only queue PDF generation when ALL panels are ready
  IF all_panels_ready AND order_lab_id IS NOT NULL THEN

    -- Insert job into queue (ON CONFLICT DO NOTHING to avoid duplicates)
    INSERT INTO pdf_generation_queue (order_id, lab_id, status, priority)
    VALUES (NEW.order_id, order_lab_id, 'pending', 0)
    ON CONFLICT (order_id) DO NOTHING
    RETURNING id INTO v_job_id;

    -- Only invoke if we actually inserted a new job (not a duplicate)
    IF v_job_id IS NOT NULL THEN
      -- Update order status
      UPDATE orders
      SET report_generation_status = 'queued'
      WHERE id = NEW.order_id;

      -- Auto-invoke the edge function via pg_net (if available)
      BEGIN
        PERFORM invoke_pdf_generation(NEW.order_id);
        RAISE NOTICE 'PDF generation queued and invoked for order: %', NEW.order_id;
      EXCEPTION WHEN OTHERS THEN
        -- pg_net may not be enabled; job is still queued for UI auto-trigger
        RAISE NOTICE 'PDF generation queued (pg_net invoke skipped): % — %', NEW.order_id, SQLERRM;
      END;
    ELSE
      RAISE NOTICE 'PDF job already exists for order: % (skipping duplicate)', NEW.order_id;
    END IF;
  ELSE
    RAISE NOTICE 'PDF generation NOT queued for order: % — panels not all ready (all_panels_ready=%)', NEW.order_id, all_panels_ready;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;

COMMENT ON FUNCTION queue_pdf_generation() IS
'Trigger function that queues PDF generation ONLY when ALL test groups (panels) for an order are ready. '
'Fixed: Now checks order_tests + v_result_panel_status instead of only counting existing results rows. '
'This prevents premature PDF generation for multi-group orders where some groups have no results yet.';
