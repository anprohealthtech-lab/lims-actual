// Purpose: Initialize payment with payment gateway (CCAvenue, Razorpay)
// Route: POST /initiate-payment
// Body:
// {
//   "account_id": "uuid",
//   "lab_id": "uuid",
//   "amount": 10000,
//   "purpose": "credit_topup" | "order_payment" | "shortfall_payment",
//   "pending_order_id": "uuid" (optional),
//   "order_data": {} (optional - for pending orders),
//   "provider": "ccavenue" | "razorpay" (optional, uses default),
//   "return_url": "https://...",
//   "cancel_url": "https://..."
// }

import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { crypto } from "https://deno.land/std@0.208.0/crypto/mod.ts";
import { encodeHex } from "https://deno.land/std@0.208.0/encoding/hex.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface InitiatePaymentRequest {
  account_id: string;
  lab_id: string;
  amount: number;
  purpose: 'credit_topup' | 'order_payment' | 'shortfall_payment' | 'advance_payment';
  pending_order_id?: string;
  order_data?: Record<string, unknown>;
  provider?: string;
  return_url?: string;
  cancel_url?: string;
}

// CCAvenue encryption helper
async function encryptCCAvenue(plainText: string, workingKey: string): Promise<string> {
  // CCAvenue uses AES-128-CBC encryption
  // Key is MD5 hash of working key
  const encoder = new TextEncoder();

  // Generate MD5 hash of working key
  const keyData = encoder.encode(workingKey);
  const hashBuffer = await crypto.subtle.digest('MD5', keyData);
  const key = new Uint8Array(hashBuffer);

  // CCAvenue's integration kits use a fixed IV: 00 01 02 ... 0f.
  const iv = new Uint8Array(16);
  for (let i = 0; i < iv.length; i++) iv[i] = i;

  // Import the key
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'AES-CBC' },
    false,
    ['encrypt']
  );

  // Pad the plaintext (PKCS7 padding)
  const blockSize = 16;
  const plainBytes = encoder.encode(plainText);
  const paddingLength = blockSize - (plainBytes.length % blockSize);
  const paddedPlain = new Uint8Array(plainBytes.length + paddingLength);
  paddedPlain.set(plainBytes);
  paddedPlain.fill(paddingLength, plainBytes.length);

  // Encrypt
  const encryptedBuffer = await crypto.subtle.encrypt(
    { name: 'AES-CBC', iv },
    cryptoKey,
    paddedPlain
  );

  // Return as hex string
  return encodeHex(new Uint8Array(encryptedBuffer));
}

