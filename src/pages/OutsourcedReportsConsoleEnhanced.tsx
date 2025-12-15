import React, { useEffect, useState, useCallback } from 'react';
import { database } from '../utils/supabase';
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
  Filter,
  Link as LinkIcon,
  X,
  TrendingUp,
  Clock,
  AlertCircle,
  Sparkles,
  User,
  TestTube
} from 'lucide-react';
import type { OutsourcedReport, OrderMatchSuggestion } from '../types';

type StatusFilter = 'all' | 'pending_processing' | 'processed' | 'verified';
type MatchFilter = 'all' | 'matched' | 'unmatched';

const OutsourcedReportsConsoleEnhanced: React.FC = () => {
  const [reports, setReports] = useState<OutsourcedReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedReport, setSelectedReport] = useState<OutsourcedReport | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [showMatchModal, setShowMatchModal] = useState(false);
  const [matchSuggestions, setMatchSuggestions] = useState<OrderMatchSuggestion[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);

  // Filters
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [matchFilter, setMatchFilter] = useState<MatchFilter>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [dateRange, setDateRange] = useState<{ start: string; end: string } | null>(null);

  useEffect(() => {
    fetchReports();
  }, [statusFilter, matchFilter, dateRange]);

  const fetchReports = useCallback(async () => {
    setLoading(true);
    
    const filters: any = {};
    if (statusFilter !== 'all') filters.status = statusFilter;
    if (matchFilter !== 'all') filters.matched = matchFilter;
    if (dateRange) filters.dateRange = dateRange;

    const { data, error } = await database.outsourcedReports.getAll(filters);

    if (error) {
      console.error('Error fetching reports:', error);
      alert('Failed to load reports');
    } else {
      setReports(data || []);
    }
    setLoading(false);
  }, [statusFilter, matchFilter, dateRange]);

  const handleSmartMatch = async (report: OutsourcedReport) => {
    setSelectedReport(report);
    setShowMatchModal(true);
    setLoadingSuggestions(true);

    const { data, error } = await database.outsourcedReports.suggestMatches(report.id, 5);

    if (error) {
      console.error('Error getting match suggestions:', error);
      alert('Failed to load match suggestions');
      setMatchSuggestions([]);
    } else {
      setMatchSuggestions(data || []);
    }
    setLoadingSuggestions(false);
  };

  const handleLinkToOrder = async (orderId: string, patientId: string, confidence: number) => {
    if (!selectedReport) return;

    const confirmed = window.confirm(
      `Link this outsourced report to the selected order?\n\nConfidence: ${(confidence * 100).toFixed(0)}%`
    );

    if (!confirmed) return;

    const { error } = await database.outsourcedReports.linkToOrder(
      selectedReport.id,
      orderId,
      patientId,
      confidence
    );

    if (error) {
      console.error('Error linking report:', error);
      alert('Failed to link report to order');
    } else {
      alert('Report successfully linked to order!');
      setShowMatchModal(false);
      fetchReports();
    }
  };

  const handleViewReport = (report: OutsourcedReport) => {
    setSelectedReport(report);
    setShowModal(true);
  };

  const filteredReports = reports.filter(report => {
    if (!searchTerm) return true;
    
    const search = searchTerm.toLowerCase();
    return (
      report.sender_email?.toLowerCase().includes(search) ||
      report.subject?.toLowerCase().includes(search) ||
      report.file_name?.toLowerCase().includes(search) ||
      report.ai_extracted_data?.patient_name?.toLowerCase().includes(search)
    );
  });

  const StatusBadge = ({ status }: { status: string }) => {
    const styles = {
      pending_processing: 'bg-yellow-100 text-yellow-800 border-yellow-300',
      processing: 'bg-blue-100 text-blue-800 border-blue-300',
      processed: 'bg-green-100 text-green-800 border-green-300',
      verified: 'bg-purple-100 text-purple-800 border-purple-300',
      failed: 'bg-red-100 text-red-800 border-red-300'
    };

    return (
      <span className={`px-2 py-1 text-xs font-medium rounded-full border ${styles[status as keyof typeof styles]}`}>
        {status.replace('_', ' ').toUpperCase()}
      </span>
    );
  };

  const ConfidenceBadge = ({ confidence }: { confidence: number }) => {
    const percent = (confidence * 100).toFixed(0);
    const color = confidence >= 0.8 ? 'green' : confidence >= 0.5 ? 'yellow' : 'red';
    
    return (
      <span className={`px-2 py-1 text-xs font-medium rounded-full bg-${color}-100 text-${color}-800`}>
        {percent}% match
      </span>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        <span className="ml-2 text-gray-600">Loading reports...</span>
      </div>
    );
  }

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
          <div className="p-2 bg-blue-100 rounded-lg">
            <FileText className="w-8 h-8 text-blue-600" />
          </div>
          Outsourced Reports Console
        </h1>
        <p className="text-gray-600 mt-2 ml-14">
          Manage and match incoming reports from external laboratories
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-gray-500">Total Reports</p>
            <div className="p-2 bg-blue-50 rounded-lg">
              <FileText className="w-5 h-5 text-blue-600" />
            </div>
          </div>
          <p className="text-2xl font-bold text-gray-900">{reports.length}</p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-gray-500">Pending Processing</p>
            <div className="p-2 bg-yellow-50 rounded-lg">
              <Clock className="w-5 h-5 text-yellow-600" />
            </div>
          </div>
          <p className="text-2xl font-bold text-yellow-600">
            {reports.filter(r => r.status === 'pending_processing').length}
          </p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-gray-500">Unmatched</p>
            <div className="p-2 bg-orange-50 rounded-lg">
              <AlertTriangle className="w-5 h-5 text-orange-600" />
            </div>
          </div>
          <p className="text-2xl font-bold text-orange-600">
            {reports.filter(r => !r.order_id).length}
          </p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-gray-500">Verified</p>
            <div className="p-2 bg-green-50 rounded-lg">
              <CheckCircle2 className="w-5 h-5 text-green-600" />
            </div>
          </div>
          <p className="text-2xl font-bold text-green-600">
            {reports.filter(r => r.status === 'verified').length}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-6">
        <div className="flex flex-col lg:flex-row gap-4 items-end">
          {/* Search */}
          <div className="flex-1 w-full">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Search
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search by email, subject, patient name..."
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* Status Filter */}
          <div className="w-full lg:w-48">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Status
            </label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="all">All Statuses</option>
              <option value="pending_processing">Pending Processing</option>
              <option value="processed">Processed</option>
              <option value="verified">Verified</option>
            </select>
          </div>

          {/* Match Filter */}
          <div className="w-full lg:w-48">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Match Status
            </label>
            <select
              value={matchFilter}
              onChange={(e) => setMatchFilter(e.target.value as MatchFilter)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="all">All Reports</option>
              <option value="matched">Matched to Order</option>
              <option value="unmatched">Unmatched</option>
            </select>
          </div>

          {/* Refresh */}
          <button
            onClick={fetchReports}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Reports Grid */}
      {filteredReports.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
          <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <FileText className="w-8 h-8 text-gray-400" />
          </div>
          <h3 className="text-lg font-medium text-gray-900">No reports found</h3>
          <p className="text-gray-500 mt-1">
            {searchTerm ? 'Try adjusting your search or filters' : 'Reports will appear here when received'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredReports.map((report) => (
            <div 
              key={report.id} 
              className="bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-all duration-200 flex flex-col"
            >
              <div className="p-5 flex-1">
                {/* Header */}
                <div className="flex justify-between items-start mb-4">
                  <div className="flex items-start gap-3 overflow-hidden">
                    <div className="p-2 bg-blue-50 rounded-lg text-blue-600 flex-shrink-0">
                      <Mail className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-semibold text-gray-900 truncate" title={report.subject || 'No Subject'}>
                        {report.subject || 'No Subject'}
                      </h3>
                      <p className="text-xs text-gray-500 truncate" title={report.sender_email}>
                        {report.sender_email}
                      </p>
                    </div>
                  </div>
                  <div className="flex-shrink-0 ml-2">
                    <StatusBadge status={report.status} />
                  </div>
                </div>

                {/* Content */}
                <div className="space-y-3">
                  {/* Patient Info */}
                  <div className="flex items-center gap-2 text-sm text-gray-700">
                    <User className="w-4 h-4 text-gray-400" />
                    <span className={report.ai_extracted_data?.patient_name ? 'font-medium' : 'text-gray-400 italic'}>
                      {report.ai_extracted_data?.patient_name || 'Patient not extracted'}
                    </span>
                  </div>

                  {/* Date */}
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <Calendar className="w-4 h-4 text-gray-400" />
                    <span>{new Date(report.received_at).toLocaleString()}</span>
                  </div>

                  {/* Match Status */}
                  <div className="pt-2">
                    {report.order_id ? (
                      <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 px-3 py-2 rounded-lg border border-green-100">
                        <CheckCircle2 className="w-4 h-4" />
                        <span className="font-medium">Matched to Order</span>
                        {report.match_confidence && (
                          <span className="text-xs bg-green-200 px-1.5 py-0.5 rounded text-green-800">
                            {(report.match_confidence * 100).toFixed(0)}%
                          </span>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-sm text-orange-700 bg-orange-50 px-3 py-2 rounded-lg border border-orange-100">
                        <AlertTriangle className="w-4 h-4" />
                        <span className="font-medium">Unmatched</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Footer Actions */}
              <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 rounded-b-xl flex justify-between items-center">
                <div className="flex gap-2">
                  <button
                    onClick={() => handleViewReport(report)}
                    className="text-gray-600 hover:text-blue-600 transition-colors p-1.5 hover:bg-blue-50 rounded-lg"
                    title="View Report"
                  >
                    <Eye className="w-4 h-4" />
                  </button>
                  <a
                    href={report.file_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-gray-600 hover:text-blue-600 transition-colors p-1.5 hover:bg-blue-50 rounded-lg"
                    title="Download"
                  >
                    <Download className="w-4 h-4" />
                  </a>
                </div>

                {!report.order_id && report.status === 'processed' && (
                  <button
                    onClick={() => handleSmartMatch(report)}
                    className="text-xs font-medium bg-purple-100 text-purple-700 px-3 py-1.5 rounded-lg hover:bg-purple-200 transition-colors flex items-center gap-1.5"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    Smart Match
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* View Modal */}
      {showModal && selectedReport && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto border border-gray-200">
            <div className="p-6 border-b border-gray-200 flex justify-between items-center bg-gray-50 rounded-t-xl">
              <h2 className="text-xl font-bold text-gray-900">Report Details</h2>
              <button
                onClick={() => setShowModal(false)}
                className="text-gray-400 hover:text-gray-600 p-1 hover:bg-gray-200 rounded-full transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            
            <div className="p-6">
              {/* Report metadata */}
              <div className="mb-6 grid grid-cols-1 md:grid-cols-2 gap-6 bg-gray-50 p-4 rounded-xl border border-gray-100">
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">From</p>
                  <p className="text-base font-medium text-gray-900">{selectedReport.sender_email}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Received</p>
                  <p className="text-base font-medium text-gray-900">
                    {new Date(selectedReport.received_at).toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Status</p>
                  <div className="mt-1">
                    <StatusBadge status={selectedReport.status} />
                  </div>
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">File</p>
                  <p className="text-base font-medium text-gray-900 truncate">{selectedReport.file_name}</p>
                </div>
              </div>

              {/* AI Extracted Data */}
              {selectedReport.ai_extracted_data && (
                <div className="mb-6 bg-blue-50 border border-blue-100 rounded-xl p-4">
                  <h3 className="text-sm font-semibold text-blue-900 mb-3 flex items-center gap-2">
                    <Sparkles className="w-4 h-4" />
                    AI Extracted Data
                  </h3>
                  <pre className="text-xs text-blue-800 whitespace-pre-wrap font-mono bg-white/50 p-3 rounded-lg border border-blue-100">
                    {JSON.stringify(selectedReport.ai_extracted_data, null, 2)}
                  </pre>
                </div>
              )}

              {/* PDF Viewer */}
              <div className="border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                <iframe
                  src={selectedReport.file_url}
                  className="w-full h-[600px]"
                  title="Report Preview"
                />
              </div>
            </div>

            <div className="p-6 border-t border-gray-200 flex justify-end gap-3 bg-gray-50 rounded-b-xl">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-white text-gray-700 font-medium transition-colors"
              >
                Close
              </button>
              {!selectedReport.order_id && selectedReport.status === 'processed' && (
                <button
                  onClick={() => {
                    setShowModal(false);
                    handleSmartMatch(selectedReport);
                  }}
                  className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 flex items-center gap-2 font-medium shadow-sm transition-colors"
                >
                  <Sparkles className="w-4 h-4" />
                  Smart Match to Order
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Match Modal */}
      {showMatchModal && selectedReport && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto border border-gray-200">
            <div className="p-6 border-b border-gray-200 flex justify-between items-center bg-gray-50 rounded-t-xl">
              <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                <Sparkles className="w-6 h-6 text-purple-600" />
                Smart Match Suggestions
              </h2>
              <button
                onClick={() => setShowMatchModal(false)}
                className="text-gray-400 hover:text-gray-600 p-1 hover:bg-gray-200 rounded-full transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="p-6">
              {loadingSuggestions ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <Loader2 className="w-10 h-10 animate-spin text-purple-600 mb-4" />
                  <span className="text-gray-600 font-medium">Analyzing and finding matches...</span>
                </div>
              ) : matchSuggestions.length === 0 ? (
                <div className="text-center py-12 bg-gray-50 rounded-xl border border-gray-100">
                  <AlertCircle className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                  <p className="text-gray-900 font-medium text-lg">No matching orders found</p>
                  <p className="text-gray-500 text-sm mt-2">
                    Try manually linking this report to an order
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="bg-purple-50 border border-purple-100 rounded-lg p-4 mb-6">
                    <p className="text-purple-900 font-medium">
                      Found {matchSuggestions.length} potential matches for patient:{' '}
                      <span className="font-bold">
                        {selectedReport.ai_extracted_data?.patient_name || 'Unknown'}
                      </span>
                    </p>
                  </div>

                  {matchSuggestions.map((suggestion) => (
                    <div
                      key={suggestion.order_id}
                      className="border border-gray-200 rounded-xl p-5 hover:border-purple-300 hover:shadow-md transition-all bg-white group"
                    >
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <h3 className="text-lg font-bold text-gray-900 group-hover:text-purple-700 transition-colors">
                              {suggestion.patient_name}
                            </h3>
                            <ConfidenceBadge confidence={suggestion.confidence} />
                          </div>
                          <div className="flex items-center gap-4 text-sm text-gray-600">
                            <span className="bg-gray-100 px-2 py-1 rounded text-gray-700 font-medium">
                              #{suggestion.order_number || suggestion.order_id.slice(0, 8)}
                            </span>
                            <span className="flex items-center gap-1">
                              <Calendar className="w-4 h-4 text-gray-400" />
                              {new Date(suggestion.order_date).toLocaleDateString()}
                            </span>
                          </div>
                        </div>
                        <button
                          onClick={() => handleLinkToOrder(
                            suggestion.order_id,
                            suggestion.patient_id,
                            suggestion.confidence
                          )}
                          className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 flex items-center gap-2 font-medium shadow-sm transition-colors"
                        >
                          <LinkIcon className="w-4 h-4" />
                          Link Order
                        </button>
                      </div>

                      <div className="bg-gray-50 rounded-lg p-3 mb-3 border border-gray-100">
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Match Reasons</p>
                        <ul className="text-sm text-gray-700 space-y-1.5">
                          {suggestion.match_reasons.map((reason, idx) => (
                            <li key={idx} className="flex items-center gap-2">
                              <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />
                              {reason}
                            </li>
                          ))}
                        </ul>
                      </div>

                      {suggestion.test_names && suggestion.test_names.length > 0 && (
                        <div className="text-sm text-gray-600 flex items-start gap-2">
                          <TestTube className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
                          <div>
                            <span className="font-medium text-gray-700">Tests: </span>
                            {suggestion.test_names.slice(0, 3).join(', ')}
                            {suggestion.test_names.length > 3 && ` +${suggestion.test_names.length - 3} more`}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="p-6 border-t border-gray-200 flex justify-end bg-gray-50 rounded-b-xl">
              <button
                onClick={() => setShowMatchModal(false)}
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-white text-gray-700 font-medium transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default OutsourcedReportsConsoleEnhanced;
