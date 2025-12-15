-- WhatsApp Message Templates System
-- Centralized template management for WhatsApp messages

-- Create template categories enum
CREATE TYPE whatsapp_template_category AS ENUM (
  'report_ready',
  'appointment_reminder',
  'test_results',
  'doctor_notification',
  'payment_reminder',
  'custom'
);

-- WhatsApp message templates table
CREATE TABLE IF NOT EXISTS whatsapp_message_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_id UUID NOT NULL REFERENCES labs(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  category whatsapp_template_category NOT NULL,
  message_content TEXT NOT NULL,
  requires_attachment BOOLEAN DEFAULT false,
  placeholders TEXT[] DEFAULT '{}', -- Array of placeholder names used in template
  is_active BOOLEAN DEFAULT true,
  is_default BOOLEAN DEFAULT false, -- One default per category per lab
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT unique_default_per_category_lab UNIQUE (lab_id, category, is_default) 
    DEFERRABLE INITIALLY DEFERRED
);

-- Add indexes for common queries
CREATE INDEX idx_whatsapp_templates_lab ON whatsapp_message_templates(lab_id);
CREATE INDEX idx_whatsapp_templates_category ON whatsapp_message_templates(category);
CREATE INDEX idx_whatsapp_templates_active ON whatsapp_message_templates(is_active);
CREATE INDEX idx_whatsapp_templates_default ON whatsapp_message_templates(lab_id, category, is_default) 
  WHERE is_default = true;

-- Enable RLS
ALTER TABLE whatsapp_message_templates ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Users can only see templates from their lab
CREATE POLICY "Users can view templates from their lab"
  ON whatsapp_message_templates FOR SELECT
  USING (
    lab_id IN (
      SELECT lab_id FROM users WHERE id = auth.uid()
    )
  );

CREATE POLICY "Users can create templates for their lab"
  ON whatsapp_message_templates FOR INSERT
  WITH CHECK (
    lab_id IN (
      SELECT lab_id FROM users WHERE id = auth.uid()
    )
  );

CREATE POLICY "Users can update templates from their lab"
  ON whatsapp_message_templates FOR UPDATE
  USING (
    lab_id IN (
      SELECT lab_id FROM users WHERE id = auth.uid()
    )
  );

CREATE POLICY "Users can delete templates from their lab"
  ON whatsapp_message_templates FOR DELETE
  USING (
    lab_id IN (
      SELECT lab_id FROM users WHERE id = auth.uid()
    )
  );

-- Function to ensure only one default per category per lab
CREATE OR REPLACE FUNCTION enforce_single_default_template()
RETURNS TRIGGER AS $$
BEGIN
  -- If this template is being set as default
  IF NEW.is_default = true THEN
    -- Unset any other defaults for the same category and lab
    UPDATE whatsapp_message_templates
    SET is_default = false
    WHERE lab_id = NEW.lab_id
      AND category = NEW.category
      AND id != NEW.id
      AND is_default = true;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_enforce_single_default
  BEFORE INSERT OR UPDATE ON whatsapp_message_templates
  FOR EACH ROW
  EXECUTE FUNCTION enforce_single_default_template();

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_whatsapp_template_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_whatsapp_template_timestamp
  BEFORE UPDATE ON whatsapp_message_templates
  FOR EACH ROW
  EXECUTE FUNCTION update_whatsapp_template_timestamp();

-- Seed default templates (will be inserted with actual lab_id from application)
-- These are template examples to be inserted by the app on first use
COMMENT ON TABLE whatsapp_message_templates IS 
  'Centralized WhatsApp message templates with placeholder support. Placeholders use [CapitalCase] format.';
COMMENT ON COLUMN whatsapp_message_templates.placeholders IS 
  'Array of placeholder names (e.g., PatientName, TestName) used in message_content';
COMMENT ON COLUMN whatsapp_message_templates.is_default IS 
  'Only one template per category per lab can be default. Used for auto-selection.';
