-- Save multi-panel result entry in one transaction.
--
-- The UI previously issued one results upsert, result_values delete, and
-- result_values insert per test group. Each statement recalculated the status
-- of the same order, so latency grew with the number of panels.

CREATE INDEX IF NOT EXISTS idx_order_tests_order_test_group
  ON public.order_tests(order_id, test_group_id);

CREATE INDEX IF NOT EXISTS idx_results_order_test
  ON public.results(order_id, order_test_id);

CREATE INDEX IF NOT EXISTS idx_result_values_result_analyte
  ON public.result_values(result_id, analyte_id);

CREATE INDEX IF NOT EXISTS idx_result_values_result_lab_analyte
  ON public.result_values(result_id, lab_analyte_id);

-- This older trigger duplicates trigger_auto_update_order_status_on_result and
-- causes a second order-wide status scan for every results insert/update.
DROP TRIGGER IF EXISTS trigger_results_status_check ON public.results;

CREATE OR REPLACE FUNCTION public.auto_update_order_status()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_order_id UUID;
BEGIN
    IF current_setting('app.bulk_result_entry', true) = 'on' THEN
        RETURN COALESCE(NEW, OLD);
    END IF;

    IF TG_TABLE_NAME = 'results' THEN
        v_order_id := COALESCE(NEW.order_id, OLD.order_id);
    ELSIF TG_TABLE_NAME = 'result_values' THEN
        SELECT r.order_id
          INTO v_order_id
          FROM public.results r
         WHERE r.id = COALESCE(NEW.result_id, OLD.result_id);
    END IF;

    IF v_order_id IS NOT NULL THEN
        PERFORM public.check_and_update_order_status(v_order_id);
    END IF;

    RETURN COALESCE(NEW, OLD);
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

