-- ============================================================================
-- Targeted AI Prompt Guardrails: Urine R/M + Blood Group Agglutination
-- Migration: 20260207_ai_prompt_urm_blood_group_guardrails.sql
--
-- Scope: test_groups + global_test_catalog (+ ai_prompts overrides, if present)
-- Strategy: append guardrail blocks only when missing, keep existing prompt body intact
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1) Urine Routine / Urine R-M: color-based pad interpretation guardrails
-- --------------------------------------------------------------------------

UPDATE public.test_groups
SET group_level_prompt =
  TRIM(COALESCE(group_level_prompt, '')) || E'\n\n[Urine Color Guardrails]\n- Image is pre-rotated upright; start analysis from TOP pad and move downward in strip order.\n- Use analyte context provided at runtime to map each pad to the correct analyte.\n- Compare each pad against baseline/no-reaction and reacted shades; handle faint transitions as TRACE/LOW where supported.\n- If glare, shadow, blur, saturation, or wet pooling obscures a pad, mark that analyte as UNDETERMINED (do not guess).\n- Extract observation-only outputs (color/state/grade); do NOT infer final diagnosis.\n- If microscopy fields are provided, keep microscopy findings separate from dipstick color findings.'
WHERE (
    UPPER(COALESCE(code, '')) = 'URM'
    OR name ILIKE '%urine routine%'
    OR name ILIKE '%urine r/m%'
    OR name ILIKE '%urine r-m%'
  )
  AND COALESCE(group_level_prompt, '') NOT ILIKE '%[Urine Color Guardrails]%';

UPDATE public.global_test_catalog
SET group_level_prompt =
  TRIM(COALESCE(group_level_prompt, '')) || E'\n\n[Urine Color Guardrails]\n- Image is pre-rotated upright; start analysis from TOP pad and move downward in strip order.\n- Use analyte context provided at runtime to map each pad to the correct analyte.\n- Compare each pad against baseline/no-reaction and reacted shades; handle faint transitions as TRACE/LOW where supported.\n- If glare, shadow, blur, saturation, or wet pooling obscures a pad, mark that analyte as UNDETERMINED (do not guess).\n- Extract observation-only outputs (color/state/grade); do NOT infer final diagnosis.\n- If microscopy fields are provided, keep microscopy findings separate from dipstick color findings.'
WHERE (
    UPPER(COALESCE(code, '')) = 'URM'
    OR name ILIKE '%urine routine%'
    OR name ILIKE '%urine r/m%'
    OR name ILIKE '%urine r-m%'
  )
  AND COALESCE(group_level_prompt, '') NOT ILIKE '%[Urine Color Guardrails]%';

-- Optional: if test-specific ai_prompts exist for Urine Routine, append same guardrails
UPDATE public.ai_prompts ap
SET prompt =
  TRIM(COALESCE(ap.prompt, '')) || E'\n\n[Urine Color Guardrails]\n- Image is pre-rotated upright; start analysis from TOP pad and move downward in strip order.\n- Use analyte context provided at runtime to map each pad to the correct analyte.\n- Compare each pad against baseline/no-reaction and reacted shades; handle faint transitions as TRACE/LOW where supported.\n- If glare, shadow, blur, saturation, or wet pooling obscures a pad, mark that analyte as UNDETERMINED (do not guess).\n- Extract observation-only outputs (color/state/grade); do NOT infer final diagnosis.'
WHERE ap.test_id IN (
    SELECT id
    FROM public.test_groups
    WHERE UPPER(COALESCE(code, '')) = 'URM'
       OR name ILIKE '%urine routine%'
       OR name ILIKE '%urine r/m%'
       OR name ILIKE '%urine r-m%'
  )
  AND COALESCE(ap.prompt, '') NOT ILIKE '%[Urine Color Guardrails]%';

-- --------------------------------------------------------------------------
-- 2) Blood Group: explicit agglutination logic (Anti-A / Anti-B / Anti-D / Control)
-- --------------------------------------------------------------------------

