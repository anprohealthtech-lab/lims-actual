-- Lab-level user_roles policies (after dropping all old ones)
-- These policies secure user role management for lab admins

-- Policy 1: All authenticated users can view active roles
CREATE POLICY "view_active_roles" ON public.user_roles
    FOR SELECT
    TO authenticated
    USING (is_active = true);

-- Policy 2: Lab admins can view ALL roles (including inactive)
CREATE POLICY "admin_view_all_roles" ON public.user_roles
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.users
            WHERE users.id = auth.uid()
            AND users.role::text = 'Admin'
        )
    );

-- Policy 3: Lab admins can insert new roles
CREATE POLICY "admin_insert_roles" ON public.user_roles
    FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.users
            WHERE users.id = auth.uid()
            AND users.role::text = 'Admin'
        )
    );

-- Policy 4: Lab admins can update roles
CREATE POLICY "admin_update_roles" ON public.user_roles
    FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.users
            WHERE users.id = auth.uid()
            AND users.role::text = 'Admin'
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.users
            WHERE users.id = auth.uid()
            AND users.role::text = 'Admin'
        )
    );

-- Policy 5: Lab admins can delete roles
CREATE POLICY "admin_delete_roles" ON public.user_roles
    FOR DELETE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.users
            WHERE users.id = auth.uid()
            AND users.role::text = 'Admin'
        )
    );

SELECT 'Lab-level RLS policies created ✓' AS status;
