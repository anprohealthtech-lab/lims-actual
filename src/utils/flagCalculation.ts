// Flag calculation utilities for lab results
// This module wraps the comprehensive flagDetermination system

import { 
  determineFlag, 
  flagToDisplayString, 
  isAbnormalFlag, 
  isCriticalFlag,
  type FlagResult,
  type AnalyteConfig 
} from './flagDetermination';

export interface ResultValue {
  parameter: string;
  value: string;
  unit: string;
  reference_range: string;
  reference_range_male?: string;
  reference_range_female?: string;
  low_critical?: string | number;
  high_critical?: string | number;
  expected_normal_values?: string[];
  flag?: string;
}

/**
 * Calculate flag based on value and reference range
 * Uses comprehensive flag determination that handles:
 * - Numeric values with ranges (10-40, <200, >50)
 * - Gender-specific ranges
 * - Critical values
 * - Qualitative values (Positive/Negative)
 * - Semi-quantitative values (1+, 2+, Trace)
 */
export const calculateFlag = (
  value: string, 
  referenceRange: string, 
  patientGender?: string,
  lowCritical?: string | number,
  highCritical?: string | number,
  referenceRangeMale?: string,
  referenceRangeFemale?: string,
  expectedNormalValues?: string[]
): string => {
  if (!value) return '';
  
  const config: AnalyteConfig = {
    reference_range: referenceRange,
    reference_range_male: referenceRangeMale,
    reference_range_female: referenceRangeFemale,
    low_critical: lowCritical,
    high_critical: highCritical,
    expected_normal_values: expectedNormalValues
  };
  
  const result = determineFlag(value, config, { gender: patientGender });
  return flagToDisplayString(result.flag);
};

/**
 * Legacy range parser for backwards compatibility
 */
const calculateFlagForRange = (value: number, range: string): string => {
  // Handle ranges like "<200"
  if (range.startsWith('<')) {
    const maxValue = parseFloat(range.substring(1));
    return value >= maxValue ? 'H' : '';
  }
  
  // Handle ranges like ">50"
  if (range.startsWith('>')) {
    const minValue = parseFloat(range.substring(1));
    return value <= minValue ? 'L' : '';
  }
  
  // Handle ranges like "10-40"
  if (range.includes('-')) {
    const parts = range.split('-');
    if (parts.length === 2) {
      const minValue = parseFloat(parts[0]);
      const maxValue = parseFloat(parts[1]);
      
      if (!isNaN(minValue) && !isNaN(maxValue)) {
        if (value < minValue) return 'L';
        if (value > maxValue) return 'H';
        return ''; // Normal range
      }
    }
  }
  
  // Handle ranges like "10 - 40" (with spaces)
  const dashMatch = range.match(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/);
  if (dashMatch) {
    const minValue = parseFloat(dashMatch[1]);
    const maxValue = parseFloat(dashMatch[2]);
    
    if (value < minValue) return 'L';
    if (value > maxValue) return 'H';
    return ''; // Normal range
  }
  
  return ''; // Cannot determine flag
};

/**
 * Automatically calculate flags for all result values
 * Enhanced to use comprehensive flag determination
 */
export const calculateFlagsForResults = (values: ResultValue[], patientGender?: string): ResultValue[] => {
  return values.map(value => ({
    ...value,
    flag: value.flag || calculateFlag(
      value.value, 
      value.reference_range, 
      patientGender,
      value.low_critical,
      value.high_critical,
      value.reference_range_male,
      value.reference_range_female,
      value.expected_normal_values
    )
  }));
};

/**
 * Check if any values have abnormal flags
 */
export const hasAbnormalFlags = (values: ResultValue[]): boolean => {
  return values.some(value => {
    const flag = value.flag || calculateFlag(value.value, value.reference_range);
    return flag === 'H' || flag === 'L' || flag === 'H*' || flag === 'L*' || flag === 'A';
  });
};

/**
 * Check if any values have critical flags
 */
export const hasCriticalFlags = (values: ResultValue[]): boolean => {
  return values.some(value => {
    const flag = value.flag || calculateFlag(value.value, value.reference_range);
    return flag === 'H*' || flag === 'L*';
  });
};

/**
 * Get flag description
 */
export const getFlagDescription = (flag: string): string => {
  switch (flag) {
    case 'H': return 'High';
    case 'L': return 'Low';
    case 'H*': return 'Critical High';
    case 'L*': return 'Critical Low';
    case 'A': return 'Abnormal';
    case 'C': return 'Critical'; // Legacy
    default: return 'Normal';
  }
};

/**
 * Get flag color class for UI
 */
export const getFlagColor = (flag?: string): string => {
  switch (flag) {
    case 'H': return 'text-red-600 bg-red-100';
    case 'L': return 'text-blue-600 bg-blue-100';
    case 'H*': return 'text-red-800 bg-red-200 font-bold';
    case 'L*': return 'text-blue-800 bg-blue-200 font-bold';
    case 'A': return 'text-orange-600 bg-orange-100';
    case 'C': return 'text-yellow-600 bg-yellow-100'; // Legacy
    default: return '';
  }
};

/**
 * Get flag severity level (for sorting)
 */
export const getFlagSeverity = (flag?: string): number => {
  switch (flag) {
    case 'H*': return 4; // Critical High
    case 'L*': return 4; // Critical Low
    case 'H': return 2;  // High
    case 'L': return 2;  // Low
    case 'A': return 1;  // Abnormal
    default: return 0;   // Normal
  }
};