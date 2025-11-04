import { createClient } from '@supabase/supabase-js';

// Replace with your actual Supabase credentials
const supabaseUrl = 'https://avprqgtmiagiwpzhcmjg.supabase.co';
const supabaseServiceKey = 'YOUR_SERVICE_ROLE_KEY_HERE';

console.log('⚠️  Please update the Supabase credentials in this script before running');
console.log('You can find them in your Supabase dashboard under Settings > API');

if (supabaseServiceKey === 'YOUR_SERVICE_ROLE_KEY_HERE') {
  console.error('❌ Please update the supabaseServiceKey in the script with your actual service role key');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function migrateWorkflowFormats() {
  console.log('Starting workflow format migration...');

  try {
    // Get all workflow versions
    const { data: workflows, error } = await supabase
      .from('workflow_versions')
      .select('id, definition')
      .not('definition', 'is', null);

    if (error) {
      console.error('Error fetching workflows:', error);
      return;
    }

    console.log(`Found ${workflows?.length || 0} workflow versions to check`);

    let migratedCount = 0;

    for (const workflow of workflows || []) {
      try {
        let definition = workflow.definition;

        // Handle string definitions (double-stringified JSON)
        if (typeof definition === 'string') {
          try {
            definition = JSON.parse(definition);
            console.log(`Workflow ${workflow.id} had string definition, parsed it`);
          } catch (parseError) {
            console.error(`Failed to parse string definition for workflow ${workflow.id}:`, parseError);
            continue;
          }
        }

        // Check if it's already in new format
        if (definition?.ui?.template) {
          console.log(`Workflow ${workflow.id} already in new format`);
          continue;
        }

        // Check if it's in old format (direct technician_flow)
        if (definition?.technician_flow) {
          console.log(`Migrating workflow ${workflow.id} from old format`);

          // Convert to new format
          const newDefinition = {
            ui: {
              engine: 'surveyjs',
              template: definition.technician_flow
            },
            ai_spec: definition.ai_spec || {},
            meta: definition.metadata || null
          };

          // Update the workflow
          const { error: updateError } = await supabase
            .from('workflow_versions')
            .update({ definition: newDefinition })
            .eq('id', workflow.id);

          if (updateError) {
            console.error(`Error updating workflow ${workflow.id}:`, updateError);
          } else {
            console.log(`✅ Migrated workflow ${workflow.id}`);
            migratedCount++;
          }
        } else {
          console.log(`Workflow ${workflow.id} has unknown format, skipping`);
        }
      } catch (workflowError) {
        console.error(`Error processing workflow ${workflow.id}:`, workflowError);
      }
    }

    console.log(`Migration complete! Migrated ${migratedCount} workflows.`);

  } catch (error) {
    console.error('Migration failed:', error);
  }
}

// Run the migration
migrateWorkflowFormats();