-- Fix two timeout-prone paths:
-- 1. Multi-row result_values PATCHes should roll result verification up once per
--    affected result, not through row-amplified verification work.
-- 2. TAT alert queries need a progress view shape that can use lab/status
--    filters before doing result/analyte aggregation.

CREATE INDEX IF NOT EXISTS idx_orders_lab_status_created_active
  ON public.orders(lab_id, status, created_at DESC)
  WHERE status IN ('Order Created', 'Sample Collection', 'In Progress', 'Pending Approval');

CREATE INDEX IF NOT EXISTS idx_order_tests_order_active
  ON public.order_tests(order_id, test_group_id)
  WHERE is_canceled = false;

CREATE INDEX IF NOT EXISTS idx_results_order_test_id
  ON public.results(order_test_id);

CREATE INDEX IF NOT EXISTS idx_result_section_content_nonempty
  ON public.result_section_content(result_id)
  WHERE final_content IS NOT NULL
    AND btrim(final_content) <> '';

CREATE INDEX IF NOT EXISTS idx_test_group_analytes_group_analyte
  ON public.test_group_analytes(test_group_id, analyte_id);

CREATE OR REPLACE FUNCTION public.auto_update_order_status_for_result_values_statement()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  rec RECORD;
BEGIN
  -- Do the result-level approval rollup once per affected result for both the
  -- bulk RPC and direct REST PATCHes such as approving many analytes at once.
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

COMMENT ON FUNCTION public.auto_update_order_status_for_result_values_statement()
IS 'Synchronizes result verification once per changed result and recalculates order status once per order for direct result_values writes.';

-- These row-level verification triggers duplicate the statement-level rollup
-- above. On bulk approval they run once per analyte row; the production plan
-- showed ~21s in tr_sync_result_verification_upd and ~8s in
-- trg_rollup_result_verification for only 18 result_values.
DROP TRIGGER IF EXISTS tr_sync_result_verification_ins ON public.result_values;
DROP TRIGGER IF EXISTS tr_sync_result_verification_upd ON public.result_values;
DROP TRIGGER IF EXISTS tr_sync_result_verification ON public.result_values;
DROP TRIGGER IF EXISTS trg_rollup_result_verification_ins ON public.result_values;
DROP TRIGGER IF EXISTS trg_rollup_result_verification_upd ON public.result_values;
DROP TRIGGER IF EXISTS trg_rollup_result_verification ON public.result_values;

DROP VIEW IF EXISTS public.v_order_test_progress_enhanced CASCADE;

CREATE VIEW public.v_order_test_progress_enhanced AS
SELECT
    o.id AS order_id,
    o.order_number,
    o.patient_id,
    o.patient_name,
    o.sample_id,
    o.color_code,
    o.color_name,
    o.status AS order_status,
    o.priority,
    o.order_date,
    o.created_at,
    o.sample_collected_at,
    o.sample_received_at,
    COALESCE(o.sample_collected_at, o.created_at) AS work_date,
    o.lab_id,
    o.location_id,
    ot.id AS order_test_id,
    tg.id AS test_group_id,
    tg.name AS test_group_name,
    tg.department,
    tg.tat_hours,
    tg.sample_type,
    tg.sample_color,
    COALESCE(tg.is_section_only, false) AS is_section_only,
    COALESCE(section_stats.has_section_content, false) AS has_section_content,
    section_stats.verification_status AS section_verification_status,
    section_stats.verified_at AS section_verified_at,

    CASE
      WHEN COALESCE(tg.is_section_only, false) THEN 1
      ELSE COALESCE(analyte_stats.total_analytes, 0)
    END AS total_analytes,

    CASE
      WHEN COALESCE(tg.is_section_only, false) THEN 1
      ELSE COALESCE(analyte_stats.total_analytes, 0)
    END AS expected_analytes,

    CASE
      WHEN COALESCE(tg.is_section_only, false) THEN
        CASE WHEN COALESCE(section_stats.has_section_content, false) THEN 1 ELSE 0 END
      ELSE COALESCE(analyte_stats.entered_analytes, 0)
    END AS completed_analytes,

    CASE
      WHEN COALESCE(tg.is_section_only, false) THEN
        CASE WHEN COALESCE(section_stats.has_section_content, false) THEN 1 ELSE 0 END
      ELSE COALESCE(analyte_stats.entered_analytes, 0)
    END AS entered_analytes,

    CASE
      WHEN COALESCE(tg.is_section_only, false) THEN
        CASE
          WHEN section_stats.verification_status = 'verified' THEN 'verified'
          WHEN COALESCE(section_stats.has_section_content, false) THEN 'pending_approval'
          ELSE 'not_started'
        END
      WHEN COALESCE(analyte_stats.entered_analytes, 0) = 0 THEN 'not_started'
      WHEN COALESCE(analyte_stats.entered_analytes, 0) < COALESCE(analyte_stats.total_analytes, 0) THEN 'in_progress'
      ELSE 'completed'
    END AS panel_status,

    CASE
      WHEN COALESCE(tg.is_section_only, false) THEN
        COALESCE(section_stats.verification_status = 'verified', false)
      WHEN COALESCE(analyte_stats.total_analytes, 0) > 0
        AND COALESCE(analyte_stats.verified_analytes, 0) = COALESCE(analyte_stats.total_analytes, 0)
        THEN true
      ELSE false
    END AS is_verified,

    CASE
      WHEN COALESCE(tg.is_section_only, false) THEN
        CASE WHEN COALESCE(section_stats.has_section_content, false) THEN 100 ELSE 0 END
      WHEN COALESCE(analyte_stats.total_analytes, 0) > 0 THEN
        ROUND((COALESCE(analyte_stats.entered_analytes, 0)::numeric / analyte_stats.total_analytes::numeric) * 100, 0)
      ELSE 0
    END AS completion_percentage,

    CASE
      WHEN COALESCE(tg.is_section_only, false) THEN false
      WHEN COALESCE(analyte_stats.entered_analytes, 0) = 0
           AND EXISTS (
              SELECT 1
              FROM public.test_workflow_map m
              JOIN public.workflow_versions wv ON m.workflow_version_id = wv.id
              JOIN public.workflows w ON wv.workflow_id = w.id
              WHERE m.lab_id = o.lab_id
                AND (m.test_group_id = tg.id OR m.test_code = tg.code::text)
                AND COALESCE(w.active, true) = true
                AND COALESCE(wv.active, true) = true
           ) THEN true
      ELSE false
    END AS workflow_eligible,

    COALESCE(result_stats.entered_count, 0) AS entered_count,
    COALESCE(result_stats.under_review_count, 0) AS under_review_count,
    COALESCE(result_stats.approved_count, 0) AS approved_count,
    COALESCE(result_stats.reported_count, 0) AS reported_count,
    COALESCE(analyte_stats.critical_count, 0) AS critical_count,
    COALESCE(analyte_stats.abnormal_count, 0) AS abnormal_count,

    GREATEST(
        o.created_at,
        COALESCE(result_stats.max_entered_date, o.created_at),
        COALESCE(result_stats.max_reviewed_date, o.created_at)
    ) AS last_activity,

    (EXTRACT(EPOCH FROM (now() - o.created_at)) / 3600)::numeric AS hours_since_order,
    COALESCE(o.sample_received_at, o.sample_collected_at) AS tat_start_time,

    CASE
        WHEN tg.tat_hours IS NOT NULL AND COALESCE(o.sample_received_at, o.sample_collected_at) IS NOT NULL
            THEN tg.tat_hours - (EXTRACT(EPOCH FROM (now() - COALESCE(o.sample_received_at, o.sample_collected_at))) / 3600)::numeric
        ELSE NULL
    END AS hours_until_tat_breach,

    CASE
        WHEN tg.tat_hours IS NOT NULL AND COALESCE(o.sample_received_at, o.sample_collected_at) IS NOT NULL
            AND now() > (COALESCE(o.sample_received_at, o.sample_collected_at) + (tg.tat_hours || ' hours')::interval)
            THEN true
        ELSE false
    END AS is_tat_breached

