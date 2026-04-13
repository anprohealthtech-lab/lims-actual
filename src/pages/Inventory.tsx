import React, { useState, useEffect, useCallback } from 'react';
import { database, InventoryItem, StockAlert, InventoryDashboardStats, InventoryOrder } from '../utils/supabase';
import {
  Package,
  AlertTriangle,
  TrendingDown,
  Calendar,
  Plus,
  Upload,
  RefreshCw,
  Search,
  Filter,
  FileText,
  BarChart3,
  Settings,
  X,
  Check,
  Edit2,
  Trash2,
  History,
  ArrowUpCircle,
  ArrowDownCircle,
  Sliders,
  Wand2,
  Mic,
  TestTube2,
} from 'lucide-react';

// Import sub-components
import InventoryItemForm from '../components/Inventory/InventoryItemForm';
import InventoryPdfUpload from '../components/Inventory/InventoryPdfUpload';
import InventoryStockCorrection from '../components/Inventory/InventoryStockCorrection';
import InventoryTransactionHistory from '../components/Inventory/InventoryTransactionHistory';
import InventoryMappingWizard from '../components/Inventory/InventoryMappingWizard';
import InventoryVoiceInput from '../components/Inventory/InventoryVoiceInput';
import InventoryPORequestModal from '../components/Inventory/InventoryPORequestModal';
import InventoryPOProcessModal from '../components/Inventory/InventoryPOProcessModal';
import InventoryConsumeForTest from '../components/Inventory/InventoryConsumeForTest';

const getConsumptionModeMeta = (scope: InventoryItem['consumption_scope']) => {
  switch (scope) {
    case 'per_test':
      return { label: 'Per Test', color: 'bg-indigo-100 text-indigo-700' };
    case 'per_sample':
      return { label: 'Per Sample', color: 'bg-sky-100 text-sky-700' };
    case 'per_order':
      return { label: 'Per Order', color: 'bg-emerald-100 text-emerald-700' };
    case 'qc_only':
      return { label: 'QC Only', color: 'bg-violet-100 text-violet-700' };
    case 'general':
      return { label: 'Tracking Only', color: 'bg-slate-100 text-slate-700' };
    default:
      return { label: 'Manual', color: 'bg-gray-100 text-gray-700' };
  }
};

const consumptionFilterOptions: Array<{
  value: 'all' | InventoryItem['consumption_scope'];
  label: string;
}> = [
  { value: 'all', label: 'All Consumption Modes' },
  { value: 'manual', label: 'Manual' },
  { value: 'per_order', label: 'Per Order' },
  { value: 'per_sample', label: 'Per Sample' },
  { value: 'per_test', label: 'Per Test' },
  { value: 'qc_only', label: 'QC Only' },
  { value: 'general', label: 'Tracking Only' },
];

