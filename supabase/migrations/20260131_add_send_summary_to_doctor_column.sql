-- ============================================================================
-- Add send_clinical_summary_to_doctor column to orders table
-- This separates the "include in PDF" flag from "send to doctor via WhatsApp" flag
-- ============================================================================

-- Add the new column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'orders' 
        AND column_name = 'send_clinical_summary_to_doctor'
    ) THEN
        ALTER TABLE public.orders 
        ADD COLUMN send_clinical_summary_to_doctor BOOLEAN DEFAULT false;
        
        COMMENT ON COLUMN public.orders.send_clinical_summary_to_doctor IS 
            'Flag to include clinical summary in WhatsApp message to doctor. Separate from include_clinical_summary_in_report which controls PDF inclusion.';
    END IF;
END $$;

-- Create index for efficient filtering
CREATE INDEX IF NOT EXISTS idx_orders_send_summary_to_doctor 
    ON public.orders(send_clinical_summary_to_doctor) 
    WHERE send_clinical_summary_to_doctor = true;
