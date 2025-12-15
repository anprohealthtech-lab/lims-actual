import React, { useEffect, useState, useCallback } from 'react';
import { database, supabase } from '../utils/supabase';
import {
  Truck,
  Package,
  Clock,
  Send,
  Loader2,
  Download,
  AlertCircle,
  CheckCircle,
  Barcode,
  MapPin,
  Calendar,
  X,
  CheckSquare,
  Square,
  Building2,
  ArrowRight,
  RefreshCw,
  Filter,
  Printer
} from 'lucide-react';

interface TransitItem {
  id: string;
  lab_id: string;
  sample_id?: string;
  order_id?: string;
  from_location_id: string;
  to_location_id: string;
  status: string;
  tracking_barcode?: string;
  dispatched_at?: string;
  dispatched_by?: string;
  received_at?: string;
  received_by?: string;
  dispatch_notes?: string;
  receipt_notes?: string;
  priority: string;
  batch_id?: string;
  created_at: string;
  // Joined fields
  from_location?: { id: string; name: string; type: string };
  to_location?: { id: string; name: string; type: string };
  orders?: { id: string; order_number: number; patient_name: string; order_date: string };
  samples?: { id: string; sample_type: string; barcode: string };
  dispatched_by_user?: { id: string; name: string };
  received_by_user?: { id: string; name: string };
}

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

type TabFilter = 'pending_dispatch' | 'in_transit' | 'received' | 'issues';

