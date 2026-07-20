// services/sampleService.ts
// Core sample management service for LIMS

import { database, supabase } from '../utils/supabase';
import {
  generateSampleIdAndBarcode,
  generateNumericBarcode,
  getContainerType,
  getLabCode,
  getSampleTypeCode,
  getStandardTubeColor,
} from '../utils/sampleIdGenerator';
import { SampleQRData } from '../utils/qrCodeGenerator';
import { format } from 'date-fns';

/**
 * Sample entity type
 */
export interface Sample {
  id: string;
  order_id: string;
  sample_type: string;
  sample_condition?: string | null;
  barcode: string;
  qr_code_data?: SampleQRData;
  container_type: string;
  specimen_site?: string;
  lab_id: string;
  status: 'created' | 'collected' | 'received' | 'processing' | 'processed' | 'rejected' | 'discarded';
  collected_at?: string;
  received_at?: string;
  processed_at?: string;
  rejected_at?: string;
  rejection_reason?: string;
  collected_by?: string;
  collected_at_location_id?: string;
  current_location_id?: string;
  destination_location_id?: string;
  transit_status?: string;
  created_at: string;
}

/**
 * Order test group with test group info
 */
export interface OrderTestGroupWithInfo {
  id: string;
  order_id: string;
  test_group_id: string;
  test_name: string;
  test_group?: {
    sample_type: string;
    sample_color?: string;
  };
}

function parseSampleSequence(sampleId: string): number {
  const match = sampleId.match(/-(\d+)-[^-]+$/);
  return match ? (parseInt(match[1], 10) || 0) : 0;
}

function parseBarcodeSequence(barcode: string, datePrefixLength: number): number {
  const suffix = barcode.substring(datePrefixLength);
  return parseInt(suffix, 10) || 0;
}

async function getNextDailySampleSequence(labCode: string, dateStr: string): Promise<number> {
  const { data, error } = await supabase
    .from('samples')
    .select('id')
    .like('id', `${labCode}-${dateStr}-%`)
    .order('id', { ascending: false })
    .limit(1);

  if (error) throw error;
  return Math.max(1, parseSampleSequence(String(data?.[0]?.id || '')) + 1);
}

async function getNextDailyBarcodeSequence(labId: string, shortDate: string): Promise<number> {
  const { data, error } = await supabase
    .from('samples')
    .select('barcode')
    .eq('lab_id', labId)
    .like('barcode', `${shortDate}%`)
    .order('barcode', { ascending: false })
    .limit(1);

  if (error) throw error;

  const lastBarcode = String(data?.[0]?.barcode || '');
  return Math.max(1, parseBarcodeSequence(lastBarcode, shortDate.length) + 1);
}

/**
 * Create samples for an order based on test group requirements
 * Groups tests by sample type and creates one sample per unique type
 */
