import { supabase } from './supabase';

export interface AnalyteWithRange {
  id: string;
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

export async function resolveReferenceRanges(
  orderId: string,
  testGroupId: string,
  analytes: Array<{ id: string; name: string; value: string; unit: string }>
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
    // 1. Try exact ID match
    let aiResult = data.results.find((r: any) => r.analyte_id === analyte.id);

    // 2. Try exact Name match (if ID fails)
    if (!aiResult) {
      aiResult = data.results.find((r: any) => r.analyte_name === analyte.name);
    }

    // 3. Try Fuzzy Name match (if exact name fails)
    if (!aiResult) {
      const normalize = (str: string) => str.toLowerCase().replace(/[^a-z0-9]/g, '');
      const paramNameSlug = normalize(analyte.name);
      aiResult = data.results.find((r: any) => {
        const resNameSlug = normalize(r.analyte_name);
        return paramNameSlug.includes(resNameSlug) || resNameSlug.includes(paramNameSlug);
      });
    }

    // 4. Fallback: If only one result and one input, assume match
    if (!aiResult && analytes.length === 1 && data.results.length === 1) {
      aiResult = data.results[0];
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
