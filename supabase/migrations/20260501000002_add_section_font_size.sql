-- Add font_size column to lab_template_sections
-- Existing sections get DEFAULT 13 (matches current hardcoded render size)
-- New sections default to 13 in DB; UI defaults the form to 15 for new sections

ALTER TABLE public.lab_template_sections
ADD COLUMN IF NOT EXISTS font_size INTEGER NOT NULL DEFAULT 13;

COMMENT ON COLUMN public.lab_template_sections.font_size IS
  'Font size in px used when rendering this section in PDF reports. Defaults to 13. New sections created via UI default to 15.';
