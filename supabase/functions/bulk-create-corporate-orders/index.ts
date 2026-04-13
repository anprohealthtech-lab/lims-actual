import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PatientInput {
  name: string;
  age: number;
  age_unit?: 'years' | 'months' | 'days';
  gender: 'Male' | 'Female' | 'Other';
  phone?: string;
  email?: string;
  sample_id?: string;
  corporate_employee_id?: string;
  custom_fields?: Record<string, unknown>;
  existing_patient_id?: string;
  additional_package_ids?: string[];
  additional_test_group_ids?: string[];
}

interface BulkCorporateOrderRequest {
  account_id: string;
  package_id?: string;
  package_ids?: string[];
  test_group_ids?: string[];
  referring_doctor_id?: string;
  notes?: string;
  excel_filename?: string;
  patients: PatientInput[];
}

interface PatientResult {
  patient_name: string;
  patient_id?: string;
  order_id?: string;
  invoice_id?: string;
  sample_id?: string;
  order_display?: string;
  error?: string;
}

interface PackageMeta {
  id: string;
  name: string;
  price: number;
  discount_percentage?: number | null;
  testGroupIds: string[];
}

interface TestGroupMeta {
  id: string;
  name: string;
  price: number;
}

interface ChargeLine {
  kind: 'package' | 'test';
  id: string;
  name: string;
  price: number;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dedupeIds = (values: (string | undefined | null)[]) => Array.from(new Set(values.filter(Boolean) as string[]));

const formatSupabaseError = (error: unknown, fallback: string) => {
  if (!error) return fallback;
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  if (typeof error === 'object') {
    const err = error as { message?: string; details?: string; hint?: string; code?: string };
    const parts = [err.message, err.details, err.hint, err.code].filter(Boolean);
    return parts.length > 0 ? parts.join(' | ') : JSON.stringify(error);
  }
  return fallback;
};

const formatOrderSampleId = (date: Date, sequence: number, labCode?: string | null) => {
  const base = `${String(date.getDate()).padStart(2, '0')}-${MONTHS[date.getMonth()]}-${date.getFullYear()}-${String(sequence).padStart(3, '0')}`;
  return labCode ? `${labCode}-${base}` : base;
};

const getOrderAssignedColor = (sequence: number) => {
  switch ((sequence - 1) % 12) {
    case 0: return { color_code: '#EF4444', color_name: 'Red' };
    case 1: return { color_code: '#3B82F6', color_name: 'Blue' };
    case 2: return { color_code: '#10B981', color_name: 'Green' };
    case 3: return { color_code: '#F59E0B', color_name: 'Orange' };
    case 4: return { color_code: '#8B5CF6', color_name: 'Purple' };
    case 5: return { color_code: '#06B6D4', color_name: 'Cyan' };
    case 6: return { color_code: '#EC4899', color_name: 'Pink' };
    case 7: return { color_code: '#84CC16', color_name: 'Lime' };
    case 8: return { color_code: '#F97316', color_name: 'Amber' };
    case 9: return { color_code: '#6366F1', color_name: 'Indigo' };
    case 10: return { color_code: '#14B8A6', color_name: 'Teal' };
    default: return { color_code: '#A855F7', color_name: 'Violet' };
  }
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } },
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const body: BulkCorporateOrderRequest = await req.json();
    const basePackageIds = dedupeIds([body.package_id, ...(body.package_ids || [])]);
    const baseDirectTestIds = dedupeIds(body.test_group_ids || []);
    if (!body.account_id) throw new Error('account_id is required');
    if (!body.patients?.length) throw new Error('At least one patient is required');
    if (basePackageIds.length === 0 && baseDirectTestIds.length === 0) throw new Error('At least one package or test is required');

    let userData: { id: string; lab_id: string | null } | null = null;
    for (const lookup of [
      () => supabase.from('users').select('id, lab_id').eq('auth_user_id', user.id).maybeSingle(),
      () => user.email ? supabase.from('users').select('id, lab_id').eq('email', user.email).maybeSingle() : Promise.resolve({ data: null }),
      () => supabase.from('users').select('id, lab_id').eq('id', user.id).maybeSingle(),
    ]) {
      const { data } = await lookup();
      if (data?.lab_id) { userData = data as { id: string; lab_id: string | null }; break; }
    }
    const labId = userData?.lab_id ?? user.user_metadata?.lab_id ?? null;
    if (!labId) throw new Error('Could not resolve user lab for bulk corporate order creation');

    const { data: labRow } = await supabase.from('labs').select('code').eq('id', labId).maybeSingle();
    const labCode = labRow?.code ?? null;

    const { data: account, error: accountError } = await supabase
      .from('accounts')
      .select('id, name, default_discount_percent, billing_mode')
      .eq('id', body.account_id)
      .eq('lab_id', labId)
      .eq('is_active', true)
      .single();
    if (accountError || !account) throw new Error('Account not found or inactive');

    const allPackageIds = dedupeIds([...basePackageIds, ...body.patients.flatMap((p) => p.additional_package_ids || [])]);
    const allDirectTestIds = dedupeIds([...baseDirectTestIds, ...body.patients.flatMap((p) => p.additional_test_group_ids || [])]);

    const { data: packageRows, error: packageRowsError } = allPackageIds.length > 0
      ? await supabase
        .from('packages')
        .select('id, name, price, discount_percentage, package_test_groups(test_group_id)')
        .in('id', allPackageIds)
        .eq('lab_id', labId)
      : { data: [], error: null };
    if (packageRowsError) throw new Error(`Failed to fetch packages: ${packageRowsError.message}`);

    const packageMap = new Map<string, PackageMeta>();
    (packageRows || []).forEach((pkg: any) => {
      packageMap.set(pkg.id, {
        id: pkg.id,
        name: pkg.name,
        price: Number(pkg.price) || 0,
        discount_percentage: pkg.discount_percentage,
        testGroupIds: dedupeIds((pkg.package_test_groups || []).map((ptg: any) => ptg.test_group_id)),
      });
    });

    const allTestIds = dedupeIds([...allDirectTestIds, ...Array.from(packageMap.values()).flatMap((pkg) => pkg.testGroupIds)]);
    const { data: testGroupRows, error: testGroupRowsError } = await supabase
      .from('test_groups')
      .select('id, name, price')
      .in('id', allTestIds);
    if (testGroupRowsError || !testGroupRows) throw new Error('Failed to fetch test groups');

    const testGroupMap = new Map<string, TestGroupMeta>();
    testGroupRows.forEach((tg: any) => testGroupMap.set(tg.id, { id: tg.id, name: tg.name, price: Number(tg.price) || 0 }));

    const { data: accountPrices } = allTestIds.length > 0
      ? await supabase.from('account_prices').select('test_group_id, price').eq('account_id', body.account_id).in('test_group_id', allTestIds).eq('is_active', true)
      : { data: [] };
    const accountPriceMap: Record<string, number> = {};
    (accountPrices || []).forEach((ap: any) => { accountPriceMap[ap.test_group_id] = Number(ap.price) || 0; });

    const { data: accountPackagePrices } = allPackageIds.length > 0
      ? await supabase.from('account_package_prices').select('package_id, price').eq('account_id', body.account_id).in('package_id', allPackageIds).eq('is_active', true)
      : { data: [] };
    const accountPackagePriceMap: Record<string, number> = {};
    (accountPackagePrices || []).forEach((ap: any) => {
      if (!(ap.package_id in accountPackagePriceMap)) accountPackagePriceMap[ap.package_id] = Number(ap.price) || 0;
    });

    const buildSelection = (packageIds: string[], directTestIds: string[]) => {
      const validPackageIds = dedupeIds(packageIds).filter((id) => packageMap.has(id));
      const packageCoveredTestIds = dedupeIds(validPackageIds.flatMap((id) => packageMap.get(id)?.testGroupIds || []));
      const standaloneTestIds = dedupeIds(directTestIds).filter((id) => testGroupMap.has(id) && !packageCoveredTestIds.includes(id));
      const finalTestGroupIds = dedupeIds([...packageCoveredTestIds, ...standaloneTestIds]);
      return { packageIds: validPackageIds, standaloneTestIds, finalTestGroupIds };
    };

    const getPackageCharge = (packageId: string) => {
      if (packageId in accountPackagePriceMap) return { price: accountPackagePriceMap[packageId], discountable: false };
      const pkg = packageMap.get(packageId)!;
      const discounted = pkg.price * (1 - (Number(pkg.discount_percentage) || 0) / 100);
      return { price: discounted, discountable: true };
    };

    const createChargeSummary = (packageIds: string[], standaloneTestIds: string[]) => {
      const lines: ChargeLine[] = [];
      let discountableSubtotal = 0;
      let fixedSubtotal = 0;

      packageIds.forEach((packageId) => {
        const pkg = packageMap.get(packageId);
        if (!pkg) return;
        const charge = getPackageCharge(packageId);
        lines.push({ kind: 'package', id: packageId, name: pkg.name, price: charge.price });
        if (charge.discountable) discountableSubtotal += charge.price;
        else fixedSubtotal += charge.price;
      });

      standaloneTestIds.forEach((testId) => {
        const tg = testGroupMap.get(testId);
        if (!tg) return;
        const price = Number(accountPriceMap[testId] ?? tg.price ?? 0);
        lines.push({ kind: 'test', id: testId, name: tg.name, price });
        discountableSubtotal += price;
      });

      const discountAmount = account.default_discount_percent ? (discountableSubtotal * account.default_discount_percent) / 100 : 0;
      return {
        lines,
        subtotal: fixedSubtotal + discountableSubtotal,
        discountAmount,
        finalAmount: fixedSubtotal + discountableSubtotal - discountAmount,
      };
    };

    const baseSelection = buildSelection(basePackageIds, baseDirectTestIds);
    const baseCharges = createChargeSummary(baseSelection.packageIds, baseSelection.standaloneTestIds);
    const baseLabel = [
      ...baseSelection.packageIds.map((id) => packageMap.get(id)?.name).filter(Boolean),
      ...baseSelection.standaloneTestIds.map((id) => testGroupMap.get(id)?.name).filter(Boolean),
    ].join(', ');

    const orderDate = new Date().toISOString().split('T')[0];
    const nextDate = new Date(orderDate);
    nextDate.setDate(nextDate.getDate() + 1);
    const { count: existingOrderCount, error: existingOrderCountError } = await supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('lab_id', labId)
      .gte('order_date', orderDate)
      .lt('order_date', nextDate.toISOString().split('T')[0]);
    if (existingOrderCountError) throw new Error(`Failed to determine daily order count: ${formatSupabaseError(existingOrderCountError, 'Unknown count error')}`);
    let nextDailySequence = (existingOrderCount || 0) + 1;

    const batchInsertPayload = {
      lab_id: labId,
      account_id: body.account_id,
      package_id: baseSelection.packageIds[0] || null,
      test_group_ids: baseSelection.finalTestGroupIds,
      batch_source: body.excel_filename ? 'excel_upload' : 'manual',
      total_patients: body.patients.length,
      status: 'processing',
      excel_filename: body.excel_filename || null,
      notes: body.notes || null,
      created_by: user.id,
    };
    const { data: batch, error: batchError } = await supabase.from('bulk_registration_batches').insert(batchInsertPayload).select('id').maybeSingle();
    if (batchError || !batch?.id) throw new Error(`Failed to create batch: ${formatSupabaseError(batchError, 'No row returned from insert')}`);

    const results: PatientResult[] = [];
    let createdCount = 0;
    let failedCount = 0;

    for (const patientInput of body.patients) {
      try {
        let patientId = patientInput.existing_patient_id;
        if (!patientId) {
          const { data: newPatient, error: patientError } = await supabase.from('patients').insert({
            lab_id: labId,
            name: patientInput.name,
            age: patientInput.age,
            age_unit: patientInput.age_unit || 'years',
            gender: patientInput.gender,
            phone: patientInput.phone || '',
            email: patientInput.email || null,
            address: '',
            city: '',
            state: '',
            pincode: '',
            corporate_employee_id: patientInput.corporate_employee_id || null,
            custom_fields: patientInput.custom_fields || {},
            default_payment_type: 'credit',
          }).select('id').single();
          if (patientError || !newPatient) throw new Error(`Patient creation failed: ${patientError?.message}`);
          patientId = newPatient.id;
        }

        const patientSelection = buildSelection(
          [...baseSelection.packageIds, ...(patientInput.additional_package_ids || [])],
          [...baseDirectTestIds, ...(patientInput.additional_test_group_ids || [])],
        );
        const patientCharges = createChargeSummary(patientSelection.packageIds, patientSelection.standaloneTestIds);
        const generatedSampleId = patientInput.sample_id || formatOrderSampleId(new Date(orderDate), nextDailySequence, labCode);
        const { color_code, color_name } = getOrderAssignedColor(nextDailySequence);
        nextDailySequence++;

        const { data: order, error: orderError } = await supabase.from('orders').insert({
          lab_id: labId,
          patient_id: patientId,
          patient_name: patientInput.name,
          doctor: account.name,
          referring_doctor_id: body.referring_doctor_id || null,
          location_id: null,
          collected_at_location_id: null,
          account_id: body.account_id,
          payment_type: 'credit',
          priority: 'Normal',
          total_amount: patientCharges.subtotal,
          collection_charge: null,
          final_amount: patientCharges.finalAmount,
          status: 'Order Created',
          order_date: orderDate,
          expected_date: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          sample_id: generatedSampleId,
          color_code,
          color_name,
          bulk_batch_id: batch.id,
          notes: body.notes || null,
          created_by: user.id,
          patient_context: {
            age: patientInput.age,
            age_unit: patientInput.age_unit || 'years',
            gender: patientInput.gender,
            date_of_birth: null,
            additional_inputs: {},
          },
        }).select('id, order_display, order_date').single();
        if (orderError || !order) throw new Error(`Order creation failed: ${orderError?.message}`);

        // Generate and patch qr_code_data (mirrors individual order flow)
        const qrCodeData = JSON.stringify({
          orderId: order.id,
          patientId: patientId,
          sampleId: generatedSampleId,
          orderDate: order.order_date || orderDate,
          colorCode: color_code,
          colorName: color_name,
          patientName: patientInput.name,
          generated: new Date().toISOString(),
        });
        const { error: qrUpdateError } = await supabase.from('orders').update({ qr_code_data: qrCodeData }).eq('id', order.id);
        if (qrUpdateError) console.error('QR code update failed (non-blocking):', qrUpdateError.message);

        const packageSourceByTestId: Record<string, string> = {};
        patientSelection.packageIds.forEach((packageId) => {
          (packageMap.get(packageId)?.testGroupIds || []).forEach((testId) => {
            if (!packageSourceByTestId[testId]) packageSourceByTestId[testId] = packageId;
          });
        });

        // Build package-level order_test rows (one row per package, price = package charge)
        const packageOrderTestRows = patientSelection.packageIds.map((packageId) => {
          const pkg = packageMap.get(packageId)!;
          const charge = getPackageCharge(packageId);
          return {
            order_id: order.id,
            test_group_id: null as string | null,
            test_name: `📦 ${pkg.name}`,
            price: charge.price,
            sample_id: generatedSampleId,
            lab_id: labId,
            package_id: packageId,
            outsourced_lab_id: null as string | null,
          };
        });

        const orderTestsInsert = [
          ...packageOrderTestRows,
          ...patientSelection.finalTestGroupIds.map((testId) => {
            const testMeta = testGroupMap.get(testId);
            return {
              order_id: order.id,
              test_group_id: testId,
              test_name: testMeta?.name || 'Test',
              price: packageSourceByTestId[testId] ? 0 : Number(accountPriceMap[testId] ?? testMeta?.price ?? 0),
              sample_id: generatedSampleId,
              lab_id: labId,
              package_id: packageSourceByTestId[testId] || null,
              outsourced_lab_id: null as string | null,
            };
          }),
        ];

        const { error: otError } = await supabase.from('order_tests').insert(orderTestsInsert);
        if (otError) {
          await supabase.from('orders').delete().eq('id', order.id);
          throw new Error(`Order tests failed: ${otError.message}`);
        }

        // PATCH: force price=0 for package-covered tests (overrides any DB triggers)
        if (patientSelection.packageIds.length > 0 && patientSelection.finalTestGroupIds.length > 0) {
          const packageCoveredTestNames = patientSelection.finalTestGroupIds
            .filter((testId) => packageSourceByTestId[testId])
            .map((testId) => testGroupMap.get(testId)?.name)
            .filter(Boolean) as string[];
          if (packageCoveredTestNames.length > 0) {
            const { error: priceFixError } = await supabase
              .from('order_tests')
              .update({ price: 0 })
              .eq('order_id', order.id)
              .in('test_name', packageCoveredTestNames)
              .not('test_group_id', 'is', null);
            if (priceFixError) console.warn('Package test price fix failed (non-blocking):', priceFixError.message);
          }
        }

        const invoiceNumber = `INV-${Date.now()}-${order.id.substring(0, 8)}`;
        const { data: invoice, error: invoiceError } = await supabase.from('invoices').insert({
          lab_id: labId,
          patient_id: patientId,
          patient_name: patientInput.name,
          order_id: order.id,
          account_id: body.account_id,
          invoice_type: 'account',
          payment_type: 'credit',
          invoice_number: invoiceNumber,
          subtotal: patientCharges.subtotal,
          discount: patientCharges.discountAmount,
          total_discount: patientCharges.discountAmount,
          total_before_discount: patientCharges.subtotal,
          total_after_discount: patientCharges.finalAmount,
          tax: 0,
          total: patientCharges.finalAmount,
          amount_paid: 0,
          status: 'Draft',
          due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        }).select('id').single();

        if (!invoiceError && invoice) {
          const invoiceItems = patientCharges.lines.map((line) => ({
            invoice_id: invoice.id,
            test_name: line.kind === 'package' ? `Package: ${line.name}` : line.name,
            price: line.price,
            quantity: 1,
            total: line.price,
            lab_id: labId,
            order_id: order.id,
          }));
          if (invoiceItems.length > 0) await supabase.from('invoice_items').insert(invoiceItems);
        }

        results.push({ patient_name: patientInput.name, patient_id: patientId, order_id: order.id, invoice_id: invoice?.id, sample_id: generatedSampleId, order_display: order.order_display || generatedSampleId });
        createdCount++;
      } catch (err) {
        results.push({ patient_name: patientInput.name, error: (err as Error).message });
        failedCount++;
      }
    }

    const batchStatus = failedCount === 0 ? 'completed' : createdCount === 0 ? 'failed' : 'partial';
    await supabase.from('bulk_registration_batches').update({
      created_orders: createdCount,
      failed_orders: failedCount,
      status: batchStatus,
      completed_at: new Date().toISOString(),
    }).eq('id', batch.id);

    return new Response(JSON.stringify({
      success: true,
      batch_id: batch.id,
      account_name: account.name,
      tests_label: baseLabel,
      per_patient_amount: baseCharges.finalAmount,
      summary: { total: body.patients.length, created: createdCount, failed: failedCount },
      results,
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('bulk-create-corporate-orders error:', err);
    return new Response(JSON.stringify({ error: formatSupabaseError(err, 'Unknown bulk corporate order error') }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
