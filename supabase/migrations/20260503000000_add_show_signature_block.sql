-- Add show_signature_block column to labs table
ALTER TABLE public.labs
  ADD COLUMN IF NOT EXISTS show_signature_block boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.labs.show_signature_block IS
  'When true, PDF reports display the signature block in the footer (signatory name, designation, and signature image).';
