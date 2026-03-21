export interface Booking {
  id: string;
  lab_id: string;
  account_id?: string;
  booking_source: 'b2b_portal' | 'front_desk' | 'patient_app' | 'phone_call';
  status: 'pending' | 'quoted' | 'confirmed' | 'converted' | 'cancelled';
  patient_info: {
    name: string;
    phone: string;
    age?: number;
    gender?: 'Male' | 'Female' | 'Other';
    email?: string;
  };
  test_details: Array<{
    id?: string;
    name: string;
    price?: number;
    type?: 'test' | 'profile' | 'package';
  }>;
  scheduled_at?: string;
  collection_type?: 'home_collection' | 'walk_in' | 'lab_pickup';
  home_collection_address?: {
    address: string;
    city?: string;
    pincode?: string;
    lat?: number;
    lng?: number;
  };
  b2b_client_id?: string;
  quotation_amount?: number;
  converted_order_id?: string;
  assigned_phlebo_id?: string;
  assigned_phlebo_name?: string;
  created_by?: string;
  created_at: string;
  updated_at: string;
}