export async function createSamplesForOrder(
  orderId: string,
  orderTestGroups: OrderTestGroupWithInfo[],
  labId: string,
  patientId: string,
  options?: {
    preBarcodedBarcode?: string | null;
    collectedAt?: string | null;
    collectedBy?: string | null;
  }
): Promise<Sample[]> {
  const labCode = await getLabCode(labId);
  const sampleTypeGroups = new Map<string, OrderTestGroupWithInfo[]>();

  for (const orderTest of orderTestGroups) {
    const sampleType = orderTest.test_group?.sample_type || 'Blood';
    const groupedTests = sampleTypeGroups.get(sampleType) || [];
    groupedTests.push(orderTest);
    sampleTypeGroups.set(sampleType, groupedTests);
  }

  if (sampleTypeGroups.size === 0) return [];

  const now = new Date();
  const dateStr = format(now, 'yyyyMMdd');
  const barcodeDatePrefix = format(now, 'yyMMdd');
  const [initialIdSequence, { data: latestBarcodes }] = await Promise.all([
    getNextDailySampleSequence(labCode, dateStr),
    supabase
      .from('samples')
      .select('barcode')
      .eq('lab_id', labId)
      .like('barcode', `${barcodeDatePrefix}%`)
      .order('barcode', { ascending: false })
      .limit(1),
  ]);

  let idSequence = initialIdSequence;
  const lastBarcode = String(latestBarcodes?.[0]?.barcode || '');
  let barcodeSequence = Math.max(
    1,
    parseBarcodeSequence(lastBarcode, barcodeDatePrefix.length) + 1,
  );

  const manualBarcode = String(options?.preBarcodedBarcode || '').trim();
  const canUseManualBarcode = !!manualBarcode && sampleTypeGroups.size === 1;
  const collectedAt = String(options?.collectedAt || '').trim() || null;
  const collectedBy = String(options?.collectedBy || '').trim() || null;
  const isAutoCollected = !!collectedAt;

  const samplePlans = Array.from(sampleTypeGroups.entries()).map(([sampleType, testGroups], index) => {
    const sampleId = `${labCode}-${dateStr}-${idSequence.toString().padStart(4, '0')}-${getSampleTypeCode(sampleType)}`;
    const barcode = canUseManualBarcode && index === 0 ? manualBarcode : generateNumericBarcode(now, barcodeSequence);
    idSequence += 1;
    if (!(canUseManualBarcode && index === 0)) barcodeSequence += 1;

    const qrCodeData: SampleQRData = {
      sampleId,
      sampleType,
      patientId,
      orderId,
      labCode,
      collectionDate: now.toISOString(),
      barcode,
    };

    return {
      testGroups,
      row: {
        id: sampleId,
        order_id: orderId,
        sample_type: sampleType,
        barcode,
        qr_code_data: qrCodeData,
        container_type: getContainerType(sampleType),
        lab_id: labId,
        status: isAutoCollected ? 'collected' : 'created',
        collected_at: collectedAt,
        collected_by: isAutoCollected ? collectedBy : null,
        pre_barcoded: canUseManualBarcode && index === 0,
        barcode_source: canUseManualBarcode && index === 0 ? 'preprinted' : 'generated',
        barcode_assigned_at: now.toISOString(),
      },
    };
  });

  let insertedSamples: Sample[] = [];
  let sampleError: any = null;

  // IDs are human-readable and generated client-side, so concurrent requests can
  // calculate the same next sequence. Keep the primary key and retry with the
  // latest sequence instead of allowing duplicate sample identities.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const result = await supabase
      .from('samples')
      .insert(samplePlans.map((plan) => plan.row))
      .select();

    if (!result.error) {
      insertedSamples = (result.data || []) as Sample[];
      sampleError = null;
      break;
    }

    sampleError = result.error;
    const isSampleIdCollision =
      result.error.code === '23505'
      && String(result.error.message || result.error.details || '').includes('samples_pkey');
    const isBarcodeCollision =
      result.error.code === '23505'
      && String(result.error.message || result.error.details || '').includes('barcode');

    if ((!isSampleIdCollision && !isBarcodeCollision) || attempt === 4) break;

    [idSequence, barcodeSequence] = await Promise.all([
      getNextDailySampleSequence(labCode, dateStr),
      getNextDailyBarcodeSequence(labId, barcodeDatePrefix),
    ]);
    for (const plan of samplePlans) {
      const sampleId = `${labCode}-${dateStr}-${idSequence.toString().padStart(4, '0')}-${getSampleTypeCode(plan.row.sample_type)}`;
      const keepManualBarcode = plan.row.barcode_source === 'preprinted';
      const barcode = keepManualBarcode ? plan.row.barcode : generateNumericBarcode(now, barcodeSequence);
      plan.row.id = sampleId;
      plan.row.barcode = barcode;
      plan.row.qr_code_data = {
        ...plan.row.qr_code_data,
        sampleId,
        barcode,
      };
      idSequence += 1;
      if (!keepManualBarcode) barcodeSequence += 1;
    }
  }

  if (sampleError) throw sampleError;

  await Promise.all(samplePlans.map(async (plan) => {
    const orderTestIds = plan.testGroups.map((testGroup) => testGroup.id);
    const { error: linkError } = await supabase
      .from('order_tests')
      .update({ sample_id: plan.row.id })
      .in('id', orderTestIds);

    if (linkError) {
      const { error: fallbackError } = await supabase
        .from('order_test_groups')
        .update({ sample_id: plan.row.id })
        .in('id', orderTestIds);
      if (fallbackError) console.error('Error linking generated sample:', fallbackError);
    }
  }));

  const { error: eventError } = await supabase.from('sample_events').insert(
    samplePlans.map((plan) => ({
      sample_id: plan.row.id,
      event_type: 'created',
      metadata: {
        test_groups: plan.testGroups.map((testGroup) => ({
          id: testGroup.id,
          test_name: testGroup.test_name,
        })),
      },
    })),
  );

  if (eventError) console.error('Error creating initial sample events:', eventError);

  if (isAutoCollected) {
    const { error: collectedEventError } = await supabase.from('sample_events').insert(
      samplePlans.map((plan) => ({
        sample_id: plan.row.id,
        event_type: 'collected',
        performed_by: collectedBy,
        metadata: { source: 'auto_collect_on_registration' },
      })),
    );
    if (collectedEventError) console.error('Error creating auto-collection sample events:', collectedEventError);
  }

  return insertedSamples;
}

