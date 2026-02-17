import { supabase } from '../config/supabase';

export interface CreateOrderWithPaymentData {
  patient_id: string;
  test_ids: string[];
  referring_doctor_id?: string;
  location_id?: string;
  discount_type?: 'percentage' | 'fixed';
  discount_value?: number;
  payment_method?: 'cash' | 'card' | 'upi' | 'online' | 'netbanking';
  amount_paid?: number;
  notes?: string;
  // Outsourcing config: { test_id: outsourced_lab_id | 'inhouse' }
  test_outsourcing?: Record<string, string>;
  // Patient context for AI reference range resolution
  patient_context?: Record<string, any>;
}

export interface OrderCreationResponse {
  success: boolean;
  order_id: string;
  invoice_id?: string;
  payment_id?: string;
  subtotal: number;
  discount_amount: number;
  final_amount: number;
  amount_paid: number;
  balance_due: number;
}

/**
 * Create order with optional discount and payment collection
 * Auto-generates invoice and payment record
 */
export async function createOrderWithPayment(
  orderData: CreateOrderWithPaymentData
): Promise<OrderCreationResponse> {
  const { data, error } = await supabase.functions.invoke('create-order-with-payment', {
    body: orderData,
  });

  if (error) {
    console.error('Order creation error:', error);
    throw new Error(error.message || 'Failed to create order');
  }

  if (!data || !data.success) {
    throw new Error(data?.error || 'Order creation failed');
  }

  return data;
}

/**
 * Calculate discount amount based on type and value
 */
export function calculateDiscount(
  subtotal: number,
  discountType: 'percentage' | 'fixed' | null,
  discountValue: number | null
): number {
  if (!discountType || !discountValue) return 0;

  if (discountType === 'percentage') {
    return (subtotal * discountValue) / 100;
  } else {
    return Math.min(discountValue, subtotal); // Can't discount more than subtotal
  }
}

/**
 * Calculate final amount after discount
 */
export function calculateFinalAmount(
  subtotal: number,
  discountType: 'percentage' | 'fixed' | null,
  discountValue: number | null
): number {
  const discount = calculateDiscount(subtotal, discountType, discountValue);
  return subtotal - discount;
}
