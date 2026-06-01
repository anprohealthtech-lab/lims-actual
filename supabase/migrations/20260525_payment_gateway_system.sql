-- Payment Gateway System for B2B Credit Payments
-- Supports CCAvenue, Razorpay, and future payment providers
-- Date: 2026-05-25

-- ============================================
-- 1. LAB PAYMENT GATEWAYS TABLE
-- Stores payment gateway credentials per lab (multi-gateway support)
-- ============================================

CREATE TABLE IF NOT EXISTS public.lab_payment_gateways (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_id uuid NOT NULL REFERENCES public.labs(id) ON DELETE CASCADE,

  -- Provider identification
  provider text NOT NULL CHECK (provider IN ('ccavenue', 'razorpay', 'paytm', 'phonepe', 'stripe', 'paypal')),
  display_name text,  -- "CCAvenue (Primary)", "Razorpay (Backup)"

  -- Credentials stored as encrypted JSON (provider-specific)
  -- CCAvenue: { merchant_id, access_code, working_key, callback_access_code, callback_working_key, webhook_access_code, webhook_working_key }
  -- Razorpay: { key_id, key_secret }
  credentials_encrypted jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Environment settings
  environment text NOT NULL DEFAULT 'test' CHECK (environment IN ('test', 'production')),

  -- URLs for redirects
  redirect_url text,
  cancel_url text,
  webhook_url text,
  webhook_secret text,

  -- Gateway configuration
  supported_methods jsonb DEFAULT '["card", "netbanking", "upi", "wallet"]'::jsonb,
  default_currency text DEFAULT 'INR',

  -- Status
  is_active boolean DEFAULT true,
  is_default boolean DEFAULT false,  -- Default gateway for this lab

  -- Audit
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES public.users(id),
  updated_by uuid REFERENCES public.users(id)
);

-- Ensure only one default gateway per lab
CREATE UNIQUE INDEX idx_lab_payment_gateways_default
  ON public.lab_payment_gateways(lab_id)
  WHERE is_default = true;

-- Index for quick lookups
CREATE INDEX idx_lab_payment_gateways_lab_provider
  ON public.lab_payment_gateways(lab_id, provider);

CREATE INDEX idx_lab_payment_gateways_active
  ON public.lab_payment_gateways(lab_id)
  WHERE is_active = true;

-- ============================================
-- 2. MODIFY ACCOUNTS TABLE
-- Add credit tracking columns
-- ============================================

-- Add credit_used column if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'accounts'
    AND column_name = 'credit_used'
  ) THEN
    ALTER TABLE public.accounts
    ADD COLUMN credit_used numeric(12,2) NOT NULL DEFAULT 0
    CHECK (credit_used >= 0);
  END IF;
END $$;

-- Add credit_balance column (computed available credit)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'accounts'
    AND column_name = 'credit_balance'
  ) THEN
    ALTER TABLE public.accounts
    ADD COLUMN credit_balance numeric(12,2) GENERATED ALWAYS AS (credit_limit - credit_used) STORED;
  END IF;
END $$;

-- Add payment_gateway_enabled flag
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'accounts'
    AND column_name = 'payment_gateway_enabled'
  ) THEN
    ALTER TABLE public.accounts
    ADD COLUMN payment_gateway_enabled boolean NOT NULL DEFAULT false;
  END IF;
END $$;

-- ============================================
-- 3. B2B PAYMENT ATTEMPTS TABLE
-- Track all payment attempts with any gateway
-- ============================================

