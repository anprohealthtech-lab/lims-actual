-- Drop the setup_new_lab_templates trigger chain.
-- This function was copying test groups from to_be_copied=TRUE templates into new labs,
-- but the template analytes degraded over time (deprecation migrations Mar 2026),
-- causing new labs to receive Iron Profile and other groups with 0-1 analytes.
-- New labs are now onboarded via the onboarding-lab edge function instead.

DROP TRIGGER IF EXISTS auto_setup_templates_on_new_lab ON public.labs;
DROP FUNCTION IF EXISTS public.auto_setup_new_lab();
DROP FUNCTION IF EXISTS public.setup_new_lab_templates(uuid);

-- Remove test groups with 0 analytes that have no orders or results (safe to delete)
DELETE FROM public.test_groups tg
WHERE tg.analyte_count = 0
  AND NOT EXISTS (
    SELECT 1 FROM public.order_test_groups otg WHERE otg.test_group_id = tg.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.order_tests ot WHERE ot.test_group_id = tg.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.results r WHERE r.test_group_id = tg.id
  );

-- Retire the to_be_copied / is_global template mechanism on all test groups and analytes
UPDATE public.test_groups SET to_be_copied = FALSE WHERE to_be_copied = TRUE;
UPDATE public.analytes SET is_global = FALSE, to_be_copied = FALSE
WHERE is_global = TRUE OR to_be_copied = TRUE;