const Inventory: React.FC = () => {
  // State
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [alerts, setAlerts] = useState<StockAlert[]>([]);
  const [stats, setStats] = useState<InventoryDashboardStats | null>(null);
  const [purchaseOrders, setPurchaseOrders] = useState<InventoryOrder[]>([]);
  const [consumptionSummary, setConsumptionSummary] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterConsumption, setFilterConsumption] = useState<'all' | InventoryItem['consumption_scope']>('all');
  const [locations, setLocations] = useState<Array<{ id: string; name: string }>>([]);
  const [locationFilter, setLocationFilter] = useState<string>('all');

  // Modal states
  const [showItemForm, setShowItemForm] = useState(false);
  const [showPdfUpload, setShowPdfUpload] = useState(false);
  const [showStockCorrection, setShowStockCorrection] = useState(false);
  const [showTransactionHistory, setShowTransactionHistory] = useState(false);
  const [showMappingWizard, setShowMappingWizard] = useState(false);
  const [showVoiceInput, setShowVoiceInput] = useState(false);
  const [showPORequest, setShowPORequest] = useState(false);
  const [showConsumeForTest, setShowConsumeForTest] = useState(false);
  const [selectedPO, setSelectedPO] = useState<InventoryOrder | null>(null);
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [labId, setLabId] = useState<string | null>(null);

  // Load data
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      // Get lab ID
      const currentLabId = await database.getCurrentUserLabId();
      if (currentLabId) setLabId(currentLabId);

      const locationId = locationFilter === 'all' ? undefined : locationFilter;

      const [itemsRes, alertsRes, statsRes, poRes, consumptionRes] = await Promise.all([
        database.inventory.getItemsWithStats({ locationId }),
        database.inventory.getAlerts({ status: 'active', locationId }),
        database.inventory.getDashboardStats({ locationId }),
        database.inventory.getPurchaseOrders({ limit: 10 }),
        database.inventory.getConsumptionSummary(30),
      ]);

      if (itemsRes.data) setItems(itemsRes.data);
      if (alertsRes.data) setAlerts(alertsRes.data);
      if (statsRes.data) setStats(statsRes.data);
      if (poRes.data) setPurchaseOrders(poRes.data);
      if (consumptionRes.data) setConsumptionSummary(consumptionRes.data);

      const { data: locationData } = await database.locations.getAll();
      if (locationData) {
        setLocations(locationData.map((loc: any) => ({ id: loc.id, name: loc.name })));
      }
    } catch (error) {
      console.error('Error loading inventory data:', error);
    } finally {
      setLoading(false);
    }
  }, [locationFilter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Filter items
  const filteredItems = items.filter(item => {
    // Search filter
    if (searchTerm) {
      const search = searchTerm.toLowerCase();
      if (!item.name.toLowerCase().includes(search) &&
          !item.code?.toLowerCase().includes(search)) {
        return false;
      }
    }

    // Type filter
    if (filterType !== 'all' && item.type !== filterType) {
      return false;
    }

    if (filterConsumption !== 'all' && item.consumption_scope !== filterConsumption) {
      return false;
    }

    // Status filter
    if (filterStatus === 'low' && item.current_stock > item.min_stock) {
      return false;
    }
    if (filterStatus === 'out' && item.current_stock > 0) {
      return false;
    }
    if (filterStatus === 'expiring') {
      if (!item.expiry_date) return false;
      const daysToExpiry = Math.ceil((new Date(item.expiry_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      if (daysToExpiry > 30 || daysToExpiry < 0) return false;
    }

    return true;
  });

  const consumptionCounts = items.reduce<Record<string, number>>((acc, item) => {
    acc[item.consumption_scope] = (acc[item.consumption_scope] || 0) + 1;
    return acc;
  }, {});

  // Handle actions
  const handleAddItem = () => {
    setSelectedItem(null);
    setShowItemForm(true);
  };

  const handleEditItem = (item: InventoryItem) => {
    setSelectedItem(item);
    setShowItemForm(true);
  };

  const handleStockCorrection = (item: InventoryItem) => {
    setSelectedItem(item);
    setShowStockCorrection(true);
  };

  const handleConsumeForTest = (item: InventoryItem) => {
    setSelectedItem(item);
    setShowConsumeForTest(true);
  };

  const handleViewHistory = (item: InventoryItem) => {
    setSelectedItem(item);
    setShowTransactionHistory(true);
  };

  const handleDismissAlert = async (alertId: string) => {
    const { error } = await database.inventory.dismissAlert(alertId);
    if (!error) {
      setAlerts(alerts.filter(a => a.id !== alertId));
    }
  };

  const handleDeleteItem = async (itemId: string) => {
    if (!confirm('Are you sure you want to delete this item?')) return;

    const { error } = await database.inventory.deleteItem(itemId);
    if (!error) {
      setItems(items.filter(i => i.id !== itemId));
    }
  };

  // Get stock status styling
  const getStockStatus = (item: InventoryItem) => {
    if (item.current_stock <= 0) {
      return { label: 'Out of Stock', color: 'bg-red-100 text-red-800' };
    }
    if (item.current_stock <= item.min_stock) {
      return { label: 'Low Stock', color: 'bg-yellow-100 text-yellow-800' };
    }
    return { label: 'In Stock', color: 'bg-green-100 text-green-800' };
  };

  // Get expiry status styling
  const getExpiryStatus = (item: InventoryItem) => {
    if (!item.expiry_date) return null;
    const daysToExpiry = Math.ceil((new Date(item.expiry_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24));

    if (daysToExpiry < 0) {
      return { label: 'Expired', color: 'bg-red-100 text-red-800' };
    }
    if (daysToExpiry <= 30) {
      return { label: `${daysToExpiry}d to expiry`, color: 'bg-orange-100 text-orange-800' };
    }
    return null;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <RefreshCw className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Inventory Management</h1>
          <p className="text-gray-500 mt-1">AI-powered inventory tracking and consumption</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setShowVoiceInput(true)}
            className="inline-flex items-center px-4 py-2 bg-gradient-to-r from-pink-500 to-rose-500 text-white rounded-lg hover:from-pink-600 hover:to-rose-600 transition-colors"
          >
            <Mic className="h-4 w-4 mr-2" />
            Voice
          </button>
          <button
            onClick={() => setShowMappingWizard(true)}
            className="inline-flex items-center px-4 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-lg hover:from-indigo-700 hover:to-purple-700 transition-colors"
          >
            <Wand2 className="h-4 w-4 mr-2" />
            AI Mapping
          </button>
          <button
            onClick={() => setShowPdfUpload(true)}
            className="inline-flex items-center px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
          >
            <Upload className="h-4 w-4 mr-2" />
            PDF Import
          </button>
          <button
            onClick={() => setShowPORequest(true)}
            className="inline-flex items-center px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
          >
            <FileText className="h-4 w-4 mr-2" />
            Create PO
          </button>
          <button
            onClick={handleAddItem}
            className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Item
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <Package className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Total Items</p>
              <p className="text-xl font-bold text-gray-900">{stats?.total_items || 0}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-yellow-100 rounded-lg">
              <TrendingDown className="h-5 w-5 text-yellow-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Low Stock</p>
              <p className="text-xl font-bold text-yellow-600">{stats?.low_stock_count || 0}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-100 rounded-lg">
              <AlertTriangle className="h-5 w-5 text-red-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Out of Stock</p>
              <p className="text-xl font-bold text-red-600">{stats?.out_of_stock_count || 0}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-orange-100 rounded-lg">
              <Calendar className="h-5 w-5 text-orange-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Expiring Soon</p>
              <p className="text-xl font-bold text-orange-600">{stats?.expiring_soon_count || 0}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-100 rounded-lg">
              <BarChart3 className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Total Value</p>
              <p className="text-xl font-bold text-gray-900">
                {new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(stats?.total_value || 0)}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-100 rounded-lg">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Active Alerts</p>
              <p className="text-xl font-bold text-amber-600">{stats?.active_alerts_count || alerts.length || 0}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Alerts Section */}
      {alerts.length > 0 && (
        <div className="bg-gradient-to-r from-amber-50 to-orange-50 rounded-xl p-4 border border-amber-200">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-amber-800 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              Active Alerts ({alerts.length})
            </h3>
          </div>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {alerts.slice(0, 5).map(alert => (
              <div
                key={alert.id}
                className="flex items-center justify-between bg-white rounded-lg p-3 shadow-sm"
              >
                <div className="flex items-center gap-3">
                  <span className={`px-2 py-1 rounded text-xs font-medium ${
                    alert.type === 'out_of_stock' ? 'bg-red-100 text-red-700' :
                    alert.type === 'low_stock' ? 'bg-yellow-100 text-yellow-700' :
                    alert.type === 'expired' ? 'bg-red-100 text-red-700' :
                    'bg-orange-100 text-orange-700'
                  }`}>
                    {alert.type.replace('_', ' ').toUpperCase()}
                  </span>
                  <span className="text-sm text-gray-700">{alert.message}</span>
                </div>
                <button
                  onClick={() => handleDismissAlert(alert.id)}
                  className="p-1 hover:bg-gray-100 rounded"
                  title="Dismiss"
                >
                  <X className="h-4 w-4 text-gray-500" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

	      {/* Filters */}
	      <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
	        <div className="flex flex-col sm:flex-row gap-4">
          {/* Search */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search items by name or code..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          {/* Location Filter */}
          <select
            value={locationFilter}
            onChange={(e) => setLocationFilter(e.target.value)}
            className="px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="all">All Locations</option>
            {locations.map(loc => (
              <option key={loc.id} value={loc.id}>{loc.name}</option>
            ))}
          </select>

          {/* Type Filter */}
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="all">All Types</option>
            <option value="reagent">Reagents</option>
            <option value="consumable">Consumables</option>
            <option value="calibrator">Calibrators</option>
            <option value="control">Controls</option>
            <option value="general">General</option>
          </select>

          {/* Status Filter */}
	          <select
	            value={filterConsumption}
	            onChange={(e) => setFilterConsumption(e.target.value as 'all' | InventoryItem['consumption_scope'])}
	            className="px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
	          >
	            {consumptionFilterOptions.map((option) => (
	              <option key={option.value} value={option.value}>{option.label}</option>
	            ))}
	          </select>

	          <select
	            value={filterStatus}
	            onChange={(e) => setFilterStatus(e.target.value)}
	            className="px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="all">All Status</option>
            <option value="low">Low Stock</option>
            <option value="out">Out of Stock</option>
            <option value="expiring">Expiring Soon</option>
          </select>

          {/* Refresh */}
          <button
            onClick={loadData}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            title="Refresh"
          >
            <RefreshCw className="h-5 w-5 text-gray-600" />
          </button>
	        </div>
	      </div>

	      <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
	        <div className="flex items-center justify-between gap-3 mb-3">
	          <div>
	            <h3 className="font-semibold text-gray-900">Consumption Setup</h3>
	            <p className="text-sm text-gray-500">Quickly review how items are configured to reduce stock.</p>
	          </div>
	          <span className="text-xs text-gray-500">{filteredItems.length} visible items</span>
	        </div>
	        <div className="flex flex-wrap gap-2">
	          {consumptionFilterOptions.filter((option) => option.value !== 'all').map((option) => {
	            const meta = getConsumptionModeMeta(option.value as InventoryItem['consumption_scope']);
	            const count = consumptionCounts[option.value] || 0;
	            const active = filterConsumption === option.value;

	            return (
	              <button
	                key={option.value}
	                onClick={() => setFilterConsumption(active ? 'all' : option.value as InventoryItem['consumption_scope'])}
	                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors ${
	                  active
	                    ? 'border-blue-300 bg-blue-50 text-blue-700'
	                    : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
	                }`}
	              >
	                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${meta.color}`}>
	                  {meta.label}
	                </span>
	                <span className="font-medium">{count}</span>
	              </button>
	            );
	          })}
	        </div>
	      </div>

      {/* Items Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Item</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Type</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Stock</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Tests Remaining</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Consumption</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Batch / Expiry</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-gray-500">
                    <Package className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                    <p>No inventory items found</p>
                    <button
                      onClick={handleAddItem}
                      className="mt-2 text-blue-600 hover:underline"
                    >
                      Add your first item
                    </button>
                  </td>
                </tr>
              ) : (
                filteredItems.map(item => {
                  const stockStatus = getStockStatus(item);
                  const expiryStatus = getExpiryStatus(item);

                  return (
                    <tr key={item.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div>
                          <p className="font-medium text-gray-900">{item.name}</p>
                          {item.code && (
                            <p className="text-xs text-gray-500">{item.code}</p>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700 capitalize">
                          {item.type}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="font-semibold">{item.current_stock}</span>
                        <span className="text-gray-500 text-sm ml-1">{item.unit}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {item.tests_remaining !== undefined && item.tests_remaining !== null ? (
                          <span className="font-semibold text-blue-600">{item.tests_remaining}</span>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1">
                          <span className={`inline-flex w-fit items-center px-2 py-1 rounded-full text-xs font-medium ${getConsumptionModeMeta(item.consumption_scope).color}`}>
                            {getConsumptionModeMeta(item.consumption_scope).label}
                          </span>
                          {item.consumption_scope !== 'manual' && item.consumption_scope !== 'general' && (
                            <span className="text-xs text-gray-500">
                              {Number(item.consumption_per_use || 0)} / use
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1">
                          <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${stockStatus.color}`}>
                            {stockStatus.label}
                          </span>
                          {expiryStatus && (
                            <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${expiryStatus.color}`}>
                              {expiryStatus.label}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm">
                          {item.batch_number && (
                            <p className="text-gray-700">Batch: {item.batch_number}</p>
                          )}
                          {item.expiry_date && (
                            <p className="text-gray-500">
                              Exp: {new Date(item.expiry_date).toLocaleDateString()}
                            </p>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => handleEditItem(item)}
                            className="p-1.5 hover:bg-blue-100 rounded-lg transition-colors"
                            title="Edit"
                          >
                            <Edit2 className="h-4 w-4 text-blue-600" />
                          </button>
                          <button
                            onClick={() => handleStockCorrection(item)}
                            className="p-1.5 hover:bg-purple-100 rounded-lg transition-colors"
                            title="Stock Correction"
                          >
                            <Sliders className="h-4 w-4 text-purple-600" />
                          </button>
                          <button
                            onClick={() => handleConsumeForTest(item)}
                            className="p-1.5 hover:bg-orange-100 rounded-lg transition-colors"
                            title="Consume for Test"
                          >
                            <TestTube2 className="h-4 w-4 text-orange-600" />
                          </button>
                          <button
                            onClick={() => handleViewHistory(item)}
                            className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
                            title="Transaction History"
                          >
                            <History className="h-4 w-4 text-gray-600" />
                          </button>
                          <button
                            onClick={() => handleDeleteItem(item.id)}
                            className="p-1.5 hover:bg-red-100 rounded-lg transition-colors"
                            title="Delete"
                          >
                            <Trash2 className="h-4 w-4 text-red-600" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* PO Requests */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">Recent PO Requests</h3>
          <span className="text-xs text-gray-500">{purchaseOrders.length} records</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase">PO</th>
                <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase">Supplier</th>
                <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase">Status</th>
                <th className="text-right px-4 py-2 text-xs font-semibold text-gray-500 uppercase">Total</th>
                <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase">Created</th>
                <th className="text-center px-4 py-2 text-xs font-semibold text-gray-500 uppercase">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {purchaseOrders.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-sm text-center text-gray-500">No purchase requests yet</td>
                </tr>
              ) : purchaseOrders.map((po) => (
                <tr key={po.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2 text-sm font-medium text-gray-900">
                    <button
                      onClick={() => setSelectedPO(po)}
                      className="hover:underline text-left"
                      title="Open PO"
                    >
                      {po.order_number || 'Draft'}
                    </button>
                  </td>
                  <td className="px-4 py-2 text-sm text-gray-700">{po.supplier_name || '-'}</td>
                  <td className="px-4 py-2 text-sm">
                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700 capitalize">
                      {po.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-sm text-right text-gray-900">
                    {new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(po.total_amount || 0))}
                  </td>
                  <td className="px-4 py-2 text-sm text-gray-500">{new Date(po.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-2 text-sm text-center">
                    <button
                      onClick={() => setSelectedPO(po)}
                      className="px-2 py-1 text-xs border border-gray-200 rounded hover:bg-gray-50"
                    >
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Consumption Analysis */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">Consumption Analysis (Last 30 Days)</h3>
        </div>
        <div className="p-4">
          {consumptionSummary.length === 0 ? (
            <p className="text-sm text-gray-500">No consumption data yet</p>
          ) : (
            <div className="space-y-2">
              {consumptionSummary
                .slice()
                .sort((a, b) => Number(b.consumption_30_days || 0) - Number(a.consumption_30_days || 0))
                .slice(0, 8)
                .map((row) => (
                  <div key={row.item_id} className="flex items-center justify-between text-sm">
                    <div className="text-gray-800">{row.name}</div>
                    <div className="font-medium text-gray-900">
                      {Number(row.consumption_30_days || 0)} {row.unit}
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      {showItemForm && (
        <InventoryItemForm
          item={selectedItem}
          locationId={locationFilter === 'all' ? undefined : locationFilter}
          onClose={() => {
            setShowItemForm(false);
            setSelectedItem(null);
          }}
          onSave={() => {
            setShowItemForm(false);
            setSelectedItem(null);
            loadData();
          }}
        />
      )}

      {showPdfUpload && (
        <InventoryPdfUpload
          locationId={locationFilter === 'all' ? undefined : locationFilter}
          onClose={() => setShowPdfUpload(false)}
          onSuccess={() => {
            setShowPdfUpload(false);
            loadData();
          }}
        />
      )}

      {showStockCorrection && selectedItem && (
        <InventoryStockCorrection
          item={selectedItem}
          onClose={() => {
            setShowStockCorrection(false);
            setSelectedItem(null);
          }}
          onSave={() => {
            setShowStockCorrection(false);
            setSelectedItem(null);
            loadData();
          }}
        />
      )}

      {showConsumeForTest && selectedItem && (
        <InventoryConsumeForTest
          item={selectedItem}
          onClose={() => {
            setShowConsumeForTest(false);
            setSelectedItem(null);
          }}
          onSave={() => {
            setShowConsumeForTest(false);
            setSelectedItem(null);
            loadData();
          }}
        />
      )}

      {showTransactionHistory && selectedItem && (
        <InventoryTransactionHistory
          item={selectedItem}
          onClose={() => {
            setShowTransactionHistory(false);
            setSelectedItem(null);
          }}
        />
      )}

      {showMappingWizard && labId && (
        <InventoryMappingWizard
          labId={labId}
          onClose={() => setShowMappingWizard(false)}
          onComplete={() => {
            setShowMappingWizard(false);
            loadData();
          }}
        />
      )}

      {showVoiceInput && labId && (
        <InventoryVoiceInput
          labId={labId}
          items={items}
          locationId={locationFilter === 'all' ? undefined : locationFilter}
          onClose={() => setShowVoiceInput(false)}
          onSuccess={() => {
            setShowVoiceInput(false);
            loadData();
          }}
        />
      )}

      {showPORequest && (
        <InventoryPORequestModal
          items={items}
          onClose={() => setShowPORequest(false)}
          onSuccess={() => {
            setShowPORequest(false);
            loadData();
          }}
        />
      )}

      {selectedPO && (
        <InventoryPOProcessModal
          po={selectedPO}
          locationId={locationFilter === 'all' ? undefined : locationFilter}
          onClose={() => setSelectedPO(null)}
          onUpdated={() => {
            setSelectedPO(null);
            loadData();
          }}
        />
      )}
    </div>
  );
};

export default Inventory;
