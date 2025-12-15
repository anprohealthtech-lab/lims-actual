-- Migration: Intra-Lab Location Restrictions & Sample Transit System
-- Date: 2025-12-12
-- Purpose: Add location-based access control and sample transit tracking between locations

-- =============================================================================
-- PART 1: Add location tracking fields to samples table
-- =============================================================================

-- Add collected_at_location_id - where sample was collected
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'samples' AND column_name = 'collected_at_location_id'
  ) THEN
    ALTER TABLE samples ADD COLUMN collected_at_location_id uuid REFERENCES locations(id);
    COMMENT ON COLUMN samples.collected_at_location_id IS 'Location where the sample was collected';
  END IF;
END $$;

-- Add current_location_id - where sample is currently
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'samples' AND column_name = 'current_location_id'
  ) THEN
    ALTER TABLE samples ADD COLUMN current_location_id uuid REFERENCES locations(id);
    COMMENT ON COLUMN samples.current_location_id IS 'Current location of the sample';
  END IF;
END $$;

-- Add destination_location_id - main processing center destination
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'samples' AND column_name = 'destination_location_id'
  ) THEN
    ALTER TABLE samples ADD COLUMN destination_location_id uuid REFERENCES locations(id);
    COMMENT ON COLUMN samples.destination_location_id IS 'Destination processing center for the sample';
  END IF;
END $$;

-- Add transit_status to samples for quick filtering
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'samples' AND column_name = 'transit_status'
  ) THEN
    ALTER TABLE samples ADD COLUMN transit_status text DEFAULT 'at_collection_point'
      CHECK (transit_status IN ('at_collection_point', 'pending_dispatch', 'in_transit', 'received_at_lab', 'processing'));
    COMMENT ON COLUMN samples.transit_status IS 'Current transit status for intra-lab tracking';
  END IF;
END $$;

-- =============================================================================
-- PART 2: Add location fields to orders table (if not tracking at sample level)
-- =============================================================================

-- Add collected_at_location_id to orders
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'collected_at_location_id'
  ) THEN
    ALTER TABLE orders ADD COLUMN collected_at_location_id uuid REFERENCES locations(id);
    COMMENT ON COLUMN orders.collected_at_location_id IS 'Location where the order samples were collected';
  END IF;
END $$;

-- Add transit_status to orders for simple tracking
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'transit_status'
  ) THEN
    ALTER TABLE orders ADD COLUMN transit_status text DEFAULT NULL
      CHECK (transit_status IS NULL OR transit_status IN ('at_collection_point', 'pending_dispatch', 'in_transit', 'received_at_lab', 'processing'));
    COMMENT ON COLUMN orders.transit_status IS 'Transit status for orders collected at remote locations';
  END IF;
END $$;

-- =============================================================================
-- PART 3: Create sample_transits table for detailed transit tracking
-- =============================================================================

