-- Link lab test groups back to the global catalog row they were derived from.
ALTER TABLE public.test_groups
ADD COLUMN IF NOT EXISTS global_test_catalog_id uuid NULL
REFERENCES public.global_test_catalog(id)
ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_test_groups_global_test_catalog_id
ON public.test_groups(global_test_catalog_id);

COMMENT ON COLUMN public.test_groups.global_test_catalog_id IS
'Source row in global_test_catalog for onboarded or catalog-derived test groups.';

-- Backfill existing rows where the lab test group code matches a global catalog code.
UPDATE public.test_groups tg
SET global_test_catalog_id = gtc.id
FROM public.global_test_catalog gtc
WHERE tg.global_test_catalog_id IS NULL
  AND tg.code = gtc.code;
