-- Add per-analyte report visibility controls.
-- Hidden analytes remain stored for calculations and internal review, but are
-- treated as handled for verification/report readiness and excluded from report output.

ALTER TABLE public.result_values
  ADD COLUMN IF NOT EXISTS is_hidden_from_report boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hidden_reason text;

COMMENT ON COLUMN public.result_values.is_hidden_from_report IS
  'When true, the analyte is hidden from final report output while remaining available internally.';

COMMENT ON COLUMN public.result_values.hidden_reason IS
  'Optional internal reason for hiding the analyte from report output.';

DROP VIEW IF EXISTS public.v_result_panel_status CASCADE;

CREATE OR REPLACE VIEW public.v_result_panel_status AS
WITH all_order_tests AS (
  SELECT
    ot.id AS order_test_id,
    ot.order_id,
    ot.test_group_id,
    tg.name AS test_group_name,
    tg.is_section_only,
    o.patient_id,
    p.name AS patient_name,
    o.order_date,
    o.lab_id,
    o.location_id
  FROM order_tests ot
  JOIN orders o ON o.id = ot.order_id
  JOIN test_groups tg ON tg.id = ot.test_group_id
  LEFT JOIN patients p ON p.id = o.patient_id
),
latest_results AS (
  SELECT DISTINCT ON (r.order_id, r.test_group_id)
    r.id AS result_id,
    r.order_id,
    r.test_group_id
  FROM results r
  LEFT JOIN result_values rv ON rv.result_id = r.id
  ORDER BY
    r.order_id,
    r.test_group_id,
    CASE WHEN rv.id IS NOT NULL THEN 0 ELSE 1 END,
    r.created_at DESC
),
analyte_counts AS (
  SELECT
    rv.result_id,
    COUNT(*) AS expected_analytes,
    COUNT(CASE WHEN rv.value IS NOT NULL AND rv.value != '' THEN 1 END) AS entered_analytes,
    COUNT(CASE WHEN rv.verify_status = 'approved' THEN 1 END) AS approved_analytes,
    COUNT(CASE WHEN COALESCE(rv.is_hidden_from_report, false) THEN 1 END) AS hidden_analytes,
    COUNT(CASE
      WHEN COALESCE(rv.is_hidden_from_report, false)
        OR rv.verify_status = 'approved'
        OR (rv.value IS NOT NULL AND rv.value != '')
      THEN 1
    END) AS handled_analytes
  FROM result_values rv
  GROUP BY rv.result_id
)
SELECT
  COALESCE(lr.result_id, gen_random_uuid()) AS result_id,
  aot.order_id,
  aot.test_group_id,
  aot.test_group_name,
  COALESCE(ac.expected_analytes, 0) AS expected_analytes,
  COALESCE(ac.entered_analytes, 0) AS entered_analytes,
  COALESCE(ac.approved_analytes, 0) AS approved_analytes,
  COALESCE(ac.hidden_analytes, 0) AS hidden_analytes,
  COALESCE(ac.handled_analytes, 0) AS handled_analytes,
  (
    lr.result_id IS NOT NULL
    AND (
      (NOT aot.is_section_only
        AND COALESCE(ac.expected_analytes, 0) > 0
        AND (COALESCE(ac.approved_analytes, 0) + COALESCE(ac.hidden_analytes, 0)) >= COALESCE(ac.expected_analytes, 1))
      OR aot.is_section_only
    )
  ) AS panel_ready,
  aot.patient_id,
  aot.patient_name,
  aot.order_date,
  aot.lab_id,
  aot.location_id,
  aot.is_section_only
FROM all_order_tests aot
LEFT JOIN latest_results lr
  ON lr.order_id = aot.order_id AND lr.test_group_id = aot.test_group_id
LEFT JOIN analyte_counts ac
  ON ac.result_id = lr.result_id
ORDER BY aot.order_date DESC, aot.patient_name;

GRANT SELECT ON public.v_result_panel_status TO authenticated;
GRANT SELECT ON public.v_result_panel_status TO anon;

DROP VIEW IF EXISTS public.v_report_template_context;

