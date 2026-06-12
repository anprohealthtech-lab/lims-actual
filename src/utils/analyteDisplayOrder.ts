import type { SupabaseClient } from '@supabase/supabase-js';

export type AnalyteDisplayMetadata = {
  analyte_id: string;
  sort_order?: number | null;
  display_order?: number | null;
  section_heading?: string | null;
};

export type OrderedAnalyteRow = {
  analyte_id?: string | null;
  section_heading?: string | null;
  sort_order?: number | null;
  display_order?: number | null;
};

export const applyAnalyteDisplayOrder = <T extends OrderedAnalyteRow>(
  rows: T[],
  metadata: AnalyteDisplayMetadata[],
): T[] => {
  const metadataByAnalyteId = new Map(metadata.map((item) => [item.analyte_id, item]));

  return rows
    .map((row, originalIndex) => {
      const display = row.analyte_id ? metadataByAnalyteId.get(row.analyte_id) : undefined;
      return {
        row: {
          ...row,
          section_heading: display?.section_heading ?? row.section_heading ?? null,
          sort_order: display?.sort_order ?? row.sort_order ?? null,
          display_order: display?.display_order ?? row.display_order ?? null,
        } as T,
        originalIndex,
        order: display?.sort_order ?? display?.display_order ?? Number.MAX_SAFE_INTEGER,
      };
    })
    .sort((a, b) => a.order - b.order || a.originalIndex - b.originalIndex)
    .map(({ row }) => row);
};

export const loadOrderedAnalyteRows = async <T extends OrderedAnalyteRow>(
  supabase: SupabaseClient,
  testGroupId: string | null | undefined,
  rows: T[],
): Promise<T[]> => {
  if (!testGroupId || rows.length === 0) return rows;

  const { data, error } = await supabase
    .from('test_group_analytes')
    .select('analyte_id, sort_order, display_order, section_heading')
    .eq('test_group_id', testGroupId);

  if (error) {
    console.warn('Unable to load analyte display order:', error);
    return rows;
  }

  return applyAnalyteDisplayOrder(rows, (data || []) as AnalyteDisplayMetadata[]);
};
