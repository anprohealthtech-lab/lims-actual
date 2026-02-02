import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../utils/supabase';
import { CheckCircle, XCircle, FileText, Loader } from 'lucide-react';

const VerificationPage: React.FC = () => {
    const [searchParams] = useSearchParams();
    const reportId = searchParams.get('id');

    const [loading, setLoading] = useState(true);
    const [status, setStatus] = useState<'verified' | 'not_found' | 'error'>('verified'); // Defaulting via logic later
    const [data, setData] = useState<any>(null);
    const [pdfUrl, setPdfUrl] = useState<string | null>(null);

    useEffect(() => {
        if (!reportId) {
            setStatus('not_found');
            setLoading(false);
            return;
        }

        const verifyReport = async () => {
            try {
                // Call secure Edge Function instead of querying orders table directly
                // This ensures orders table is not exposed to public
                const { data: response, error } = await supabase.functions.invoke('verify-report', {
                    body: { id: reportId }
                });

                if (error) {
                    console.error('Edge function error:', error);
                    setStatus('error');
                    setLoading(false);
                    return;
                }

                if (response.status === 'not_found') {
                    setStatus('not_found');
                } else if (response.status === 'verified' && response.data) {
                    // Map the response to match existing data structure
                    setData({
                        sample_id: response.data.sample_id,
                        created_at: response.data.created_at,
                        doctor: response.data.doctor,
                        patient: {
                            name: response.data.patient_name,
                            gender: response.data.patient_gender,
                            age: response.data.patient_age
                        }
                    });
                    setPdfUrl(response.data.pdf_url || null);
                    setStatus('verified');
                } else {
                    setStatus('error');
                }
            } catch (err) {
                console.error('Verification error:', err);
                setStatus('error');
            } finally {
                setLoading(false);
            }
        };

        verifyReport();
    }, [reportId]);

    if (loading) {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50">
                <Loader className="w-12 h-12 text-blue-600 animate-spin mb-4" />
                <p className="text-gray-600 font-medium">Verifying Report...</p>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
            <div className="bg-white max-w-md w-full rounded-xl shadow-lg overflow-hidden">

                {/* Header */}
                <div className={`p-6 text-center ${status === 'verified' ? 'bg-green-50' : 'bg-red-50'}`}>
                    {status === 'verified' ? (
                        <>
                            <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
                                <CheckCircle className="w-10 h-10 text-green-600" />
                            </div>
                            <h1 className="text-2xl font-bold text-green-800">Report Verified</h1>
                            <p className="text-green-600 mt-1">This is an authentic report.</p>
                        </>
                    ) : (
                        <>
                            <div className="mx-auto w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-4">
                                <XCircle className="w-10 h-10 text-red-600" />
                            </div>
                            <h1 className="text-2xl font-bold text-red-800">
                                {status === 'not_found' ? 'Report Not Found' : 'Verification Error'}
                            </h1>
                            <p className="text-red-600 mt-1">
                                {status === 'not_found'
                                    ? "We couldn't search this report ID in our records."
                                    : "Something went wrong during verification."}
                            </p>
                        </>
                    )}
                </div>

                {/* Content */}
                {status === 'verified' && data && (
                    <div className="p-6 border-t border-gray-100">
                        <div className="space-y-4">
                            <div className="flex justify-between border-b pb-2">
                                <span className="text-gray-500">Patient Name</span>
                                <span className="font-semibold text-gray-900">{data.patient?.name}</span>
                            </div>
                            <div className="flex justify-between border-b pb-2">
                                <span className="text-gray-500">Sample ID</span>
                                <span className="font-semibold text-gray-900">{data.sample_id}</span>
                            </div>
                            <div className="flex justify-between border-b pb-2">
                                <span className="text-gray-500">Date</span>
                                <span className="font-semibold text-gray-900">
                                    {new Date(data.created_at).toLocaleDateString()}
                                </span>
                            </div>
                            <div className="flex justify-between pb-2">
                                <span className="text-gray-500">Ref. Doctor</span>
                                <span className="font-semibold text-gray-900">{data.doctor || 'Self'}</span>
                            </div>
                        </div>

                        <div className="mt-8">
                            <button
                                className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-4 rounded-lg transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
                                onClick={() => {
                                    if (pdfUrl) {
                                        window.open(pdfUrl, '_blank');
                                    } else {
                                        alert('The PDF report has not been generated yet. Please contact the laboratory for assistance.');
                                    }
                                }}
                                disabled={!pdfUrl}
                            >
                                <FileText className="w-5 h-5" />
                                {pdfUrl ? 'View Original PDF' : 'PDF Not Available'}
                            </button>
                        </div>
                    </div>
                )}

                <div className="bg-gray-50 p-4 text-center text-xs text-gray-400">
                    Secure Verification System • LIMS v2
                </div>
            </div>
        </div>
    );
};

export default VerificationPage;
