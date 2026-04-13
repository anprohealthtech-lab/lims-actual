-- Analyzer interface config at lab_analyte level
-- Adds dilution_factor, dilution_mode, and per-connection FK to lab_analyte_interface_config
-- This allows each lab to configure per-analyte instrument behaviour independently

DO $$
BEGIN
  -- analyzer_connection_id: which specific machine this config applies to
  -- NULL means applies to all connections for this lab_analyte
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'lab_analyte_interface_config'
      AND column_name  = 'analyzer_connection_id'
  ) THEN
    ALTER TABLE public.lab_analyte_interface_config
      ADD COLUMN analyzer_connection_id UUID
        REFERENCES public.analyzer_connections(id) ON DELETE SET NULL;
  END IF;

  -- dilution_factor: 1 = neat (no dilution), 2 = 1:2, 5 = 1:5 etc.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'lab_analyte_interface_config'
      AND column_name  = 'dilution_factor'
  ) THEN
    ALTER TABLE public.lab_analyte_interface_config
      ADD COLUMN dilution_factor NUMERIC NOT NULL DEFAULT 1
        CHECK (dilution_factor >= 1);
  END IF;

  -- dilution_mode: 'auto' = analyzer applies dilution itself, 'manual' = tech dilutes before loading
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'lab_analyte_interface_config'
      AND column_name  = 'dilution_mode'
  ) THEN
    ALTER TABLE public.lab_analyte_interface_config
      ADD COLUMN dilution_mode TEXT NOT NULL DEFAULT 'auto'
        CHECK (dilution_mode IN ('auto', 'manual'));
  END IF;
END $$;

COMMENT ON COLUMN public.lab_analyte_interface_config.analyzer_connection_id IS
  'Which analyzer this config row applies to. NULL = applies to all connections for this lab_analyte.';
COMMENT ON COLUMN public.lab_analyte_interface_config.dilution_factor IS
  'Pre-analytical dilution factor sent to analyzer. 1 = neat, 2 = 1:2, 5 = 1:5, etc.';
COMMENT ON COLUMN public.lab_analyte_interface_config.dilution_mode IS
  'auto = analyzer applies dilution; manual = technician dilutes sample before loading.';

-- Index for fast lookup by lab_analyte + connection
CREATE INDEX IF NOT EXISTS idx_laic_lab_analyte_connection
  ON public.lab_analyte_interface_config(lab_analyte_id, analyzer_connection_id);
