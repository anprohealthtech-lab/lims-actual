// Full Pipeline Simulation: Hybrid Regex + Group-by-Group AI -> PDF.co
// Usage: node antigravity-test-node.js
// ------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

// 1. LOAD ENV VARS (Simulate dotenv)
let envConfig = {};
try {
    const envPath = path.resolve(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
        console.log('📄 Loading .env file from', envPath);
        const envContent = fs.readFileSync(envPath, 'utf8');
        envContent.split('\n').forEach(line => {
            const match = line.match(/^\s*([\w]+)\s*=\s*(.*)?\s*$/);
            if (match) {
                const key = match[1];
                let value = match[2] || '';
                if (value.length > 0 && value.charAt(0) === '"') {
                    value = value.replace(/^"|"$/g, '');
                }
                envConfig[key] = value.trim();
            }
        });
    } else {
        console.warn('⚠️ No .env file found in project root.');
    }
} catch (e) {
    console.error('❌ Error reading .env:', e.message);
}

// 2. CONFIGURATION
const PDFCO_API_KEY = process.env.PDFCO_API_KEY || 'YOUR_PDFCO_API_KEY';
const PDFCO_API_URL = 'https://api.pdf.co/v1/pdf/convert/from/html';

// Use environment variable for Anthropic API key
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'YOUR_ANTHROPIC_API_KEY';

const SUPABASE_URL = process.env.SUPABASE_URL || envConfig.VITE_SUPABASE_URL || envConfig.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || envConfig.SUPABASE_SERVICE_ROLE_KEY || envConfig.VITE_SUPABASE_ANON_KEY;

const TEST_ORDER_ID = "28e227c4-b3b4-4059-a204-7877aae811ad";

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('❌ CRITICAL: Could not find SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
    process.exit(1);
}

// 3. INITIALIZE SUPABASE
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ------------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------------

async function fetchImageAsBase64(url) {
    if (!url) return '';
    if (url.startsWith('data:')) return url;

    // console.log(`  ⬇️ Downloading asset: ${url.substring(0, 40)}...`);
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const base64 = buffer.toString('base64');
        return `data:image/png;base64,${base64}`;
    } catch (error) {
        console.error(`  ⚠️ Failed to download ${url}: ${error.message}`);
        return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
    }
}

// --- REGEX PRE-FILLER (The "Regress" Engine) ---
// Fast, cheap, and reliable for standard fields like Name, Date, ID.
function preFillGlobalPlaceholders(html, fullContext) {
    if (!html) return '';
    let processed = html;

    // Flatten context for easier mapping
    // We map BOTH standard dot-notation AND camelCase (as seen in screenshots)
    const flatMap = {
        // Standard Dot Notation
        'patient.name': fullContext.patient.name,
        'patient.sex_age': fullContext.patient.sex_age,
        'patient.age': fullContext.patient.age,
        'patient.gender': fullContext.patient.gender,
        'patient.ref_doctor': fullContext.patient.ref_doctor || '-',
        'patient.id': fullContext.patient.id,
        'sample_id': TEST_ORDER_ID.substring(0, 8),
        'lab.name': fullContext.lab.name,
        'lab.signatory_name': fullContext.lab.signatory_name,
        'lab.signatory_designation': fullContext.lab.signatory_designation,

        // CamelCase / Variations (Seen in User Screenshots)
        'patientName': fullContext.patient.name,
        'patientId': fullContext.patient.display_id || fullContext.patient.id, // Use human readable ID if available
        'patientAge': fullContext.patient.age,
        'patientGender': fullContext.patient.gender,
        'sampleId': TEST_ORDER_ID.substring(0, 8),
        'sampleld': TEST_ORDER_ID.substring(0, 8), // Common OCR typo l vs I
        'referringDoctorName': fullContext.patient.ref_doctor || '-',
        'referringDoctor': fullContext.patient.ref_doctor || '-',
        'collectionDate': new Date(fullContext.patient.collected_at).toLocaleDateString() || '-',
        'collectedOn': new Date(fullContext.patient.collected_at).toLocaleDateString() || '-',
        'signatoryName': fullContext.lab.signatory_name,
        'signatoryDesignation': fullContext.lab.signatory_designation
    };

    // 1. Replace specific known keys
    for (const [key, value] of Object.entries(flatMap)) {
        // Regex to match {{key}} or {key} with optional whitespace
        const regex = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'gi');
        processed = processed.replace(regex, value || '');
    }

    return processed;
}