CREATE VIEW public.v_report_template_context AS
SELECT
    o.id AS order_id,
    o.order_number,
    o.order_date,
    o.report_date,
    o.status,
    o.total_amount,
    o.sample_collected_at,
    o.sample_received_at,
    o.sample_id,
    o.color_code,
    o.color_name,
    o.qr_code_data,
    o.created_at AS order_created_at,
    o.lab_id,
    o.patient_id,
    o.location_id,
    o.referring_doctor_id,
    o.approved_by,

    p.name AS patient_name,
    p.display_id AS patient_display_id,
    p.patient_number AS patient_number,
    p.age,
    p.gender,
    p.phone AS patient_phone,
    p.date_of_birth,
    p.registration_date,

    l.name AS location_name,
    d.name AS referring_doctor_name,
    COALESCE(u_collector.name, u_collector.email) AS sample_collected_by,

    (SELECT s.barcode FROM public.samples s WHERE s.order_id = o.id AND s.barcode IS NOT NULL ORDER BY s.created_at LIMIT 1) AS sample_barcode,

    MAX(rv.verified_at) AS approved_at,

    BOOL_AND(
        CASE
            WHEN rv.id IS NULL THEN true
            WHEN COALESCE(rv.is_hidden_from_report, false) THEN true
            WHEN rv.verify_status = 'approved' THEN true
            ELSE false
        END
    ) AS all_analytes_approved,

    jsonb_agg(
        DISTINCT jsonb_build_object(
            'result_id', rv.result_id,
            'analyte_id', rv.analyte_id,
            'parameter', COALESCE(la.display_name, la.lab_specific_name, a.name),
            'value', rv.value,
            'unit', COALESCE(rv.unit, la.lab_specific_unit, a.unit),
            'method', COALESCE(rv.method, la.lab_specific_method, la.method),
            'reference_range', COALESCE(rv.reference_range, la.lab_specific_reference_range, a.reference_range),
            'flag', rv.flag,
            'verify_status', rv.verify_status,
            'test_group_id', tg.id,
            'test_name', tg.name,
            'normal_range_min', COALESCE(rv.normal_range_min, la.normal_range_min),
            'normal_range_max', COALESCE(rv.normal_range_max, la.normal_range_max),
            'low_critical', COALESCE(rv.low_critical, la.low_critical, la.critical_low, a.low_critical),
            'high_critical', COALESCE(rv.high_critical, la.high_critical, la.critical_high, a.high_critical),
            'reference_range_male', COALESCE(rv.reference_range_male, la.reference_range_male, a.reference_range_male),
            'reference_range_female', COALESCE(rv.reference_range_female, la.reference_range_female, a.reference_range_female),
            'value_type', COALESCE(rv.value_type, la.value_type, a.value_type),
            'expected_normal_values', COALESCE(la.expected_normal_values, a.expected_normal_values),
            'code', a.code,
            'interpretation_low', COALESCE(la.lab_specific_interpretation_low, la.interpretation_low, a.interpretation_low),
            'interpretation_normal', COALESCE(la.lab_specific_interpretation_normal, la.interpretation_normal, a.interpretation_normal),
            'interpretation_high', COALESCE(la.lab_specific_interpretation_high, la.interpretation_high, a.interpretation_high),
            'ai_interpretation', rv.ai_interpretation,
            'ai_suggested_flag', rv.ai_suggested_flag,
            'ai_suggested_interpretation', rv.ai_suggested_interpretation,
            'is_auto_calculated', rv.is_auto_calculated,
            'is_calculated', a.is_calculated,
            'sort_order', tga.sort_order,
            'section_heading', tga.section_heading
        )
    ) FILTER (WHERE rv.id IS NOT NULL AND NOT COALESCE(rv.is_hidden_from_report, false)) AS analytes,

    array_agg(DISTINCT COALESCE(la.display_name, la.lab_specific_name, a.name))
        FILTER (WHERE a.name IS NOT NULL AND rv.id IS NOT NULL AND NOT COALESCE(rv.is_hidden_from_report, false)) AS analyte_parameters,

    array_agg(DISTINCT tg.id)
        FILTER (WHERE tg.id IS NOT NULL AND rv.id IS NOT NULL AND NOT COALESCE(rv.is_hidden_from_report, false)) AS test_group_ids

