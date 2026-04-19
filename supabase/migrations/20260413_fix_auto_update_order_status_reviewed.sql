-- Fix auto_update_order_status: treat 'Reviewed' as approved-equivalent.
--
-- Root cause: when individual result_values are approved (verify_status='approved'),
-- the rollup trigger sets results.status = 'Reviewed', NOT 'Approved'.
-- The old function only checked results.status = 'Approved', so approved_results
-- was always 0 for panels verified this way → orders stuck at 'Pending Approval'.
--
-- Fix: count results whose status is 'Approved' OR 'Reviewed' OR whose ALL
-- result_values have verify_status = 'approved' as fully approved.

CREATE OR REPLACE FUNCTION public.auto_update_order_status()
RETURNS TRIGGER AS $$
DECLARE
    v_order_id UUID;
    v_total_tests INTEGER;
    v_completed_results INTEGER;
    v_approved_results INTEGER;
    v_current_status TEXT;
BEGIN
    -- Resolve order_id from whichever table fired the trigger
    IF TG_TABLE_NAME = 'results' THEN
        v_order_id := COALESCE(NEW.order_id, OLD.order_id);
    ELSIF TG_TABLE_NAME = 'result_values' THEN
        SELECT r.order_id INTO v_order_id
        FROM results r
        WHERE r.id = COALESCE(NEW.result_id, OLD.result_id);
    END IF;

    IF v_order_id IS NULL THEN
        RETURN COALESCE(NEW, OLD);
    END IF;

    -- Get current order status
    SELECT o.status INTO v_current_status
    FROM orders o WHERE o.id = v_order_id;

    -- Count total non-canceled tests for this order
    SELECT COUNT(*) INTO v_total_tests
    FROM order_tests ot
    WHERE ot.order_id = v_order_id
      AND COALESCE(ot.is_canceled, false) = false;

    -- Count results that have at least one value entered
    SELECT COUNT(DISTINCT r.id) INTO v_completed_results
    FROM results r
    INNER JOIN result_values rv ON r.id = rv.result_id
                                AND rv.value IS NOT NULL
                                AND rv.value != ''
    WHERE r.order_id = v_order_id;

    -- Count results that are fully approved.
    -- A result is approved when:
    --   (a) results.status IN ('Approved','Reviewed','Reported')  -- explicit approval paths
    --   OR
    --   (b) ALL its result_values have verify_status = 'approved'  -- analyte-level approval
    --       (covers calculated-parameter panels where results.status stays 'Reviewed')
    SELECT COUNT(DISTINCT r.id) INTO v_approved_results
    FROM results r
    WHERE r.order_id = v_order_id
      AND (
            r.status IN ('Approved', 'Reviewed', 'Reported')
            OR (
                -- All result_values for this result are approved
                NOT EXISTS (
                    SELECT 1 FROM result_values rv
                    WHERE rv.result_id = r.id
                      AND (rv.verify_status IS NULL OR rv.verify_status != 'approved')
                )
                AND EXISTS (
                    SELECT 1 FROM result_values rv
                    WHERE rv.result_id = r.id
                )
            )
      );

    -- Advance: In Progress → Pending Approval (all results have values)
    IF v_current_status = 'In Progress'
       AND v_completed_results >= v_total_tests
       AND v_total_tests > 0
    THEN
        UPDATE orders
        SET status            = 'Pending Approval',
            status_updated_at = NOW(),
            status_updated_by = 'System (Auto)'
        WHERE id = v_order_id;

    -- Advance: Pending Approval → Completed (all results approved)
    ELSIF v_current_status = 'Pending Approval'
          AND v_approved_results >= v_total_tests
          AND v_total_tests > 0
    THEN
        UPDATE orders
        SET status            = 'Completed',
            status_updated_at = NOW(),
            status_updated_by = 'System (Auto)'
        WHERE id = v_order_id;
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Re-attach triggers (they already exist, this is a safety re-create)
DROP TRIGGER IF EXISTS trigger_auto_update_order_status_on_result ON public.results;
CREATE TRIGGER trigger_auto_update_order_status_on_result
    AFTER INSERT OR UPDATE ON public.results
    FOR EACH ROW EXECUTE FUNCTION public.auto_update_order_status();

DROP TRIGGER IF EXISTS trigger_auto_update_order_status_on_result_values ON public.result_values;
CREATE TRIGGER trigger_auto_update_order_status_on_result_values
    AFTER INSERT OR UPDATE ON public.result_values
    FOR EACH ROW EXECUTE FUNCTION public.auto_update_order_status();

