import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface OrderRequest {
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
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    );

    // Get authenticated user
    const {
      data: { user },
      error: userError,
    } = await supabaseClient.auth.getUser();

    if (userError || !user) {
      throw new Error('Unauthorized');
    }

    // Parse request
    const orderData: OrderRequest = await req.json();

    console.log('Creating order with payment:', orderData);

    // Validate required fields
    if (!orderData.patient_id || !orderData.test_ids || orderData.test_ids.length === 0) {
      throw new Error('patient_id and test_ids are required');
    }

    // Get user's lab_id
    const { data: userData, error: labError } = await supabaseClient
      .from('users')
      .select('lab_id')
      .eq('id', user.id)
      .single();

    if (labError || !userData) {
      throw new Error('Could not fetch user lab');
    }

    const labId = userData.lab_id;

    // Fetch test groups with base prices
    const { data: tests, error: testsError } = await supabaseClient
      .from('test_groups')
      .select('id, name, price')
      .in('id', orderData.test_ids);

    if (testsError || !tests || tests.length === 0) {
      throw new Error('Invalid test IDs');
    }

    // If location specified, fetch location-specific prices and location details
    let locationPrices: Record<string, { patient_price: number; lab_receivable: number | null }> = {};
    let locationDetails: { collection_percentage: number | null; receivable_type: string | null } | null = null;
    
    if (orderData.location_id) {
      // Fetch location details for collection_percentage fallback
      const { data: locData } = await supabaseClient
        .from('locations')
        .select('collection_percentage, receivable_type')
        .eq('id', orderData.location_id)
        .single();
      
      if (locData) {
        locationDetails = locData;
        console.log('📍 Location details:', locationDetails);
      }
      
      // Fetch location-specific prices
      const { data: locPrices, error: locPricesError } = await supabaseClient
        .from('location_test_prices')
        .select('test_group_id, patient_price, lab_receivable')
        .eq('location_id', orderData.location_id)
        .in('test_group_id', orderData.test_ids)
        .eq('is_active', true);

      if (!locPricesError && locPrices) {
        locPrices.forEach(lp => {
          if (lp.patient_price !== null && lp.patient_price !== undefined) {
            locationPrices[lp.test_group_id] = {
              patient_price: Number(lp.patient_price),
              lab_receivable: lp.lab_receivable !== null ? Number(lp.lab_receivable) : null
            };
          }
        });
        console.log('📍 Location prices found:', locationPrices);
      }
    }

    // Calculate subtotal using location price if available, otherwise base price
    const subtotal = tests.reduce((sum, test) => {
      const locPrice = locationPrices[test.id];
      const price = locPrice?.patient_price ?? test.price ?? 0;
      console.log(`Test ${test.name}: location price=${locPrice?.patient_price}, base price=${test.price}, using=${price}`);
      return sum + price;
    }, 0);

    console.log(`📊 Subtotal calculated: ₹${subtotal}`);

    // Calculate discount
    let discountAmount = 0;
    if (orderData.discount_type && orderData.discount_value) {
      if (orderData.discount_type === 'percentage') {
        discountAmount = (subtotal * orderData.discount_value) / 100;
      } else if (orderData.discount_type === 'fixed') {
        discountAmount = Math.min(orderData.discount_value, subtotal); // Can't discount more than subtotal
      }
    }

    const finalAmount = subtotal - discountAmount;

    // 1. Create Order
    const { data: order, error: orderError } = await supabaseClient
      .from('orders')
      .insert({
        patient_id: orderData.patient_id,
        lab_id: labId,
        referring_doctor_id: orderData.referring_doctor_id,
        location_id: orderData.location_id,
        created_by: user.id,
        total_amount: subtotal,
        final_amount: finalAmount,
        status: 'created',
      })
      .select()
      .single();

    if (orderError) {
      throw new Error(`Order creation failed: ${orderError.message}`);
    }

    console.log('✅ Order created:', order.id);

    // 2. Create Order Tests
    const orderTests = orderData.test_ids.map((testId) => ({
      order_id: order.id,
      test_group_id: testId,
    }));

    const { error: orderTestsError } = await supabaseClient
      .from('order_tests')
      .insert(orderTests);

    if (orderTestsError) {
      // Rollback order
      await supabaseClient.from('orders').delete().eq('id', order.id);
      throw new Error(`Order tests insertion failed: ${orderTestsError.message}`);
    }

    console.log('✅ Order tests linked');

    // 2b. Auto-consume per_order and per_sample inventory items (non-blocking)
    try {
      const [perOrderResult, perSampleResult] = await Promise.all([
        supabaseClient.rpc('fn_inventory_consume_general', {
          p_lab_id: labId,
          p_scope: 'per_order',
          p_order_id: order.id,
          p_reason: 'Order created',
          p_user_id: user.id,
        }),
        supabaseClient.rpc('fn_inventory_consume_general', {
          p_lab_id: labId,
          p_scope: 'per_sample',
          p_order_id: order.id,
          p_reason: 'Sample collection',
          p_user_id: user.id,
        }),
      ]);

      const orderConsumed = perOrderResult.data?.items_consumed || 0;
      const sampleConsumed = perSampleResult.data?.items_consumed || 0;
      if (orderConsumed > 0 || sampleConsumed > 0) {
        console.log(`📦 Inventory consumed: ${orderConsumed} per_order + ${sampleConsumed} per_sample items`);
      }
    } catch (invErr) {
      console.warn('Inventory auto-consume on order creation failed (non-blocking):', invErr);
    }

    // Get patient name for invoice
    const { data: patient } = await supabaseClient
      .from('patients')
      .select('name')
      .eq('id', orderData.patient_id)
      .single();

    // 3. Generate Invoice Number
    const invoiceNumber = `INV-${Date.now()}-${order.id.substring(0, 8)}`;

    // 4. Create Invoice (using actual schema columns)
    const { data: invoice, error: invoiceError } = await supabaseClient
      .from('invoices')
      .insert({
        patient_id: orderData.patient_id,
        patient_name: patient?.name || 'Unknown',
        order_id: order.id,
        lab_id: labId,
        location_id: orderData.location_id,
        referring_doctor_id: orderData.referring_doctor_id,
        invoice_number: invoiceNumber,
        subtotal: subtotal,
        discount: discountAmount, // Schema uses 'discount' not 'discount_amount'
        total_discount: discountAmount,
        total_before_discount: subtotal,
        total_after_discount: finalAmount,
        tax: 0, // Required field
        total: finalAmount, // Schema uses 'total' not 'total_amount'
        amount_paid: orderData.amount_paid || 0,
        payment_method: orderData.payment_method,
        payment_type: 'self',
        invoice_type: 'patient',
        status: 'Draft', // Enum type
        due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 30 days from now
      })
      .select()
      .single();

    if (invoiceError) {
      console.error('Invoice creation failed:', invoiceError);
      // Don't rollback - invoice can be created later
    } else {
      console.log('✅ Invoice created:', invoice.id);
      
      // 5. Create Invoice Items
      // Fetch outsourced lab costs if any tests are outsourced
      let outsourcedCosts: Record<string, number> = {};
      const outsourcedTests = orderData.test_outsourcing 
        ? Object.entries(orderData.test_outsourcing)
            .filter(([_, labId]) => labId && labId !== 'inhouse')
            .map(([testId, labId]) => ({ testId, labId }))
        : [];
      
      if (outsourcedTests.length > 0) {
        const outsourcedLabIds = [...new Set(outsourcedTests.map(t => t.labId))];
        const { data: outsourcedPrices } = await supabaseClient
          .from('outsourced_lab_prices')
          .select('test_group_id, outsourced_lab_id, cost')
          .in('outsourced_lab_id', outsourcedLabIds)
          .in('test_group_id', orderData.test_ids);
        
        if (outsourcedPrices) {
          outsourcedPrices.forEach(op => {
            // Key by test_id for lookup
            outsourcedCosts[op.test_group_id] = op.cost;
          });
        }
        console.log('📦 Outsourced costs:', outsourcedCosts);
      }
      
      // Calculate location_receivable for each test
      const invoiceItems = tests.map(test => {
        const locPrice = locationPrices[test.id];
        const price = locPrice?.patient_price ?? test.price ?? 0;
        const outsourcedLabId = orderData.test_outsourcing?.[test.id];
        const isOutsourced = outsourcedLabId && outsourcedLabId !== 'inhouse';
        
        // Determine location_receivable
        let locationReceivable: number | null = null;
        if (orderData.location_id) {
          if (locPrice?.lab_receivable !== null && locPrice?.lab_receivable !== undefined) {
            // Use test-specific lab_receivable from location_test_prices
            locationReceivable = locPrice.lab_receivable;
          } else if (locationDetails?.receivable_type === 'own_center') {
            // Own center gets 100% of revenue
            locationReceivable = price;
          } else if (locationDetails?.receivable_type === 'percentage' && locationDetails?.collection_percentage) {
            // Calculate using collection_percentage
            locationReceivable = price * (locationDetails.collection_percentage / 100);
          }
        }
        
        return {
          invoice_id: invoice.id,
          test_name: test.name,
          price: price,
          quantity: 1,
          total: price,
          lab_id: labId,
          order_id: order.id,
          location_receivable: locationReceivable,
          outsourced_lab_id: isOutsourced ? outsourcedLabId : null,
          outsourced_cost: isOutsourced ? (outsourcedCosts[test.id] || null) : null,
        };
      });
      
      const { error: itemsError } = await supabaseClient
        .from('invoice_items')
        .insert(invoiceItems);
      
      if (itemsError) {
        console.error('Invoice items creation failed:', itemsError);
      } else {
        console.log(`✅ Created ${invoiceItems.length} invoice items`);
      }
    }

    // 6. Record Payment (if amount provided)
    let payment = null;
    let balanceDue = finalAmount;

    if (orderData.amount_paid && orderData.amount_paid > 0 && invoice) {
      const paymentAmount = Math.min(orderData.amount_paid, finalAmount);
      balanceDue = finalAmount - paymentAmount;

      const { data: paymentData, error: paymentError } = await supabaseClient
        .from('payments')
        .insert({
          invoice_id: invoice.id, // REQUIRED - schema has no order_id
          lab_id: labId,
          location_id: orderData.location_id,
          amount: paymentAmount,
          payment_method: orderData.payment_method || 'cash',
          payment_reference: `PAY-${Date.now()}`,
          notes: orderData.notes,
          received_by: user.id, // Schema uses 'received_by' not 'created_by'
        })
        .select()
        .single();

      if (paymentError) {
        console.error('Payment recording failed:', paymentError);
      } else {
        payment = paymentData;
        console.log('✅ Payment recorded:', payment.id);
      }
    }

    // Return success response
    return new Response(
      JSON.stringify({
        success: true,
        order_id: order.id,
        invoice_id: invoice?.id,
        payment_id: payment?.id,
        subtotal,
        discount_amount: discountAmount,
        final_amount: finalAmount,
        amount_paid: orderData.amount_paid || 0,
        balance_due: balanceDue,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({
        error: error.message,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    );
  }
});