async function createSamplesForOrderLegacy(
  orderId: string,
  orderTestGroups: OrderTestGroupWithInfo[],
  labId: string,
  patientId: string
): Promise<Sample[]> {
  const samples: Sample[] = [];
  
  // Get lab code for sample ID generation
  const labCode = await getLabCode(labId);
  
  // Group test groups by required sample type
  const sampleTypeGroups = new Map<string, OrderTestGroupWithInfo[]>();
  
  for (const otg of orderTestGroups) {
    const sampleType = otg.test_group?.sample_type || 'Blood';
    
    if (!sampleTypeGroups.has(sampleType)) {
      sampleTypeGroups.set(sampleType, []);
    }
    sampleTypeGroups.get(sampleType)!.push(otg);
  }
  
  // Create one sample per unique sample type
  for (const [sampleType, testGroups] of sampleTypeGroups.entries()) {
    try {
      // Generate unique sample ID and instrument-compatible barcode
      const { id: sampleId, barcode } = await generateSampleIdAndBarcode(labCode, sampleType, labId);
      
      // Get tube color (from test group or standard)
      const tubeColor = testGroups[0].test_group?.sample_color || getStandardTubeColor(sampleType);
      
      // Create QR code data
      const qrData: SampleQRData = {
        sampleId,
        sampleType,
        patientId,
        orderId,
        labCode,
        collectionDate: new Date().toISOString(),
        barcode: barcode // Use the numeric barcode
      };
      
      console.log(`Creating sample for type: ${sampleType}, ID: ${sampleId}, Barcode: ${barcode}`);

      // Insert sample record
      const { data: sample, error: sampleError } = await supabase
        .from('samples')
        .insert({
          id: sampleId,
          order_id: orderId,
          sample_type: sampleType,
          barcode: barcode, // Use the 10-digit numeric barcode
          qr_code_data: qrData,
          container_type: getContainerType(sampleType),
          lab_id: labId,
          status: 'created'
        })
        .select()
        .single();
      
      if (sampleError) {
        console.error('❌ Error creating sample record:', sampleError);
        throw sampleError;
      }
      
      console.log('✅ Sample created successfully:', sample.id);

      // Link this sample to all test groups that need it
      for (const otg of testGroups) {
        // We try to update both table for backward compatibility/safety, but prioritizing order_tests
        const { error: linkError } = await supabase
          .from('order_tests')
          .update({ sample_id: sample.id })
          .eq('id', otg.id);
        
        if (linkError) {
          console.error('❌ Error linking sample to order_tests:', linkError);
          
          // Fallback check: maybe it IS in order_test_groups?
          const { error: linkError2 } = await supabase
            .from('order_test_groups')
            .update({ sample_id: sample.id })
            .eq('id', otg.id);
            
           if (linkError2) console.error('❌ Error linking sample to order_test_groups either:', linkError2);

        } else {
             console.log(`Linked sample ${sample.id} to test ${otg.test_name} (${otg.id})`);
        }
      }
      
      // Create initial event
      await supabase.from('sample_events').insert({
        sample_id: sample.id,
        event_type: 'created',
        metadata: {
          test_groups: testGroups.map(tg => ({
            id: tg.id,
            test_name: tg.test_name
          }))
        }
      });
      
      samples.push(sample);
    } catch (error) {
      console.error(`❌ Critical error creating sample for type ${sampleType}:`, error);
    }
  }
  
  return samples;
}

/**
 * Mark a sample as collected
 */
