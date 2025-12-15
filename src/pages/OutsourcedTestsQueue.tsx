import React, { useEffect, useState, useCallback } from 'react';
import { database, supabase } from '../utils/supabase';
import {
  TestTube,
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
  MoreVertical
} from 'lucide-react';
import type { OutsourcedTestQueueItem } from '../types';

type TabFilter = 'pending_send' | 'sent' | 'awaiting_report' | 'overdue';

const OutsourcedTestsQueue: React.FC = () => {
  const [queueItems, setQueueItems] = useState<OutsourcedTestQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabFilter>('pending_send');
  const [selectedLab, setSelectedLab] = useState<string>('all');
  const [labsList, setLabsList] = useState<Array<{ id: string; name: string }>>([]);
  const [currentLabId, setCurrentLabId] = useState<string | null>(null);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [dispatching, setDispatching] = useState(false);
  const [showBulkActions, setShowBulkActions] = useState(false);

  useEffect(() => {
    fetchCurrentLab();
    fetchQueue();
    fetchOutsourcedLabs();
  }, [selectedLab, fromDate, toDate]); // Removed activeTab dependency

  const fetchCurrentLab = async () => {
    const lab_id = await database.getCurrentUserLabId();
    setCurrentLabId(lab_id);
  };

  const fetchOutsourcedLabs = async () => {
    try {
      // Get current user's lab_id to filter relevant outsourced labs
      const lab_id = await database.getCurrentUserLabId();
      if (!lab_id) {
        console.error('No lab context found');
        return;
      }

      // Query outsourced_labs that are active and available to this lab
      const { data, error } = await supabase
        .from('outsourced_labs')
        .select('id, name')
        .eq('is_active', true)
        .order('name');

      if (!error && data) {
        setLabsList(data);
      }
    } catch (err) {
      console.error('Error fetching outsourced labs:', err);
    }
  };

  const fetchQueue = useCallback(async () => {
    setLoading(true);
    setSelectedItems(new Set()); // Clear selection on refresh

    const filters: any = {};
    if (selectedLab !== 'all') filters.outsourcedLabId = selectedLab;
    // Removed activeTab filter to fetch all items for counts
    if (fromDate) filters.fromDate = fromDate;
    if (toDate) filters.toDate = toDate;

    const { data, error } = await database.outsourcedReports.getPendingTests(filters);

    if (error) {
      console.error('Error fetching queue:', error);
      alert('Failed to load queue');
      setQueueItems([]);
    } else {
      setQueueItems(data || []);
    }
    setLoading(false);
  }, [selectedLab, fromDate, toDate]);

  const filteredItems = React.useMemo(() => {
    return queueItems.filter(item => {
      if (activeTab === 'overdue') {
        if (!item.outsourced_tat_estimate) return false;
        return new Date(item.outsourced_tat_estimate) < new Date();
      }
      if (activeTab === 'awaiting_report') {
        return item.outsourced_status === 'awaiting_report' || item.outsourced_status === 'sent';
      }
      return item.outsourced_status === activeTab;
    });
  }, [queueItems, activeTab]);

  // Group items by order_id
  const groupedOrders = React.useMemo(() => {
    const orderMap = new Map<string, OutsourcedTestQueueItem[]>();
    filteredItems.forEach(item => {
      const orderId = item.order_id;
      if (!orderMap.has(orderId)) {
        orderMap.set(orderId, []);
      }
      orderMap.get(orderId)!.push(item);
    });
    return Array.from(orderMap.entries()).map(([orderId, tests]) => ({
      orderId,
      tests,
      patientName: tests[0].patient_name,
      orderNumber: tests[0].order_number,
      outsourcedLabName: tests[0].outsourced_lab_name,
      minTat: tests.reduce((min, t) => {
        if (!t.outsourced_tat_estimate) return min;
        const tat = new Date(t.outsourced_tat_estimate);
        return !min || tat < min ? tat : min;
      }, null as Date | null)
    }));
  }, [filteredItems]);

  const toggleSelectAll = () => {
    const allResultIds = filteredItems.map(item => item.result_id);
    if (selectedItems.size === allResultIds.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(allResultIds));
    }
  };

  const toggleSelectItem = (resultId: string) => {
    const newSelection = new Set(selectedItems);
    if (newSelection.has(resultId)) {
      newSelection.delete(resultId);
    } else {
      newSelection.add(resultId);
    }
    setSelectedItems(newSelection);
  };

  const handleBulkDispatch = async () => {
    if (selectedItems.size === 0) {
      alert('Please select tests to dispatch');
      return;
    }

    const confirmed = window.confirm(`Dispatch ${selectedItems.size} test(s)?`);
    if (!confirmed) return;

    setDispatching(true);
    let successCount = 0;
    let failCount = 0;

    for (const resultId of Array.from(selectedItems)) {
      try {
        // Generate tracking barcode
        const { data: barcodeData, error: barcodeError} = await database.outsourcedReports.generateTrackingBarcode(resultId);
        
        if (barcodeError) throw barcodeError;

        // Update BOTH logistics status AND outsourced status
        const { error } = await database.outsourcedReports.updateLogisticsStatus(
          resultId,
          'in_transit',
          'Dispatched to outsourced lab',
          'sent' // ✅ Update outsourced_status to 'sent'
        );

        if (error) throw error;
        successCount++;
      } catch (error) {
        console.error('Error dispatching:', error);
        failCount++;
      }
    }

    setDispatching(false);
    setSelectedItems(new Set());
    
    if (failCount === 0) {
      alert(`Successfully dispatched ${successCount} test(s)!`);
    } else {
      alert(`Dispatched ${successCount} test(s). Failed: ${failCount}`);
    }
    
    fetchQueue();
  };

  const handleBulkMarkReceived = async () => {
    if (selectedItems.size === 0) {
      alert('Please select tests to mark as received');
      return;
    }

    const confirmed = window.confirm(`Mark ${selectedItems.size} test(s) as received by lab?`);
    if (!confirmed) return;

    setDispatching(true);
    let successCount = 0;
    let failCount = 0;

    for (const resultId of Array.from(selectedItems)) {
      try {
        const { error } = await database.outsourcedReports.updateLogisticsStatus(
          resultId,
          'delivered_to_lab',
          'Sample received by external lab - bulk confirmed',
          'awaiting_report'
        );

        if (error) throw error;
        successCount++;
      } catch (error) {
        console.error('Error marking as received:', error);
        failCount++;
      }
    }

    setDispatching(false);
    setSelectedItems(new Set());
    
    if (failCount === 0) {
      alert(`Successfully marked ${successCount} test(s) as received!`);
    } else {
      alert(`Marked ${successCount} test(s) as received. Failed: ${failCount}`);
    }
    
    fetchQueue();
  };

  const handleCancelDispatch = async (resultId: string) => {
    const confirmed = window.confirm('Cancel dispatch for this test?');
    if (!confirmed) return;

    try {
      const { error } = await database.outsourcedReports.updateLogisticsStatus(
        resultId,
        'pending_dispatch',
        'Dispatch cancelled',
        'pending_send' // Reset to pending_send
      );

      if (error) throw error;
      alert('Dispatch cancelled successfully');
      fetchQueue();
    } catch (error) {
      console.error('Error cancelling dispatch:', error);
      alert('Failed to cancel dispatch');
    }
  };

  const handleMarkAsReceived = async (resultId: string) => {
    const confirmed = window.confirm('Mark as received by external lab? (Optional - for tracking purposes only)');
    if (!confirmed) return;

    try {
      const { error } = await database.outsourcedReports.updateLogisticsStatus(
        resultId,
        'delivered_to_lab',
        'Sample received by external lab - manually confirmed',
        'awaiting_report' // Explicitly set to awaiting_report
      );

      if (error) throw error;
      alert('Logistics status updated to "Received by Lab"');
      fetchQueue();
    } catch (error) {
      console.error('Error marking as received:', error);
      alert('Failed to update status');
    }
  };

  const handleUpdateLogistics = async (resultId: string, newStatus: string, statusLabel: string) => {
    const confirmed = window.confirm(`Update logistics status to "${statusLabel}"?`);
    if (!confirmed) return;

    try {
      const { error } = await database.outsourcedReports.updateLogisticsStatus(
        resultId,
        newStatus,
        `Logistics status updated to ${statusLabel}`
      );

      if (error) throw error;
      alert(`Logistics updated to "${statusLabel}"`);
      fetchQueue();
    } catch (error) {
      console.error('Error updating logistics:', error);
      alert('Failed to update logistics status');
    }
  };

  const handlePrintRequisition = async (item: OutsourcedTestQueueItem) => {
    // Generate requisition PDF
    const requisitionHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; padding: 40px; }
          .header { text-align: center; border-bottom: 2px solid #333; padding-bottom: 20px; margin-bottom: 30px; }
          .header h1 { margin: 0; color: #2563eb; }
          .section { margin-bottom: 25px; }
          .section h2 { background: #f3f4f6; padding: 10px; margin-bottom: 15px; }
          .info-grid { display: grid; grid-template-columns: 150px 1fr; gap: 10px; }
          .info-label { font-weight: bold; }
          .barcode { text-align: center; margin: 30px 0; }
          .barcode-text { font-size: 24px; font-family: monospace; letter-spacing: 3px; }
          .footer { margin-top: 50px; border-top: 1px solid #ccc; padding-top: 20px; text-align: center; font-size: 12px; color: #666; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>Outsourced Test Requisition</h1>
          <p>Please process the following test and return results</p>
        </div>

        <div class="section">
          <h2>Patient Information</h2>
          <div class="info-grid">
            <span class="info-label">Patient Name:</span>
            <span>${item.patient_name}</span>
            <span class="info-label">Patient ID:</span>
            <span>${item.patient_id}</span>
          </div>
        </div>

        <div class="section">
          <h2>Test Details</h2>
          <div class="info-grid">
            <span class="info-label">Test Name:</span>
            <span>${item.test_name}</span>
            <span class="info-label">Order Number:</span>
            <span>${item.order_number || 'N/A'}</span>
            <span class="info-label">Order Date:</span>
            <span>${new Date().toLocaleDateString()}</span>
            <span class="info-label">Expected TAT:</span>
            <span>${item.outsourced_tat_estimate ? new Date(item.outsourced_tat_estimate).toLocaleDateString() : 'N/A'}</span>
          </div>
        </div>

        ${item.tracking_barcode ? `
          <div class="barcode">
            <p style="font-weight: bold; margin-bottom: 10px;">Tracking Number</p>
            <div class="barcode-text">${item.tracking_barcode}</div>
            <p style="font-size: 12px; color: #666; margin-top: 10px;">Please reference this tracking number in your report</p>
          </div>
        ` : ''}

        <div class="section">
          <h2>Special Instructions</h2>
          <p>${item.logistics_notes || 'No special instructions'}</p>
        </div>

        <div class="footer">
          <p>Generated on ${new Date().toLocaleString()}</p>
          <p>For queries, please contact the sending laboratory</p>
        </div>
      </body>
      </html>
    `;

    const blob = new Blob([requisitionHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const printWindow = window.open(url, '_blank');
    
    if (printWindow) {
      printWindow.onload = () => {
        printWindow.print();
      };
    }
  };

  const TabButton = ({ value, label, count }: { value: TabFilter; label: string; count: number }) => (
    <button
      onClick={() => setActiveTab(value)}
      className={`px-4 py-2 font-medium rounded-lg transition-colors ${
        activeTab === value
          ? 'bg-blue-600 text-white shadow-sm'
          : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'
      }`}
    >
      {label}
      {count > 0 && (
        <span className={`ml-2 px-2 py-0.5 text-xs rounded-full ${
          activeTab === value ? 'bg-blue-700 text-white' : 'bg-gray-100 text-gray-600'
        }`}>
          {count}
        </span>
      )}
    </button>
  );

  const getDaysUntilTAT = (tatDate?: string): number => {
    if (!tatDate) return 0;
    const diff = new Date(tatDate).getTime() - new Date().getTime();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        <span className="ml-2 text-gray-600">Loading queue...</span>
      </div>
    );
  }

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
          <div className="p-2 bg-blue-100 rounded-lg">
            <TestTube className="w-8 h-8 text-blue-600" />
          </div>
          Outsourced Tests Queue
        </h1>
        <p className="text-gray-600 mt-2 ml-14">
          Manage and track tests sent to external reference laboratories
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-gray-500">Pending Dispatch</p>
            <div className="p-2 bg-yellow-50 rounded-lg">
              <Package className="w-5 h-5 text-yellow-600" />
            </div>
          </div>
          <p className="text-2xl font-bold text-gray-900">
            {queueItems.filter(i => i.outsourced_status === 'pending_send').length}
          </p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-gray-500">In Transit</p>
            <div className="p-2 bg-blue-50 rounded-lg">
              <Truck className="w-5 h-5 text-blue-600" />
            </div>
          </div>
          <p className="text-2xl font-bold text-gray-900">
            {queueItems.filter(i => i.outsourced_status === 'sent').length}
          </p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-gray-500">Awaiting Report</p>
            <div className="p-2 bg-purple-50 rounded-lg">
              <Clock className="w-5 h-5 text-purple-600" />
            </div>
          </div>
          <p className="text-2xl font-bold text-gray-900">
            {queueItems.filter(i => 
              i.outsourced_status === 'awaiting_report' || i.outsourced_status === 'sent'
            ).length}
          </p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-gray-500">Overdue</p>
            <div className="p-2 bg-red-50 rounded-lg">
              <AlertCircle className="w-5 h-5 text-red-600" />
            </div>
          </div>
          <p className="text-2xl font-bold text-gray-900">
            {queueItems.filter(i => {
              if (!i.outsourced_tat_estimate) return false;
              return new Date(i.outsourced_tat_estimate) < new Date();
            }).length}
          </p>
        </div>
      </div>

      {/* Filters & Controls */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-6">
        <div className="flex flex-col lg:flex-row gap-4 justify-between items-start lg:items-center">
          <div className="flex flex-wrap gap-2">
            <TabButton
              value="pending_send"
              label="Pending Dispatch"
              count={queueItems.filter(i => i.outsourced_status === 'pending_send').length}
            />
            <TabButton
              value="sent"
              label="In Transit"
              count={queueItems.filter(i => i.outsourced_status === 'sent').length}
            />
            <TabButton
              value="awaiting_report"
              label="Awaiting Report"
              count={queueItems.filter(i => 
                i.outsourced_status === 'awaiting_report' || i.outsourced_status === 'sent'
              ).length}
            />
            <TabButton
              value="overdue"
              label="Overdue"
              count={queueItems.filter(i => {
                if (!i.outsourced_tat_estimate) return false;
                return new Date(i.outsourced_tat_estimate) < new Date();
              }).length}
            />
          </div>

          <div className="flex flex-wrap gap-3 w-full lg:w-auto">
            <select
              value={selectedLab}
              onChange={(e) => setSelectedLab(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm min-w-[150px]"
            >
              <option value="all">All Labs</option>
              {labsList.map(lab => (
                <option key={lab.id} value={lab.id}>{lab.name}</option>
              ))}
            </select>

            <div className="flex gap-2">
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
              />
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Bulk Actions Bar */}
      {selectedItems.size > 0 && (activeTab === 'pending_send' || activeTab === 'sent') && (
        <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 bg-white border border-blue-100 shadow-xl rounded-full px-6 py-3 z-50 flex items-center gap-6 animate-in slide-in-from-bottom-4">
          <div className="flex items-center gap-2">
            <div className="bg-blue-100 p-1 rounded-full">
              <CheckCircle className="w-4 h-4 text-blue-600" />
            </div>
            <span className="font-medium text-gray-900">
              {selectedItems.size} selected
            </span>
          </div>
          <div className="h-6 w-px bg-gray-200" />
          <div className="flex gap-3">
            <button
              onClick={() => setSelectedItems(new Set())}
              className="text-sm text-gray-600 hover:text-gray-900 font-medium"
            >
              Clear
            </button>
            {activeTab === 'pending_send' ? (
              <button
                onClick={handleBulkDispatch}
                disabled={dispatching}
                className="bg-blue-600 text-white px-4 py-1.5 rounded-full text-sm font-medium hover:bg-blue-700 transition-colors flex items-center gap-2 shadow-sm"
              >
                {dispatching ? (
                  <>
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Dispatching...
                  </>
                ) : (
                  <>
                    <Send className="w-3 h-3" />
                    Dispatch Selected
                  </>
                )}
              </button>
            ) : (
              <button
                onClick={handleBulkMarkReceived}
                disabled={dispatching}
                className="bg-green-600 text-white px-4 py-1.5 rounded-full text-sm font-medium hover:bg-green-700 transition-colors flex items-center gap-2 shadow-sm"
              >
                {dispatching ? (
                  <>
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Package className="w-3 h-3" />
                    Mark Received
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Queue Grid */}
      {filteredItems.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
          <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <TestTube className="w-8 h-8 text-gray-400" />
          </div>
          <h3 className="text-lg font-medium text-gray-900">No tests in queue</h3>
          <p className="text-gray-500 mt-1">
            Tests will appear here when marked for outsourcing
          </p>
        </div>
      ) : (
        <>
          {(activeTab === 'pending_send' || activeTab === 'sent') && (
            <div className="mb-4 flex justify-end">
              <button
                onClick={toggleSelectAll}
                className="text-sm text-gray-600 hover:text-gray-900 flex items-center gap-2 font-medium"
              >
                {selectedItems.size === filteredItems.length ? (
                  <>
                    <CheckSquare className="w-4 h-4 text-blue-600" />
                    Deselect All
                  </>
                ) : (
                  <>
                    <Square className="w-4 h-4" />
                    Select All
                  </>
                )}
              </button>
            </div>
          )}
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {groupedOrders.map((order) => {
              const allResultIds = order.tests.map(t => t.result_id);
              const allSelected = allResultIds.every(id => selectedItems.has(id));
              const someSelected = allResultIds.some(id => selectedItems.has(id)) && !allSelected;
              const daysUntilTAT = order.minTat ? getDaysUntilTAT(order.minTat.toISOString()) : 999;
              const isOverdue = daysUntilTAT < 0;

              const toggleOrderSelection = () => {
                const newSelection = new Set(selectedItems);
                if (allSelected) {
                  // Deselect all tests in this order
                  allResultIds.forEach(id => newSelection.delete(id));
                } else {
                  // Select all tests in this order
                  allResultIds.forEach(id => newSelection.add(id));
                }
                setSelectedItems(newSelection);
              };

              return (
                <div 
                  key={order.orderId}
                  className={`bg-white rounded-xl border transition-all duration-200 hover:shadow-md group relative ${
                    allSelected 
                      ? 'border-blue-500 ring-1 ring-blue-500 shadow-sm' 
                      : someSelected
                      ? 'border-blue-300 ring-1 ring-blue-300 shadow-sm'
                      : 'border-gray-200 shadow-sm'
                  }`}
                >
                  {/* Selection Checkbox (Absolute) */}
                  {(activeTab === 'pending_send' || activeTab === 'sent') && (
                    <div className="absolute top-4 right-4 z-10">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleOrderSelection();
                        }}
                        className="focus:outline-none"
                      >
                        {allSelected ? (
                          <CheckSquare className="w-5 h-5 text-blue-600" />
                        ) : someSelected ? (
                          <CheckSquare className="w-5 h-5 text-blue-300" />
                        ) : (
                          <Square className="w-5 h-5 text-gray-300 group-hover:text-gray-400" />
                        )}
                      </button>
                    </div>
                  )}

                  <div className="p-5">
                    {/* Header */}
                    <div className="flex justify-between items-start mb-4 pr-8">
                      <div>
                        <h3 className="font-semibold text-gray-900">{order.patientName}</h3>
                        <p className="text-xs text-gray-500 mt-0.5">
                          Order #{order.orderNumber || order.orderId.slice(0, 8)}
                        </p>
                        {order.tests.length > 1 && (
                          <span className="inline-block mt-1 px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 rounded-full">
                            {order.tests.length} Tests
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Content */}
                    <div className="space-y-3">
                      {/* Tests List */}
                      <div className="space-y-2">
                        {order.tests.map((test, idx) => (
                          <div key={test.result_id} className="flex items-start gap-3">
                            <div className="p-1.5 bg-blue-50 rounded text-blue-600 mt-0.5 shrink-0">
                              <TestTube className="w-3.5 h-3.5" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-gray-900 truncate">{test.test_name}</p>
                              {test.tracking_barcode && (
                                <p className="text-xs text-gray-500 font-mono mt-0.5">
                                  <Barcode className="w-3 h-3 inline mr-1" />
                                  {test.tracking_barcode}
                                </p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="flex items-start gap-3">
                        <div className="p-1.5 bg-gray-100 rounded text-gray-600 mt-0.5">
                          <MapPin className="w-3.5 h-3.5" />
                        </div>
                        <div>
                          <p className="text-sm text-gray-900">{order.outsourcedLabName || 'Unknown Lab'}</p>
                          <p className="text-xs text-gray-500">Destination Lab</p>
                        </div>
                      </div>

                      {/* Status Badge */}
                      <div className="flex items-center gap-2 pt-2">
                        <span className={`px-2.5 py-1 text-xs font-medium rounded-full ${
                          order.tests[0].outsourced_status === 'pending_send' ? 'bg-yellow-100 text-yellow-800' :
                          order.tests[0].outsourced_status === 'sent' ? 'bg-blue-100 text-blue-800' :
                          order.tests[0].outsourced_status === 'awaiting_report' ? 'bg-purple-100 text-purple-800' :
                          'bg-green-100 text-green-800'
                        }`}>
                          {order.tests[0].outsourced_status?.replace('_', ' ').toUpperCase()}
                        </span>
                        
                        {order.tests[0].outsourced_logistics_status && (
                          <span className="text-xs text-gray-500 flex items-center gap-1 bg-gray-50 px-2 py-1 rounded-full border border-gray-100">
                            <Truck className="w-3 h-3" />
                            {order.tests[0].outsourced_logistics_status.replace(/_/g, ' ')}
                          </span>
                        )}
                      </div>

                      {/* TAT Info */}
                      {order.minTat && (
                        <div className={`flex items-center gap-2 text-xs mt-2 ${
                          isOverdue ? 'text-red-600 font-medium' : 'text-gray-500'
                        }`}>
                          <Clock className="w-3.5 h-3.5" />
                          <span>
                            {isOverdue 
                              ? `${Math.abs(daysUntilTAT)} days overdue` 
                              : `${daysUntilTAT} days remaining`}
                          </span>
                          <span className="text-gray-300">|</span>
                          <span>Due {order.minTat.toLocaleDateString()}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Footer Actions */}
                  <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 rounded-b-xl flex justify-between items-center">
                    <button
                      onClick={() => handlePrintRequisition(order.tests[0])}
                      className="text-gray-600 hover:text-blue-600 transition-colors p-1.5 hover:bg-blue-50 rounded-lg"
                      title="Print Requisition"
                    >
                      <Download className="w-4 h-4" />
                    </button>

                    <div className="flex items-center gap-2">
                      {/* In Transit Actions - Individual test actions removed, use bulk select instead */}
                      {order.tests[0].outsourced_status === 'sent' && activeTab === 'sent' && (
                        <p className="text-xs text-gray-500 italic">
                          Use bulk selection to mark as received
                        </p>
                      )}

                      {/* Awaiting Report Actions */}
                      {activeTab === 'awaiting_report' && (
                        <select
                          onChange={(e) => {
                            if (e.target.value) {
                              const [status, label] = e.target.value.split('|');
                              // Update all tests in this order
                              order.tests.forEach(test => {
                                handleUpdateLogistics(test.result_id, status, label);
                              });
                              e.target.value = '';
                            }
                          }}
                          className="px-2 py-1.5 text-xs border border-gray-200 rounded-lg bg-white hover:border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none shadow-sm"
                        >
                          <option value="">Update Status...</option>
                          <option value="delivered_to_lab|Received by Lab">✅ Received by Lab</option>
                          <option value="report_awaited|Report Awaited">📋 Report Awaited</option>
                        </select>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};

export default OutsourcedTestsQueue;
