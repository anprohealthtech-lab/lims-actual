-- Optimize quick/bulk result entry for panels with many default-prefilled analytes.
--
-- Previously, every inserted/updated result_values row fired auto_update_order_status().
-- A single quick-entry submit can insert dozens or hundreds of rows, so Postgres
-- repeatedly rescanned the same order and could hit statement_timeout.
--
-- Keep the existing row-level trigger on results, but make result_values update order
-- status once per INSERT/UPDATE statement and per affected order.

CREATE INDEX IF NOT EXISTS idx_results_order_id
  ON public.results(order_id);

CREATE INDEX IF NOT EXISTS idx_result_values_order_id
  ON public.result_values(order_id);

CREATE INDEX IF NOT EXISTS idx_result_values_result_status
  ON public.result_values(result_id, verify_status);

CREATE INDEX IF NOT EXISTS idx_result_values_result_nonempty
  ON public.result_values(result_id)
  WHERE value IS NOT NULL AND value <> '';

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

CREATE OR REPLACE FUNCTION public.auto_update_order_status_for_result_values_statement()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT DISTINCT COALESCE(nr.order_id, r.order_id) AS order_id
    FROM new_rows nr
    LEFT JOIN public.results r ON r.id = nr.result_id
    WHERE COALESCE(nr.order_id, r.order_id) IS NOT NULL
  LOOP
    PERFORM public.check_and_update_order_status(rec.order_id);
  END LOOP;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trigger_auto_update_order_status_on_result_values ON public.result_values;
DROP TRIGGER IF EXISTS trigger_auto_update_order_status_on_result_values_insert ON public.result_values;
DROP TRIGGER IF EXISTS trigger_auto_update_order_status_on_result_values_update ON public.result_values;

CREATE TRIGGER trigger_auto_update_order_status_on_result_values_insert
  AFTER INSERT ON public.result_values
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.auto_update_order_status_for_result_values_statement();

CREATE TRIGGER trigger_auto_update_order_status_on_result_values_update
  AFTER UPDATE ON public.result_values
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.auto_update_order_status_for_result_values_statement();

COMMENT ON FUNCTION public.auto_update_order_status_for_result_values_statement() IS
  'Statement-level result_values status rollup used to avoid one full order-status recalculation per analyte row during bulk result entry.';
