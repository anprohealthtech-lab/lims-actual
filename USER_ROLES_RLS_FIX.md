# User Roles RLS Infinite Recursion Fix

## Problem
The Settings page is getting a 500 error: `infinite recursion detected in policy for relation "user_roles"`

## Root Cause
The RLS (Row Level Security) policy on the `user_roles` table has circular logic that references itself or other tables that also reference `user_roles`, creating infinite recursion:

```
user_roles → (policy checks users table)
  ↓
users.role_id → references user_roles
  ↓
Infinite loop detected
```

## Lab-Level Architecture Context
This is a **lab-level management** interface where:
- Admin users manage user roles for their lab
- Each user has `role_id` referencing `user_roles`
- Settings page needs to load all available roles for user management

## Solutions

### Solution 1: Fix RLS with Non-Recursive Policies (RECOMMENDED)
**File**: `db/migrations/20251119_fix_user_roles_rls.sql`

This migration:
1. Disables RLS temporarily
2. Drops all problematic policies
3. Creates new **non-recursive** policies that:
   - Allow viewing active roles to all authenticated users
   - Restrict admin operations (insert/update/delete) to Admin users
   - Avoid querying the users table for role validation

**Benefits**:
- ✅ Keeps security intact
- ✅ No recursion (only checks if user has Admin role directly)
- ✅ Proper lab isolation maintained through application logic

### Solution 2: Disable RLS Entirely
**File**: `db/migrations/20251119_fix_user_roles_rls_alternative.sql`

For a **lab-controlled** environment where the application handles security:

```sql
ALTER TABLE public.user_roles DISABLE ROW LEVEL SECURITY;
```

**Use this if**:
- Your application already handles role-based access control
- You want to rely on backend authorization instead of database-level RLS
- Performance is critical

## Implementation Steps

### Option A: Apply Solution 1 (Recommended)
1. Go to Supabase SQL Editor
2. Copy the entire content from `db/migrations/20251119_fix_user_roles_rls.sql`
3. Paste and execute
4. Test: Try loading Settings page → should load user roles without 500 error

### Option B: Quick Fix (Disable RLS)
1. Go to Supabase SQL Editor
2. Run this single command:
```sql
ALTER TABLE public.user_roles DISABLE ROW LEVEL SECURITY;
```
3. Test immediately

### Option C: Apply Both Migrations (Layered Security)
1. First apply Solution 1 for proper RLS
2. Add application-level auth checks in Settings.tsx
3. Full defense-in-depth approach

## What Changed

### Before (Infinite Recursion)
```sql
-- Problematic policy that causes recursion
CREATE POLICY "select_user_roles" ON public.user_roles
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.users
            WHERE users.id = auth.uid()
            AND users.role_id = user_roles.id  -- ❌ References user_roles, circular!
        )
    );
```

### After (Non-Recursive)
```sql
-- Safe policy without recursion
CREATE POLICY "view_active_roles" ON public.user_roles
    FOR SELECT
    USING (is_active = true);  -- ✅ Simple condition, no table joins

CREATE POLICY "admin_view_all_roles" ON public.user_roles
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.users
            WHERE users.id = auth.uid()
            AND users.role::text = 'Admin'  -- ✅ Direct role check, not via FK
        )
    );
```

## Testing

After applying the fix:

1. **In Supabase SQL Editor**, verify policies:
```sql
SELECT * FROM pg_policies WHERE tablename = 'user_roles';
```

2. **In Application**, test:
```typescript
// Settings.tsx should now load without error
const { data, error } = await database.getUserRoles();
// Should succeed instead of 500 error
```

3. **Expected Result**: Settings page loads → User Management tab visible → Can see available roles

## Database Schema Context

**user_roles table**:
```sql
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY,
  role_name character varying NOT NULL UNIQUE,
  role_code character varying NOT NULL UNIQUE,
  description text,
  is_system_role boolean DEFAULT false,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone,
  updated_at timestamp with time zone
);
```

**users table** (references user_roles):
```sql
CREATE TABLE public.users (
  id uuid PRIMARY KEY,
  name character varying NOT NULL,
  email character varying NOT NULL UNIQUE,
  role_id uuid REFERENCES public.user_roles(id),
  lab_id uuid NOT NULL REFERENCES public.labs(id),
  -- ... other columns
);
```

## Recommended Setup for Lab Architecture

For a **lab-centric system** where Admin manages users:

1. **Keep RLS enabled** (Solution 1) for:
   - Active role viewing by all users
   - Admin-only role management operations
   - Prevents direct database tampering

2. **Add application layer** in Settings.tsx:
   - Check if current user is Admin
   - Only show role management to Admins
   - Log all role modifications in audit_logs

3. **Result**:
   - Database-level security (RLS prevents bypass)
   - Application-level security (UI hides from non-admins)
   - No infinite recursion ✅

## Troubleshooting

If still getting 500 error after Solution 1:
- Go to Supabase → SQL Editor → Run Solution 2 (disable RLS)
- This is guaranteed to fix the immediate error
- Then add back RLS incrementally if needed

If you see permission denied errors:
- Ensure authenticated user has proper role_id in users table
- Check that user's lab_id matches (for lab-scoped access)
- Verify policy conditions are correct for your auth setup
