// utils/sampleIdGenerator.ts
// Sample ID generation utilities for LIMS

import { supabase } from './supabase';
import { format } from 'date-fns';

/**
 * Standard sample type codes for barcode generation
 * Based on common laboratory abbreviations
 */
export const SAMPLE_TYPE_CODES: Record<string, string> = {
  'Blood': 'BLD',
  'Serum': 'SRM',
  'Plasma': 'PLM',
  'Urine': 'URN',
  'Stool': 'STL',
  'Sputum': 'SPT',
  'CSF': 'CSF',
  'Swab': 'SWB',
  'Saliva': 'SAL',
  'Tissue': 'TIS',
  'Whole Blood': 'WBL',
  'EDTA Blood': 'EDTA',
  'Heparin Plasma': 'HEP',
  'Citrate Plasma': 'CIT'
};

/**
 * Get sample type code (3-letter abbreviation)
 */
export function getSampleTypeCode(sampleType: string): string {
  return SAMPLE_TYPE_CODES[sampleType] || 'UNK';
}

/**
 * Generate unique sample ID in format: {LAB_CODE}-{YYYYMMDD}-{SEQ:04d}-{TYPE}
 * Example: LIMSLAB-20260101-0001-URN
 * 
 * @param labCode - Laboratory code (e.g., "LIMSLAB")
 * @param sampleType - Sample type (e.g., "Urine", "Blood")
 * @param date - Date for the sample (defaults to today)
 * @returns Promise<string> - Generated sample ID
 */
export async function generateSampleId(
  labCode: string,
  sampleType: string,
  date: Date = new Date()
): Promise<string> {
  const dateStr = format(date, 'yyyyMMdd');
  const typeCode = getSampleTypeCode(sampleType);
  
  // Get the latest sample for this date to determine sequence
  const { data, error } = await supabase
    .from('samples')
    .select('id')
    .like('id', `${labCode}-${dateStr}-%`)
    .order('created_at', { ascending: false })
    .limit(1);
  
  if (error) {
    console.error('Error fetching latest sample:', error);
  }
  
  let sequence = 1;
  
  if (data && data.length > 0) {
    const lastId = data[0].id;
    // Parse sequence from format: LAB-YYYYMMDD-NNNN-TYPE
    const parts = lastId.split('-');
    if (parts.length >= 3) {
      const seqStr = parts[2];
      const seqNum = parseInt(seqStr, 10);
      if (!isNaN(seqNum)) {
        sequence = seqNum + 1;
      }
    }
  }
  
  // Format: LIMSLAB-20260101-0001-URN
  return `${labCode}-${dateStr}-${sequence.toString().padStart(4, '0')}-${typeCode}`;
}

/**
 * Generate a numeric barcode compatible with most instruments.
 * Format: YYMMDDSSSS (Date + Sequence)
 * Example: 2601010001
 */
export function generateNumericBarcode(date: Date, sequence: number): string {
  const dateStr = format(date, 'yyMMdd');
  const seqStr = sequence.toString().padStart(4, '0');
  return `${dateStr}${seqStr}`;
}

/**
 * Generate both Sample ID and Numeric Barcode
 */
