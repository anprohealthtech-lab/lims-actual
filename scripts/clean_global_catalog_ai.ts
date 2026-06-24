
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";

// --- Configuration ---
const SUPABASE_URL = process.env.SUPABASE_URL || "https://api.limsapp.in";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNjcWh6YmtrcmFkZmx5d2FyaWVtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MjI1NDYwOCwiZXhwIjoyMDY3ODMwNjA4fQ.NzWfj0DJXBzr3RQqCzAZxioND8cZn8z8tFmZ00upH7U";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY; 

// --- Helper: Call Claude ---
async function analyzeWithClaude(prompt: string) {
    if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is missing in .env");

    const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

    const msg = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 4000,
        messages: [{ role: "user", content: prompt }]
    });

    // Extract text content safely
    const content = msg.content[0];
    if (content.type === 'text') {
        return content.text;
    }
    return "";
}

// --- Main Script ---
async function main() {
    if (!ANTHROPIC_API_KEY) {
        console.error("❌ Please set ANTHROPIC_API_KEY environment variable.");
        process.exit(1);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    console.log("🚀 Starting Global Catalog Cleanup with AI...");

    // 1. Fetch Data
    console.log("   🔍 Fetching Catalog and Analytes...");
    const { data: tests } = await supabase.from('global_test_catalog').select('*').order('name');
    const { data: analytes } = await supabase.from('analytes').select('id, name');

    if (!tests || !analytes) { console.error("Failed to fetch data"); return; }

    const analyteMap = new Map(analytes.map(a => [a.id, a.name]));

    // 2. Group by Normalized Name (Simple Fuzzy)
    // We group broadly to catch "CBC", "CBC (Complete Blood Count)", "C.B.C"
    // Strategy: First word + exact match, or use simple normalization.
    const clusters: Record<string, any[]> = {};

    tests.forEach(t => {
        // Normalize: "CBC - ESR" -> "cbc"
        // This is tricky. Let's group by strict first word? Or just process ALL sequentially?
        // Processing all 300+ tests in one prompt is too big context? Maybe not for Claude-3-5 context window (200k).
        // Let's try batching or clusters.
        // Let's group by "Code Prefix" or "Name similarity".
        // Simple normalization: Remove special chars, lowercase.
        const norm = t.name.toLowerCase().replace(/[^a-z0-9]/g, '');
        // Actually, just group by the first 4 chars of code? Or Name?
        // Let's try grouping by exact Code first, then Name.
        // The user example showed "CBCESR661" vs "CBCCOMPL408".
        // Let's rely on AI to cluster if we send batch.
        
        // Better: Group by first word of name.
        const firstWord = t.name.split(/[^a-zA-Z0-9]/)[0].toLowerCase();
        if (!clusters[firstWord]) clusters[firstWord] = [];
        clusters[firstWord].push(t);
    });

    // 3. Process Clusters
    console.log(`   found ${Object.keys(clusters).length} clusters/groups to analyze.`);

    for (const [key, group] of Object.entries(clusters)) {
        if (group.length < 2 && group[0].category !== 'Generated - AI' && group[0].default_price > 0) {
            // Skip single, healthy items
            continue;
        }

        console.log(`\n🤖 Analyzing Cluster: '${key}' (${group.length} items)`);
        
        // Prepare Payload
        const items = group.map(t => {
            let aNames: string[] = [];
            try {
                const aIds = typeof t.analytes === 'string' ? JSON.parse(t.analytes) : t.analytes;
                if (Array.isArray(aIds)) aNames = aIds.map((id:string) => analyteMap.get(id) || id);
            } catch (e) {}

            return {
                id: t.id,
                name: t.name,
                code: t.code,
                category: t.category,
                price: t.default_price,
                description: t.description,
                analytes: aNames, // AI sees Names
                created_at: t.created_at
            };
        });

        const prompt = `
        You are a Lab Manager Database Expert.
        I have a list of duplicate/messy test definitions for: "${key}".
        
        Your Goal:
        1. Identify the BEST single definition to keep (The "Master"). Prefer ones with proper categories (not 'Generated - AI'), meaningful descriptions, and COMPLETE analyte lists (more analytes usually means better).
        2. Identify duplicates to DELETE.
        3. Provide UPDATED fields for the Master (Clean Name, Standard Category, Realistic Price if 0, Clean Description).
        
        Input Data (JSON):
        ${JSON.stringify(items, null, 2)}
        
        Output JSON Format ONLY:
        {
          "master_id": "UUID of the one to keep",
          "delete_ids": ["UUID", "UUID"],
          "updates": {
             "name": "Standard Name",
             "category": "Hematology/Biochemistry/etc", 
             "default_price": 100.00,
             "description": "..."
          }
        }
        
        If none are good, pick the newest one as master and suggest fixes.
        Category map: Hematology, Biochemistry, Immunology, Microbiology, Clinical Pathology, Serology.
        Prices should be roughly: CBC=300, Lipid=500, Sugar=100. Estimate.
        `;

        try {
            const resultRaw = await analyzeWithClaude(prompt);
            // Parse JSON (extract from code blocks if needed)
            const jsonMatch = resultRaw.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                console.error("   ❌ AI returned invalid JSON");
                continue;
            }
            const result = JSON.parse(jsonMatch[0]);

            // Execute Updates
            if (result.master_id) {
                console.log(`      ✅ Keeping Master: ${result.master_id}`);
                
                // Update Master
                const { error: upError } = await supabase
                    .from('global_test_catalog')
                    .update(result.updates)
                    .eq('id', result.master_id);
                
                if (upError) console.error(`      ❌ Update Failed: ${upError.message}`);

                // Delete Duplicates
                if (result.delete_ids && result.delete_ids.length > 0) {
                     console.log(`      🗑️ Deleting ${result.delete_ids.length} duplicates...`);
                     // Note: Handle constraints (default_template_id linkage? global catalog usually safe unless used in onboarding logic)
                     const { error: delError } = await supabase
                        .from('global_test_catalog')
                        .delete()
                        .in('id', result.delete_ids);
                     
                     if (delError) console.error(`      ❌ Delete Failed: ${delError.message}`);
                }
            }

        } catch (e: any) {
            console.error(`   ❌ Error processing cluster: ${e.message}`);
        }
    }
    
    console.log("✅ Catalog Cleanup Complete.");
}

main().catch(console.error);
