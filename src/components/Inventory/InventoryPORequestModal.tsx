import React, { useMemo, useState } from 'react';
import { AlertCircle, Plus, Trash2, X } from 'lucide-react';
import { database, InventoryItem, InventoryOrderItem } from '../../utils/supabase';

interface DraftLine extends InventoryOrderItem {
  selected: boolean;
}

interface InventoryPORequestModalProps {
  items: InventoryItem[];
  onClose: () => void;
  onSuccess: () => void;
}

const getSuggestedQty = (item: InventoryItem): number => {
  const minStock = Number(item.min_stock || 0);
  const current = Number(item.current_stock || 0);
  if (minStock <= 0) return 1;
  return Math.max((minStock * 2) - current, 1);
};

const InventoryPORequestModal: React.FC<InventoryPORequestModalProps> = ({ items, onClose, onSuccess }) => {
  const lowStockItems = useMemo(() => items.filter(i => i.current_stock <= (i.min_stock || 0)), [items]);

  const [supplierName, setSupplierName] = useState('');
  const [taxAmount, setTaxAmount] = useState<number>(0);
  const [notes, setNotes] = useState('');
  const [aiSuggested, setAiSuggested] = useState(true);
  const [lines, setLines] = useState<DraftLine[]>(
    lowStockItems.slice(0, 25).map(item => ({
      selected: true,
      item_id: item.id,
      name: item.name,
      quantity: getSuggestedQty(item),
      unit: item.unit || 'pcs',
      unit_price: Number(item.unit_price || 0),
    }))
  );

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedLines = lines.filter(line => line.selected && line.name.trim() && Number(line.quantity) > 0);
  const subtotal = selectedLines.reduce((sum, line) => sum + (Number(line.quantity) * Number(line.unit_price || 0)), 0);
  const total = subtotal + Number(taxAmount || 0);

  const updateLine = (index: number, patch: Partial<DraftLine>) => {
    setLines(prev => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  };

  const addManualLine = () => {
    setLines(prev => [
      ...prev,
      {
        selected: true,
        name: '',
        quantity: 1,
        unit: 'pcs',
        unit_price: 0,
      },
    ]);
  };

  const removeLine = (index: number) => {
    setLines(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (selectedLines.length === 0) {
      setError('Select at least one line item for the PO request');
      return;
    }

    setLoading(true);
    try {
      const { error: createError } = await database.inventory.createPurchaseOrder({
        supplier_name: supplierName.trim() || undefined,
        items: selectedLines.map((line) => ({
          item_id: line.item_id,
          name: line.name.trim(),
          quantity: Number(line.quantity),
          unit: line.unit,
          unit_price: Number(line.unit_price || 0),
        })),
        tax_amount: Number(taxAmount || 0),
        notes: notes.trim() || undefined,
        ai_suggested: aiSuggested,
        request_source: aiSuggested ? 'low_stock_reorder' : 'manual',
        status: 'requested',
      });

      if (createError) throw createError;
      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Failed to create PO request');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Create PO Request</h2>
            <p className="text-sm text-gray-500">Basic AI-first purchase request from low stock items</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg">
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 flex items-center gap-2">
              <AlertCircle className="h-5 w-5" />
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm text-gray-600 mb-1">Supplier Name</label>
              <input
                type="text"
                value={supplierName}
                onChange={(e) => setSupplierName(e.target.value)}
                placeholder="Optional"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Tax Amount</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={taxAmount}
                onChange={(e) => setTaxAmount(Number(e.target.value || 0))}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg"
              />
            </div>
            <div className="flex items-end">
              <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={aiSuggested}
                  onChange={(e) => setAiSuggested(e.target.checked)}
                  className="rounded border-gray-300"
                />
                Mark as AI suggested
              </label>
            </div>
          </div>

          <div>
            <label className="block text-sm text-gray-600 mb-1">Notes</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg"
            />
          </div>

          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">Use</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">Item</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500">Qty</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">Unit</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500">Unit Price</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500">Line Total</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {lines.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-sm text-gray-500">No low-stock items found. Add manual line.</td>
                  </tr>
                ) : lines.map((line, index) => (
                  <tr key={index} className="border-b border-gray-100">
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={line.selected}
                        onChange={(e) => updateLine(index, { selected: e.target.checked })}
                        className="rounded border-gray-300"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        value={line.name}
                        onChange={(e) => updateLine(index, { name: e.target.value })}
                        className="w-full px-2 py-1 border border-gray-200 rounded"
                        required={line.selected}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={line.quantity}
                        onChange={(e) => updateLine(index, { quantity: Number(e.target.value || 0) })}
                        className="w-24 ml-auto block px-2 py-1 border border-gray-200 rounded text-right"
                        required={line.selected}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        value={line.unit}
                        onChange={(e) => updateLine(index, { unit: e.target.value })}
                        className="w-24 px-2 py-1 border border-gray-200 rounded"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={line.unit_price || 0}
                        onChange={(e) => updateLine(index, { unit_price: Number(e.target.value || 0) })}
                        className="w-28 ml-auto block px-2 py-1 border border-gray-200 rounded text-right"
                      />
                    </td>
                    <td className="px-3 py-2 text-right text-sm font-medium text-gray-700">
                      {(Number(line.quantity || 0) * Number(line.unit_price || 0)).toFixed(2)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button type="button" onClick={() => removeLine(index)} className="p-1 hover:bg-red-50 rounded">
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button
            type="button"
            onClick={addManualLine}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            <Plus className="h-4 w-4" />
            Add Manual Line
          </button>

          <div className="bg-gray-50 rounded-lg p-4 flex items-center justify-end gap-8">
            <div className="text-sm text-gray-600">Subtotal: <span className="font-semibold text-gray-900">{subtotal.toFixed(2)}</span></div>
            <div className="text-sm text-gray-600">Total: <span className="font-semibold text-gray-900">{total.toFixed(2)}</span></div>
          </div>

          <div className="pt-2 flex justify-end gap-3">
            <button type="button" onClick={onClose} className="px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50">
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? 'Creating...' : 'Create PO Request'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default InventoryPORequestModal;
