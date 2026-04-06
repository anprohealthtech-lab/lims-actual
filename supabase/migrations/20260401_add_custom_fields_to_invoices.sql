-- Add custom_fields JSONB column to invoices table.
-- Stores arbitrary key-value pairs set per invoice (e.g. {"po_number": "PO-1234", "dept": "Radiology"}).
-- These are surfaced in PDF templates via {{custom.field_key}} tokens.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS custom_fields jsonb DEFAULT '{}';
