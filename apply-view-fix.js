import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://scqhzbkkradflywariem.supabase.co';
const supabaseServiceKey = 'sb_secret_keQYH9kFby0OSyjdyczGsA_HJ7WoBE4';

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function runMigration() {
  try {
    console.log('🚀 Starting View Fix Migration...');
    
    const migrationPath = path.join(__dirname, 'supabase', 'migrations', '20251216_fix_view_approved_results_duplicates.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    
    console.log('📄 Migration file loaded');
    
    const { error } = await supabase.rpc('exec', {
      sql: migrationSQL
    });

    if (error) {
      console.error('❌ Migration failed:', error);
      // Fallback: try running statements individually if exec fails or doesn't exist
      console.log('Attempting fallback execution...');
      // But exec is the only way to run DDL via client usually, unless we have direct connection
    } else {
      console.log('✅ Migration executed successfully');
    }
    
  } catch (err) {
    console.error('❌ Unexpected error:', err);
  }
}

runMigration();
