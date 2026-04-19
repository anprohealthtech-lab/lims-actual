import React, { useState, useEffect } from 'react';
import { X, Save, RefreshCw } from 'lucide-react';
import { database, supabase } from '../../utils/supabase'; // Assuming standard export
import { prepareViewerReportData } from '../../utils/pdfViewerService';
import { AssetSidebar } from './AssetSidebar';
import { ReportConfig, ReportData, BrandingAsset } from './types';

interface TestGroupInfo {
    id: string;
    name: string;
}

interface ReportDesignStudioProps {
    orderId: string;
    onClose: () => void;
    onSuccess?: (pdfUrl: string) => void;
}

const ReportDesignStudio: React.FC<ReportDesignStudioProps> = ({ orderId, onClose, onSuccess }) => {
    const [data, setData] = useState<ReportData | null>(null);
    const [assets, setAssets] = useState<BrandingAsset[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isGenerating, setIsGenerating] = useState(false);
    const [testGroups, setTestGroups] = useState<TestGroupInfo[]>([]);

    // Default Config
    const [config, setConfig] = useState<ReportConfig>({
        headerId: 'none',
        footerId: 'none',
        showAbnormalColors: true,
        showSignature: true,
        showQrCode: true,
        showMethodology: true,
        headerHeight: 35,
        footerHeight: 20,
        extraAssets: []
    });

    // New: Visibility Sections State - Typed as Record<string, boolean>
    const [visibleSections, setVisibleSections] = useState<Record<string, boolean>>({
        header: true,
        footer: true,
        clinicalSummary: true,
        interpretation: true,
        methodology: true,
        graphs: true,
        patientSummary: true
    });

    // URLs for live preview
    // New: State for Server-Side HTML
    const [serverHtml, setServerHtml] = useState<{
        body: string;
        header: string;
        footer: string;
        settings?: any;
    } | null>(null);
    const safeTestGroups = Array.isArray(testGroups) ? testGroups : [];
    const safeExtraAssets = Array.isArray(config.extraAssets) ? config.extraAssets : [];

    // Fetch Data & Server HTML
    useEffect(() => {
        const fetchData = async () => {
            try {
                setIsLoading(true);
                // 1. Fetch Order Data using consolidated service (matches PDF generation logic)
                const viewerData = await prepareViewerReportData(orderId);

                if (!viewerData) {
                    throw new Error("Failed to load report data");
                }

                // 2. Map ViewerData to ReportData structure for components
                // Group flat analytes by Test Name
                const groupedResults: Record<string, any> = {};
                const discoveredGroups: TestGroupInfo[] = [];
                const seenGroupNames = new Set<string>();

                (viewerData.testResults || []).forEach((r: any) => {
                    const tName = r.testName || 'Test Results';
                    if (!groupedResults[tName]) {
                        groupedResults[tName] = {
                            id: tName, // Use name as ID for grouping
                            results: []
                        };
                        if (!seenGroupNames.has(tName)) {
                            seenGroupNames.add(tName);
                            discoveredGroups.push({ id: tName, name: tName });
                        }
                    }

                    groupedResults[tName].results.push({
                        parameter_name: r.parameter,
                        result_value: r.result,
                        unit: r.unit,
                        reference_range: r.referenceRange,
                        flag: r.flag, // 'H', 'L', etc.
                        is_abnormal: ['H', 'L', 'A', 'High', 'Low', 'Abnormal', 'Critical'].includes(r.flag || '')
                    });
                });

                setTestGroups(discoveredGroups);

                // Initialize per-test-group visibility (all visible by default)
                if (discoveredGroups.length > 0) {
                    setVisibleSections(prev => {
                        const updated = { ...prev };
                        discoveredGroups.forEach(g => {
                            updated[`testGroup_${g.id}`] = true;
                        });
                        return updated;
                    });
                }

                const processedTests = Object.values(groupedResults);

                setData({
                    order: {
                        id: viewerData.order.orderId,
                        order_date: viewerData.order.orderDate,
                        doctor_name: viewerData.patient.referredBy,
                        sample_collected_at: viewerData.order.sampleCollectedAt,
                        // Add other fields if needed by PatientInfo
                    },
                    patient: {
                        name: viewerData.patient.name,
                        age: viewerData.patient.age,
                        gender: viewerData.patient.gender,
                        id: viewerData.patient.id,
                        custom_id: viewerData.patient.id
                    },
                    tests: processedTests || [],
                    lab: viewerData.lab,
                    extras: viewerData.extras || undefined // Pass extras to ReportData
                });

                // 3. Fetch Branding Assets (lab-scoped)
                const { data: assetsDataRaw, error: assetsError } = await database.labBrandingAssets.getAll(viewerData.lab.id);

                if (assetsError) {
                    console.warn('Error fetching branding assets:', assetsError);
                    setAssets([]);
                } else {
                    const mappedAssets = (assetsDataRaw || []).map((asset: any) => {
                        const bestUrl = asset?.imagekit_url || asset?.processed_url || asset?.variants?.optimized || asset?.variants?.optimized_url || asset?.file_url;
                        return {
                            id: asset.id,
                            lab_id: asset.lab_id,
                            asset_type: asset.asset_type,
                            url: bestUrl,
                            name: asset.asset_name,
                            is_default: asset.is_default,
                        } as BrandingAsset;
                    });
                    setAssets(mappedAssets);
                }

                // Pre-select defaults
                if (assetsDataRaw) {
                    const defHeader = assetsDataRaw.find((a: any) => a.asset_type === 'header' && a.is_default);
                    const defFooter = assetsDataRaw.find((a: any) => a.asset_type === 'footer' && a.is_default);

                    setConfig(prev => ({
                        ...prev,
                        headerId: defHeader ? defHeader.id : 'none',
                        footerId: defFooter ? defFooter.id : 'none'
                    }));

                    // Also set visibility defaults based on config
                    setVisibleSections(prev => ({
                        ...prev,
                        header: !!defHeader,
                        footer: !!defFooter
                    }));
                }

            } catch (err: any) {
                console.error('Error loading report studio:', err);
                alert('Failed to load report details.');
            } finally {
                setIsLoading(false);
            }
        };

        const loadServerPreview = async () => {
            try {
                const { data, error } = await supabase.functions.invoke('generate-report-html', {
                    body: { orderId }
                });
                if (error) {
                    console.error('Server preview error:', error);
                    return;
                }
                if (data?.success) {
                    setServerHtml({
                        body: data.html,
                        header: data.header,
                        footer: data.footer,
                        settings: data.settings
                    });
                }
            } catch (e) {
                console.error('Failed to load server preview', e);
            }
        };

        // Call both
        fetchData();
        loadServerPreview();

    }, [orderId]);



    const handleGeneratePDF = async () => {
        if (!data) return;
        setIsGenerating(true);

        try {
            // Use the current preview HTML as the exact source for PDF generation
            const fullHtml = getPreviewHtml();

            if (!fullHtml) {
                throw new Error("Preview HTML not ready");
            }

            // Get current user ID for WhatsApp integration
            const { data: { user } } = await supabase.auth.getUser();
            const triggeredByUserId = user?.id;

            // 2. Call Edge Function with HTML Payload
            const { data: funcData, error: funcError } = await supabase.functions.invoke('generate-pdf-letterhead', {
                body: {
                    orderId,
                    htmlOverride: fullHtml, // Sending the manually crafted HTML
                    isManualDesign: true,
                    triggeredByUserId
                }
            });

            if (funcError) throw funcError;

            if (funcData?.success) {
                // Save report record in the reports table so WhatsApp/status works
                try {
                    const now = new Date().toISOString();
                    const labId = data.lab?.id || await database.getCurrentUserLabId();
                    const patientId = data.patient?.id;

                    if (patientId && labId) {
                        const { data: existingReport } = await supabase
                            .from('reports')
                            .select('id')
                            .eq('order_id', orderId)
                            .maybeSingle();

                        if (existingReport) {
                            await supabase
                                .from('reports')
                                .update({
                                    pdf_url: funcData.pdfUrl,
                                    pdf_generated_at: now,
                                    status: 'completed',
                                    report_status: 'completed',
                                    report_type: 'final',
                                    updated_at: now
                                })
                                .eq('id', existingReport.id);
                        } else {
                            await supabase
                                .from('reports')
                                .insert({
                                    order_id: orderId,
                                    patient_id: patientId,
                                    lab_id: labId,
                                    doctor: data.order?.doctor_name || '',
                                    pdf_url: funcData.pdfUrl,
                                    pdf_generated_at: now,
                                    generated_date: now,
                                    status: 'completed',
                                    report_status: 'completed',
                                    report_type: 'final',
                                    updated_at: now
                                });
                        }
                        console.log('✅ Report record saved/updated in reports table');
                    }

                    // Mark any pending/processing pdf_generation_queue job as completed
                    // so the auto-generation progress badge doesn't re-appear
                    await supabase
                        .from('pdf_generation_queue')
                        .update({
                            status: 'completed',
                            completed_at: new Date().toISOString(),
                            result_url: funcData.pdfUrl
                        })
                        .eq('order_id', orderId)
                        .in('status', ['pending', 'processing']);

                    // Also update order report_generation_status
                    await supabase
                        .from('orders')
                        .update({
                            report_generation_status: 'completed',
                            report_auto_generated_at: new Date().toISOString()
                        })
                        .eq('id', orderId);

                } catch (reportSaveErr) {
                    console.error('⚠️ Failed to save report record (PDF still generated):', reportSaveErr);
                }

                if (onSuccess && funcData.pdfUrl) onSuccess(funcData.pdfUrl);
                onClose();
            } else {
                throw new Error(funcData?.error || 'Unknown error');
            }

        } catch (err: any) {
            console.error('Generation Error:', err);
            alert('Failed to generate PDF: ' + err.message);
        } finally {
            setIsGenerating(false);
        }
    };

    if (isLoading && !serverHtml) {
        return (
            <div className="fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center z-50 text-white">
                <RefreshCw className="w-8 h-8 animate-spin mb-2" />
                <span className="ml-2">Loading Studio...</span>
            </div>
        );
    }

    // Construct Composite HTML for Preview
    const getPreviewHtml = () => {
        if (!serverHtml) return '';

        let doc = serverHtml.body;

        // Determine effective Header HTML
        let effectiveHeader = serverHtml.header;

        if (config.headerId && config.headerId !== 'none') {
            const asset = assets.find(a => a.id === config.headerId);
            if (asset && asset.url) {
                effectiveHeader = `<img src="${asset.url}" style="width: 100%; height: 100%; object-fit: contain; display: block;" alt="Header" />`;
            }
        } else {
            // User selected None. 
            // If the original server header was an image (e.g. default asset), we must clear it.
            // If it was text, we preserve it (assuming 'None' selection with no assets means 'Default Text').
            // Heuristic: If server header has <img> tag, clear it.
            if (serverHtml.header && (serverHtml.header.includes('<img') || serverHtml.header.includes('background-image'))) {
                effectiveHeader = '';
            }
        }

        // Determine effective Footer HTML
        let effectiveFooter = serverHtml.footer;
        if (config.footerId && config.footerId !== 'none') {
            const asset = assets.find(a => a.id === config.footerId);
            if (asset && asset.url) {
                effectiveFooter = `<img src="${asset.url}" style="width: 100%; height: 100%; object-fit: contain; display: block;" alt="Footer" />`;
            }
        } else {
            // Same logic for footer
            if (serverHtml.footer && (serverHtml.footer.includes('<img') || serverHtml.footer.includes('background-image'))) {
                effectiveFooter = '';
            }
        }


        // Inject Header/Footer styles for Preview (simulating PDF layout)
        const headerH = `${config.headerHeight ?? 35}mm`;
        const footerH = `${config.footerHeight ?? 20}mm`;

        // Combine into a single view with ID wrappers for visibility control
        const headerDiv = `<div id="preview-header-container" style="height: ${headerH}; overflow: hidden; margin-bottom: 20px;">${effectiveHeader}</div>`;
        const footerDiv = `<div id="preview-footer-container" style="height: ${footerH}; overflow: hidden; margin-top: 20px;">${effectiveFooter}</div>`;

        // Inject Styles for Toggle Visibility
                const testGroupCss = safeTestGroups.map(g => {
                    const key = `testGroup_${g.id}`;
                    const visible = visibleSections[key] !== false; // default true
                    if (!visible) {
                        // Hide the entire test-group-section by matching data attribute or the group name in header
                        return `.test-group-section[data-test-group-id="${g.id}"] { display: none !important; }`;
                    }
                    return '';
                }).filter(Boolean).join('\n');

                const visibilityStyles = `
            <style>
                #preview-header-container { display: ${visibleSections.header ? 'block' : 'none'} !important; }
                #preview-footer-container { display: ${visibleSections.footer ? 'block' : 'none'} !important; }
                .clinical-summary-section, .report-ai-summary { display: ${visibleSections.clinicalSummary ? 'block' : 'none'} !important; }
                .report-extras-trends, .report-trend-graph, .trend-chart { display: ${visibleSections.graphs ? 'block' : 'none'} !important; }
                .report-patient-summary { display: ${visibleSections.patientSummary ? 'block' : 'none'} !important; }
                .section-content, .report-doctor-summary { display: ${visibleSections.interpretation ? 'block' : 'none'} !important; }
                ${!visibleSections.methodology ? '.methodology, .analyte-method, [class*="methodology"] { display: none !important; }' : ''}
                ${testGroupCss}
                                ${config.showSignature ? '' : '.signature-section, [class*="signature"], [id*="signature"] { display: none !important; }'}
                                ${config.showQrCode ? '' : '.qr-code, .qrcode, .report-qr, .report-qr-code, #qr-code, #qrcode, [data-qr] { display: none !important; }'}
                                ${config.showMethodology ? '' : '.methodology, .analyte-method, [class*="methodology"] { display: none !important; }'}
                                ${config.showAbnormalColors ? '' : `
                                    .result-abnormal, .abnormal, .flag-abnormal,
                                    .result-high, .flag-high, .result-critical_high,
                                    .result-low, .flag-low, .result-critical_low {
                                        color: #111827 !important;
                                        font-weight: 500 !important;
                                    }
                                `}
                                .report-extra-assets { position: absolute; top: 0; left: 0; right: 0; bottom: 0; pointer-events: none; }
                                .report-extra-asset { position: absolute; }
            </style>
        `;

                const extraAssetsHtml = safeExtraAssets.length
                        ? `
                                <div class="report-extra-assets">
                                    ${safeExtraAssets.map((asset) => `
                                        <div
                                            class="report-extra-asset"
                                            style="left:${asset.position.x}mm; top:${asset.position.y}mm; width:${asset.size.width}mm; height:${asset.size.height}mm;"
                                        >
                                            <img src="${asset.url}" alt="Asset" style="width:100%; height:100%; object-fit:contain;" />
                                        </div>
                                    `).join('')}
                                </div>
                            `
                        : '';

        // Inject styles into head
        if (doc.includes('</head>')) {
            doc = doc.replace('</head>', `${visibilityStyles}</head>`);
        } else {
            // Fallback if no head tag
            doc = visibilityStyles + doc;
        }

        // Inject into body
        // Note: doc contains <body ...> content </body>
        // We replace body content wrapper

        doc = doc.replace('<body class="limsv2-report">', `<body class="limsv2-report" style="padding: 20px; box-sizing: border-box; position: relative;">${headerDiv}${extraAssetsHtml}<div style="min-height: 800px;">`);
        doc = doc.replace('</body>', `</div>${footerDiv}</body>`);

        return doc;
    };

    return (
        <div className="fixed inset-0 bg-gray-100 z-50 flex flex-col">
            {/* Top Bar */}
            <div className="h-16 bg-white border-b border-gray-200 px-6 flex items-center justify-between shadow-sm">
                <div className="flex items-center">
                    <h1 className="text-xl font-bold text-gray-800">Report Design Studio</h1>
                    <span className="ml-4 px-3 py-1 bg-green-50 text-green-700 text-xs rounded-full font-medium">
                        Server-Side Preview
                    </span>
                    {safeTestGroups.length > 1 && (
                        <span className="ml-2 px-3 py-1 bg-blue-50 text-blue-700 text-xs rounded-full font-medium">
                            {safeTestGroups.length} Test Groups
                        </span>
                    )}
                </div>
                <div className="flex items-center space-x-4">
                    <button onClick={onClose} className="p-2 text-gray-500 hover:bg-gray-200 rounded-full transition-colors">
                        <X className="w-6 h-6" />
                    </button>
                    <button
                        onClick={handleGeneratePDF}
                        disabled={isGenerating}
                        className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50"
                    >
                        {isGenerating ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                        {isGenerating ? 'Generating...' : 'Save & Generate PDF'}
                    </button>
                </div>
            </div>

            {/* Workspace */}
            <div className="flex-1 flex overflow-hidden">
                {/* Sidebar (Optional: disable or keep for assets reference) */}
                <AssetSidebar
                    config={config}
                    setConfig={setConfig}
                    availableAssets={assets}
                    visibleSections={visibleSections}
                    setVisibleSections={setVisibleSections}
                    testGroups={safeTestGroups}
                />

                {/* Canvas Area - Iframe Preview */}
                <div className="flex-1 bg-gray-200 p-8 overflow-auto flex justify-center items-start">
                    {serverHtml ? (
                        <div className="bg-white shadow-2xl" style={{ width: '210mm', minHeight: '297mm' }}>
                            <iframe
                                title="Report Preview"
                                srcDoc={getPreviewHtml()}
                                className="w-full h-full"
                                style={{ height: '297mm', border: 'none' }}
                            />
                        </div>
                    ) : (
                        <div className="flex items-center justify-center h-full text-gray-500">
                            Generating Server Preview...
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ReportDesignStudio;
