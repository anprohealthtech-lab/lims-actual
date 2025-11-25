-- =====================================================
-- ANALYTE SYNC SYSTEM FOR MULTI-LAB ARCHITECTURE
-- =====================================================
-- Migration: 20250125_analyte_sync_system.sql
-- Description: Implements automatic sync between analytes, lab_analytes, and test_group_analytes
-- Author: LIMS v2 Team
-- Date: 2025-01-25

-- DROP existing triggers if any
DROP TRIGGER IF EXISTS trigger_sync_lab_analyte_on_test_group_link ON test_group_analytes;
DROP TRIGGER IF EXISTS trigger_sync_lab_analyte_on_analyte_update ON analytes;
DROP FUNCTION IF EXISTS sync_lab_analyte_from_global();
DROP FUNCTION IF EXISTS sync_lab_analytes_on_analyte_update();
DROP FUNCTION IF EXISTS bulk_sync_lab_analytes_for_existing_test_groups();

-- =====================================================
-- FUNCTION 1: Auto-create lab_analyte when test group links to analyte
-- =====================================================

CREATE OR REPLACE FUNCTION sync_lab_analyte_from_global()
RETURNS TRIGGER AS $$
DECLARE
  v_lab_id UUID;
  v_analyte_record RECORD;
  v_existing_count INT;
BEGIN
  -- Get lab_id from test_groups table
  SELECT test_groups.lab_id INTO v_lab_id
  FROM test_groups
  WHERE test_groups.id = NEW.test_group_id;
  
  IF v_lab_id IS NULL THEN
    RAISE WARNING 'Test group % has no lab_id, skipping lab_analytes sync', NEW.test_group_id;
    RETURN NEW;
  END IF;
  
  -- Check if lab_analyte already exists (FIX: Qualify column names)
  SELECT COUNT(*) INTO v_existing_count
  FROM lab_analytes
  WHERE lab_analytes.lab_id = v_lab_id 
    AND lab_analytes.analyte_id = NEW.analyte_id;
  
  -- If already exists, skip creation
  IF v_existing_count > 0 THEN
    RAISE NOTICE 'lab_analytes record already exists for lab % and analyte %', v_lab_id, NEW.analyte_id;
    RETURN NEW;
  END IF;
  
  -- Fetch global analyte data
  SELECT * INTO v_analyte_record
  FROM analytes
  WHERE analytes.id = NEW.analyte_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Analyte % not found in global analytes table', NEW.analyte_id;
  END IF;
  
  -- Create lab_analytes record by copying from global analyte
  INSERT INTO lab_analytes (
    id,
    lab_id,
    analyte_id,
    is_active,
    visible,
    -- Copy global values as defaults (can be overridden later)
    name,
    unit,
    reference_range,
    reference_range_male,
    reference_range_female,
    low_critical,
    high_critical,
    critical_low,
    critical_high,
    interpretation_low,
    interpretation_normal,
    interpretation_high,
    created_at,
    updated_at
  ) VALUES (
    gen_random_uuid(),
    v_lab_id,
    NEW.analyte_id,
    v_analyte_record.is_active,
    true, -- visible by default
    v_analyte_record.name,
    v_analyte_record.unit,
    v_analyte_record.reference_range,
    v_analyte_record.reference_range_male,
    v_analyte_record.reference_range_female,
    v_analyte_record.low_critical,
    v_analyte_record.high_critical,
    v_analyte_record.low_critical,
    v_analyte_record.high_critical,
    v_analyte_record.interpretation_low,
    v_analyte_record.interpretation_normal,
    v_analyte_record.interpretation_high,
    NOW(),
    NOW()
  );
  
  RAISE NOTICE 'Created lab_analytes record for lab % and analyte % (%)', 
    v_lab_id, NEW.analyte_id, v_analyte_record.name;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- TRIGGER 1: Auto-sync when test group links to analyte
-- =====================================================

CREATE TRIGGER trigger_sync_lab_analyte_on_test_group_link
AFTER INSERT ON test_group_analytes
FOR EACH ROW
EXECUTE FUNCTION sync_lab_analyte_from_global();

-- =====================================================
-- FUNCTION 2: Sync lab_analytes when global analyte updates
-- Only updates fields that haven't been customized at lab level
-- =====================================================