-- Also fix check_and_update_order_status (used by frontend direct calls)
CREATE OR REPLACE FUNCTION public.check_and_update_order_status(p_order_id UUID)
RETURNS JSON AS $$
DECLARE
    order_record        RECORD;
    total_tests         INTEGER;
    results_with_values INTEGER;
    approved_results    INTEGER;
    new_status          VARCHAR(50);
    status_changed      BOOLEAN := FALSE;
    result_json         JSON;
BEGIN
    SELECT o.*, COUNT(DISTINCT ot.id) AS test_count
    INTO order_record
    FROM orders o
    LEFT JOIN order_tests ot ON o.id = ot.order_id
                             AND COALESCE(ot.is_canceled, false) = false
    WHERE o.id = p_order_id
    GROUP BY o.id, o.patient_id, o.patient_name, o.status, o.priority,
             o.order_date, o.expected_date, o.doctor, o.total_amount,
             o.created_by, o.created_at, o.updated_at;

    IF NOT FOUND THEN
        RETURN json_build_object('error', 'Order not found');
    END IF;

    total_tests := order_record.test_count;

    -- Results with at least one non-empty value
    SELECT COUNT(DISTINCT r.id)
    INTO results_with_values
    FROM results r
    INNER JOIN result_values rv ON r.id = rv.result_id
                                AND rv.value IS NOT NULL
                                AND rv.value != ''
    WHERE r.order_id = p_order_id;

    -- Approved: status IN approved set OR all result_values approved
    SELECT COUNT(DISTINCT r.id)
    INTO approved_results
    FROM results r
    WHERE r.order_id = p_order_id
      AND (
            r.status IN ('Approved', 'Reviewed', 'Reported')
            OR (
                NOT EXISTS (
                    SELECT 1 FROM result_values rv
                    WHERE rv.result_id = r.id
                      AND (rv.verify_status IS NULL OR rv.verify_status != 'approved')
                )
                AND EXISTS (
                    SELECT 1 FROM result_values rv WHERE rv.result_id = r.id
                )
            )
      );

    new_status := order_record.status;

    IF order_record.status = 'In Progress'
       AND results_with_values >= total_tests
       AND total_tests > 0
    THEN
        new_status := 'Pending Approval';

    ELSIF order_record.status = 'Pending Approval'
          AND approved_results >= total_tests
          AND total_tests > 0
    THEN
        new_status := 'Completed';
    END IF;

    IF new_status != order_record.status THEN
        UPDATE orders
        SET status            = new_status,
            status_updated_at = NOW(),
            status_updated_by = 'System (Auto)'
        WHERE id = p_order_id;

        status_changed := TRUE;

        INSERT INTO patient_activity_log (
            patient_id, order_id, activity_type, description, metadata, performed_at
        ) VALUES (
            order_record.patient_id,
            p_order_id,
            'status_auto_updated',
            'Order status automatically updated from ' || order_record.status || ' to ' || new_status,
            json_build_object(
                'previous_status',    order_record.status,
                'new_status',         new_status,
                'total_tests',        total_tests,
                'results_with_values', results_with_values,
                'approved_results',   approved_results
            ),
            NOW()
        );
    END IF;

    RETURN json_build_object(
        'order_id',           p_order_id,
        'previous_status',    order_record.status,
        'new_status',         new_status,
        'status_changed',     status_changed,
        'total_tests',        total_tests,
        'results_with_values', results_with_values,
        'approved_results',   approved_results
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Backfill: fix any orders currently stuck at 'Pending Approval'
-- where all result_values are already approved
DO $$
DECLARE
    rec RECORD;
BEGIN
    FOR rec IN
        SELECT DISTINCT o.id
        FROM orders o
        JOIN results r ON r.order_id = o.id
        WHERE o.status = 'Pending Approval'
          AND r.status IN ('Approved', 'Reviewed', 'Reported')
          AND NOT EXISTS (
              SELECT 1 FROM result_values rv
              WHERE rv.result_id = r.id
                AND (rv.verify_status IS NULL OR rv.verify_status != 'approved')
          )
          AND EXISTS (
              SELECT 1 FROM result_values rv WHERE rv.result_id = r.id
          )
    LOOP
        PERFORM public.check_and_update_order_status(rec.id);
    END LOOP;
END $$;