export async function collectSample(
  sampleId: string,
  collectedBy: string,
  locationId?: string
): Promise<void> {
  const { data: sampleRow, error: sampleFetchError } = await supabase
    .from('samples')
    .select('order_id')
    .eq('id', sampleId)
    .single();

  if (sampleFetchError || !sampleRow?.order_id) {
    throw new Error(`Failed to load sample before collection: ${sampleFetchError?.message || 'Sample not found'}`);
  }

  const { error } = await supabase
    .from('samples')
    .update({
      status: 'collected',
      collected_at: new Date().toISOString(),
      collected_by: collectedBy,
      collected_at_location_id: locationId
    })
    .eq('id', sampleId);
  
  if (error) {
    throw new Error(`Failed to mark sample as collected: ${error.message}`);
  }
  
  // Log event
  await supabase.from('sample_events').insert({
    sample_id: sampleId,
    event_type: 'collected',
    performed_by: collectedBy,
    location_id: locationId
  });

  database.inventory.consumeScopedItems({
    scope: 'per_sample',
    orderId: sampleRow.order_id,
    sourceRef: sampleId,
    source: 'auto_sample',
    reason: 'Auto-consumed on sample collection',
  }).catch((err) => {
    console.warn('Per-sample inventory consumption failed after sample collection:', err);
  });
}

/**
 * Mark a sample as received at lab
 */
export async function receiveSample(
  sampleId: string,
  receivedBy: string,
  locationId?: string
): Promise<void> {
  const { error } = await supabase
    .from('samples')
    .update({
      status: 'received',
      received_at: new Date().toISOString(),
      current_location_id: locationId,
      transit_status: 'received_at_lab'
    })
    .eq('id', sampleId);
  
  if (error) {
    throw new Error(`Failed to mark sample as received: ${error.message}`);
  }
  
  // Log event
  await supabase.from('sample_events').insert({
    sample_id: sampleId,
    event_type: 'received',
    performed_by: receivedBy,
    location_id: locationId
  });
}

/**
 * Scan sample barcode (for machine integration)
 */
export async function scanSampleBarcode(
  barcodeData: string,
  machineId?: string,
  userId?: string
): Promise<Sample | null> {
  // Lookup sample by barcode or ID
  const { data: sample, error } = await supabase
    .from('samples')
    .select('*')
    .or(`barcode.eq.${barcodeData},id.eq.${barcodeData}`)
    .single();
  
  if (error || !sample) {
    console.error('Sample not found:', error);
    return null;
  }
  
  // Log scan event
  await supabase.from('sample_events').insert({
    sample_id: sample.id,
    event_type: 'scanned',
    performed_by: userId,
    machine_id: machineId,
    notes: machineId ? `Scanned by machine ${machineId}` : 'Manual barcode scan'
  });
  
  return sample;
}

/**
 * Load sample into machine (for analyzer integration)
 */
export async function loadSampleToMachine(
  sampleId: string,
  machineId: string,
  userId?: string
): Promise<void> {
  const { error } = await supabase
    .from('samples')
    .update({
      status: 'processing'
    })
    .eq('id', sampleId);
  
  if (error) {
    throw new Error(`Failed to update sample status: ${error.message}`);
  }
  
  // Log machine load event
  await supabase.from('sample_events').insert({
    sample_id: sampleId,
    event_type: 'loaded_to_machine',
    performed_by: userId,
    machine_id: machineId,
    notes: `Sample loaded into ${machineId} for analysis`
  });
}

/**
 * Reject a sample with reason
 */
export async function rejectSample(
  sampleId: string,
  reason: string,
  rejectedBy: string
): Promise<void> {
  const { error } = await supabase
    .from('samples')
    .update({
      status: 'rejected',
      rejected_at: new Date().toISOString(),
      rejection_reason: reason
    })
    .eq('id', sampleId);
  
  if (error) {
    throw new Error(`Failed to reject sample: ${error.message}`);
  }
  
  // Log rejection event
  await supabase.from('sample_events').insert({
    sample_id: sampleId,
    event_type: 'rejected',
    performed_by: rejectedBy,
    notes: reason,
    metadata: { rejection_reason: reason }
  });
}

/**
 * Create a fresh replacement sample for a rejected sample without creating a new order.
 * The rejected sample remains as audit history; linked test groups move to the new sample.
 */
