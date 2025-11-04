import React, { useState } from 'react';
import { database } from '../../utils/supabase';

interface ResultVerificationActionsProps {
  resultValueIds: string[];
  onVerificationComplete: () => void;
  className?: string;
}

const ResultVerificationActions: React.FC<ResultVerificationActionsProps> = ({
  resultValueIds,
  onVerificationComplete,
  className = ''
}) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [note, setNote] = useState('');
  const [showNoteInput, setShowNoteInput] = useState(false);

  const handleApprove = async () => {
    setIsProcessing(true);
    try {
      const { data, error } = await database.resultValues.bulkApprove(resultValueIds, note.trim() || undefined);
      
      if (error) throw error;
      
      console.log(`Approved ${resultValueIds.length} results:`, data);
      onVerificationComplete();
      setNote('');
      setShowNoteInput(false);
      
      // Show success message
      alert(`Successfully approved ${resultValueIds.length} result(s). Your signature will appear on reports.`);
      
    } catch (error) {
      console.error('Failed to approve results:', error);
      alert('Failed to approve results. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReject = async () => {
    if (!note.trim()) {
      alert('Please provide a reason for rejection');
      setShowNoteInput(true);
      return;
    }

    setIsProcessing(true);
    try {
      const { data, error } = await database.resultValues.bulkReject(resultValueIds, note.trim());
      
      if (error) throw error;
      
      console.log(`Rejected ${resultValueIds.length} results:`, data);
      onVerificationComplete();
      setNote('');
      setShowNoteInput(false);
      
      alert(`Rejected ${resultValueIds.length} result(s) with reason: ${note}`);
      
    } catch (error) {
      console.error('Failed to reject results:', error);
      alert('Failed to reject results. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleShowRejectForm = () => {
    setShowNoteInput(true);
  };

  const handleCancel = () => {
    setShowNoteInput(false);
    setNote('');
  };

  if (resultValueIds.length === 0) {
    return (
      <div className={`text-gray-500 text-sm ${className}`}>
        Select results to verify
      </div>
    );
  }

  return (
    <div className={`bg-white rounded-lg border p-4 space-y-4 ${className}`}>
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">
          Verify Results ({resultValueIds.length} selected)
        </h3>
        
        {!showNoteInput && (
          <div className="flex gap-3">
            <button
              onClick={handleApprove}
              disabled={isProcessing}
              className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isProcessing ? (
                <>
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Processing...
                </>
              ) : (
                <>
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Approve & Sign
                </>
              )}
            </button>

            <button
              onClick={handleShowRejectForm}
              disabled={isProcessing}
              className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              Reject
            </button>
          </div>
        )}
      </div>

      {showNoteInput && (
        <div className="space-y-3">
          <div>
            <label htmlFor="verification-note" className="block text-sm font-medium text-gray-700 mb-2">
              Verification Notes {showNoteInput ? '(required for rejection)' : '(optional)'}
            </label>
            <textarea
              id="verification-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add notes about the verification..."
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
            />
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleReject}
              disabled={isProcessing || !note.trim()}
              className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isProcessing ? (
                <>
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Processing...
                </>
              ) : (
                <>
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  Confirm Rejection
                </>
              )}
            </button>

            <button
              onClick={handleCancel}
              disabled={isProcessing}
              className="px-4 py-2 text-gray-600 border border-gray-300 rounded-md hover:text-gray-800 hover:border-gray-400 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="text-sm text-gray-600 space-y-1">
        <p>• Approved results will include your digital signature on reports</p>
        <p>• Rejection requires a note explaining the reason</p>
        <p>• Verified results cannot be edited without special permissions</p>
      </div>
    </div>
  );
};

export default ResultVerificationActions;