#!/usr/bin/env node

/**
 * Automated Cleanup Script for Unmapped Test Groups
 * 
 * This script identifies and optionally deletes test groups that have no
 * analyte mappings in the test_group_analytes table.
 * 
 * Usage:
 *   node cleanup-test-groups.js --dry-run          (preview only)
 *   node cleanup-test-groups.js --execute          (actually delete)
 *   node cleanup-test-groups.js --lab-id=<uuid>    (specific lab only)
 * 
 * Schedule with cron:
 *   0 2 * * 0 cd /path/to/project && node cleanup-test-groups.js --execute
 *   (Runs every Sunday at 2 AM)
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Error: Missing Supabase credentials');
  console.error('Please set VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Parse command line arguments
const args = process.argv.slice(2);
const isDryRun = !args.includes('--execute');
const labIdArg = args.find(arg => arg.startsWith('--lab-id='));
const labId = labIdArg ? labIdArg.split('=')[1] : null;
const verbose = args.includes('--verbose') || args.includes('-v');

console.log('🧹 Test Group Cleanup Script');
console.log('================================\n');
console.log(`Mode: ${isDryRun ? '🔍 DRY RUN (preview only)' : '⚠️  EXECUTE (will delete)'}`);
if (labId) console.log(`Lab Filter: ${labId}`);
console.log('');

async function findUnmappedTestGroups() {
  console.log('📊 Finding unmapped test groups...\n');
  
  const { data, error } = await supabase.rpc('find_unmapped_test_groups');
  
  if (error) {
    console.error('❌ Error finding unmapped test groups:', error);
    process.exit(1);
  }
  
  if (!data || data.length === 0) {
    console.log('✅ No unmapped test groups found. Database is clean!\n');
    return [];
  }
  
  console.log(`Found ${data.length} unmapped test groups:\n`);
  
  // Group by safety status
  const safeToDelete = data.filter(tg => !tg.has_orders && !tg.has_results);
  const unsafe = data.filter(tg => tg.has_orders || tg.has_results);
  
  if (safeToDelete.length > 0) {
    console.log(`✅ Safe to delete (${safeToDelete.length}):`);
    safeToDelete.forEach(tg => {
      console.log(`  - ${tg.test_group_name} (${tg.test_group_code})`);
      if (verbose) {
        console.log(`    ID: ${tg.test_group_id}`);
        console.log(`    Created: ${new Date(tg.created_at).toLocaleString()}`);
      }
    });
    console.log('');
  }
  
  if (unsafe.length > 0) {
    console.log(`⚠️  Cannot delete - has data (${unsafe.length}):`);
    unsafe.forEach(tg => {
      const reasons = [];
      if (tg.has_orders) reasons.push('orders');
      if (tg.has_results) reasons.push('results');
      console.log(`  - ${tg.test_group_name} (${tg.test_group_code}) - has ${reasons.join(', ')}`);
    });
    console.log('');
  }
  
  return data;
}

async function deleteUnmappedTestGroups() {
  console.log(`${isDryRun ? '🔍 Previewing' : '🗑️  Executing'} cleanup...\n`);
  
  const { data, error } = await supabase.rpc('delete_unmapped_test_groups', {
    p_dry_run: isDryRun,
    p_lab_id: labId
  });
  
  if (error) {
    console.error('❌ Error during cleanup:', error);
    process.exit(1);
  }
  
  if (!data || data.length === 0) {
    console.log('No test groups to process.\n');
    return;
  }
  
  // Display results
  const deleted = data.filter(r => r.action === 'DELETED' || r.action === 'WOULD_DELETE');
  const skipped = data.filter(r => r.action === 'SKIPPED');
  const summary = data.find(r => r.action === 'SUMMARY');
  
  if (deleted.length > 0) {
    console.log(`${isDryRun ? '📋 Would delete' : '✅ Deleted'} (${deleted.length}):`);
    deleted.forEach(r => {
      console.log(`  - ${r.test_group_name} (${r.test_group_code})`);
      if (verbose) console.log(`    ${r.message}`);
    });
    console.log('');
  }
  
  if (skipped.length > 0) {
    console.log(`⏭️  Skipped (${skipped.length}):`);
    skipped.forEach(r => {
      console.log(`  - ${r.test_group_name}: ${r.message}`);
    });
    console.log('');
  }
  
  if (summary) {
    console.log('📊 Summary:');
    console.log(`  ${summary.message}\n`);
  }
}

async function generateReport() {
  console.log('📈 Generating cleanup report...\n');
  
  // Get unmapped test groups by lab
  const { data: labStats, error: labError } = await supabase.rpc('query', {
    sql: `
      SELECT 
        l.name AS lab_name,
        l.id AS lab_id,
        COUNT(tg.id) AS unmapped_count
      FROM labs l
      LEFT JOIN test_groups tg ON tg.lab_id = l.id
      WHERE NOT EXISTS (
        SELECT 1 FROM test_group_analytes tga WHERE tga.test_group_id = tg.id
      )
      GROUP BY l.id, l.name
      HAVING COUNT(tg.id) > 0
      ORDER BY COUNT(tg.id) DESC
    `
  });
  
  if (!labError && labStats) {
    console.log('📊 Unmapped test groups by lab:');
    labStats.forEach(stat => {
      console.log(`  ${stat.lab_name}: ${stat.unmapped_count} unmapped`);
    });
    console.log('');
  }
}

// Main execution
async function main() {
  try {
    await findUnmappedTestGroups();
    await deleteUnmappedTestGroups();
    
    if (verbose) {
      await generateReport();
    }
    
    if (isDryRun) {
      console.log('💡 To actually delete these test groups, run:');
      console.log('   node cleanup-test-groups.js --execute\n');
    } else {
      console.log('✅ Cleanup completed successfully!\n');
    }
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Unexpected error:', error);
    process.exit(1);
  }
}

main();
