-- ============================================================================
-- AI Prompt Guardrails: Card + Color-Based Workflows
-- Migration: 20260207_ai_prompt_card_color_guardrails.sql
--
-- Scope:
-- 1) test_groups.group_level_prompt (runtime prompt source)
-- 2) global_test_catalog.group_level_prompt (future onboarding seed source)
--
-- Update only records missing required guardrail content.
-- ============================================================================

-- --------------------------------------------------------------------------
-- RAPID CARD / LFA prompts
-- Ensure explicit C/T line decision logic (positive/negative/invalid)
-- --------------------------------------------------------------------------

UPDATE public.test_groups
SET group_level_prompt =
  TRIM(COALESCE(group_level_prompt, '')) || E'\n\n[Card Interpretation Guardrails]\n- Image is pre-rotated upright; evaluate the card in standard orientation.\n- Locate and verify Control line (C) first.\n- If C line is absent, result is INVALID regardless of test lines.\n- If C line is present and any Test line (T/T1/T2/T3) is visible (even faint), mark POSITIVE for that target.\n- If C line is present and all test lines are absent, mark NEGATIVE.\n- Use only line visibility; do NOT infer clinical diagnosis.\n- If line region is blurred/occluded, return UNDETERMINED and request manual review.'
WHERE UPPER(COALESCE(default_ai_processing_type, '')) IN ('RAPID_CARD_LFA', 'VISION_CARD')
  AND (
    group_level_prompt IS NULL
    OR group_level_prompt NOT ILIKE '%control%'
    OR group_level_prompt NOT ILIKE '%test%'
    OR group_level_prompt NOT ILIKE '%invalid%'
    OR group_level_prompt NOT ILIKE '%positive%'
  )
  AND COALESCE(group_level_prompt, '') NOT ILIKE '%[Card Interpretation Guardrails]%';

UPDATE public.global_test_catalog
SET group_level_prompt =
  TRIM(COALESCE(group_level_prompt, '')) || E'\n\n[Card Interpretation Guardrails]\n- Image is pre-rotated upright; evaluate the card in standard orientation.\n- Locate and verify Control line (C) first.\n- If C line is absent, result is INVALID regardless of test lines.\n- If C line is present and any Test line (T/T1/T2/T3) is visible (even faint), mark POSITIVE for that target.\n- If C line is present and all test lines are absent, mark NEGATIVE.\n- Use only line visibility; do NOT infer clinical diagnosis.\n- If line region is blurred/occluded, return UNDETERMINED and request manual review.'
WHERE UPPER(COALESCE(default_ai_processing_type, '')) IN ('RAPID_CARD_LFA', 'VISION_CARD')
  AND (
    group_level_prompt IS NULL
    OR group_level_prompt NOT ILIKE '%control%'
    OR group_level_prompt NOT ILIKE '%test%'
    OR group_level_prompt NOT ILIKE '%invalid%'
    OR group_level_prompt NOT ILIKE '%positive%'
  )
  AND COALESCE(group_level_prompt, '') NOT ILIKE '%[Card Interpretation Guardrails]%';

-- --------------------------------------------------------------------------
-- COLOR-CHANGE workflows (urine strips, multi-pad strips, colorimetric wells)
-- Ensure top-to-bottom scan order and color-change interpretation guardrails
-- --------------------------------------------------------------------------

UPDATE public.test_groups
SET group_level_prompt =
  TRIM(COALESCE(group_level_prompt, '')) || E'\n\n[Color Interpretation Guardrails]\n- Image is pre-rotated upright; start reading from TOP section and proceed downward pad-by-pad.\n- Confirm full strip/card/well area is visible before interpretation.\n- Compare each pad/well color against expected baseline (no-reaction) and target reaction shades.\n- Do not skip faint or partial color transitions; classify as low/trace where applicable.\n- If glare, shadow, over-saturation, or wet pooling obscures pads, return UNDETERMINED for affected analytes.\n- Do NOT infer diagnosis; only map observed color states to analyte outputs using provided analyte context.'
WHERE UPPER(COALESCE(default_ai_processing_type, '')) IN (
    'COLOR_STRIP_MULTIPARAM',
    'SINGLE_WELL_COLORIMETRIC',
    'MULTI_COMPONENT_URINALYSIS',
    'VISION_COLOR'
  )
  AND (
    group_level_prompt IS NULL
    OR group_level_prompt NOT ILIKE '%upright%'
    OR group_level_prompt NOT ILIKE '%top%'
    OR group_level_prompt NOT ILIKE '%color%'
    OR group_level_prompt NOT ILIKE '%undetermined%'
  )
  AND COALESCE(group_level_prompt, '') NOT ILIKE '%[Color Interpretation Guardrails]%';

UPDATE public.global_test_catalog
SET group_level_prompt =
  TRIM(COALESCE(group_level_prompt, '')) || E'\n\n[Color Interpretation Guardrails]\n- Image is pre-rotated upright; start reading from TOP section and proceed downward pad-by-pad.\n- Confirm full strip/card/well area is visible before interpretation.\n- Compare each pad/well color against expected baseline (no-reaction) and target reaction shades.\n- Do not skip faint or partial color transitions; classify as low/trace where applicable.\n- If glare, shadow, over-saturation, or wet pooling obscures pads, return UNDETERMINED for affected analytes.\n- Do NOT infer diagnosis; only map observed color states to analyte outputs using provided analyte context.'
WHERE UPPER(COALESCE(default_ai_processing_type, '')) IN (
    'COLOR_STRIP_MULTIPARAM',
    'SINGLE_WELL_COLORIMETRIC',
    'MULTI_COMPONENT_URINALYSIS',
    'VISION_COLOR'
  )
  AND (
    group_level_prompt IS NULL
    OR group_level_prompt NOT ILIKE '%upright%'
    OR group_level_prompt NOT ILIKE '%top%'
    OR group_level_prompt NOT ILIKE '%color%'
    OR group_level_prompt NOT ILIKE '%undetermined%'
  )
  AND COALESCE(group_level_prompt, '') NOT ILIKE '%[Color Interpretation Guardrails]%';

-- --------------------------------------------------------------------------
-- Verification queries (optional)
-- --------------------------------------------------------------------------
-- SELECT id, name, default_ai_processing_type, LEFT(group_level_prompt, 240)
-- FROM public.test_groups
-- WHERE UPPER(COALESCE(default_ai_processing_type, '')) IN ('RAPID_CARD_LFA','VISION_CARD','COLOR_STRIP_MULTIPARAM','SINGLE_WELL_COLORIMETRIC','MULTI_COMPONENT_URINALYSIS','VISION_COLOR')
-- ORDER BY updated_at DESC NULLS LAST;

