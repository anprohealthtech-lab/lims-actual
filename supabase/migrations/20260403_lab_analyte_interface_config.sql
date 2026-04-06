-- Lab-level per-analyte interface configuration.
-- Controls unit conversion (multiply_by, add_offset) and auto-verification
-- for results coming in from the instrument interface.
-- Keyed on lab_analyte_id (lab_analytes is the source of truth for this lab).

CREATE TABLE IF NOT EXISTS public.lab_analyte_interface_config (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_id          UUID        NOT NULL REFERENCES public.labs(id) ON DELETE CASCADE,
  lab_analyte_id  UUID        NOT NULL REFERENCES public.lab_analytes(id) ON DELETE CASCADE,
  instrument_unit TEXT,       -- unit the instrument sends (e.g. "g/dL")
  lims_unit       TEXT,       -- unit LIMS stores/displays (e.g. "g/L")
  multiply_by     NUMERIC     NOT NULL DEFAULT 1.0,
  add_offset      NUMERIC     NOT NULL DEFAULT 0,
  auto_verify     BOOLEAN     NOT NULL DEFAULT false,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_lab_analyte_interface UNIQUE (lab_id, lab_analyte_id)
);

CREATE INDEX IF NOT EXISTS idx_laic_lab_analyte
  ON public.lab_analyte_interface_config (lab_id, lab_analyte_id);

-- RLS
ALTER TABLE public.lab_analyte_interface_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Lab members can manage their interface config"
  ON public.lab_analyte_interface_config
  FOR ALL
  USING (
    lab_id IN (
      SELECT lab_id FROM public.users WHERE id = auth.uid()
    )
  );

COMMENT ON TABLE public.lab_analyte_interface_config IS
  'Per-analyte instrument interface settings: unit conversion (multiply_by, add_offset) and auto-verify threshold.';
COMMENT ON COLUMN public.lab_analyte_interface_config.multiply_by IS
  'Multiplier applied to raw instrument value before storing. e.g. 10 if instrument sends g/dL and LIMS needs g/L.';
COMMENT ON COLUMN public.lab_analyte_interface_config.add_offset IS
  'Offset added after multiplication. Rarely needed but supported.';
COMMENT ON COLUMN public.lab_analyte_interface_config.auto_verify IS
  'If true, result_values for this analyte are auto-approved on insert when extracted_by_ai = true.';
