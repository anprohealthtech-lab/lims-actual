-- Follow-up for quick-result timeout optimization.
-- Some databases have orders.status as the order_status enum. The status RPC must
-- compare against text explicitly and cast back to order_status only when updating.

CREATE OR REPLACE FUNCTION public.check_and_update_order_status(p_order_id UUID)
RETURNS JSON AS $$
DECLARE
    order_record        RECORD;
    total_tests         INTEGER;
    results_with_values INTEGER;
    approved_results    INTEGER;
    new_status          TEXT;
    status_changed      BOOLEAN := FALSE;
BEGIN
    SELECT o.*, COUNT(DISTINCT ot.id) AS test_count
    INTO order_record
    FROM orders o
    LEFT JOIN order_tests ot ON o.id = ot.order_id
                             AND COALESCE(ot.is_canceled, false) = false
    WHERE o.id = p_order_id
    GROUP BY o.id;

    IF NOT FOUND THEN
        RETURN json_build_object('error', 'Order not found');
    END IF;

    total_tests := order_record.test_count;

    SELECT COUNT(DISTINCT r.id)
    INTO results_with_values
    FROM results r
    INNER JOIN result_values rv ON r.id = rv.result_id
                                AND rv.value IS NOT NULL
                                AND rv.value <> ''
    WHERE r.order_id = p_order_id;

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
                      AND (rv.verify_status IS NULL OR rv.verify_status <> 'approved')
                )
                AND EXISTS (
                    SELECT 1 FROM result_values rv WHERE rv.result_id = r.id
                )
            )
      );

    new_status := order_record.status::text;

    IF order_record.status::text IN ('Sample Collection', 'Sample Collected', 'In Progress')
       AND results_with_values >= total_tests
       AND total_tests > 0
    THEN
        new_status := 'Pending Approval';

    ELSIF order_record.status::text = 'Pending Approval'
          AND approved_results >= total_tests
          AND total_tests > 0
    THEN
        new_status := 'Completed';
    END IF;

    IF new_status IS DISTINCT FROM order_record.status::text THEN
        UPDATE orders
        SET status            = new_status::order_status,
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
            'Order status automatically updated from ' || order_record.status::text || ' to ' || new_status,
            json_build_object(
                'previous_status',     order_record.status::text,
                'new_status',          new_status,
                'total_tests',         total_tests,
                'results_with_values', results_with_values,
                'approved_results',    approved_results
            ),
            NOW()
        );
    END IF;

    RETURN json_build_object(
        'order_id',             p_order_id,
        'previous_status',      order_record.status::text,
        'new_status',           new_status,
        'status_changed',       status_changed,
        'total_tests',          total_tests,
        'results_with_values',  results_with_values,
        'approved_results',     approved_results
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
