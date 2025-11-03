-- Migration: Create view v_report_template_context
-- Purpose: Provide a single row-per-order view with consolidated fields used by template rendering
-- Idempotent: CREATE OR REPLACE VIEW

CREATE OR REPLACE VIEW public.v_report_template_context AS
SELECT
  o.id AS order_id,
  o.lab_id,
  o.patient_id,
  p.name AS patient_name,
  p.display_id AS patient_display_id,
  p.registration_date,
  p.date_of_birth,
  p.age,
  p.gender,
  p.phone AS patient_phone,
  o.order_date,
  o.sample_collected_at,
  o.sample_collected_by,
  o.sample_id,
  o.order_number,
  o.location_id,
  l.name AS location_name,
  o.referring_doctor_id,
  d.name AS referring_doctor_name,
  o.total_amount,
  o.status,
  o.created_at AS order_created_at,

  -- Latest approved timestamp for results associated with this order
  (SELECT max(r.verified_at) FROM public.results r WHERE r.order_id = o.id) AS approved_at,

  -- aggregated analytes (one entry per result_value) as JSON array
  (
    SELECT coalesce(jsonb_agg(rv_row ORDER BY rv_row->> 'test_name', rv_row->> 'parameter'), '[]'::jsonb)
    FROM (
      SELECT jsonb_build_object(
        'result_id', rv.result_id,
        'analyte_id', rv.analyte_id,
        'parameter', rv.parameter,
        'value', rv.value,
        'unit', rv.unit,
        'reference_range', rv.reference_range,
        'flag', rv.flag,
        'verify_status', rv.verify_status,
        'test_name', res.test_name,
        'test_group_id', res.test_group_id
      ) AS rv_row
      FROM public.result_values rv
      LEFT JOIN public.results res ON res.id = rv.result_id
      WHERE rv.order_id = o.id
    ) AS t
  ) AS analytes,

  -- distinct list of analyte parameters (useful for quick membership tests)
  (
    SELECT coalesce(array_agg(distinct rv.parameter ORDER BY rv.parameter), ARRAY[]::text[])
    FROM public.result_values rv
    WHERE rv.order_id = o.id
  ) AS analyte_parameters,

  -- distinct test_group_ids present for this order
  (
    SELECT coalesce(array_agg(distinct res.test_group_id), ARRAY[]::uuid[])
    FROM public.results res
    WHERE res.order_id = o.id
  ) AS test_group_ids,

  -- whether all analytes have approved verify_status (null => no analytes)
  (
    SELECT bool_and(rv.verify_status = 'approved')
    FROM public.result_values rv
    WHERE rv.order_id = o.id
  ) AS all_analytes_approved

FROM public.orders o
LEFT JOIN public.patients p ON p.id = o.patient_id
LEFT JOIN public.locations l ON l.id = o.location_id
LEFT JOIN public.doctors d ON d.id = o.referring_doctor_id;

-- Grant usage to authenticated role if needed (commented out - adjust per policies)
-- GRANT SELECT ON public.v_report_template_context TO authenticated;

-- RPC: get_report_template_context
-- Purpose: Returns a single JSON payload ready for template rendering
-- Includes placeholderValues for Nunjucks and raw analyte arrays for custom logic