// --- AI MERGE HELPER (Group Specific) ---
// Focuses strictly on filling the Test Results Repeater/Table
async function fillGroupTemplateWithAI(templateHtml, groupData, apiKey) {
    if (!apiKey) {
        console.warn('  ⚠️ No API Key. Skipping AI Merge.');
        return templateHtml;
    }

    console.log(`  🤖 Asking Claude to fill results table for: "${groupData.group_name}"...`);

    const prompt = `
    You are a strictly mechanical HTML rendering engine.
    
    Task: Fill the Test Results into the provided HTML Template.

    CONTEXT:
    - The 'Global' placeholders (like Patient Name) might already be filled. If not, ignore them.
    - Your MAIN JOB is to find the **Test Results Table/Section** and populate it with the provided JSON data.

    DATA (JSON):
    ${JSON.stringify({
        group_name: groupData.group_name,
        results: groupData.test_results.map(r => ({
            param: r.parameter,
            val: r.value,
            unit: r.unit || '',
            range: r.range || '',
            flag: r.flag || ''
        }))
    }, null, 2)}

    HTML TEMPLATE:
    ${templateHtml}

    RULES:
    1. Look for the "repeater" row in the table (it might look like {{param}} | {{val}}).
    2. Duplicate this row for EVERY result in the JSON data.
    3. If there are no obvious placeholders, creates a standard HTML table row <tr> inside the main table for each result.
    4. Maintain ALL existing CSS/Style tags exactly.
    5. RETURN ONLY VALID HTML. No markdown.
    `;

    try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-3-haiku-20240307',
                max_tokens: 4000,
                messages: [
                    { role: "user", content: prompt }
                ]
            })
        });

        const data = await response.json();

        if (data.error) throw new Error(data.error.message);

        return data.content[0].text.trim().replace(/^```html/, '').replace(/```$/, '');

    } catch (error) {
        console.error(`  ❌ AI Merge Failed: ${error.message}`);
        return templateHtml;
    }
}