CREATE TABLE IF NOT EXISTS public.b2b_payment_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_id uuid NOT NULL REFERENCES public.labs(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,

  -- Link to pending order (if payment is for specific order)
  pending_order_id uuid REFERENCES public.orders(id),

  -- Gateway info
  gateway_id uuid REFERENCES public.lab_payment_gateways(id),
  provider text NOT NULL DEFAULT 'ccavenue',

  -- Gateway-specific order/transaction IDs
  gateway_order_id text NOT NULL,  -- CCAvenue order_id or Razorpay order_id
  gateway_tracking_id text,         -- CCAvenue tracking_id
  gateway_payment_id text,          -- Razorpay payment_id
  gateway_signature text,           -- For signature verification

  -- Payment details
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  currency text DEFAULT 'INR',

  -- Payment purpose
  payment_purpose text DEFAULT 'credit_topup' CHECK (payment_purpose IN (
    'credit_topup',      -- General credit top-up
    'order_payment',     -- Payment for specific order
    'shortfall_payment', -- Payment for credit shortfall
    'advance_payment'    -- Advance payment
  )),

  -- Status tracking
  status text NOT NULL DEFAULT 'initiated' CHECK (status IN (
    'initiated',    -- Payment request created
    'pending',      -- User redirected to gateway
    'processing',   -- Gateway processing
    'success',      -- Payment successful
    'failed',       -- Payment failed
    'cancelled',    -- User cancelled
    'timeout',      -- Payment timed out
    'refunded',     -- Payment refunded
    'disputed'      -- Payment disputed
  )),

  -- Gateway response details
  failure_reason text,
  bank_ref_number text,
  payment_method text,  -- 'card', 'netbanking', 'upi', 'wallet'
  card_type text,       -- 'visa', 'mastercard', 'rupay'
  card_last4 text,

  -- Raw request/response for audit
  raw_request jsonb,
  raw_response jsonb,

  -- Idempotency
  idempotency_key text UNIQUE,
  credit_applied boolean DEFAULT false,  -- Flag to prevent double credit
  credit_applied_at timestamptz,

  -- Timestamps
  initiated_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  -- Who initiated
  initiated_by uuid REFERENCES public.users(id),

  -- Webhook tracking
  webhook_received_at timestamptz,
  webhook_verified boolean DEFAULT false,
  webhook_data jsonb,  -- Raw webhook payload for audit

  -- Refund tracking
  refund_amount numeric(12,2),
  refund_id text,
  refunded_at timestamptz,

  -- Chargeback/dispute tracking
  chargeback_amount numeric(12,2),
  chargeback_id text,
  disputed_at timestamptz
);

-- Indexes for common queries
CREATE INDEX idx_b2b_payment_attempts_account
  ON public.b2b_payment_attempts(account_id, status);

CREATE INDEX idx_b2b_payment_attempts_gateway_order
  ON public.b2b_payment_attempts(gateway_order_id);

CREATE INDEX idx_b2b_payment_attempts_lab_status
  ON public.b2b_payment_attempts(lab_id, status, created_at DESC);

CREATE INDEX idx_b2b_payment_attempts_pending_order
  ON public.b2b_payment_attempts(pending_order_id)
  WHERE pending_order_id IS NOT NULL;

-- ============================================
-- 4. B2B CREDIT LEDGER TABLE
-- Detailed credit movement tracking
-- ============================================

CREATE TABLE IF NOT EXISTS public.b2b_credit_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_id uuid NOT NULL REFERENCES public.labs(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,

  -- Entry type
  entry_type text NOT NULL CHECK (entry_type IN (
    'OPENING_BALANCE',    -- Initial credit setup
    'CREDIT_LIMIT_CHANGE', -- Admin changed credit limit
    'ORDER_DEBIT',        -- Order placed, credit consumed
    'ORDER_CANCEL_CREDIT', -- Order cancelled, credit restored
    'PAYMENT_CREDIT',     -- Payment received, credit added
    'MANUAL_CREDIT',      -- Manual credit adjustment (admin)
    'MANUAL_DEBIT',       -- Manual debit adjustment (admin)
    'REFUND_DEBIT',       -- Refund processed, credit reduced
    'EXPIRED_DEBIT',      -- Credit expired
    'TRANSFER_IN',        -- Credit transferred from another account
    'TRANSFER_OUT'        -- Credit transferred to another account
  )),

  -- Amount (positive for credit, stored as absolute with entry_type determining direction)
  amount numeric(12,2) NOT NULL CHECK (amount >= 0),

  -- Running balance after this transaction
  balance_before numeric(12,2) NOT NULL,
  balance_after numeric(12,2) NOT NULL,

  -- Reference to source document
  reference_type text CHECK (reference_type IN (
    'order', 'payment_attempt', 'invoice', 'refund', 'manual', 'system'
  )),
  reference_id uuid,

  -- Additional context
  remarks text,
  metadata jsonb DEFAULT '{}'::jsonb,

  -- Audit
  created_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES public.users(id),

  -- For reversals
  is_reversed boolean DEFAULT false,
  reversed_by_entry_id uuid REFERENCES public.b2b_credit_ledger(id),
  reversal_reason text
);

-- Indexes for ledger queries
CREATE INDEX idx_b2b_credit_ledger_account
  ON public.b2b_credit_ledger(account_id, created_at DESC);

CREATE INDEX idx_b2b_credit_ledger_reference
  ON public.b2b_credit_ledger(reference_type, reference_id)
  WHERE reference_id IS NOT NULL;

CREATE INDEX idx_b2b_credit_ledger_lab_date
  ON public.b2b_credit_ledger(lab_id, created_at DESC);

