-- ============================================================================
-- Sample QC Data for CBC Test Group
-- Lab: Doctorpreneur Academy Lab (43ef4f85-3133-44d0-aa2b-9fca56de856e)
-- Test Group: CBC with MPV (ee14ada5-766e-4edb-8cb0-65ff14cea241)
-- ============================================================================
-- This creates realistic QC data for demonstration purposes including:
-- - 2 QC Lots (Level 1 Normal, Level 2 Abnormal)
-- - Target values for 10 CBC analytes
-- - 30 days of QC runs (twice daily)
-- - QC results with normal variation and some Westgard violations
-- ============================================================================

DO $$
DECLARE
    v_lab_id UUID := '43ef4f85-3133-44d0-aa2b-9fca56de856e';
    v_user_id UUID := '89d8a7f7-c932-46b3-97a8-d45c7a13145d';
    v_test_group_id UUID := 'ee14ada5-766e-4edb-8cb0-65ff14cea241';

    -- QC Lot IDs
    v_lot_l1_id UUID;
    v_lot_l2_id UUID;

    -- Analyte IDs (will be looked up)
    v_hb_id UUID;
    v_rbc_id UUID;
    v_wbc_id UUID;
    v_plt_id UUID;
    v_hct_id UUID;
    v_mcv_id UUID;
    v_mch_id UUID;
    v_mchc_id UUID;
    v_rdw_id UUID;
    v_mpv_id UUID;

    -- Loop variables
    v_run_date DATE;
    v_run_id UUID;
    v_run_number INTEGER;
    v_day_offset INTEGER;

    -- Random value helpers
    v_z_score NUMERIC;
    v_observed_value NUMERIC;
    v_pass_fail TEXT;
    v_westgard_flags TEXT[];

