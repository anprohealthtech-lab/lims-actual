
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { lab_id } = await req.json();
    if (!lab_id) throw new Error('lab_id is required');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.log(`🔍 Sanity check for lab: ${lab_id}`);

    // 1. Load all global catalog entries (name + analyte count via junction table)
    const { data: globalCatalog } = await supabase
      .from('global_test_catalog')
      .select('id, name, code, group_interpretation');

    if (!globalCatalog || globalCatalog.length === 0) {
      return new Response(JSON.stringify({ error: 'No global catalog entries found' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Build catalog lookup by name (lowercase for case-insensitive match)
    const catalogByName = new Map<string, typeof globalCatalog[0]>();
    const catalogById = new Map<string, typeof globalCatalog[0]>();
    for (const entry of globalCatalog) {
      catalogByName.set(entry.name.toLowerCase(), entry);
      catalogById.set(entry.id, entry);
    }

    // 2. Load all catalog analyte IDs per catalog entry
    const allCatalogIds = globalCatalog.map(e => e.id);
    const catalogAnalyteMap = new Map<string, Set<string>>(); // catalog_id → Set<analyte_id>
    const catalogAnalyteMeta = new Map<string, { analyte_id: string; section_heading: string | null; sort_order: number; is_header: boolean }[]>();

    for (let i = 0; i < allCatalogIds.length; i += 500) {
      const { data: metaRows } = await supabase
        .from('global_test_catalog_analytes')
        .select('catalog_id, analyte_id, section_heading, sort_order, is_header')
        .in('catalog_id', allCatalogIds.slice(i, i + 500))
        .order('sort_order', { ascending: true });

      for (const row of (metaRows || [])) {
        if (!catalogAnalyteMap.has(row.catalog_id)) catalogAnalyteMap.set(row.catalog_id, new Set());
        catalogAnalyteMap.get(row.catalog_id)!.add(row.analyte_id);

        if (!catalogAnalyteMeta.has(row.catalog_id)) catalogAnalyteMeta.set(row.catalog_id, []);
        catalogAnalyteMeta.get(row.catalog_id)!.push(row);
      }
    }

    // 3. Load all lab test groups
    const { data: labGroups } = await supabase
      .from('test_groups')
      .select('id, name, code, group_interpretation')
      .eq('lab_id', lab_id);

    if (!labGroups || labGroups.length === 0) {
      return new Response(JSON.stringify({ error: 'No test groups found for this lab' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 4. Load all analyte links for lab groups in one query
    const labGroupIds = labGroups.map(g => g.id);
    const labAnalyteMap = new Map<string, Set<string>>(); // test_group_id → Set<analyte_id>
    const labSectionMap = new Map<string, boolean>(); // test_group_id → has any section_heading

    for (let i = 0; i < labGroupIds.length; i += 500) {
      const { data: tgaRows } = await supabase
        .from('test_group_analytes')
        .select('test_group_id, analyte_id, section_heading, sort_order')
        .in('test_group_id', labGroupIds.slice(i, i + 500));

      for (const row of (tgaRows || [])) {
        if (!labAnalyteMap.has(row.test_group_id)) labAnalyteMap.set(row.test_group_id, new Set());
        labAnalyteMap.get(row.test_group_id)!.add(row.analyte_id);

        if (row.section_heading) labSectionMap.set(row.test_group_id, true);
      }
    }

    // 5. Build per-group report
    type GroupStatus = 'ok' | 'missing_analytes' | 'no_catalog_match' | 'needs_interpretation';
    const results: {
      name: string;
      lab_group_id: string;
      catalog_match: string | null;
      status: GroupStatus[];
      lab_analyte_count: number;
      catalog_analyte_count: number;
      missing_analyte_count: number;
      extra_analyte_count: number;
      has_section_headings: boolean;
      has_interpretation: boolean;
      catalog_has_interpretation: boolean;
    }[] = [];

    for (const labGroup of labGroups) {
      const catalogEntry = catalogByName.get(labGroup.name.toLowerCase());
      const labAnalytes = labAnalyteMap.get(labGroup.id) || new Set<string>();
      const status: GroupStatus[] = [];

      if (!catalogEntry) {
        results.push({
          name: labGroup.name,
          lab_group_id: labGroup.id,
          catalog_match: null,
          status: ['no_catalog_match'],
          lab_analyte_count: labAnalytes.size,
          catalog_analyte_count: 0,
          missing_analyte_count: 0,
          extra_analyte_count: 0,
          has_section_headings: labSectionMap.get(labGroup.id) ?? false,
          has_interpretation: !!labGroup.group_interpretation,
          catalog_has_interpretation: false,
        });
        continue;
      }

      const catalogAnalytes = catalogAnalyteMap.get(catalogEntry.id) || new Set<string>();
      const missingAnalytes = [...catalogAnalytes].filter(id => !labAnalytes.has(id));
      const extraAnalytes = [...labAnalytes].filter(id => !catalogAnalytes.has(id));

      if (missingAnalytes.length > 0) status.push('missing_analytes');
      if (catalogEntry.group_interpretation && !labGroup.group_interpretation) status.push('needs_interpretation');
      if (status.length === 0) status.push('ok');

      results.push({
        name: labGroup.name,
        lab_group_id: labGroup.id,
        catalog_match: catalogEntry.id,
        status,
        lab_analyte_count: labAnalytes.size,
        catalog_analyte_count: catalogAnalytes.size,
        missing_analyte_count: missingAnalytes.length,
        extra_analyte_count: extraAnalytes.length,
        has_section_headings: labSectionMap.get(labGroup.id) ?? false,
        has_interpretation: !!labGroup.group_interpretation,
        catalog_has_interpretation: !!catalogEntry.group_interpretation,
      });
    }

    // 6. Summary counts
    const summary = {
      total_lab_groups: labGroups.length,
      ok: results.filter(r => r.status.includes('ok')).length,
      missing_analytes: results.filter(r => r.status.includes('missing_analytes')).length,
      no_catalog_match: results.filter(r => r.status.includes('no_catalog_match')).length,
      needs_interpretation: results.filter(r => r.status.includes('needs_interpretation')).length,
      missing_section_headings: results.filter(r => !r.has_section_headings && r.lab_analyte_count > 0).length,
    };

    // Sort: problems first, then ok
    results.sort((a, b) => {
      const aOk = a.status.includes('ok') ? 1 : 0;
      const bOk = b.status.includes('ok') ? 1 : 0;
      return aOk - bOk || a.name.localeCompare(b.name);
    });

    console.log(`✅ Sanity check complete. Summary:`, summary);

    return new Response(JSON.stringify({ lab_id, summary, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Sanity check error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