const IntraLabTransitQueue: React.FC = () => {
  const [transits, setTransits] = useState<TransitItem[]>([]);
  const [pendingOrders, setPendingOrders] = useState<PendingOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabFilter>('pending_dispatch');
  const [selectedLocation, setSelectedLocation] = useState<string>('all');
  const [locations, setLocations] = useState<Location[]>([]);
  const [processingCenters, setProcessingCenters] = useState<Location[]>([]);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [dispatching, setDispatching] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const [stats, setStats] = useState({ pendingDispatch: 0, inTransit: 0, receivedToday: 0 });
  
  // Dispatch modal state
  const [showDispatchModal, setShowDispatchModal] = useState(false);
  const [dispatchDestination, setDispatchDestination] = useState<string>('');
  const [dispatchNotes, setDispatchNotes] = useState('');
  const [dispatchPriority, setDispatchPriority] = useState<'normal' | 'urgent' | 'high' | 'low'>('normal');

  useEffect(() => {
    fetchLocations();
    fetchData();
    fetchStats();
  }, []);

  useEffect(() => {
    fetchData();
  }, [activeTab, selectedLocation, fromDate, toDate]);

  const fetchLocations = async () => {
    const { data: allLocations } = await database.locations.getAll();
    
    if (allLocations) {
      setLocations(allLocations);
      setProcessingCenters(allLocations); // Use all locations as potential destinations
      
      // Set default destination to first processing center if available
      const defaultLoc = allLocations.find((l: any) => l.is_processing_center) || allLocations[0];
      if (defaultLoc) {
        setDispatchDestination(defaultLoc.id);
      }
    }
  };

  const fetchStats = async () => {
    const { data } = await database.sampleTransits.getStats(
      selectedLocation !== 'all' ? selectedLocation : undefined
    );
    if (data) setStats(data);
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    setSelectedItems(new Set());

    if (activeTab === 'pending_dispatch') {
      // Fetch orders pending dispatch from selected location
      const { data, error } = await database.sampleTransits.getPendingDispatch(
        selectedLocation !== 'all' ? selectedLocation : undefined
      );
      if (!error && data) {
        setPendingOrders(data);
      }
      setTransits([]);
    } else {
      // Fetch transit records
      const filters: any = {};
      if (activeTab === 'issues') {
        filters.status = 'issue_reported';
      } else {
        filters.status = activeTab;
      }
      if (selectedLocation !== 'all') {
        filters.fromLocationId = selectedLocation;
      }
      if (fromDate) filters.fromDate = fromDate;
      if (toDate) filters.toDate = toDate;

      const { data, error } = await database.sampleTransits.getAll(filters);
      if (!error && data) {
        setTransits(data);
      }
      setPendingOrders([]);
    }

    setLoading(false);
    fetchStats();
  }, [activeTab, selectedLocation, fromDate, toDate]);

  const toggleSelectAll = () => {
    if (activeTab === 'pending_dispatch') {
      const allIds = pendingOrders.map(o => o.id);
      if (selectedItems.size === allIds.length) {
        setSelectedItems(new Set());
      } else {
        setSelectedItems(new Set(allIds));
      }
    } else {
      const allIds = transits.map(t => t.id);
      if (selectedItems.size === allIds.length) {
        setSelectedItems(new Set());
      } else {
        setSelectedItems(new Set(allIds));
      }
    }
  };

  const toggleSelectItem = (id: string) => {
    const newSelection = new Set(selectedItems);
    if (newSelection.has(id)) {
      newSelection.delete(id);
    } else {
      newSelection.add(id);
    }
    setSelectedItems(newSelection);
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

    // Get selected orders' location
    const selectedOrderIds = Array.from(selectedItems);
    const firstOrder = pendingOrders.find(o => o.id === selectedOrderIds[0]);
    const fromLocationId = firstOrder?.collected_at_location_id || firstOrder?.location_id;

    if (!fromLocationId) {
      alert('Could not determine source location');
      return;
    }

    setDispatching(true);

    const { data, error, batchId } = await database.sampleTransits.bulkDispatch({
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

  const handleBulkReceive = async () => {
    if (selectedItems.size === 0) {
      alert('Please select items to receive');
      return;
    }

    const confirmed = window.confirm(`Mark ${selectedItems.size} item(s) as received?`);
    if (!confirmed) return;

    setReceiving(true);

    const { error } = await database.sampleTransits.bulkReceive(Array.from(selectedItems));

    setReceiving(false);
    setSelectedItems(new Set());

    if (error) {
      alert('Failed to receive: ' + error.message);
    } else {
      alert(`Successfully received ${selectedItems.size} item(s)!`);
      fetchData();
    }
  };

  const handleReportIssue = async (transitId: string) => {
    const issue = window.prompt('Describe the issue:');
    if (!issue) return;

    const { error } = await database.sampleTransits.updateStatus(transitId, 'issue_reported', issue);
    if (error) {
      alert('Failed to report issue');
    } else {
      alert('Issue reported');
      fetchData();
    }
  };

  const getTabCounts = () => {
    return {
      pending_dispatch: pendingOrders.length || stats.pendingDispatch,
      in_transit: stats.inTransit,
      received: stats.receivedToday,
      issues: 0 // Could add issue count to stats
    };
  };

  const counts = getTabCounts();

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getPriorityBadge = (priority: string) => {
    const colors: Record<string, string> = {
      urgent: 'bg-red-100 text-red-800',
      high: 'bg-orange-100 text-orange-800',
      normal: 'bg-blue-100 text-blue-800',
      low: 'bg-gray-100 text-gray-800'
    };
    return (
      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[priority] || colors.normal}`}>
        {priority}
      </span>
    );
  };

  const getStatusBadge = (status: string) => {
    const config: Record<string, { color: string; icon: React.ReactNode }> = {
      pending_dispatch: { color: 'bg-yellow-100 text-yellow-800', icon: <Clock className="w-3 h-3" /> },
      in_transit: { color: 'bg-blue-100 text-blue-800', icon: <Truck className="w-3 h-3" /> },
      delivered: { color: 'bg-green-100 text-green-800', icon: <CheckCircle className="w-3 h-3" /> },
      received: { color: 'bg-green-100 text-green-800', icon: <CheckCircle className="w-3 h-3" /> },
      issue_reported: { color: 'bg-red-100 text-red-800', icon: <AlertCircle className="w-3 h-3" /> }
    };
    const { color, icon } = config[status] || config.pending_dispatch;
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${color}`}>
        {icon}
        {status.replace(/_/g, ' ')}
      </span>
    );
  };

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Truck className="w-6 h-6 text-blue-600" />
            Sample Transit Queue
          </h1>
          <p className="text-gray-600 text-sm mt-1">
            Track samples between collection centers and processing lab
          </p>
        </div>
        
        <div className="flex items-center gap-2">
          <button
            onClick={fetchData}
            className="flex items-center gap-2 px-3 py-2 border rounded-lg hover:bg-gray-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-yellow-800 text-sm font-medium">Pending Dispatch</p>
              <p className="text-2xl font-bold text-yellow-900">{stats.pendingDispatch}</p>
            </div>
            <Package className="w-8 h-8 text-yellow-600" />
          </div>
        </div>
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-blue-800 text-sm font-medium">In Transit</p>
              <p className="text-2xl font-bold text-blue-900">{stats.inTransit}</p>
            </div>
            <Truck className="w-8 h-8 text-blue-600" />
          </div>
        </div>
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-green-800 text-sm font-medium">Received Today</p>
              <p className="text-2xl font-bold text-green-900">{stats.receivedToday}</p>
            </div>
            <CheckCircle className="w-8 h-8 text-green-600" />
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4 mb-4 p-4 bg-gray-50 rounded-lg">
        <div className="flex items-center gap-2">
          <MapPin className="w-4 h-4 text-gray-500" />
          <select
            value={selectedLocation}
            onChange={(e) => setSelectedLocation(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm"
          >
            <option value="all">All Locations</option>
            {locations.map(loc => (
              <option key={loc.id} value={loc.id}>{loc.name}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-gray-500" />
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm"
            placeholder="From"
          />
          <span className="text-gray-400">to</span>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm"
            placeholder="To"
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-4">
        <nav className="flex gap-4 overflow-x-auto">
          {[
            { id: 'pending_dispatch', label: 'Pending Dispatch', icon: Package },
            { id: 'in_transit', label: 'In Transit', icon: Truck },
            { id: 'received', label: 'Received', icon: CheckCircle },
            { id: 'issues', label: 'Issues', icon: AlertCircle }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as TabFilter)}
              className={`flex items-center gap-2 px-4 py-3 border-b-2 font-medium text-sm whitespace-nowrap transition-colors ${
                activeTab === tab.id
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
              <span className={`ml-1 px-2 py-0.5 rounded-full text-xs ${
                activeTab === tab.id ? 'bg-blue-100' : 'bg-gray-100'
              }`}>
                {counts[tab.id as keyof typeof counts]}
              </span>
            </button>
          ))}
        </nav>
      </div>

      {/* Bulk Actions */}
      {selectedItems.size > 0 && (
        <div className="flex items-center gap-4 mb-4 p-3 bg-blue-50 rounded-lg">
          <span className="text-sm font-medium text-blue-800">
            {selectedItems.size} selected
          </span>
          {activeTab === 'pending_dispatch' && (
            <button
              onClick={handleOpenDispatchModal}
              disabled={dispatching}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {dispatching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Dispatch Selected
            </button>
          )}
          {activeTab === 'in_transit' && (
            <button
              onClick={handleBulkReceive}
              disabled={receiving}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              {receiving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
              Mark as Received
            </button>
          )}
          <button
            onClick={() => setSelectedItems(new Set())}
            className="text-gray-600 hover:text-gray-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        </div>
      ) : activeTab === 'pending_dispatch' ? (
        /* Pending Dispatch - Show orders awaiting dispatch */
        <div className="bg-white rounded-lg border overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left">
                  <button onClick={toggleSelectAll} className="flex items-center gap-2">
                    {selectedItems.size === pendingOrders.length && pendingOrders.length > 0 ? (
                      <CheckSquare className="w-4 h-4 text-blue-600" />
                    ) : (
                      <Square className="w-4 h-4 text-gray-400" />
                    )}
                  </button>
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Order</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Patient</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Collection Location</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Collected At</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {pendingOrders.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                    No samples pending dispatch
                  </td>
                </tr>
              ) : (
                pendingOrders.map(order => (
                  <tr key={order.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <button onClick={() => toggleSelectItem(order.id)}>
                        {selectedItems.has(order.id) ? (
                          <CheckSquare className="w-4 h-4 text-blue-600" />
                        ) : (
                          <Square className="w-4 h-4 text-gray-400" />
                        )}
                      </button>
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-900">
                      #{order.order_number}
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {order.patient_name}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1 text-sm">
                        <Building2 className="w-4 h-4 text-gray-400" />
                        {order.locations?.name || 'Unknown'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {formatDate(order.sample_collected_at)}
                    </td>
                    <td className="px-4 py-3">
                      {getStatusBadge(order.transit_status || 'at_collection_point')}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : (
        /* Transit Records */
        <div className="bg-white rounded-lg border overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left">
                  <button onClick={toggleSelectAll} className="flex items-center gap-2">
                    {selectedItems.size === transits.length && transits.length > 0 ? (
                      <CheckSquare className="w-4 h-4 text-blue-600" />
                    ) : (
                      <Square className="w-4 h-4 text-gray-400" />
                    )}
                  </button>
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Tracking</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Order</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Route</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Priority</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Dispatched</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {transits.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                    No transit records found
                  </td>
                </tr>
              ) : (
                transits.map(transit => (
                  <tr key={transit.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <button onClick={() => toggleSelectItem(transit.id)}>
                        {selectedItems.has(transit.id) ? (
                          <CheckSquare className="w-4 h-4 text-blue-600" />
                        ) : (
                          <Square className="w-4 h-4 text-gray-400" />
                        )}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs bg-gray-100 px-2 py-1 rounded">
                        {transit.tracking_barcode || '-'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">
                        #{transit.orders?.order_number}
                      </div>
                      <div className="text-sm text-gray-500">
                        {transit.orders?.patient_name}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="text-gray-700">{transit.from_location?.name}</span>
                        <ArrowRight className="w-4 h-4 text-gray-400" />
                        <span className="text-gray-700">{transit.to_location?.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {getPriorityBadge(transit.priority)}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      <div>{formatDate(transit.dispatched_at)}</div>
                      <div className="text-xs text-gray-400">
                        by {transit.dispatched_by_user?.name || '-'}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {getStatusBadge(transit.status)}
                    </td>
                    <td className="px-4 py-3">
                      {transit.status === 'in_transit' && (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={async () => {
                              const { error } = await database.sampleTransits.receive(transit.id);
                              if (!error) fetchData();
                            }}
                            className="text-green-600 hover:text-green-800 text-sm"
                          >
                            Receive
                          </button>
                          <button
                            onClick={() => handleReportIssue(transit.id)}
                            className="text-red-600 hover:text-red-800 text-sm"
                          >
                            Issue
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
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

export default IntraLabTransitQueue;
