
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
    const { lab_id, mode } = await req.json();
    if (!lab_id) {
      throw new Error('lab_id is required');
    }

    const isSync = mode === 'sync'; // Sync mode updates existing records
    const isReset = mode === 'reset'; // Reset mode deletes ALL and restores from global

    // 2. Init Supabase Client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.log(`🚀 Starting ${isReset ? 'RESET' : isSync ? 'SYNC' : 'ONBOARD'} for Lab: ${lab_id}`);

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
        visible: true // visible in catalog
      }));
      // On Conflict: Do nothing or Update? Upsert ensures they exist.
      const { error: laError } = await supabaseClient
        .from('lab_analytes')
        .upsert(labAnalytesPayload, { onConflict: 'lab_id,analyte_id', ignoreDuplicates: true });
      
      if (laError) console.error('Error hydrating analytes:', laError);
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

    // --- C. Hydrate Test Groups (Check First) ---
    console.log('...Hydrating Test Groups');
    const { data: globalTestGroups } = await supabaseClient.from('global_test_catalog').select('*');

    if (globalTestGroups) {
      console.log(`   Found ${globalTestGroups.length} global test groups.`);
      
      // First, detect and remove duplicates by NAME (keep the one matching global code if possible)
      if (!isReset) {
        console.log('...Checking for duplicate test groups by name...');
        
        for (const gtg of globalTestGroups) {
          // Find all test groups with this name (should be just one)
          const { data: sameNameGroups } = await supabaseClient
            .from('test_groups')
            .select('id, code, name, created_at')
            .eq('lab_id', lab_id)
            .eq('name', gtg.name)
            .order('created_at', { ascending: true });
          
          if (sameNameGroups && sameNameGroups.length > 1) {
            console.log(`   ⚠️ Found ${sameNameGroups.length} duplicates for "${gtg.name}"`);
            
            // Keep the one with matching code, or the oldest one
            const matchingCode = sameNameGroups.find(g => g.code === gtg.code);
            const keepId = matchingCode?.id || sameNameGroups[0].id;
            
            // Delete the duplicates (all except the one we're keeping)
            for (const duplicate of sameNameGroups) {
              if (duplicate.id !== keepId) {
                // Delete related records first
                await supabaseClient.from('test_group_analytes').delete().eq('test_group_id', duplicate.id);
                await supabaseClient.from('lab_templates').delete().eq('test_group_id', duplicate.id);
                await supabaseClient.from('package_test_groups').delete().eq('test_group_id', duplicate.id);
                await supabaseClient.from('test_workflow_map').delete().eq('test_group_id', duplicate.id);
                
                // Delete the duplicate test group
                const { error: delError } = await supabaseClient
                  .from('test_groups')
                  .delete()
                  .eq('id', duplicate.id);
                
                if (!delError) {
                  stats.duplicatesRemoved++;
                  console.log(`   🗑️ Removed duplicate: ${duplicate.name} (code: ${duplicate.code})`);
                }
              }
            }
          }
        }
        
        if (stats.duplicatesRemoved > 0) {
          console.log(`   ✅ Removed ${stats.duplicatesRemoved} duplicate test groups`);
        }
      }
      
      for (const gtg of globalTestGroups) {
        // 1. Check Existence by BOTH code AND name (to catch all duplicates)
        const { data: existingByCode } = await supabaseClient
            .from('test_groups')
            .select('id, default_ai_processing_type, code, name')
            .eq('lab_id', lab_id)
            .eq('code', gtg.code)
            .maybeSingle();
        
        // Also check by name if code match failed (handles case where code was modified)
        let existingTg = existingByCode;
        if (!existingTg) {
          const { data: existingByName } = await supabaseClient
            .from('test_groups')
            .select('id, default_ai_processing_type, code, name')
            .eq('lab_id', lab_id)
            .eq('name', gtg.name)
            .maybeSingle();
          existingTg = existingByName;
        }

        let testGroupId = existingTg?.id;

        if (!existingTg) {
           // Create test group with AI configuration from global catalog
           const { data: newTg, error: tgError } = await supabaseClient
            .from('test_groups')
            .insert({
              lab_id: lab_id,
              name: gtg.name,
              code: gtg.code,
              category: gtg.department_default || gtg.category || 'General',
              clinical_purpose: gtg.description || gtg.name,
              price: gtg.default_price || 0,
              turnaround_time: '24 Hours',
              sample_type: gtg.specimen_type_default || 'EDTA Blood', // Use specimen from global catalog
              is_active: true,
              to_be_copied: false,
              // AI Configuration from global catalog
              default_ai_processing_type: gtg.default_ai_processing_type || 'ocr_report',
              group_level_prompt: gtg.group_level_prompt || null,
              ai_config: gtg.ai_config || {}
            })
            .select('id')
            .single();

           if (tgError) {
             console.error(`Failed to create test group ${gtg.code}:`, tgError);
             continue;
           }
           testGroupId = newTg.id;
           stats.testsCreated++;
           const aiType = gtg.default_ai_processing_type || 'ocr_report';
           console.log(`   ✅ Created Test Group: ${gtg.code} (AI: ${aiType}, Specimen: ${gtg.specimen_type_default || 'EDTA Blood'})`);

           // Link Analytes (Only for NEW tests)
           const analyteIds = gtg.analytes; 
           if (Array.isArray(analyteIds) && analyteIds.length > 0) {
             const linksPayload = analyteIds.map((aid: string) => ({
               test_group_id: testGroupId,
               analyte_id: aid,
               is_visible: true
             }));
             await supabaseClient.from('test_group_analytes').insert(linksPayload);
           }
        } else if (isSync || isReset) {
           // In sync/reset mode, update existing test groups with AI config and ensure code matches global
           const needsUpdate = !existingTg.default_ai_processing_type || 
                               existingTg.default_ai_processing_type !== gtg.default_ai_processing_type ||
                               existingTg.code !== gtg.code; // Also update if code doesn't match global
           
           if (needsUpdate) {
             const { error: updateError } = await supabaseClient
               .from('test_groups')
               .update({
                 code: gtg.code, // Ensure code matches global catalog
                 default_ai_processing_type: gtg.default_ai_processing_type,
                 group_level_prompt: gtg.group_level_prompt || null,
                 ai_config: gtg.ai_config || {},
                 sample_type: gtg.specimen_type_default || 'EDTA Blood',
                 category: gtg.department_default || 'General'
               })
               .eq('id', existingTg.id);
             
             if (updateError) {
               console.error(`Failed to update test group ${gtg.code}:`, updateError);
             } else {
               stats.testsUpdated++;
               console.log(`   🔄 Updated Test Group: ${gtg.code} (AI: ${gtg.default_ai_processing_type})`);
             }
           } else {
             stats.testsSkipped++;
           }
        } else {
           stats.testsSkipped++;
           // console.log(`   ⏩ Skipped existing Test Group: ${gtg.code}`);
        }

        // 2. Clone Template (Link if exists or create)
        if (gtg.default_template_id && testGroupId) {
             // Check if lab_template exists for this test_group
             const { data: existingTmpl } = await supabaseClient
                .from('lab_templates')
                .select('id')
                .eq('lab_id', lab_id)
                .eq('test_group_id', testGroupId)
                .maybeSingle();
             
             if (!existingTmpl) {
                 const { data: globalTmpl } = await supabaseClient
                    .from('global_template_catalog')
                    .select('*')
                    .eq('id', gtg.default_template_id)
                    .single();
                 
                 if (globalTmpl) {
                     await supabaseClient.from('lab_templates').insert({
                         lab_id: lab_id,
                         test_group_id: testGroupId,
                         template_name: `Report - ${gtg.name}`,
                         category: 'report',
                         gjs_html: globalTmpl.html_content,
                         gjs_css: globalTmpl.css_content,
                         is_default: false, // Critical to avoid Constraint Error
                         is_active: true
                     });
                     stats.templatesCloned++;
                     console.log(`   📄 Cloned Template for ${gtg.code}`);
                 }
             }
        }
      }
    }

    // --- D. Hydrate Packages (Check First) ---
    console.log('...Hydrating Packages');
    const { data: globalPackages } = await supabaseClient.from('global_package_catalog').select('*');
    
    if (globalPackages) {
      console.log(`   Found ${globalPackages.length} global packages.`);
      for (const gp of globalPackages) {
         const { data: existingPkg } = await supabaseClient
            .from('packages')
            .select('id')
            .eq('lab_id', lab_id)
            .eq('name', gp.name) // Assuming Name is unique identifier for package syncing
            .maybeSingle();

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
