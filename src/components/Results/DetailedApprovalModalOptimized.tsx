import React, { useState, useEffect } from 'react';
import { supabase, formatAge } from '../../utils/supabase';
import { 
  X, FileText, Image, Download, CheckCircle, XCircle, 
  AlertTriangle, Clock, User, Calendar, Paperclip, Eye
} from 'lucide-react';
import { format } from 'date-fns';

interface TestResult {
  id: string;
  order_id: string;
  patient_id: string;
  patient_name: string;
  test_name: string;
  verification_status: string;
  entered_by: string;
  entered_date: string;
  technician_notes?: string;
  critical_flag: boolean;
  priority_level: number;
  sample_id: string;
  order_priority: string;
  order_date: string;
  physician_name: string;
  full_patient_name: string;
  gender: string;
  patient_code: string;
  age: number;
  hours_since_entry: number;
  results: Array<{
    result_id: string;
    values: Array<{
      value: string;
      unit: string;
      reference_range: string;
      flag: string;
      analyte_name: string;
      department: string;
    }>;
    attachment_id?: string;
  }>;
}

interface DetailedApprovalModalProps {
  isOpen: boolean;
  onClose: () => void;
  testResult: TestResult;
  onApprove: (resultId: string, notes: string) => void;
  onReject: (resultId: string, notes: string) => void;
  onRequestClarification: (resultId: string, notes: string) => void;
}

