-- Fix: add custom_fields to v_patients_with_duplicates
-- The column was added in 20260315_custom_patient_fields.sql but the view
-- was not updated, so patient edit forms couldn't read custom field values.

DROP VIEW IF EXISTS v_patients_with_duplicates;

CREATE OR REPLACE VIEW v_patients_with_duplicates AS
WITH patient_stats AS (
    SELECT
        patient_id,
        COUNT(id) as calculated_test_count,
        MAX(created_at) as last_result_date
    FROM results
    GROUP BY patient_id
),
duplicate_groups AS (
    SELECT
        name,
        phone,
        COUNT(*) as group_count,
        array_agg(id) as id_list,
        array_agg(name) as name_list
    FROM patients
    WHERE is_active = true
    GROUP BY name, phone
)
SELECT
    p.id,
    p.lab_id,
    p.name,
    p.age,
    p.age_unit,
    p.gender,
    p.phone,
    p.email,
    p.address,
    p.city,
    p.state,
    p.pincode,
    p.emergency_contact,
    p.emergency_phone,
    p.blood_group,
    p.allergies,
    p.medical_history,
    p.display_id,
    p.registration_date,
    p.is_active,
    p.created_at,
    p.updated_at,
    p.custom_fields,

    -- Calculated stats
    COALESCE(s.calculated_test_count, 0) as total_tests,
    COALESCE(s.calculated_test_count, 0) as test_count,
    COALESCE(s.last_result_date, p.created_at) as last_visit,

    -- Duplicate info
    COALESCE(dg.group_count - 1, 0) as duplicate_count,
    dg.id_list as duplicate_patient_ids,
    dg.name_list as duplicate_patient_names
FROM patients p
LEFT JOIN patient_stats s ON p.id = s.patient_id
LEFT JOIN duplicate_groups dg ON p.name = dg.name AND p.phone = dg.phone
WHERE p.is_active = true;

GRANT SELECT ON v_patients_with_duplicates TO authenticated;
GRANT SELECT ON v_patients_with_duplicates TO service_role;