CREATE TABLE IF NOT EXISTS sample_transits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_id uuid NOT NULL REFERENCES labs(id),
  
  -- What is being transferred (can be sample or order level)
  sample_id text REFERENCES samples(id),
  order_id uuid REFERENCES orders(id),
  
  -- Transit route
  from_location_id uuid NOT NULL REFERENCES locations(id),
  to_location_id uuid NOT NULL REFERENCES locations(id),
  
  -- Status tracking (mirrors outsourced pattern)
  status text NOT NULL DEFAULT 'pending_dispatch'
    CHECK (status IN ('pending_dispatch', 'awaiting_pickup', 'in_transit', 'delivered', 'received', 'issue_reported')),
  
  -- Dispatch details
  tracking_barcode text,
  dispatched_at timestamptz,
  dispatched_by uuid REFERENCES users(id),
  dispatch_notes text,
  
  -- Pickup details (for courier/logistics)
  picked_up_at timestamptz,
  picked_up_by text, -- Could be external courier name
  
  -- Delivery/Receipt details
  delivered_at timestamptz,
  received_at timestamptz,
  received_by uuid REFERENCES users(id),
  receipt_notes text,
  
  -- Issue tracking
  issue_reported_at timestamptz,
  issue_reported_by uuid REFERENCES users(id),
  issue_description text,
  issue_resolved_at timestamptz,
  issue_resolution text,
  
  -- Temperature/condition tracking (optional)
  temperature_at_dispatch numeric,
  temperature_at_receipt numeric,
  condition_at_receipt text CHECK (condition_at_receipt IS NULL OR condition_at_receipt IN ('good', 'acceptable', 'damaged', 'rejected')),
  
  -- Metadata
  batch_id uuid, -- For grouping multiple samples in one transit
  priority text DEFAULT 'normal' CHECK (priority IN ('urgent', 'high', 'normal', 'low')),
  estimated_arrival_at timestamptz,
  
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Indexes for sample_transits
CREATE INDEX IF NOT EXISTS idx_sample_transits_lab_id ON sample_transits(lab_id);
CREATE INDEX IF NOT EXISTS idx_sample_transits_status ON sample_transits(status);
CREATE INDEX IF NOT EXISTS idx_sample_transits_from_location ON sample_transits(from_location_id);
CREATE INDEX IF NOT EXISTS idx_sample_transits_to_location ON sample_transits(to_location_id);
CREATE INDEX IF NOT EXISTS idx_sample_transits_sample_id ON sample_transits(sample_id);
CREATE INDEX IF NOT EXISTS idx_sample_transits_order_id ON sample_transits(order_id);
CREATE INDEX IF NOT EXISTS idx_sample_transits_batch_id ON sample_transits(batch_id);
CREATE INDEX IF NOT EXISTS idx_sample_transits_tracking_barcode ON sample_transits(tracking_barcode);

-- =============================================================================
-- PART 4: Add location restriction settings
-- =============================================================================

-- Add enforce_location_restrictions to labs table (lab-wide toggle)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'labs' AND column_name = 'enforce_location_restrictions'
  ) THEN
    ALTER TABLE labs ADD COLUMN enforce_location_restrictions boolean NOT NULL DEFAULT false;
    COMMENT ON COLUMN labs.enforce_location_restrictions IS 'When true, users only see orders/patients from their assigned locations';
  END IF;
END $$;

-- Add default_processing_location_id to labs (main processing center)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'labs' AND column_name = 'default_processing_location_id'
  ) THEN
    ALTER TABLE labs ADD COLUMN default_processing_location_id uuid REFERENCES locations(id);
    COMMENT ON COLUMN labs.default_processing_location_id IS 'Main processing center where samples are sent for analysis';
  END IF;
END $$;

-- Add can_view_all_locations to user_centers (override for specific users like admins)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_centers' AND column_name = 'can_view_all_locations'
  ) THEN
    ALTER TABLE user_centers ADD COLUMN can_view_all_locations boolean NOT NULL DEFAULT false;
    COMMENT ON COLUMN user_centers.can_view_all_locations IS 'Override: user can see all locations even if lab enforces restrictions';
  END IF;
END $$;

-- Add is_collection_center to locations (to distinguish from processing centers)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'locations' AND column_name = 'is_collection_center'
  ) THEN
    ALTER TABLE locations ADD COLUMN is_collection_center boolean NOT NULL DEFAULT true;
    COMMENT ON COLUMN locations.is_collection_center IS 'True for collection points, false for processing-only centers';
  END IF;
END $$;

-- Add is_processing_center to locations
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'locations' AND column_name = 'is_processing_center'
  ) THEN
    ALTER TABLE locations ADD COLUMN is_processing_center boolean NOT NULL DEFAULT false;
    COMMENT ON COLUMN locations.is_processing_center IS 'True for main lab/processing centers that receive samples';
  END IF;
END $$;

-- Add can_receive_samples to locations (for transit destination validation)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'locations' AND column_name = 'can_receive_samples'
  ) THEN
    ALTER TABLE locations ADD COLUMN can_receive_samples boolean NOT NULL DEFAULT true;
    COMMENT ON COLUMN locations.can_receive_samples IS 'Whether this location can be a destination for sample transit';
  END IF;
END $$;

-- =============================================================================
-- PART 5: RLS Policies for sample_transits
-- =============================================================================

ALTER TABLE sample_transits ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS "Users can view transits in their lab" ON sample_transits;
DROP POLICY IF EXISTS "Users can create transits in their lab" ON sample_transits;
DROP POLICY IF EXISTS "Users can update transits in their lab" ON sample_transits;

