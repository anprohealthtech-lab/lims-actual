// Supabase Edge Function: One-Shot/Hybrid AI Report Generation
// Logic ported from confirmed working test: antigravity-test-node.js
// Strategy: Regex Pre-fill -> Group-by-Group AI Merge -> PDF.co

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// CONFIGURATION
const PDFCO_API_URL = 'https://api.pdf.co/v1/pdf/convert/from/html'
const PDFCO_API_KEY = Deno.env.get('PDFCO_API_KEY') || ''
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') || ''

// GLOBAL STYLES (User Provided + Wrapper)
const STABLE_REPORT_CSS = `
:root {
  --primary-blue:#0b4aa2;
  --light-blue:#eaf2ff;
  --success-green:#12b76a;
  --warning-amber:#f79009;
  --danger-red:#d92d20;
  --text-dark:#1f2937;
  --text-muted:#64748b;
  --border-light:#e5ecf6;
  --row-alt:#f7faff;
  --page-bg:#f4f7fb;
  --card-bg:#ffffff;
}

body {
  margin:0;
  padding:16px;
  font-family: Inter, sans-serif;
  color:var(--text-dark);
  background:var(--page-bg);
}

.report-container {
  max-width:900px;
  margin:0 auto;
  background:var(--card-bg);
  border-radius:14px;
  overflow:hidden;
  border:1px solid var(--border-light);
  box-shadow:0 8px 24px rgba(0,60,120,.08);
}

.report-header {
  background-color:var(--primary-blue) !important;
  color:#fff !important;
  padding:12px 16px;
}

.report-header h1 {
  margin:0;
  font-size:20px;
  font-weight:800;
}

.report-header .report-subtitle {
  margin-top:4px;
  font-size:13px;
  opacity:.92;
}

.report-body {
  padding:14px 16px 16px;
}

.section-header {
  background-color:var(--light-blue) !important;
  color:var(--primary-blue) !important;
  padding:8px 12px;
  border-radius:8px;
  font-weight:800;
  font-size:15px;
  margin:12px 0 8px;
  border:1px solid rgba(11,74,162,.12);
}

.patient-info,
.report-table {
  width:100%;
  border-collapse:separate;
  border-spacing:0;
  background:#fff;
  border:1px solid var(--border-light);
  border-radius:12px;
  overflow:hidden;
  font-size:13px;
}

.patient-info {
  table-layout:fixed;
}

.patient-info td,
.report-table td {
  padding:7px 10px;
  border-bottom:1px solid var(--border-light);
  vertical-align:middle;
}

.patient-info td {
  word-break:break-word;
}

.patient-info td.label {
  color:var(--text-muted);
  font-weight:700;
  background:#fbfdff;
}

.patient-info td.value {
  font-weight:700;
  color:var(--text-dark);
}

.report-table thead th {
  background-color:var(--primary-blue) !important;
  color:#fff !important;
  padding:8px 10px;
  text-align:left;
  font-weight:800;
  font-size:13px;
}

.report-table tbody tr:nth-child(even) {
  background:var(--row-alt);
}

.param-name {
  font-weight:800;
  color:#0f172a;
}

.col-center {
  text-align:center;
}

.value-high {
  color:var(--danger-red);
  font-weight:900;
}

.value-borderline {
  color:var(--warning-amber);
  font-weight:900;
}

.value-optimal {
  color:var(--success-green);
  font-weight:900;
}

.patient-info tr:last-child td,
.report-table tbody tr:last-child td {
  border-bottom:none;
}

.notes{
  margin-top:12px;
  padding:10px 12px;
  font-size:12px;
  color:var(--text-muted);
  background:#fbfdff;
  border:1px solid var(--border-light);
  border-left:4px solid var(--primary-blue);
  border-radius:10px;
}

.report-footer{
  margin-top:14px;
  padding-top:10px;
  border-top:1px solid var(--border-light);
  font-size:12px;
  color:var(--text-muted);
  text-align:center;
}
`;

// HELPERS
async function fetchImageAsBase64(url: string | null) {
    if (!url) return '';
    if (url.startsWith('data:')) return url; 
    
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const arrayBuffer = await response.arrayBuffer();
        const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
        return `data:image/png;base64,${base64}`;
    } catch (error) {
        console.error(`  ⚠️ Failed to download ${url}: ${error.message}`);
        return 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    }
}