async function runPipeline() {
    console.log(`🚀 Starting PDF Generation Pipeline (Hybrid) for Order: ${TEST_ORDER_ID}\n`);

    // STEP 1: QUERY VIEW
    console.log(`🔍 Querying 'view_report_final_context'...`);
    const { data: contextData, error } = await supabase
        .from('view_report_final_context')
        .select('*')
        .eq('order_id', TEST_ORDER_ID)
        .single();

    if (error) { console.error('❌ DB Error:', error.message); return; }
    if (!contextData) { console.error('❌ No data found.'); return; }

    // STEP 2: ASSETS
    console.log('\n🔄 Pre-processing Assets...');
    const assetKeys = {
        header: contextData.lab.header_url,
        footer: contextData.lab.footer_url,
        signature: contextData.lab.signature_url,
        watermark: contextData.lab.watermark_url
    };
    const assets = {};
    for (const [key, url] of Object.entries(assetKeys)) {
        assets[key] = await fetchImageAsBase64(url);
    }
    console.log('✅ Assets Ready.');

    // STEP 3: PROCESS EACH GROUP (ONE BY ONE)
    console.log('\n🏗️ Processing Groups...');

    let allGroupsHtml = '';

    // Loop with Index to handle first-page vs subsequent-page breaks if needed
    for (const [index, group] of contextData.test_results.entries()) {
        console.log(`  🔹 Processing Group: ${group.group_name}`);

        let htmlToProcess = '';
        let cssToKeep = '';

        // A. Get Template (or Fallback)
        if (group.template && group.template.html) {
            htmlToProcess = group.template.html;
            cssToKeep = group.template.css || '';
        } else {
            htmlToProcess = `
            <div class="group-section-default">
                <div style="padding:10px; background:#f3f4f6; font-weight:bold; border-bottom:1px solid #ddd;">
                    {{group_name}} <span style="font-size:12px; font-weight:normal;">({{department}})</span>
                </div>
                <!-- ... Default Table Logic ... -->
            </div>`;
        }

        // B. Pass 1: REGEX (Global Placeholders & Simple Group fields)
        htmlToProcess = htmlToProcess.replace(/\{\{\s*group_name\s*\}\}/gi, group.group_name);
        htmlToProcess = htmlToProcess.replace(/\{\{\s*department\s*\}\}/gi, group.department);

        htmlToProcess = preFillGlobalPlaceholders(htmlToProcess, contextData);

        // C. Pass 2: AI (Complex Repeater Logic)
        const filledHtml = await fillGroupTemplateWithAI(htmlToProcess, group, ANTHROPIC_API_KEY);

        // D. Accumulate with PAGE BREAKE
        // We force a page break before every group EXCEPT the very first one (optionally),
        // we adhere to user request "start new test new page".

        const pageBreakStyle = index > 0 ? 'page-break-before: always;' : 'margin-top: 20px;';

        allGroupsHtml += `
            <div class="group-wrapper" style="${pageBreakStyle} margin-bottom: 25px;">
                <style>${cssToKeep}</style>
                ${filledHtml}
            </div>
        `;
    }

    // STEP 4: ASSEMBLE FINAL BODY
    let bodyFrame = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <style>
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap');
            body { font-family: 'Inter', sans-serif; padding: 20px; font-size: 14px; color: #333; }
            .watermark { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); opacity: 0.1; z-index: -1; width: 60%; }
        </style>
    </head>
    <body style="font-family: 'Inter', sans-serif;">
        ${assets.watermark ? `<img src="${assets.watermark}" class="watermark">` : ''}

        <!-- PATIENT INFO BOX (Standardized) -->
        <div style="border: 1px solid #e5e7eb; border-radius: 8px; padding: 15px; display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 20px; background-color: #f9fafb;">
            <div><div style="font-size:11px; color:#666;">Patient Name</div><div style="font-weight:600;">{{patientName}}</div></div>
            <div><div style="font-size:11px; color:#666;">Sample ID</div><div style="font-weight:600;">{{sampleId}}</div></div>
            <div><div style="font-size:11px; color:#666;">Age / Gender</div><div style="font-weight:600;">{{patientAge}} / {{patientGender}}</div></div>
            <div><div style="font-size:11px; color:#666;">Ref. Doctor</div><div style="font-weight:600;">{{referringDoctorName}}</div></div>
        </div>

        ${allGroupsHtml}

        <!-- SIGNATURE BLOCK -->
        <div style="margin-top: 50px; text-align: right; margin-right: 20px;">
            <img src="${assets.signature}" style="height:50px;">
            <p style="margin:5px 0 0 0; font-weight:bold;">{{signatoryName}}</p>
            <p style="margin:0; font-size:12px; color:#6b7280;">{{signatoryDesignation}}</p>
        </div>
    </body>
    </html>
    `;

    const finalHtml = preFillGlobalPlaceholders(bodyFrame, contextData);

    // STEP 5: SEND TO PDF.CO
    console.log('\n🖨️ Sending to PDF.co ...');

    const headerHtml = `<!DOCTYPE html><html><body style="margin:0;"><div style="width:100%;height:100px;display:flex;justify-content:center;">${assets.header ? `<img src="${assets.header}" style="height:100%;object-fit:contain;">` : ''}</div></body></html>`;
    const footerHtml = `<!DOCTYPE html><html><body style="margin:0;"><div style="width:100%;height:80px;display:flex;justify-content:center;">${assets.footer ? `<img src="${assets.footer}" style="height:100%;object-fit:contain;">` : ''}</div></body></html>`;

    const payload = {
        html: finalHtml,
        header: headerHtml,
        footer: footerHtml,
        paperSize: 'A4',
        marginTop: '150px',
        marginBottom: '90px',
        marginLeft: '20px',
        marginRight: '20px',
        printHeaderFooter: true,
        printBackground: true,
        name: `HYBRID_REPORT_${TEST_ORDER_ID}.pdf`,

        // INJECTED CSS PROFILE FOR TABLE BREAKS
        profiles: JSON.stringify({ "profiles": [{ "profile1": { "HTMLCodeHeadInject": "<style> @media print { table, tr, td { break-inside: avoid !important; } } </style>" } }] }).replace('"profiles": [ { "profile1":', '"profiles":').replace('} ] }', '} }')
    };

    // Correcting Profile syntax to match User Request exactly
    payload.profiles = "{'profiles': [ {'profile1': {'HTMLCodeHeadInject':'<style> @media print { table,tr,td { break-inside: avoid !important; } } </style>'} } ] }";
    // Actually the user provided a very specific simple format that PDF.co also accepts occasionally, but usually it's array.
    // Let's stick to the official JSON string which is safest.

    // Profiles parameter must be a JSON STRING that represents the configuration.
    // Based on user request: "{'profiles': \"{'HTMLCodeHeadInject':'<style> @media print { table,tr,td { break-inside: avoid !important; } } </style>'}\"}"
    // This looks like key-value.

    // Let's try the standard JSON structure for profiles
    const profilesObj = {
        "profiles": [
            {
                "profile1": {
                    "HTMLCodeHeadInject": "<style> @media print { table,tr,td { break-inside: avoid !important; } } </style>"
                }
            }
        ]
    };
    payload.profiles = JSON.stringify(profilesObj);

    try {
        const response = await fetch(PDFCO_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': PDFCO_API_KEY },
            body: JSON.stringify(payload)
        });
        const result = await response.json();

        if (result.error) throw new Error(result.message);
        console.log('\n✅ PDF Generated Successfully!');
        console.log('📄 URL:', result.url);
    } catch (error) {
        console.error('❌ PDF Generation Failed:', error.message);
    }
}

runPipeline();
