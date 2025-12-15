-- Migration: Add delivery tracking fields to reports table
-- Purpose: Track WhatsApp sends, email sends, and doctor notifications with timestamps and recipients
-- Date: 2025-12-11

-- Add delivery tracking columns to reports table
ALTER TABLE reports
ADD COLUMN IF NOT EXISTS whatsapp_sent_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS whatsapp_sent_to TEXT,
ADD COLUMN IF NOT EXISTS whatsapp_sent_by UUID REFERENCES users(id),
ADD COLUMN IF NOT EXISTS whatsapp_caption TEXT,
ADD COLUMN IF NOT EXISTS email_sent_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS email_sent_to TEXT,
ADD COLUMN IF NOT EXISTS email_sent_by UUID REFERENCES users(id),
ADD COLUMN IF NOT EXISTS doctor_informed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS doctor_informed_via TEXT CHECK (doctor_informed_via IN ('whatsapp', 'email', 'both')),
ADD COLUMN IF NOT EXISTS doctor_informed_by UUID REFERENCES users(id),
ADD COLUMN IF NOT EXISTS clinical_summary_included BOOLEAN DEFAULT false;

-- Add comments for documentation
COMMENT ON COLUMN reports.whatsapp_sent_at IS 'Timestamp when report was sent via WhatsApp';
COMMENT ON COLUMN reports.whatsapp_sent_to IS 'Recipient phone number for WhatsApp send';
COMMENT ON COLUMN reports.whatsapp_sent_by IS 'User ID who sent the WhatsApp message';
COMMENT ON COLUMN reports.whatsapp_caption IS 'Message/caption sent with the PDF via WhatsApp';
COMMENT ON COLUMN reports.email_sent_at IS 'Timestamp when report was sent via email';
COMMENT ON COLUMN reports.email_sent_to IS 'Recipient email address';
COMMENT ON COLUMN reports.email_sent_by IS 'User ID who sent the email';
COMMENT ON COLUMN reports.doctor_informed_at IS 'Timestamp when doctor was notified about report';
COMMENT ON COLUMN reports.doctor_informed_via IS 'Method used to inform doctor: whatsapp, email, or both';
COMMENT ON COLUMN reports.doctor_informed_by IS 'User ID who sent the doctor notification';
COMMENT ON COLUMN reports.clinical_summary_included IS 'Whether clinical summary was included in the sent report';

-- Create index for faster queries on sent status
CREATE INDEX IF NOT EXISTS idx_reports_whatsapp_sent_at ON reports(whatsapp_sent_at) WHERE whatsapp_sent_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reports_email_sent_at ON reports(email_sent_at) WHERE email_sent_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reports_doctor_informed_at ON reports(doctor_informed_at) WHERE doctor_informed_at IS NOT NULL;