// REGEX PRE-FILLER (The "Regress" Engine)
function preFillGlobalPlaceholders(html: string, fullContext: any, orderId: string) {
    if (!html) return '';
    let processed = html;

    // Flatten context for easier mapping
    const flatMap = {
        // Standard Dot Notation
        'patient.name': fullContext.patient.name,
        'patient.sex_age': fullContext.patient.sex_age,
        'patient.age': fullContext.patient.age,
        'patient.gender': fullContext.patient.gender,
        'patient.ref_doctor': fullContext.patient.ref_doctor || '-',
        'patient.id': fullContext.patient.id,
        'sample_id': orderId.substring(0, 8),
        'order_id_short': orderId.substring(0, 8),
        'lab.name': fullContext.lab.name,
        'lab.address': fullContext.lab.address,
        'lab.phone': fullContext.lab.phone,
        'lab.signatory_name': fullContext.lab.signatory_name,
        'lab.signatory_designation': fullContext.lab.signatory_designation,
        'doctor.name': fullContext.doctor ? fullContext.doctor.name : '-',
        
        // CamelCase / Variations
        'patientName': fullContext.patient.name,
        'patientId': fullContext.patient.display_id || fullContext.patient.id,
        'patientAge': fullContext.patient.age,
        'patientGender': fullContext.patient.gender,
        'sampleId': orderId.substring(0, 8),
        'sampleld': orderId.substring(0, 8),
        'referringDoctorName': fullContext.patient.ref_doctor || '-',
        'referringDoctor': fullContext.patient.ref_doctor || '-',
        'collectionDate': new Date(fullContext.patient.collected_at).toLocaleDateString() || '-',
        'collectedOn': new Date(fullContext.patient.collected_at).toLocaleDateString() || '-',
        'signatoryName': fullContext.lab.signatory_name,
        'signatoryDesignation': fullContext.lab.signatory_designation
    };

    // Replace specific keys
    for (const [key, value] of Object.entries(flatMap)) {
        const regex = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'gi');
        processed = processed.replace(regex, String(value || ''));
    }

    return processed;
}