BEGIN
    -- ========================================================================
    -- Step 0: Add missing columns if they don't exist
    -- ========================================================================
    
    -- Add created_by to qc_runs if missing
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'qc_runs' 
        AND column_name = 'created_by'
    ) THEN
        ALTER TABLE qc_runs ADD COLUMN created_by UUID REFERENCES users(id);
    END IF;

    -- Add test_group_ids to qc_lots if missing
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'qc_lots' 
        AND column_name = 'test_group_ids'
    ) THEN
        ALTER TABLE qc_lots ADD COLUMN test_group_ids UUID[];
    END IF;

    -- Add observed_value to qc_results if missing
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'qc_results' 
        AND column_name = 'observed_value'
    ) THEN
        ALTER TABLE qc_results ADD COLUMN observed_value NUMERIC;
    END IF;

    -- ========================================================================
    -- Step 1: Get Analyte IDs for CBC (get analyte_id from lab_analytes, not lab_analytes.id)
    -- ========================================================================

    SELECT la.analyte_id INTO v_hb_id FROM lab_analytes la JOIN analytes a ON a.id = la.analyte_id WHERE la.lab_id = v_lab_id AND (LOWER(a.name) LIKE '%haemoglobin%' OR LOWER(a.name) LIKE '%hemoglobin%' OR LOWER(a.code) = 'hb' OR LOWER(a.code) = 'hgb') LIMIT 1;
    SELECT la.analyte_id INTO v_rbc_id FROM lab_analytes la JOIN analytes a ON a.id = la.analyte_id WHERE la.lab_id = v_lab_id AND (LOWER(a.name) LIKE '%rbc%' OR LOWER(a.name) LIKE '%red blood%' OR LOWER(a.code) = 'rbc') LIMIT 1;
    SELECT la.analyte_id INTO v_wbc_id FROM lab_analytes la JOIN analytes a ON a.id = la.analyte_id WHERE la.lab_id = v_lab_id AND (LOWER(a.name) LIKE '%wbc%' OR LOWER(a.name) LIKE '%white blood%' OR LOWER(a.code) = 'wbc') LIMIT 1;
    SELECT la.analyte_id INTO v_plt_id FROM lab_analytes la JOIN analytes a ON a.id = la.analyte_id WHERE la.lab_id = v_lab_id AND (LOWER(a.name) LIKE '%platelet%' OR LOWER(a.code) = 'plt') LIMIT 1;
    SELECT la.analyte_id INTO v_hct_id FROM lab_analytes la JOIN analytes a ON a.id = la.analyte_id WHERE la.lab_id = v_lab_id AND (LOWER(a.name) LIKE '%hematocrit%' OR LOWER(a.name) LIKE '%haematocrit%' OR LOWER(a.code) = 'hct' OR LOWER(a.code) = 'pcv') LIMIT 1;
    SELECT la.analyte_id INTO v_mcv_id FROM lab_analytes la JOIN analytes a ON a.id = la.analyte_id WHERE la.lab_id = v_lab_id AND (LOWER(a.name) LIKE '%mcv%' OR LOWER(a.name) LIKE '%mean corpuscular volume%') LIMIT 1;
    SELECT la.analyte_id INTO v_mch_id FROM lab_analytes la JOIN analytes a ON a.id = la.analyte_id WHERE la.lab_id = v_lab_id AND (LOWER(a.name) = 'mch' OR (LOWER(a.name) LIKE '%mean corpuscular%' AND LOWER(a.name) LIKE '%hemoglobin%' AND LOWER(a.name) NOT LIKE '%concentration%')) LIMIT 1;
    SELECT la.analyte_id INTO v_mchc_id FROM lab_analytes la JOIN analytes a ON a.id = la.analyte_id WHERE la.lab_id = v_lab_id AND (LOWER(a.name) LIKE '%mchc%' OR LOWER(a.name) LIKE '%mean corpuscular hemoglobin concentration%') LIMIT 1;
    SELECT la.analyte_id INTO v_rdw_id FROM lab_analytes la JOIN analytes a ON a.id = la.analyte_id WHERE la.lab_id = v_lab_id AND (LOWER(a.name) LIKE '%rdw%' OR LOWER(a.name) LIKE '%red cell distribution%') LIMIT 1;
    SELECT la.analyte_id INTO v_mpv_id FROM lab_analytes la JOIN analytes a ON a.id = la.analyte_id WHERE la.lab_id = v_lab_id AND (LOWER(a.name) LIKE '%mpv%' OR LOWER(a.name) LIKE '%mean platelet volume%') LIMIT 1;

    RAISE NOTICE 'Found analytes - Hb: %, RBC: %, WBC: %, PLT: %, HCT: %, MCV: %, MCH: %, MCHC: %, RDW: %, MPV: %',
        v_hb_id, v_rbc_id, v_wbc_id, v_plt_id, v_hct_id, v_mcv_id, v_mch_id, v_mchc_id, v_rdw_id, v_mpv_id;

    -- ========================================================================
    -- Step 2: Create QC Lots
    -- ========================================================================

    -- Level 1 (Normal) Control
    INSERT INTO qc_lots (
        id, lab_id, lot_number, material_name, manufacturer, lot_type, level,
        received_date, expiry_date, is_active, test_group_ids, created_by, notes
    ) VALUES (
        gen_random_uuid(), v_lab_id, 'LOT-CBC-2026-001', 'Bio-Rad Liquichek Hematology Control',
        'Bio-Rad', 'internal_control', 'Level 1 (Normal)',
        '2026-01-01', '2026-12-31', true,
        ARRAY[v_test_group_id]::UUID[], v_user_id,
        'Normal level control for daily CBC QC'
    ) RETURNING id INTO v_lot_l1_id;

    -- Level 2 (Abnormal) Control
    INSERT INTO qc_lots (
        id, lab_id, lot_number, material_name, manufacturer, lot_type, level,
        received_date, expiry_date, is_active, test_group_ids, created_by, notes
    ) VALUES (
        gen_random_uuid(), v_lab_id, 'LOT-CBC-2026-002', 'Bio-Rad Liquichek Hematology Control',
        'Bio-Rad', 'internal_control', 'Level 2 (Abnormal)',
        '2026-01-01', '2026-12-31', true,
        ARRAY[v_test_group_id]::UUID[], v_user_id,
        'Abnormal level control for daily CBC QC'
    ) RETURNING id INTO v_lot_l2_id;

    RAISE NOTICE 'Created QC Lots - L1: %, L2: %', v_lot_l1_id, v_lot_l2_id;

    -- ========================================================================
    -- Step 3: Create Target Values for Level 1 (Normal)
    -- ========================================================================

    -- Hemoglobin L1: Mean 13.5 g/dL, SD 0.3
    IF v_hb_id IS NOT NULL THEN
        INSERT INTO qc_target_values (qc_lot_id, analyte_id, test_group_id, target_mean, target_sd, unit, source)
        VALUES (v_lot_l1_id, v_hb_id, v_test_group_id, 13.5, 0.3, 'g/dL', 'manufacturer');
    END IF;

    -- RBC L1: Mean 4.5 M/uL, SD 0.15
    IF v_rbc_id IS NOT NULL THEN
        INSERT INTO qc_target_values (qc_lot_id, analyte_id, test_group_id, target_mean, target_sd, unit, source)
        VALUES (v_lot_l1_id, v_rbc_id, v_test_group_id, 4.5, 0.15, 'M/uL', 'manufacturer');
    END IF;

    -- WBC L1: Mean 7.0 K/uL, SD 0.35
    IF v_wbc_id IS NOT NULL THEN
        INSERT INTO qc_target_values (qc_lot_id, analyte_id, test_group_id, target_mean, target_sd, unit, source)
        VALUES (v_lot_l1_id, v_wbc_id, v_test_group_id, 7.0, 0.35, 'K/uL', 'manufacturer');
    END IF;

    -- Platelets L1: Mean 250 K/uL, SD 15
    IF v_plt_id IS NOT NULL THEN
        INSERT INTO qc_target_values (qc_lot_id, analyte_id, test_group_id, target_mean, target_sd, unit, source)
        VALUES (v_lot_l1_id, v_plt_id, v_test_group_id, 250, 15, 'K/uL', 'manufacturer');
    END IF;

    -- HCT L1: Mean 40%, SD 1.2
    IF v_hct_id IS NOT NULL THEN
        INSERT INTO qc_target_values (qc_lot_id, analyte_id, test_group_id, target_mean, target_sd, unit, source)
        VALUES (v_lot_l1_id, v_hct_id, v_test_group_id, 40, 1.2, '%', 'manufacturer');
    END IF;

    -- MCV L1: Mean 88 fL, SD 2.5
    IF v_mcv_id IS NOT NULL THEN
        INSERT INTO qc_target_values (qc_lot_id, analyte_id, test_group_id, target_mean, target_sd, unit, source)
        VALUES (v_lot_l1_id, v_mcv_id, v_test_group_id, 88, 2.5, 'fL', 'manufacturer');
    END IF;

    -- MCH L1: Mean 30 pg, SD 1.0
    IF v_mch_id IS NOT NULL THEN
        INSERT INTO qc_target_values (qc_lot_id, analyte_id, test_group_id, target_mean, target_sd, unit, source)
        VALUES (v_lot_l1_id, v_mch_id, v_test_group_id, 30, 1.0, 'pg', 'manufacturer');
    END IF;

    -- MCHC L1: Mean 34 g/dL, SD 0.8
    IF v_mchc_id IS NOT NULL THEN
        INSERT INTO qc_target_values (qc_lot_id, analyte_id, test_group_id, target_mean, target_sd, unit, source)
        VALUES (v_lot_l1_id, v_mchc_id, v_test_group_id, 34, 0.8, 'g/dL', 'manufacturer');
    END IF;

    -- RDW L1: Mean 13.5%, SD 0.5
    IF v_rdw_id IS NOT NULL THEN
        INSERT INTO qc_target_values (qc_lot_id, analyte_id, test_group_id, target_mean, target_sd, unit, source)
        VALUES (v_lot_l1_id, v_rdw_id, v_test_group_id, 13.5, 0.5, '%', 'manufacturer');
    END IF;

    -- MPV L1: Mean 9.5 fL, SD 0.6
    IF v_mpv_id IS NOT NULL THEN
        INSERT INTO qc_target_values (qc_lot_id, analyte_id, test_group_id, target_mean, target_sd, unit, source)
        VALUES (v_lot_l1_id, v_mpv_id, v_test_group_id, 9.5, 0.6, 'fL', 'manufacturer');
    END IF;

    -- ========================================================================
    -- Step 4: Create Target Values for Level 2 (Abnormal - Low)
    -- ========================================================================

    -- Hemoglobin L2: Mean 8.5 g/dL, SD 0.25
    IF v_hb_id IS NOT NULL THEN
        INSERT INTO qc_target_values (qc_lot_id, analyte_id, test_group_id, target_mean, target_sd, unit, source)
        VALUES (v_lot_l2_id, v_hb_id, v_test_group_id, 8.5, 0.25, 'g/dL', 'manufacturer');
    END IF;

    -- RBC L2: Mean 3.0 M/uL, SD 0.12
    IF v_rbc_id IS NOT NULL THEN
        INSERT INTO qc_target_values (qc_lot_id, analyte_id, test_group_id, target_mean, target_sd, unit, source)
        VALUES (v_lot_l2_id, v_rbc_id, v_test_group_id, 3.0, 0.12, 'M/uL', 'manufacturer');
    END IF;

    -- WBC L2: Mean 3.5 K/uL, SD 0.2
    IF v_wbc_id IS NOT NULL THEN
        INSERT INTO qc_target_values (qc_lot_id, analyte_id, test_group_id, target_mean, target_sd, unit, source)
        VALUES (v_lot_l2_id, v_wbc_id, v_test_group_id, 3.5, 0.2, 'K/uL', 'manufacturer');
    END IF;

    -- Platelets L2: Mean 100 K/uL, SD 8
    IF v_plt_id IS NOT NULL THEN
        INSERT INTO qc_target_values (qc_lot_id, analyte_id, test_group_id, target_mean, target_sd, unit, source)
        VALUES (v_lot_l2_id, v_plt_id, v_test_group_id, 100, 8, 'K/uL', 'manufacturer');
    END IF;

    -- HCT L2: Mean 28%, SD 0.9
    IF v_hct_id IS NOT NULL THEN
        INSERT INTO qc_target_values (qc_lot_id, analyte_id, test_group_id, target_mean, target_sd, unit, source)
        VALUES (v_lot_l2_id, v_hct_id, v_test_group_id, 28, 0.9, '%', 'manufacturer');
    END IF;

    -- MCV L2: Mean 75 fL, SD 2.0
    IF v_mcv_id IS NOT NULL THEN
        INSERT INTO qc_target_values (qc_lot_id, analyte_id, test_group_id, target_mean, target_sd, unit, source)
        VALUES (v_lot_l2_id, v_mcv_id, v_test_group_id, 75, 2.0, 'fL', 'manufacturer');
    END IF;

    -- MCH L2: Mean 25 pg, SD 0.8
    IF v_mch_id IS NOT NULL THEN
        INSERT INTO qc_target_values (qc_lot_id, analyte_id, test_group_id, target_mean, target_sd, unit, source)
        VALUES (v_lot_l2_id, v_mch_id, v_test_group_id, 25, 0.8, 'pg', 'manufacturer');
    END IF;

    -- MCHC L2: Mean 32 g/dL, SD 0.6
    IF v_mchc_id IS NOT NULL THEN
        INSERT INTO qc_target_values (qc_lot_id, analyte_id, test_group_id, target_mean, target_sd, unit, source)
        VALUES (v_lot_l2_id, v_mchc_id, v_test_group_id, 32, 0.6, 'g/dL', 'manufacturer');
    END IF;

    -- RDW L2: Mean 18%, SD 0.7
    IF v_rdw_id IS NOT NULL THEN
        INSERT INTO qc_target_values (qc_lot_id, analyte_id, test_group_id, target_mean, target_sd, unit, source)
        VALUES (v_lot_l2_id, v_rdw_id, v_test_group_id, 18, 0.7, '%', 'manufacturer');
    END IF;

    -- MPV L2: Mean 11.5 fL, SD 0.7
    IF v_mpv_id IS NOT NULL THEN
        INSERT INTO qc_target_values (qc_lot_id, analyte_id, test_group_id, target_mean, target_sd, unit, source)
        VALUES (v_lot_l2_id, v_mpv_id, v_test_group_id, 11.5, 0.7, 'fL', 'manufacturer');
    END IF;

    RAISE NOTICE 'Created target values for both levels';

    -- ========================================================================
    -- Step 5: Create QC Runs for past 30 days (twice daily)
    -- ========================================================================

    FOR v_day_offset IN 0..29 LOOP
        v_run_date := CURRENT_DATE - v_day_offset;

        -- Morning run (Run 1)
        INSERT INTO qc_runs (
            id, lab_id, run_date, run_time, run_number, analyzer_name,
            operator_id, run_type, status, overall_pass, created_by
        ) VALUES (
            gen_random_uuid(), v_lab_id, v_run_date, '08:30:00', 1, 'Sysmex XN-1000',
            v_user_id, 'routine', 'reviewed', true, v_user_id
        ) RETURNING id INTO v_run_id;

        -- Add Level 1 results for morning run
        -- Generate results with normal distribution (most within 1SD, some at 2SD, rare at 3SD)
        -- Hemoglobin L1
        IF v_hb_id IS NOT NULL THEN
            v_z_score := (random() * 4 - 2); -- Range -2 to +2 normally
            IF random() < 0.05 THEN v_z_score := (random() * 2 + 2) * (CASE WHEN random() > 0.5 THEN 1 ELSE -1 END); END IF; -- 5% chance of >2SD
            v_observed_value := 13.5 + (v_z_score * 0.3);
            v_pass_fail := CASE WHEN ABS(v_z_score) <= 2 THEN 'pass' ELSE 'fail' END;
            v_westgard_flags := CASE
                WHEN ABS(v_z_score) > 3 THEN ARRAY['1:3s']
                WHEN ABS(v_z_score) > 2 THEN ARRAY['1:2s']
                ELSE ARRAY[]::TEXT[]
            END;

            INSERT INTO qc_results (qc_run_id, qc_lot_id, analyte_id, test_group_id, observed_value, unit, target_mean, target_sd)
            VALUES (v_run_id, v_lot_l1_id, v_hb_id, v_test_group_id, ROUND(v_observed_value::NUMERIC, 2), 'g/dL', 13.5, 0.3);
        END IF;

        -- RBC L1
        IF v_rbc_id IS NOT NULL THEN
            v_z_score := (random() * 4 - 2);
            IF random() < 0.05 THEN v_z_score := (random() * 2 + 2) * (CASE WHEN random() > 0.5 THEN 1 ELSE -1 END); END IF;
            v_observed_value := 4.5 + (v_z_score * 0.15);
            v_pass_fail := CASE WHEN ABS(v_z_score) <= 2 THEN 'pass' ELSE 'fail' END;
            v_westgard_flags := CASE WHEN ABS(v_z_score) > 3 THEN ARRAY['1:3s'] WHEN ABS(v_z_score) > 2 THEN ARRAY['1:2s'] ELSE ARRAY[]::TEXT[] END;

            INSERT INTO qc_results (qc_run_id, qc_lot_id, analyte_id, test_group_id, observed_value, unit, target_mean, target_sd)
            VALUES (v_run_id, v_lot_l1_id, v_rbc_id, v_test_group_id, ROUND(v_observed_value::NUMERIC, 2), 'M/uL', 4.5, 0.15);
        END IF;

        -- WBC L1
        IF v_wbc_id IS NOT NULL THEN
            v_z_score := (random() * 4 - 2);
            IF random() < 0.05 THEN v_z_score := (random() * 2 + 2) * (CASE WHEN random() > 0.5 THEN 1 ELSE -1 END); END IF;
            v_observed_value := 7.0 + (v_z_score * 0.35);
            v_pass_fail := CASE WHEN ABS(v_z_score) <= 2 THEN 'pass' ELSE 'fail' END;
            v_westgard_flags := CASE WHEN ABS(v_z_score) > 3 THEN ARRAY['1:3s'] WHEN ABS(v_z_score) > 2 THEN ARRAY['1:2s'] ELSE ARRAY[]::TEXT[] END;

            INSERT INTO qc_results (qc_run_id, qc_lot_id, analyte_id, test_group_id, observed_value, unit, target_mean, target_sd)
            VALUES (v_run_id, v_lot_l1_id, v_wbc_id, v_test_group_id, ROUND(v_observed_value::NUMERIC, 2), 'K/uL', 7.0, 0.35);
        END IF;

        -- Platelets L1
        IF v_plt_id IS NOT NULL THEN
            v_z_score := (random() * 4 - 2);
            IF random() < 0.05 THEN v_z_score := (random() * 2 + 2) * (CASE WHEN random() > 0.5 THEN 1 ELSE -1 END); END IF;
            v_observed_value := 250 + (v_z_score * 15);
            v_pass_fail := CASE WHEN ABS(v_z_score) <= 2 THEN 'pass' ELSE 'fail' END;
            v_westgard_flags := CASE WHEN ABS(v_z_score) > 3 THEN ARRAY['1:3s'] WHEN ABS(v_z_score) > 2 THEN ARRAY['1:2s'] ELSE ARRAY[]::TEXT[] END;

            INSERT INTO qc_results (qc_run_id, qc_lot_id, analyte_id, test_group_id, observed_value, unit, target_mean, target_sd)
            VALUES (v_run_id, v_lot_l1_id, v_plt_id, v_test_group_id, ROUND(v_observed_value::NUMERIC, 0), 'K/uL', 250, 15);
        END IF;

        -- HCT L1
        IF v_hct_id IS NOT NULL THEN
            v_z_score := (random() * 4 - 2);
            IF random() < 0.05 THEN v_z_score := (random() * 2 + 2) * (CASE WHEN random() > 0.5 THEN 1 ELSE -1 END); END IF;
            v_observed_value := 40 + (v_z_score * 1.2);
            v_pass_fail := CASE WHEN ABS(v_z_score) <= 2 THEN 'pass' ELSE 'fail' END;
            v_westgard_flags := CASE WHEN ABS(v_z_score) > 3 THEN ARRAY['1:3s'] WHEN ABS(v_z_score) > 2 THEN ARRAY['1:2s'] ELSE ARRAY[]::TEXT[] END;

            INSERT INTO qc_results (qc_run_id, qc_lot_id, analyte_id, test_group_id, observed_value, unit, target_mean, target_sd)
            VALUES (v_run_id, v_lot_l1_id, v_hct_id, v_test_group_id, ROUND(v_observed_value::NUMERIC, 1), '%', 40, 1.2);
        END IF;

        -- MCV L1
        IF v_mcv_id IS NOT NULL THEN
            v_z_score := (random() * 4 - 2);
            v_observed_value := 88 + (v_z_score * 2.5);
            v_pass_fail := CASE WHEN ABS(v_z_score) <= 2 THEN 'pass' ELSE 'fail' END;
            v_westgard_flags := CASE WHEN ABS(v_z_score) > 3 THEN ARRAY['1:3s'] WHEN ABS(v_z_score) > 2 THEN ARRAY['1:2s'] ELSE ARRAY[]::TEXT[] END;

            INSERT INTO qc_results (qc_run_id, qc_lot_id, analyte_id, test_group_id, observed_value, unit, target_mean, target_sd)
            VALUES (v_run_id, v_lot_l1_id, v_mcv_id, v_test_group_id, ROUND(v_observed_value::NUMERIC, 1), 'fL', 88, 2.5);
        END IF;

        -- MCH L1
        IF v_mch_id IS NOT NULL THEN
            v_z_score := (random() * 4 - 2);
            v_observed_value := 30 + (v_z_score * 1.0);
            v_pass_fail := CASE WHEN ABS(v_z_score) <= 2 THEN 'pass' ELSE 'fail' END;
            v_westgard_flags := CASE WHEN ABS(v_z_score) > 3 THEN ARRAY['1:3s'] WHEN ABS(v_z_score) > 2 THEN ARRAY['1:2s'] ELSE ARRAY[]::TEXT[] END;

            INSERT INTO qc_results (qc_run_id, qc_lot_id, analyte_id, test_group_id, observed_value, unit, target_mean, target_sd)
            VALUES (v_run_id, v_lot_l1_id, v_mch_id, v_test_group_id, ROUND(v_observed_value::NUMERIC, 1), 'pg', 30, 1.0);
        END IF;

        -- MCHC L1
        IF v_mchc_id IS NOT NULL THEN
            v_z_score := (random() * 4 - 2);
            v_observed_value := 34 + (v_z_score * 0.8);
            v_pass_fail := CASE WHEN ABS(v_z_score) <= 2 THEN 'pass' ELSE 'fail' END;
            v_westgard_flags := CASE WHEN ABS(v_z_score) > 3 THEN ARRAY['1:3s'] WHEN ABS(v_z_score) > 2 THEN ARRAY['1:2s'] ELSE ARRAY[]::TEXT[] END;

            INSERT INTO qc_results (qc_run_id, qc_lot_id, analyte_id, test_group_id, observed_value, unit, target_mean, target_sd)
            VALUES (v_run_id, v_lot_l1_id, v_mchc_id, v_test_group_id, ROUND(v_observed_value::NUMERIC, 1), 'g/dL', 34, 0.8);
        END IF;

        -- RDW L1
        IF v_rdw_id IS NOT NULL THEN
            v_z_score := (random() * 4 - 2);
            v_observed_value := 13.5 + (v_z_score * 0.5);
            v_pass_fail := CASE WHEN ABS(v_z_score) <= 2 THEN 'pass' ELSE 'fail' END;
            v_westgard_flags := CASE WHEN ABS(v_z_score) > 3 THEN ARRAY['1:3s'] WHEN ABS(v_z_score) > 2 THEN ARRAY['1:2s'] ELSE ARRAY[]::TEXT[] END;

            INSERT INTO qc_results (qc_run_id, qc_lot_id, analyte_id, test_group_id, observed_value, unit, target_mean, target_sd)
            VALUES (v_run_id, v_lot_l1_id, v_rdw_id, v_test_group_id, ROUND(v_observed_value::NUMERIC, 1), '%', 13.5, 0.5);
        END IF;

        -- MPV L1
        IF v_mpv_id IS NOT NULL THEN
            v_z_score := (random() * 4 - 2);
            v_observed_value := 9.5 + (v_z_score * 0.6);
            v_pass_fail := CASE WHEN ABS(v_z_score) <= 2 THEN 'pass' ELSE 'fail' END;
            v_westgard_flags := CASE WHEN ABS(v_z_score) > 3 THEN ARRAY['1:3s'] WHEN ABS(v_z_score) > 2 THEN ARRAY['1:2s'] ELSE ARRAY[]::TEXT[] END;

            INSERT INTO qc_results (qc_run_id, qc_lot_id, analyte_id, test_group_id, observed_value, unit, target_mean, target_sd)
            VALUES (v_run_id, v_lot_l1_id, v_mpv_id, v_test_group_id, ROUND(v_observed_value::NUMERIC, 1), 'fL', 9.5, 0.6);
        END IF;

        -- Update run overall_pass based on results
        UPDATE qc_runs SET overall_pass = NOT EXISTS (
            SELECT 1 FROM qc_results WHERE qc_run_id = v_run_id AND pass_fail = 'fail'
        ) WHERE id = v_run_id;

        -- ====== Afternoon run (Run 2) with Level 2 ======
        INSERT INTO qc_runs (
            id, lab_id, run_date, run_time, run_number, analyzer_name,
            operator_id, run_type, status, overall_pass, created_by
        ) VALUES (
            gen_random_uuid(), v_lab_id, v_run_date, '14:30:00', 2, 'Sysmex XN-1000',
            v_user_id, 'routine', 'reviewed', true, v_user_id
        ) RETURNING id INTO v_run_id;

        -- Add Level 2 results for afternoon run (similar pattern but with L2 targets)
        -- Hemoglobin L2
        IF v_hb_id IS NOT NULL THEN
            v_z_score := (random() * 4 - 2);
            IF random() < 0.08 THEN v_z_score := (random() * 2 + 2) * (CASE WHEN random() > 0.5 THEN 1 ELSE -1 END); END IF;
            v_observed_value := 8.5 + (v_z_score * 0.25);
            v_pass_fail := CASE WHEN ABS(v_z_score) <= 2 THEN 'pass' ELSE 'fail' END;
            v_westgard_flags := CASE WHEN ABS(v_z_score) > 3 THEN ARRAY['1:3s'] WHEN ABS(v_z_score) > 2 THEN ARRAY['1:2s'] ELSE ARRAY[]::TEXT[] END;

            INSERT INTO qc_results (qc_run_id, qc_lot_id, analyte_id, test_group_id, observed_value, unit, target_mean, target_sd)
            VALUES (v_run_id, v_lot_l2_id, v_hb_id, v_test_group_id, ROUND(v_observed_value::NUMERIC, 2), 'g/dL', 8.5, 0.25);
        END IF;

        -- RBC L2
        IF v_rbc_id IS NOT NULL THEN
            v_z_score := (random() * 4 - 2);
            v_observed_value := 3.0 + (v_z_score * 0.12);
            v_pass_fail := CASE WHEN ABS(v_z_score) <= 2 THEN 'pass' ELSE 'fail' END;
            v_westgard_flags := CASE WHEN ABS(v_z_score) > 3 THEN ARRAY['1:3s'] WHEN ABS(v_z_score) > 2 THEN ARRAY['1:2s'] ELSE ARRAY[]::TEXT[] END;

            INSERT INTO qc_results (qc_run_id, qc_lot_id, analyte_id, test_group_id, observed_value, unit, target_mean, target_sd)
            VALUES (v_run_id, v_lot_l2_id, v_rbc_id, v_test_group_id, ROUND(v_observed_value::NUMERIC, 2), 'M/uL', 3.0, 0.12);
        END IF;

        -- WBC L2
        IF v_wbc_id IS NOT NULL THEN
            v_z_score := (random() * 4 - 2);
            v_observed_value := 3.5 + (v_z_score * 0.2);
            v_pass_fail := CASE WHEN ABS(v_z_score) <= 2 THEN 'pass' ELSE 'fail' END;
            v_westgard_flags := CASE WHEN ABS(v_z_score) > 3 THEN ARRAY['1:3s'] WHEN ABS(v_z_score) > 2 THEN ARRAY['1:2s'] ELSE ARRAY[]::TEXT[] END;

            INSERT INTO qc_results (qc_run_id, qc_lot_id, analyte_id, test_group_id, observed_value, unit, target_mean, target_sd)
            VALUES (v_run_id, v_lot_l2_id, v_wbc_id, v_test_group_id, ROUND(v_observed_value::NUMERIC, 2), 'K/uL', 3.5, 0.2);
        END IF;

        -- Platelets L2
        IF v_plt_id IS NOT NULL THEN
            v_z_score := (random() * 4 - 2);
            v_observed_value := 100 + (v_z_score * 8);
            v_pass_fail := CASE WHEN ABS(v_z_score) <= 2 THEN 'pass' ELSE 'fail' END;
            v_westgard_flags := CASE WHEN ABS(v_z_score) > 3 THEN ARRAY['1:3s'] WHEN ABS(v_z_score) > 2 THEN ARRAY['1:2s'] ELSE ARRAY[]::TEXT[] END;

            INSERT INTO qc_results (qc_run_id, qc_lot_id, analyte_id, test_group_id, observed_value, unit, target_mean, target_sd)
            VALUES (v_run_id, v_lot_l2_id, v_plt_id, v_test_group_id, ROUND(v_observed_value::NUMERIC, 0), 'K/uL', 100, 8);
        END IF;

        -- HCT L2
        IF v_hct_id IS NOT NULL THEN
            v_z_score := (random() * 4 - 2);
            v_observed_value := 28 + (v_z_score * 0.9);
            v_pass_fail := CASE WHEN ABS(v_z_score) <= 2 THEN 'pass' ELSE 'fail' END;
            v_westgard_flags := CASE WHEN ABS(v_z_score) > 3 THEN ARRAY['1:3s'] WHEN ABS(v_z_score) > 2 THEN ARRAY['1:2s'] ELSE ARRAY[]::TEXT[] END;

            INSERT INTO qc_results (qc_run_id, qc_lot_id, analyte_id, test_group_id, observed_value, unit, target_mean, target_sd)
            VALUES (v_run_id, v_lot_l2_id, v_hct_id, v_test_group_id, ROUND(v_observed_value::NUMERIC, 1), '%', 28, 0.9);
        END IF;

        -- MCV L2
        IF v_mcv_id IS NOT NULL THEN
            v_z_score := (random() * 4 - 2);
            v_observed_value := 75 + (v_z_score * 2.0);
            v_pass_fail := CASE WHEN ABS(v_z_score) <= 2 THEN 'pass' ELSE 'fail' END;
            v_westgard_flags := CASE WHEN ABS(v_z_score) > 3 THEN ARRAY['1:3s'] WHEN ABS(v_z_score) > 2 THEN ARRAY['1:2s'] ELSE ARRAY[]::TEXT[] END;

            INSERT INTO qc_results (qc_run_id, qc_lot_id, analyte_id, test_group_id, observed_value, unit, target_mean, target_sd)
            VALUES (v_run_id, v_lot_l2_id, v_mcv_id, v_test_group_id, ROUND(v_observed_value::NUMERIC, 1), 'fL', 75, 2.0);
        END IF;

        -- MCH L2
        IF v_mch_id IS NOT NULL THEN
            v_z_score := (random() * 4 - 2);
            v_observed_value := 25 + (v_z_score * 0.8);
            v_pass_fail := CASE WHEN ABS(v_z_score) <= 2 THEN 'pass' ELSE 'fail' END;
            v_westgard_flags := CASE WHEN ABS(v_z_score) > 3 THEN ARRAY['1:3s'] WHEN ABS(v_z_score) > 2 THEN ARRAY['1:2s'] ELSE ARRAY[]::TEXT[] END;

            INSERT INTO qc_results (qc_run_id, qc_lot_id, analyte_id, test_group_id, observed_value, unit, target_mean, target_sd)
            VALUES (v_run_id, v_lot_l2_id, v_mch_id, v_test_group_id, ROUND(v_observed_value::NUMERIC, 1), 'pg', 25, 0.8);
        END IF;

        -- MCHC L2
        IF v_mchc_id IS NOT NULL THEN
            v_z_score := (random() * 4 - 2);
            v_observed_value := 32 + (v_z_score * 0.6);
            v_pass_fail := CASE WHEN ABS(v_z_score) <= 2 THEN 'pass' ELSE 'fail' END;
            v_westgard_flags := CASE WHEN ABS(v_z_score) > 3 THEN ARRAY['1:3s'] WHEN ABS(v_z_score) > 2 THEN ARRAY['1:2s'] ELSE ARRAY[]::TEXT[] END;

            INSERT INTO qc_results (qc_run_id, qc_lot_id, analyte_id, test_group_id, observed_value, unit, target_mean, target_sd)
            VALUES (v_run_id, v_lot_l2_id, v_mchc_id, v_test_group_id, ROUND(v_observed_value::NUMERIC, 1), 'g/dL', 32, 0.6);
        END IF;

        -- RDW L2
        IF v_rdw_id IS NOT NULL THEN
            v_z_score := (random() * 4 - 2);
            v_observed_value := 18 + (v_z_score * 0.7);
            v_pass_fail := CASE WHEN ABS(v_z_score) <= 2 THEN 'pass' ELSE 'fail' END;
            v_westgard_flags := CASE WHEN ABS(v_z_score) > 3 THEN ARRAY['1:3s'] WHEN ABS(v_z_score) > 2 THEN ARRAY['1:2s'] ELSE ARRAY[]::TEXT[] END;

            INSERT INTO qc_results (qc_run_id, qc_lot_id, analyte_id, test_group_id, observed_value, unit, target_mean, target_sd)
            VALUES (v_run_id, v_lot_l2_id, v_rdw_id, v_test_group_id, ROUND(v_observed_value::NUMERIC, 1), '%', 18, 0.7);
        END IF;

        -- MPV L2
        IF v_mpv_id IS NOT NULL THEN
            v_z_score := (random() * 4 - 2);
            v_observed_value := 11.5 + (v_z_score * 0.7);
            v_pass_fail := CASE WHEN ABS(v_z_score) <= 2 THEN 'pass' ELSE 'fail' END;
            v_westgard_flags := CASE WHEN ABS(v_z_score) > 3 THEN ARRAY['1:3s'] WHEN ABS(v_z_score) > 2 THEN ARRAY['1:2s'] ELSE ARRAY[]::TEXT[] END;

            INSERT INTO qc_results (qc_run_id, qc_lot_id, analyte_id, test_group_id, observed_value, unit, target_mean, target_sd)
            VALUES (v_run_id, v_lot_l2_id, v_mpv_id, v_test_group_id, ROUND(v_observed_value::NUMERIC, 1), 'fL', 11.5, 0.7);
        END IF;

        -- Update run overall_pass
        UPDATE qc_runs SET overall_pass = NOT EXISTS (
            SELECT 1 FROM qc_results WHERE qc_run_id = v_run_id AND pass_fail = 'fail'
        ) WHERE id = v_run_id;

    END LOOP;

    RAISE NOTICE 'Created 60 QC runs (30 days x 2 runs/day) with results';

    -- ========================================================================
    -- Step 6: Create a few sample investigations for failed runs
    -- ========================================================================

    -- Find a failed run and create investigation
    INSERT INTO qc_investigations (
        lab_id, qc_run_id, investigation_number, title, description,
        severity, status, impacted_test_group_ids,
        ai_summary, ai_likely_causes, ai_recommendations,
        created_by
    )
    SELECT
        v_lab_id,
        r.id,
        'INV-' || TO_CHAR(CURRENT_DATE, 'YYYYMMDD') || '-0001',
        'WBC QC Failure - Level 1 Out of Range',
        'QC result for WBC Level 1 exceeded 2SD limit',
        'medium',
        'open',
        ARRAY[v_test_group_id]::UUID[],
        'The WBC control Level 1 showed a value exceeding +2SD from the target mean. This may indicate reagent deterioration or calibration drift.',
        '[{"cause": "Reagent deterioration", "likelihood": 0.4}, {"cause": "Calibration drift", "likelihood": 0.3}, {"cause": "Sample handling issue", "likelihood": 0.2}]'::JSONB,
        '[{"action": "Repeat QC with fresh control", "priority": "high"}, {"action": "Check reagent expiry and storage", "priority": "medium"}, {"action": "Review calibration status", "priority": "medium"}]'::JSONB,
        v_user_id
    FROM qc_runs r
    JOIN qc_results res ON res.qc_run_id = r.id
    WHERE r.lab_id = v_lab_id
      AND res.pass_fail = 'fail'
    ORDER BY r.run_date DESC
    LIMIT 1;

    RAISE NOTICE 'Sample QC data creation completed successfully!';

END $$;

-- ============================================================================
-- Summary Statistics Query (run after migration to verify)
-- ============================================================================
-- SELECT
--     'QC Lots' as table_name, COUNT(*) as count
-- FROM qc_lots WHERE lab_id = '43ef4f85-3133-44d0-aa2b-9fca56de856e'
-- UNION ALL
-- SELECT 'Target Values', COUNT(*) FROM qc_target_values tv
-- JOIN qc_lots l ON l.id = tv.qc_lot_id WHERE l.lab_id = '43ef4f85-3133-44d0-aa2b-9fca56de856e'
-- UNION ALL
-- SELECT 'QC Runs', COUNT(*) FROM qc_runs WHERE lab_id = '43ef4f85-3133-44d0-aa2b-9fca56de856e'
-- UNION ALL
-- SELECT 'QC Results', COUNT(*) FROM qc_results r
-- JOIN qc_runs run ON run.id = r.qc_run_id WHERE run.lab_id = '43ef4f85-3133-44d0-aa2b-9fca56de856e';
