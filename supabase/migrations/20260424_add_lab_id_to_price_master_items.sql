-- Add direct lab ownership to price_master_items so queries/RLS can scope rows
-- without depending only on the parent price_masters join.

BEGIN;

ALTER TABLE public.price_master_items
  ADD COLUMN IF NOT EXISTS lab_id uuid;

UPDATE public.price_master_items pmi
SET lab_id = pm.lab_id
FROM public.price_masters pm
WHERE pm.id = pmi.price_master_id
  AND (pmi.lab_id IS NULL OR pmi.lab_id <> pm.lab_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'price_master_items_lab_id_fkey'
  ) THEN
    ALTER TABLE public.price_master_items
      ADD CONSTRAINT price_master_items_lab_id_fkey
      FOREIGN KEY (lab_id) REFERENCES public.labs(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_price_master_items_lab_id
  ON public.price_master_items(lab_id);

ALTER TABLE public.price_master_items
  ALTER COLUMN lab_id SET NOT NULL;

DROP POLICY IF EXISTS "Lab users can manage price master items" ON public.price_master_items;

CREATE POLICY "Lab users can manage price master items"
  ON public.price_master_items FOR ALL
  USING (lab_id = (SELECT lab_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (lab_id = (SELECT lab_id FROM public.users WHERE id = auth.uid()));

COMMIT;
