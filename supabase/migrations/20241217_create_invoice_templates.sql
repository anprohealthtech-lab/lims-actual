-- Create invoice_templates table for CKEditor invoice templates
-- Each lab can have 4-5 customized invoice templates with one default

CREATE TABLE IF NOT EXISTS public.invoice_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_id UUID NOT NULL REFERENCES public.labs(id) ON DELETE CASCADE,
  
  -- Template Identification
  template_name VARCHAR(255) NOT NULL,
  template_description TEXT,
  
  -- CKEditor/GrapesJS Content (same pattern as lab_templates)
  gjs_html TEXT,
  gjs_css TEXT,
  gjs_components JSONB,
  gjs_styles JSONB,
  gjs_project JSONB,
  
  -- Template Metadata
  category VARCHAR(50) DEFAULT 'standard', -- 'standard', 'b2b', 'minimal', 'detailed'
  is_active BOOLEAN DEFAULT true,
  is_default BOOLEAN DEFAULT false,
  
  -- Invoice-Specific Configuration
  include_payment_terms BOOLEAN DEFAULT true,
  payment_terms_text TEXT DEFAULT 'Payment due within 15 days',
  include_tax_breakdown BOOLEAN DEFAULT true,
  tax_disclaimer TEXT,
  include_bank_details BOOLEAN DEFAULT false,
  bank_details JSONB, -- { account_name, account_number, ifsc, bank_name, upi_id }
  
  -- Audit Fields
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES public.users(id),
  updated_by UUID REFERENCES public.users(id)
);

-- Conditional unique constraint (only enforced when is_default = true)
-- This allows multiple templates per lab but only ONE default template
CREATE UNIQUE INDEX idx_invoice_templates_default 
  ON public.invoice_templates(lab_id) 
  WHERE is_default = true;

-- Performance Indexes
CREATE INDEX idx_invoice_templates_lab_id ON public.invoice_templates(lab_id);
CREATE INDEX idx_invoice_templates_active ON public.invoice_templates(lab_id, is_active) 
  WHERE is_active = true;

-- Row-Level Security (RLS) for multi-lab isolation
ALTER TABLE public.invoice_templates ENABLE ROW LEVEL SECURITY;

-- Users can only see templates from their own lab
CREATE POLICY invoice_templates_select_policy ON public.invoice_templates
  FOR SELECT 
  USING (lab_id = (SELECT lab_id FROM public.users WHERE id = auth.uid()));

-- Users can insert templates for their own lab
CREATE POLICY invoice_templates_insert_policy ON public.invoice_templates
  FOR INSERT 
  WITH CHECK (lab_id = (SELECT lab_id FROM public.users WHERE id = auth.uid()));

-- Users can update templates from their own lab
CREATE POLICY invoice_templates_update_policy ON public.invoice_templates
  FOR UPDATE 
  USING (lab_id = (SELECT lab_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (lab_id = (SELECT lab_id FROM public.users WHERE id = auth.uid()));

-- Users can delete templates from their own lab
CREATE POLICY invoice_templates_delete_policy ON public.invoice_templates
  FOR DELETE 
  USING (lab_id = (SELECT lab_id FROM public.users WHERE id = auth.uid()));

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_invoice_templates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER invoice_templates_updated_at_trigger
  BEFORE UPDATE ON public.invoice_templates
  FOR EACH ROW
  EXECUTE FUNCTION update_invoice_templates_updated_at();

-- Comment on table
COMMENT ON TABLE public.invoice_templates IS 'Invoice templates for PDF generation. Each lab can have multiple templates with CKEditor/GrapesJS content.';
COMMENT ON COLUMN public.invoice_templates.bank_details IS 'JSONB containing { account_name, account_number, ifsc, bank_name, upi_id }';
COMMENT ON COLUMN public.invoice_templates.is_default IS 'Only one template per lab can be default. Used for auto-generation.';

-- Extend invoices table with PDF and template tracking
ALTER TABLE public.invoices 
  ADD COLUMN IF NOT EXISTS pdf_url TEXT,
  ADD COLUMN IF NOT EXISTS pdf_generated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS template_id UUID REFERENCES public.invoice_templates(id),
  ADD COLUMN IF NOT EXISTS invoice_number VARCHAR(50);

-- Index for PDF tracking
CREATE INDEX IF NOT EXISTS idx_invoices_pdf_url 
  ON public.invoices(pdf_url) 
  WHERE pdf_url IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_template_id 
  ON public.invoices(template_id);

-- Unique index for invoice numbers (per lab)
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_number_unique 
  ON public.invoices(lab_id, invoice_number) 
  WHERE invoice_number IS NOT NULL;

-- Comments on new columns
COMMENT ON COLUMN public.invoices.pdf_url IS 'Supabase Storage URL for generated PDF in invoices bucket';
COMMENT ON COLUMN public.invoices.pdf_generated_at IS 'Timestamp when PDF was last generated';
COMMENT ON COLUMN public.invoices.template_id IS 'Reference to invoice_template used for PDF generation';
COMMENT ON COLUMN public.invoices.invoice_number IS 'Human-readable invoice number (e.g., INV-2024-0001, INV-2024-0001-P1 for partials)';

-- Function to validate only one default template per lab
CREATE OR REPLACE FUNCTION validate_default_invoice_template()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_default = true THEN
    -- Unset any other default templates for this lab
    UPDATE public.invoice_templates 
    SET is_default = false 
    WHERE lab_id = NEW.lab_id 
      AND id != NEW.id 
      AND is_default = true;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ensure_single_default_invoice_template
  BEFORE INSERT OR UPDATE ON public.invoice_templates
  FOR EACH ROW
  WHEN (NEW.is_default = true)
  EXECUTE FUNCTION validate_default_invoice_template();
