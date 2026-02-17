-- Migration: Add pdf_letterhead_mode preference to labs table
-- Date: 2026-02-16
-- Purpose: Allow labs to choose between full-page letterhead background image
--          and separate header/footer image approaches for PDF generation
-- Modes:
--   'background'     - Full A4 letterhead image as CSS background (current default)
--   'header_footer'  - Separate header & footer images sent to PDF.co natively

BEGIN;

ALTER TABLE public.labs
ADD COLUMN IF NOT EXISTS pdf_letterhead_mode TEXT NOT NULL DEFAULT 'background';

-- Add check constraint for valid values
ALTER TABLE public.labs
ADD CONSTRAINT labs_pdf_letterhead_mode_check 
CHECK (pdf_letterhead_mode IN ('background', 'header_footer'));

COMMENT ON COLUMN public.labs.pdf_letterhead_mode IS 
'PDF generation mode: background = full letterhead as CSS bg, header_footer = separate header/footer images via PDF.co native header/footer';

COMMIT;
