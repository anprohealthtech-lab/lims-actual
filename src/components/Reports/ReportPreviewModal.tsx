import React, { useEffect, useState } from 'react';
import { AlertTriangle, Loader2, Printer, X } from 'lucide-react';
import QuickSendReport from '../WhatsApp/QuickSendReport';
import { supabase } from '../../utils/supabase';

interface ReportPreviewModalProps {
    isOpen: boolean;
    onClose: () => void;
    orderId: string;
    patientName: string;
    patientPhone?: string;
    testNames: string[];
    doctorName?: string;
    onReportGenerated?: () => void | Promise<void>;
}

interface StoredReport {
    report_type: 'final' | 'draft' | string | null;
    pdf_url: string | null;
    compact_ecopy_url: string | null;
}

const isTemporaryPdfUrl = (url?: string | null) =>
    !!url && url.includes('pdf-temp-files.s3.amazonaws.com');

const getUsableEcopyUrl = (report?: StoredReport) => {
    const url = report?.pdf_url || report?.compact_ecopy_url;
    return url && !isTemporaryPdfUrl(url) ? url : null;
};

export const ReportPreviewModal: React.FC<ReportPreviewModalProps> = ({
    isOpen,
    onClose,
    orderId,
    patientName,
    patientPhone,
    testNames = [],
    doctorName,
    onReportGenerated
}) => {
    const [pdfUrl, setPdfUrl] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [doctorPhone, setDoctorPhone] = useState('');
    const safeTestNames = Array.isArray(testNames) ? testNames : [];

    useEffect(() => {
        if (!isOpen || !orderId) return;

        let cancelled = false;

        const loadPdf = async () => {
            setLoading(true);
            setPdfUrl(null);
            setErrorMessage(null);

            try {
                const { data: reportRows, error: reportError } = await supabase
                    .from('reports')
                    .select('report_type, pdf_url, compact_ecopy_url, generated_date')
                    .eq('order_id', orderId)
                    .in('report_type', ['final', 'draft'])
                    .order('generated_date', { ascending: false });

                if (reportError) throw reportError;

                const reports = (reportRows || []) as StoredReport[];
                const finalReport = reports.find((report) => report.report_type === 'final');
                const draftReport = reports.find((report) => report.report_type === 'draft');
                const existingUrl = getUsableEcopyUrl(finalReport) || getUsableEcopyUrl(draftReport);

                if (existingUrl) {
                    if (!cancelled) setPdfUrl(existingUrl);
                    return;
                }

                const { data: readinessRows, error: readinessError } = await supabase
                    .from('v_result_panel_status')
                    .select('panel_ready')
                    .eq('order_id', orderId);

                if (readinessError) {
                    console.warn('Could not determine report readiness; generating a draft eCopy:', readinessError);
                }

                const isReady = !readinessError &&
                    Array.isArray(readinessRows) &&
                    readinessRows.length > 0 &&
                    readinessRows.every((row) => row.panel_ready);

                const { data: { user } } = await supabase.auth.getUser();
                const { data: generatedReport, error: generationError } = await supabase.functions.invoke(
                    'generate-pdf-letterhead',
                    {
                        body: {
                            orderId,
                            isDraft: !isReady,
                            triggeredByUserId: user?.id,
                            printLayoutMode: 'standard'
                        }
                    }
                );

                if (generationError) throw generationError;

                const generatedUrl = generatedReport?.pdfUrl;
                if (!generatedUrl) {
                    throw new Error(
                        generatedReport?.message || 'Report generation completed without an eCopy URL.'
                    );
                }

                if (!cancelled) {
                    setPdfUrl(generatedUrl);
                    await onReportGenerated?.();
                }
            } catch (error) {
                console.error('Failed to load eCopy preview:', error);
                if (!cancelled) {
                    setErrorMessage(
                        error instanceof Error ? error.message : 'Failed to prepare the eCopy preview.'
                    );
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        const fetchOrderDetails = async () => {
            const { data, error } = await supabase
                .from('orders')
                .select('doctor_phone')
                .eq('id', orderId)
                .single();

            if (error) {
                console.error('Error fetching order details:', error);
                return;
            }

            if (!cancelled) setDoctorPhone(data?.doctor_phone || '');
        };

        void loadPdf();
        void fetchOrderDetails();

        return () => {
            cancelled = true;
        };
    }, [isOpen, onReportGenerated, orderId]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 backdrop-blur-sm p-3 sm:p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-none sm:rounded-xl shadow-2xl w-full max-w-6xl h-[92vh] sm:h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between px-4 sm:px-6 py-4 border-b bg-white">
                    <div className="min-w-0">
                        <h3 className="text-lg sm:text-xl font-bold text-gray-900 truncate">{patientName}</h3>
                        <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm text-gray-500 mt-1">
                            <span className="bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full text-xs font-medium">
                                {safeTestNames.length} Test{safeTestNames.length !== 1 ? 's' : ''}
                            </span>
                            <span>&bull;</span>
                            <span className="line-clamp-2">{safeTestNames.join(', ')}</span>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-gray-100 rounded-full text-gray-500 hover:text-gray-700 transition-colors"
                    >
                        <X className="w-6 h-6" />
                    </button>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between px-4 sm:px-6 py-3 bg-gray-50 border-b">
                    <div className="text-xs sm:text-sm text-gray-500">
                        eCopy Preview &bull; {doctorName ? `Ref: ${doctorName}` : 'Self Request'}
                    </div>

                    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 sm:ml-auto w-full sm:w-auto">
                        <button
                            onClick={() => {
                                const iframe = document.getElementById('report-preview-frame') as HTMLIFrameElement;
                                iframe?.contentWindow?.print();
                            }}
                            disabled={!pdfUrl}
                            className="inline-flex items-center justify-center space-x-2 px-4 py-2 text-sm font-medium bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors shadow-sm disabled:cursor-not-allowed disabled:opacity-50 w-full sm:w-auto"
                            title="Print Report"
                        >
                            <Printer className="w-4 h-4" />
                            <span className="hidden sm:inline">Print</span>
                        </button>

                        <div className="hidden sm:block h-6 w-px bg-gray-300 mx-1" />

                        {pdfUrl && (
                            <QuickSendReport
                                reportUrl={pdfUrl}
                                reportName={`${patientName} - Report (Dr)`}
                                patientName={patientName}
                                patientPhone={doctorPhone}
                                doctorName={doctorName}
                                mode="doctor"
                                testName={safeTestNames.join(', ')}
                                buttonClassName="inline-flex items-center justify-center space-x-2 px-4 py-2 text-sm font-medium bg-green-50 text-green-700 border border-green-200 rounded-lg hover:bg-green-100 transition-colors w-full sm:w-auto"
                                showIcon
                                label="Send to Dr."
                            />
                        )}

                        {pdfUrl && (
                            <QuickSendReport
                                reportUrl={pdfUrl}
                                reportName={`${patientName} - Report`}
                                patientName={patientName}
                                patientPhone={patientPhone}
                                testName={safeTestNames.join(', ')}
                                buttonClassName="inline-flex items-center justify-center space-x-2 px-4 py-2 text-sm font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors shadow-sm w-full sm:w-auto"
                                showIcon
                                label="Send WhatsApp"
                            />
                        )}
                    </div>
                </div>

                <div className="flex-1 bg-gray-100 relative overflow-hidden">
                    {loading ? (
                        <div className="absolute inset-0 flex flex-col items-center justify-center space-y-4">
                            <Loader2 className="w-10 h-10 animate-spin text-blue-600" />
                            <p className="text-gray-500 font-medium">Preparing eCopy preview...</p>
                        </div>
                    ) : pdfUrl ? (
                        <iframe
                            id="report-preview-frame"
                            src={pdfUrl}
                            className="w-full h-full border-none"
                            title="Report eCopy Preview"
                        />
                    ) : (
                        <div className="absolute inset-0 flex flex-col items-center justify-center text-red-500 space-y-2">
                            <AlertTriangle className="w-8 h-8 opacity-50" />
                            <p>Failed to load report preview.</p>
                            {errorMessage && (
                                <p className="max-w-lg px-4 text-center text-sm text-red-400">{errorMessage}</p>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
