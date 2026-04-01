
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
    // 1. Parse Input
    const { lab_id, mode, test_group_name } = await req.json();
    if (!lab_id) {
      throw new Error('lab_id is required');
    }

    const isSync = mode === 'sync';   // Sync mode updates existing records
    const isReset = mode === 'reset'; // Reset mode deletes ALL and restores from global
    const isSingle = mode === 'single'; // Single group sync by name (non-destructive)

    // 2. Init Supabase Client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.log(`🚀 Starting ${isReset ? 'RESET' : isSync ? 'SYNC' : isSingle ? 'SINGLE' : 'ONBOARD'} for Lab: ${lab_id}`);

    // --- SINGLE MODE: non-destructive sync of one test group by name ---
    if (isSingle) {
      if (!test_group_name) throw new Error('test_group_name is required for single mode');

      console.log(`🔍 SINGLE mode: lab_id="${lab_id}", test_group_name="${test_group_name}"`);

      // Find entry in global catalog (case-insensitive)
      const { data: catalogEntry, error: catalogError } = await supabaseClient
        .from('global_test_catalog')
        .select('id, name, code, group_interpretation, default_ai_processing_type, group_level_prompt, ai_config')
        .ilike('name', test_group_name)
        .limit(1)
        .maybeSingle();

      console.log(`📚 Global catalog lookup: found=${!!catalogEntry}, name="${catalogEntry?.name}", error=${catalogError?.message}`);

      if (!catalogEntry) {
        return new Response(JSON.stringify({
          success: false,
          error: `'${test_group_name}' not found in global catalog`,
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // Find lab's test group by name (limit(1) guards against duplicate names in the same lab)
      const { data: labGroup, error: labGroupError } = await supabaseClient
        .from('test_groups')
        .select('id, name, lab_id, group_interpretation')
        .eq('lab_id', lab_id)
        .ilike('name', test_group_name)
        .limit(1)
        .maybeSingle();

      console.log(`🏥 Lab group lookup: found=${!!labGroup}, name="${labGroup?.name}", lab_id_match="${labGroup?.lab_id}", error=${labGroupError?.message}`);

      if (!labGroup) {
        // Also check if group exists under a different lab_id (to help diagnose mismatches)
        const { data: anyMatch } = await supabaseClient
          .from('test_groups')
          .select('id, name, lab_id')
          .ilike('name', test_group_name)
          .limit(3);
        console.log(`🔎 Same-name groups in ANY lab: ${JSON.stringify(anyMatch)}`);
        return new Response(JSON.stringify({
          success: false,
          error: `'${test_group_name}' not found in this lab's test groups`,
          debug: { lab_id_used: lab_id, any_matches: anyMatch },
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // Load analyte metadata from catalog junction table
      const { data: catalogMeta } = await supabaseClient
        .from('global_test_catalog_analytes')
        .select('analyte_id, section_heading, sort_order, display_order, is_visible, is_header, header_name, custom_reference_range, custom_name, custom_unit, custom_interpretation_low, custom_interpretation_normal, custom_interpretation_high, custom_method, custom_expected_normal_values, custom_expected_value_codes, default_value, display_name, custom_value_type')
        .eq('catalog_id', catalogEntry.id)
        .order('sort_order', { ascending: true });

      // Load existing analyte links for this lab test group
      const { data: existingLinks } = await supabaseClient
        .from('test_group_analytes')
        .select('analyte_id')
        .eq('test_group_id', labGroup.id);

      const existingAnalyteSet = new Set((existingLinks || []).map((l: any) => l.analyte_id));
      const toAdd = (catalogMeta || []).filter((m: any) => !existingAnalyteSet.has(m.analyte_id));
      const toUpdate = (catalogMeta || []).filter((m: any) => existingAnalyteSet.has(m.analyte_id));

      let analytesAdded = 0;
      let analytesUpdated = 0;
      let analytesHydrated = 0;

      if (toAdd.length > 0) {
        // Ensure new analytes exist in lab_analytes (FK guard)
        const labAnalytePayload = toAdd.map((m: any) => {
          const entry: Record<string, any> = { lab_id, analyte_id: m.analyte_id, is_active: true, visible: true };
          if (m.custom_name != null) entry.lab_specific_name = m.custom_name;
          if (m.custom_unit != null) entry.lab_specific_unit = m.custom_unit;
          if (m.custom_interpretation_low != null) entry.lab_specific_interpretation_low = m.custom_interpretation_low;
          if (m.custom_interpretation_normal != null) entry.lab_specific_interpretation_normal = m.custom_interpretation_normal;
          if (m.custom_interpretation_high != null) entry.lab_specific_interpretation_high = m.custom_interpretation_high;
          if (m.custom_method != null) entry.lab_specific_method = m.custom_method;
          if (m.custom_reference_range != null) entry.lab_specific_reference_range = m.custom_reference_range;
          if (m.custom_value_type != null) entry.value_type = m.custom_value_type;
          if (m.default_value != null) entry.default_value = m.default_value;
          if (m.display_name != null) entry.display_name = m.display_name;
          if (m.custom_expected_normal_values != null && m.custom_expected_normal_values !== '[]') entry.expected_normal_values = m.custom_expected_normal_values;
          if (m.custom_expected_value_codes != null && m.custom_expected_value_codes !== '{}') entry.expected_value_codes = m.custom_expected_value_codes;
          return entry;
        });
        await supabaseClient.from('lab_analytes').upsert(labAnalytePayload, { onConflict: 'lab_id,analyte_id', ignoreDuplicates: true });
        analytesHydrated = toAdd.length;
      }

      // Build analyte_id → lab_analytes.id map for ALL analytes in this group (toAdd + toUpdate).
      // Run after the above upsert so any newly added lab_analytes rows are present.
      const allGroupAnalyteIds = [...new Set([
        ...toAdd.map((m: any) => m.analyte_id),
        ...toUpdate.map((m: any) => m.analyte_id),
      ])];
      const singleLabAnalyteIdMap = new Map<string, string>();
      if (allGroupAnalyteIds.length > 0) {
        const { data: singleLabAnalyteRows } = await supabaseClient
          .from('lab_analytes')
          .select('id, analyte_id')
          .eq('lab_id', lab_id)
          .in('analyte_id', allGroupAnalyteIds);
        for (const row of (singleLabAnalyteRows || [])) singleLabAnalyteIdMap.set(row.analyte_id, row.id);
      }

      if (toAdd.length > 0) {
        const linkPayload = toAdd.map((m: any) => ({
          test_group_id: labGroup.id,
          analyte_id: m.analyte_id,
          lab_analyte_id: singleLabAnalyteIdMap.get(m.analyte_id) ?? null,
          is_visible: m.is_visible ?? true,
          sort_order: m.sort_order,
          display_order: m.display_order ?? m.sort_order,
          section_heading: m.section_heading ?? null,
          is_header: m.is_header ?? false,
          header_name: m.header_name ?? null,
          custom_reference_range: m.custom_reference_range ?? null,
        }));

        const { error: linkErr } = await supabaseClient
          .from('test_group_analytes')
          .upsert(linkPayload, { onConflict: 'test_group_id,analyte_id', ignoreDuplicates: true });

        if (!linkErr) analytesAdded = toAdd.length;
        else console.error('Single mode link error:', linkErr);
      }

      // Update sort_order, section_heading, and lab_analyte_id for already-linked analytes
      if (toUpdate.length > 0) {
        for (const m of toUpdate) {
          await supabaseClient
            .from('test_group_analytes')
            .update({
              sort_order: m.sort_order,
              display_order: m.display_order ?? m.sort_order,
              section_heading: m.section_heading ?? null,
              // Backfill lab_analyte_id if it was missing (e.g. rows created before this fix)
              ...(singleLabAnalyteIdMap.get(m.analyte_id)
                ? { lab_analyte_id: singleLabAnalyteIdMap.get(m.analyte_id) }
                : {}),
            })
            .eq('test_group_id', labGroup.id)
            .eq('analyte_id', m.analyte_id);
        }
        analytesUpdated = toUpdate.length;
      }

      // Sync group_interpretation only if global has one and lab doesn't yet
      let interpretationSynced = false;
      if (catalogEntry.group_interpretation && !labGroup.group_interpretation) {
        const { error: interpErr } = await supabaseClient
          .from('test_groups')
          .update({ group_interpretation: catalogEntry.group_interpretation })
          .eq('id', labGroup.id);
        if (!interpErr) interpretationSynced = true;
      }

      // Seed report sections for this test group (non-destructive)
      let sectionsAdded = 0;
      const { data: catalogSections } = await supabaseClient
        .from('global_test_catalog_sections')
        .select('section_type, section_name, display_order, default_content, predefined_options, is_required, is_editable, placeholder_key, allow_images, allow_technician_entry')
        .eq('catalog_id', catalogEntry.id);

      if (catalogSections && catalogSections.length > 0) {
        const { data: existingSections } = await supabaseClient
          .from('lab_template_sections')
          .select('section_type')
          .eq('lab_id', lab_id)
          .eq('test_group_id', labGroup.id);

        const existingTypes = new Set((existingSections || []).map((s: any) => s.section_type));
        const sectionsToInsert = catalogSections
          .filter((s: any) => !existingTypes.has(s.section_type))
          .map((s: any) => ({
            lab_id,
            test_group_id: labGroup.id,
            section_type: s.section_type,
            section_name: s.section_name,
            display_order: s.display_order,
            default_content: s.default_content,
            predefined_options: s.predefined_options ?? [],
            is_required: s.is_required ?? false,
            is_editable: s.is_editable ?? true,
            placeholder_key: s.placeholder_key,
            allow_images: s.allow_images ?? false,
            allow_technician_entry: s.allow_technician_entry ?? false,
          }));

        if (sectionsToInsert.length > 0) {
          const { error: secErr } = await supabaseClient
            .from('lab_template_sections')
            .insert(sectionsToInsert);
          if (!secErr) sectionsAdded = sectionsToInsert.length;
          else console.error('Single mode section insert error:', secErr);
        }
      }

      console.log(`✅ Single sync: ${labGroup.name} — added ${analytesAdded}, updated ${analytesUpdated} analytes, ${sectionsAdded} sections, interpretation synced: ${interpretationSynced}`);

      return new Response(JSON.stringify({
        success: true,
        mode: 'single',
        test_group_name: labGroup.name,
        catalog_analyte_count: (catalogMeta || []).length,
        existing_analyte_count: existingAnalyteSet.size,
        analytesAdded,
        analytesUpdated,
        analytesHydrated,
        interpretationSynced,
        sectionsAdded,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // --- Counters for Logging ---
    let stats: Record<string, number> = {
      analytesHydrated: 0,
      testsCreated: 0,
      testsUpdated: 0,
      testsSkipped: 0,
      testsDeleted: 0,
      duplicatesRemoved: 0,
      templatesCloned: 0,
      packagesCreated: 0,
      invoiceTemplatesCreated: 0,
      sectionsCreated: 0,
      orphanLabAnalytesDeleted: 0,
      orphanLabTemplatesDeleted: 0
    };

    // --- A. Hydrate Analytes (Safe Upsert) ---
    console.log('...Hydrating Analytes');
    const { data: globalAnalytes } = await supabaseClient.from('analytes').select('id').eq('is_global', true);

    if (globalAnalytes && globalAnalytes.length > 0) {
      stats.analytesHydrated = globalAnalytes.length;
      console.log(`   Found ${globalAnalytes.length} global analytes to sync.`);
      
      const labAnalytesPayload = globalAnalytes.map(ga => ({
        lab_id: lab_id,
        analyte_id: ga.id,
        is_active: true,
        visible: true
      }));

      // Chunk into 500 rows to stay well under Supabase's 1000-row limit
      const ANALYTE_CHUNK = 500;
      for (let i = 0; i < labAnalytesPayload.length; i += ANALYTE_CHUNK) {
        const { error: laError } = await supabaseClient
          .from('lab_analytes')
          .upsert(labAnalytesPayload.slice(i, i + ANALYTE_CHUNK), { onConflict: 'lab_id,analyte_id', ignoreDuplicates: true });
        if (laError) console.error(`Error hydrating analytes (chunk ${i}):`, laError);
      }
      console.log(`   ✅ Upserted ${labAnalytesPayload.length} is_global analytes into lab_analytes`);
    }

    // --- B. Handle RESET Mode - Delete ALL test groups first ---
    if (isReset) {
      console.log('🗑️ RESET MODE: Deleting all existing test groups for lab...');
      
      // Get all test groups for this lab
      const { data: existingTestGroups } = await supabaseClient
        .from('test_groups')
        .select('id')
        .eq('lab_id', lab_id);
      
      if (existingTestGroups && existingTestGroups.length > 0) {
        const testGroupIds = existingTestGroups.map(tg => tg.id);
        
        // Delete related records first (foreign key constraints)
        // 1. Delete test_group_analytes
        await supabaseClient
          .from('test_group_analytes')
          .delete()
          .in('test_group_id', testGroupIds);
        
        // 2. Delete lab_templates linked to these test groups
        await supabaseClient
          .from('lab_templates')
          .delete()
          .in('test_group_id', testGroupIds);
        
        // 3. Delete package_test_groups
        await supabaseClient
          .from('package_test_groups')
          .delete()
          .in('test_group_id', testGroupIds);
        
        // 4. Delete test_workflow_map 
        await supabaseClient
          .from('test_workflow_map')
          .delete()
          .in('test_group_id', testGroupIds);
        
        // 5. Finally delete the test groups themselves
        const { error: deleteError } = await supabaseClient
          .from('test_groups')
          .delete()
          .eq('lab_id', lab_id);
        
        if (deleteError) {
          console.error('Error deleting test groups:', deleteError);
        } else {
          stats.testsDeleted = existingTestGroups.length;
          console.log(`   🗑️ Deleted ${existingTestGroups.length} existing test groups`);
        }
      }
    }

    // --- C. Hydrate Test Groups (BULK approach to avoid timeouts) ---
    console.log('...Hydrating Test Groups');
    const { data: globalTestGroups } = await supabaseClient.from('global_test_catalog').select('*');

    // Bulk-fetch analyte metadata (section_heading, sort_order) from junction table
    const allCatalogIds = (globalTestGroups || []).map((g: any) => g.id);
    const catalogAnalyteMeta = new Map<string, { analyte_id: string; section_heading: string | null; sort_order: number; display_order: number | null; is_visible: boolean; is_header: boolean; header_name: string | null; custom_reference_range: string | null; custom_name: string | null; custom_unit: string | null; custom_interpretation_low: string | null; custom_interpretation_normal: string | null; custom_interpretation_high: string | null; custom_method: string | null; custom_expected_normal_values: any; custom_expected_value_codes: any; default_value: string | null; display_name: string | null; custom_value_type: string | null }[]>();
    if (allCatalogIds.length > 0) {
      for (let i = 0; i < allCatalogIds.length; i += 500) {
        const { data: metaRows } = await supabaseClient
          .from('global_test_catalog_analytes')
          .select('catalog_id, analyte_id, section_heading, sort_order, display_order, is_visible, is_header, header_name, custom_reference_range, custom_name, custom_unit, custom_interpretation_low, custom_interpretation_normal, custom_interpretation_high, custom_method, custom_expected_normal_values, custom_expected_value_codes, default_value, display_name, custom_value_type')
          .in('catalog_id', allCatalogIds.slice(i, i + 500))
          .order('sort_order', { ascending: true });
        for (const row of (metaRows || [])) {
          if (!catalogAnalyteMeta.has(row.catalog_id)) catalogAnalyteMeta.set(row.catalog_id, []);
          catalogAnalyteMeta.get(row.catalog_id)!.push(row);
        }
      }
      console.log(`   📋 Loaded analyte metadata for ${catalogAnalyteMeta.size} catalog entries`);
    }

    if (globalTestGroups && globalTestGroups.length > 0) {
      console.log(`   Found ${globalTestGroups.length} global test groups.`);

      // --- BULK PRE-FETCH: Load all existing test groups for this lab in ONE query ---
      const { data: existingLabGroups } = await supabaseClient
        .from('test_groups')
        .select('id, code, name, default_ai_processing_type')
        .eq('lab_id', lab_id);

      // Build lookup Maps for O(1) access
      const existingByCode = new Map<string, { id: string; code: string; name: string; default_ai_processing_type: string }>();
      const existingByName = new Map<string, { id: string; code: string; name: string; default_ai_processing_type: string }>();
      for (const eg of (existingLabGroups || [])) {
        existingByCode.set(eg.code, eg);
        existingByName.set(eg.name, eg);
      }

      // --- BULK DUPLICATE REMOVAL (non-reset only): find groups with same name, different code ---
      if (!isReset) {
        const nameCounts = new Map<string, { id: string; code: string; name: string }[]>();
        for (const eg of (existingLabGroups || [])) {
          if (!nameCounts.has(eg.name)) nameCounts.set(eg.name, []);
          nameCounts.get(eg.name)!.push(eg);
        }
        const duplicateIds: string[] = [];
        for (const [, matches] of nameCounts) {
          if (matches.length > 1) {
            const globalMatch = matches.find(m => existingByCode.has(m.code));
            const keepId = globalMatch?.id || matches[0].id;
            for (const m of matches) {
              if (m.id !== keepId) {
                duplicateIds.push(m.id);
                stats.duplicatesRemoved++;
              }
            }
          }
        }
        if (duplicateIds.length > 0) {
          console.log(`   ⚠️ Removing ${duplicateIds.length} duplicate test groups...`);
          await supabaseClient.from('test_group_analytes').delete().in('test_group_id', duplicateIds);
          await supabaseClient.from('lab_templates').delete().in('test_group_id', duplicateIds);
          await supabaseClient.from('package_test_groups').delete().in('test_group_id', duplicateIds);
          await supabaseClient.from('test_workflow_map').delete().in('test_group_id', duplicateIds);
          await supabaseClient.from('test_groups').delete().in('id', duplicateIds);
          // Remove from maps
          for (const id of duplicateIds) {
            for (const [k, v] of existingByCode) { if (v.id === id) existingByCode.delete(k); }
            for (const [k, v] of existingByName) { if (v.id === id) existingByName.delete(k); }
          }
        }
      }

      // --- Separate globals into: needs create vs needs update vs skip ---
      const toCreate: typeof globalTestGroups = [];
      const toUpdate: { gtg: typeof globalTestGroups[0]; existingId: string }[] = [];
      const toSkip: typeof globalTestGroups = [];

      for (const gtg of globalTestGroups) {
        const existing = existingByCode.get(gtg.code) || existingByName.get(gtg.name);
        if (!existing) {
          toCreate.push(gtg);
        } else if (isSync || isReset) {
          toUpdate.push({ gtg, existingId: existing.id });
        } else {
          toSkip.push(gtg);
          stats.testsSkipped++;
        }
      }

      console.log(`   📊 To create: ${toCreate.length}, update: ${toUpdate.length}, skip: ${toSkip.length}`);

      // --- BATCH CREATE new test groups in chunks of 50 ---
      const CHUNK = 50;
      const createdMap = new Map<string, string>(); // global code → new lab test_group_id

      for (let i = 0; i < toCreate.length; i += CHUNK) {
        const chunk = toCreate.slice(i, i + CHUNK);
        const { data: newGroups, error: batchErr } = await supabaseClient
          .from('test_groups')
          .insert(chunk.map(gtg => ({
            lab_id: lab_id,
            name: gtg.name,
            code: gtg.code,
            category: gtg.department_default || gtg.category || 'General',
            clinical_purpose: gtg.description || gtg.name,
            price: gtg.default_price || 0,
            turnaround_time: '24 Hours',
            sample_type: gtg.specimen_type_default || 'EDTA Blood',
            is_active: true,
            to_be_copied: false,
            default_ai_processing_type: gtg.default_ai_processing_type || 'ocr_report',
            group_level_prompt: gtg.group_level_prompt || null,
            ai_config: gtg.ai_config || {},
            group_interpretation: gtg.group_interpretation || null
          })))
          .select('id, code');

        if (batchErr) {
          console.error(`Batch insert error (chunk ${i}):`, batchErr);
          continue;
        }
        for (const ng of (newGroups || [])) {
          createdMap.set(ng.code, ng.id);
        }
        stats.testsCreated += (newGroups || []).length;
        console.log(`   ✅ Created batch ${Math.floor(i/CHUNK)+1}: ${(newGroups||[]).length} test groups`);
      }

      // Helper: global_test_catalog stores analytes as a JSON string OR native array
      const parseAnalyteIds = (raw: unknown): string[] => {
        if (Array.isArray(raw)) return raw as string[];
        if (typeof raw === 'string') {
          try { const parsed = JSON.parse(raw); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
        }
        return [];
      };

      // --- Ensure ALL analyte IDs referenced in the catalog exist in lab_analytes ---
      // Many catalog entries reference analytes that are NOT is_global=true (from source labs).
      // We must hydrate them before inserting test_group_analytes (FK constraint).
      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const allCatalogAnalyteIds = new Set<string>();
      // Collect from OLD jsonb array (filtered to valid UUIDs only)
      for (const gtg of globalTestGroups) {
        for (const aid of parseAnalyteIds(gtg.analytes)) {
          if (UUID_RE.test(aid)) allCatalogAnalyteIds.add(aid);
        }
      }
      // Also collect from NEW junction table — these are the authoritative IDs going forward
      for (const rows of catalogAnalyteMeta.values()) {
        for (const row of rows) allCatalogAnalyteIds.add(row.analyte_id);
      }
      // validAnalyteIdsSet: only IDs that actually exist in the analytes table (safe to FK-reference)
      let validAnalyteIdsSet = new Set<string>();
      // analyte_id → lab_analytes.id map — populated inside the if block below once lab_analytes are hydrated
      const labAnalyteIdMap = new Map<string, string>();
      if (allCatalogAnalyteIds.size > 0) {
        // Verify these analyte IDs actually exist in the analytes table
        const catalogIds = [...allCatalogAnalyteIds];
        // Supabase .in() supports up to 1500 items; chunk if needed
        let existingIds: string[] = [];
        for (let i = 0; i < catalogIds.length; i += 1000) {
          const { data: existingAnalytes } = await supabaseClient
            .from('analytes')
            .select('id')
            .in('id', catalogIds.slice(i, i + 1000));
          existingIds = existingIds.concat((existingAnalytes || []).map((a: any) => a.id));
        }
        validAnalyteIdsSet = new Set(existingIds);
        const missing = catalogIds.length - existingIds.length;
        console.log(`   ℹ️ Catalog analyte check: ${existingIds.length} found, ${missing} missing (will fallback to source-lab lookup)`);

        // --- FALLBACK: for catalog analyte IDs that don't exist, look up from source lab test groups ---
        // The global_test_catalog.source_lab_id's test_group_analytes has the CURRENT valid analyte IDs.
        if (missing > 0) {
          const missingSet = new Set(catalogIds.filter(id => !validAnalyteIdsSet.has(id)));
          // Build map: catalog_analyte_id → source_lab_id for groups that reference missing IDs
          const sourceLabIds = new Set<string>();
          const catalogCodeToSourceLab = new Map<string, string>();
          for (const gtg of globalTestGroups) {
            if (!gtg.source_lab_id) continue;
            const ids = parseAnalyteIds(gtg.analytes);
            if (ids.some(id => missingSet.has(id))) {
              sourceLabIds.add(gtg.source_lab_id);
              catalogCodeToSourceLab.set(gtg.code, gtg.source_lab_id);
            }
          }
          // For each source lab, fetch its test_group_analytes (with analyte id + name)
          const sourceLabAnalyteMap = new Map<string, string[]>(); // source_lab test_group code → analyte IDs
          for (const srcLabId of sourceLabIds) {
            const { data: srcGroups } = await supabaseClient
              .from('test_groups')
              .select('code, test_group_analytes(analyte_id)')
              .eq('lab_id', srcLabId);
            for (const sg of (srcGroups || [])) {
              const aids = (sg.test_group_analytes || []).map((tga: any) => tga.analyte_id);
              if (aids.length > 0) sourceLabAnalyteMap.set(sg.code, aids);
            }
          }
          // Merge valid source-lab analyte IDs into validAnalyteIdsSet
          let fallbackCount = 0;
          for (const [code, aids] of sourceLabAnalyteMap) {
            for (const aid of aids) {
              if (!validAnalyteIdsSet.has(aid)) {
                // Verify this ID exists in the analytes table
                const { data: check } = await supabaseClient.from('analytes').select('id').eq('id', aid).maybeSingle();
                if (check) { validAnalyteIdsSet.add(aid); fallbackCount++; }
              }
            }
            // Also remap: gtg.analytes missing IDs → replace with source lab's current IDs
            // Store in a per-code override map used during link building
          }
          // Build override map: catalog code → resolved analyte IDs (mix of catalog + fallback)
          for (const gtg of globalTestGroups) {
            const srcIds = sourceLabAnalyteMap.get(gtg.code);
            if (srcIds && srcIds.length > 0) {
              // Store on a side-channel map keyed by code
              (gtg as any)._resolvedAnalyteIds = srcIds.filter(id => validAnalyteIdsSet.has(id));
            }
          }
          console.log(`   🔄 Fallback resolved ${fallbackCount} additional analyte IDs from source labs`);
        }

        const allValidIds = [...validAnalyteIdsSet];
        // Build analyte_id → first-seen catalog custom fields map so lab_analytes gets populated
        const analyteCustomFieldsMap = new Map<string, Record<string, any>>();
        for (const metaList of catalogAnalyteMeta.values()) {
          for (const m of metaList) {
            if (!analyteCustomFieldsMap.has(m.analyte_id)) {
              const custom: Record<string, any> = {};
              if (m.custom_name != null) custom.lab_specific_name = m.custom_name;
              if (m.custom_unit != null) custom.lab_specific_unit = m.custom_unit;
              if (m.custom_interpretation_low != null) custom.lab_specific_interpretation_low = m.custom_interpretation_low;
              if (m.custom_interpretation_normal != null) custom.lab_specific_interpretation_normal = m.custom_interpretation_normal;
              if (m.custom_interpretation_high != null) custom.lab_specific_interpretation_high = m.custom_interpretation_high;
              if (m.custom_method != null) custom.lab_specific_method = m.custom_method;
              if (m.custom_reference_range != null) custom.lab_specific_reference_range = m.custom_reference_range;
              if (m.custom_value_type != null) custom.value_type = m.custom_value_type;
              if (m.default_value != null) custom.default_value = m.default_value;
              if (m.display_name != null) custom.display_name = m.display_name;
              if (m.custom_expected_normal_values != null && m.custom_expected_normal_values !== '[]') custom.expected_normal_values = m.custom_expected_normal_values;
              if (m.custom_expected_value_codes != null && m.custom_expected_value_codes !== '{}') custom.expected_value_codes = m.custom_expected_value_codes;
              if (Object.keys(custom).length > 0) analyteCustomFieldsMap.set(m.analyte_id, custom);
            }
          }
        }

        // Pass 1: ensure all analyte rows exist (ignoreDuplicates — never clobbers existing rows)
        const catalogLabPayload = allValidIds.map(aid => ({ lab_id: lab_id, analyte_id: aid, is_active: true, visible: true }));
        for (let i = 0; i < catalogLabPayload.length; i += 500) {
          const { error: cErr } = await supabaseClient
            .from('lab_analytes')
            .upsert(catalogLabPayload.slice(i, i + 500), { onConflict: 'lab_id,analyte_id', ignoreDuplicates: true });
          if (cErr) console.error(`Error hydrating catalog analytes (chunk ${i}):`, cErr);
        }
        console.log(`   ✅ Ensured ${allValidIds.length} catalog analytes in lab_analytes`);

        // Pass 2: apply catalog custom fields (section A created rows without them; this fills them in)
        // Upsert WITHOUT ignoreDuplicates so ON CONFLICT only updates the custom columns in the payload,
        // leaving is_active / visible and other lab-admin settings untouched.
        const customFieldsPayload = [...analyteCustomFieldsMap.entries()]
          .filter(([aid]) => validAnalyteIdsSet.has(aid))
          .map(([aid, custom]) => ({ lab_id: lab_id, analyte_id: aid, ...custom }));
        if (customFieldsPayload.length > 0) {
          for (let i = 0; i < customFieldsPayload.length; i += 500) {
            const { error: cfErr } = await supabaseClient
              .from('lab_analytes')
              .upsert(customFieldsPayload.slice(i, i + 500), { onConflict: 'lab_id,analyte_id' });
            if (cfErr) console.error(`Error applying catalog custom fields (chunk ${i}):`, cfErr);
          }
          console.log(`   📝 Applied catalog custom fields to ${customFieldsPayload.length} analytes`);
        }
        stats.analytesHydrated += allValidIds.length;

        // Populate analyte_id → lab_analytes.id map to set lab_analyte_id in test_group_analytes
        for (let i = 0; i < allValidIds.length; i += 1000) {
          const { data: laRows } = await supabaseClient
            .from('lab_analytes')
            .select('id, analyte_id')
            .eq('lab_id', lab_id)
            .in('analyte_id', allValidIds.slice(i, i + 1000));
          for (const row of (laRows || [])) labAnalyteIdMap.set(row.analyte_id, row.id);
        }
        console.log(`   📍 lab_analyte_id map: ${labAnalyteIdMap.size} entries`);
      }

      // --- BATCH INSERT analyte links for newly created groups ---
      const analyteLinksPayload: {
        test_group_id: string; analyte_id: string; lab_analyte_id?: string | null; is_visible: boolean;
        sort_order?: number; display_order?: number | null;
        section_heading?: string | null; is_header?: boolean; header_name?: string | null;
        custom_reference_range?: string | null;
      }[] = [];
      for (const gtg of toCreate) {
        const newId = createdMap.get(gtg.code);
        if (!newId) continue;
        const metaRows = catalogAnalyteMeta.get(gtg.id);
        if (metaRows && metaRows.length > 0) {
          // Use junction table metadata — preserves section_heading + sort_order
          for (const m of metaRows) {
            if (!validAnalyteIdsSet.has(m.analyte_id)) continue;
            analyteLinksPayload.push({
              test_group_id: newId,
              analyte_id: m.analyte_id,
              lab_analyte_id: labAnalyteIdMap.get(m.analyte_id) ?? null,
              is_visible: m.is_visible,
              sort_order: m.sort_order,
              display_order: m.display_order,
              section_heading: m.section_heading,
              is_header: m.is_header,
              header_name: m.header_name,
              custom_reference_range: m.custom_reference_range,
            });
          }
        } else {
          // Fallback: no junction table metadata yet — use plain ID list (legacy / pre-migration)
          const analyteIds: string[] = (gtg as any)._resolvedAnalyteIds
            || parseAnalyteIds(gtg.analytes).filter((id: string) => UUID_RE.test(id) && validAnalyteIdsSet.has(id));
          for (let idx = 0; idx < analyteIds.length; idx++) {
            analyteLinksPayload.push({ test_group_id: newId, analyte_id: analyteIds[idx], lab_analyte_id: labAnalyteIdMap.get(analyteIds[idx]) ?? null, is_visible: true, sort_order: idx });
          }
        }
      }
      if (analyteLinksPayload.length > 0) {
        for (let i = 0; i < analyteLinksPayload.length; i += 500) {
          const { error: laErr } = await supabaseClient
            .from('test_group_analytes')
            .upsert(analyteLinksPayload.slice(i, i + 500), { onConflict: 'test_group_id,analyte_id' });
          if (laErr) console.error(`Analyte link batch error (chunk ${i}):`, laErr);
        }
        console.log(`   🔗 Linked ${analyteLinksPayload.length} analyte associations`);
      }

      // --- UPDATE existing test groups in sync/reset mode (parallel updates) ---
      if (toUpdate.length > 0) {
        const updateResults = await Promise.all(
          toUpdate.map(({ gtg, existingId }) =>
            supabaseClient
              .from('test_groups')
              .update({
                code: gtg.code,
                default_ai_processing_type: gtg.default_ai_processing_type,
                group_level_prompt: gtg.group_level_prompt || null,
                ai_config: gtg.ai_config || {},
                sample_type: gtg.specimen_type_default || 'EDTA Blood',
                category: gtg.department_default || 'General',
                // Only propagate group_interpretation if global catalog has one set
                ...(gtg.group_interpretation ? { group_interpretation: gtg.group_interpretation } : {})
              })
              .eq('id', existingId)
              .then(({ error }) => {
                if (error) console.error(`Failed to update test group ${gtg.code}:`, error);
                return !error;
              })
          )
        );
        stats.testsUpdated = updateResults.filter(Boolean).length;
        console.log(`   🔄 Updated ${stats.testsUpdated} test groups (parallel)`);
      }

      // Re-sync analyte links for updated groups in sync/reset mode
      // Non-destructive: only ADD missing analytes — never delete existing lab-custom links
      if ((isSync || isReset) && toUpdate.length > 0) {
        const resyncPayload: {
          test_group_id: string; analyte_id: string; lab_analyte_id?: string | null; is_visible: boolean;
          sort_order?: number; display_order?: number | null;
          section_heading?: string | null; is_header?: boolean; header_name?: string | null;
          custom_reference_range?: string | null;
        }[] = [];
        for (const { gtg, existingId } of toUpdate) {
          const metaRows = catalogAnalyteMeta.get(gtg.id);
          if (metaRows && metaRows.length > 0) {
            for (const m of metaRows) {
              if (!validAnalyteIdsSet.has(m.analyte_id)) continue;
              resyncPayload.push({
                test_group_id: existingId,
                analyte_id: m.analyte_id,
                lab_analyte_id: labAnalyteIdMap.get(m.analyte_id) ?? null,
                is_visible: m.is_visible,
                sort_order: m.sort_order,
                display_order: m.display_order,
                section_heading: m.section_heading,
                is_header: m.is_header,
                header_name: m.header_name,
                custom_reference_range: m.custom_reference_range,
              });
            }
          } else {
            const analyteIds: string[] = (gtg as any)._resolvedAnalyteIds
              || parseAnalyteIds(gtg.analytes).filter((id: string) => UUID_RE.test(id) && validAnalyteIdsSet.has(id));
            for (let idx = 0; idx < analyteIds.length; idx++) {
              resyncPayload.push({ test_group_id: existingId, analyte_id: analyteIds[idx], lab_analyte_id: labAnalyteIdMap.get(analyteIds[idx]) ?? null, is_visible: true, sort_order: idx });
            }
          }
        }
        if (resyncPayload.length > 0) {
          let resyncLinked = 0;
          for (let i = 0; i < resyncPayload.length; i += 500) {
            const { error: rsErr } = await supabaseClient
              .from('test_group_analytes')
              .upsert(resyncPayload.slice(i, i + 500), { onConflict: 'test_group_id,analyte_id' });
            if (rsErr) console.error(`Re-sync analyte link error (chunk ${i}):`, rsErr);
            else resyncLinked += resyncPayload.slice(i, i + 500).length;
          }
          console.log(`   🔗 Re-synced ${resyncLinked}/${resyncPayload.length} analyte links for updated groups`);
        } else {
          console.warn(`   ⚠️ resyncPayload is empty — no valid analyte IDs found for ${toUpdate.length} updated groups`);
        }
      }

      // --- BULK TEMPLATE CLONING: pre-fetch all existing lab_templates in ONE query ---
      const groupsNeedingTemplates = globalTestGroups.filter(gtg => gtg.default_template_id);
      if (groupsNeedingTemplates.length > 0) {
        // Get all lab_template test_group_ids for this lab in one query
        const { data: existingTemplates } = await supabaseClient
          .from('lab_templates')
          .select('test_group_id')
          .eq('lab_id', lab_id);
        const existingTemplateGroupIds = new Set((existingTemplates || []).map(t => t.test_group_id));

        // Collect unique global template IDs needed
        const globalTemplateIds = [...new Set(groupsNeedingTemplates.map(g => g.default_template_id).filter(Boolean))];
        const { data: globalTemplates } = await supabaseClient
          .from('global_template_catalog')
          .select('*')
          .in('id', globalTemplateIds);
        const globalTemplateMap = new Map((globalTemplates || []).map(t => [t.id, t]));

        // Build list of templates to insert
        const templatesToInsert: object[] = [];
        for (const gtg of groupsNeedingTemplates) {
          const labGroupId = createdMap.get(gtg.code)
            || existingByCode.get(gtg.code)?.id
            || existingByName.get(gtg.name)?.id;
          if (!labGroupId) continue;
          if (existingTemplateGroupIds.has(labGroupId)) continue; // already has one
          const globalTmpl = globalTemplateMap.get(gtg.default_template_id);
          if (!globalTmpl) continue;
          templatesToInsert.push({
            lab_id: lab_id,
            test_group_id: labGroupId,
            template_name: `Report - ${gtg.name}`,
            category: 'report',
            gjs_html: globalTmpl.html_content,
            gjs_css: globalTmpl.css_content,
            is_default: false,
            is_active: true
          });
        }

        if (templatesToInsert.length > 0) {
          for (let i = 0; i < templatesToInsert.length; i += 50) {
            const { error: tmplErr } = await supabaseClient
              .from('lab_templates')
              .insert(templatesToInsert.slice(i, i + 50));
            if (tmplErr) console.error(`Template batch error (chunk ${i}):`, tmplErr);
          }
          stats.templatesCloned = templatesToInsert.length;
          console.log(`   📄 Cloned ${templatesToInsert.length} report templates`);
        }
      }
    }

    // --- D. Hydrate Packages (Check First) ---
    console.log('...Hydrating Packages');
    const { data: globalPackages } = await supabaseClient.from('global_package_catalog').select('*');
    
    if (globalPackages) {
      console.log(`   Found ${globalPackages.length} global packages.`);
      // Pre-fetch all existing package names for this lab in ONE query (avoids N+1)
      const { data: existingPkgs } = await supabaseClient
        .from('packages')
        .select('id, name')
        .eq('lab_id', lab_id);
      const existingPkgNames = new Set((existingPkgs || []).map(p => p.name));

      for (const gp of globalPackages) {
         const existingPkg = existingPkgNames.has(gp.name);

         if (!existingPkg) {
            const { data: newPkg, error: pkgError } = await supabaseClient
              .from('packages')
              .insert({
                lab_id: lab_id,
                name: gp.name,
                description: gp.description || gp.name,
                category: 'General',
                price: gp.base_price || 0,
                is_active: true
              })
              .select('id')
              .single();

            if (pkgError) {
               console.error(`Failed to create package ${gp.name}:`, pkgError);
               continue;
            }
            stats.packagesCreated++;

            // Link Test Groups
            const codes = gp.test_group_codes; 
            if (Array.isArray(codes) && codes.length > 0) {
               const { data: labTestGroups } = await supabaseClient
                 .from('test_groups')
                 .select('id')
                 .eq('lab_id', lab_id)
                 .in('code', codes);

               if (labTestGroups && labTestGroups.length > 0) {
                 const pkgLinks = labTestGroups.map(bg => ({
                   package_id: newPkg.id,
                   test_group_id: bg.id
                 }));
                 await supabaseClient.from('package_test_groups').insert(pkgLinks);
               }
            }
         }
      }
    }
    
    // --- E. Global Templates (Generic) ---
    // Skipping generic for now to reduce noise as per previous logic
    
    // --- E2. Invoice Templates ---
    // Check if lab already has invoice templates, if not create defaults
    console.log('...Checking Invoice Templates');
    const { data: existingInvoiceTemplates, error: invTmplErr } = await supabaseClient
      .from('invoice_templates')
      .select('id')
      .eq('lab_id', lab_id);
    
    if (!invTmplErr && (!existingInvoiceTemplates || existingInvoiceTemplates.length === 0)) {
      console.log('   📄 Creating default invoice templates for lab...');
      
      // Default invoice templates
      const defaultInvoiceTemplates = [
        {
          lab_id: lab_id,
          template_name: "Standard Invoice",
          template_description: "Clean and professional invoice template with all essential details",
          category: "standard",
          is_active: true,
          is_default: true,
          include_payment_terms: true,
          payment_terms_text: "Payment due within 15 days from invoice date",
          include_tax_breakdown: true,
          include_bank_details: false,
          gjs_html: `<div class="invoice-wrapper">
    <div class="invoice-header">
      <div class="lab-info">
        <h1 class="lab-name">{{lab_name}}</h1>
        <p class="lab-details">{{lab_address}}</p>
        <p class="lab-details">Phone: {{lab_phone}} | Email: {{lab_email}}</p>
        <p class="lab-details">License No: {{lab_license}} | Reg. No: {{lab_registration}}</p>
      </div>
      <div class="invoice-meta">
        <h2 class="invoice-title">INVOICE</h2>
        <p><strong>Invoice No:</strong> {{invoice_number}}</p>
        <p><strong>Date:</strong> {{invoice_date}}</p>
        <p><strong>Due Date:</strong> {{due_date}}</p>
      </div>
    </div>
    {{partial_badge}}
    <div class="invoice-body">
      <div class="bill-to">
        <h3>Bill To:</h3>
        <p class="patient-name"><strong>{{patient_name}}</strong></p>
        <p>{{patient_address}}</p>
        <p>Phone: {{patient_phone}}</p>
        <p>Referring Doctor: {{doctor}}</p>
        <p>Payment Type: {{payment_type}}</p>
      </div>
      <table class="items-table">
        <thead><tr><th>Test / Service</th><th style="text-align: center;">Qty</th><th style="text-align: right;">Rate</th><th style="text-align: right;">Amount</th></tr></thead>
        <tbody>{{invoice_items}}</tbody>
      </table>
      <div class="totals-section">
        <table class="totals-table">
          <tr><td>Subtotal:</td><td>{{subtotal}}</td></tr>
          <tr><td>Discount:</td><td>-{{discount}}</td></tr>
          <tr><td>Tax (GST 18%):</td><td>{{tax}}</td></tr>
          <tr class="total-row"><td><strong>Total Amount:</strong></td><td><strong>{{total}}</strong></td></tr>
          <tr class="paid-row"><td>Amount Paid:</td><td>{{amount_paid}}</td></tr>
          <tr class="balance-row"><td><strong>Balance Due:</strong></td><td><strong>{{balance_due}}</strong></td></tr>
        </table>
      </div>
      <div class="terms-section">{{payment_terms}}</div>
      {{bank_details}}
      <div class="notes-section"><p><strong>Notes:</strong> {{notes}}</p></div>
    </div>
    <div class="invoice-footer">
      <p>{{tax_disclaimer}}</p>
      <p class="thank-you"><em>Thank you for choosing our services!</em></p>
      <p class="print-date">Generated on {{current_date}}</p>
    </div>
  </div>`,
          gjs_css: `body { font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif; margin: 0; padding: 0; }
  .invoice-wrapper { max-width: 210mm; margin: 0 auto; padding: 20mm; background: white; }
  .invoice-header { display: flex; justify-content: space-between; border-bottom: 3px solid #2563eb; padding-bottom: 20px; margin-bottom: 30px; }
  .lab-name { font-size: 24px; color: #1e40af; margin-bottom: 10px; }
  .lab-details { font-size: 13px; color: #6b7280; margin: 4px 0; }
  .invoice-meta { text-align: right; }
  .invoice-title { font-size: 32px; color: #2563eb; margin-bottom: 10px; }
  .bill-to { margin-bottom: 30px; padding: 20px; background: #f3f4f6; border-radius: 8px; }
  .bill-to h3 { color: #1f2937; margin-bottom: 15px; }
  .patient-name { font-size: 16px; color: #111827; margin: 8px 0; }
  .items-table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
  .items-table th { background: #2563eb; color: white; padding: 12px; text-align: left; font-weight: 600; }
  .items-table td { border-bottom: 1px solid #e5e7eb; padding: 12px; }
  .totals-section { margin-left: auto; width: 350px; }
  .totals-table { width: 100%; }
  .totals-table td { padding: 10px; border-bottom: 1px solid #e5e7eb; }
  .totals-table td:last-child { text-align: right; font-weight: 500; }
  .total-row { background: #f3f4f6; font-size: 18px; }
  .total-row td { padding: 15px 10px; font-weight: bold; color: #1f2937; }
  .balance-row { background: #fef3c7; font-size: 16px; }
  .balance-row td { padding: 12px 10px; font-weight: bold; color: #92400e; }
  .terms-section, .bank-details { margin: 20px 0; padding: 15px; background: #fef3c7; border-left: 4px solid #f59e0b; border-radius: 4px; }
  .notes-section { margin: 20px 0; padding: 15px; background: #f0fdf4; border-left: 4px solid #10b981; border-radius: 4px; }
  .invoice-footer { margin-top: 50px; text-align: center; padding-top: 20px; border-top: 2px solid #e5e7eb; color: #6b7280; font-size: 12px; }
  .thank-you { font-size: 14px; color: #059669; margin: 10px 0; }
  .partial-invoice-badge { position: absolute; top: 30px; right: 30px; background: #f97316; color: white; padding: 12px 24px; font-weight: bold; font-size: 14px; border-radius: 4px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }`
        },
        {
          lab_id: lab_id,
          template_name: "Minimal Invoice",
          template_description: "Simple and clean invoice design with minimal styling",
          category: "minimal",
          is_active: true,
          is_default: false,
          include_payment_terms: true,
          payment_terms_text: "Payment due on receipt",
          include_tax_breakdown: true,
          include_bank_details: false,
          gjs_html: `<div class="minimal-invoice">
    <div class="header-simple"><h1>{{lab_name}}</h1><p>{{lab_phone}} | {{lab_email}}</p></div>
    <div class="invoice-info"><h2>Invoice {{invoice_number}}</h2><p>Date: {{invoice_date}} | Due: {{due_date}}</p></div>
    {{partial_badge}}
    <div class="recipient"><strong>{{patient_name}}</strong><br>{{patient_phone}}<br>Doctor: {{doctor}}</div>
    <table class="simple-table"><tr><th>Item</th><th>Qty</th><th>Rate</th><th>Total</th></tr>{{invoice_items}}</table>
    <div class="simple-totals">
      <p>Subtotal: {{subtotal}}</p><p>Discount: -{{discount}}</p><p>Tax: {{tax}}</p>
      <p class="total-line"><strong>Total: {{total}}</strong></p>
      <p>Paid: {{amount_paid}}</p><p class="balance-line"><strong>Due: {{balance_due}}</strong></p>
    </div>
    {{payment_terms}}{{bank_details}}
    <div class="footer-simple"><p>Thank you!</p></div>
  </div>`,
          gjs_css: `body { font-family: Arial, sans-serif; margin: 0; padding: 0; }
  .minimal-invoice { max-width: 800px; margin: 20px auto; padding: 40px; }
  .header-simple { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #000; padding-bottom: 15px; }
  .header-simple h1 { font-size: 28px; margin-bottom: 10px; }
  .invoice-info { text-align: right; margin-bottom: 30px; }
  .invoice-info h2 { font-size: 24px; }
  .recipient { margin-bottom: 30px; line-height: 1.8; }
  .simple-table { width: 100%; border-collapse: collapse; margin: 30px 0; }
  .simple-table th, .simple-table td { border: 1px solid #ddd; padding: 10px; text-align: left; }
  .simple-table th { background: #000; color: #fff; }
  .simple-totals { margin-left: auto; width: 300px; padding: 20px; background: #f9f9f9; }
  .simple-totals p { margin: 8px 0; }
  .total-line { font-size: 18px; border-top: 2px solid #000; padding-top: 10px; margin-top: 10px; }
  .balance-line { font-size: 16px; color: #d00; margin-top: 10px; }
  .footer-simple { text-align: center; margin-top: 50px; padding-top: 20px; border-top: 1px solid #ddd; }
  .partial-invoice-badge { position: absolute; top: 20px; right: 20px; background: #ff6b6b; color: white; padding: 8px 16px; font-weight: bold; }`
        },
        {
          lab_id: lab_id,
          template_name: "Modern Invoice",
          template_description: "Contemporary design with vibrant colors and modern aesthetics",
          category: "modern",
          is_active: true,
          is_default: false,
          include_payment_terms: true,
          payment_terms_text: "Please pay within 7 days. Thank you!",
          include_tax_breakdown: true,
          include_bank_details: true,
          gjs_html: `<div class="modern-invoice">
    <div class="modern-header">
      <div class="header-content">
        <div class="logo-section"><h1 class="modern-title">{{lab_name}}</h1><p class="modern-subtitle">Premium Healthcare Services</p></div>
        <div class="invoice-label"><div class="label-badge">INVOICE</div><div class="invoice-num">{{invoice_number}}</div></div>
      </div>
    </div>
    {{partial_badge}}
    <div class="modern-container">
      <div class="info-cards">
        <div class="info-card card-from"><div class="card-header">From</div><div class="card-content"><p><strong>{{lab_name}}</strong></p><p>{{lab_address}}</p><p>📞 {{lab_phone}}</p><p>✉ {{lab_email}}</p></div></div>
        <div class="info-card card-to"><div class="card-header">To</div><div class="card-content"><p><strong>{{patient_name}}</strong></p><p>{{patient_address}}</p><p>📞 {{patient_phone}}</p><p>👨‍⚕️ Dr. {{doctor}}</p></div></div>
        <div class="info-card card-dates"><div class="card-header">Details</div><div class="card-content"><p><strong>Date:</strong> {{invoice_date}}</p><p><strong>Due:</strong> {{due_date}}</p><p><strong>Type:</strong> {{payment_type}}</p></div></div>
      </div>
      <div class="items-modern">
        <div class="section-title">Services Rendered</div>
        <table class="modern-table"><thead><tr><th>Service</th><th>Qty</th><th>Rate</th><th>Total</th></tr></thead><tbody>{{invoice_items}}</tbody></table>
      </div>
      <div class="totals-modern">
        <div class="total-line"><span>Subtotal</span><span>{{subtotal}}</span></div>
        <div class="total-line"><span>Discount</span><span class="discount-amt">-{{discount}}</span></div>
        <div class="total-line"><span>Tax (GST)</span><span>{{tax}}</span></div>
        <div class="total-line grand"><span>Total Amount</span><span>{{total}}</span></div>
        <div class="total-line paid"><span>Amount Paid</span><span>{{amount_paid}}</span></div>
        <div class="total-line balance"><span>Balance Due</span><span>{{balance_due}}</span></div>
      </div>
      <div class="modern-panels">{{payment_terms}}{{bank_details}}</div>
      <div class="modern-notes"><strong>Notes:</strong> {{notes}}</div>
    </div>
    <div class="modern-footer">
      <div class="footer-wave"></div>
      <p class="footer-text">Thank you for choosing {{lab_name}}!</p>
      <p class="footer-small">Generated {{current_date}} | {{tax_disclaimer}}</p>
    </div>
  </div>`,
          gjs_css: `body { font-family: "Inter", "Segoe UI", sans-serif; margin: 0; padding: 0; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); }
  .modern-invoice { max-width: 210mm; margin: 20px auto; background: white; box-shadow: 0 10px 40px rgba(0,0,0,0.2); border-radius: 12px; overflow: hidden; }
  .modern-header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 40px 40px 60px 40px; position: relative; }
  .header-content { display: flex; justify-content: space-between; align-items: flex-start; }
  .modern-title { font-size: 32px; margin-bottom: 8px; font-weight: 700; }
  .modern-subtitle { font-size: 14px; opacity: 0.9; letter-spacing: 1px; }
  .invoice-label { text-align: right; }
  .label-badge { background: rgba(255,255,255,0.2); padding: 8px 20px; border-radius: 20px; font-size: 12px; letter-spacing: 2px; margin-bottom: 10px; }
  .invoice-num { font-size: 24px; font-weight: bold; }
  .modern-container { padding: 40px; margin-top: -30px; position: relative; }
  .info-cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-bottom: 40px; }
  .info-card { background: white; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.08); overflow: hidden; }
  .card-header { padding: 12px 20px; font-weight: 600; font-size: 14px; color: white; }
  .card-from .card-header { background: linear-gradient(135deg, #667eea, #764ba2); }
  .card-to .card-header { background: linear-gradient(135deg, #f093fb, #f5576c); }
  .card-dates .card-header { background: linear-gradient(135deg, #4facfe, #00f2fe); }
  .card-content { padding: 20px; font-size: 13px; line-height: 1.8; }
  .section-title { font-size: 20px; font-weight: 600; color: #333; margin-bottom: 20px; padding-left: 15px; border-left: 4px solid #667eea; }
  .modern-table { width: 100%; border-collapse: separate; border-spacing: 0; margin-bottom: 30px; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
  .modern-table thead { background: linear-gradient(135deg, #667eea, #764ba2); color: white; }
  .modern-table th { padding: 15px; text-align: left; font-weight: 600; }
  .modern-table td { padding: 15px; border-bottom: 1px solid #f0f0f0; }
  .modern-table tbody tr:hover { background: #f8f9fa; }
  .totals-modern { max-width: 400px; margin-left: auto; background: #f8f9fa; border-radius: 12px; padding: 20px; }
  .total-line { display: flex; justify-content: space-between; padding: 12px 0; font-size: 15px; border-bottom: 1px solid #e0e0e0; }
  .total-line.grand { font-size: 20px; font-weight: bold; background: linear-gradient(135deg, #667eea, #764ba2); color: white; padding: 15px 20px; margin: 10px -20px; border-radius: 8px; border: none; }
  .total-line.paid { color: #28a745; font-weight: 600; }
  .total-line.balance { font-size: 18px; font-weight: bold; color: #dc3545; background: #fff3cd; padding: 15px 20px; margin: 10px -20px 0 -20px; border-radius: 8px; border: none; }
  .discount-amt { color: #28a745; }
  .modern-panels { margin: 30px 0; padding: 20px; background: linear-gradient(135deg, #e0c3fc, #8ec5fc); border-radius: 12px; }
  .modern-notes { padding: 20px; background: #fff9e6; border-left: 4px solid #ffc107; border-radius: 8px; margin-bottom: 30px; }
  .modern-footer { background: linear-gradient(135deg, #667eea, #764ba2); color: white; text-align: center; padding: 30px 40px; position: relative; }
  .footer-wave { height: 40px; background: white; border-radius: 0 0 50% 50%; margin: -30px -40px 20px -40px; }
  .footer-text { font-size: 18px; font-weight: 600; margin-bottom: 10px; }
  .footer-small { font-size: 11px; opacity: 0.8; }
  .partial-invoice-badge { position: absolute; top: 100px; right: 50px; background: #ff6b6b; color: white; padding: 12px 24px; font-weight: bold; border-radius: 50px; box-shadow: 0 6px 12px rgba(0,0,0,0.2); transform: rotate(-5deg); z-index: 10; }`
        },
        {
          lab_id: lab_id,
          template_name: "Professional Invoice",
          template_description: "Corporate-style invoice with detailed information and branding",
          category: "professional",
          is_active: true,
          is_default: false,
          include_payment_terms: true,
          payment_terms_text: "Payment due within 30 days. Late payments subject to 2% monthly interest.",
          include_tax_breakdown: true,
          include_bank_details: true,
          gjs_html: `<div class="pro-invoice">
    <div class="pro-header">
      <div class="branding"><h1>{{lab_name}}</h1><p class="tagline">Excellence in Laboratory Services</p></div>
      <div class="invoice-badge"><div class="badge-title">INVOICE</div><div class="badge-number">{{invoice_number}}</div></div>
    </div>
    {{partial_badge}}
    <div class="contact-bar"><span>📍 {{lab_address}}</span><span>📞 {{lab_phone}}</span><span>✉ {{lab_email}}</span></div>
    <div class="pro-body">
      <div class="info-grid">
        <div class="info-box"><h3>Bill To</h3><p class="highlight">{{patient_name}}</p><p>{{patient_address}}</p><p>Phone: {{patient_phone}}</p><p>Email: {{patient_email}}</p></div>
        <div class="info-box"><h3>Invoice Details</h3><table class="meta-table"><tr><td>Invoice Date:</td><td>{{invoice_date}}</td></tr><tr><td>Due Date:</td><td>{{due_date}}</td></tr><tr><td>Payment Type:</td><td>{{payment_type}}</td></tr><tr><td>Referring Doctor:</td><td>{{doctor}}</td></tr></table></div>
      </div>
      <div class="items-section"><h3>Services Provided</h3><table class="pro-items-table"><thead><tr><th>Description</th><th style="text-align: center;">Quantity</th><th style="text-align: right;">Unit Price</th><th style="text-align: right;">Amount</th></tr></thead><tbody>{{invoice_items}}</tbody></table></div>
      <div class="summary-section"><div class="summary-box"><table class="summary-table"><tr><td>Subtotal</td><td>{{subtotal}}</td></tr><tr><td>Discount Applied</td><td>-{{discount}}</td></tr><tr><td>GST (18%)</td><td>{{tax}}</td></tr><tr class="grand-total"><td>Grand Total</td><td>{{total}}</td></tr><tr class="amount-paid"><td>Amount Paid</td><td>{{amount_paid}}</td></tr><tr class="outstanding"><td>Outstanding Balance</td><td>{{balance_due}}</td></tr></table></div></div>
      <div class="additional-info"><div class="info-panel">{{payment_terms}}</div><div class="info-panel">{{bank_details}}</div></div>
      <div class="notes-panel"><h4>Additional Notes</h4><p>{{notes}}</p></div>
    </div>
    <div class="pro-footer">
      <div class="footer-row"><div>{{tax_disclaimer}}</div><div>License: {{lab_license}} | Registration: {{lab_registration}}</div></div>
      <div class="footer-bottom"><p><strong>Thank you for your business!</strong></p><p class="small-text">This is a computer-generated invoice. Generated on {{current_date}}</p></div>
    </div>
  </div>`,
          gjs_css: `body { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; margin: 0; padding: 0; background: #f5f5f5; }
  .pro-invoice { max-width: 210mm; margin: 0 auto; background: white; }
  .pro-header { display: flex; justify-content: space-between; align-items: center; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px 40px; }
  .branding h1 { font-size: 28px; margin-bottom: 5px; }
  .tagline { font-size: 14px; opacity: 0.9; }
  .invoice-badge { text-align: right; }
  .badge-title { font-size: 14px; letter-spacing: 2px; opacity: 0.8; }
  .badge-number { font-size: 24px; font-weight: bold; }
  .contact-bar { display: flex; justify-content: space-around; background: #f8f9fa; padding: 15px; font-size: 13px; border-bottom: 2px solid #e9ecef; }
  .pro-body { padding: 40px; }
  .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-bottom: 40px; }
  .info-box { padding: 20px; background: #f8f9fa; border-radius: 8px; border-left: 4px solid #667eea; }
  .info-box h3 { margin-bottom: 15px; color: #495057; font-size: 16px; }
  .highlight { font-size: 18px; font-weight: bold; color: #212529; margin: 10px 0; }
  .meta-table { width: 100%; font-size: 14px; }
  .meta-table td { padding: 6px 0; }
  .meta-table td:first-child { color: #6c757d; width: 120px; }
  .items-section h3 { color: #495057; margin-bottom: 15px; }
  .pro-items-table { width: 100%; border-collapse: collapse; margin-bottom: 30px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
  .pro-items-table thead { background: #495057; color: white; }
  .pro-items-table th { padding: 15px; font-weight: 600; }
  .pro-items-table td { padding: 15px; border-bottom: 1px solid #dee2e6; }
  .summary-section { display: flex; justify-content: flex-end; margin-bottom: 30px; }
  .summary-box { width: 400px; }
  .summary-table { width: 100%; font-size: 16px; }
  .summary-table td { padding: 12px 15px; border-bottom: 1px solid #dee2e6; }
  .summary-table td:last-child { text-align: right; font-weight: 500; }
  .grand-total { background: #495057; color: white; font-size: 18px; font-weight: bold; }
  .amount-paid { background: #d4edda; color: #155724; }
  .outstanding { background: #fff3cd; color: #856404; font-weight: bold; }
  .additional-info { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 30px; }
  .info-panel { padding: 20px; background: #e7f3ff; border-radius: 8px; border-left: 4px solid #0066cc; }
  .notes-panel { padding: 20px; background: #f8f9fa; border-radius: 8px; margin-bottom: 30px; }
  .pro-footer { background: #f8f9fa; padding: 30px 40px; border-top: 3px solid #667eea; }
  .footer-row { display: flex; justify-content: space-between; font-size: 12px; color: #6c757d; margin-bottom: 20px; }
  .footer-bottom { text-align: center; }
  .footer-bottom p { margin: 5px 0; }
  .small-text { font-size: 11px; color: #adb5bd; }
  .partial-invoice-badge { position: absolute; top: 50px; right: 50px; background: #ff6b6b; color: white; padding: 12px 24px; font-weight: bold; border-radius: 50px; box-shadow: 0 4px 8px rgba(0,0,0,0.2); }`
        },
        {
          lab_id: lab_id,
          template_name: "B2B Detailed Invoice",
          template_description: "Comprehensive invoice for corporate clients with detailed tax breakdown",
          category: "b2b",
          is_active: true,
          is_default: false,
          include_payment_terms: true,
          payment_terms_text: "Payment terms: Net 30. Bank transfer preferred. Please quote invoice number.",
          include_tax_breakdown: true,
          tax_disclaimer: "This is a tax invoice. GST is applicable as per CGST/SGST/IGST regulations.",
          include_bank_details: true,
          gjs_html: `<div class="b2b-invoice">
    <div class="letterhead"><div class="company-logo"><h1>{{lab_name}}</h1><p class="company-tagline">Accredited Laboratory Services</p></div><div class="company-details"><p>{{lab_address}}</p><p>Phone: {{lab_phone}} | Email: {{lab_email}}</p><p><strong>GSTIN:</strong> {{lab_license}}</p><p><strong>CIN:</strong> {{lab_registration}}</p></div></div>
    <div class="document-title"><h2>TAX INVOICE</h2>{{partial_badge}}</div>
    <div class="invoice-details-grid">
      <div class="detail-section"><h4>Invoice Information</h4><table class="detail-table"><tr><td>Invoice No:</td><td><strong>{{invoice_number}}</strong></td></tr><tr><td>Invoice Date:</td><td>{{invoice_date}}</td></tr><tr><td>Due Date:</td><td>{{due_date}}</td></tr><tr><td>Payment Type:</td><td>{{payment_type}}</td></tr></table></div>
      <div class="detail-section"><h4>Bill To</h4><p class="client-name">{{patient_name}}</p><p>{{patient_address}}</p><p>Phone: {{patient_phone}}</p><p>Email: {{patient_email}}</p><p>Ref. Doctor: {{doctor}}</p></div>
    </div>
    <div class="services-section"><h4>Services & Charges</h4><table class="b2b-items-table"><thead><tr><th style="width: 50%;">Description of Services</th><th style="text-align: center; width: 10%;">Qty</th><th style="text-align: right; width: 15%;">Rate (₹)</th><th style="text-align: right; width: 10%;">Discount</th><th style="text-align: right; width: 15%;">Amount (₹)</th></tr></thead><tbody>{{invoice_items}}</tbody><tfoot><tr class="subtotal-row"><td colspan="4" style="text-align: right;"><strong>Subtotal:</strong></td><td style="text-align: right;"><strong>{{subtotal}}</strong></td></tr></tfoot></table></div>
    <div class="tax-section">
      <div class="tax-breakdown"><h4>Tax Breakdown</h4><table class="tax-table"><tr><td>Taxable Amount:</td><td>{{subtotal}}</td></tr><tr><td>Less: Discount:</td><td>-{{discount}}</td></tr><tr><td>CGST @ 9%:</td><td>{{tax}}</td></tr><tr><td>SGST @ 9%:</td><td>{{tax}}</td></tr><tr class="tax-total"><td><strong>Total Tax (GST):</strong></td><td><strong>{{tax}}</strong></td></tr></table></div>
      <div class="amount-summary"><table class="summary-amounts"><tr class="total-amount"><td>Invoice Total:</td><td>{{total}}</td></tr><tr class="paid-amount"><td>Amount Paid:</td><td>{{amount_paid}}</td></tr><tr class="due-amount"><td>Balance Due:</td><td>{{balance_due}}</td></tr></table></div>
    </div>
    <div class="terms-bank-section"><div class="terms-box">{{payment_terms}}</div><div class="bank-box">{{bank_details}}</div></div>
    <div class="notes-section-b2b"><h4>Notes & Remarks</h4><p>{{notes}}</p></div>
    <div class="declaration"><p><strong>Declaration:</strong> {{tax_disclaimer}}</p><p>We declare that this invoice shows the actual price of the services described and that all particulars are true and correct.</p></div>
    <div class="signature-section"><div class="signature-box"><p>For <strong>{{lab_name}}</strong></p><div class="signature-line"></div><p>Authorized Signatory</p></div></div>
    <div class="b2b-footer"><p>This is a system-generated invoice. Generated on {{current_date}}</p><p><em>Thank you for your business partnership!</em></p></div>
  </div>`,
          gjs_css: `body { font-family: "Times New Roman", Times, serif; margin: 0; padding: 0; }
  .b2b-invoice { max-width: 210mm; margin: 0 auto; padding: 15mm; background: white; }
  .letterhead { border-bottom: 3px double #000; padding-bottom: 15px; margin-bottom: 20px; }
  .company-logo h1 { font-size: 26px; margin-bottom: 5px; }
  .company-tagline { font-style: italic; color: #555; font-size: 13px; }
  .company-details { margin-top: 10px; font-size: 12px; line-height: 1.6; }
  .document-title { text-align: center; margin: 20px 0; position: relative; }
  .document-title h2 { font-size: 28px; border: 2px solid #000; display: inline-block; padding: 10px 30px; }
  .invoice-details-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 30px; }
  .detail-section { border: 1px solid #ddd; padding: 15px; }
  .detail-section h4 { margin-bottom: 10px; border-bottom: 2px solid #000; padding-bottom: 5px; }
  .detail-table { width: 100%; font-size: 14px; }
  .detail-table td { padding: 5px 0; }
  .detail-table td:first-child { width: 120px; color: #666; }
  .client-name { font-size: 16px; font-weight: bold; margin: 10px 0; }
  .services-section { margin-bottom: 20px; }
  .services-section h4 { background: #000; color: white; padding: 10px; margin-bottom: 0; }
  .b2b-items-table { width: 100%; border-collapse: collapse; border: 1px solid #000; }
  .b2b-items-table th { background: #f0f0f0; padding: 12px 8px; border: 1px solid #000; font-weight: bold; }
  .b2b-items-table td { padding: 12px 8px; border: 1px solid #ddd; }
  .subtotal-row { background: #f5f5f5; font-weight: bold; }
  .tax-section { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px; }
  .tax-breakdown { border: 1px solid #ddd; padding: 15px; }
  .tax-breakdown h4 { margin-bottom: 10px; }
  .tax-table { width: 100%; font-size: 14px; }
  .tax-table td { padding: 8px; border-bottom: 1px solid #eee; }
  .tax-table td:last-child { text-align: right; }
  .tax-total { background: #f0f0f0; font-weight: bold; border-top: 2px solid #000; }
  .amount-summary { border: 2px solid #000; padding: 15px; }
  .summary-amounts { width: 100%; font-size: 16px; }
  .summary-amounts td { padding: 10px; }
  .summary-amounts td:last-child { text-align: right; font-weight: bold; }
  .total-amount { font-size: 18px; border-bottom: 2px solid #000; }
  .paid-amount { color: #28a745; }
  .due-amount { font-size: 20px; background: #fff3cd; color: #856404; }
  .terms-bank-section { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px; }
  .terms-box, .bank-box { border: 1px solid #ddd; padding: 15px; background: #fafafa; }
  .notes-section-b2b { border: 1px solid #ddd; padding: 15px; margin-bottom: 20px; }
  .declaration { border: 1px solid #000; padding: 15px; margin-bottom: 20px; font-size: 12px; background: #fffacd; }
  .signature-section { text-align: right; margin: 30px 0; }
  .signature-box { display: inline-block; text-align: center; }
  .signature-line { width: 200px; height: 50px; border-bottom: 1px solid #000; margin: 20px 0; }
  .b2b-footer { text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; font-size: 11px; color: #666; }
  .partial-invoice-badge { position: absolute; top: -10px; right: 20px; background: #dc3545; color: white; padding: 10px 20px; font-weight: bold; border: 2px solid #000; }`
        }
      ];
      
      // Insert all invoice templates
      const { error: insertInvTmplErr } = await supabaseClient
        .from('invoice_templates')
        .insert(defaultInvoiceTemplates);
      
      if (!insertInvTmplErr) {
        stats.invoiceTemplatesCreated = defaultInvoiceTemplates.length;
        console.log(`   ✅ Created ${defaultInvoiceTemplates.length} invoice templates`);
      } else {
        console.error('   ❌ Error creating invoice templates:', insertInvTmplErr);
      }
    } else if (existingInvoiceTemplates && existingInvoiceTemplates.length > 0) {
      console.log(`   ⏭️ Lab already has ${existingInvoiceTemplates.length} invoice templates, skipping...`);
    }
    
    // --- F. Final Cleanup (at the END, after everything is created) ---
    if (isReset) {
      console.log('🧹 Final cleanup: Removing orphan lab_analytes and lab_templates...');
      
      // --- 1. Delete orphan lab_analytes (not connected to any test_group_analytes for this lab) ---
      // Get all test_groups for this lab
      const { data: labTestGroups } = await supabaseClient
        .from('test_groups')
        .select('id')
        .eq('lab_id', lab_id);
      
      const labTestGroupIds = (labTestGroups || []).map(tg => tg.id);
      
      if (labTestGroupIds.length > 0) {
        // Get all analyte_ids that ARE connected to test_group_analytes for this lab's test groups
        const { data: connectedTGAs } = await supabaseClient
          .from('test_group_analytes')
          .select('analyte_id')
          .in('test_group_id', labTestGroupIds);
        
        const connectedAnalyteIds = new Set((connectedTGAs || []).map(tga => tga.analyte_id));
        
        // Get all lab_analytes for this lab
        const { data: allLabAnalytes } = await supabaseClient
          .from('lab_analytes')
          .select('id, analyte_id')
          .eq('lab_id', lab_id);
        
        // Find orphan lab_analytes (not connected to any test_group_analytes)
        const orphanLabAnalyteIds = (allLabAnalytes || [])
          .filter(la => !connectedAnalyteIds.has(la.analyte_id))
          .map(la => la.id);
        
        if (orphanLabAnalyteIds.length > 0) {
          const { error: deleteOrphanLAError } = await supabaseClient
            .from('lab_analytes')
            .delete()
            .in('id', orphanLabAnalyteIds);
          
          if (!deleteOrphanLAError) {
            stats.orphanLabAnalytesDeleted = orphanLabAnalyteIds.length;
            console.log(`   🧹 Deleted ${orphanLabAnalyteIds.length} orphan lab_analytes (not linked to any test group)`);
          } else {
            console.error('Error deleting orphan lab_analytes:', deleteOrphanLAError);
          }
        } else {
          console.log('   ✅ No orphan lab_analytes found');
        }
      }
      
      // --- 2. Delete orphan lab_templates (not linked to any test_groups for this lab) ---
      const { data: labTemplates } = await supabaseClient
        .from('lab_templates')
        .select('id, test_group_id')
        .eq('lab_id', lab_id);
      
      if (labTemplates && labTemplates.length > 0) {
        const validTestGroupIdsSet = new Set(labTestGroupIds);
        
        // Find orphan lab_templates (where test_group_id doesn't exist in this lab's test groups)
        const orphanTemplateIds = labTemplates
          .filter(lt => lt.test_group_id && !validTestGroupIdsSet.has(lt.test_group_id))
          .map(lt => lt.id);
        
        if (orphanTemplateIds.length > 0) {
          const { error: orphanTmplError } = await supabaseClient
            .from('lab_templates')
            .delete()
            .in('id', orphanTemplateIds);
          
          if (!orphanTmplError) {
            stats.orphanLabTemplatesDeleted = orphanTemplateIds.length;
            console.log(`   🧹 Deleted ${orphanTemplateIds.length} orphan lab_templates (not linked to any test group)`);
          } else {
            console.error('Error deleting orphan lab_templates:', orphanTmplError);
          }
        } else {
          console.log('   ✅ No orphan lab_templates found');
        }
      }
    }
    
    // --- G. Seed Report Sections from Global Catalog ---
    console.log('...Seeding Report Sections');
    const { data: globalSections } = await supabaseClient
      .from('global_test_catalog_sections')
      .select('catalog_id, section_type, section_name, display_order, default_content, predefined_options, is_required, is_editable, placeholder_key, allow_images, allow_technician_entry');

    if (globalSections && globalSections.length > 0) {
      // Map: catalog_id → sections[]
      const catalogSectionsMap = new Map<string, typeof globalSections>();
      for (const s of globalSections) {
        if (!catalogSectionsMap.has(s.catalog_id)) catalogSectionsMap.set(s.catalog_id, []);
        catalogSectionsMap.get(s.catalog_id)!.push(s);
      }

      // Pre-fetch existing sections for this lab (keyed as "test_group_id:section_type")
      const { data: existingLabSections } = await supabaseClient
        .from('lab_template_sections')
        .select('test_group_id, section_type')
        .eq('lab_id', lab_id);

      const existingSectionKeys = new Set(
        (existingLabSections || []).map((s: any) => `${s.test_group_id}:${s.section_type}`)
      );

      const sectionsPayload: object[] = [];

      // Newly created groups
      for (const gtg of toCreate) {
        const labGroupId = createdMap.get(gtg.code);
        if (!labGroupId) continue;
        const sections = catalogSectionsMap.get(gtg.id) || [];
        for (const s of sections) {
          if (existingSectionKeys.has(`${labGroupId}:${s.section_type}`)) continue;
          sectionsPayload.push({
            lab_id,
            test_group_id: labGroupId,
            section_type: s.section_type,
            section_name: s.section_name,
            display_order: s.display_order,
            default_content: s.default_content,
            predefined_options: s.predefined_options ?? [],
            is_required: s.is_required ?? false,
            is_editable: s.is_editable ?? true,
            placeholder_key: s.placeholder_key,
            allow_images: s.allow_images ?? false,
            allow_technician_entry: s.allow_technician_entry ?? false,
          });
        }
      }

      // Updated groups in sync/reset mode — fill any missing sections
      if (isSync || isReset) {
        for (const { gtg, existingId } of toUpdate) {
          const sections = catalogSectionsMap.get(gtg.id) || [];
          for (const s of sections) {
            if (existingSectionKeys.has(`${existingId}:${s.section_type}`)) continue;
            sectionsPayload.push({
              lab_id,
              test_group_id: existingId,
              section_type: s.section_type,
              section_name: s.section_name,
              display_order: s.display_order,
              default_content: s.default_content,
              predefined_options: s.predefined_options ?? [],
              is_required: s.is_required ?? false,
              is_editable: s.is_editable ?? true,
              placeholder_key: s.placeholder_key,
              allow_images: s.allow_images ?? false,
              allow_technician_entry: s.allow_technician_entry ?? false,
            });
          }
        }
      }

      if (sectionsPayload.length > 0) {
        for (let i = 0; i < sectionsPayload.length; i += 500) {
          const { error: secErr } = await supabaseClient
            .from('lab_template_sections')
            .insert(sectionsPayload.slice(i, i + 500));
          if (secErr) console.error(`Section insert error (chunk ${i}):`, secErr);
        }
        stats.sectionsCreated = sectionsPayload.length;
        console.log(`   📝 Seeded ${sectionsPayload.length} report sections`);
      } else {
        console.log('   ✅ Report sections already up to date');
      }
    } else {
      console.log('   ⏭️ No global sections defined yet — skipping');
    }

    // --- F. Ensure Lab has default PDF Layout Settings ---
    console.log('\\n📄 Ensuring default PDF layout settings...');
    
    // Check if lab already has pdf_layout_settings
    const { data: labData } = await supabaseClient
      .from('labs')
      .select('pdf_layout_settings')
      .eq('id', lab_id)
      .single();
    
    const currentSettings = labData?.pdf_layout_settings || {};
    
    // Only update if missing key fields (headerTextColor or resultColors)
    if (!currentSettings.headerTextColor || !currentSettings.resultColors) {
      const defaultPdfSettings = {
        ...currentSettings, // Keep existing settings
        // Add defaults only if missing
        headerTextColor: currentSettings.headerTextColor || 'white',
        resultColors: currentSettings.resultColors || {
          enabled: true,
          high: '#dc2626',
          low: '#ea580c',
          normal: '#16a34a'
        },
        // Ensure other defaults are set
        scale: currentSettings.scale || 1,
        paperSize: currentSettings.paperSize || 'A4',
        orientation: currentSettings.orientation || 'portrait',
        headerHeight: currentSettings.headerHeight || 90,
        footerHeight: currentSettings.footerHeight || 80,
        displayHeaderFooter: currentSettings.displayHeaderFooter ?? true,
        printBackground: currentSettings.printBackground ?? true,
        mediaType: currentSettings.mediaType || 'screen',
        margins: currentSettings.margins || {
          top: 180,
          bottom: 150,
          left: 20,
          right: 20
        }
      };
      
      const { error: updateError } = await supabaseClient
        .from('labs')
        .update({ pdf_layout_settings: defaultPdfSettings })
        .eq('id', lab_id);
      
      if (!updateError) {
        console.log('   ✅ Default PDF layout settings applied (headerTextColor: white, resultColors enabled)');
      } else {
        console.error('   ⚠️ Error updating PDF settings:', updateError);
      }
    } else {
      console.log('   ✅ PDF layout settings already configured');
    }
    
    console.log(`✅ ${isReset ? 'Reset' : isSync ? 'Sync' : 'Onboarding'} Complete. Stats:`, stats);

    return new Response(
      JSON.stringify({ 
        message: isReset ? 'Reset complete - test groups restored from global catalog, orphans cleaned up' : 
                 isSync ? 'Sync complete' : 'Onboarding complete', 
        lab_id, 
        stats,
        testGroupsCreated: stats.testsCreated,
        testGroupsUpdated: stats.testsUpdated,
        testGroupsDeleted: stats.testsDeleted,
        duplicatesRemoved: stats.duplicatesRemoved,
        analytesHydrated: stats.analytesHydrated,
        invoiceTemplatesCreated: stats.invoiceTemplatesCreated,
        sectionsCreated: stats.sectionsCreated,
        orphanLabAnalytesDeleted: stats.orphanLabAnalytesDeleted,
        orphanLabTemplatesDeleted: stats.orphanLabTemplatesDeleted
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Onboarding error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
