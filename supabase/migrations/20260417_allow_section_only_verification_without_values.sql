-- Migration: Allow section-only results to verify without analyte rows
-- Date: 2026-04-17
-- Problem:
--   The results workflow trigger blocks verification unless at least one
--   result_values row exists. That is correct for normal test groups, but
--   incorrect for section-only groups that store content in result_section_content.
--
-- Rule after this migration:
--   1. Regular groups still require result_values before verification.
--   2. Section-only groups may be verified without result_values.
--   3. Section-only groups must have actual saved section content or images.

CREATE OR REPLACE FUNCTION public.validate_result_workflow()
RETURNS TRIGGER AS $$
DECLARE
  is_admin boolean := false;
  v_is_section_only boolean := false;
  v_has_result_values boolean := false;
  v_has_section_content boolean := false;
BEGIN
  -- Prevent status regression from verified (unless admin)
  IF OLD.verification_status = 'verified' AND NEW.verification_status != 'verified' THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.users u
      WHERE u.id = auth.uid()
        AND LOWER(u.role::text) IN ('admin', 'super_admin', 'lab_admin')
    ) INTO is_admin;

    IF NOT is_admin THEN
      RAISE EXCEPTION 'Cannot revert verified results. Use amendment process if changes are needed.';
    END IF;
  END IF;

  -- Auto-update fields when result is verified
  IF NEW.verification_status = 'verified' AND OLD.verification_status != 'verified' THEN
    NEW.verified_at = NOW();
    NEW.verified_by = auth.uid();
    NEW.manually_verified = true;
    NEW.status = 'Reviewed';

    SELECT EXISTS (
      SELECT 1
      FROM public.result_values rv
      WHERE rv.result_id = NEW.id
    ) INTO v_has_result_values;

    SELECT COALESCE(direct_tg.is_section_only, otg_tg.is_section_only, false)
    INTO v_is_section_only
    FROM (SELECT 1) AS seed
    LEFT JOIN public.test_groups direct_tg
      ON direct_tg.id = NEW.test_group_id
    LEFT JOIN public.order_test_groups otg
      ON otg.id = NEW.order_test_group_id
    LEFT JOIN public.test_groups otg_tg
      ON otg_tg.id = otg.test_group_id;

    IF NOT v_has_result_values THEN
      IF NOT v_is_section_only THEN
        RAISE EXCEPTION 'Cannot verify result without values';
      END IF;

      SELECT EXISTS (
        SELECT 1
        FROM public.result_section_content rsc
        WHERE rsc.result_id = NEW.id
          AND (
            (rsc.final_content IS NOT NULL AND btrim(rsc.final_content) <> '')
            OR jsonb_array_length(COALESCE(rsc.image_urls, '[]'::jsonb)) > 0
          )
      ) INTO v_has_section_content;

      IF NOT v_has_section_content THEN
        RAISE EXCEPTION 'Cannot verify section-only result without saved section content';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.validate_result_workflow() IS
  'Validates result verification transitions. Regular groups require result_values; section-only groups may verify from saved section content.';
