import React, { useState, useEffect } from 'react';
import { X, Save, RefreshCw } from 'lucide-react';
import { supabase } from '../../utils/supabase'; // Assuming standard export
import { prepareViewerReportData } from '../../utils/pdfViewerService';
import { AssetSidebar } from './AssetSidebar';
import { ReportConfig, ReportData, BrandingAsset } from './types';

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

    // Default Config
    const [config, setConfig] = useState<ReportConfig>({
        headerId: 'none',
        footerId: 'none',
        showAbnormalColors: true,
        showSignature: true,
        showQrCode: true,
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

                (viewerData.testResults || []).forEach((r: any) => {
                    const tName = r.testName || 'Test Results';
                    if (!groupedResults[tName]) {
                        groupedResults[tName] = {
                            id: tName, // Use name as ID for grouping
                            results: []
                        };
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

                // 3. Fetch Branding Assets
                const { data: assetsData, error: assetsError } = await supabase
                    .from('lab_branding_assets')
                    .select('id, lab_id, asset_type, url:file_url, name:asset_name, is_default')
                    .eq('lab_id', viewerData.lab.id);

                if (assetsError) {
                    console.warn('Error fetching branding assets:', assetsError);
                    setAssets([]);
                } else {
                    setAssets(assetsData || []);
                }

                // Pre-select defaults
                if (assetsData) {
                    const defHeader = assetsData.find((a: any) => a.asset_type === 'header' && a.is_default);
                    const defFooter = assetsData.find((a: any) => a.asset_type === 'footer' && a.is_default);

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
                alert('PDF Generated Successfully!');
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
        const headerH = serverHtml.settings?.headerHeight || '35mm';
        const footerH = serverHtml.settings?.footerHeight || '20mm';

        // Combine into a single view with ID wrappers for visibility control
        const headerDiv = `<div id="preview-header-container" style="height: ${headerH}; overflow: hidden; margin-bottom: 20px;">${effectiveHeader}</div>`;
        const footerDiv = `<div id="preview-footer-container" style="height: ${footerH}; overflow: hidden; margin-top: 20px;">${effectiveFooter}</div>`;

        // Inject Styles for Toggle Visibility
        const visibilityStyles = `
            <style>
                #preview-header-container { display: ${visibleSections.header ? 'block' : 'none'} !important; }
                #preview-footer-container { display: ${visibleSections.footer ? 'block' : 'none'} !important; }
                .clinical-summary-section, .report-ai-summary { display: ${visibleSections.clinicalSummary ? 'block' : 'none'} !important; }
                .report-extras-trends, .report-trend-graph, .trend-chart { display: ${visibleSections.graphs ? 'block' : 'none'} !important; }
                .report-patient-summary { display: ${visibleSections.patientSummary ? 'block' : 'none'} !important; }
                .section-content, .report-doctor-summary { display: ${visibleSections.interpretation ? 'block' : 'none'} !important; }
            </style>
        `;

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

        doc = doc.replace('<body class="limsv2-report">', `<body class="limsv2-report" style="padding: 20px; box-sizing: border-box;">${headerDiv}<div style="min-height: 800px;">`);
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