CREATE OR REPLACE FUNCTION public.save_result_entry_bulk(
  p_order_id UUID,
  p_patient_id UUID,
  p_patient_name TEXT,
  p_lab_id UUID,
  p_entered_by TEXT,
  p_auto_verify BOOLEAN,
  p_groups JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_group JSONB;
  v_value JSONB;
  v_result_id UUID;
  v_result_status TEXT;
  v_verification_status TEXT;
  v_is_locked BOOLEAN;
  v_locked_mode TEXT;
  v_values JSONB := '[]'::JSONB;
  v_result_map JSONB := '[]'::JSONB;
  v_saved_result_ids UUID[] := ARRAY[]::UUID[];
  v_locked_result_ids UUID[] := ARRAY[]::UUID[];
  v_inserted_result_ids UUID[];
  v_inserted_count INTEGER := 0;
  v_verified_at TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF p_groups IS NULL OR jsonb_typeof(p_groups) <> 'array' THEN
    RAISE EXCEPTION 'p_groups must be a JSON array';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.orders o
     WHERE o.id = p_order_id
       AND o.lab_id = p_lab_id
  ) THEN
    RAISE EXCEPTION 'Order does not belong to the supplied lab';
  END IF;

  -- Prevent simultaneous submissions for the same order from interleaving.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_order_id::TEXT, 0));
  PERFORM set_config('app.bulk_result_entry', 'on', true);

  FOR v_group IN SELECT value FROM jsonb_array_elements(p_groups)
  LOOP
    IF jsonb_typeof(v_group->'values') <> 'array' THEN
      RAISE EXCEPTION 'Each group values field must be a JSON array';
    END IF;

    SELECT r.id, r.status::TEXT, r.verification_status
      INTO v_result_id, v_result_status, v_verification_status
      FROM public.results r
     WHERE r.order_id = p_order_id
       AND (
         (NULLIF(v_group->>'order_test_group_id', '') IS NOT NULL
           AND r.order_test_group_id = (v_group->>'order_test_group_id')::UUID)
         OR
         (NULLIF(v_group->>'order_test_id', '') IS NOT NULL
           AND r.order_test_id = (v_group->>'order_test_id')::UUID)
         OR
         (NULLIF(v_group->>'test_group_id', '') IS NOT NULL
           AND r.test_group_id = (v_group->>'test_group_id')::UUID)
         OR r.test_name = v_group->>'test_name'
       )
     ORDER BY
       CASE
         WHEN NULLIF(v_group->>'order_test_group_id', '') IS NOT NULL
           AND r.order_test_group_id = (v_group->>'order_test_group_id')::UUID THEN 1
         WHEN NULLIF(v_group->>'order_test_id', '') IS NOT NULL
           AND r.order_test_id = (v_group->>'order_test_id')::UUID THEN 2
         WHEN NULLIF(v_group->>'test_group_id', '') IS NOT NULL
           AND r.test_group_id = (v_group->>'test_group_id')::UUID THEN 3
         ELSE 4
       END
     LIMIT 1;

    IF v_result_id IS NULL THEN
      INSERT INTO public.results (
        order_id,
        patient_id,
        patient_name,
        test_name,
        status,
        verification_status,
        entered_by,
        entered_date,
        test_group_id,
        lab_id,
        extracted_by_ai,
        ai_confidence,
        attachment_id,
        order_test_group_id,
        order_test_id,
        verified_at,
        verified_by,
        notes
      ) VALUES (
        p_order_id,
        p_patient_id,
        p_patient_name,
        v_group->>'test_name',
        (CASE WHEN p_auto_verify THEN 'Reviewed' ELSE 'pending_verification' END)::result_status,
        CASE WHEN p_auto_verify THEN 'verified' ELSE 'pending_verification' END,
        COALESCE(NULLIF(p_entered_by, ''), 'Unknown'),
        CURRENT_DATE,
        NULLIF(v_group->>'test_group_id', '')::UUID,
        p_lab_id,
        COALESCE((v_group->>'extracted_by_ai')::BOOLEAN, false),
        NULLIF(v_group->>'ai_confidence', '')::NUMERIC,
        NULLIF(v_group->>'attachment_id', '')::UUID,
        NULLIF(v_group->>'order_test_group_id', '')::UUID,
        NULLIF(v_group->>'order_test_id', '')::UUID,
        CASE WHEN p_auto_verify THEN v_verified_at ELSE NULL END,
        CASE WHEN p_auto_verify THEN auth.uid() ELSE NULL END,
        NULLIF(v_group->>'notes', '')
      )
      ON CONFLICT (order_id, test_name) DO UPDATE
      SET test_group_id = COALESCE(EXCLUDED.test_group_id, results.test_group_id),
          lab_id = COALESCE(EXCLUDED.lab_id, results.lab_id),
          order_test_group_id = COALESCE(EXCLUDED.order_test_group_id, results.order_test_group_id),
          order_test_id = COALESCE(EXCLUDED.order_test_id, results.order_test_id),
          notes = EXCLUDED.notes
      RETURNING id, status::TEXT, verification_status
      INTO v_result_id, v_result_status, v_verification_status;
    END IF;

    v_is_locked :=
      COALESCE(v_result_status, '') IN ('Approved', 'Reviewed', 'Reported', 'approved', 'verified')
      OR COALESCE(v_verification_status, '') = 'verified';
    v_locked_mode := COALESCE(NULLIF(v_group->>'locked_mode', ''), 'skip');

    v_result_map := v_result_map || jsonb_build_array(jsonb_build_object(
      'test_group_id', v_group->>'test_group_id',
      'result_id', v_result_id,
      'locked', v_is_locked
    ));
    v_saved_result_ids := array_append(v_saved_result_ids, v_result_id);

    IF v_is_locked AND v_locked_mode = 'skip' THEN
      v_result_id := NULL;
      CONTINUE;
    END IF;

    UPDATE public.results
       SET notes = NULLIF(v_group->>'notes', '')
     WHERE id = v_result_id;

    IF v_is_locked AND v_locked_mode = 'insert_missing' THEN
      v_locked_result_ids := array_append(v_locked_result_ids, v_result_id);
    END IF;

    FOR v_value IN SELECT value FROM jsonb_array_elements(v_group->'values')
    LOOP
      v_values := v_values || jsonb_build_array(
        v_value || jsonb_build_object(
          'result_id', v_result_id,
          'write_mode', CASE WHEN v_is_locked THEN 'insert_missing' ELSE 'replace' END,
          'test_group_id', v_group->>'test_group_id',
          'order_test_group_id', v_group->>'order_test_group_id',
          'order_test_id', v_group->>'order_test_id'
        )
      );
    END LOOP;

    v_result_id := NULL;
  END LOOP;

  IF jsonb_array_length(v_values) > 0 THEN
    WITH payload AS (
      SELECT
        NULLIF(item->>'result_id', '')::UUID AS result_id,
        NULLIF(item->>'analyte_id', '')::UUID AS analyte_id,
        NULLIF(item->>'lab_analyte_id', '')::UUID AS lab_analyte_id,
        item->>'parameter' AS parameter
      FROM jsonb_array_elements(v_values) AS values_json(item)
      WHERE item->>'write_mode' = 'replace'
    )
    DELETE FROM public.result_values rv
    USING payload p
    WHERE rv.result_id = p.result_id
      AND (
        (p.analyte_id IS NOT NULL AND rv.analyte_id = p.analyte_id)
        OR
        (p.analyte_id IS NULL AND p.lab_analyte_id IS NOT NULL
          AND rv.lab_analyte_id = p.lab_analyte_id)
        OR
        (p.analyte_id IS NULL AND p.lab_analyte_id IS NULL
          AND rv.parameter = p.parameter)
      );

    WITH payload AS (
      SELECT item
      FROM jsonb_array_elements(v_values) AS values_json(item)
    ),
    inserted AS (
      INSERT INTO public.result_values (
        result_id,
        analyte_id,
        lab_analyte_id,
        analyte_name,
        parameter,
        value,
        unit,
        reference_range,
        flag,
        flag_source,
        is_auto_calculated,
        verify_status,
        verified,
        verified_by,
        verified_at,
        verify_note,
        is_hidden_from_report,
        hidden_reason,
        order_id,
        test_group_id,
        lab_id,
        order_test_group_id,
        order_test_id
      )
      SELECT
        (item->>'result_id')::UUID,
        NULLIF(item->>'analyte_id', '')::UUID,
        NULLIF(item->>'lab_analyte_id', '')::UUID,
        COALESCE(item->>'analyte_name', item->>'parameter'),
        item->>'parameter',
        NULLIF(item->>'value', ''),
        COALESCE(item->>'unit', ''),
        COALESCE(item->>'reference_range', ''),
        NULLIF(item->>'flag', ''),
        NULLIF(item->>'flag_source', ''),
        COALESCE((item->>'is_auto_calculated')::BOOLEAN, false),
        COALESCE(NULLIF(item->>'verify_status', ''), 'pending'),
        COALESCE((item->>'verified')::BOOLEAN, false),
        NULLIF(item->>'verified_by', '')::UUID,
        NULLIF(item->>'verified_at', '')::TIMESTAMPTZ,
        NULLIF(item->>'verify_note', ''),
        COALESCE((item->>'is_hidden_from_report')::BOOLEAN, false),
        NULLIF(item->>'hidden_reason', ''),
        p_order_id,
        NULLIF(item->>'test_group_id', '')::UUID,
        p_lab_id,
        NULLIF(item->>'order_test_group_id', '')::UUID,
        NULLIF(item->>'order_test_id', '')::UUID
      FROM payload
      WHERE item->>'write_mode' = 'replace'
         OR NOT EXISTS (
           SELECT 1
             FROM public.result_values rv
            WHERE rv.result_id = (item->>'result_id')::UUID
              AND (
                (NULLIF(item->>'analyte_id', '') IS NOT NULL
                  AND rv.analyte_id = (item->>'analyte_id')::UUID)
                OR
                (NULLIF(item->>'analyte_id', '') IS NULL
                  AND NULLIF(item->>'lab_analyte_id', '') IS NOT NULL
                  AND rv.lab_analyte_id = (item->>'lab_analyte_id')::UUID)
                OR
                (NULLIF(item->>'analyte_id', '') IS NULL
                  AND NULLIF(item->>'lab_analyte_id', '') IS NULL
                  AND rv.parameter = item->>'parameter')
              )
         )
      RETURNING result_id
    )
    SELECT COUNT(*), ARRAY_AGG(DISTINCT result_id)
      INTO v_inserted_count, v_inserted_result_ids
      FROM inserted;
  END IF;

  IF COALESCE(array_length(v_locked_result_ids, 1), 0) > 0
     AND COALESCE(array_length(v_inserted_result_ids, 1), 0) > 0 THEN
    UPDATE public.results
       SET is_locked = false,
           locked_reason = NULL
     WHERE id = ANY(v_locked_result_ids)
       AND id = ANY(v_inserted_result_ids);
  END IF;

  IF p_auto_verify AND COALESCE(array_length(v_saved_result_ids, 1), 0) > 0 THEN
    UPDATE public.results
       SET status = 'Reviewed'::result_status,
           verification_status = 'verified',
           verified_at = v_verified_at,
           verified_by = auth.uid()
     WHERE id = ANY(v_saved_result_ids);
  END IF;

  PERFORM set_config('app.bulk_result_entry', 'off', true);
  PERFORM public.check_and_update_order_status(p_order_id);

  RETURN jsonb_build_object(
    'result_ids', v_result_map,
    'inserted_count', v_inserted_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.save_result_entry_bulk(
  UUID, UUID, TEXT, UUID, TEXT, BOOLEAN, JSONB
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.save_result_entry_bulk(
  UUID, UUID, TEXT, UUID, TEXT, BOOLEAN, JSONB
) TO authenticated;

COMMENT ON FUNCTION public.save_result_entry_bulk(
  UUID, UUID, TEXT, UUID, TEXT, BOOLEAN, JSONB
) IS 'Atomically saves all result panels for one order and recalculates order status once.';