CREATE OR REPLACE FUNCTION sync_lab_analytes_on_analyte_update()
RETURNS TRIGGER AS $$
BEGIN
  -- Update all lab_analytes that reference this global analyte
  -- Only update fields that are NOT lab-specific (i.e., where lab_specific_* fields are NULL)
  
  UPDATE lab_analytes
  SET
    -- Update name only if not customized
    name = CASE 
      WHEN lab_specific_name IS NULL THEN NEW.name 
      ELSE name 
    END,
    
    -- Update unit only if not customized
    unit = CASE 
      WHEN lab_specific_unit IS NULL THEN NEW.unit 
      ELSE unit 
    END,
    
    -- Update reference ranges only if not customized
    reference_range = CASE 
      WHEN lab_specific_reference_range IS NULL THEN NEW.reference_range 
      ELSE reference_range 
    END,
    
    reference_range_male = CASE 
      WHEN lab_specific_reference_range IS NULL THEN NEW.reference_range_male 
      ELSE reference_range_male 
    END,
    
    reference_range_female = CASE 
      WHEN lab_specific_reference_range IS NULL THEN NEW.reference_range_female 
      ELSE reference_range_female 
    END,
    
    -- Update critical values only if not customized
    low_critical = CASE 
      WHEN lab_specific_interpretation_low IS NULL THEN NEW.low_critical 
      ELSE low_critical 
    END,
    
    high_critical = CASE 
      WHEN lab_specific_interpretation_high IS NULL THEN NEW.high_critical 
      ELSE high_critical 
    END,
    
    critical_low = CASE 
      WHEN lab_specific_interpretation_low IS NULL THEN NEW.low_critical 
      ELSE critical_low 
    END,
    
    critical_high = CASE 
      WHEN lab_specific_interpretation_high IS NULL THEN NEW.high_critical 
      ELSE critical_high 
    END,
    
    -- Update interpretations only if not customized
    interpretation_low = CASE 
      WHEN lab_specific_interpretation_low IS NULL THEN NEW.interpretation_low 
      ELSE interpretation_low 
    END,
    
    interpretation_normal = CASE 
      WHEN lab_specific_interpretation_normal IS NULL THEN NEW.interpretation_normal 
      ELSE interpretation_normal 
    END,
    
    interpretation_high = CASE 
      WHEN lab_specific_interpretation_high IS NULL THEN NEW.interpretation_high 
      ELSE interpretation_high 
    END,
    
    -- Always sync is_active status
    is_active = NEW.is_active,
    
    updated_at = NOW()
    
  WHERE lab_analytes.analyte_id = NEW.id;
  
  -- Log the sync
  RAISE NOTICE 'Synced % lab_analytes records for global analyte % (%)',
    (SELECT COUNT(*) FROM lab_analytes WHERE lab_analytes.analyte_id = NEW.id),
    NEW.id,
    NEW.name;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- TRIGGER 2: Sync lab_analytes when global analyte updates
-- =====================================================

CREATE TRIGGER trigger_sync_lab_analyte_on_analyte_update
AFTER UPDATE ON analytes
FOR EACH ROW
WHEN (
  -- Only trigger when actual data fields change (not just updated_at)
  OLD.name IS DISTINCT FROM NEW.name OR
  OLD.unit IS DISTINCT FROM NEW.unit OR
  OLD.reference_range IS DISTINCT FROM NEW.reference_range OR
  OLD.reference_range_male IS DISTINCT FROM NEW.reference_range_male OR
  OLD.reference_range_female IS DISTINCT FROM NEW.reference_range_female OR
  OLD.low_critical IS DISTINCT FROM NEW.low_critical OR
  OLD.high_critical IS DISTINCT FROM NEW.high_critical OR
  OLD.interpretation_low IS DISTINCT FROM NEW.interpretation_low OR
  OLD.interpretation_normal IS DISTINCT FROM NEW.interpretation_normal OR
  OLD.interpretation_high IS DISTINCT FROM NEW.interpretation_high OR
  OLD.is_active IS DISTINCT FROM NEW.is_active
)
EXECUTE FUNCTION sync_lab_analytes_on_analyte_update();

-- =====================================================
-- FUNCTION 3: Bulk sync existing test groups (one-time migration)
-- =====================================================

CREATE OR REPLACE FUNCTION bulk_sync_lab_analytes_for_existing_test_groups()
RETURNS TABLE(
  test_group_id UUID,
  test_group_name TEXT,
  analyte_id UUID,
  analyte_name TEXT,
  lab_id UUID,
  action TEXT
) AS $$
DECLARE
  v_record RECORD;
  v_lab_id UUID;
  v_analyte_record RECORD;
  v_existing_count INT;
