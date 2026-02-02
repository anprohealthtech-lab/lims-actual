-- Migration: Sync auth_user_id and whatsapp_user_id from auth.users to public.users by email
-- This ensures public.users.auth_user_id and whatsapp_user_id are populated for permission checks and WhatsApp integration

-- 1. Create function to sync auth_user_id and whatsapp_user_id by email
CREATE OR REPLACE FUNCTION sync_auth_user_id_by_email()
RETURNS TRIGGER AS $$
BEGIN
    -- When a user is inserted/updated, try to find matching auth.users by email
    IF NEW.auth_user_id IS NULL AND NEW.email IS NOT NULL THEN
        SELECT id INTO NEW.auth_user_id
        FROM auth.users
        WHERE email = NEW.email
        LIMIT 1;
        
        IF NEW.auth_user_id IS NOT NULL THEN
            RAISE NOTICE 'Linked auth_user_id % for email %', NEW.auth_user_id, NEW.email;
            
            -- Also sync whatsapp_user_id to match auth_user_id (same UUID for WhatsApp integration)
            IF NEW.whatsapp_user_id IS NULL THEN
                NEW.whatsapp_user_id := NEW.auth_user_id;
                RAISE NOTICE 'Also set whatsapp_user_id to % for email %', NEW.whatsapp_user_id, NEW.email;
            END IF;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Create trigger on public.users for INSERT and UPDATE
DROP TRIGGER IF EXISTS trigger_sync_auth_user_id ON users;
CREATE TRIGGER trigger_sync_auth_user_id
    BEFORE INSERT OR UPDATE OF email ON users
    FOR EACH ROW
    EXECUTE FUNCTION sync_auth_user_id_by_email();

-- 3. Backfill existing users - link auth_user_id and whatsapp_user_id by email
UPDATE users u
SET 
    auth_user_id = a.id,
    whatsapp_user_id = COALESCE(u.whatsapp_user_id, a.id)  -- Set whatsapp_user_id if not already set
FROM auth.users a
WHERE u.email = a.email
  AND u.auth_user_id IS NULL;

-- 4. Also create a trigger on auth.users to update public.users when auth user is created
CREATE OR REPLACE FUNCTION sync_public_user_on_auth_create()
RETURNS TRIGGER AS $$
BEGIN
    -- When a new auth user is created, update matching public.users record
    UPDATE users
    SET 
        auth_user_id = NEW.id,
        whatsapp_user_id = COALESCE(whatsapp_user_id, NEW.id)  -- Set whatsapp_user_id if not already set
    WHERE email = NEW.email
      AND auth_user_id IS NULL;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Note: This trigger on auth.users requires elevated permissions
-- Only create if we have access to auth schema
DO $$
BEGIN
    -- Try to create trigger on auth.users
    DROP TRIGGER IF EXISTS trigger_sync_public_user_on_auth_create ON auth.users;
    CREATE TRIGGER trigger_sync_public_user_on_auth_create
        AFTER INSERT ON auth.users
        FOR EACH ROW
        EXECUTE FUNCTION sync_public_user_on_auth_create();
EXCEPTION
    WHEN insufficient_privilege THEN
        RAISE NOTICE 'Cannot create trigger on auth.users - insufficient privileges. Backfill only.';
    WHEN undefined_table THEN
        RAISE NOTICE 'auth.users table not accessible. Backfill only.';
END $$;

-- 5. Verify the backfill worked
DO $$
DECLARE
    v_count INTEGER;
    v_linked INTEGER;
    v_whatsapp_linked INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_count FROM users WHERE auth_user_id IS NULL;
    SELECT COUNT(*) INTO v_linked FROM users WHERE auth_user_id IS NOT NULL;
    SELECT COUNT(*) INTO v_whatsapp_linked FROM users WHERE whatsapp_user_id IS NOT NULL;
    
    RAISE NOTICE 'Users with auth_user_id linked: %', v_linked;
    RAISE NOTICE 'Users with whatsapp_user_id linked: %', v_whatsapp_linked;
    RAISE NOTICE 'Users still missing auth_user_id: %', v_count;
END $$;
