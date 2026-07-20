-- Phlebo collection journey tracking + patient-app home collection bookings
-- 1. Journey statuses (assigned -> started -> reached -> collected) with timestamps
-- 2. Live location columns updated by the phlebo's browser while en route
-- 3. patient_id link + RLS so patient portal users can create/view their own bookings
-- 4. RLS so phlebotomists can see/update their assigned bookings (matched by email,
--    since public.users.id may differ from auth.uid())

ALTER TABLE bookings
    ADD COLUMN IF NOT EXISTS patient_id UUID REFERENCES patients(id),
    ADD COLUMN IF NOT EXISTS collection_status TEXT CHECK (collection_status IN ('assigned', 'started', 'reached', 'collected')),
    ADD COLUMN IF NOT EXISTS collection_started_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS collection_reached_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS collection_collected_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS phlebo_last_lat DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS phlebo_last_lng DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS phlebo_location_updated_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_bookings_patient_id ON bookings(patient_id);
CREATE INDEX IF NOT EXISTS idx_bookings_collection_status ON bookings(collection_status);

-- Patient portal users (auth user_metadata.role = 'patient') can create
-- home-collection requests for themselves only
DROP POLICY IF EXISTS "Patients can insert own bookings" ON bookings;
CREATE POLICY "Patients can insert own bookings" ON bookings
    FOR INSERT WITH CHECK (
        (auth.jwt() -> 'user_metadata' ->> 'role') = 'patient'
        AND booking_source = 'patient_app'
        AND patient_id = ((auth.jwt() -> 'user_metadata' ->> 'patient_id'))::uuid
        AND lab_id = ((auth.jwt() -> 'user_metadata' ->> 'lab_id'))::uuid
    );

DROP POLICY IF EXISTS "Patients can view own bookings" ON bookings;
CREATE POLICY "Patients can view own bookings" ON bookings
    FOR SELECT USING (
        (auth.jwt() -> 'user_metadata' ->> 'role') = 'patient'
        AND patient_id = ((auth.jwt() -> 'user_metadata' ->> 'patient_id'))::uuid
    );

-- Phlebotomists can view and update bookings assigned to them.
-- Matched via email because public.users.id is not guaranteed to equal auth.uid().
DROP POLICY IF EXISTS "Phlebos can view assigned bookings" ON bookings;
CREATE POLICY "Phlebos can view assigned bookings" ON bookings
    FOR SELECT USING (
        assigned_phlebo_id IN (SELECT id FROM users WHERE email = auth.email())
    );

DROP POLICY IF EXISTS "Phlebos can update assigned bookings" ON bookings;
CREATE POLICY "Phlebos can update assigned bookings" ON bookings
    FOR UPDATE USING (
        assigned_phlebo_id IN (SELECT id FROM users WHERE email = auth.email())
    )
    WITH CHECK (
        assigned_phlebo_id IN (SELECT id FROM users WHERE email = auth.email())
    );