export async function createReplacementSampleForRejected(
  rejectedSampleId: string,
  createdBy?: string
): Promise<Sample> {
  const { data: rejectedSample, error: sampleError } = await supabase
    .from('samples')
    .select('*')
    .eq('id', rejectedSampleId)
    .single();

  if (sampleError || !rejectedSample) {
    throw new Error(`Failed to load rejected sample: ${sampleError?.message || 'Sample not found'}`);
  }

  if (rejectedSample.status !== 'rejected') {
    throw new Error('Fresh sample can only be received for a rejected sample.');
  }

  const { data: orderRow, error: orderError } = await supabase
    .from('orders')
    .select('id, patient_id, lab_id')
    .eq('id', rejectedSample.order_id)
    .single();

  if (orderError || !orderRow) {
    throw new Error(`Failed to load order for replacement sample: ${orderError?.message || 'Order not found'}`);
  }

  const labId = rejectedSample.lab_id || orderRow.lab_id;
  if (!labId) throw new Error('Lab ID missing for replacement sample.');

  const now = new Date();
  const labCode = await getLabCode(labId);
  const { id: sampleId, barcode } = await generateSampleIdAndBarcode(
    labCode,
    rejectedSample.sample_type || 'Sample',
    labId,
    now,
  );

  const qrCodeData: SampleQRData = {
    sampleId,
    sampleType: rejectedSample.sample_type || 'Sample',
    patientId: orderRow.patient_id,
    orderId: rejectedSample.order_id,
    labCode,
    collectionDate: now.toISOString(),
    barcode,
  };

  const { data: newSample, error: insertError } = await supabase
    .from('samples')
    .insert({
      id: sampleId,
      order_id: rejectedSample.order_id,
      sample_type: rejectedSample.sample_type,
      barcode,
      qr_code_data: qrCodeData,
      container_type: rejectedSample.container_type,
      specimen_site: rejectedSample.specimen_site,
      lab_id: labId,
      status: 'created',
      collected_at_location_id: rejectedSample.collected_at_location_id,
      current_location_id: rejectedSample.current_location_id,
      destination_location_id: rejectedSample.destination_location_id,
      transit_status: 'at_collection_point',
      sample_condition: null,
      checklist_completed: {},
      collection_form_response: {
        replacement_for_sample_id: rejectedSample.id,
        replacement_for_barcode: rejectedSample.barcode,
        replacement_reason: rejectedSample.rejection_reason || null,
      },
    })
    .select()
    .single();

  if (insertError || !newSample) {
    throw new Error(`Failed to create replacement sample: ${insertError?.message || 'Unknown error'}`);
  }

  const { error: groupRelinkError } = await supabase
    .from('order_test_groups')
    .update({ sample_id: newSample.id, sample_condition: null })
    .eq('sample_id', rejectedSample.id);

  if (groupRelinkError) {
    throw new Error(`Failed to link replacement sample to tests: ${groupRelinkError.message}`);
  }

  await supabase
    .from('order_tests')
    .update({ sample_id: newSample.id })
    .eq('sample_id', rejectedSample.id);

  await supabase.from('sample_events').insert({
    sample_id: newSample.id,
    event_type: 'created',
    performed_by: createdBy,
    metadata: {
      replacement_for_sample_id: rejectedSample.id,
      replacement_for_barcode: rejectedSample.barcode,
      rejection_reason: rejectedSample.rejection_reason || null,
    },
  });

  return newSample as Sample;
}

/**
 * Get samples for an order
 */
export async function getSamplesForOrder(orderId: string): Promise<Sample[]> {
  const { data, error } = await supabase
    .from('samples')
    .select('*')
    .eq('order_id', orderId)
    .order('created_at', { ascending: true });
  
  if (error) {
    console.error('Error fetching samples:', error);
    return [];
  }
  
  return data || [];
}

/**
 * Get sample events (audit trail)
 */
export async function getSampleEvents(sampleId: string) {
  const { data, error } = await supabase
    .from('sample_events')
    .select(`
      *,
      users:performed_by(name, email),
      locations:location_id(name)
    `)
    .eq('sample_id', sampleId)
    .order('event_timestamp', { ascending: false });
  
  if (error) {
    console.error('Error fetching sample events:', error);
    return [];
  }
  
  return data || [];
}

/**
 * Get sample with linked test groups
 */
export async function getSampleWithTests(sampleId: string) {
  const { data, error } = await supabase
    .from('samples')
    .select(`
      *,
      order_test_groups!inner(
        id,
        test_name,
        test_groups!inner(
          name,
          sample_type,
          test_group_analytes(
            analytes(*)
          )
        )
      )
    `)
    .eq('id', sampleId)
    .single();
  
  if (error) {
    console.error('Error fetching sample with tests:', error);
    return null;
  }
  
  return data;
}
