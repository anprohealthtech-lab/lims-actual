-- Migration: Add age_unit to v_patients_with_duplicates view
-- Date: 2026-01-25
-- Purpose: Include age_unit column in patient view for proper age display (years/months/days)

-- Drop existing view
DROP VIEW IF EXISTS v_patients_with_duplicates;

-- Recreate view with age_unit column
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

    -- Calculated stats
    COALESCE(s.calculated_test_count, 0) as total_tests,
    COALESCE(s.calculated_test_count, 0) as test_count, -- Alias for frontend compatibility
    COALESCE(s.last_result_date, p.created_at) as last_visit,

    -- Duplicate info
    COALESCE(dg.group_count - 1, 0) as duplicate_count,
    dg.id_list as duplicate_patient_ids,
    dg.name_list as duplicate_patient_names
FROM patients p
LEFT JOIN patient_stats s ON p.id = s.patient_id
LEFT JOIN duplicate_groups dg ON p.name = dg.name AND p.phone = dg.phone;

-- Grant permissions
GRANT SELECT ON v_patients_with_duplicates TO authenticated;
GRANT SELECT ON v_patients_with_duplicates TO service_role;