export async function generateSampleIdAndBarcode(
  labCode: string,
  sampleType: string,
  labId?: string,
  date: Date = new Date()
): Promise<{ id: string; barcode: string }> {
  const dateStr = format(date, 'yyyyMMdd');
  const typeCode = getSampleTypeCode(sampleType);
  
  // 1. Determine Sequence for Sample ID (Lab-Specific)
  const { data: idData } = await supabase
    .from('samples')
    .select('id')
    .like('id', `${labCode}-${dateStr}-%`)
    .order('created_at', { ascending: false })
    .limit(1);
  
  let idSequence = 1;
  
  if (idData && idData.length > 0) {
    const lastId = idData[0].id;
    const parts = lastId.split('-');
    if (parts.length >= 3) {
      const seqStr = parts[2];
      const seqNum = parseInt(seqStr, 10);
      if (!isNaN(seqNum)) {
        idSequence = seqNum + 1;
      }
    }
  }

  // 2. Determine Sequence for Barcode. Scope by lab when a lab id is available
  // so two labs can each use the same daily sequence without blocking each other.
  // Format: YYMMDDSSSS
  const barcodeDatePrefix = format(date, 'yyMMdd');
  let barcodeQuery = supabase
    .from('samples')
    .select('barcode')
    .like('barcode', `${barcodeDatePrefix}%`)
    .order('barcode', { ascending: false })
    .limit(1);

  if (labId) {
    barcodeQuery = barcodeQuery.eq('lab_id', labId);
  }

  const { data: barcodeData } = await barcodeQuery;

  let barcodeSequence = 1;

  if (barcodeData && barcodeData.length > 0) {
    // Try to find the highest numeric suffix
    const lastBarcode = barcodeData[0].barcode;
    if (lastBarcode && lastBarcode.length >= 10) {
      const seqSuffix = lastBarcode.substring(barcodeDatePrefix.length);
      const seqNum = parseInt(seqSuffix, 10);
      if (!isNaN(seqNum)) {
        barcodeSequence = seqNum + 1;
      }
    }
  }
  
  const id = `${labCode}-${dateStr}-${idSequence.toString().padStart(4, '0')}-${typeCode}`;
  
  // Use the lab-scoped barcode sequence when labId is provided.
  const barcode = generateNumericBarcode(date, barcodeSequence);
  
  return { id, barcode };
}

/**
 * Get lab code from lab ID
 * Falls back to a default if not found
 */
export async function getLabCode(labId: string): Promise<string> {
  const { data, error } = await supabase
    .from('labs')
    .select('code')
    .eq('id', labId)
    .single();
  
  if (error || !data) {
    console.error('Error fetching lab code:', error);
    return 'LIMSLAB'; // Default fallback
  }
  
  return data.code || 'LIMSLAB';
}

/**
 * Validate sample ID format
 */
export function isValidSampleId(sampleId: string): boolean {
  // Format: LAB-YYYYMMDD-NNNN-TYPE
  const pattern = /^[A-Z0-9]+-\d{8}-\d{4}-[A-Z]{3,4}$/;
  return pattern.test(sampleId);
}

/**
 * Parse sample ID components
 */
export function parseSampleId(sampleId: string): {
  labCode: string;
  date: string;
  sequence: number;
  typeCode: string;
} | null {
  if (!isValidSampleId(sampleId)) {
    return null;
  }
  
  const parts = sampleId.split('-');
  return {
    labCode: parts[0],
    date: parts[1],
    sequence: parseInt(parts[2], 10),
    typeCode: parts[3]
  };
}

/**
 * Get standard container/tube type for a sample type
 */
export function getContainerType(sampleType: string): string {
  const containerMap: Record<string, string> = {
    'Blood': 'Vacutainer',
    'Serum': 'SST Tube',
    'Plasma': 'EDTA Tube',
    'Urine': 'Urine Container',
    'Stool': 'Stool Container',
    'Sputum': 'Sputum Container',
    'CSF': 'Sterile Tube',
    'Swab': 'Swab Transport Media',
    'EDTA Blood': 'EDTA Tube',
    'Heparin Plasma': 'Heparin Tube',
    'Citrate Plasma': 'Citrate Tube'
  };
  
  return containerMap[sampleType] || 'Standard Container';
}

/**
 * Get standard tube color for a sample type (if not specified in test_groups)
 */
export function getStandardTubeColor(sampleType: string): string {
  const colorMap: Record<string, string> = {
    'Blood': '#DC2626',        // Red
    'Serum': '#F59E0B',        // Gold/Amber
    'Plasma': '#8B5CF6',       // Purple
    'EDTA Blood': '#9333EA',   // Purple/Lavender
    'Heparin Plasma': '#16A34A', // Green
    'Citrate Plasma': '#2563EB', // Blue
    'Urine': '#EAB308',        // Yellow
    'Stool': '#92400E',        // Brown
    'CSF': '#6B7280',          // Gray
    'Swab': '#9CA3AF'          // Light Gray
  };
  
  return colorMap[sampleType] || '#DC2626'; // Default to Red
}
