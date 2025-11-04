-- Migration to make users lab-specific and improve result verification

DO $$
BEGIN
    -- Add lab_id to users table if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'users' AND column_name = 'lab_id'
    ) THEN
        ALTER TABLE users ADD COLUMN lab_id UUID REFERENCES labs(id);
        
        -- Create index for performance
        CREATE INDEX IF NOT EXISTS idx_users_lab_id ON users(lab_id);
    END IF;

    -- Update existing users to have lab_id based on their current context
    -- First, try to match users with existing lab_user_signatures
    UPDATE users 
    SET lab_id = lus.lab_id
    FROM lab_user_signatures lus
    WHERE users.id = lus.user_id 
    AND users.lab_id IS NULL;

    -- For remaining users without signatures, assign to first available lab
    UPDATE users 
    SET lab_id = (SELECT id FROM labs ORDER BY created_at LIMIT 1)
    WHERE lab_id IS NULL;

    -- Add constraint to ensure users must have a lab
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'users_lab_id_required' 
        AND table_name = 'users'
    ) THEN
        -- First ensure no NULL values exist
        UPDATE users SET lab_id = (SELECT id FROM labs ORDER BY created_at LIMIT 1) WHERE lab_id IS NULL;
        
        -- Now add the constraint
        ALTER TABLE users ADD CONSTRAINT users_lab_id_required CHECK (lab_id IS NOT NULL);
    END IF;

END $$;

-- Add helpful comments
COMMENT ON COLUMN users.lab_id IS 'Associates user with a specific lab for access control and signature verification';