UPDATE public.test_groups
SET group_level_prompt =
  TRIM(COALESCE(group_level_prompt, '')) || E'\n\n[Agglutination Guardrails]\n- Confirm card/slide is upright and all wells are visible (Anti-A, Anti-B, Anti-D/Rh, and Control if present).\n- For each well, explicitly classify as: AGGLUTINATION PRESENT or NO AGGLUTINATION.\n- Determine ABO only from Anti-A and Anti-B well reactions; determine Rh only from Anti-D reaction.\n- If control well shows agglutination (or expected negative control fails), mark result INVALID and request manual repeat.\n- If mixed-field/weak or unclear clumping is seen, mark corresponding well as UNDETERMINED and escalate for manual review.\n- Report reaction pattern first, then mapped ABO/Rh output; do NOT add clinical interpretation.'
WHERE (
    UPPER(COALESCE(default_ai_processing_type, '')) = 'AGGLUTINATION_CARD'
    OR UPPER(COALESCE(code, '')) IN ('ABORH', 'BLOOD_GROUPING_AND_ANTIBODY_SCREENING')
    OR name ILIKE '%blood group%'
    OR name ILIKE '%abo%rh%'
  )
  AND COALESCE(group_level_prompt, '') NOT ILIKE '%[Agglutination Guardrails]%';

UPDATE public.global_test_catalog
SET group_level_prompt =
  TRIM(COALESCE(group_level_prompt, '')) || E'\n\n[Agglutination Guardrails]\n- Confirm card/slide is upright and all wells are visible (Anti-A, Anti-B, Anti-D/Rh, and Control if present).\n- For each well, explicitly classify as: AGGLUTINATION PRESENT or NO AGGLUTINATION.\n- Determine ABO only from Anti-A and Anti-B well reactions; determine Rh only from Anti-D reaction.\n- If control well shows agglutination (or expected negative control fails), mark result INVALID and request manual repeat.\n- If mixed-field/weak or unclear clumping is seen, mark corresponding well as UNDETERMINED and escalate for manual review.\n- Report reaction pattern first, then mapped ABO/Rh output; do NOT add clinical interpretation.'
WHERE (
    UPPER(COALESCE(default_ai_processing_type, '')) = 'AGGLUTINATION_CARD'
    OR UPPER(COALESCE(code, '')) IN ('ABORH', 'BLOOD_GROUPING_AND_ANTIBODY_SCREENING')
    OR name ILIKE '%blood group%'
    OR name ILIKE '%abo%rh%'
  )
  AND COALESCE(group_level_prompt, '') NOT ILIKE '%[Agglutination Guardrails]%';

-- Optional: if test-specific ai_prompts exist for blood-group cards, append same guardrails
UPDATE public.ai_prompts ap
SET prompt =
  TRIM(COALESCE(ap.prompt, '')) || E'\n\n[Agglutination Guardrails]\n- Confirm card/slide is upright and all wells are visible (Anti-A, Anti-B, Anti-D/Rh, and Control if present).\n- For each well, explicitly classify as: AGGLUTINATION PRESENT or NO AGGLUTINATION.\n- Determine ABO only from Anti-A and Anti-B well reactions; determine Rh only from Anti-D reaction.\n- If control well shows agglutination (or expected negative control fails), mark result INVALID and request manual repeat.\n- If mixed-field/weak or unclear clumping is seen, mark corresponding well as UNDETERMINED and escalate for manual review.\n- Report reaction pattern first, then mapped ABO/Rh output; do NOT add clinical interpretation.'
WHERE (
    UPPER(COALESCE(ap.ai_processing_type, '')) IN ('VISION_CARD', 'RAPID_CARD_LFA', 'AGGLUTINATION_CARD')
    OR ap.test_id IN (
      SELECT id
      FROM public.test_groups
      WHERE UPPER(COALESCE(default_ai_processing_type, '')) = 'AGGLUTINATION_CARD'
         OR UPPER(COALESCE(code, '')) IN ('ABORH', 'BLOOD_GROUPING_AND_ANTIBODY_SCREENING')
         OR name ILIKE '%blood group%'
         OR name ILIKE '%abo%rh%'
    )
  )
  AND COALESCE(ap.prompt, '') NOT ILIKE '%[Agglutination Guardrails]%';

-- --------------------------------------------------------------------------
-- Verification (optional)
-- --------------------------------------------------------------------------
-- SELECT id, name, code, default_ai_processing_type, LEFT(group_level_prompt, 280)
-- FROM public.test_groups
-- WHERE UPPER(COALESCE(code, '')) = 'URM'
--    OR name ILIKE '%urine routine%'
--    OR UPPER(COALESCE(default_ai_processing_type, '')) = 'AGGLUTINATION_CARD'
--    OR name ILIKE '%blood group%';

