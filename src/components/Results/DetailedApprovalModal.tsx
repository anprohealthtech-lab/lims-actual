import React, { useState, useEffect } from 'react';
import { supabase, formatAge } from '../../utils/supabase';
import { 
  X, FileText, Image, Download, CheckCircle, XCircle, 
  AlertTriangle, Clock, User, Calendar, Paperclip, Eye,
  ChevronLeft, ChevronRight, Save, Send, Flag
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
    values: ResultValue[];
  }>;
}

interface ResultValue {
  value: string;
  unit: string;
  reference_range: string;
  flag: string;
  analyte_name: string;
  department: string;
}

interface OrderDetails {
  id: string;
  sample_id: string;
  order_date: string;
  priority: string;
  physician_name: string;
  clinical_info?: string;
  special_instructions?: string;
}

interface PatientDetails {
  id: string;
  name: string;
  age: number;
  gender: string;
  patient_code: string;
  phone?: string;
  address?: string;
  medical_history?: string;
}

interface Attachment {
  id: string;
  file_name: string;
  file_type: string;
  file_url: string;
  uploaded_by: string;
  uploaded_at: string;
  description?: string;
}

interface DetailedApprovalModalProps {
  isOpen: boolean;
  onClose: () => void;
  testResult: TestResult;
  onApprove: (resultId: string, notes: string) => void;
  onReject: (resultId: string, notes: string) => void;
  onRequestClarification: (resultId: string, notes: string) => void;
}

