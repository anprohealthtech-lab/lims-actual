-- Add phlebotomist assignment to bookings table
ALTER TABLE bookings
    ADD COLUMN IF NOT EXISTS assigned_phlebo_id UUID REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS assigned_phlebo_name TEXT;

CREATE INDEX IF NOT EXISTS idx_bookings_phlebo ON bookings(assigned_phlebo_id);