// Generate unique order ID
function generateOrderId(prefix: string = 'PAY'): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `${prefix}${timestamp}${random}`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body: InitiatePaymentRequest = await req.json();
    const {
      account_id,
      lab_id,
      amount,
      purpose = 'credit_topup',
      pending_order_id,
      order_data,
      provider: requestedProvider,
      return_url,
      cancel_url
    } = body;

    // Validate required fields
    if (!account_id || !lab_id || !amount) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: account_id, lab_id, amount' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (amount <= 0) {
      return new Response(
        JSON.stringify({ error: 'Amount must be greater than 0' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    );

    console.log('[INITIATE-PAYMENT] Starting payment:', { account_id, lab_id, amount, purpose });

    // Get account details
    const { data: account, error: accountError } = await supabase
      .from('accounts')
      .select('id, name, billing_email, billing_phone')
      .eq('id', account_id)
      .eq('lab_id', lab_id)
      .single();

    if (accountError || !account) {
      return new Response(
        JSON.stringify({ error: 'Account not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get payment gateway configuration
    let gatewayQuery = supabase
      .from('lab_payment_gateways')
      .select('*')
      .eq('lab_id', lab_id)
      .eq('is_active', true);

    if (requestedProvider) {
      gatewayQuery = gatewayQuery.eq('provider', requestedProvider);
    } else {
      gatewayQuery = gatewayQuery.eq('is_default', true);
    }

    const { data: gateways, error: gatewayError } = await gatewayQuery.limit(1);

    if (gatewayError || !gateways?.length) {
      // Try to get any active gateway if no default
      const { data: anyGateway } = await supabase
        .from('lab_payment_gateways')
        .select('*')
        .eq('lab_id', lab_id)
        .eq('is_active', true)
        .limit(1);

      if (!anyGateway?.length) {
        return new Response(
          JSON.stringify({ error: 'No active payment gateway configured for this lab' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      gateways?.push(anyGateway[0]);
    }

    const gateway = gateways![0];
    const provider = gateway.provider;
    const credentials = gateway.credentials_encrypted || {};
    const gatewayOrderId = generateOrderId(provider.toUpperCase().substring(0, 3));

    console.log('[INITIATE-PAYMENT] Using gateway:', { provider, gateway_id: gateway.id });

    // Create payment attempt record
    const { data: paymentAttempt, error: attemptError } = await supabase
      .from('b2b_payment_attempts')
      .insert({
        lab_id,
        account_id,
        pending_order_id,
        gateway_id: gateway.id,
        provider,
        gateway_order_id: gatewayOrderId,
        amount,
        currency: gateway.default_currency || 'INR',
        payment_purpose: purpose,
        status: 'initiated',
        idempotency_key: `${account_id}-${Date.now()}`,
        raw_request: body
      })
      .select()
      .single();

    if (attemptError) {
      console.error('[INITIATE-PAYMENT] Failed to create payment attempt:', attemptError);
      throw new Error('Failed to create payment record');
    }

    // If there is B2B booking/order data, preserve it across redirect-based gateways.
    if (order_data && (purpose === 'order_payment' || purpose === 'shortfall_payment')) {
      const { error: pendingError } = await supabase
        .from('b2b_pending_orders')
        .insert({
          lab_id,
          account_id,
          order_data,
          order_amount: order_data.order_amount || amount,
          available_credit: Math.max(0, Number(order_data.order_amount || amount) - amount),
          shortfall_amount: amount,
          payment_attempt_id: paymentAttempt.id,
          status: 'pending_payment'
        });

      if (pendingError) {
        console.warn('[INITIATE-PAYMENT] Failed to create pending order:', pendingError);
      }
    }

    let responseData: Record<string, unknown>;

    // Handle different payment providers
    if (provider === 'ccavenue') {
      responseData = await handleCCAvenue(
        gateway,
        credentials,
        paymentAttempt,
        account,
        amount,
        return_url || gateway.redirect_url,
        cancel_url || gateway.cancel_url
      );
    } else if (provider === 'razorpay') {
      responseData = await handleRazorpay(
        gateway,
        credentials,
        paymentAttempt,
        account,
        amount
      );
    } else {
      return new Response(
        JSON.stringify({ error: `Unsupported payment provider: ${provider}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Update payment attempt with request details
    await supabase
      .from('b2b_payment_attempts')
      .update({
        status: 'pending',
        raw_request: { ...body, gateway_response: responseData }
      })
      .eq('id', paymentAttempt.id);

    console.log('[INITIATE-PAYMENT] Payment initiated successfully:', {
      payment_id: paymentAttempt.id,
      gateway_order_id: gatewayOrderId
    });

    return new Response(
      JSON.stringify({
        success: true,
        payment_id: paymentAttempt.id,
        gateway_order_id: gatewayOrderId,
        provider,
        ...responseData
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[INITIATE-PAYMENT] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// CCAvenue payment handler
async function handleCCAvenue(
  gateway: Record<string, unknown>,
  credentials: Record<string, unknown>,
  paymentAttempt: Record<string, unknown>,
  account: Record<string, unknown>,
  amount: number,
  redirectUrl?: string,
  cancelUrl?: string
): Promise<Record<string, unknown>> {
  const merchantId = credentials.merchant_id as string;
  const accessCode = credentials.access_code as string;
  const workingKey = credentials.working_key as string;

  if (!merchantId || !accessCode || !workingKey) {
    throw new Error('CCAvenue credentials not properly configured');
  }

  const environment = gateway.environment as string;
  const baseUrl = environment === 'production'
    ? 'https://secure.ccavenue.com'
    : 'https://test.ccavenue.com';

  // Build CCAvenue request parameters
  const orderParams: Record<string, string> = {
    merchant_id: merchantId,
    order_id: paymentAttempt.gateway_order_id as string,
    currency: 'INR',
    amount: amount.toFixed(2),
    redirect_url: redirectUrl || '',
    cancel_url: cancelUrl || '',
    language: 'EN',
    billing_name: account.name as string || 'B2B Client',
    billing_address: 'NA',
    billing_city: 'NA',
    billing_state: 'NA',
    billing_zip: '000000',
    billing_country: 'India',
    billing_email: account.billing_email as string || '',
    billing_tel: account.billing_phone as string || '',
    merchant_param1: paymentAttempt.id as string, // Our payment attempt ID
    merchant_param2: paymentAttempt.account_id as string,
    merchant_param3: paymentAttempt.payment_purpose as string || 'credit_topup',
  };

  // Convert to query string
  const queryString = Object.entries(orderParams)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');

  // Encrypt the data
  const encryptedData = await encryptCCAvenue(queryString, workingKey);

  return {
    gateway_url: `${baseUrl}/transaction/transaction.do?command=initiateTransaction`,
    form_method: 'POST',
    form_data: {
      encRequest: encryptedData,
      access_code: accessCode
    },
    redirect_required: true
  };
}

// Razorpay payment handler
async function handleRazorpay(
  gateway: Record<string, unknown>,
  credentials: Record<string, unknown>,
  paymentAttempt: Record<string, unknown>,
  account: Record<string, unknown>,
  amount: number
): Promise<Record<string, unknown>> {
  const keyId = credentials.key_id as string;
  const keySecret = credentials.key_secret as string;

  if (!keyId || !keySecret) {
    throw new Error('Razorpay credentials not properly configured');
  }

  // Create Razorpay order
  const razorpayResponse = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Basic ' + btoa(`${keyId}:${keySecret}`)
    },
    body: JSON.stringify({
      amount: Math.round(amount * 100), // Razorpay expects amount in paise
      currency: 'INR',
      receipt: paymentAttempt.gateway_order_id as string,
      notes: {
        payment_id: paymentAttempt.id as string,
        account_id: paymentAttempt.account_id as string,
        purpose: paymentAttempt.payment_purpose as string
      }
    })
  });

  if (!razorpayResponse.ok) {
    const error = await razorpayResponse.text();
    console.error('[INITIATE-PAYMENT] Razorpay error:', error);
    throw new Error('Failed to create Razorpay order');
  }

  const razorpayOrder = await razorpayResponse.json();

  return {
    razorpay_order_id: razorpayOrder.id,
    razorpay_key_id: keyId,
    amount: amount,
    currency: 'INR',
    name: 'Credit Payment',
    description: `Payment for ${account.name}`,
    prefill: {
      name: account.name,
      email: account.billing_email,
      contact: account.billing_phone
    },
    notes: {
      payment_id: paymentAttempt.id,
      account_id: paymentAttempt.account_id
    },
    redirect_required: false // Razorpay uses client-side checkout
  };
}
