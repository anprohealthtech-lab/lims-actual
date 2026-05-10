import React, { useState, useEffect, useCallback } from 'react';
import { database, supabase, InventoryItem, InventoryTestMapping } from '../../utils/supabase';
import {
  X,
  Save,
  TestTube2,
  AlertTriangle,
  Package,
  Search,
  Link2,
  Trash2,
  Plus,
  CheckCircle2,
} from 'lucide-react';

interface InventoryConsumeForTestProps {
  item: InventoryItem;
  onClose: () => void;
  onSave: () => void;
}

interface RecentOrder {
  id: string;
  order_number: string;
  patient_name: string;
  created_at: string;
  order_tests: Array<{
    id: string;
    test_group_id: string;
    test_name: string;
  }>;
}

interface TestGroup {
  id: string;
  name: string;
  code?: string;
}

type Tab = 'consume' | 'mapping';

const InventoryConsumeForTest: React.FC<InventoryConsumeForTestProps> = ({
  item,
  onClose,
  onSave,
}) => {
  const [activeTab, setActiveTab] = useState<Tab>('consume');

  // ── Consume tab state ──────────────────────────────────────────────────────
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orders, setOrders] = useState<RecentOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [selectedTestGroupId, setSelectedTestGroupId] = useState('');
  const [quantity, setQuantity] = useState<number>(1);
  const [mappedQuantity, setMappedQuantity] = useState<number | null>(null);
  const [orderSearch, setOrderSearch] = useState('');

  // ── Mapping tab state ──────────────────────────────────────────────────────
  const [testGroups, setTestGroups] = useState<TestGroup[]>([]);
  const [testGroupSearch, setTestGroupSearch] = useState('');
  const [existingMappings, setExistingMappings] = useState<InventoryTestMapping[]>([]);
  const [mappingsLoading, setMappingsLoading] = useState(false);
  const [newTestGroupId, setNewTestGroupId] = useState('');
  const [newQuantity, setNewQuantity] = useState<number>(1);
  const [mappingError, setMappingError] = useState<string | null>(null);
  const [mappingSuccess, setMappingSuccess] = useState<string | null>(null);
  const [savingMapping, setSavingMapping] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Unit helpers
  const packContains = item.pack_contains && item.pack_contains > 0 ? item.pack_contains : null;
  const nativeQuantity = packContains ? quantity / packContains : quantity;
  const maxUses = packContains ? item.current_stock * packContains : item.current_stock;
  const useLabel = packContains ? (item.consumption_per_use ? 'uses' : 'items') : item.unit;

  // ── Load recent orders ─────────────────────────────────────────────────────
  useEffect(() => {
    const fetchRecentOrders = async () => {
      setOrdersLoading(true);
      try {
        const labId = await database.getCurrentUserLabId();
        if (!labId) return;

        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

        const { data, error: fetchErr } = await supabase
          .from('orders')
          .select(`
            id,
            order_number,
            patient_name,
            created_at,
            order_tests (
              id,
              test_group_id,
              test_name
            )
          `)
          .eq('lab_id', labId)
          .gte('created_at', sevenDaysAgo)
          .order('created_at', { ascending: false })
          .limit(50);

        if (!fetchErr && data) {
          setOrders(data as RecentOrder[]);
        }
      } catch (err) {
        console.error('Failed to fetch orders:', err);
      } finally {
        setOrdersLoading(false);
      }
    };

    fetchRecentOrders();
  }, []);

  // ── Load existing mapping quantity when test selected in consume tab ────────
  useEffect(() => {
    if (!selectedTestGroupId) {
      setMappedQuantity(null);
      return;
    }

    const fetchMapping = async () => {
      try {
        const labId = await database.getCurrentUserLabId();
        if (!labId) return;

        const { data } = await supabase
          .from('inventory_test_mapping')
          .select('quantity_per_test')
          .eq('item_id', item.id)
          .eq('test_group_id', selectedTestGroupId)
          .eq('lab_id', labId)
          .eq('is_active', true)
          .maybeSingle();

        if (data?.quantity_per_test) {
          setMappedQuantity(data.quantity_per_test);
          setQuantity(data.quantity_per_test);
        } else {
          setMappedQuantity(null);
        }
      } catch (err) {
        console.warn('Failed to fetch mapping:', err);
      }
    };

    fetchMapping();
  }, [selectedTestGroupId, item.id]);

  // ── Load test groups + existing mappings when mapping tab opens ────────────
  const loadMappingData = useCallback(async () => {
    setMappingsLoading(true);
    setMappingError(null);
    try {
      const labId = await database.getCurrentUserLabId();
      if (!labId) return;

      const [{ data: tgs }, { data: mappings }] = await Promise.all([
        supabase
          .from('test_groups')
          .select('id, name, code')
          .eq('lab_id', labId)
          .eq('is_active', true)
          .order('name'),
        supabase
          .from('inventory_test_mapping')
          .select('*, test_group:test_groups(id, name)')
          .eq('item_id', item.id)
          .eq('lab_id', labId)
          .eq('is_active', true)
          .order('created_at', { ascending: false }),
      ]);

      setTestGroups((tgs as TestGroup[]) || []);
      setExistingMappings((mappings as InventoryTestMapping[]) || []);
    } catch (err) {
      setMappingError('Failed to load mapping data');
    } finally {
      setMappingsLoading(false);
    }
  }, [item.id]);

  useEffect(() => {
    if (activeTab === 'mapping') {
      loadMappingData();
    }
  }, [activeTab, loadMappingData]);

  // ── Consume tab handlers ───────────────────────────────────────────────────
  const selectedOrder = orders.find(o => o.id === selectedOrderId);
  const availableTests = selectedOrder?.order_tests || [];
  const filteredOrders = orderSearch.trim()
    ? orders.filter(o =>
        o.order_number?.toLowerCase().includes(orderSearch.toLowerCase()) ||
        o.patient_name?.toLowerCase().includes(orderSearch.toLowerCase())
      )
    : orders;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (!selectedOrderId) throw new Error('Please select an order');
      if (!selectedTestGroupId) throw new Error('Please select a test');
      if (quantity <= 0) throw new Error('Quantity must be greater than 0');
      if (quantity > maxUses) throw new Error(`Cannot consume more than available stock (${maxUses} ${useLabel})`);

      await database.inventory.consumeStock({
        itemId: item.id,
        quantity: nativeQuantity,
        reason: 'Manual test consumption',
        orderId: selectedOrderId,
        testGroupId: selectedTestGroupId,
      });

      onSave();
    } catch (err: any) {
      setError(err.message || 'Failed to record consumption');
    } finally {
      setLoading(false);
    }
  };

  const newStock = Math.max(0, item.current_stock - nativeQuantity);

  // ── Mapping tab handlers ───────────────────────────────────────────────────
  const alreadyMappedIds = new Set(existingMappings.map(m => m.test_group_id).filter(Boolean));

  const filteredTestGroups = testGroupSearch.trim()
    ? testGroups.filter(tg => tg.name.toLowerCase().includes(testGroupSearch.toLowerCase()) || tg.code?.toLowerCase().includes(testGroupSearch.toLowerCase()))
    : testGroups;

  const handleSaveMapping = async () => {
    if (!newTestGroupId) {
      setMappingError('Please select a test group');
      return;
    }
    if (newQuantity <= 0) {
      setMappingError('Quantity must be greater than 0');
      return;
    }

    setSavingMapping(true);
    setMappingError(null);
    setMappingSuccess(null);

    const { error } = await database.inventory.createTestMapping({
      item_id: item.id,
      test_group_id: newTestGroupId,
      quantity_per_test: newQuantity,
      unit: item.unit,
    });

    if (error) {
      setMappingError(error.message || 'Failed to save mapping');
    } else {
      setMappingSuccess('Mapping saved — this item will now auto-consume when this test result is entered.');
      setNewTestGroupId('');
      setNewQuantity(1);
      setTestGroupSearch('');
      loadMappingData();
    }
    setSavingMapping(false);
  };

  const handleDeleteMapping = async (mappingId: string) => {
    setDeletingId(mappingId);
    const { error } = await database.inventory.deleteTestMapping(mappingId);
    if (!error) {
      setExistingMappings(prev => prev.filter(m => m.id !== mappingId));
    }
    setDeletingId(null);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-start sm:items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[calc(100vh-2rem)] flex flex-col my-auto">

        {/* Header */}
        <div className="border-b border-gray-100 px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 bg-orange-100 rounded-lg">
              <TestTube2 className="h-5 w-5 text-orange-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">{item.name}</h2>
              <p className="text-sm text-gray-500">{item.code || item.unit}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100 px-4 sm:px-6">
          <button
            onClick={() => setActiveTab('consume')}
            className={`flex items-center gap-1.5 px-3 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'consume'
                ? 'border-orange-500 text-orange-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <Save className="h-4 w-4" />
            Record Consumption
          </button>
          <button
            onClick={() => setActiveTab('mapping')}
            className={`flex items-center gap-1.5 px-3 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'mapping'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <Link2 className="h-4 w-4" />
            Auto-Consume Setup
            {existingMappings.length > 0 && (
              <span className="ml-1 bg-blue-100 text-blue-700 text-xs px-1.5 py-0.5 rounded-full">
                {existingMappings.length}
              </span>
            )}
          </button>
        </div>

        {/* ── Consume Tab ── */}
        {activeTab === 'consume' && (
          <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-5 overflow-y-auto">
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 flex-shrink-0" />
                {error}
              </div>
            )}

            {/* Current Stock */}
            <div className="bg-gray-50 rounded-lg p-4 flex items-center gap-3">
              <Package className="h-5 w-5 text-gray-400" />
              <div>
                <p className="text-sm text-gray-500">Current Stock</p>
                <p className="text-xl font-bold text-gray-900">
                  {item.current_stock} {item.unit}
                  {packContains && (
                    <span className="text-sm font-normal text-gray-500 ml-2">
                      ({maxUses} {useLabel} available)
                    </span>
                  )}
                </p>
              </div>
            </div>

            {/* Order Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Select Order *</label>
              <div className="relative mb-2">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  value={orderSearch}
                  onChange={(e) => setOrderSearch(e.target.value)}
                  placeholder="Search by order # or patient..."
                  className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-sm"
                />
              </div>
              {ordersLoading ? (
                <p className="text-sm text-gray-500">Loading orders...</p>
              ) : (
                <select
                  value={selectedOrderId}
                  onChange={(e) => { setSelectedOrderId(e.target.value); setSelectedTestGroupId(''); }}
                  required
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                >
                  <option value="">Choose an order...</option>
                  {filteredOrders.map(order => (
                    <option key={order.id} value={order.id}>
                      {order.order_number || order.id.substring(0, 8)} - {order.patient_name} ({new Date(order.created_at).toLocaleDateString()})
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Test Selection */}
            {selectedOrderId && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Select Test *</label>
                <select
                  value={selectedTestGroupId}
                  onChange={(e) => setSelectedTestGroupId(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                >
                  <option value="">Choose a test...</option>
                  {availableTests.map(test => (
                    <option key={test.id} value={test.test_group_id}>
                      {test.test_name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Quantity */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Quantity to Consume *</label>
              <div className="relative">
                <input
                  type="number"
                  value={quantity}
                  onChange={(e) => setQuantity(Number(e.target.value))}
                  required
                  min={packContains ? 1 : 0.01}
                  max={maxUses}
                  step="any"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-lg font-semibold"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">{useLabel}</span>
              </div>
              {mappedQuantity !== null && (
                <p className="text-xs text-orange-600 mt-1">Mapped quantity per test: {mappedQuantity} {useLabel}</p>
              )}
              {packContains && quantity > 0 && (
                <p className="text-xs text-gray-500 mt-1">= {nativeQuantity.toFixed(4)} {item.unit} deducted from stock</p>
              )}
            </div>

            {/* Preview */}
            {quantity > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <p className="text-sm text-gray-600">After Consumption</p>
                  <p className="text-xl font-bold text-gray-900">{parseFloat(newStock.toFixed(4))} {item.unit}</p>
                  {packContains && (
                    <p className="text-xs text-gray-500">{Math.floor(newStock * packContains)} {useLabel} remaining</p>
                  )}
                </div>
                <div className="text-right text-red-600">
                  <p className="text-sm">Change</p>
                  <p className="text-lg font-semibold">-{quantity} {useLabel}</p>
                  {packContains && <p className="text-xs text-red-400">-{parseFloat(nativeQuantity.toFixed(4))} {item.unit}</p>}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 pt-4 border-t border-gray-100">
              <button type="button" onClick={onClose} className="w-full sm:w-auto px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading || !selectedOrderId || !selectedTestGroupId || quantity <= 0}
                className="inline-flex items-center justify-center w-full sm:w-auto px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors disabled:opacity-50"
              >
                <Save className="h-4 w-4 mr-2" />
                {loading ? 'Saving...' : 'Record Consumption'}
              </button>
            </div>
          </form>
        )}

        {/* ── Mapping Tab ── */}
        {activeTab === 'mapping' && (
          <div className="p-4 sm:p-6 space-y-5 overflow-y-auto">

            <p className="text-sm text-gray-500">
              Link this item to a test group so it auto-consumes every time that test result is saved.
            </p>

            {/* Existing mappings */}
            <div>
              <h3 className="text-sm font-medium text-gray-700 mb-2">Active Mappings</h3>
              {mappingsLoading ? (
                <p className="text-sm text-gray-400">Loading...</p>
              ) : existingMappings.length === 0 ? (
                <p className="text-sm text-gray-400 italic">No mappings yet for this item.</p>
              ) : (
                <div className="space-y-2">
                  {existingMappings.map(m => (
                    <div key={m.id} className="flex items-center justify-between bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
                      <div>
                        <p className="text-sm font-medium text-gray-800">
                          {(m.test_group as any)?.name || m.test_group_id}
                        </p>
                        <p className="text-xs text-gray-500">
                          {m.quantity_per_test} {m.unit || item.unit} per test
                          {m.ai_suggested && <span className="ml-2 text-blue-500">· AI suggested</span>}
                        </p>
                      </div>
                      <button
                        onClick={() => handleDeleteMapping(m.id)}
                        disabled={deletingId === m.id}
                        className="p-1.5 hover:bg-red-100 rounded-lg transition-colors disabled:opacity-50"
                        title="Remove mapping"
                      >
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Add new mapping */}
            <div className="border border-gray-200 rounded-lg p-4 space-y-3">
              <h3 className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
                <Plus className="h-4 w-4" />
                Add New Mapping
              </h3>

              {mappingError && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg flex items-center gap-2 text-sm">
                  <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                  {mappingError}
                </div>
              )}

              {mappingSuccess && (
                <div className="bg-green-50 border border-green-200 text-green-700 px-3 py-2 rounded-lg flex items-center gap-2 text-sm">
                  <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                  {mappingSuccess}
                </div>
              )}

              {/* Test group search + select */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Test Group</label>
                <div className="relative mb-1.5">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                  <input
                    type="text"
                    value={testGroupSearch}
                    onChange={(e) => setTestGroupSearch(e.target.value)}
                    placeholder="Search test groups..."
                    className="w-full pl-8 pr-3 py-1.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                  />
                </div>
                <select
                  value={newTestGroupId}
                  onChange={(e) => { setNewTestGroupId(e.target.value); setMappingError(null); setMappingSuccess(null); }}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                >
                  <option value="">Choose a test group...</option>
                  {filteredTestGroups
                    .filter(tg => !alreadyMappedIds.has(tg.id))
                    .map(tg => (
                      <option key={tg.id} value={tg.id}>
                        {tg.name}{tg.code ? ` (${tg.code})` : ''}
                      </option>
                    ))}
                </select>
                {alreadyMappedIds.size > 0 && (
                  <p className="text-xs text-gray-400 mt-1">Already-mapped tests are hidden above.</p>
                )}
              </div>

              {/* Quantity */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Quantity per test ({item.unit})
                </label>
                <input
                  type="number"
                  value={newQuantity}
                  onChange={(e) => setNewQuantity(Number(e.target.value))}
                  min={0}
                  step="any"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                />
                {packContains && newQuantity > 0 && (
                  <p className="text-xs text-gray-500 mt-1">
                    = {(newQuantity / packContains).toFixed(6)} {item.unit} deducted per test
                  </p>
                )}
              </div>

              <button
                onClick={handleSaveMapping}
                disabled={savingMapping || !newTestGroupId || newQuantity <= 0}
                className="inline-flex items-center justify-center w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 text-sm font-medium"
              >
                <Link2 className="h-4 w-4 mr-2" />
                {savingMapping ? 'Saving...' : 'Save Auto-Consume Mapping'}
              </button>
            </div>

            <div className="flex justify-end pt-2 border-t border-gray-100">
              <button onClick={onClose} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors text-sm">
                Close
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};

export default InventoryConsumeForTest;
