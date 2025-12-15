-- Enable RLS on sample_transits
ALTER TABLE sample_transits ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any to avoid conflicts
DROP POLICY IF EXISTS "Users can view sample_transits from their lab" ON sample_transits;
DROP POLICY IF EXISTS "Users can insert sample_transits for their lab" ON sample_transits;
DROP POLICY IF EXISTS "Users can update sample_transits from their lab" ON sample_transits;
DROP POLICY IF EXISTS "Users can delete sample_transits from their lab" ON sample_transits;

-- Create policy for viewing sample_transits
CREATE POLICY "Users can view sample_transits from their lab"
ON sample_transits FOR SELECT
USING (
  lab_id IN (
    SELECT lab_id FROM users WHERE auth_user_id = auth.uid()
  )
);

-- Create policy for inserting sample_transits
CREATE POLICY "Users can insert sample_transits for their lab"
ON sample_transits FOR INSERT
WITH CHECK (
  lab_id IN (
    SELECT lab_id FROM users WHERE auth_user_id = auth.uid()
  )
);

-- Create policy for updating sample_transits
CREATE POLICY "Users can update sample_transits from their lab"
ON sample_transits FOR UPDATE
USING (
  lab_id IN (
    SELECT lab_id FROM users WHERE auth_user_id = auth.uid()
  )
);

-- Create policy for deleting sample_transits
CREATE POLICY "Users can delete sample_transits from their lab"
ON sample_transits FOR DELETE
USING (
  lab_id IN (
    SELECT lab_id FROM users WHERE auth_user_id = auth.uid()
  )
);
