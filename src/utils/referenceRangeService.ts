import { supabase } from './supabase';

export interface AnalyteWithRange {
  id: string;
  lab_analyte_id?: string | null;
  name: string;
  value: string;
  unit: string;
  ref_low?: number;
  ref_high?: number;
  critical_low?: number;
  critical_high?: number;
  flag?: 'N' | 'L' | 'H' | 'LL' | 'HH';
  reference?: string;
  applied_rule?: string;
  reasoning?: string;
  confidence?: number;
  used_reference_range?: string;
}

export interface ReferenceRangeTarget {
  analyte_id?: string | null;
  id?: string | null;
  lab_analyte_id?: string | null;
  name?: string | null;
  parameter?: string | null;
  analyte_name?: string | null;
}

const normalizeRangeName = (value: unknown): string =>
  String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');

export function isPlaceholderReferenceRange(range?: string | null): boolean {
  const normalized = String(range || '').trim().toLowerCase();
  if (!normalized) return true;
  return (
    normalized.includes('age-specific') ||
    normalized.includes('dynamic') ||
    normalized.includes('interpretation') ||
    normalized.includes('see lab') ||
    normalized.includes('refer to lab')
  );
}

export function getStaticReferenceRange(input: {
  lab_specific_reference_range?: string | null;
  lab_reference_range?: string | null;
  reference_range?: string | null;
  reference_range_male?: string | null;
  reference_range_female?: string | null;
  gender?: string | null;
}): string {
  const gender = String(input.gender || '').trim().toLowerCase();
  return (
    input.lab_specific_reference_range ||
    input.lab_reference_range ||
    (gender.startsWith('m') ? input.reference_range_male : null) ||
    (gender.startsWith('f') ? input.reference_range_female : null) ||
    input.reference_range ||
    ''
  );
}

export function findResolvedReferenceRange<T extends ReferenceRangeTarget>(
  resolvedRanges: AnalyteWithRange[] | null | undefined,
  target: T,
): AnalyteWithRange | undefined {
  if (!resolvedRanges?.length) return undefined;

  const targetAnalyteId = target.analyte_id || target.id || null;
  const targetName = target.name || target.parameter || target.analyte_name || '';
  const targetNameSlug = normalizeRangeName(targetName);

  return resolvedRanges.find((range) => {
    if (range.lab_analyte_id && target.lab_analyte_id === range.lab_analyte_id) return true;
    if (targetAnalyteId && range.id === targetAnalyteId) return true;
    const rangeNameSlug = normalizeRangeName(range.name);
    return Boolean(targetNameSlug && rangeNameSlug && targetNameSlug === rangeNameSlug);
  });
}

export function normalizeResultFlagForSave(
  flag: string | null | undefined,
  value?: string | number | null,
): string | null {
  const normalized = String(flag || '').trim();
  if (!normalized) {
    const hasValue = value !== null && value !== undefined && String(value).trim() !== '';
    return hasValue ? 'normal' : null;
  }

  const lower = normalized.toLowerCase();
  if (lower === 'n' || lower === 'normal') return 'normal';
  return normalized;
}

export async function resolveReferenceRanges(
  orderId: string,
  testGroupId: string,
  analytes: Array<{ id: string; lab_analyte_id?: string | null; name: string; value: string; unit: string }>
): Promise<AnalyteWithRange[]> {
  
  console.log('Invoking AI (Anthropic) for TestGroup:', testGroupId);

  const { data, error } = await supabase.functions.invoke('resolve-reference-ranges', {
    body: { orderId, testGroupId, analytes }
  });

  if (error) {
    console.error('Error resolving reference ranges:', error);
    // Silent fail: return analytes as is
    return analytes.map(a => ({ ...a }));
  }

  if (!data?.success) {
      console.error('AI Function returned failure:', data?.error);
      return analytes.map(a => ({ ...a }));
  }

  // Merge AI results with analyte data
  return analytes.map(analyte => {
    let aiResult = findResolvedReferenceRange(
      data.results.map((result: any) => ({
        ...result,
        id: result.analyte_id,
        name: result.analyte_name,
      })),
      analyte,
    );

    // Fallback: If only one result and one input, assume match
    if (!aiResult && analytes.length === 1 && data.results.length === 1) {
      aiResult = {
        ...data.results[0],
        id: data.results[0].analyte_id,
        name: data.results[0].analyte_name,
      };
    }

    if (aiResult) {
      console.log(`Matched ${analyte.name} to AI result ${aiResult.analyte_name}`);
      return {
        ...analyte,
        ...aiResult,
        // Ensure used_reference_range is explicitly preserved
        used_reference_range: aiResult.used_reference_range
      };
    }
    
    return analyte;
  });
}
