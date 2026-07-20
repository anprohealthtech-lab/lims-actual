import React, { useEffect, useRef, useState } from 'react';
import { ExternalLink, FileText, Loader2, Send, Trash2, Upload } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { supabase } from '../../utils/supabase';
import { useAuth } from '../../contexts/AuthContext';
import {
  getOutsourcedReportsForResult,
  OutsourcedReportFile,
  removeOutsourcedReport,
  uploadOutsourcedReport,
} from '../../utils/outsourcedReportService';

interface OutsourcedReportUploadProps {
  orderId: string;
  testGroupId: string;
  labId: string;
  patientId?: string | null;
  /** Returns the result record id for this order + test group, creating it if needed */
  ensureResultId: () => Promise<string | null>;
}

/**
 * Shown in result entry only when the test is outsourced. Lets the technician
 * attach the PDF/image received from the external lab; the file is stored in
 * the outsourced_reports bucket and automatically appended to the generated
 * report PDF (after the in-house pages) when the report is generated.
 */
const OutsourcedReportUpload: React.FC<OutsourcedReportUploadProps> = ({
  orderId,
  testGroupId,
  labId,
  patientId,
  ensureResultId,
}) => {
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [outsourcedLabName, setOutsourcedLabName] = useState<string | null>(null);
  const [isOutsourced, setIsOutsourced] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [reports, setReports] = useState<OutsourcedReportFile[]>([]);

  useEffect(() => {
    let active = true;

    const load = async () => {
      // Only render for outsourced tests
      const { data: orderTest } = await supabase
        .from('order_tests')
        .select('outsourced_lab_id, outsourced_labs(name)')
        .eq('order_id', orderId)
        .eq('test_group_id', testGroupId)
        .maybeSingle();

      if (!active) return;
      if (!orderTest?.outsourced_lab_id) {
        setIsOutsourced(false);
        return;
      }
      setIsOutsourced(true);
      setOutsourcedLabName((orderTest as any).outsourced_labs?.name || null);

      // List already-attached files (result record may not exist yet — that's fine)
      const { data: result } = await supabase
        .from('results')
        .select('id')
        .eq('order_id', orderId)
        .eq('test_group_id', testGroupId)
        .order('entered_date', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!active || !result?.id) return;
      const { data: files } = await getOutsourcedReportsForResult(result.id);
      if (active) setReports(files);
    };

    load();
    return () => {
      active = false;
    };
  }, [orderId, testGroupId]);

  const handleUpload = async () => {
    if (!selectedFile) return;
    setUploading(true);
    try {
      const resultId = await ensureResultId();
      if (!resultId) throw new Error('Could not create result record');

      const { data, error } = await uploadOutsourcedReport({
        file: selectedFile,
        orderId,
        resultId,
        labId,
        patientId,
        uploadedBy: user?.id || null,
        note: outsourcedLabName ? `Received from ${outsourcedLabName}` : null,
      });
      if (error || !data) throw error || new Error('Upload failed');

      setReports((prev) => [...prev, data]);
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      toast.success('Outsourced report attached — it will be appended to the generated report PDF');
    } catch (err) {
      console.error('Outsourced report upload failed:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to upload outsourced report');
    } finally {
      setUploading(false);
    }
  };

  const handleRemove = async (report: OutsourcedReportFile) => {
    if (report.merge_status === 'completed') {
      const ok = window.confirm(
        'This file was already merged into a generated report. Removing it only affects future generations. Remove anyway?',
      );
      if (!ok) return;
    }
    const { error } = await removeOutsourcedReport(report);
    if (error) {
      toast.error('Failed to remove file');
      return;
    }
    setReports((prev) => prev.filter((r) => r.id !== report.id));
    toast.success('Outsourced report removed');
  };

  if (!isOutsourced) return null;

  return (
    <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="font-medium text-purple-900 flex items-center">
            <Send className="h-4 w-4 mr-2" />
            Outsourced Test{outsourcedLabName ? ` — ${outsourcedLabName}` : ''}
          </h4>
          <p className="text-xs text-purple-700 mt-0.5">
            Attach the report received from the external lab. It will be saved and appended
            after your letterhead pages when the report PDF is generated.
          </p>
        </div>
      </div>

      {reports.length > 0 && (
        <ul className="space-y-1.5">
          {reports.map((report) => (
            <li
              key={report.id}
              className="flex items-center justify-between bg-white border border-purple-100 rounded-md px-3 py-2"
            >
              <div className="flex items-center min-w-0">
                <FileText className="h-4 w-4 text-purple-600 mr-2 flex-shrink-0" />
                <span className="text-sm text-gray-800 truncate">
                  {report.file_name || 'Attached report'}
                </span>
                {report.merge_status === 'completed' && (
                  <span className="ml-2 text-[11px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 flex-shrink-0">
                    Merged
                  </span>
                )}
              </div>
              <div className="flex items-center space-x-2 flex-shrink-0 ml-2">
                <a
                  href={report.file_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-purple-600 hover:text-purple-800"
                  title="View file"
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
                <button
                  onClick={() => handleRemove(report)}
                  className="text-red-500 hover:text-red-700"
                  title="Remove file"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center space-x-2">
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,image/jpeg,image/png"
          onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
          className="text-sm text-gray-700 file:mr-3 file:px-3 file:py-1.5 file:rounded-md file:border-0 file:bg-purple-100 file:text-purple-700 hover:file:bg-purple-200 file:cursor-pointer"
        />
        <button
          onClick={handleUpload}
          disabled={!selectedFile || uploading}
          className="flex items-center px-3 py-1.5 bg-purple-600 text-white text-sm rounded-md hover:bg-purple-700 disabled:opacity-50 flex-shrink-0"
        >
          {uploading ? (
            <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
          ) : (
            <Upload className="h-4 w-4 mr-1.5" />
          )}
          {uploading ? 'Uploading...' : 'Attach Report'}
        </button>
      </div>
    </div>
  );
};

export default OutsourcedReportUpload;