export default function DetailedApprovalModal({
  isOpen,
  onClose,
  testResult,
  onApprove,
  onReject,
  onRequestClarification
}: DetailedApprovalModalProps) {
  const [activeTab, setActiveTab] = useState<'results' | 'attachments' | 'history' | 'patient'>('results');
  const [verificationNotes, setVerificationNotes] = useState('');
  const [attachments, setAttachments] = useState<any[]>([]);
  const [verificationHistory, setVerificationHistory] = useState<any[]>([]);
  const [patientDetails, setPatientDetails] = useState<any>(null);
  const [previousResults, setPreviousResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isOpen && testResult) {
      loadAllData();
    }
  }, [isOpen, testResult]);

  const loadAllData = async () => {
    setLoading(true);
    try {
      await Promise.all([
        loadPatientDetails(),
        loadAttachments(),
        loadVerificationHistory(),
        loadPreviousResults()
      ]);
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadPatientDetails = async () => {
    const { data, error } = await supabase
      .from('patients')
      .select('*')
      .eq('id', testResult.patient_id)
      .single();

    if (!error && data) {
      setPatientDetails(data);
    }
  };

  const loadAttachments = async () => {
    // Use the simplified attachment approach - get attachment_id from result
    const resultWithAttachment = testResult.results.find(r => r.attachment_id);
    
    if (resultWithAttachment?.attachment_id) {
      const { data, error } = await supabase
        .from('attachments')
        .select('*')
        .eq('id', resultWithAttachment.attachment_id)
        .single();

      if (!error && data) {
        setAttachments([data]);
      }
    } else {
      setAttachments([]);
    }
  };

  const loadVerificationHistory = async () => {
    const { data, error } = await supabase
      .from('result_verification_audit')
      .select(`
        *,
        user:users!performed_by(name, email)
      `)
      .in('result_id', testResult.results.map(r => r.result_id))
      .order('performed_at', { ascending: false });

    if (!error && data) {
      setVerificationHistory(data);
    }
  };

  const loadPreviousResults = async () => {
    const { data, error } = await supabase
      .from('results')
      .select(`
        *,
        result_values(*)
      `)
      .eq('patient_id', testResult.patient_id)
      .eq('test_name', testResult.test_name)
      .neq('id', testResult.id)
      .eq('verification_status', 'verified')
      .order('entered_date', { ascending: false })
      .limit(5);

    if (!error && data) {
      setPreviousResults(data);
    }
  };

  const handleApprove = () => {
    testResult.results.forEach(result => {
      onApprove(result.result_id, verificationNotes);
    });
    onClose();
  };

  const handleReject = () => {
    if (!verificationNotes.trim()) {
      alert('Please provide a reason for rejection');
      return;
    }
    testResult.results.forEach(result => {
      onReject(result.result_id, verificationNotes);
    });
    onClose();
  };

  const handleRequestClarification = () => {
    if (!verificationNotes.trim()) {
      alert('Please specify what clarification is needed');
      return;
    }
    testResult.results.forEach(result => {
      onRequestClarification(result.result_id, verificationNotes);
    });
    onClose();
  };

  const viewAttachment = (attachment: any) => {
    if (attachment.file_url) {
      window.open(attachment.file_url, '_blank');
    }
  };

  const downloadAttachment = (attachment: any) => {
    if (attachment.file_url) {
      const link = document.createElement('a');
      link.href = attachment.file_url;
      link.download = attachment.original_filename || 'attachment';
      link.click();
    }
  };

  if (!isOpen || !testResult) return null;

  const allAnalytes = testResult.results.flatMap(r => r.values);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-7xl h-[90vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold">{testResult.test_name} - Detailed Verification</h2>
            <div className="flex items-center space-x-4 text-sm text-gray-600 mt-1">
              <span>{testResult.patient_name} ({formatAge(testResult.age, (testResult as any).age_unit)} {testResult.gender})</span>
              <span>•</span>
              <span>Order: {testResult.order_id.slice(0, 8)}</span>
              <span>•</span>
              <span>Sample: {testResult.sample_id}</span>
              {testResult.critical_flag && (
                <>
                  <span>•</span>
                  <span className="bg-red-100 text-red-800 px-2 py-1 rounded text-xs font-medium">
                    CRITICAL
                  </span>
                </>
              )}
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="border-b border-gray-200">
          <nav className="flex space-x-8 px-6" aria-label="Tabs">
            {[
              { id: 'results', label: 'Test Results', icon: FileText },
              { id: 'attachments', label: 'Attachments', icon: Paperclip },
              { id: 'history', label: 'History', icon: Clock },
              { id: 'patient', label: 'Patient Info', icon: User }
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`
                  py-3 px-1 border-b-2 font-medium text-sm flex items-center space-x-2
                  ${activeTab === tab.id
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }
                `}
              >
                <tab.icon className="w-4 h-4" />
                <span>{tab.label}</span>
                {tab.id === 'attachments' && attachments.length > 0 && (
                  <span className="bg-blue-100 text-blue-600 text-xs px-2 py-1 rounded-full">
                    {attachments.length}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
              <span className="ml-2">Loading...</span>
            </div>
          ) : (
            <>
              {/* Results Tab */}
              {activeTab === 'results' && (
                <div className="space-y-6">
                  <div>
                    <h3 className="text-lg font-medium mb-4">Test Results</h3>
                    <div className="bg-gray-50 rounded-lg p-4">
                      <div className="grid grid-cols-4 gap-4 text-sm font-medium text-gray-700 mb-2">
                        <div>Parameter</div>
                        <div>Value</div>
                        <div>Reference Range</div>
                        <div>Flag</div>
                      </div>
                      {allAnalytes.map((analyte, index) => (
                        <div key={index} className="grid grid-cols-4 gap-4 py-2 border-b border-gray-200 last:border-b-0">
                          <div className="font-medium">{analyte.analyte_name}</div>
                          <div className="flex items-center space-x-2">
                            <span className={analyte.flag ? 'font-bold' : ''}>{analyte.value}</span>
                            <span className="text-gray-500 text-sm">{analyte.unit}</span>
                          </div>
                          <div className="text-sm text-gray-600">{analyte.reference_range}</div>
                          <div>
                            {analyte.flag && (
                              <span className={`
                                px-2 py-1 rounded text-xs font-medium
                                ${analyte.flag === 'H' ? 'bg-red-100 text-red-800' : 
                                  analyte.flag === 'L' ? 'bg-yellow-100 text-yellow-800' : 
                                  'bg-gray-100 text-gray-800'}
                              `}>
                                {analyte.flag}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Technician Notes */}
                  {testResult.technician_notes && (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                      <h4 className="font-medium text-blue-900 mb-2">Technician Notes</h4>
                      <p className="text-blue-800">{testResult.technician_notes}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Attachments Tab */}
              {activeTab === 'attachments' && (
                <div>
                  <h3 className="text-lg font-medium mb-4">Order Attachments</h3>
                  {attachments.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">
                      <Paperclip className="w-12 h-12 mx-auto mb-2 opacity-50" />
                      <p>No attachments found for this order</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {attachments.map((attachment, index) => (
                        <div key={index} className="border border-gray-200 rounded-lg p-4">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-3">
                              {attachment.file_type?.startsWith('image/') ? (
                                <Image className="w-8 h-8 text-blue-500" />
                              ) : (
                                <FileText className="w-8 h-8 text-blue-500" />
                              )}
                              <div>
                                <h4 className="font-medium">{attachment.original_filename}</h4>
                                <p className="text-sm text-gray-500">
                                  {attachment.file_type} • Uploaded {format(new Date(attachment.created_at), 'MMM d, yyyy')}
                                </p>
                              </div>
                            </div>
                            <div className="flex space-x-2">
                              <button
                                onClick={() => viewAttachment(attachment)}
                                className="p-2 text-blue-600 hover:bg-blue-50 rounded"
                                title="View"
                              >
                                <Eye className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => downloadAttachment(attachment)}
                                className="p-2 text-green-600 hover:bg-green-50 rounded"
                                title="Download"
                              >
                                <Download className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* History Tab */}
              {activeTab === 'history' && (
                <div>
                  <h3 className="text-lg font-medium mb-4">Verification History</h3>
                  {verificationHistory.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">
                      <Clock className="w-12 h-12 mx-auto mb-2 opacity-50" />
                      <p>No verification history found</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {verificationHistory.map((entry, index) => (
                        <div key={index} className="border border-gray-200 rounded-lg p-4">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center space-x-2">
                              <span className="font-medium">{entry.action.toUpperCase()}</span>
                              <span className="text-gray-500">by {entry.user?.name || 'Unknown'}</span>
                            </div>
                            <span className="text-sm text-gray-500">
                              {format(new Date(entry.performed_at), 'MMM d, yyyy h:mm a')}
                            </span>
                          </div>
                          <div className="text-sm text-gray-600">
                            Status: {entry.previous_status} → {entry.new_status}
                          </div>
                          {entry.comment && (
                            <div className="mt-2 text-sm">
                              <span className="font-medium">Comment:</span> {entry.comment}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Patient Tab */}
              {activeTab === 'patient' && (
                <div>
                  <h3 className="text-lg font-medium mb-4">Patient Information</h3>
                  {patientDetails ? (
                    <div className="bg-gray-50 rounded-lg p-6">
                      <div className="grid grid-cols-2 gap-6">
                        <div>
                          <h4 className="font-medium mb-3">Basic Information</h4>
                          <div className="space-y-2 text-sm">
                            <div><span className="font-medium">Name:</span> {patientDetails.name}</div>
                            <div><span className="font-medium">Age:</span> {patientDetails.age} years</div>
                            <div><span className="font-medium">Gender:</span> {patientDetails.gender}</div>
                            <div><span className="font-medium">DOB:</span> {format(new Date(patientDetails.date_of_birth), 'MMM d, yyyy')}</div>
                          </div>
                        </div>
                        <div>
                          <h4 className="font-medium mb-3">Contact Information</h4>
                          <div className="space-y-2 text-sm">
                            <div><span className="font-medium">Phone:</span> {patientDetails.phone}</div>
                            <div><span className="font-medium">Email:</span> {patientDetails.email}</div>
                            <div><span className="font-medium">Address:</span> {patientDetails.address}</div>
                          </div>
                        </div>
                      </div>
                      
                      {/* Previous Results Summary */}
                      {previousResults.length > 0 && (
                        <div className="mt-6">
                          <h4 className="font-medium mb-3">Previous Results ({testResult.test_name})</h4>
                          <div className="space-y-2">
                            {previousResults.slice(0, 3).map((prev, index) => (
                              <div key={index} className="text-sm border-l-2 border-blue-200 pl-3">
                                <div className="font-medium">{format(new Date(prev.entered_date), 'MMM d, yyyy')}</div>
                                <div className="text-gray-600">Status: {prev.verification_status}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-gray-500">
                      Loading patient details...
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer with Actions */}
        <div className="border-t border-gray-200 px-6 py-4">
          <div className="space-y-4">
            {/* Verification Notes */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Verification Notes
              </label>
              <textarea
                rows={3}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Add any notes or comments for this verification..."
                value={verificationNotes}
                onChange={(e) => setVerificationNotes(e.target.value)}
              />
            </div>

            {/* Action Buttons */}
            <div className="flex items-center justify-between">
              <button
                onClick={onClose}
                className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>

              <div className="flex space-x-3">
                <button
                  onClick={handleRequestClarification}
                  className="px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 flex items-center space-x-2"
                >
                  <AlertTriangle className="w-4 h-4" />
                  <span>Request Clarification</span>
                </button>

                <button
                  onClick={handleReject}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 flex items-center space-x-2"
                >
                  <XCircle className="w-4 h-4" />
                  <span>Reject</span>
                </button>

                <button
                  onClick={handleApprove}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center space-x-2"
                >
                  <CheckCircle className="w-4 h-4" />
                  <span>Approve Results</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
