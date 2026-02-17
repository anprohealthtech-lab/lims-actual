import React, { useState, useEffect } from 'react';
import { X, Printer, Loader2, User, AlertTriangle } from 'lucide-react';
import { quickViewPDF } from '../../utils/pdfViewerService';
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
}

export const ReportPreviewModal: React.FC<ReportPreviewModalProps> = ({
    isOpen,
    onClose,
    orderId,
    patientName,
    patientPhone,
    testNames,
    doctorName
}) => {
    const [pdfUrl, setPdfUrl] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    // Extra details needed for sending to doctor
    const [doctorPhone, setDoctorPhone] = useState<string>('');
    const [finalReportUrl, setFinalReportUrl] = useState<string | undefined>(undefined);

    useEffect(() => {
        if (isOpen && orderId) {
            loadPdf();
            fetchOrderDetails();
        }
        // Cleanup blob URL
        return () => {
            if (pdfUrl) URL.revokeObjectURL(pdfUrl);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, orderId]);

    const loadPdf = async () => {
        setLoading(true);
        try {
            // Use quickViewPDF to get the Blob URL directly
            const url = await quickViewPDF(orderId, { openInNewTab: false });
            setPdfUrl(url);
        } catch (e) {
            console.error("Failed to load PDF preview:", e);
        } finally {
            setLoading(false);
        }
    };

    const fetchOrderDetails = async () => {
        try {
            const { data, error } = await supabase
                .from('orders')
                .select(`
          doctor_phone, 
          lab_results (
            final_report
          )
        `)
                .eq('id', orderId)
                .single();

            if (data && !error) {
                setDoctorPhone(data.doctor_phone || '');

                // Check for final report URL in results
                if (Array.isArray(data.lab_results)) {
                    const resultWithReport = data.lab_results.find((r: any) => r.final_report && r.final_report.pdf_url);
                    if (resultWithReport) {
                        setFinalReportUrl(resultWithReport.final_report.pdf_url);
                    }
                }
            }
        } catch (err) {
            console.error("Error fetching order details:", err);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 backdrop-blur-sm p-3 sm:p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-none sm:rounded-xl shadow-2xl w-full max-w-6xl h-[92vh] sm:h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">

                {/* Header */}
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between px-4 sm:px-6 py-4 border-b bg-white">
                    <div className="min-w-0">
                        <h3 className="text-lg sm:text-xl font-bold text-gray-900 truncate">{patientName}</h3>
                        <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm text-gray-500 mt-1">
                            <span className="bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full text-xs font-medium">
                                {testNames.length} Test{testNames.length !== 1 ? 's' : ''}
                            </span>
                            <span>•</span>
                            <span className="line-clamp-2">{testNames.join(', ')}</span>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-gray-100 rounded-full text-gray-500 hover:text-gray-700 transition-colors"
                    >
                        <X className="w-6 h-6" />
                    </button>
                </div>

                {/* Toolbar */}
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between px-4 sm:px-6 py-3 bg-gray-50 border-b">
                    <div className="text-xs sm:text-sm text-gray-500">
                        Preview Mode • {doctorName ? `Ref: ${doctorName}` : 'Self Request'}
                    </div>

                    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 sm:ml-auto w-full sm:w-auto">
                        <button
                            onClick={() => {
                                const iframe = document.getElementById('report-preview-frame') as HTMLIFrameElement;
                                iframe?.contentWindow?.print();
                            }}
                            className="inline-flex items-center justify-center space-x-2 px-4 py-2 text-sm font-medium bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors shadow-sm w-full sm:w-auto"
                            title="Print Report"
                        >
                            <Printer className="w-4 h-4" />
                            <span className="hidden sm:inline">Print</span>
                        </button>

                        <div className="hidden sm:block h-6 w-px bg-gray-300 mx-1"></div>

                        {/* Send to Doctor */}
                        {pdfUrl && (
                            <QuickSendReport
                                reportUrl={finalReportUrl || pdfUrl}
                                reportName={`${patientName} - Report (Dr)`}
                                patientName={patientName}
                                patientPhone={doctorPhone}
                                doctorName={doctorName}
                                mode="doctor"
                                testName={testNames.join(', ')}
                                buttonClassName="inline-flex items-center justify-center space-x-2 px-4 py-2 text-sm font-medium bg-green-50 text-green-700 border border-green-200 rounded-lg hover:bg-green-100 transition-colors w-full sm:w-auto"
                                showIcon={true}
                                label="Send to Dr."
                            />
                        )}

                        {/* Send to Patient (WhatsApp) */}
                        {pdfUrl && (
                            <QuickSendReport
                                reportUrl={finalReportUrl || pdfUrl}
                                reportName={`${patientName} - Report`}
                                patientName={patientName}
                                patientPhone={patientPhone}
                                testName={testNames.join(', ')}
                                buttonClassName="inline-flex items-center justify-center space-x-2 px-4 py-2 text-sm font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors shadow-sm w-full sm:w-auto"
                                showIcon={true}
                                label="Send WhatsApp"
                            />
                        )}
                    </div>
                </div>

                {/* Content Area */}
                <div className="flex-1 bg-gray-100 relative overflow-hidden">
                    {loading ? (
                        <div className="absolute inset-0 flex flex-col items-center justify-center space-y-4">
                            <Loader2 className="w-10 h-10 animate-spin text-blue-600" />
                            <p className="text-gray-500 font-medium">Generating preview...</p>
                        </div>
                    ) : pdfUrl ? (
                        <iframe
                            id="report-preview-frame"
                            src={pdfUrl}
                            className="w-full h-full border-none"
                            title="Report Preview"
                        />
                    ) : (
                        <div className="absolute inset-0 flex flex-col items-center justify-center text-red-500 space-y-2">
                            <AlertTriangle className="w-8 h-8 opacity-50" />
                            <p>Failed to load report preview.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