FROM orders o
LEFT JOIN patients p ON o.patient_id = p.id
LEFT JOIN locations l ON o.location_id = l.id
LEFT JOIN doctors d ON o.referring_doctor_id = d.id
LEFT JOIN users u_collector ON o.sample_collected_by = u_collector.email
LEFT JOIN order_tests ot ON o.id = ot.order_id
LEFT JOIN test_groups tg ON ot.test_group_id = tg.id
LEFT JOIN test_group_analytes tga ON tg.id = tga.test_group_id
LEFT JOIN analytes a ON tga.analyte_id = a.id
LEFT JOIN lab_analytes la ON a.id = la.analyte_id AND o.lab_id = la.lab_id
LEFT JOIN result_values rv ON rv.order_id = o.id AND rv.analyte_id = a.id

GROUP BY
    o.id, o.order_number, o.order_date, o.report_date, o.status, o.total_amount,
    o.sample_collected_at, o.sample_received_at, o.sample_id,
    o.color_code, o.color_name, o.qr_code_data, o.created_at,
    o.lab_id, o.patient_id, o.location_id, o.referring_doctor_id, o.approved_by,
    p.name, p.display_id, p.patient_number, p.age, p.gender, p.phone,
    p.date_of_birth, p.registration_date,
    l.name, d.name, u_collector.name, u_collector.email;

GRANT SELECT ON public.v_report_template_context TO authenticated;

