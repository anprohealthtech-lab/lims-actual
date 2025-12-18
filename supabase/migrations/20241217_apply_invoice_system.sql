-- Create bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('invoices', 'invoices', true)
ON CONFLICT (id) DO NOTHING;

-- Note: storage.objects already has RLS enabled by default in Supabase

-- Public read access for invoices
DROP POLICY IF EXISTS "Public read access for invoices" ON storage.objects;
CREATE POLICY "Public read access for invoices"
ON storage.objects
FOR SELECT
USING (bucket_id = 'invoices');

-- Authenticated users can upload invoices
DROP POLICY IF EXISTS "Authenticated users can upload invoices" ON storage.objects;
CREATE POLICY "Authenticated users can upload invoices"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'invoices');

-- Authenticated users can update invoices
DROP POLICY IF EXISTS "Authenticated users can update invoices" ON storage.objects;
CREATE POLICY "Authenticated users can update invoices"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'invoices');

-- Authenticated users can delete their lab invoices
DROP POLICY IF EXISTS "Authenticated users can delete their lab invoices" ON storage.objects;
CREATE POLICY "Authenticated users can delete their lab invoices"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'invoices'
  AND (storage.foldername(name))[1] IN (
    SELECT lab_id::text
    FROM users
    WHERE id = auth.uid()
  )
);