-- ============================================
-- 5. PENDING B2B ORDERS TABLE
-- Orders waiting for payment before registration
-- ============================================

CREATE TABLE IF NOT EXISTS public.b2b_pending_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_id uuid NOT NULL REFERENCES public.labs(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,

  -- Order details (stored temporarily)
  order_data jsonb NOT NULL,  -- Full order payload

  -- Amounts
  order_amount numeric(12,2) NOT NULL,
  available_credit numeric(12,2) NOT NULL,
  shortfall_amount numeric(12,2) NOT NULL,

  -- Payment tracking
  payment_attempt_id uuid REFERENCES public.b2b_payment_attempts(id),

  -- Status
  status text NOT NULL DEFAULT 'pending_payment' CHECK (status IN (
    'pending_payment',  -- Waiting for payment
    'payment_received', -- Payment successful, ready to create order
    'order_created',    -- Order has been created
    'expired',          -- Payment window expired
    'cancelled'         -- User cancelled
  )),

  -- Timestamps
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 minutes'),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  -- Created order reference
  created_order_id uuid REFERENCES public.orders(id),

  -- Who initiated
  created_by uuid REFERENCES public.users(id)
);

-- Index for expiry cleanup
CREATE INDEX idx_b2b_pending_orders_expires
  ON public.b2b_pending_orders(expires_at)
  WHERE status = 'pending_payment';

CREATE INDEX idx_b2b_pending_orders_account
  ON public.b2b_pending_orders(account_id, status);

-- ============================================
-- 6. HELPER FUNCTIONS
-- ============================================

-- Function to check available credit for an account
CREATE OR REPLACE FUNCTION public.get_account_available_credit(p_account_id uuid)
RETURNS numeric AS $$
DECLARE
  v_credit_limit numeric;
  v_credit_used numeric;
BEGIN
  SELECT credit_limit, credit_used
  INTO v_credit_limit, v_credit_used
  FROM public.accounts
  WHERE id = p_account_id;

  RETURN COALESCE(v_credit_limit, 0) - COALESCE(v_credit_used, 0);
END;
$$ LANGUAGE plpgsql STABLE;

-- Function to update account credit_used from ledger
CREATE OR REPLACE FUNCTION public.recalculate_account_credit_used(p_account_id uuid)
RETURNS void AS $$
DECLARE
  v_total_used numeric;
BEGIN
  -- Calculate total credit used from ledger
  -- Debits increase used, Credits decrease used
  SELECT COALESCE(SUM(
    CASE
      WHEN entry_type IN ('ORDER_DEBIT', 'MANUAL_DEBIT', 'REFUND_DEBIT', 'EXPIRED_DEBIT', 'TRANSFER_OUT') THEN amount
      WHEN entry_type IN ('ORDER_CANCEL_CREDIT', 'PAYMENT_CREDIT', 'MANUAL_CREDIT', 'TRANSFER_IN') THEN -amount
      ELSE 0
    END
  ), 0) INTO v_total_used
  FROM public.b2b_credit_ledger
  WHERE account_id = p_account_id
  AND is_reversed = false;

  -- Update account
  UPDATE public.accounts
  SET credit_used = GREATEST(0, v_total_used),
      updated_at = now()
  WHERE id = p_account_id;
END;
$$ LANGUAGE plpgsql;