CREATE OR REPLACE FUNCTION public.get_report_template_context(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  ctx_record RECORD;
  base_placeholders jsonb := '{}';
  lab_placeholders jsonb := '{}';
  analyte_placeholders jsonb := '{}';
  approver_placeholders jsonb := '{}';
  section_content_map jsonb := '{}';
  safe_age integer;
  approver_signature_url text := NULL;
  approver_name text := NULL;
  approver_role text := NULL;
BEGIN
  SELECT * INTO ctx_record
  FROM public.v_report_template_context
  WHERE order_id = p_order_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  safe_age := CASE
    WHEN ctx_record.age IS NULL THEN NULL
    WHEN btrim(ctx_record.age::text) = '' THEN NULL
    WHEN btrim(ctx_record.age::text) ~ '^[0-9]+$' THEN btrim(ctx_record.age::text)::int
    ELSE NULL
  END;

  base_placeholders := jsonb_build_object(
    'patientName', coalesce(ctx_record.patient_name, ''),
    'patientDisplayId', coalesce(ctx_record.patient_display_id, ''),
    'patientNumber', coalesce(ctx_record.patient_number, ''),
    'patientId', ctx_record.patient_id::text,
    'patientAge', coalesce(safe_age, 0),
    'patientGender', coalesce((ctx_record.gender)::text, ''),
    'patientPhone', coalesce(ctx_record.patient_phone, ''),
    'patientDOB', to_char(ctx_record.date_of_birth, 'YYYY-MM-DD'),
    'patientRegistrationDate', to_char(ctx_record.registration_date, 'YYYY-MM-DD'),
    'orderId', ctx_record.order_id::text,
    'orderNumber', coalesce(ctx_record.order_number::text, ''),
    'orderDate', to_char(ctx_record.order_date, 'YYYY-MM-DD'),
    'sampleCollectedAt', to_char(ctx_record.sample_collected_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD"T"HH24:MI:SS'),
    'sampleCollectedAtFormatted', coalesce(to_char(ctx_record.sample_collected_at AT TIME ZONE 'Asia/Kolkata', 'DD-MM-YYYY HH12:MI AM'), ''),
    'sampleReceivedAt', to_char(ctx_record.sample_received_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD"T"HH24:MI:SS'),
    'sampleReceivedAtFormatted', coalesce(to_char(ctx_record.sample_received_at AT TIME ZONE 'Asia/Kolkata', 'DD-MM-YYYY HH12:MI AM'), ''),
    'sampleCollectedBy', coalesce(ctx_record.sample_collected_by, ''),
    'sampleId', coalesce(ctx_record.sample_id, ''),
    'sampleBarcode', coalesce(ctx_record.sample_barcode, ''),
    'locationId', coalesce(ctx_record.location_id::text, ''),
    'locationName', coalesce(ctx_record.location_name, ''),
    'collectionCenter', coalesce(ctx_record.location_name, ''),
    'referringDoctorId', coalesce(ctx_record.referring_doctor_id::text, ''),
    'referringDoctorName', coalesce(ctx_record.referring_doctor_name, ''),
    'approvedAt', to_char(ctx_record.approved_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD"T"HH24:MI:SS'),
    'approvedAtFormatted', coalesce(to_char(ctx_record.approved_at AT TIME ZONE 'Asia/Kolkata', 'DD-MM-YYYY HH12:MI AM'), '')
  );

  SELECT jsonb_build_object(
    'labId', lab.id::text,
    'labName', coalesce(lab.name, ''),
    'labEmail', coalesce(lab.email, ''),
    'labPhone', coalesce(lab.phone, ''),
    'labAddress', coalesce(lab.address, ''),
    'labRegistrationNumber', coalesce(lab.registration_number, '')
  ) INTO lab_placeholders
  FROM public.labs lab
  WHERE lab.id = ctx_record.lab_id;

  IF ctx_record.approved_by IS NOT NULL THEN
    SELECT COALESCE(lus.imagekit_url, lus.file_url), COALESCE(u.name, u.email), u.role
    INTO approver_signature_url, approver_name, approver_role
    FROM users u
    LEFT JOIN lab_user_signatures lus ON lus.user_id = u.id
      AND lus.lab_id = ctx_record.lab_id
      AND lus.is_default = true
    WHERE u.id = ctx_record.approved_by
    LIMIT 1;
  END IF;

  approver_placeholders := jsonb_build_object(
    'approverSignature', COALESCE(approver_signature_url, ''),
    'approverSignatureUrl', COALESCE(approver_signature_url, ''),
    'approvedBySignature', COALESCE(approver_signature_url, ''),
    'approvedByName', COALESCE(approver_name, ''),
    'approverName', COALESCE(approver_name, ''),
    'approverRole', COALESCE(approver_role, '')
  );

  WITH section_images AS (
    SELECT
      rsc.id,
      string_agg(
        '<img src="' ||
        CASE
          WHEN position('?' in image_url) > 0 THEN image_url || '&tr=w-1200,q-85,sharpen-5'
          ELSE image_url || '?tr=w-1200,q-85,sharpen-5'
        END ||
        '" class="report-section-image" />',
        ''
      ) AS image_html
    FROM result_section_content rsc
    LEFT JOIN LATERAL jsonb_array_elements_text(COALESCE(rsc.image_urls, '[]'::jsonb)) AS image_url ON true
    GROUP BY rsc.id
  )
  SELECT COALESCE(jsonb_object_agg(
    lts.placeholder_key,
    trim(
      COALESCE(
        CASE
          WHEN rsc.final_content IS NOT NULL AND btrim(rsc.final_content) <> '' THEN
            '<div class="section-content">' || replace(replace(rsc.final_content, E'\r\n', E'\n'), E'\n', '<br/>') || '</div>'
          ELSE ''
        END,
        ''
      ) ||
      COALESCE(
        CASE
          WHEN si.image_html IS NOT NULL AND si.image_html <> '' THEN
            '<div class="section-images">' || si.image_html || '</div>'
          ELSE ''
        END,
        ''
      )
    )
  ), '{}'::jsonb)
  INTO section_content_map
  FROM result_section_content rsc
  JOIN results r ON r.id = rsc.result_id
  JOIN lab_template_sections lts ON lts.id = rsc.section_id
  LEFT JOIN section_images si ON si.id = rsc.id
  WHERE r.order_id = p_order_id
    AND lts.placeholder_key IS NOT NULL
    AND (
      (rsc.final_content IS NOT NULL AND btrim(rsc.final_content) <> '')
      OR (jsonb_array_length(COALESCE(rsc.image_urls, '[]'::jsonb)) > 0)
    );

  SELECT coalesce(jsonb_object_agg(entry.placeholder_key, entry.placeholder_value), '{}'::jsonb)
  INTO analyte_placeholders
  FROM (
    WITH analyte_data AS (
      SELECT
        rv.value,
        rv.unit,
        rv.reference_range,
        rv.flag,
        rv.verify_status::text AS verify_status,
        rv.parameter,
        COALESCE(la.lab_specific_method, la.method) AS method,
        COALESCE(
          NULLIF(UPPER(regexp_replace(a.code, '[^A-Za-z0-9]+', '', 'g')), ''),
          UPPER(regexp_replace(rv.parameter, '[^A-Za-z0-9]+', '', 'g'))
        ) AS analyte_code
      FROM public.result_values rv
      LEFT JOIN public.analytes a ON a.id = rv.analyte_id
      LEFT JOIN public.lab_analytes la ON la.analyte_id = rv.analyte_id AND la.lab_id = ctx_record.lab_id
      WHERE rv.order_id = p_order_id
        AND NOT COALESCE(rv.is_hidden_from_report, false)
    )
    SELECT 'ANALYTE_' || analyte_code || '_VALUE' AS placeholder_key, coalesce(value, '') AS placeholder_value
    FROM analyte_data WHERE analyte_code IS NOT NULL AND analyte_code != '' AND value IS NOT NULL
    UNION ALL SELECT 'ANALYTE_' || analyte_code || '_UNIT', coalesce(unit, '')
    FROM analyte_data WHERE analyte_code IS NOT NULL AND analyte_code != '' AND unit IS NOT NULL
    UNION ALL SELECT 'ANALYTE_' || analyte_code || '_REFERENCE', coalesce(reference_range, '')
    FROM analyte_data WHERE analyte_code IS NOT NULL AND analyte_code != '' AND reference_range IS NOT NULL
    UNION ALL SELECT 'ANALYTE_' || analyte_code || '_FLAG', coalesce(flag, '')
    FROM analyte_data WHERE analyte_code IS NOT NULL AND analyte_code != '' AND flag IS NOT NULL
    UNION ALL SELECT 'ANALYTE_' || analyte_code || '_STATUS', coalesce(verify_status, '')
    FROM analyte_data WHERE analyte_code IS NOT NULL AND analyte_code != '' AND verify_status IS NOT NULL
    UNION ALL SELECT 'ANALYTE_' || analyte_code || '_METHOD', coalesce(method, '')
    FROM analyte_data WHERE analyte_code IS NOT NULL AND analyte_code != '' AND method IS NOT NULL
    UNION ALL SELECT lower('analyte_' || analyte_code || '_value'), coalesce(value, '')
    FROM analyte_data WHERE analyte_code IS NOT NULL AND analyte_code != '' AND value IS NOT NULL
    UNION ALL SELECT lower('analyte_' || analyte_code || '_unit'), coalesce(unit, '')
    FROM analyte_data WHERE analyte_code IS NOT NULL AND analyte_code != '' AND unit IS NOT NULL
    UNION ALL SELECT lower('analyte_' || analyte_code || '_reference'), coalesce(reference_range, '')
    FROM analyte_data WHERE analyte_code IS NOT NULL AND analyte_code != '' AND reference_range IS NOT NULL
    UNION ALL SELECT lower('analyte_' || analyte_code || '_flag'), coalesce(flag, '')
    FROM analyte_data WHERE analyte_code IS NOT NULL AND analyte_code != '' AND flag IS NOT NULL
    UNION ALL SELECT lower('analyte_' || analyte_code || '_status'), coalesce(verify_status, '')
    FROM analyte_data WHERE analyte_code IS NOT NULL AND analyte_code != '' AND verify_status IS NOT NULL
    UNION ALL SELECT lower('analyte_' || analyte_code || '_method'), coalesce(method, '')
    FROM analyte_data WHERE analyte_code IS NOT NULL AND analyte_code != '' AND method IS NOT NULL
    UNION ALL SELECT regexp_replace(lower(coalesce(parameter, '')), '[^a-z0-9]+', '', 'g'), coalesce(value, '')
    FROM analyte_data WHERE parameter IS NOT NULL AND parameter != '' AND value IS NOT NULL
  ) AS entry;

  RETURN jsonb_strip_nulls(jsonb_build_object(
    'orderId', ctx_record.order_id::text,
    'patientId', ctx_record.patient_id::text,
    'labId', ctx_record.lab_id::text,
    'meta', jsonb_build_object(
      'orderNumber', coalesce(ctx_record.order_number::text, ''),
      'orderDate', to_char(ctx_record.order_date, 'YYYY-MM-DD'),
      'reportDate', to_char(ctx_record.report_date, 'YYYY-MM-DD'),
      'status', coalesce((ctx_record.status)::text, ''),
      'totalAmount', ctx_record.total_amount,
      'createdAt', to_char(ctx_record.order_created_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD"T"HH24:MI:SS'),
      'createdAtFormatted', coalesce(to_char(ctx_record.order_created_at AT TIME ZONE 'Asia/Kolkata', 'DD-MM-YYYY HH12:MI AM'), ''),
      'allAnalytesApproved', ctx_record.all_analytes_approved
    ),
    'patient', jsonb_build_object(
      'name', coalesce(ctx_record.patient_name, ''),
      'displayId', coalesce(ctx_record.patient_display_id, ''),
      'patientNumber', coalesce(ctx_record.patient_number, ''),
      'age', safe_age,
      'gender', coalesce((ctx_record.gender)::text, ''),
      'phone', coalesce(ctx_record.patient_phone, ''),
      'dateOfBirth', to_char(ctx_record.date_of_birth, 'YYYY-MM-DD'),
      'registrationDate', to_char(ctx_record.registration_date, 'YYYY-MM-DD')
    ),
    'order', jsonb_build_object(
      'sampleCollectedAt', to_char(ctx_record.sample_collected_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD"T"HH24:MI:SS'),
      'sampleCollectedAtFormatted', coalesce(to_char(ctx_record.sample_collected_at AT TIME ZONE 'Asia/Kolkata', 'DD-MM-YYYY HH12:MI AM'), ''),
      'sampleReceivedAt', to_char(ctx_record.sample_received_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD"T"HH24:MI:SS'),
      'sampleReceivedAtFormatted', coalesce(to_char(ctx_record.sample_received_at AT TIME ZONE 'Asia/Kolkata', 'DD-MM-YYYY HH12:MI AM'), ''),
      'sampleCollectedBy', coalesce(ctx_record.sample_collected_by, ''),
      'sampleId', coalesce(ctx_record.sample_id, ''),
      'sampleBarcode', coalesce(ctx_record.sample_barcode, ''),
      'locationId', coalesce(ctx_record.location_id::text, ''),
      'locationName', coalesce(ctx_record.location_name, ''),
      'collectionCenter', coalesce(ctx_record.location_name, ''),
      'referringDoctorId', coalesce(ctx_record.referring_doctor_id::text, ''),
      'referringDoctorName', coalesce(ctx_record.referring_doctor_name, ''),
      'approvedAt', to_char(ctx_record.approved_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD"T"HH24:MI:SS'),
      'approvedAtFormatted', coalesce(to_char(ctx_record.approved_at AT TIME ZONE 'Asia/Kolkata', 'DD-MM-YYYY HH12:MI AM'), ''),
      'approvedBy', coalesce(ctx_record.approved_by::text, ''),
      'approvedByName', COALESCE(approver_name, ''),
      'approverSignature', COALESCE(approver_signature_url, '')
    ),
    'analytes', coalesce(ctx_record.analytes, '[]'::jsonb),
    'analyteParameters', to_jsonb(coalesce(ctx_record.analyte_parameters, ARRAY[]::text[])),
    'testGroupIds', to_jsonb(coalesce(ctx_record.test_group_ids, ARRAY[]::uuid[])),
    'sectionContent', section_content_map,
    'placeholderValues', coalesce(base_placeholders, '{}'::jsonb)
      || coalesce(lab_placeholders, '{}'::jsonb)
      || coalesce(analyte_placeholders, '{}'::jsonb)
      || coalesce(approver_placeholders, '{}'::jsonb)
      || section_content_map
  ));
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_report_template_context(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_report_template_context(uuid) TO service_role;
