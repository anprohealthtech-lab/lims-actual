-- Add account_id to bookings table for B2B tracking
ALTER TABLE "public"."bookings" 
ADD COLUMN IF NOT EXISTS "account_id" uuid REFERENCES "public"."accounts"("id");

-- RLS Policies for B2B Portal Access

-- 1. Accounts Table: View own account
DROP POLICY IF EXISTS "B2B users can view own account" ON "public"."accounts";
CREATE POLICY "B2B users can view own account" ON "public"."accounts"
AS PERMISSIVE FOR SELECT
TO authenticated
USING (
  (auth.jwt() -> 'user_metadata' ->> 'role') = 'b2b_account' 
  AND 
  id = ((auth.jwt() -> 'user_metadata' ->> 'account_id')::text)::uuid
);

-- 2. Orders Table: View account orders
DROP POLICY IF EXISTS "B2B users can view account orders" ON "public"."orders";
CREATE POLICY "B2B users can view account orders" ON "public"."orders"
AS PERMISSIVE FOR SELECT
TO authenticated
USING (
  (auth.jwt() -> 'user_metadata' ->> 'role') = 'b2b_account' 
  AND 
  account_id = ((auth.jwt() -> 'user_metadata' ->> 'account_id')::text)::uuid
);

-- 3. Reports Table: View reports for account orders
DROP POLICY IF EXISTS "B2B users can view account reports" ON "public"."reports";
CREATE POLICY "B2B users can view account reports" ON "public"."reports"
AS PERMISSIVE FOR SELECT
TO authenticated
USING (
  (auth.jwt() -> 'user_metadata' ->> 'role') = 'b2b_account' 
  AND 
  order_id IN (
    SELECT id FROM orders 
    WHERE account_id = ((auth.jwt() -> 'user_metadata' ->> 'account_id')::text)::uuid
  )
);

-- 4. Bookings Table: View own bookings
DROP POLICY IF EXISTS "B2B users can view own bookings" ON "public"."bookings";
CREATE POLICY "B2B users can view own bookings" ON "public"."bookings"
AS PERMISSIVE FOR SELECT
TO authenticated
USING (
  (auth.jwt() -> 'user_metadata' ->> 'role') = 'b2b_account' 
  AND 
  account_id = ((auth.jwt() -> 'user_metadata' ->> 'account_id')::text)::uuid
);

-- 5. Bookings Table: Create bookings
DROP POLICY IF EXISTS "B2B users can insert bookings" ON "public"."bookings";
CREATE POLICY "B2B users can insert bookings" ON "public"."bookings"
AS PERMISSIVE FOR INSERT
TO authenticated
WITH CHECK (
  (auth.jwt() -> 'user_metadata' ->> 'role') = 'b2b_account' 
  AND 
  account_id = ((auth.jwt() -> 'user_metadata' ->> 'account_id')::text)::uuid
);

-- 6. Bookings Table: Update own bookings (e.g. cancel)
DROP POLICY IF EXISTS "B2B users can update own bookings" ON "public"."bookings";
CREATE POLICY "B2B users can update own bookings" ON "public"."bookings"
AS PERMISSIVE FOR UPDATE
TO authenticated
USING (
  (auth.jwt() -> 'user_metadata' ->> 'role') = 'b2b_account' 
  AND 
  account_id = ((auth.jwt() -> 'user_metadata' ->> 'account_id')::text)::uuid
);

-- Grant permissions if necessary (usually authenticated role has access, but good to ensure)
GRANT SELECT ON "public"."accounts" TO authenticated;
GRANT SELECT ON "public"."orders" TO authenticated;
GRANT SELECT ON "public"."reports" TO authenticated;
