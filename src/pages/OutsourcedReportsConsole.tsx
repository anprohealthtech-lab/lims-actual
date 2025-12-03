import React, { useEffect, useState } from 'react';
import { supabase } from '../utils/supabase';
import {
    FileText,
    Mail,
    CheckCircle2,
    AlertTriangle,
    Loader2,
    Eye,
    Download,
    Calendar,
    Search,
    Filter
} from 'lucide-react';

interface OutsourcedReport {
    id: string;
    sender_email: string;
    subject: string;
    received_at: string;
    file_url: string;
    file_name: string;
    status: 'pending_processing' | 'processing' | 'processed' | 'failed' | 'verified';
    ai_extracted_data: any;
    ai_confidence: number;
    processing_error: string | null;
}

const OutsourcedReportsConsole: React.FC = () => {
    const [reports, setReports] = useState<OutsourcedReport[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedReport, setSelectedReport] = useState<OutsourcedReport | null>(null);
    const [showModal, setShowModal] = useState(false);

    useEffect(() => {
        fetchReports();
    }, []);

    const fetchReports = async () => {
        setLoading(true);
        const { data, error } = await supabase
            .from('outsourced_reports')
            .select('*')
            .order('received_at', { ascending: false });

        if (error) {
            console.error('Error fetching reports:', error);
        } else {
            setReports(data || []);
        }
        setLoading(false);
    };

    const handleVerify = async (id: string) => {
        // In a real app, this would probably open a detailed mapping UI
        // For now, we just mark as verified
        const { error } = await supabase
            .from('outsourced_reports')
            .update({ status: 'verified' })
            .eq('id', id);

        if (error) {
            alert('Failed to verify report');
        } else {
            // Trigger merge if order_id is available in extracted data
            const report = reports.find(r => r.id === id);
            const orderId = report?.ai_extracted_data?.order_id;

            if (orderId) {
                try {
                    console.log('Triggering PDF merge for order:', orderId);
                    fetch('/.netlify/functions/merge-reports', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            order_id: orderId,
                            outsourced_report_url: report?.file_url
                        })
                    }).then(res => {
                        if (res.ok) console.log('Merge triggered successfully');
                        else console.error('Merge trigger failed');
                    });
                    alert('Report verified and merge process started!');
                } catch (e) {
                    console.error('Error triggering merge:', e);
                    alert('Report verified but merge trigger failed.');
                }
            } else {
                alert('Report verified, but no Order ID found for auto-merge.');
            }

            fetchReports();
            setShowModal(false);
        }
    };

    const StatusBadge = ({ status }: { status: string }) => {
        const styles = {
            pending_processing: 'bg-yellow-100 text-yellow-800',
            processing: 'bg-blue-100 text-blue-800',
            processed: 'bg-green-100 text-green-800',
            failed: 'bg-red-100 text-red-800',
            verified: 'bg-purple-100 text-purple-800',
        };
        return (
            <span className={`px-2 py-1 rounded-full text-xs font-medium ${styles[status as keyof typeof styles] || 'bg-gray-100'}`}>
                {status.replace('_', ' ').toUpperCase()}
            </span>
        );
    };

    return (
        <div className="p-6 max-w-7xl mx-auto">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Outsourced Reports</h1>
                    <p className="text-sm text-gray-500">Manage reports received from external labs</p>
                </div>
                <button
                    onClick={fetchReports}
                    className="p-2 text-gray-600 hover:text-gray-900 bg-white border rounded-lg shadow-sm"
                >
                    <Loader2 className={`h-5 w-5 ${loading ? 'animate-spin' : ''}`} />
                </button>
            </div>

            {/* List */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-gray-50 border-b border-gray-200">
                            <tr>
                                <th className="px-6 py-3 font-medium text-gray-500">Received</th>
                                <th className="px-6 py-3 font-medium text-gray-500">Sender</th>
                                <th className="px-6 py-3 font-medium text-gray-500">Subject</th>
                                <th className="px-6 py-3 font-medium text-gray-500">Status</th>
                                <th className="px-6 py-3 font-medium text-gray-500">AI Confidence</th>
                                <th className="px-6 py-3 font-medium text-gray-500 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                            {loading ? (
                                <tr>
                                    <td colSpan={6} className="px-6 py-8 text-center text-gray-500">
                                        <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
                                        Loading reports...
                                    </td>
                                </tr>
                            ) : reports.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="px-6 py-8 text-center text-gray-500">
                                        No reports found.
                                    </td>
                                </tr>
                            ) : (
                                reports.map((report) => (
                                    <tr key={report.id} className="hover:bg-gray-50 transition-colors">
                                        <td className="px-6 py-4 text-gray-600">
                                            <div className="flex items-center gap-2">
                                                <Calendar className="h-4 w-4 text-gray-400" />
                                                {new Date(report.received_at).toLocaleDateString()}
                                                <span className="text-xs text-gray-400">
                                                    {new Date(report.received_at).toLocaleTimeString()}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 font-medium text-gray-900">
                                            <div className="flex items-center gap-2">
                                                <Mail className="h-4 w-4 text-gray-400" />
                                                {report.sender_email}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-gray-600 max-w-xs truncate" title={report.subject}>
                                            {report.subject}
                                        </td>
                                        <td className="px-6 py-4">
                                            <StatusBadge status={report.status} />
                                        </td>
                                        <td className="px-6 py-4">
                                            {report.ai_confidence ? (
                                                <div className="flex items-center gap-1">
                                                    <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                                                        <div
                                                            className={`h-full ${report.ai_confidence > 0.8 ? 'bg-green-500' : report.ai_confidence > 0.5 ? 'bg-yellow-500' : 'bg-red-500'}`}
                                                            style={{ width: `${report.ai_confidence * 100}%` }}
                                                        />
                                                    </div>
                                                    <span className="text-xs text-gray-500">{Math.round(report.ai_confidence * 100)}%</span>
                                                </div>
                                            ) : (
                                                <span className="text-xs text-gray-400">-</span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <button
                                                onClick={() => {
                                                    setSelectedReport(report);
                                                    setShowModal(true);
                                                }}
                                                className="text-blue-600 hover:text-blue-800 font-medium text-xs border border-blue-200 bg-blue-50 px-3 py-1.5 rounded-lg hover:bg-blue-100 transition-colors"
                                            >
                                                Review
                                            </button>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Review Modal */}
            {showModal && selectedReport && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
                        <div className="p-4 border-b border-gray-200 flex justify-between items-center">
                            <h3 className="font-semibold text-lg">Review Report</h3>
                            <button onClick={() => setShowModal(false)} className="text-gray-500 hover:text-gray-700">
                                &times;
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                            {/* Left: File Preview */}
                            <div className="space-y-4">
                                <h4 className="font-medium text-gray-700 flex items-center gap-2">
                                    <FileText className="h-4 w-4" /> Original File
                                </h4>
                                <div className="border rounded-lg p-4 bg-gray-50 flex flex-col items-center justify-center min-h-[200px]">
                                    <p className="text-sm font-medium text-gray-900 mb-2">{selectedReport.file_name}</p>
                                    <a
                                        href={selectedReport.file_url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
                                    >
                                        <Eye className="h-4 w-4" /> View File
                                    </a>
                                </div>
                            </div>

                            {/* Right: AI Data */}
                            <div className="space-y-4">
                                <h4 className="font-medium text-gray-700 flex items-center gap-2">
                                    <CheckCircle2 className="h-4 w-4" /> Extracted Data
                                </h4>
                                {selectedReport.ai_extracted_data ? (
                                    <div className="bg-gray-50 rounded-lg p-4 text-sm font-mono overflow-auto max-h-[400px]">
                                        <pre>{JSON.stringify(selectedReport.ai_extracted_data, null, 2)}</pre>
                                    </div>
                                ) : (
                                    <div className="bg-red-50 text-red-600 p-4 rounded-lg text-sm">
                                        No data extracted. {selectedReport.processing_error}
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="p-4 border-t border-gray-200 flex justify-end gap-3 bg-gray-50 rounded-b-xl">
                            <button
                                onClick={() => setShowModal(false)}
                                className="px-4 py-2 text-gray-700 font-medium hover:bg-gray-200 rounded-lg transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => handleVerify(selectedReport.id)}
                                disabled={selectedReport.status === 'verified'}
                                className="px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {selectedReport.status === 'verified' ? 'Verified' : 'Verify & Approve'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default OutsourcedReportsConsole;
