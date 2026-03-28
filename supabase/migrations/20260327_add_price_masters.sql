-- Price Masters: named pricing plans that can be attached to B2B accounts
-- Instead of per-account-per-test pricing, create a reusable plan once and attach to N accounts

-- 1. price_masters: plan header
CREATE TABLE IF NOT EXISTS price_masters (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_id      UUID NOT NULL REFERENCES labs(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_price_masters_lab_id ON price_masters(lab_id);

-- 2. price_master_items: per-test prices inside a plan
CREATE TABLE IF NOT EXISTS price_master_items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  price_master_id  UUID NOT NULL REFERENCES price_masters(id) ON DELETE CASCADE,
  test_group_id    UUID NOT NULL REFERENCES test_groups(id) ON DELETE CASCADE,
  price            NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (price_master_id, test_group_id)
);

CREATE INDEX IF NOT EXISTS idx_price_master_items_master_id ON price_master_items(price_master_id);
CREATE INDEX IF NOT EXISTS idx_price_master_items_test_group_id ON price_master_items(test_group_id);

-- 3. link accounts to a price master (optional)
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS price_master_id UUID REFERENCES price_masters(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_accounts_price_master_id ON accounts(price_master_id);

-- 4. updated_at trigger helper (reuse if already exists, else create)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_price_masters_updated_at
  BEFORE UPDATE ON price_masters
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_price_master_items_updated_at
  BEFORE UPDATE ON price_master_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 5. RLS: lab users can only see/modify their own price masters
ALTER TABLE price_masters ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_master_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Lab users can manage their price masters"
  ON price_masters FOR ALL
  USING (lab_id = (SELECT lab_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Lab users can manage price master items"
  ON price_master_items FOR ALL
  USING (
    price_master_id IN (
      SELECT id FROM price_masters
      WHERE lab_id = (SELECT lab_id FROM users WHERE id = auth.uid())
    )
  );
