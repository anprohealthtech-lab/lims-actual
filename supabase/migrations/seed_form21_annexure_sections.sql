-- ============================================================
-- seed_form21_annexure_sections.sql
--
-- Seeds lab_template_sections for the Form 21 Annexure
-- (Pre-Employment & Periodic Medical Examination, prescribed
-- under Rule 19 / Section 87, C.G. Factories Rules 1962).
--
-- SCOPE: the Annexure only — the 15-column Health Register in
-- Part 1 of Form 21 is a cross-worker ledger and cannot be a
-- report section (sections are scoped to one result_id).
--
-- Item (8) LAB INVESTIGATIONS is deliberately NOT seeded here.
-- Hb/TLC/DLC/lipids/LFT/RFT/sugar must be real analytes on the
-- test group so reference ranges, flags and verification work.
--
-- Idempotent: re-running will not duplicate — it matches on
-- (lab_id, test_group_id, placeholder_key).
-- ============================================================

DO $$
DECLARE
  v_lab_id      UUID := '86367d26-9b0d-4135-b2aa-b8b9afec8924';
  v_group_id    UUID := 'c1d53eae-c3f2-4e11-85b0-1c57e9316e72';
  v_group_name  TEXT;
  v_inserted    INT  := 0;
BEGIN

  -- ── Validate the test group belongs to this lab ────────────
  SELECT name INTO v_group_name
  FROM test_groups
  WHERE id = v_group_id AND lab_id = v_lab_id;

  IF v_group_name IS NULL THEN
    RAISE EXCEPTION 'Test group % not found for lab % — check both ids.',
      v_group_id, v_lab_id;
  END IF;

  -- ── Insert sections ────────────────────────────────────────
  -- section_type is constrained to 7 values; 'custom' is used for
  -- the exam items and 'conclusion' for the fitness opinion.
  WITH seed(section_type, section_name, display_order, placeholder_key,
            default_content, predefined_options, is_required, is_editable,
            allow_images, allow_technician_entry, section_config) AS (
    VALUES

    -- (1) GENERAL EXAMINATION ---------------------------------
    ('custom', '(1) General Examination', 10, 'form21_general',
     NULL, '[]'::jsonb, true, true, false, true,
     '{"mode":"matrix","cascade_levels":[],"matrix":{
        "rows":["Height (cm)","Weight (kg)","BMI","Chest – Inspiration (cm)","Chest – Expiration (cm)",
                "Throat","Tongue","Tonsils","Teeth","Gums","Thyroid","Lymph Nodes","Additional Findings"],
        "columns":["Finding"],"reportStyle":"plain"}}'::jsonb),

    ('custom', '(1a) Built', 20, 'form21_built',
     NULL, '[]'::jsonb, false, true, false, true,
     '{"mode":"cascading","matrix":{"rows":[],"columns":[]},"cascade_levels":[
        {"id":"built","label":"Built","multi_select":false,"options":[
          {"id":"b1","value":"Average"},{"id":"b2","value":"Strong"},{"id":"b3","value":"Poor"}]}]}'::jsonb),

    -- (2) CARDIO-VASCULAR SYSTEM ------------------------------
    ('custom', '(2) Cardio-Vascular System', 30, 'form21_cvs',
     NULL, '[]'::jsonb, true, true, false, true,
     '{"mode":"matrix","cascade_levels":[],"matrix":{
        "rows":["Pulse (/min)","Rhythm","Peripheral Pulse","B.P. (mm of Hg)","Heart Sounds",
                "Murmur, if any","Additional Findings"],
        "columns":["Finding"],"reportStyle":"plain"}}'::jsonb),

    -- (3) RESPIRATORY SYSTEM ----------------------------------
    ('custom', '(3) Respiratory System', 40, 'form21_respiratory',
     NULL, '[]'::jsonb, true, true, false, true,
     '{"mode":"matrix","cascade_levels":[],"matrix":{
        "rows":["Shape of Chest","Chest Movements","Trachea","Breath Sounds"],
        "columns":["Finding"],"reportStyle":"plain"}}'::jsonb),

    -- (4) GASTRO-INTESTINAL SYSTEM ----------------------------
    ('custom', '(4) Gastro-Intestinal System', 50, 'form21_git',
     NULL, '[]'::jsonb, false, true, false, true,
     '{"mode":"matrix","cascade_levels":[],"matrix":{
        "rows":["Liver","Spleen","Any Abdominal Lumps"],
        "columns":["Finding"],"reportStyle":"plain"}}'::jsonb),

    -- (5) EXAMINATION OF EYES ---------------------------------
    ('custom', '(5) Vision – Right / Left', 60, 'form21_vision',
     NULL, '[]'::jsonb, true, true, false, true,
     '{"mode":"matrix","cascade_levels":[],"matrix":{
        "rows":["Distant Vision (without glasses)","Distant Vision (with glasses)",
                "Near Vision (without glasses)","Near Vision (with glasses)","Fundus"],
        "columns":["Right","Left"],"reportStyle":"plain"}}'::jsonb),

    ('custom', '(5a) Eyes – Other Findings', 70, 'form21_eyes_other',
     NULL, '[]'::jsonb, false, true, false, true,
     '{"mode":"matrix","cascade_levels":[],"matrix":{
        "rows":["External Examination","Squint","Nystagmus","Colour Vision",
                "Individual Colour Identification","Night Blindness (Nyctalopia)"],
        "columns":["Finding"],"reportStyle":"plain"}}'::jsonb),

    -- (6) EAR, NOSE & THROAT ----------------------------------
    ('custom', '(6) Ear, Nose & Throat', 80, 'form21_ent',
     NULL,
     '["External examination – normal.","Hearing – normal on clinical testing.",
       "Nasal septum – central, no deviation.","Wax present – advised syringing."]'::jsonb,
     false, true, false, true,
     '{"mode":"flat","cascade_levels":[],"matrix":{"rows":[],"columns":[]}}'::jsonb),

    -- (7) GENITO-URINARY SYSTEM -------------------------------
    ('custom', '(7) Genito-Urinary System', 90, 'form21_gus',
     NULL, '[]'::jsonb, false, true, false, false,
     '{"mode":"matrix","cascade_levels":[],"matrix":{
        "rows":["Hernia","Hydrocele / Varicocele","Cryptorchidism","Phimosis",
                "Varicose Veins","Signs of STD"],
        "columns":["Finding"],"reportStyle":"plain"}}'::jsonb),

    ('clinical_history', '(7a) Menstrual & Obstetric History (Females)', 100, 'form21_female_history',
     NULL, '[]'::jsonb, false, true, false, false,
     '{"mode":"matrix","cascade_levels":[],"matrix":{
        "rows":["Menarche at (yrs)","Gravida","Para","LMP","Menstrual Irregularity, if any"],
        "columns":["Finding"],"reportStyle":"plain"}}'::jsonb),

    -- (9) OTHER INVESTIGATIONS --------------------------------
    -- Rich text + images so X-ray / ECG / USG films can be attached.
    ('findings', '(9) Other Investigations', 110, 'form21_other_investigations',
     '<p><strong>X-Ray Chest:</strong> </p><p><strong>ECG:</strong> </p><p><strong>Ultrasound Whole Abdomen:</strong> </p><p><strong>Others:</strong> </p>',
     '["X-Ray Chest – NAD.","ECG – within normal limits.","USG whole abdomen – no significant abnormality detected."]'::jsonb,
     false, true, true, false,
     '{"mode":"flat","cascade_levels":[],"matrix":{"rows":[],"columns":[]}}'::jsonb),

    -- (10) PULMONARY FUNCTION TEST ----------------------------
    ('custom', '(10) Pulmonary Function Test', 120, 'form21_pft',
     NULL, '[]'::jsonb, false, true, false, true,
     '{"mode":"matrix","cascade_levels":[],"matrix":{
        "rows":["Predicted","Measured","% of Predicted"],
        "columns":["FVC","FEV 1","FEV 1 / FVC"],"reportStyle":"plain"}}'::jsonb),

    ('custom', '(10a) PFT Remarks', 130, 'form21_pft_remarks',
     NULL,
     '["Normal spirometry.","Mild restrictive pattern.","Mild obstructive pattern.",
       "Moderate obstructive pattern – advised pulmonology referral."]'::jsonb,
     false, true, false, true,
     '{"mode":"flat","cascade_levels":[],"matrix":{"rows":[],"columns":[]}}'::jsonb),

    -- (11) AUDIOMETRY -----------------------------------------
    ('custom', '(11) Audiometry – PTA (dB)', 140, 'form21_audiometry',
     NULL, '[]'::jsonb, false, true, false, true,
     '{"mode":"matrix","cascade_levels":[],"matrix":{
        "rows":["Right Ear","Left Ear"],
        "columns":["125 Hz","250 Hz","500 Hz","1000 Hz","2000 Hz","4000 Hz","8000 Hz"],
        "reportStyle":"plain"}}'::jsonb),

    -- (12) CANTEEN STAFF --------------------------------------
    ('custom', '(12) Medical Examination of Canteen Staff', 150, 'form21_canteen',
     NULL,
     '["(a) Blood examination for venereal disease and routine blood examination – done, normal.",
       "(b) Stool and urine examination for worm infection – done, no ova/cyst seen.",
       "(c) Screening for skin diseases (scabies and others) – no lesions detected.",
       "(d) X-ray and other tests for T.B. – no evidence of active tuberculosis.",
       "Not applicable – worker is not canteen staff."]'::jsonb,
     false, true, false, false,
     '{"mode":"flat","cascade_levels":[],"matrix":{"rows":[],"columns":[]}}'::jsonb),

    -- (13) OTHER SPECIFIC EXAMINATIONS (Rule 107) --------------
    ('custom', '(13) Other Specific Examinations – Rule 107', 160, 'form21_rule107',
     NULL, '[]'::jsonb, false, true, false, false,
     '{"mode":"flat","cascade_levels":[],"matrix":{"rows":[],"columns":[]}}'::jsonb),

    -- FITNESS OPINION -----------------------------------------
    -- Feeds Column (11) of the Health Register: fit / unfit / suspended.
    ('conclusion', 'Fitness Opinion', 170, 'form21_fitness',
     NULL, '[]'::jsonb, true, true, false, false,
     '{"mode":"cascading","matrix":{"rows":[],"columns":[]},"cascade_levels":[
        {"id":"fit","label":"Certified","multi_select":false,"options":[
          {"id":"f1","value":"Fit for the present work"},
          {"id":"f2","value":"Fit with restrictions","sub_levels":[
            {"id":"restr","label":"Restriction","multi_select":true,"options":[
              {"id":"r1","value":"No work at height"},
              {"id":"r2","value":"No exposure to dust"},
              {"id":"r3","value":"No night shift"},
              {"id":"r4","value":"Hearing protection mandatory"},
              {"id":"r5","value":"Corrective glasses to be worn"}]}]},
          {"id":"f3","value":"Unfit for the present work"},
          {"id":"f4","value":"Suspended from work","sub_levels":[
            {"id":"susp","label":"Period of suspension","multi_select":false,"options":[
              {"id":"s1","value":"2 weeks"},{"id":"s2","value":"1 month"},
              {"id":"s3","value":"3 months"},{"id":"s4","value":"Until further review"}]}]}]}]}'::jsonb)
  )
  INSERT INTO lab_template_sections (
    lab_id, test_group_id, section_type, section_name, display_order,
    default_content, predefined_options, is_required, is_editable,
    placeholder_key, allow_images, allow_technician_entry, section_config
  )
  SELECT
    v_lab_id, v_group_id, s.section_type, s.section_name, s.display_order,
    s.default_content, s.predefined_options, s.is_required, s.is_editable,
    s.placeholder_key, s.allow_images, s.allow_technician_entry, s.section_config
  FROM seed s
  WHERE NOT EXISTS (
    SELECT 1 FROM lab_template_sections x
    WHERE x.lab_id = v_lab_id
      AND x.test_group_id = v_group_id
      AND x.placeholder_key = s.placeholder_key
  );

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RAISE NOTICE 'Form 21 Annexure: % section(s) inserted for test group % (lab %).',
    v_inserted, v_group_name, v_lab_id;

END $$;
