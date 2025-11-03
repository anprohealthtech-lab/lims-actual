DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'labs'
          AND column_name = 'default_report_header_html'
    ) THEN
        ALTER TABLE public.labs
            ADD COLUMN default_report_header_html text;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'labs'
          AND column_name = 'default_report_footer_html'
    ) THEN
        ALTER TABLE public.labs
            ADD COLUMN default_report_footer_html text;
    END IF;
END $$;
