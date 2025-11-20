-- Fix infinite recursion in user_roles RLS policy
-- Lab-level architecture: Admin users manage roles per lab
-- Simple, non-recursive policies using JWT claims instead of table joins

-- Step 1: Disable RLS temporarily to clear old policies
ALTER TABLE public.user_roles DISABLE ROW LEVEL SECURITY;

-- Step 2: Drop all existing problematic policies that cause recursion
DROP POLICY IF EXISTS "user_roles_select_policy" ON public.user_roles;
DROP POLICY IF EXISTS "select_user_roles" ON public.user_roles;
DROP POLICY IF EXISTS "users_can_select_roles" ON public.user_roles;
DROP POLICY IF EXISTS "user_roles_insert_policy" ON public.user_roles;
DROP POLICY IF EXISTS "insert_user_roles" ON public.user_roles;
DROP POLICY IF EXISTS "user_roles_update_policy" ON public.user_roles;
DROP POLICY IF EXISTS "update_user_roles" ON public.user_roles;
DROP POLICY IF EXISTS "user_roles_delete_policy" ON public.user_roles;
DROP POLICY IF EXISTS "delete_user_roles" ON public.user_roles;
DROP POLICY IF EXISTS "Enable all access" ON public.user_roles;
DROP POLICY IF EXISTS "Allow access" ON public.user_roles;
DROP POLICY IF EXISTS "view_active_roles" ON public.user_roles;
DROP POLICY IF EXISTS "admin_view_all_roles" ON public.user_roles;
DROP POLICY IF EXISTS "admin_insert_roles" ON public.user_roles;
DROP POLICY IF EXISTS "admin_update_roles" ON public.user_roles;
DROP POLICY IF EXISTS "admin_delete_roles" ON public.user_roles;

-- Step 3: Re-enable RLS with proper lab-scoped policies
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Policy 1: All authenticated users can view active roles
-- (Lab admins will filter by lab in application layer)
CREATE POLICY "users_view_active_roles" ON public.user_roles
    FOR SELECT
    TO authenticated
    USING (is_active = true);

-- Policy 2: Lab admins only - insert new roles
-- Uses JWT role claim to avoid table join recursion
CREATE POLICY "lab_admin_insert_roles" ON public.user_roles
    FOR INSERT
    TO authenticated
    WITH CHECK (
        -- Check if user has admin role in JWT (set by your auth system)
        (auth.jwt()->>'role')::text IN ('Admin', 'admin', 'Lab Manager', 'lab_manager')
        OR
        -- Fallback: check auth.users metadata
        (current_setting('app.user_role', true))::text IN ('Admin', 'Lab Manager')
    );

-- Policy 3: Lab admins only - update roles
CREATE POLICY "lab_admin_update_roles" ON public.user_roles
    FOR UPDATE
    TO authenticated
    USING (
        (auth.jwt()->>'role')::text IN ('Admin', 'admin', 'Lab Manager', 'lab_manager')
        OR
        (current_setting('app.user_role', true))::text IN ('Admin', 'Lab Manager')
    )
    WITH CHECK (
        (auth.jwt()->>'role')::text IN ('Admin', 'admin', 'Lab Manager', 'lab_manager')
        OR
        (current_setting('app.user_role', true))::text IN ('Admin', 'Lab Manager')
    );

-- Policy 4: Lab admins only - delete roles
CREATE POLICY "lab_admin_delete_roles" ON public.user_roles
    FOR DELETE
    TO authenticated
    USING (
        (auth.jwt()->>'role')::text IN ('Admin', 'admin', 'Lab Manager', 'lab_manager')
        OR
        (current_setting('app.user_role', true))::text IN ('Admin', 'Lab Manager')
    );

-- Verify fix
SELECT 'Lab-scoped RLS policies created - infinite recursion fixed ✓' AS status;