const DetailedApprovalModal: React.FC<DetailedApprovalModalProps> = ({
  isOpen,
  onClose,
  testResult,
  onApprove,
  onReject,
  onRequestClarification
}) => {
  const [activeTab, setActiveTab] = useState<'results' | 'attachments' | 'history' | 'patient'>('results');
  const [orderDetails, setOrderDetails] = useState<OrderDetails | null>(null);
  const [patientDetails, setPatientDetails] = useState<PatientDetails | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [verificationHistory, setVerificationHistory] = useState<any[]>([]);
  const [previousResults, setPreviousResults] = useState<any[]>([]);
  const [verificationNotes, setVerificationNotes] = useState('');
  const [selectedAnalytes, setSelectedAnalytes] = useState<Set<string>>(new Set());
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
        loadOrderDetails(),
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

  const loadOrderDetails = async () => {
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .eq('id', testResult.order_id)
      .single();

    if (!error && data) {
      setOrderDetails(data);
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
      .select('*, users(name)')
      .eq('result_id', testResult.results[0]?.result_id)
      .order('performed_at', { ascending: false });

    if (!error && data) {
      setVerificationHistory(data);
    }
  };

  const loadPreviousResults = async () => {
    const { data, error } = await supabase
      .from('results')
      .select('*, result_values(*)')
      .eq('patient_id', testResult.patient_id)
      .eq('test_name', testResult.test_name)
      .neq('id', testResult.id)
      .eq('verification_status', 'verified')
      .order('created_at', { ascending: false })
      .limit(5);

    if (!error && data) {
      setPreviousResults(data);
    }
  };

  const handleSelectAll = () => {
    const allAnalytes = testResult.results.flatMap(r => r.values.map(v => v.analyte_name));
    if (selectedAnalytes.size === allAnalytes.length) {
      setSelectedAnalytes(new Set());
    } else {
      setSelectedAnalytes(new Set(allAnalytes));
    }
  };

  const handleSelectAnalyte = (analyteName: string) => {
    const newSelected = new Set(selectedAnalytes);
    if (newSelected.has(analyteName)) {
      newSelected.delete(analyteName);
    } else {
      newSelected.add(analyteName);
    }
    setSelectedAnalytes(newSelected);
  };

  const handleApprove = () => {
    if (selectedAnalytes.size === 0) {
      alert('Please select at least one analyte to approve');
      return;
    }
    testResult.results.forEach(result => {
      onApprove(result.result_id, verificationNotes);
    });
  };

  const handleReject = () => {
    if (!verificationNotes.trim()) {
      alert('Please provide a reason for rejection');
      return;
    }
    testResult.results.forEach(result => {
      onReject(result.result_id, verificationNotes);
    });
  };

  const handleRequestClarification = () => {
    if (!verificationNotes.trim()) {
      alert('Please specify what clarification is needed');
      return;
    }
    testResult.results.forEach(result => {
      onRequestClarification(result.result_id, verificationNotes);
    });
  };

  const downloadAttachment = async (attachment: Attachment) => {
    window.open(attachment.file_url, '_blank');
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

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {activeTab === 'results' && (
            <div className="p-6">
              {/* Test Results Table */}
              <div className="mb-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold">Analyte Results</h3>
                  <button
                    onClick={handleSelectAll}
                    className="text-sm text-blue-600 hover:text-blue-700"
                  >
                    {selectedAnalytes.size === allAnalytes.length ? 'Deselect All' : 'Select All'}
                  </button>
                </div>
                
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse border border-gray-300">
                    <thead>
                      <tr className="bg-gray-50">
                        <th className="border border-gray-300 p-3 text-left">Select</th>
                        <th className="border border-gray-300 p-3 text-left">Parameter</th>
                        <th className="border border-gray-300 p-3 text-left">Value</th>
                        <th className="border border-gray-300 p-3 text-left">Unit</th>
                        <th className="border border-gray-300 p-3 text-left">Reference Range</th>
                        <th className="border border-gray-300 p-3 text-left">Flag</th>
                        <th className="border border-gray-300 p-3 text-left">Department</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allAnalytes.map((analyte, index) => (
                        <tr key={index} className={analyte.flag ? 'bg-yellow-50' : ''}>
                          <td className="border border-gray-300 p-3">
                            <input
                              type="checkbox"
                              checked={selectedAnalytes.has(analyte.analyte_name)}
                              onChange={() => handleSelectAnalyte(analyte.analyte_name)}
                              className="rounded"
                            />
                          </td>
                          <td className="border border-gray-300 p-3 font-medium">{analyte.analyte_name}</td>
                          <td className="border border-gray-300 p-3 font-semibold">{analyte.value}</td>
                          <td className="border border-gray-300 p-3">{analyte.unit}</td>
                          <td className="border border-gray-300 p-3">{analyte.reference_range}</td>
                          <td className="border border-gray-300 p-3">
                            {analyte.flag && (
                              <span className={`font-medium px-2 py-1 rounded text-xs ${
                                analyte.flag === 'H' ? 'text-red-600 bg-red-100' : 
                                analyte.flag === 'L' ? 'text-blue-600 bg-blue-100' : 
                                'text-gray-600 bg-gray-100'
                              }`}>
                                {analyte.flag}
                              </span>
                            )}
                          </td>
                          <td className="border border-gray-300 p-3">{analyte.department}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Previous Results Comparison */}
              {previousResults.length > 0 && (
                <div>
                  <h3 className="text-lg font-semibold mb-4">Previous Results Comparison</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {previousResults.map(result => (
                      <div key={result.id} className="border rounded-lg p-4">
                        <div className="text-sm text-gray-600 mb-2">
                          {format(new Date(result.created_at), 'MMM d, yyyy')}
                        </div>
                        {result.result_values?.map((val: any, idx: number) => (
                          <div key={idx} className="text-sm">
                            <span className="font-medium">{val.parameter}:</span> {val.value} {val.unit}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'attachments' && (
            <div className="p-6">
              <h3 className="text-lg font-semibold mb-4">Order Attachments</h3>
              {attachments.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <Paperclip className="w-12 h-12 mx-auto mb-2 text-gray-300" />
                  <p>No attachments found for this order</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {attachments.map(attachment => (
                    <div key={attachment.id} className="border rounded-lg p-4 hover:shadow-md transition-shadow">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center space-x-2">
                          {attachment.file_type.startsWith('image/') ? (
                            <Image className="w-5 h-5 text-blue-600" />
                          ) : (
                            <FileText className="w-5 h-5 text-gray-600" />
                          )}
                          <span className="font-medium text-sm truncate">
                            {attachment.file_name}
                          </span>
                        </div>
                      </div>
                      
                      {attachment.description && (
                        <p className="text-sm text-gray-600 mb-2">{attachment.description}</p>
                      )}
                      
                      {attachment.file_type.startsWith('image/') && (
                        <div className="mb-2">
                          <img 
                            src={attachment.file_url} 
                            alt={attachment.file_name}
                            className="w-full h-32 object-cover rounded"
                          />
                        </div>
                      )}
                      
                      <div className="flex items-center justify-between text-xs text-gray-500">
                        <span>{format(new Date(attachment.uploaded_at), 'MMM d, yyyy')}</span>
                        <div className="flex space-x-2">
                          <button
                            onClick={() => window.open(attachment.file_url, '_blank')}
                            className="flex items-center space-x-1 text-blue-600 hover:text-blue-700"
                          >
                            <Eye className="w-4 h-4" />
                            <span>View</span>
                          </button>
                          <button
                            onClick={() => downloadAttachment(attachment)}
                            className="flex items-center space-x-1 text-green-600 hover:text-green-700"
                          >
                            <Download className="w-4 h-4" />
                            <span>Download</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'history' && (
            <div className="p-6">
              <h3 className="text-lg font-semibold mb-4">Verification History</h3>
              {verificationHistory.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <Clock className="w-12 h-12 mx-auto mb-2 text-gray-300" />
                  <p>No verification history found</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {verificationHistory.map(entry => (
                    <div key={entry.id} className="border-l-4 border-gray-200 pl-4 py-2">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-medium">{entry.action}</div>
                          <div className="text-sm text-gray-600">{entry.comment}</div>
                          <div className="text-xs text-gray-500 mt-1">
                            By {entry.users?.name} on {format(new Date(entry.performed_at), 'MMM d, yyyy h:mm a')}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'patient' && (
            <div className="p-6">
              <h3 className="text-lg font-semibold mb-4">Patient Information</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h4 className="font-medium mb-3">Basic Information</h4>
                  <dl className="space-y-2">
                    <div className="flex">
                      <dt className="text-sm text-gray-600 w-32">Name:</dt>
                      <dd className="text-sm font-medium">{testResult.patient_name}</dd>
                    </div>
                    <div className="flex">
                      <dt className="text-sm text-gray-600 w-32">Age:</dt>
                      <dd className="text-sm">{testResult.age} years</dd>
                    </div>
                    <div className="flex">
                      <dt className="text-sm text-gray-600 w-32">Gender:</dt>
                      <dd className="text-sm">{testResult.gender}</dd>
                    </div>
                    <div className="flex">
                      <dt className="text-sm text-gray-600 w-32">Patient Code:</dt>
                      <dd className="text-sm">{testResult.patient_code}</dd>
                    </div>
                    <div className="flex">
                      <dt className="text-sm text-gray-600 w-32">Phone:</dt>
                      <dd className="text-sm">{patientDetails?.phone || 'N/A'}</dd>
                    </div>
                  </dl>
                </div>
                
                <div>
                  <h4 className="font-medium mb-3">Clinical Information</h4>
                  <dl className="space-y-2">
                    <div>
                      <dt className="text-sm text-gray-600">Physician:</dt>
                      <dd className="text-sm mt-1">{testResult.physician_name}</dd>
                    </div>
                    <div>
                      <dt className="text-sm text-gray-600">Clinical Notes:</dt>
                      <dd className="text-sm mt-1">{orderDetails?.clinical_info || 'None provided'}</dd>
                    </div>
                    <div>
                      <dt className="text-sm text-gray-600">Special Instructions:</dt>
                      <dd className="text-sm mt-1">{orderDetails?.special_instructions || 'None'}</dd>
                    </div>
                  </dl>
                </div>
              </div>
              
              {patientDetails?.medical_history && (
                <div className="mt-6">
                  <h4 className="font-medium mb-2">Medical History</h4>
                  <p className="text-sm text-gray-600 bg-gray-50 p-3 rounded">{patientDetails.medical_history}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer with Actions */}
        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50">
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Verification Notes
            </label>
            <textarea
              className="w-full p-3 border border-gray-300 rounded-lg resize-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              rows={3}
              placeholder="Add verification notes..."
              value={verificationNotes}
              onChange={(e) => setVerificationNotes(e.target.value)}
            />
            
            {/* Quick note templates */}
            <div className="mt-2 flex flex-wrap gap-2">
              {[
                'Results verified and within normal limits',
                'Critical value - physician notified',
                'Specimen quality acceptable',
                'Delta check reviewed'
              ].map(template => (
                <button
                  key={template}
                  onClick={() => setVerificationNotes(template)}
                  className="px-2 py-1 text-xs bg-gray-200 hover:bg-gray-300 rounded"
                >
                  {template}
                </button>
              ))}
            </div>
          </div>
          
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-600">
              {selectedAnalytes.size} of {allAnalytes.length} analytes selected
            </div>
            
            <div className="flex space-x-2">
              <button
                onClick={handleReject}
                className="px-6 py-2 bg-red-600 text-white rounded hover:bg-red-700 flex items-center space-x-2"
              >
                <XCircle className="w-4 h-4" />
                <span>Reject</span>
              </button>
              <button
                onClick={handleRequestClarification}
                className="px-6 py-2 bg-yellow-600 text-white rounded hover:bg-yellow-700 flex items-center space-x-2"
              >
                <AlertTriangle className="w-4 h-4" />
                <span>Request Clarification</span>
              </button>
              <button
                onClick={handleApprove}
                className="px-6 py-2 bg-green-600 text-white rounded hover:bg-green-700 flex items-center space-x-2"
                disabled={selectedAnalytes.size === 0}
              >
                <CheckCircle className="w-4 h-4" />
                <span>Approve Selected</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DetailedApprovalModal;
