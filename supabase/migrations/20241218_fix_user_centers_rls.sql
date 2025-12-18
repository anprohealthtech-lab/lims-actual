-- Fix RLS policies for user_centers table
-- Allow admins and authorized users to manage user center assignments

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Admins can manage user centers" ON public.user_centers;
DROP POLICY IF EXISTS "Admins can manage centers" ON public.user_centers;
DROP POLICY IF EXISTS "Users can view their centers" ON public.user_centers;
DROP POLICY IF EXISTS "Users can view their own centers" ON public.user_centers;

-- Create comprehensive policies for user_centers

-- 1. Allow SELECT for authenticated users (view their own assignments)
CREATE POLICY "Users can view their own center assignments"
ON public.user_centers
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
);

-- 2. Allow SELECT for public (needed for some queries)
CREATE POLICY "Public can view user centers"
ON public.user_centers
FOR SELECT
TO public
USING (true);

-- 3. Allow INSERT for authenticated users (admins/managers creating assignments)
CREATE POLICY "Authenticated users can create center assignments"
ON public.user_centers
FOR INSERT
TO authenticated
WITH CHECK (
  -- Check if the current user has permission to manage users
  EXISTS (
    SELECT 1 FROM users
    WHERE id::text = auth.uid()::text
    AND role IN ('Admin', 'Lab Manager')
  )
);

-- 4. Allow UPDATE for authenticated users (admins/managers updating assignments)
CREATE POLICY "Authenticated users can update center assignments"
ON public.user_centers
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM users
    WHERE id::text = auth.uid()::text
    AND role IN ('Admin', 'Lab Manager')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM users
    WHERE id::text = auth.uid()::text
    AND role IN ('Admin', 'Lab Manager')
  )
);

-- 5. Allow DELETE for authenticated users (admins/managers removing assignments)
CREATE POLICY "Authenticated users can delete center assignments"
ON public.user_centers
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM users
    WHERE id::text = auth.uid()::text
    AND role IN ('Admin', 'Lab Manager')
  )
);

-- Add comment explaining the policies
COMMENT ON TABLE public.user_centers IS 'Junction table for user-location assignments. RLS policies allow admins and lab managers to manage assignments, while users can view their own assignments.';