BEGIN
  -- Loop through all test_group_analytes
  FOR v_record IN 
    SELECT 
      tga.id,
      tga.test_group_id,
      tga.analyte_id,
      tg.name as test_group_name,
      tg.lab_id,
      a.name as analyte_name
    FROM test_group_analytes tga
    JOIN test_groups tg ON tg.id = tga.test_group_id
    JOIN analytes a ON a.id = tga.analyte_id
    WHERE tg.lab_id IS NOT NULL
  LOOP
    v_lab_id := v_record.lab_id;
    
    -- Check if lab_analyte already exists (FIX: Qualify column names to avoid ambiguity)
    SELECT COUNT(*) INTO v_existing_count
    FROM lab_analytes
    WHERE lab_analytes.lab_id = v_lab_id 
      AND lab_analytes.analyte_id = v_record.analyte_id;
    
    IF v_existing_count > 0 THEN
      -- Already exists, skip
      test_group_id := v_record.test_group_id;
      test_group_name := v_record.test_group_name;
      analyte_id := v_record.analyte_id;
      analyte_name := v_record.analyte_name;
      lab_id := v_lab_id;
      action := 'SKIPPED (already exists)';
      RETURN NEXT;
      CONTINUE;
    END IF;
    
    -- Fetch global analyte data
    SELECT * INTO v_analyte_record
    FROM analytes
    WHERE analytes.id = v_record.analyte_id;
    
    IF NOT FOUND THEN
      test_group_id := v_record.test_group_id;
      test_group_name := v_record.test_group_name;
      analyte_id := v_record.analyte_id;
      analyte_name := v_record.analyte_name;
      lab_id := v_lab_id;
      action := 'ERROR (analyte not found)';
      RETURN NEXT;
      CONTINUE;
    END IF;
    
    -- Create lab_analytes record
    BEGIN
      INSERT INTO lab_analytes (
        id,
        lab_id,
        analyte_id,
        is_active,
        visible,
        name,
        unit,
        reference_range,
        reference_range_male,
        reference_range_female,
        low_critical,
        high_critical,
        critical_low,
        critical_high,
        interpretation_low,
        interpretation_normal,
        interpretation_high,
        created_at,
        updated_at
      ) VALUES (
        gen_random_uuid(),
        v_lab_id,
        v_record.analyte_id,
        v_analyte_record.is_active,
        true,
        v_analyte_record.name,
        v_analyte_record.unit,
        v_analyte_record.reference_range,
        v_analyte_record.reference_range_male,
        v_analyte_record.reference_range_female,
        v_analyte_record.low_critical,
        v_analyte_record.high_critical,
        v_analyte_record.low_critical,
        v_analyte_record.high_critical,
        v_analyte_record.interpretation_low,
        v_analyte_record.interpretation_normal,
        v_analyte_record.interpretation_high,
        NOW(),
        NOW()
      );
      
      test_group_id := v_record.test_group_id;
      test_group_name := v_record.test_group_name;
      analyte_id := v_record.analyte_id;
      analyte_name := v_record.analyte_name;
      lab_id := v_lab_id;
      action := 'CREATED';
      RETURN NEXT;
      
    EXCEPTION WHEN OTHERS THEN
      test_group_id := v_record.test_group_id;
      test_group_name := v_record.test_group_name;
      analyte_id := v_record.analyte_id;
      analyte_name := v_record.analyte_name;
      lab_id := v_lab_id;
      action := 'ERROR: ' || SQLERRM;
      RETURN NEXT;
    END;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- COMMENTS: Document the sync system
-- =====================================================

COMMENT ON FUNCTION sync_lab_analyte_from_global() IS 
'Auto-creates lab_analytes record when a test group is linked to a global analyte. 
Ensures lab-level differentiation of analyte data.';

COMMENT ON FUNCTION sync_lab_analytes_on_analyte_update() IS 
'Propagates updates from global analytes to lab_analytes, preserving lab-specific customizations.
Only updates fields where lab_specific_* columns are NULL.';

COMMENT ON FUNCTION bulk_sync_lab_analytes_for_existing_test_groups() IS 
'One-time migration function to create missing lab_analytes for existing test_group_analytes mappings.
Returns a table showing the sync status for each test group.';

COMMENT ON TRIGGER trigger_sync_lab_analyte_on_test_group_link ON test_group_analytes IS 
'Automatically creates lab_analytes entry when a test group is linked to an analyte';

COMMENT ON TRIGGER trigger_sync_lab_analyte_on_analyte_update ON analytes IS 
'Propagates changes from global analytes to all lab_analytes, preserving lab customizations';
