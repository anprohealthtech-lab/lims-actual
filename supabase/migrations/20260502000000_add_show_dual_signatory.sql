-- Add dual-signatory option to labs
-- When enabled: reports show a "Verified By" block (technician) on the left
-- and an "Approved By" block (lab default / verifier) on the right.

ALTER TABLE public.labs
  ADD COLUMN IF NOT EXISTS show_dual_signatory boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.labs.show_dual_signatory IS
  'When true, PDF reports display a side-by-side footer: Verified By (technician who entered the result) on the left, Approved By (lab default signatory or verifier) on the right.';
