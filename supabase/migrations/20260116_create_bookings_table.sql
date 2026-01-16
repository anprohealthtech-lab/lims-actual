-- Create bookings table for the new Booking & Quotation Layer
CREATE TABLE IF NOT EXISTS bookings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lab_id UUID NOT NULL REFERENCES labs(id),
    booking_source TEXT CHECK (booking_source IN ('b2b_portal', 'front_desk', 'patient_app', 'phone_call')),
    status TEXT CHECK (status IN ('pending', 'quoted', 'confirmed', 'converted', 'cancelled')) DEFAULT 'pending',
    
    -- "Loose text for flexibility" as per user request
    patient_info JSONB, -- Stores { name, phone, age, gender, email } without strict relational constraints
    
    test_details JSONB, -- Stores array of requested tests/profiles [{ id, name, price, type }]
    
    scheduled_at TIMESTAMP WITH TIME ZONE,
    collection_type TEXT CHECK (collection_type IN ('home_collection', 'walk_in', 'lab_pickup')),
    home_collection_address JSONB, -- { address_line, city, pincode, lat, lng }
    
    b2b_client_id UUID REFERENCES accounts(id),
    quotation_amount NUMERIC,
    
    converted_order_id UUID REFERENCES orders(id),
    
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_bookings_lab_id ON bookings(lab_id);
CREATE INDEX idx_bookings_status ON bookings(status);
CREATE INDEX idx_bookings_scheduled_at ON bookings(scheduled_at);
CREATE INDEX idx_bookings_b2b_client ON bookings(b2b_client_id);

-- RLS Policies
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;

-- Allow users to view bookings belonging to their lab
CREATE POLICY "Users can view bookings from their lab" ON bookings
    FOR SELECT USING (
        lab_id IN (
            SELECT lab_id FROM users 
            WHERE id = auth.uid()
        )
    );

-- Allow users to create bookings for their lab
CREATE POLICY "Users can insert bookings for their lab" ON bookings
    FOR INSERT WITH CHECK (
        lab_id IN (
            SELECT lab_id FROM users 
            WHERE id = auth.uid()
        )
    );

-- Allow users to update bookings for their lab
CREATE POLICY "Users can update bookings for their lab" ON bookings
    FOR UPDATE USING (
        lab_id IN (
            SELECT lab_id FROM users 
            WHERE id = auth.uid()
        )
    );

-- Trigger for updated_at
CREATE TRIGGER update_bookings_updated_at
    BEFORE UPDATE ON bookings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
