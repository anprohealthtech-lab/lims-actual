import React, { useState, useEffect } from 'react';
import { database, supabase, InventoryItem } from '../../utils/supabase';
import {
  X,
  Save,
  TestTube2,
  AlertTriangle,
  Package,
  Search,
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

const InventoryConsumeForTest: React.FC<InventoryConsumeForTestProps> = ({
  item,
  onClose,
  onSave,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orders, setOrders] = useState<RecentOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [selectedTestGroupId, setSelectedTestGroupId] = useState('');
  const [quantity, setQuantity] = useState<number>(1); // Always in "uses" (items/tests)
  const [mappedQuantity, setMappedQuantity] = useState<number | null>(null);
  const [orderSearch, setOrderSearch] = useState('');

  // Unit conversion helpers
  const packContains = item.pack_contains && item.pack_contains > 0 ? item.pack_contains : null;
  // Convert uses → native unit (e.g., 1 use from a box of 100 = 0.01 box)
  const nativeQuantity = packContains ? quantity / packContains : quantity;
  // Max uses available (e.g., 2 boxes × 100 per box = 200 uses)
  const maxUses = packContains ? item.current_stock * packContains : item.current_stock;
  const useLabel = packContains ? (item.consumption_per_use ? 'uses' : 'items') : item.unit;

  // Fetch recent orders (last 7 days)
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

  // When test group is selected, check for mapped quantity
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
      if (!selectedOrderId) {
        throw new Error('Please select an order');
      }

      if (!selectedTestGroupId) {
        throw new Error('Please select a test');
      }

      if (quantity <= 0) {
        throw new Error('Quantity must be greater than 0');
      }

      if (quantity > maxUses) {
        throw new Error(`Cannot consume more than available stock (${maxUses} ${useLabel})`);
      }

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
              <h2 className="text-lg font-semibold text-gray-900">Consume for Test</h2>
              <p className="text-sm text-gray-500 break-words">{item.name}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        {/* Form */}
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
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Select Order *
            </label>
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
                onChange={(e) => {
                  setSelectedOrderId(e.target.value);
                  setSelectedTestGroupId('');
                }}
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
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Select Test *
              </label>
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
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Quantity to Consume *
            </label>
            <div className="relative">
              <input
                type="number"
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value))}
                required
                min={packContains ? 1 : 0.01}
                max={maxUses}
                step={packContains ? 1 : 0.01}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-lg font-semibold"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">
                {useLabel}
              </span>
            </div>
            {mappedQuantity !== null && (
              <p className="text-xs text-orange-600 mt-1">
                Mapped quantity per test: {mappedQuantity} {useLabel}
              </p>
            )}
            {packContains && quantity > 0 && (
              <p className="text-xs text-gray-500 mt-1">
                = {nativeQuantity.toFixed(4)} {item.unit} deducted from stock
              </p>
            )}
          </div>

          {/* Preview */}
          {quantity > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <p className="text-sm text-gray-600">After Consumption</p>
                <p className="text-xl font-bold text-gray-900">
                  {parseFloat(newStock.toFixed(4))} {item.unit}
                </p>
                {packContains && (
                  <p className="text-xs text-gray-500">
                    {Math.floor(newStock * packContains)} {useLabel} remaining
                  </p>
                )}
              </div>
              <div className="text-right text-red-600">
                <p className="text-sm">Change</p>
                <p className="text-lg font-semibold">-{quantity} {useLabel}</p>
                {packContains && (
                  <p className="text-xs text-red-400">-{parseFloat(nativeQuantity.toFixed(4))} {item.unit}</p>
                )}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 pt-4 border-t border-gray-100">
            <button
              type="button"
              onClick={onClose}
              className="w-full sm:w-auto px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            >
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
      </div>
    </div>
  );
};

export default InventoryConsumeForTest;
