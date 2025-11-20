-- Migration: Relax test_group_analytes constraints to allow flexible updates
-- Date: 2025-11-19
-- Purpose: Allow updating test groups (price, name, analytes) without constraint violations

-- Step 1: Drop ALL problematic foreign key constraints
DO $$ 
DECLARE
    constraint_record RECORD;
BEGIN
    -- Drop ALL constraints on result_values that reference test_group_analytes
    FOR constraint_record IN 
        SELECT constraint_name 
        FROM information_schema.table_constraints 
        WHERE table_name = 'result_values' 
        AND constraint_type = 'FOREIGN KEY'
        AND constraint_name LIKE '%tg_analyte%'
        OR constraint_name LIKE '%test_group_analyte%'
    LOOP
        EXECUTE format('ALTER TABLE result_values DROP CONSTRAINT IF EXISTS %I', constraint_record.constraint_name);
        RAISE NOTICE 'Dropped constraint % from result_values', constraint_record.constraint_name;
    END LOOP;

    -- Drop specific known problematic constraints
    ALTER TABLE result_values DROP CONSTRAINT IF EXISTS rv_tg_analyte_fkey;
    ALTER TABLE result_values DROP CONSTRAINT IF EXISTS result_values_test_group_analyte_id_fkey;
    ALTER TABLE test_group_analytes DROP CONSTRAINT IF EXISTS rv_tg_analyte_fkey;
    
    RAISE NOTICE 'Completed dropping problematic constraints';
END $$;

-- Step 2: Ensure test_group_analytes has proper foreign keys (but flexible ones)
-- Allow deleting test_group_analytes even if results reference them
DO $$
BEGIN
    -- Drop existing FK constraints first
    ALTER TABLE test_group_analytes DROP CONSTRAINT IF EXISTS test_group_analytes_test_group_id_fkey;
    ALTER TABLE test_group_analytes DROP CONSTRAINT IF EXISTS test_group_analytes_analyte_id_fkey;
    
    -- Add FK to test_groups with CASCADE delete
    ALTER TABLE test_group_analytes 
    ADD CONSTRAINT test_group_analytes_test_group_id_fkey 
    FOREIGN KEY (test_group_id) 
    REFERENCES test_groups(id) 
    ON DELETE CASCADE;
    RAISE NOTICE 'Added FK constraint test_group_analytes_test_group_id_fkey with CASCADE';

    -- Add FK to analytes with CASCADE delete
    ALTER TABLE test_group_analytes 
    ADD CONSTRAINT test_group_analytes_analyte_id_fkey 
    FOREIGN KEY (analyte_id) 
    REFERENCES analytes(id) 
    ON DELETE CASCADE;
    RAISE NOTICE 'Added FK constraint test_group_analytes_analyte_id_fkey with CASCADE';
END $$;

-- Step 3: Create a more flexible relationship for result_values
-- This allows results to keep historical data even if test group config changes
DO $$
BEGIN
    -- Ensure result_values has analyte_id reference (NOT test_group_analytes)
    -- This way, results reference analytes directly, not the junction table
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'result_values' 
        AND column_name = 'analyte_id'
    ) THEN
        -- Drop ALL existing FK constraints on analyte_id
        ALTER TABLE result_values DROP CONSTRAINT IF EXISTS result_values_analyte_id_fkey;
        ALTER TABLE result_values DROP CONSTRAINT IF EXISTS fk_result_values_analyte;
        ALTER TABLE result_values DROP CONSTRAINT IF EXISTS result_values_analyte_fkey;

        -- Add flexible FK - NO ACTION allows keeping results even if analyte config changes
        ALTER TABLE result_values 
        ADD CONSTRAINT result_values_analyte_id_fkey 
        FOREIGN KEY (analyte_id) 
        REFERENCES analytes(id) 
        ON DELETE NO ACTION;
        
        RAISE NOTICE 'Updated result_values FK to reference analytes directly with NO ACTION';
    END IF;
END $$;

-- Step 4: Add helpful indexes for performance
CREATE INDEX IF NOT EXISTS idx_test_group_analytes_test_group_id 
ON test_group_analytes(test_group_id);

CREATE INDEX IF NOT EXISTS idx_test_group_analytes_analyte_id 
ON test_group_analytes(analyte_id);

CREATE INDEX IF NOT EXISTS idx_result_values_analyte_id 
ON result_values(analyte_id);

-- Step 5: Create a view for easy querying of test group configurations
CREATE OR REPLACE VIEW v_test_group_config AS
SELECT 
    tg.id as test_group_id,
    tg.name as test_group_name,
    tg.code,
    tg.category,
    tg.price,
    tg.sample_type,
    tg.is_active as test_group_active,
    a.id as analyte_id,
    a.name as analyte_name,
    a.unit,
    a.reference_range,
    a.is_active as analyte_active
FROM test_groups tg
LEFT JOIN test_group_analytes tga ON tg.id = tga.test_group_id
LEFT JOIN analytes a ON tga.analyte_id = a.id;

COMMENT ON VIEW v_test_group_config IS 'Easy view of test group configurations with their analytes';

-- Summary comment
COMMENT ON TABLE test_group_analytes IS 'Junction table for test groups and analytes. Can be freely modified without affecting historical results.';
