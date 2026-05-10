-- Enable and align RLS for analyte_dependencies so lab-scoped calculated
-- parameter dependencies can be saved from the authenticated client.

ALTER TABLE public.analyte_dependencies ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'analyte_dependencies'
      AND policyname = 'Authenticated users can read analyte dependencies'
  ) THEN
    CREATE POLICY "Authenticated users can read analyte dependencies"
    ON public.analyte_dependencies
    FOR SELECT
    TO authenticated
    USING (
      lab_id IS NULL OR lab_id = get_my_lab_id()
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'analyte_dependencies'
      AND policyname = 'Lab managers can insert analyte dependencies'
  ) THEN
    CREATE POLICY "Lab managers can insert analyte dependencies"
    ON public.analyte_dependencies
    FOR INSERT
    TO authenticated
    WITH CHECK (
      lab_id = get_my_lab_id()
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'analyte_dependencies'
      AND policyname = 'Lab managers can update analyte dependencies'
  ) THEN
    CREATE POLICY "Lab managers can update analyte dependencies"
    ON public.analyte_dependencies
    FOR UPDATE
    TO authenticated
    USING (
      lab_id = get_my_lab_id()
    )
    WITH CHECK (
      lab_id = get_my_lab_id()
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'analyte_dependencies'
      AND policyname = 'Lab managers can delete analyte dependencies'
  ) THEN
    CREATE POLICY "Lab managers can delete analyte dependencies"
    ON public.analyte_dependencies
    FOR DELETE
    TO authenticated
    USING (
      lab_id = get_my_lab_id()
    );
  END IF;
END
$$;
