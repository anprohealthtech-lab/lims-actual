-- Fix handle_new_user trigger to include role_id
-- Run this in Supabase SQL Editor

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
    default_lab_id uuid;
    default_role_id uuid;
BEGIN
    -- Get the first active lab as default
    SELECT id INTO default_lab_id 
    FROM labs 
    WHERE is_active = true 
    ORDER BY created_at ASC 
    LIMIT 1;
    
    -- Get default technician role
    SELECT id INTO default_role_id
    FROM user_roles
    WHERE role_code = 'technician'
    LIMIT 1;
    
    -- Insert new user into public.users table
    INSERT INTO public.users (
        id,
        name,
        email,
        role,
        role_id,
        status,
        lab_id,
        join_date,
        created_at,
        updated_at
    ) VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'name', NEW.email),
        NEW.email,
        'Technician',
        COALESCE((NEW.raw_user_meta_data->>'role_id')::uuid, default_role_id),
        'Active',
        COALESCE((NEW.raw_user_meta_data->>'lab_id')::uuid, default_lab_id),
        CURRENT_DATE,
        NOW(),
        NOW()
    )
    ON CONFLICT (id) DO NOTHING;
    
    RETURN NEW;
EXCEPTION
    WHEN OTHERS THEN
        -- Log error but don't fail the auth user creation
        RAISE WARNING 'Failed to create public.users record: %', SQLERRM;
        RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recreate the trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