FROM public.orders o
JOIN public.order_tests ot
  ON o.id = ot.order_id
 AND COALESCE(ot.is_canceled, false) = false
JOIN public.test_groups tg ON ot.test_group_id = tg.id

LEFT JOIN LATERAL (
  SELECT
    COUNT(*) FILTER (WHERE r.status = 'Entered') AS entered_count,
    COUNT(*) FILTER (WHERE r.status = 'Under Review') AS under_review_count,
    COUNT(*) FILTER (WHERE r.status = 'Approved') AS approved_count,
    COUNT(*) FILTER (WHERE r.status = 'Reported') AS reported_count,
    MAX(r.entered_date)::timestamptz AS max_entered_date,
    MAX(r.reviewed_date)::timestamptz AS max_reviewed_date
  FROM public.results r
  WHERE r.order_test_id = ot.id
) result_stats ON true

LEFT JOIN LATERAL (
  SELECT
    COUNT(DISTINCT tga.analyte_id) AS total_analytes,
    COUNT(DISTINCT CASE
      WHEN rv.value IS NOT NULL AND rv.value <> ''
      THEN tga.analyte_id
    END) AS entered_analytes,
    COUNT(DISTINCT CASE
      WHEN rv.verify_status = 'approved'
       AND rv.value IS NOT NULL
       AND rv.value <> ''
      THEN tga.analyte_id
    END) AS verified_analytes,
    COUNT(DISTINCT CASE WHEN rv.flag::text = 'C' THEN r.id END) AS critical_count,
    COUNT(DISTINCT CASE WHEN rv.flag::text IN ('H','L','C') THEN r.id END) AS abnormal_count
  FROM public.test_group_analytes tga
  LEFT JOIN public.results r
    ON r.order_test_id = ot.id
  LEFT JOIN public.result_values rv
    ON rv.result_id = r.id
   AND rv.analyte_id = tga.analyte_id
  WHERE tga.test_group_id = tg.id
) analyte_stats ON true

LEFT JOIN LATERAL (
  SELECT
    true AS has_section_content,
    r.verification_status,
    r.verified_at
  FROM public.results r
  WHERE r.order_test_id = ot.id
    AND EXISTS (
      SELECT 1
      FROM public.result_section_content rsc
      WHERE rsc.result_id = r.id
        AND rsc.final_content IS NOT NULL
        AND btrim(rsc.final_content) <> ''
    )
  ORDER BY r.verified_at DESC NULLS LAST, r.created_at DESC
  LIMIT 1
) section_stats ON true

ORDER BY
    CASE o.priority
        WHEN 'STAT' THEN 1
        WHEN 'Urgent' THEN 2
        ELSE 3
    END,
    o.order_date DESC;

GRANT SELECT ON public.v_order_test_progress_enhanced TO authenticated;
GRANT SELECT ON public.v_order_test_progress_enhanced TO anon;

COMMENT ON VIEW public.v_order_test_progress_enhanced IS
'Order test progress view optimized for lab/status filtered worklists and TAT alerts, with section-only test support.';
