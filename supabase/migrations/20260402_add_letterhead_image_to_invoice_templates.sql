-- Add letterhead background image support to invoice_templates.
-- When letterhead_image_url is set, the invoice PDF uses the image as a full-page
-- background with the table-spacer technique (same as report PDFs), instead of
-- the old pre-printed paper blank-space approach.
--
-- letterhead_space_mm  = top spacer height (mm) — already exists, repurposed as header space
-- letterhead_bottom_mm = bottom spacer height (mm) — NEW, reserves footer area
-- letterhead_image_url = full-page background image URL (ImageKit or Supabase Storage) — NEW

ALTER TABLE public.invoice_templates
  ADD COLUMN IF NOT EXISTS letterhead_image_url TEXT,
  ADD COLUMN IF NOT EXISTS letterhead_bottom_mm INTEGER NOT NULL DEFAULT 20;

COMMENT ON COLUMN public.invoice_templates.letterhead_image_url IS
  'Full-page letterhead background image URL (ImageKit or Supabase Storage). When set, PDF renders the image as a fixed background on every page using the table-spacer technique. Supports A4 (210×297mm), A5 (148×210mm), Letter (216×279mm).';

COMMENT ON COLUMN public.invoice_templates.letterhead_bottom_mm IS
  'Bottom spacing (mm) reserved for the letterhead footer area. Pairs with letterhead_space_mm (top). Default 20mm.';
