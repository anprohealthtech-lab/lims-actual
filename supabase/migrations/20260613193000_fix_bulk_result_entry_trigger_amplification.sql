-- Prevent result-entry bulk inserts from recursively doing panel and order
-- rollups once per analyte row. The bulk RPC supplies panel keys directly and
-- its statement trigger can synchronize verification once for all rows.

CREATE INDEX IF NOT EXISTS idx_order_test_groups_order_test_group
  ON public.order_test_groups(order_id, test_group_id);

CREATE OR REPLACE FUNCTION public._bump_order_status_on_result_values()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_order_id UUID;
BEGIN
  IF current_setting('app.bulk_result_entry', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  v_order_id := COALESCE(NEW.order_id, OLD.order_id);
  IF v_order_id IS NULL THEN
    SELECT r.order_id
      INTO v_order_id
      FROM public.results r
     WHERE r.id = COALESCE(NEW.result_id, OLD.result_id);
  END IF;

  IF v_order_id IS NOT NULL THEN
    PERFORM public.recalc_order_status(v_order_id);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION public._bump_order_status_on_results()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_order_id UUID;
BEGIN
  IF current_setting('app.bulk_result_entry', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  v_order_id := COALESCE(NEW.order_id, OLD.order_id);
  IF v_order_id IS NOT NULL THEN
    PERFORM public.recalc_order_status(v_order_id);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION public.tr_sync_result_verification()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('app.bulk_result_entry', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  UPDATE public.results r
     SET manually_verified = sub.all_ok,
         verification_status = CASE
           WHEN sub.expected = 0 THEN 'pending_verification'
           WHEN sub.approved = 0 THEN 'pending_verification'
           WHEN sub.approved < sub.expected THEN 'needs_clarification'
           ELSE 'verified'
         END,
         verified_at = CASE
           WHEN sub.all_ok AND r.verified_at IS NULL THEN now()
           ELSE r.verified_at
         END
    FROM (
      SELECT
        rv.result_id,
        COUNT(*) AS expected,
        COUNT(*) FILTER (
          WHERE COALESCE(rv.verify_status, 'pending') = 'approved'
        ) AS approved,
        BOOL_AND(
          COALESCE(rv.verify_status, 'pending') = 'approved'
        ) AS all_ok
      FROM public.result_values rv
      WHERE rv.result_id = COALESCE(NEW.result_id, OLD.result_id)
      GROUP BY rv.result_id
    ) sub
   WHERE r.id = sub.result_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_rollup_result_verification()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('app.bulk_result_entry', true) = 'on' THEN
    RETURN NEW;
  END IF;

  UPDATE public.results r
     SET verification_status = CASE
           WHEN x.pending_analytes = 0
             AND x.rejected_analytes = 0
             AND x.expected_analytes > 0
             THEN 'verified'
           WHEN x.rejected_analytes > 0
             THEN 'needs_clarification'
           ELSE 'pending_verification'
         END,
         verified_at = CASE
           WHEN x.pending_analytes = 0
             AND x.rejected_analytes = 0
             AND x.expected_analytes > 0
             THEN NOW()
           ELSE r.verified_at
         END
    FROM public.v_result_panel_progress x
   WHERE x.result_id = r.id
     AND r.id = NEW.result_id;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.rv_inherit_panel_keys()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- save_result_entry_bulk provides these keys in its INSERT already. Avoid an
  -- UPDATE of every freshly inserted row and the second trigger cascade.
  IF current_setting('app.bulk_result_entry', true) = 'on' THEN
    RETURN NEW;
  END IF;

  UPDATE public.result_values rv
     SET order_test_id = r.order_test_id,
         test_group_id = r.test_group_id,
         lab_id = r.lab_id
    FROM public.results r
   WHERE r.id = COALESCE(NEW.result_id, rv.result_id)
     AND rv.id = COALESCE(NEW.id, rv.id);

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.auto_update_order_status_for_result_values_statement()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  rec RECORD;
BEGIN
  IF current_setting('app.bulk_result_entry', true) = 'on' THEN
    -- Replace the per-row tr_sync_result_verification work with one aggregate
    -- update per affected result after the complete INSERT statement.
    WITH affected_results AS (
      SELECT DISTINCT nr.result_id
      FROM new_rows nr
      WHERE nr.result_id IS NOT NULL
    ),
    verification AS (
      SELECT
        rv.result_id,
        COUNT(*) AS expected,
        COUNT(*) FILTER (
          WHERE COALESCE(rv.verify_status, 'pending') = 'approved'
        ) AS approved,
        BOOL_AND(
          COALESCE(rv.verify_status, 'pending') = 'approved'
        ) AS all_ok
      FROM public.result_values rv
      JOIN affected_results ar ON ar.result_id = rv.result_id
      GROUP BY rv.result_id
    )
    UPDATE public.results r
       SET manually_verified = v.all_ok,
           verification_status = CASE
             WHEN v.expected = 0 OR v.approved = 0
               THEN 'pending_verification'
             WHEN v.approved < v.expected
               THEN 'needs_clarification'
             ELSE 'verified'
           END,
           verified_at = CASE
             WHEN v.all_ok AND r.verified_at IS NULL THEN now()
             ELSE r.verified_at
           END
      FROM verification v
     WHERE r.id = v.result_id;

    RETURN NULL;
  END IF;

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

COMMENT ON FUNCTION public.auto_update_order_status_for_result_values_statement()
IS 'Synchronizes result verification once per bulk statement and recalculates order status once per order for regular writes.';
