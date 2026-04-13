// services/sampleService.ts
// Core sample management service for LIMS

import { database, supabase } from '../utils/supabase';
import { 
  generateSampleIdAndBarcode,
  getLabCode, 
  getContainerType, 
  getStandardTubeColor 
} from '../utils/sampleIdGenerator';
import { SampleQRData } from '../utils/qrCodeGenerator';

/**
 * Sample entity type
 */
export interface Sample {
  id: string;
  order_id: string;
  sample_type: string;
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

/**
 * Create samples for an order based on test group requirements
 * Groups tests by sample type and creates one sample per unique type
 */
export async function createSamplesForOrder(
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
      const { id: sampleId, barcode } = await generateSampleIdAndBarcode(labCode, sampleType);
      
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
