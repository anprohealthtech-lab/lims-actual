-- Migration: Fix PDF showing wrong analytes - add test_group_id to analytes JSON
-- Date: 2026-01-31
-- Issue: The v_report_template_context view was NOT including test_group_id in the analytes JSON array
-- This caused groupAnalytesByTestGroup() to put all analytes in "ungrouped" bucket
-- Then the fallback logic incorrectly distributed them, causing TSH header to show AEC data

-- Drop and recreate view to add test_group_id to each analyte
DROP VIEW IF EXISTS public.v_report_template_context;
CREATE VIEW public.v_report_template_context AS
SELECT 
    o.id AS order_id,
    o.order_number,
    o.order_date,
    o.status,
    o.total_amount,
    o.sample_collected_at,
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
    p.age,
    p.gender,
    p.phone AS patient_phone,
    p.date_of_birth,
    p.registration_date,
    
    l.name AS location_name,
    
    d.name AS referring_doctor_name,
    
    COALESCE(u_collector.name, u_collector.email) AS sample_collected_by,
    
    -- Use result_values.verified_at as approved_at
    MAX(rv.verified_at) AS approved_at,
    
    -- All analytes approved if all result_values.verify_status = 'approved'
    BOOL_AND(
        CASE 
            WHEN rv.verify_status IS NULL THEN false
            WHEN rv.verify_status = 'approved' THEN true
            ELSE false
        END
    ) AS all_analytes_approved,
    
    -- FIXED: Added test_group_id to each analyte so groupAnalytesByTestGroup() works correctly
    jsonb_agg(
        DISTINCT jsonb_build_object(
            'result_id', rv.result_id,
            'analyte_id', rv.analyte_id,
            'parameter', COALESCE(la.lab_specific_name, a.name),
            'value', rv.value,
            'unit', COALESCE(la.lab_specific_unit, a.unit),
            'reference_range', COALESCE(la.lab_specific_reference_range, a.reference_range),
            'flag', rv.flag,
            'verify_status', rv.verify_status,
            'test_group_id', tg.id,  -- ✅ ADDED: Critical for proper grouping in PDF generation
            'test_name', tg.name     -- Also include test group name for reference
        )
    ) FILTER (WHERE rv.id IS NOT NULL) AS analytes,
    
    array_agg(DISTINCT COALESCE(la.lab_specific_name, a.name)) 
        FILTER (WHERE a.name IS NOT NULL) AS analyte_parameters,
    
    array_agg(DISTINCT tg.id) FILTER (WHERE tg.id IS NOT NULL) AS test_group_ids

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
    o.id, o.order_number, o.order_date, o.status, o.total_amount,
    o.sample_collected_at, o.sample_id, o.color_code, o.color_name,
    o.qr_code_data, o.created_at, o.lab_id, o.patient_id,
    o.location_id, o.referring_doctor_id, o.approved_by,
    p.name, p.display_id, p.age, p.gender, p.phone,
    p.date_of_birth, p.registration_date,
    l.name, d.name, u_collector.name, u_collector.email;

-- Grant access
GRANT SELECT ON public.v_report_template_context TO authenticated;

COMMENT ON VIEW public.v_report_template_context IS 'Report template context view - includes test_group_id in analytes JSON for proper grouping';
