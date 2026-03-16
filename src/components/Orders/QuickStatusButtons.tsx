import React, { useState } from 'react';
import { CheckCircle, Clock, Package, FileText, Send } from 'lucide-react';
import { useOrderStatusCentral } from '../../hooks/useOrderStatusCentral';
import PhlebotomistSelector from '../Users/PhlebotomistSelector';

interface QuickStatusButtonsProps {
  orderId: string;
  currentStatus: string;
  labId?: string;
  onStatusChanged: () => void;
}

export const QuickStatusButtons: React.FC<QuickStatusButtonsProps> = ({
  orderId,
  currentStatus,
  labId,
  onStatusChanged
}) => {
  const {
    markSampleCollected,
    startProcessing,
    submitForApproval,
    approveResults,
    deliverOrder,
    isUpdating
  } = useOrderStatusCentral();

  // Phlebotomist selector state
  const [showPhlebotomistSelector, setShowPhlebotomistSelector] = useState(false);
  const [selectedPhlebotomistId, setSelectedPhlebotomistId] = useState<string>('');
  const [selectedPhlebotomistName, setSelectedPhlebotomistName] = useState<string>('');

  const handleStatusUpdate = async (action: () => Promise<any>) => {
    const result = await action();
    if (result.success) {
      onStatusChanged();
    } else {
      alert(result.message);
    }
  };

  const handleMarkSampleCollected = async () => {
    // Show phlebotomist selector first
    if (!showPhlebotomistSelector) {
      setShowPhlebotomistSelector(true);
      return;
    }

    // Actually mark as collected with selected phlebotomist
    const result = await markSampleCollected(orderId, selectedPhlebotomistName || undefined);
    if (result.success) {
      setShowPhlebotomistSelector(false);
      setSelectedPhlebotomistId('');
      setSelectedPhlebotomistName('');
      onStatusChanged();
    } else {
      alert(result.message);
    }
  };

  const handleCancelSelection = () => {
    setShowPhlebotomistSelector(false);
    setSelectedPhlebotomistId('');
    setSelectedPhlebotomistName('');
  };

  // Normalize possible synonyms/variants to our canonical states
  const normalizeStatus = (s: string) => {
    if (!s) return 'Order Created'; // Default to Order Created if no status
    const t = s.trim().toLowerCase();
    
    // Order Created variants
    if (t === 'order created' || t === 'created' || t === 'new' || t === 'pending') return 'Order Created';
    
    // Sample Collection variants
    if (t === 'sample collected' || t === 'samplecollection' || t === 'sample collection') return 'Sample Collection';
    
    // In Progress variants
    if (t === 'in progress' || t === 'in process' || t === 'processing') return 'In Progress';
    
    // Pending Approval variants
    if (t === 'pending approval' || t === 'awaiting approval' || t === 'submitted') return 'Pending Approval';
    
    // Completed variants
    if (t === 'completed' || t === 'complete' || t === 'approved') return 'Completed';
    
    // Delivered variants
    if (t === 'delivered' || t === 'dispatched' || t === 'sent') return 'Delivered';
    
    return s.trim(); // Return original if no match
  };

  const getAvailableActions = () => {
    const status = normalizeStatus(currentStatus);
    console.log('🔘 QuickStatusButtons - currentStatus:', currentStatus, '→ normalized:', status);
    
    switch (status) {
      case 'Order Created':
        if (showPhlebotomistSelector && labId) {
          return (
            <div className="flex flex-col gap-3 p-3 bg-purple-50 rounded-lg border border-purple-200">
              <div className="text-sm font-medium text-purple-700">Select Sample Collector:</div>
              <div className="relative z-50">
                <PhlebotomistSelector
                  labId={labId}
                  value={selectedPhlebotomistId}
                  onChange={(userId, userName) => {
                    setSelectedPhlebotomistId(userId || '');
                    setSelectedPhlebotomistName(userName);
                  }}
                  placeholder="Select collector..."
                  className="min-w-[200px]"
                />
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleMarkSampleCollected}
                  disabled={isUpdating}
                  className="inline-flex items-center px-4 py-2 bg-green-600 text-white text-sm rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <Package className="h-4 w-4 mr-2" />
                  Confirm Collection
                </button>
                <button
                  onClick={handleCancelSelection}
                  disabled={isUpdating}
                  className="inline-flex items-center px-4 py-2 bg-gray-200 text-gray-700 text-sm rounded-md hover:bg-gray-300 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          );
        }
        return (
          <button
            onClick={handleMarkSampleCollected}
            disabled={isUpdating}
            className="inline-flex items-center px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:opacity-50"
          >
            <Package className="h-4 w-4 mr-2" />
            Mark Sample Collected
          </button>
        );
      case 'Sample Collection':
        return (
          <button
            onClick={() => handleStatusUpdate(() => startProcessing(orderId))}
            disabled={isUpdating}
            className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            <Clock className="h-4 w-4 mr-2" />
            Start Processing
          </button>
        );
      case 'In Progress':
        return (
          <button
            onClick={() => handleStatusUpdate(() => submitForApproval(orderId))}
            disabled={isUpdating}
            className="inline-flex items-center px-4 py-2 bg-yellow-600 text-white rounded-md hover:bg-yellow-700 disabled:opacity-50"
          >
            <FileText className="h-4 w-4 mr-2" />
            Submit for Approval
          </button>
        );
      case 'Pending Approval':
        return (
          <button
            onClick={() => handleStatusUpdate(() => approveResults(orderId))}
            disabled={isUpdating}
            className="inline-flex items-center px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50"
          >
            <CheckCircle className="h-4 w-4 mr-2" />
            Approve Results
          </button>
        );
      case 'Completed':
        return (
          <button
            onClick={() => handleStatusUpdate(() => deliverOrder(orderId))}
            disabled={isUpdating}
            className="inline-flex items-center px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
          >
            <Send className="h-4 w-4 mr-2" />
            Mark as Delivered
          </button>
        );
      case 'Delivered':
        return (
          <div className="flex items-center text-sm text-gray-500">
            <CheckCircle className="h-4 w-4 mr-2 text-green-500" />
            Order has been delivered - no further actions available
          </div>
        );
      default:
        return (
          <div className="text-sm text-gray-500">
            Current status: <span className="font-medium">{currentStatus || 'Unknown'}</span>
            <br />
            <span className="text-xs text-gray-400">No quick actions available for this status</span>
          </div>
        );
    }
  };

  return (
    <div className="space-y-2">
      {getAvailableActions()}
      {isUpdating && (
        <div className="text-sm text-gray-500 italic">Updating status...</div>
      )}
    </div>
  );
};

export default QuickStatusButtons;
