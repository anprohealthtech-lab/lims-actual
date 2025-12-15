-- Fix RLS issues by using a SECURITY DEFINER function to safely retrieve user's lab_id
-- This avoids circular RLS dependency issues where the user might not be able to read the users table

-- 1. Create a secure function to get the current user's lab_id
CREATE OR REPLACE FUNCTION get_auth_user_lab_id()
RETURNS UUID AS $$
BEGIN
  RETURN (
    SELECT lab_id 
    FROM users 
    WHERE auth_user_id = auth.uid() 
    LIMIT 1
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION get_auth_user_lab_id() TO authenticated;

-- 2. Re-create policies on sample_transits using the helper function

-- Drop existing policies to be clean
DROP POLICY IF EXISTS "Users can view sample_transits from their lab" ON sample_transits;
DROP POLICY IF EXISTS "Users can insert sample_transits for their lab" ON sample_transits;
DROP POLICY IF EXISTS "Users can update sample_transits from their lab" ON sample_transits;
DROP POLICY IF EXISTS "Users can delete sample_transits from their lab" ON sample_transits;

-- Create simplified policies
CREATE POLICY "Users can view sample_transits from their lab"
ON sample_transits FOR SELECT
USING (
  lab_id = get_auth_user_lab_id()
);

CREATE POLICY "Users can insert sample_transits for their lab"
ON sample_transits FOR INSERT
WITH CHECK (
  lab_id = get_auth_user_lab_id()
);

CREATE POLICY "Users can update sample_transits from their lab"
ON sample_transits FOR UPDATE
USING (
  lab_id = get_auth_user_lab_id()
);

CREATE POLICY "Users can delete sample_transits from their lab"
ON sample_transits FOR DELETE
USING (
  lab_id = get_auth_user_lab_id()
);

-- 3. Ensure users table has RLS enabled and a basic policy (just in case)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Drop policy if exists to avoid error
DROP POLICY IF EXISTS "Users can view own profile" ON users;

CREATE POLICY "Users can view own profile"
ON users FOR SELECT
USING (
  auth_user_id = auth.uid()
);
