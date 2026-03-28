-- Lab Billing Item Types: lab-defined catalog of extra charges (home visit, urgent fee, etc.)
CREATE TABLE IF NOT EXISTS public.lab_billing_item_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_id uuid NOT NULL REFERENCES labs(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  default_amount numeric NOT NULL DEFAULT 0 CHECK (default_amount >= 0),
  is_shareable_with_doctor boolean NOT NULL DEFAULT false,
  is_shareable_with_phlebotomist boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lab_billing_item_types_lab_id ON public.lab_billing_item_types(lab_id);

-- RLS
ALTER TABLE public.lab_billing_item_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lab_billing_item_types_lab_isolation" ON public.lab_billing_item_types
  USING (lab_id = (SELECT lab_id FROM users WHERE id = auth.uid() LIMIT 1));

-- Order Billing Items: charges added to a specific order (before/after invoicing)
CREATE TABLE IF NOT EXISTS public.order_billing_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_id uuid NOT NULL REFERENCES labs(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  lab_billing_item_type_id uuid REFERENCES lab_billing_item_types(id) ON DELETE SET NULL,
  name text NOT NULL,
  amount numeric NOT NULL DEFAULT 0 CHECK (amount >= 0),
  notes text,
  -- Sharing flags (inherited from type but overridable)
  is_shareable_with_doctor boolean NOT NULL DEFAULT false,
  is_shareable_with_phlebotomist boolean NOT NULL DEFAULT false,
  -- Invoice tracking
  is_invoiced boolean NOT NULL DEFAULT false,
  invoice_item_id uuid, -- filled after invoicing
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_billing_items_order_id ON public.order_billing_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_billing_items_lab_id ON public.order_billing_items(lab_id);

ALTER TABLE public.order_billing_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "order_billing_items_lab_isolation" ON public.order_billing_items
  USING (lab_id = (SELECT lab_id FROM users WHERE id = auth.uid() LIMIT 1));

-- Extend invoice_items to support lab charges
ALTER TABLE public.invoice_items
  ADD COLUMN IF NOT EXISTS item_type text NOT NULL DEFAULT 'test'
    CHECK (item_type IN ('test', 'lab_charge')),
  ADD COLUMN IF NOT EXISTS order_billing_item_id uuid REFERENCES order_billing_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_shareable_with_doctor boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_shareable_with_phlebotomist boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_invoice_items_item_type ON public.invoice_items(item_type);
CREATE INDEX IF NOT EXISTS idx_invoice_items_order_billing_item_id ON public.invoice_items(order_billing_item_id);
