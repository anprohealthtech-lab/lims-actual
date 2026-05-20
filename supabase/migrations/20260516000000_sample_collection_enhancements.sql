-- Sample collection enhancements:
--   1. labs.auto_open_collection_modal  – auto-open collect modal after order creation
--   2. test_groups.collection_checklist – per-test checklist items (jsonb array of strings)
--   3. samples.checklist_completed      – which checklist items were ticked at collection time

ALTER TABLE public.labs
  ADD COLUMN IF NOT EXISTS auto_open_collection_modal boolean NOT NULL DEFAULT false;

ALTER TABLE public.test_groups
  ADD COLUMN IF NOT EXISTS collection_checklist jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.samples
  ADD COLUMN IF NOT EXISTS checklist_completed jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.labs.auto_open_collection_modal
  IS 'When true, the sample collection modal opens automatically after every new order is created.';

COMMENT ON COLUMN public.test_groups.collection_checklist
  IS 'Array of checklist item strings shown to the collector before marking sample as collected, e.g. ["Patient fasted 8h?","Consent signed?"]';

COMMENT ON COLUMN public.samples.checklist_completed
  IS 'Map of checklist item label -> boolean recorded at the time of sample collection.';
