import React, { useState } from 'react';
import { Upload, X, FileText, Check, AlertCircle, Loader2, ArrowRight } from 'lucide-react';
import { supabase } from '../../utils/supabase';
import { useEscapeModalClose } from '../../hooks/useEscapeModalClose';

interface ExternalReportUploadModalProps {
    patientId: string;
    onClose: () => void;
    onSuccess?: () => void;
}

interface ExtractedValue {
    original_analyte_name: string;
    value: string;
    unit: string;
    reference_range: string;
    confidence: number;
    suggested_analyte_id?: string | null;
}

const ExternalReportUploadModal: React.FC<ExternalReportUploadModalProps> = ({ patientId, onClose, onSuccess }) => {
    useEscapeModalClose(onClose);
    const [file, setFile] = useState<File | null>(null);
    const [uploading, setUploading] = useState(false);
    const [processing, setProcessing] = useState(false);
    const [extractedData, setExtractedData] = useState<ExtractedValue[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [reportId, setReportId] = useState<string | null>(null);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setFile(e.target.files[0]);
            setError(null);
        }
    };

    const handleUploadAndProcess = async () => {
        if (!file) return;

        try {
            setUploading(true);
            setError(null);

            // 1. Upload file to Storage
            const fileExt = file.name.split('.').pop();
            const fileName = `${patientId}/${Date.now()}.${fileExt}`;
            const bucketName = 'external-reports'; // Ensure this bucket exists

            // Create bucket if not exists (Best effort, might fail if no permissions)
            // Usually buckets are created manually in Supabase Dashboard

            const { data: uploadData, error: uploadError } = await supabase.storage
                .from(bucketName)
                .upload(fileName, file);

            if (uploadError) {
                // Fallback to attachments if external-reports doesn't exist
                const { data: fallbackData, error: fallbackError } = await supabase.storage
                    .from('attachments')
                    .upload(`external-reports/${fileName}`, file);

                if (fallbackError) throw fallbackError;

                // Use the fallback path
                var publicUrl = supabase.storage.from('attachments').getPublicUrl(`external-reports/${fileName}`).data.publicUrl;
            } else {
                var publicUrl = supabase.storage.from(bucketName).getPublicUrl(fileName).data.publicUrl;
            }

            setUploading(false);
            setProcessing(true);

            // 2. Create entry in external_reports
            const { data: reportData, error: dbError } = await supabase
                .from('external_reports')
                .insert({
                    patient_id: patientId,
                    file_url: publicUrl,
                    report_date: new Date().toISOString(), // User should actually select this
                    status: 'processing',
                    lab_name: 'External Lab' // Placeholder
                })
                .select()
                .single();

            if (dbError) throw dbError;
            setReportId(reportData.id);

            // 3. Call Backend Function to Process
            const response = await fetch('/.netlify/functions/process-external-report', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    file_url: publicUrl,
                    patient_id: patientId,
                    report_id: reportData.id
                })
            });

            const result = await response.json();

            if (!result.success) {
                throw new Error(result.error || 'Failed to process report');
            }

            setExtractedData(result.data);

        } catch (err: any) {
            console.error('Error:', err);
            setError(err.message || 'An error occurred');
        } finally {
            setUploading(false);
            setProcessing(false);
        }
    };

    const handleSave = async () => {
        if (!reportId || !extractedData) return;

        try {
            setProcessing(true); // Re-use processing state for saving

            // Insert extracted values
            const valuesToInsert = extractedData.map(item => ({
                external_report_id: reportId,
                original_analyte_name: item.original_analyte_name,
                value: item.value,
                unit: item.unit,
                reference_range: item.reference_range,
                ai_confidence: item.confidence,
                is_verified: true // Auto-verify for now, normally would be false until reviewed
            }));

            const { error } = await supabase
                .from('external_result_values')
                .insert(valuesToInsert);

            if (error) throw error;

            // Update report status
            await supabase
                .from('external_reports')
                .update({ status: 'completed' })
                .eq('id', reportId);

            alert('Report saved successfully!');
            if (onSuccess) onSuccess();
            onClose();

        } catch (err: any) {
            setError(err.message || 'Failed to save results');
        } finally {
            setProcessing(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-75 flex items-center justify-center z-[60] p-4">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto flex flex-col">
                <div className="flex items-center justify-between p-6 border-b border-gray-200">
                    <h2 className="text-xl font-semibold text-gray-900">Upload Past Report</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-500">
                        <X className="h-6 w-6" />
                    </button>
                </div>

                <div className="p-6 flex-1 overflow-y-auto">
                    {error && (
                        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-4 flex items-center text-red-700">
                            <AlertCircle className="h-5 w-5 mr-2" />
                            {error}
                        </div>
                    )}

                    {!extractedData ? (
                        <div className="flex flex-col items-center justify-center space-y-4 py-8">
                            <div className="w-full max-w-md border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-blue-500 transition-colors">
                                <input
                                    type="file"
                                    id="report-upload"
                                    className="hidden"
                                    accept="application/pdf,image/*"
                                    onChange={handleFileChange}
                                />
                                <label htmlFor="report-upload" className="cursor-pointer flex flex-col items-center">
                                    <Upload className="h-12 w-12 text-gray-400 mb-3" />
                                    <span className="text-base font-medium text-gray-900">
                                        {file ? file.name : "Click to upload PDF or Image"}
                                    </span>
                                    <span className="text-sm text-gray-500 mt-1">
                                        Upload past lab reports to extract history
                                    </span>
                                </label>
                            </div>

                            {file && (
                                <button
                                    onClick={handleUploadAndProcess}
                                    disabled={uploading || processing}
                                    className="w-full max-w-md flex items-center justify-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                                >
                                    {(uploading || processing) ? (
                                        <>
                                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                            {uploading ? 'Uploading...' : 'AI Processing...'}
                                        </>
                                    ) : (
                                        <>
                                            Process Report <ArrowRight className="ml-2 h-4 w-4" />
                                        </>
                                    )}
                                </button>
                            )}
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <h3 className="text-lg font-medium text-gray-900">Extracted Results</h3>
                                <span className="text-sm text-green-600 flex items-center bg-green-50 px-2 py-1 rounded">
                                    <Check className="h-3 w-3 mr-1" /> AI Analysis Complete
                                </span>
                            </div>

                            <div className="border border-gray-200 rounded-lg overflow-hidden">
                                <table className="min-w-full divide-y divide-gray-200">
                                    <thead className="bg-gray-50">
                                        <tr>
                                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Test Name</th>
                                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Value</th>
                                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Unit</th>
                                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Range</th>
                                        </tr>
                                    </thead>
                                    <tbody className="bg-white divide-y divide-gray-200">
                                        {extractedData.map((item, idx) => (
                                            <tr key={idx}>
                                                <td className="px-4 py-2 text-sm text-gray-900">
                                                    <input
                                                        type="text"
                                                        value={item.original_analyte_name}
                                                        onChange={(e) => {
                                                            const newData = [...extractedData];
                                                            newData[idx].original_analyte_name = e.target.value;
                                                            setExtractedData(newData);
                                                        }}
                                                        className="w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                                                    />
                                                </td>
                                                <td className="px-4 py-2 text-sm text-gray-900 font-medium">
                                                    <input
                                                        type="text"
                                                        value={item.value}
                                                        onChange={(e) => {
                                                            const newData = [...extractedData];
                                                            newData[idx].value = e.target.value;
                                                            setExtractedData(newData);
                                                        }}
                                                        className="w-24 border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                                                    />
                                                </td>
                                                <td className="px-4 py-2 text-sm text-gray-500">
                                                    <input
                                                        type="text"
                                                        value={item.unit}
                                                        onChange={(e) => {
                                                            const newData = [...extractedData];
                                                            newData[idx].unit = e.target.value;
                                                            setExtractedData(newData);
                                                        }}
                                                        className="w-16 border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                                                    />
                                                </td>
                                                <td className="px-4 py-2 text-sm text-gray-500">
                                                    <input
                                                        type="text"
                                                        value={item.reference_range}
                                                        onChange={(e) => {
                                                            const newData = [...extractedData];
                                                            newData[idx].reference_range = e.target.value;
                                                            setExtractedData(newData);
                                                        }}
                                                        className="w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                                                    />
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            <div className="flex justify-end space-x-3 mt-6">
                                <button
                                    onClick={() => setExtractedData(null)}
                                    className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                                >
                                    Back
                                </button>
                                <button
                                    onClick={handleSave}
                                    disabled={processing}
                                    className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 flex items-center"
                                >
                                    {processing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Check className="h-4 w-4 mr-2" />}
                                    Confirm & SaveHistory
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ExternalReportUploadModal;
