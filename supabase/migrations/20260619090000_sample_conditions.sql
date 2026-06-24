-- Add per-test-group sample condition configuration and per-order selection.
-- Examples: Morning Sample, Fasting Sample, Random Sample.

ALTER TABLE public.test_groups
  ADD COLUMN IF NOT EXISTS sample_condition_options jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS default_sample_condition text;

ALTER TABLE public.order_test_groups
  ADD COLUMN IF NOT EXISTS sample_condition text;

ALTER TABLE public.samples
  ADD COLUMN IF NOT EXISTS sample_condition text;

COMMENT ON COLUMN public.test_groups.sample_condition_options IS
'Per-test-group collection/sample condition choices shown during sample collection, e.g. ["Morning Sample","Fasting Sample","Random Sample"].';

COMMENT ON COLUMN public.test_groups.default_sample_condition IS
'Optional default sample condition selected for new order test groups and sample collection.';

COMMENT ON COLUMN public.order_test_groups.sample_condition IS
'Condition selected for this test group on this order. Stored historically for report headings.';

COMMENT ON COLUMN public.samples.sample_condition IS
'Optional sample-level condition snapshot when all linked test groups share the same selected condition.';

CREATE INDEX IF NOT EXISTS idx_order_test_groups_sample_condition
ON public.order_test_groups(order_id, test_group_id, sample_condition)
WHERE sample_condition IS NOT NULL;

CREATE OR REPLACE FUNCTION public.set_default_order_test_group_sample_condition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NULLIF(btrim(COALESCE(NEW.sample_condition, '')), '') IS NULL THEN
    SELECT NULLIF(btrim(default_sample_condition), '')
    INTO NEW.sample_condition
    FROM public.test_groups
    WHERE id = NEW.test_group_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_default_order_test_group_sample_condition ON public.order_test_groups;
CREATE TRIGGER trg_set_default_order_test_group_sample_condition
BEFORE INSERT OR UPDATE OF test_group_id, sample_condition ON public.order_test_groups
FOR EACH ROW
EXECUTE FUNCTION public.set_default_order_test_group_sample_condition();
