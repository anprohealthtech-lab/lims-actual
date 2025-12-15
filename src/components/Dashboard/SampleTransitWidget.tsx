import React, { useEffect, useState, useCallback } from 'react';
import { database } from '../../utils/supabase';
import { Link } from 'react-router-dom';
import {
  Truck,
  Package,
  Send,
  Loader2,
  CheckSquare,
  Square,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Building2,
  X
} from 'lucide-react';

interface PendingOrder {
  id: string;
  order_number: number;
  patient_name: string;
  order_date: string;
  location_id?: string;
  collected_at_location_id?: string;
  transit_status?: string;
  sample_collected_at?: string;
  locations?: { id: string; name: string; type: string };
}

interface Location {
  id: string;
  name: string;
  type: string;
  is_collection_center?: boolean;
  is_processing_center?: boolean;
}

interface TransitStats {
  pendingDispatch: number;
  inTransit: number;
  receivedToday: number;
}

const SampleTransitWidget: React.FC = () => {
  const [pendingOrders, setPendingOrders] = useState<PendingOrder[]>([]);
  const [processingCenters, setProcessingCenters] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<TransitStats>({ pendingDispatch: 0, inTransit: 0, receivedToday: 0 });
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState(true);
  const [dispatching, setDispatching] = useState(false);
  
  // Dispatch modal state
  const [showDispatchModal, setShowDispatchModal] = useState(false);
  const [dispatchDestination, setDispatchDestination] = useState<string>('');
  const [dispatchNotes, setDispatchNotes] = useState('');
  const [dispatchPriority, setDispatchPriority] = useState<'normal' | 'urgent' | 'high' | 'low'>('normal');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // Get pending orders for dispatch
      const { data: pending } = await database.sampleTransits.getPendingDispatch();
      setPendingOrders(pending || []);
      
      // Get stats
      const { data: statsData } = await database.sampleTransits.getStats();
      if (statsData) setStats(statsData);
      
      // Get all locations for dispatch destination
      const { data: locations } = await database.locations.getAll();
      setProcessingCenters(locations || []);
      if (locations && locations.length > 0 && !dispatchDestination) {
        // Try to find a processing center first
        const defaultLoc = locations.find((l: any) => l.is_processing_center) || locations[0];
        setDispatchDestination(defaultLoc.id);
      }
    } catch (error) {
      console.error('Error fetching transit data:', error);
    } finally {
      setLoading(false);
    }
  }, [dispatchDestination]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const toggleSelectItem = (id: string) => {
    const newSelection = new Set(selectedItems);
    if (newSelection.has(id)) {
      newSelection.delete(id);
    } else {
      newSelection.add(id);
    }
    setSelectedItems(newSelection);
  };

  const toggleSelectAll = () => {
    if (selectedItems.size === pendingOrders.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(pendingOrders.map(o => o.id)));
    }
  };

  const handleOpenDispatchModal = () => {
    if (selectedItems.size === 0) {
      alert('Please select orders to dispatch');
      return;
    }
    setShowDispatchModal(true);
  };

  const handleBulkDispatch = async () => {
    if (selectedItems.size === 0 || !dispatchDestination) {
      alert('Please select orders and destination');
      return;
    }

    const selectedOrderIds = Array.from(selectedItems);
    const firstOrder = pendingOrders.find(o => o.id === selectedOrderIds[0]);
    const fromLocationId = firstOrder?.collected_at_location_id || firstOrder?.location_id;

    if (!fromLocationId) {
      alert('Could not determine source location');
      return;
    }

    setDispatching(true);

    const { error, batchId } = await database.sampleTransits.bulkDispatch({
      order_ids: selectedOrderIds,
      from_location_id: fromLocationId,
      to_location_id: dispatchDestination,
      priority: dispatchPriority,
      dispatch_notes: dispatchNotes
    });

    setDispatching(false);
    setShowDispatchModal(false);
    setSelectedItems(new Set());
    setDispatchNotes('');

    if (error) {
      alert('Failed to dispatch: ' + error.message);
    } else {
      alert(`Successfully dispatched ${selectedOrderIds.length} order(s)!\nBatch ID: ${batchId?.slice(0, 8)}`);
      fetchData();
    }
  };

  // Don't show widget if no pending items and no in-transit items
  if (!loading && stats.pendingDispatch === 0 && stats.inTransit === 0) {
    return null;
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 mb-6">
      {/* Header */}
      <div 
        className="flex items-center justify-between px-4 py-3 border-b cursor-pointer hover:bg-gray-50"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <div className="p-2 bg-amber-100 rounded-lg">
            <Truck className="w-5 h-5 text-amber-600" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">Sample Transit</h3>
            <p className="text-xs text-gray-500">Quick dispatch from collection center</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {/* Stats badges */}
          <div className="flex items-center gap-2">
            <span className="px-2 py-1 text-xs font-medium bg-yellow-100 text-yellow-800 rounded-full">
              {stats.pendingDispatch} pending
            </span>
            <span className="px-2 py-1 text-xs font-medium bg-blue-100 text-blue-800 rounded-full">
              {stats.inTransit} in transit
            </span>
          </div>
          <Link 
            to="/sample-transit" 
            className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
            onClick={(e) => e.stopPropagation()}
          >
            View All <ExternalLink className="w-3 h-3" />
          </Link>
          {expanded ? (
            <ChevronUp className="w-5 h-5 text-gray-400" />
          ) : (
            <ChevronDown className="w-5 h-5 text-gray-400" />
          )}
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="p-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
            </div>
          ) : pendingOrders.length === 0 ? (
            <div className="text-center py-6 text-gray-500">
              <Package className="w-8 h-8 mx-auto mb-2 text-gray-300" />
              <p>No samples pending dispatch</p>
            </div>
          ) : (
            <>
              {/* Selection actions */}
              {selectedItems.size > 0 && (
                <div className="flex items-center gap-3 mb-3 p-2 bg-blue-50 rounded-lg">
                  <span className="text-sm font-medium text-blue-800">
                    {selectedItems.size} selected
                  </span>
                  <button
                    onClick={handleOpenDispatchModal}
                    className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"
                  >
                    <Send className="w-4 h-4" />
                    Dispatch
                  </button>
                  <button
                    onClick={() => setSelectedItems(new Set())}
                    className="text-gray-500 hover:text-gray-700"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}

              {/* Orders list (compact) */}
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {/* Select all header */}
                <div className="flex items-center gap-2 text-xs text-gray-500 pb-1 border-b">
                  <button onClick={toggleSelectAll} className="flex items-center gap-1">
                    {selectedItems.size === pendingOrders.length ? (
                      <CheckSquare className="w-4 h-4 text-blue-600" />
                    ) : (
                      <Square className="w-4 h-4 text-gray-400" />
                    )}
                    Select all
                  </button>
                </div>

                {pendingOrders.slice(0, 10).map(order => (
                  <div 
                    key={order.id}
                    className={`flex items-center gap-3 p-2 rounded-lg border transition-colors cursor-pointer ${
                      selectedItems.has(order.id) 
                        ? 'border-blue-300 bg-blue-50' 
                        : 'border-gray-100 hover:bg-gray-50'
                    }`}
                    onClick={() => toggleSelectItem(order.id)}
                  >
                    <button onClick={(e) => { e.stopPropagation(); toggleSelectItem(order.id); }}>
                      {selectedItems.has(order.id) ? (
                        <CheckSquare className="w-4 h-4 text-blue-600" />
                      ) : (
                        <Square className="w-4 h-4 text-gray-400" />
                      )}
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm text-gray-900">#{order.order_number}</span>
                        <span className="text-sm text-gray-600 truncate">{order.patient_name}</span>
                      </div>
                      <div className="flex items-center gap-1 text-xs text-gray-400">
                        <Building2 className="w-3 h-3" />
                        {order.locations?.name || 'Unknown location'}
                      </div>
                    </div>
                  </div>
                ))}

                {pendingOrders.length > 10 && (
                  <Link 
                    to="/sample-transit"
                    className="block text-center text-sm text-blue-600 hover:text-blue-800 py-2"
                  >
                    + {pendingOrders.length - 10} more orders
                  </Link>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Dispatch Modal */}
      {showDispatchModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h3 className="text-lg font-semibold text-gray-900">Dispatch Samples</h3>
              <button onClick={() => setShowDispatchModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Destination Location
                </label>
                <select
                  value={dispatchDestination}
                  onChange={(e) => setDispatchDestination(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2"
                >
                  {processingCenters.map(loc => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name} {loc.is_processing_center ? '(Processing Center)' : ''}
                    </option>
                  ))}
                  {processingCenters.length === 0 && (
                    <option value="">No locations configured</option>
                  )}
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Priority
                </label>
                <select
                  value={dispatchPriority}
                  onChange={(e) => setDispatchPriority(e.target.value as any)}
                  className="w-full border rounded-lg px-3 py-2"
                >
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                  <option value="low">Low</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Notes (optional)
                </label>
                <textarea
                  value={dispatchNotes}
                  onChange={(e) => setDispatchNotes(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2"
                  rows={2}
                  placeholder="Any special instructions..."
                />
              </div>

              <div className="bg-blue-50 rounded-lg p-3">
                <p className="text-sm text-blue-800">
                  <strong>{selectedItems.size}</strong> order(s) will be dispatched
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t bg-gray-50">
              <button
                onClick={() => setShowDispatchModal(false)}
                className="px-4 py-2 text-gray-700 hover:text-gray-900"
              >
                Cancel
              </button>
              <button
                onClick={handleBulkDispatch}
                disabled={dispatching || !dispatchDestination}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {dispatching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                Dispatch
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SampleTransitWidget;
