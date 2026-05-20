-- Add lab-level Basic template column width defaults for existing labs.
-- Renderers read this from labs.pdf_layout_settings.printOptions.basicColumnWidths.

UPDATE public.labs
SET pdf_layout_settings =
  COALESCE(pdf_layout_settings, '{}'::jsonb)
  || jsonb_build_object(
    'printOptions',
    COALESCE(pdf_layout_settings->'printOptions', '{}'::jsonb)
    || jsonb_build_object(
      'basicColumnWidths',
      jsonb_build_object(
        'standard', jsonb_build_array(36, 24, 12, 28),
        'sibling', jsonb_build_array(30, 14, 8, 16, 16, 16)
      )
    )
  )
WHERE pdf_layout_settings #> '{printOptions,basicColumnWidths}' IS NULL;