-- Function to add credit ledger entry and update account
CREATE OR REPLACE FUNCTION public.add_credit_ledger_entry(
  p_lab_id uuid,
  p_account_id uuid,
  p_entry_type text,
  p_amount numeric,
  p_reference_type text DEFAULT NULL,
  p_reference_id uuid DEFAULT NULL,
  p_remarks text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid AS $$
DECLARE
  v_balance_before numeric;
  v_balance_after numeric;
  v_entry_id uuid;
  v_is_credit boolean;
BEGIN
  -- Get current balance
  v_balance_before := public.get_account_available_credit(p_account_id);

  -- Determine if this is a credit or debit to available balance
  v_is_credit := p_entry_type IN (
    'OPENING_BALANCE', 'CREDIT_LIMIT_CHANGE', 'ORDER_CANCEL_CREDIT',
    'PAYMENT_CREDIT', 'MANUAL_CREDIT', 'TRANSFER_IN'
  );

  -- Calculate new balance
  IF v_is_credit THEN
    v_balance_after := v_balance_before + p_amount;
  ELSE
    v_balance_after := v_balance_before - p_amount;
  END IF;

  -- Insert ledger entry
  INSERT INTO public.b2b_credit_ledger (
    lab_id, account_id, entry_type, amount,
    balance_before, balance_after,
    reference_type, reference_id, remarks, created_by, metadata
  ) VALUES (
    p_lab_id, p_account_id, p_entry_type, p_amount,
    v_balance_before, v_balance_after,
    p_reference_type, p_reference_id, p_remarks, p_created_by, p_metadata
  ) RETURNING id INTO v_entry_id;

  -- Update account credit_used
  PERFORM public.recalculate_account_credit_used(p_account_id);

  RETURN v_entry_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 7. TRIGGERS
-- ============================================

-- Trigger to update timestamps
CREATE OR REPLACE FUNCTION public.update_payment_gateway_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_lab_payment_gateways_updated
  BEFORE UPDATE ON public.lab_payment_gateways
  FOR EACH ROW
  EXECUTE FUNCTION public.update_payment_gateway_timestamp();

CREATE TRIGGER trg_b2b_payment_attempts_updated
  BEFORE UPDATE ON public.b2b_payment_attempts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_payment_gateway_timestamp();

CREATE TRIGGER trg_b2b_pending_orders_updated
  BEFORE UPDATE ON public.b2b_pending_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.update_payment_gateway_timestamp();

-- ============================================
-- 8. ROW LEVEL SECURITY
-- ============================================

-- Enable RLS
ALTER TABLE public.lab_payment_gateways ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.b2b_payment_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.b2b_credit_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.b2b_pending_orders ENABLE ROW LEVEL SECURITY;

-- Policies for lab_payment_gateways (lab admins only)
CREATE POLICY "Lab admins can view their payment gateways"
  ON public.lab_payment_gateways FOR SELECT
  USING (lab_id IN (
    SELECT lab_id FROM public.users WHERE id = auth.uid()
  ));

CREATE POLICY "Lab admins can manage their payment gateways"
  ON public.lab_payment_gateways FOR ALL
  USING (lab_id IN (
    SELECT lab_id FROM public.users
    WHERE id = auth.uid() AND role IN ('Admin', 'Manager')
  ));

-- Policies for b2b_payment_attempts
CREATE POLICY "Users can view payment attempts for their lab"
  ON public.b2b_payment_attempts FOR SELECT
  USING (lab_id IN (
    SELECT lab_id FROM public.users WHERE id = auth.uid()
  ));

CREATE POLICY "Users can create payment attempts for their lab"
  ON public.b2b_payment_attempts FOR INSERT
  WITH CHECK (lab_id IN (
    SELECT lab_id FROM public.users WHERE id = auth.uid()
  ));

-- Policies for b2b_credit_ledger
CREATE POLICY "Users can view credit ledger for their lab"
  ON public.b2b_credit_ledger FOR SELECT
  USING (lab_id IN (
    SELECT lab_id FROM public.users WHERE id = auth.uid()
  ));

-- Policies for b2b_pending_orders
CREATE POLICY "Users can view pending orders for their lab"
  ON public.b2b_pending_orders FOR SELECT
  USING (lab_id IN (
    SELECT lab_id FROM public.users WHERE id = auth.uid()
  ));

CREATE POLICY "Users can manage pending orders for their lab"
  ON public.b2b_pending_orders FOR ALL
  USING (lab_id IN (
    SELECT lab_id FROM public.users WHERE id = auth.uid()
  ));

-- ============================================
-- 9. COMMENTS FOR DOCUMENTATION
-- ============================================

COMMENT ON TABLE public.lab_payment_gateways IS 'Payment gateway configurations per lab. Supports multiple gateways (CCAvenue, Razorpay, etc.)';
COMMENT ON TABLE public.b2b_payment_attempts IS 'All payment attempts from B2B clients. Tracks status, gateway response, and prevents double crediting.';
COMMENT ON TABLE public.b2b_credit_ledger IS 'Complete audit trail of all credit movements for B2B accounts.';
COMMENT ON TABLE public.b2b_pending_orders IS 'Orders waiting for payment before being registered. Auto-expires after 30 minutes.';

COMMENT ON COLUMN public.lab_payment_gateways.credentials_encrypted IS 'Provider-specific credentials. CCAvenue: {merchant_id, access_code, working_key, optional callback/webhook access codes and working keys}. Razorpay: {key_id, key_secret}';
COMMENT ON COLUMN public.b2b_payment_attempts.credit_applied IS 'Idempotency flag to prevent double crediting. Set to true only after credit ledger entry is created.';
COMMENT ON COLUMN public.accounts.credit_balance IS 'Computed column: credit_limit - credit_used. Represents available credit for orders.';
