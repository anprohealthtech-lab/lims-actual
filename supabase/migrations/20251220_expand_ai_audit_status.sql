-- Expand result_values_ai_audit_status_check constraint to include 'approved' and 'rejected'
-- Current values: 'none', 'pending', 'confirmed', 'overridden', 'needs_review'
-- New values: 'none', 'pending', 'confirmed', 'overridden', 'needs_review', 'approved', 'rejected'

DO $$
BEGIN
    -- Drop the existing constraint
    ALTER TABLE public.result_values 
    DROP CONSTRAINT IF EXISTS result_values_ai_audit_status_check;

    -- Add the new constraint with expanded values
    ALTER TABLE public.result_values 
    ADD CONSTRAINT result_values_ai_audit_status_check 
    CHECK (ai_audit_status = ANY (ARRAY[
        'none'::text, 
        'pending'::text, 
        'confirmed'::text, 
        'overridden'::text, 
        'needs_review'::text,
        'approved'::text,
        'rejected'::text
    ]));
END $$;