// AI MERGE HELPER (Group Specific)
async function fillGroupTemplateWithAI(templateHtml: string, groupData: any, apiKey: string) {
    if (!apiKey) {
        console.warn('  ⚠️ No API Key. Skipping AI Merge.');
        return templateHtml;
    }

    const prompt = `
    You are a strictly mechanical HTML rendering engine.
    
    Task: Fill the Test Results into the provided HTML Template.

    CONTEXT:
    - The 'Global' placeholders (like Patient Name) might already be filled. If not, ignore them.
    - Your MAIN JOB is to find the **Test Results Table/Section** and populate it with the provided JSON data.

    DESIGN RULES:
    1. If you are generating new rows or populating values, use these classes to ensure a stable, styled report:
       - Use class "value-high" for results flagged High/Abnormal.
       - Use class "value-optimal" for results flagged Normal.
       - Use class "value-borderline" for results flagged Low/Borderline.
       - Use class "report-table" for the table structure if you are creating it.
    2. Maintain ALL existing CSS/Style tags exactly.
    3. Ensure the output is valid HTML fragment.

    DATA (JSON):
    ${JSON.stringify({
        group_name: groupData.group_name,
        results: groupData.test_results.map((r: any) => ({
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
    3. Use the DESIGN RULES to apply class names or styles if the template supports it (e.g. <td class="{{flag_class}}">).
    4. RETURN ONLY VALID HTML. No markdown.
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


// MAIN HANDLER
serve(async (req) => {
    // Handle CORS
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const { order_id } = await req.json();

        if (!order_id) {
            throw new Error('Missing order_id');
        }

        console.log(`🚀 Starting Hybrid Report Generation for Order: ${order_id}`);

        // SUPABASE CLIENT
        const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
        const supabase = createClient(supabaseUrl, supabaseKey);

        // STEP 1: QUERY VIEW
        console.log(`🔍 Querying 'view_report_final_context'...`);
        const { data: contextData, error: dbError } = await supabase
            .from('view_report_final_context')
            .select('*')
            .eq('order_id', order_id)
            .single();

        if (dbError) throw new Error(`DB Error: ${dbError.message}`);
        if (!contextData) throw new Error('No data found for this order in view_report_final_context');

        // STEP 2: ASSETS
        console.log('\n🔄 Pre-processing Assets...');
        const assetKeys = {
            header: contextData.lab.header_url,
            footer: contextData.lab.footer_url,
            signature: contextData.lab.signature_url,
            watermark: contextData.lab.watermark_url
        };
        const assets: any = {};
        for (const [key, url] of Object.entries(assetKeys)) {
            assets[key] = await fetchImageAsBase64(url as string);
        }
        
        // STEP 3: PROCESS EACH GROUP
        console.log('\n🏗️ Processing Groups...');
        let allGroupsHtml = '';

        for (const [index, group] of (contextData.test_results || []).entries()) {
            console.log(`  🔹 Processing Group: ${group.group_name}`);
            
            let htmlToProcess = '';
            let cssToKeep = '';

            if (group.template && group.template.html) {
                htmlToProcess = group.template.html;
                cssToKeep = group.template.css || '';
            } else {
                // FALLBACK DEFAULT WITH NEW CLASSES
                htmlToProcess = `
                <div class="group-section-default">
                    <div class="section-header">
                        {{group_name}} <span style="font-size:12px; font-weight:normal; opacity:0.8;">({{department}})</span>
                    </div>
                    <table class="report-table">
                        <thead>
                            <tr>
                                <th>Test Parameter</th>
                                <th class="col-center">Value</th>
                                <th class="col-center">Unit</th>
                                <th class="col-center">Reference Range</th>
                            </tr>
                        </thead>
                        <tbody>
                            <!-- AI Repeater Row -->
                            <tr class="result-row">
                                <td class="param-name">{{param}}</td>
                                <td class="col-center">{{val}}</td>
                                <td class="col-center">{{unit}}</td>
                                <td class="col-center">{{range}}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>`;
            }

            // REGEX (Pass 1)
            htmlToProcess = htmlToProcess.replace(/\{\{\s*group_name\s*\}\}/gi, group.group_name);
            htmlToProcess = htmlToProcess.replace(/\{\{\s*department\s*\}\}/gi, group.department);
            htmlToProcess = preFillGlobalPlaceholders(htmlToProcess, contextData, order_id);

            // AI (Pass 2)
            const filledHtml = await fillGroupTemplateWithAI(htmlToProcess, group, ANTHROPIC_API_KEY);

            // Page Break logic
            const pageBreakStyle = index > 0 ? 'page-break-before: always;' : '';

            allGroupsHtml += `
            <div class="group-wrapper" style="${pageBreakStyle} margin-bottom: 25px;">
                <style>${cssToKeep}</style>
                ${filledHtml}
            </div>`;
        }

        // STEP 4: ASSEMBLE FINAL BODY (Wrapped in Report Container & Body)
        let bodyFrame = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <style>
                @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap');
                ${STABLE_REPORT_CSS}
                .watermark { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); opacity: 0.1; z-index: -1; width: 60%; }
            </style>
        </head>
        <body>
            ${assets.watermark ? `<img src="${assets.watermark}" class="watermark">` : ''}

            <div class="report-container">
                <div class="report-body">
                    
                    <!-- PATIENT INFO BOX (Standardized with New Classes) -->
                    <table class="patient-info" style="margin-bottom: 20px;">
                        <tr>
                            <td class="label" style="width: 20%;">Patient Name</td>
                            <td class="value" style="width: 30%;">{{patientName}}</td>
                            <td class="label" style="width: 20%;">Sample ID</td>
                            <td class="value" style="width: 30%;">{{sampleId}}</td>
                        </tr>
                        <tr>
                            <td class="label">Age / Gender</td>
                            <td class="value">{{patientAge}} / {{patientGender}}</td>
                            <td class="label">Collected On</td>
                            <td class="value">{{collectionDate}}</td>
                        </tr>
                        <tr>
                            <td class="label">Ref. Doctor</td>
                            <td class="value" colspan="3">{{referringDoctorName}}</td>
                        </tr>
                    </table>

                    ${allGroupsHtml}

                    <!-- SIGNATURE BLOCK -->
                    <div class="report-footer" style="padding-top:30px; border-top:none; text-align:right;">
                        ${assets.signature ? `<img src="${assets.signature}" style="height:50px; display:inline-block;">` : ''}
                        <p style="margin:5px 0 0 0; font-weight:bold; color:var(--text-dark);">{{signatoryName}}</p>
                        <p style="margin:0; font-size:12px; color:var(--text-muted);">{{signatoryDesignation}}</p>
                    </div>

                </div>
            </div>
        </body>
        </html>
        `;

        const finalHtml = preFillGlobalPlaceholders(bodyFrame, contextData, order_id);

        // STEP 5: PDF.CO
        console.log('\n🖨️ Sending to PDF.co ...');
        
         const headerHtml = `<!DOCTYPE html><html><body style="margin:0;"><div style="width:100%;height:100px;display:flex;justify-content:center;">${assets.header ? `<img src="${assets.header}" style="height:100%;object-fit:contain;">` : ''}</div></body></html>`;
         const footerHtml = `<!DOCTYPE html><html><body style="margin:0;"><div style="width:100%;height:80px;display:flex;justify-content:center;">${assets.footer ? `<img src="${assets.footer}" style="height:100%;object-fit:contain;">` : ''}</div></body></html>`;
        
         const profilesObj = {
            "profiles": [
                {
                    "profile1": {
                        "HTMLCodeHeadInject": "<style> @media print { table,tr,td { break-inside: avoid !important; } } </style>"
                    }
                }
            ]
        };

        const payload = {
            html: finalHtml,
            header: headerHtml,
            footer: footerHtml,
            paperSize: 'A4',
            marginTop: '150px',
            marginBottom: '90px',
            marginLeft: '20px',
            marginRight: '20px',
            headerHeight: "90px",
            footerHeight: "80px",
            scale: 1,
            mediaType: "screen",
            printBackground: true,
            printHeaderFooter: true,
            name: `REPORT_${order_id}.pdf`,
            profiles: JSON.stringify(profilesObj)
        };

        const pdfResponse = await fetch(PDFCO_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': PDFCO_API_KEY },
            body: JSON.stringify(payload)
        });
        
        const pdfResult = await pdfResponse.json();
        
        if (pdfResult.error) {
            throw new Error(`PDF.co Error: ${pdfResult.message}`);
        }

        console.log('✅ PDF Generated Successfully:', pdfResult.url);

        return new Response(
            JSON.stringify({
                success: true,
                pdfUrl: pdfResult.url,
                orderId: order_id
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );

    } catch (error) {
        console.error('❌ Error:', error.message);
        return new Response(
            JSON.stringify({ error: error.message }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
});
