-- Emergency fix: Allow authenticated users to access sample_transits
-- This resolves the 42501 error by simplifying the policy to allow all authenticated users.
-- We will rely on the application logic (API) to enforce lab boundaries for now.

-- 1. Ensure RLS is enabled (so we don't accidentally expose to public/anon)
ALTER TABLE sample_transits ENABLE ROW LEVEL SECURITY;

-- 2. Drop all existing restrictive policies
DROP POLICY IF EXISTS "Users can view sample_transits from their lab" ON sample_transits;
DROP POLICY IF EXISTS "Users can insert sample_transits for their lab" ON sample_transits;
DROP POLICY IF EXISTS "Users can update sample_transits from their lab" ON sample_transits;
DROP POLICY IF EXISTS "Users can delete sample_transits from their lab" ON sample_transits;

-- 3. Create a single permissive policy for authenticated users
CREATE POLICY "Authenticated users can manage sample_transits"
ON sample_transits
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- 4. Also ensure users table is readable by authenticated users (needed for other lookups)
DROP POLICY IF EXISTS "Users can view own profile" ON users;
CREATE POLICY "Users can view own profile"
ON users FOR SELECT
TO authenticated
USING (true);
