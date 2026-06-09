-- Allow bulk ZIP and merged PDF downloads to be stored in the reports bucket.
-- The previous implicit/default bucket limit can reject corporate bulk downloads
-- with "The object exceeded the maximum allowed size".
UPDATE storage.buckets
SET file_size_limit = 524288000
WHERE id = 'reports'
  AND (file_size_limit IS NULL OR file_size_limit < 524288000);