CREATE OR REPLACE FUNCTION public.get_report_template_context(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  ctx_record RECORD;
  base_placeholders jsonb := '{}';
  lab_placeholders jsonb := '{}';
  analyte_placeholders jsonb := '{}';
  lab_header_html text;
  lab_footer_html text;
BEGIN
  SELECT * INTO ctx_record
  FROM public.v_report_template_context
  WHERE order_id = p_order_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  base_placeholders := jsonb_build_object(
    'patientName', coalesce(ctx_record.patient_name, ''),
    'patientDisplayId', coalesce(ctx_record.patient_display_id, ''),
    'patientId', ctx_record.patient_id::text,
    'patientAge', coalesce(ctx_record.age, 0),
    'patientGender', coalesce(ctx_record.gender, ''),
    'patientPhone', coalesce(ctx_record.patient_phone, ''),
    'patientDOB', to_char(ctx_record.date_of_birth, 'YYYY-MM-DD'),
    'patientRegistrationDate', to_char(ctx_record.registration_date, 'YYYY-MM-DD'),
    'orderId', ctx_record.order_id::text,
    'orderNumber', coalesce(ctx_record.order_number, ''),
    'orderDate', to_char(ctx_record.order_date, 'YYYY-MM-DD'),
    'sampleCollectedAt', to_char(ctx_record.sample_collected_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'sampleCollectedBy', coalesce(ctx_record.sample_collected_by, ''),
    'sampleId', coalesce(ctx_record.sample_id, ''),
    'locationId', coalesce(ctx_record.location_id::text, ''),
    'locationName', coalesce(ctx_record.location_name, ''),
    'referringDoctorId', coalesce(ctx_record.referring_doctor_id::text, ''),
    'referringDoctorName', coalesce(ctx_record.referring_doctor_name, ''),
    'approvedAt', to_char(ctx_record.approved_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  );

  SELECT
    lab.default_report_header_html,
    lab.default_report_footer_html,
    jsonb_build_object(
      'labId', lab.id::text,
      'labName', coalesce(lab.name, ''),
      'labEmail', coalesce(lab.email, ''),
      'labPhone', coalesce(lab.phone, ''),
      'labAddress', coalesce(lab.address, ''),
      'labRegistrationNumber', coalesce(lab.registration_number, ''),
      'labDefaultHeaderHtml', coalesce(lab.default_report_header_html, ''),
      'labDefaultFooterHtml', coalesce(lab.default_report_footer_html, '')
    )
  INTO lab_header_html, lab_footer_html, lab_placeholders
  FROM public.labs lab
  WHERE lab.id = ctx_record.lab_id;

  SELECT coalesce(jsonb_object_agg(entry.placeholder_key, entry.placeholder_value), '{}'::jsonb)
  INTO analyte_placeholders
  FROM (
    WITH normalized AS (
      SELECT
        CASE
          WHEN trimmed_parameter IS NULL OR trimmed_parameter = '' THEN NULL
          WHEN trimmed_parameter ~ '^[0-9]' THEN 'n' || trimmed_parameter
          ELSE trimmed_parameter
        END AS slug,
        rv.value,
        rv.unit,
        rv.reference_range,
        rv.flag,
        rv.verify_status
      FROM (
        SELECT
          rv.*,
          regexp_replace(lower(coalesce(rv.parameter, '')), '[^a-z0-9]+', '', 'g') AS trimmed_parameter
        FROM public.result_values rv
        WHERE rv.order_id = ctx_record.order_id
      ) AS rv
    )
    SELECT slug AS placeholder_key, coalesce(value, '') AS placeholder_value
    FROM normalized
    WHERE slug IS NOT NULL AND value IS NOT NULL
    UNION ALL
    SELECT slug || '_unit', coalesce(unit, '')
    FROM normalized
    WHERE slug IS NOT NULL AND unit IS NOT NULL
    UNION ALL
    SELECT slug || '_reference', coalesce(reference_range, '')
    FROM normalized
    WHERE slug IS NOT NULL AND reference_range IS NOT NULL
    UNION ALL
    SELECT slug || '_flag', coalesce(flag, '')
    FROM normalized
    WHERE slug IS NOT NULL AND flag IS NOT NULL
    UNION ALL
    SELECT slug || '_status', coalesce(verify_status, '')
    FROM normalized
    WHERE slug IS NOT NULL AND verify_status IS NOT NULL
  ) AS entry;

  RETURN jsonb_strip_nulls(jsonb_build_object(
    'orderId', ctx_record.order_id::text,
    'patientId', ctx_record.patient_id::text,
    'labId', ctx_record.lab_id::text,
    'meta', jsonb_build_object(
      'orderNumber', coalesce(ctx_record.order_number, ''),
      'orderDate', to_char(ctx_record.order_date, 'YYYY-MM-DD'),
      'status', coalesce(ctx_record.status, ''),
      'totalAmount', ctx_record.total_amount,
      'createdAt', to_char(ctx_record.order_created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'allAnalytesApproved', ctx_record.all_analytes_approved
    ),
    'patient', jsonb_build_object(
      'name', coalesce(ctx_record.patient_name, ''),
      'displayId', coalesce(ctx_record.patient_display_id, ''),
      'age', ctx_record.age,
      'gender', coalesce(ctx_record.gender, ''),
      'phone', coalesce(ctx_record.patient_phone, ''),
      'dateOfBirth', to_char(ctx_record.date_of_birth, 'YYYY-MM-DD'),
      'registrationDate', to_char(ctx_record.registration_date, 'YYYY-MM-DD')
    ),
    'order', jsonb_build_object(
      'sampleCollectedAt', to_char(ctx_record.sample_collected_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'sampleCollectedBy', coalesce(ctx_record.sample_collected_by, ''),
      'sampleId', coalesce(ctx_record.sample_id, ''),
      'locationId', coalesce(ctx_record.location_id::text, ''),
      'locationName', coalesce(ctx_record.location_name, ''),
      'referringDoctorId', coalesce(ctx_record.referring_doctor_id::text, ''),
      'referringDoctorName', coalesce(ctx_record.referring_doctor_name, ''),
      'approvedAt', to_char(ctx_record.approved_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    ),
    'analytes', coalesce(ctx_record.analytes, '[]'::jsonb),
    'analyteParameters', to_jsonb(coalesce(ctx_record.analyte_parameters, ARRAY[]::text[])),
    'testGroupIds', to_jsonb(coalesce(ctx_record.test_group_ids, ARRAY[]::uuid[])),
    'placeholderValues', coalesce(base_placeholders, '{}'::jsonb)
      || coalesce(lab_placeholders, '{}'::jsonb)
      || coalesce(analyte_placeholders, '{}'::jsonb)
      || jsonb_build_object(
        'labDefaultHeaderHtml', coalesce(lab_header_html, ''),
        'labDefaultFooterHtml', coalesce(lab_footer_html, '')
      ),
    'labBranding', jsonb_build_object(
      'defaultHeaderHtml', lab_header_html,
      'defaultFooterHtml', lab_footer_html
    )
  ));
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_report_template_context(uuid) TO authenticated;
