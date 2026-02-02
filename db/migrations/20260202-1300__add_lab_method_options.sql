-- Add lab-level method options for analytes

ALTER TABLE public.labs
ADD COLUMN IF NOT EXISTS method_options jsonb DEFAULT '["Manual","Automated","Semi-Automated","Spectrophotometry","Flow Cytometry","Immunoassay","ELISA","Chemiluminescence","PCR","Microscopy","Culture","Electrophoresis","Chromatography","Mass Spectrometry"]'::jsonb;

COMMENT ON COLUMN public.labs.method_options IS 'Lab-specific list of allowed analyte testing methods';
