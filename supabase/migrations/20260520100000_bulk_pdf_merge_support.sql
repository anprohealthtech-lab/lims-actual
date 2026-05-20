-- Add download_type column to support merged PDF downloads
ALTER TABLE public.bulk_pdf_download_requests
  ADD COLUMN IF NOT EXISTS download_type text NOT NULL DEFAULT 'zip'
  CHECK (download_type IN ('zip', 'merged'));

COMMENT ON COLUMN public.bulk_pdf_download_requests.download_type IS
  'Type of download: zip = multiple PDFs in ZIP archive, merged = all PDFs merged into single file';
