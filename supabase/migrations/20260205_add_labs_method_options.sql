-- ============================================================================
-- Add method_options to labs table
-- Migration: 20260205_add_labs_method_options.sql
-- ============================================================================
-- This column stores the available methodology options for a lab.
-- These options are shared across test groups and analytes within the lab.
-- ============================================================================

ALTER TABLE public.labs
  ADD COLUMN IF NOT EXISTS method_options jsonb
  DEFAULT '["Manual", "Automated", "Semi-Automated", "Spectrophotometry", "Flow Cytometry", "Immunoassay", "ELISA", "CLIA", "ECLIA", "Chemiluminescence", "PCR", "RT-PCR", "Microscopy", "Culture", "Electrophoresis", "Chromatography", "HPLC", "Mass Spectrometry", "ISE", "Photometry", "Turbidimetry", "Nephelometry", "Agglutination", "Coagulometry", "Impedance"]'::jsonb;

COMMENT ON COLUMN public.labs.method_options IS
  'Array of methodology/technique options available for this lab (e.g., ELISA, CLIA, PCR). Labs can add custom methods.';