-- Select policy
CREATE POLICY "Users can view transits in their lab"
ON sample_transits FOR SELECT
TO authenticated
USING (
  lab_id IN (
    SELECT lab_id FROM users WHERE auth_user_id = auth.uid()
  )
);

-- Insert policy
CREATE POLICY "Users can create transits in their lab"
ON sample_transits FOR INSERT
TO authenticated
WITH CHECK (
  lab_id IN (
    SELECT lab_id FROM users WHERE auth_user_id = auth.uid()
  )
);

-- Update policy
CREATE POLICY "Users can update transits in their lab"
ON sample_transits FOR UPDATE
TO authenticated
USING (
  lab_id IN (
    SELECT lab_id FROM users WHERE auth_user_id = auth.uid()
  )
);

-- =============================================================================
-- PART 6: Trigger to update sample/order transit_status when transit is updated
-- =============================================================================

CREATE OR REPLACE FUNCTION update_sample_transit_status()
RETURNS TRIGGER AS $$
BEGIN
  -- Update sample transit_status based on transit record status
  IF NEW.sample_id IS NOT NULL THEN
    UPDATE samples
    SET 
      transit_status = CASE NEW.status
        WHEN 'pending_dispatch' THEN 'pending_dispatch'
        WHEN 'awaiting_pickup' THEN 'pending_dispatch'
        WHEN 'in_transit' THEN 'in_transit'
        WHEN 'delivered' THEN 'received_at_lab'
        WHEN 'received' THEN 'received_at_lab'
        ELSE transit_status
      END,
      current_location_id = CASE 
        WHEN NEW.status IN ('delivered', 'received') THEN NEW.to_location_id
        ELSE current_location_id
      END
    WHERE id = NEW.sample_id;
  END IF;
  
  -- Update order transit_status if tracking at order level
  IF NEW.order_id IS NOT NULL THEN
    UPDATE orders
    SET 
      transit_status = CASE NEW.status
        WHEN 'pending_dispatch' THEN 'pending_dispatch'
        WHEN 'awaiting_pickup' THEN 'pending_dispatch'
        WHEN 'in_transit' THEN 'in_transit'
        WHEN 'delivered' THEN 'received_at_lab'
        WHEN 'received' THEN 'received_at_lab'
        ELSE transit_status
      END
    WHERE id = NEW.order_id;
  END IF;
  
  -- Update the updated_at timestamp
  NEW.updated_at = now();
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_sample_transit_status ON sample_transits;
CREATE TRIGGER trigger_update_sample_transit_status
  BEFORE UPDATE ON sample_transits
  FOR EACH ROW
  EXECUTE FUNCTION update_sample_transit_status();

-- =============================================================================
-- PART 7: Helper view for location-restricted queries
-- =============================================================================

CREATE OR REPLACE VIEW v_user_accessible_locations AS
SELECT 
  u.id as user_id,
  u.auth_user_id,
  u.lab_id,
  l.enforce_location_restrictions,
  uc.location_id,
  uc.is_primary,
  COALESCE(uc.can_view_all_locations, false) as can_view_all_locations,
  loc.name as location_name,
  loc.type as location_type,
  loc.is_collection_center,
  loc.is_processing_center
FROM users u
JOIN labs l ON u.lab_id = l.id
LEFT JOIN user_centers uc ON u.id = uc.user_id
LEFT JOIN locations loc ON uc.location_id = loc.id
WHERE u.status = 'Active';

COMMENT ON VIEW v_user_accessible_locations IS 'Shows which locations each user can access based on user_centers assignments';

-- =============================================================================
-- PART 8: Backfill collected_at_location_id from location_id in orders
-- =============================================================================

-- Set collected_at_location_id = location_id for existing orders that have location_id set
UPDATE orders 
SET collected_at_location_id = location_id
WHERE location_id IS NOT NULL 
  AND collected_at_location_id IS NULL;

-- =============================================================================
-- DONE
-- =============================================================================

COMMENT ON TABLE sample_transits IS 'Tracks sample/order transit between locations within a lab (collection centers to processing centers)';
