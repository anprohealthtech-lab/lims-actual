-- Add report section attachments + technician entry support

-- 1) Add flags to section templates
ALTER TABLE public.lab_template_sections
ADD COLUMN IF NOT EXISTS allow_images boolean DEFAULT false;

ALTER TABLE public.lab_template_sections
ADD COLUMN IF NOT EXISTS allow_technician_entry boolean DEFAULT false;

-- 2) Store section image URLs on filled content
ALTER TABLE public.result_section_content
ADD COLUMN IF NOT EXISTS image_urls jsonb DEFAULT '[]'::jsonb;

-- 3) Update report template context to include section images
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
    'patientId', ctx_record.patient_id::text,
    'patientAge', coalesce(safe_age, 0),
    'patientGender', coalesce((ctx_record.gender)::text, ''),
    'patientPhone', coalesce(ctx_record.patient_phone, ''),
    'patientDOB', to_char(ctx_record.date_of_birth, 'YYYY-MM-DD'),
    'patientRegistrationDate', to_char(ctx_record.registration_date, 'YYYY-MM-DD'),
    'orderId', ctx_record.order_id::text,
    'orderNumber', coalesce(ctx_record.order_number::text, ''),
    'orderDate', to_char(ctx_record.order_date, 'YYYY-MM-DD'),
    'sampleCollectedAt', to_char(ctx_record.sample_collected_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'sampleCollectedAtFormatted', coalesce(to_char(ctx_record.sample_collected_at, 'DD-MM-YYYY HH12:MI AM'), ''),
    'sampleCollectedBy', coalesce(ctx_record.sample_collected_by, ''),
    'sampleId', coalesce(ctx_record.sample_id, ''),
    'locationId', coalesce(ctx_record.location_id::text, ''),
    'locationName', coalesce(ctx_record.location_name, ''),
    'referringDoctorId', coalesce(ctx_record.referring_doctor_id::text, ''),
    'referringDoctorName', coalesce(ctx_record.referring_doctor_name, ''),
    'approvedAt', to_char(ctx_record.approved_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'approvedAtFormatted', coalesce(to_char(ctx_record.approved_at, 'DD-MM-YYYY HH12:MI AM'), '')
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

  -- Fetch approver signature and details
  IF ctx_record.approved_by IS NOT NULL THEN
    SELECT 
      COALESCE(lus.imagekit_url, lus.file_url),
      COALESCE(u.name, u.email),
      u.role
    INTO approver_signature_url, approver_name, approver_role
    FROM users u
    LEFT JOIN lab_user_signatures lus ON lus.user_id = u.id 
      AND lus.lab_id = ctx_record.lab_id 
      AND lus.is_default = true
    WHERE u.id = ctx_record.approved_by
    LIMIT 1;
  END IF;

  -- Build approver placeholders
  approver_placeholders := jsonb_build_object(
    'approverSignature', COALESCE(approver_signature_url, ''),
    'approverSignatureUrl', COALESCE(approver_signature_url, ''),
    'approvedBySignature', COALESCE(approver_signature_url, ''),
    'approvedByName', COALESCE(approver_name, ''),
    'approverName', COALESCE(approver_name, ''),
    'approverRole', COALESCE(approver_role, '')
  );

  -- Fetch section content mapped by placeholder_key (including images)
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

  -- Build analyte placeholders using analytes.code field
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
        -- Use analyte code if available, otherwise sanitize parameter name
        COALESCE(
          NULLIF(UPPER(regexp_replace(a.code, '[^A-Za-z0-9]+', '', 'g')), ''),
          UPPER(regexp_replace(rv.parameter, '[^A-Za-z0-9]+', '', 'g'))
        ) AS analyte_code
      FROM public.result_values rv
      LEFT JOIN public.analytes a ON a.id = rv.analyte_id
      LEFT JOIN public.lab_analytes la ON la.analyte_id = rv.analyte_id AND la.lab_id = ctx_record.lab_id
      WHERE rv.order_id = p_order_id
    )
    -- Generate ANALYTE_[Code]_VALUE pattern
    SELECT 'ANALYTE_' || analyte_code || '_VALUE' AS placeholder_key, coalesce(value, '') AS placeholder_value
    FROM analyte_data
    WHERE analyte_code IS NOT NULL AND analyte_code != '' AND value IS NOT NULL
    UNION ALL
    SELECT 'ANALYTE_' || analyte_code || '_UNIT', coalesce(unit, '')
    FROM analyte_data
    WHERE analyte_code IS NOT NULL AND analyte_code != '' AND unit IS NOT NULL
    UNION ALL
    SELECT 'ANALYTE_' || analyte_code || '_REFERENCE', coalesce(reference_range, '')
    FROM analyte_data
    WHERE analyte_code IS NOT NULL AND analyte_code != '' AND reference_range IS NOT NULL
    UNION ALL
    SELECT 'ANALYTE_' || analyte_code || '_FLAG', coalesce(flag, '')
    FROM analyte_data
    WHERE analyte_code IS NOT NULL AND analyte_code != '' AND flag IS NOT NULL
    UNION ALL
    SELECT 'ANALYTE_' || analyte_code || '_STATUS', coalesce(verify_status, '')
    FROM analyte_data
    WHERE analyte_code IS NOT NULL AND analyte_code != '' AND verify_status IS NOT NULL
    UNION ALL
    SELECT 'ANALYTE_' || analyte_code || '_METHOD', coalesce(method, '')
    FROM analyte_data
    WHERE analyte_code IS NOT NULL AND analyte_code != '' AND method IS NOT NULL
    UNION ALL
    -- Also create lowercase versions for backwards compatibility
    SELECT lower('analyte_' || analyte_code || '_value'), coalesce(value, '')
    FROM analyte_data
    WHERE analyte_code IS NOT NULL AND analyte_code != '' AND value IS NOT NULL
    UNION ALL
    SELECT lower('analyte_' || analyte_code || '_unit'), coalesce(unit, '')
    FROM analyte_data
    WHERE analyte_code IS NOT NULL AND analyte_code != '' AND unit IS NOT NULL
    UNION ALL
    SELECT lower('analyte_' || analyte_code || '_reference'), coalesce(reference_range, '')
    FROM analyte_data
    WHERE analyte_code IS NOT NULL AND analyte_code != '' AND reference_range IS NOT NULL
    UNION ALL
    SELECT lower('analyte_' || analyte_code || '_flag'), coalesce(flag, '')
    FROM analyte_data
    WHERE analyte_code IS NOT NULL AND analyte_code != '' AND flag IS NOT NULL
    UNION ALL
    SELECT lower('analyte_' || analyte_code || '_status'), coalesce(verify_status, '')
    FROM analyte_data
    WHERE analyte_code IS NOT NULL AND analyte_code != '' AND verify_status IS NOT NULL
    UNION ALL
    SELECT lower('analyte_' || analyte_code || '_method'), coalesce(method, '')
    FROM analyte_data
    WHERE analyte_code IS NOT NULL AND analyte_code != '' AND method IS NOT NULL
    UNION ALL
    -- Legacy: Also keep old parameter-based placeholders for backwards compatibility
    SELECT regexp_replace(lower(coalesce(parameter, '')), '[^a-z0-9]+', '', 'g'), coalesce(value, '')
    FROM analyte_data
    WHERE parameter IS NOT NULL AND parameter != '' AND value IS NOT NULL
  ) AS entry;

  RETURN jsonb_strip_nulls(jsonb_build_object(
    'orderId', ctx_record.order_id::text,
    'patientId', ctx_record.patient_id::text,
    'labId', ctx_record.lab_id::text,
    'meta', jsonb_build_object(
      'orderNumber', coalesce(ctx_record.order_number::text, ''),
      'orderDate', to_char(ctx_record.order_date, 'YYYY-MM-DD'),
      'status', coalesce((ctx_record.status)::text, ''),
      'totalAmount', ctx_record.total_amount,
      'createdAt', to_char(ctx_record.order_created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'createdAtFormatted', coalesce(to_char(ctx_record.order_created_at, 'DD-MM-YYYY HH12:MI AM'), ''),
      'allAnalytesApproved', ctx_record.all_analytes_approved
    ),
    'patient', jsonb_build_object(
      'name', coalesce(ctx_record.patient_name, ''),
      'displayId', coalesce(ctx_record.patient_display_id, ''),
      'age', safe_age,
      'gender', coalesce((ctx_record.gender)::text, ''),
      'phone', coalesce(ctx_record.patient_phone, ''),
      'dateOfBirth', to_char(ctx_record.date_of_birth, 'YYYY-MM-DD'),
      'registrationDate', to_char(ctx_record.registration_date, 'YYYY-MM-DD')
    ),
    'order', jsonb_build_object(
      'sampleCollectedAt', to_char(ctx_record.sample_collected_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'sampleCollectedAtFormatted', coalesce(to_char(ctx_record.sample_collected_at, 'DD-MM-YYYY HH12:MI AM'), ''),
      'sampleCollectedBy', coalesce(ctx_record.sample_collected_by, ''),
      'sampleId', coalesce(ctx_record.sample_id, ''),
      'locationId', coalesce(ctx_record.location_id::text, ''),
      'locationName', coalesce(ctx_record.location_name, ''),
      'referringDoctorId', coalesce(ctx_record.referring_doctor_id::text, ''),
      'referringDoctorName', coalesce(ctx_record.referring_doctor_name, ''),
      'approvedAt', to_char(ctx_record.approved_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'approvedAtFormatted', coalesce(to_char(ctx_record.approved_at, 'DD-MM-YYYY HH12:MI AM'), ''),
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

COMMENT ON FUNCTION public.get_report_template_context(uuid) IS 'Builds complete context for PDF report generation. Adds section images to placeholders.';
