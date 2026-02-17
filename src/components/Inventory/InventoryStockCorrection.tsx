import React, { useState } from 'react';
import { database, InventoryItem } from '../../utils/supabase';
import {
  X,
  Save,
  Sliders,
  ArrowUpCircle,
  ArrowDownCircle,
  AlertTriangle,
  Package,
  RefreshCw,
} from 'lucide-react';

interface InventoryStockCorrectionProps {
  item: InventoryItem;
  onClose: () => void;
  onSave: () => void;
}

type CorrectionType = 'adjust' | 'add' | 'remove';

const CORRECTION_REASONS = [
  { value: 'Physical Count', label: 'Physical Count', description: 'Stock adjustment after physical inventory count' },
  { value: 'Damaged', label: 'Damaged', description: 'Items damaged and cannot be used' },
  { value: 'Expired', label: 'Expired', description: 'Items past expiry date' },
  { value: 'Lost/Missing', label: 'Lost/Missing', description: 'Items unaccounted for' },
  { value: 'Found', label: 'Found', description: 'Previously missing items located' },
  { value: 'QC Consumption', label: 'QC Consumption', description: 'Used for quality control' },
  { value: 'Spillage/Wastage', label: 'Spillage/Wastage', description: 'Items wasted due to spillage or accident' },
  { value: 'Transfer Out', label: 'Transfer Out', description: 'Items transferred to another location' },
  { value: 'Transfer In', label: 'Transfer In', description: 'Items received from another location' },
  { value: 'Other', label: 'Other', description: 'Custom reason' },
];

const InventoryStockCorrection: React.FC<InventoryStockCorrectionProps> = ({
  item,
  onClose,
  onSave,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [correctionType, setCorrectionType] = useState<CorrectionType>('adjust');
  const [quantity, setQuantity] = useState<number>(item.current_stock);
  const [reason, setReason] = useState('Physical Count');
  const [customReason, setCustomReason] = useState('');
  const [notes, setNotes] = useState('');

  // Calculate the difference
  const calculateDifference = () => {
    switch (correctionType) {
      case 'adjust':
        return quantity - item.current_stock;
      case 'add':
        return quantity;
      case 'remove':
        return -quantity;
      default:
        return 0;
    }
  };

  const calculateNewStock = () => {
    switch (correctionType) {
      case 'adjust':
        return quantity;
      case 'add':
        return item.current_stock + quantity;
      case 'remove':
        return Math.max(0, item.current_stock - quantity);
      default:
        return item.current_stock;
    }
  };

  const difference = calculateDifference();
  const newStock = calculateNewStock();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const finalReason = reason === 'Other' ? customReason : reason;

      if (!finalReason.trim()) {
        throw new Error('Please provide a reason for this correction');
      }

      if (correctionType === 'remove' && quantity > item.current_stock) {
        throw new Error('Cannot remove more than current stock');
      }

      if (correctionType === 'adjust') {
        // Direct stock adjustment
        await database.inventory.adjustStock({
          itemId: item.id,
          newQuantity: quantity,
          reason: `${finalReason}${notes ? ` - ${notes}` : ''}`,
        });
      } else if (correctionType === 'add') {
        // Add stock
        await database.inventory.addStock({
          itemId: item.id,
          quantity: quantity,
          reason: `${finalReason}${notes ? ` - ${notes}` : ''}`,
        });
      } else {
        // Remove stock
        await database.inventory.consumeStock({
          itemId: item.id,
          quantity: quantity,
          reason: `${finalReason}${notes ? ` - ${notes}` : ''}`,
        });
      }

      onSave();
    } catch (err: any) {
      setError(err.message || 'Failed to save correction');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-start sm:items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[calc(100vh-2rem)] flex flex-col my-auto">
        {/* Header */}
        <div className="border-b border-gray-100 px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 bg-purple-100 rounded-lg">
              <Sliders className="h-5 w-5 text-purple-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Stock Correction</h2>
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
        <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-6 overflow-y-auto">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              {error}
            </div>
          )}

          {/* Current Stock Display */}
          <div className="bg-gray-50 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-3">
              <Package className="h-5 w-5 text-gray-400" />
              <div>
                <p className="text-sm text-gray-500">Current Stock</p>
                <p className="text-xl font-bold text-gray-900">
                  {item.current_stock} {item.unit}
                </p>
              </div>
            </div>
            {item.min_stock > 0 && (
              <div className="text-right">
                <p className="text-xs text-gray-500">Min Stock</p>
                <p className="text-sm font-medium text-gray-600">
                  {item.min_stock} {item.unit}
                </p>
              </div>
            )}
          </div>

          {/* Correction Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Correction Type
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3">
              <button
                type="button"
                onClick={() => {
                  setCorrectionType('adjust');
                  setQuantity(item.current_stock);
                }}
                className={`p-2.5 sm:p-3 rounded-lg border-2 transition-colors ${
                  correctionType === 'adjust'
                    ? 'border-purple-500 bg-purple-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <RefreshCw className={`h-5 w-5 mx-auto ${
                  correctionType === 'adjust' ? 'text-purple-600' : 'text-gray-400'
                }`} />
                <p className={`text-sm mt-1 font-medium ${
                  correctionType === 'adjust' ? 'text-purple-700' : 'text-gray-600'
                }`}>
                  Set To
                </p>
              </button>

              <button
                type="button"
                onClick={() => {
                  setCorrectionType('add');
                  setQuantity(0);
                }}
                className={`p-2.5 sm:p-3 rounded-lg border-2 transition-colors ${
                  correctionType === 'add'
                    ? 'border-green-500 bg-green-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <ArrowUpCircle className={`h-5 w-5 mx-auto ${
                  correctionType === 'add' ? 'text-green-600' : 'text-gray-400'
                }`} />
                <p className={`text-sm mt-1 font-medium ${
                  correctionType === 'add' ? 'text-green-700' : 'text-gray-600'
                }`}>
                  Add
                </p>
              </button>

              <button
                type="button"
                onClick={() => {
                  setCorrectionType('remove');
                  setQuantity(0);
                }}
                className={`p-2.5 sm:p-3 rounded-lg border-2 transition-colors ${
                  correctionType === 'remove'
                    ? 'border-red-500 bg-red-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <ArrowDownCircle className={`h-5 w-5 mx-auto ${
                  correctionType === 'remove' ? 'text-red-600' : 'text-gray-400'
                }`} />
                <p className={`text-sm mt-1 font-medium ${
                  correctionType === 'remove' ? 'text-red-700' : 'text-gray-600'
                }`}>
                  Remove
                </p>
              </button>
            </div>
          </div>

          {/* Quantity Input */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {correctionType === 'adjust' ? 'New Stock Quantity' :
               correctionType === 'add' ? 'Quantity to Add' :
               'Quantity to Remove'} *
            </label>
            <div className="relative">
              <input
                type="number"
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value))}
                required
                min="0"
                max={correctionType === 'remove' ? item.current_stock : undefined}
                step="0.01"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 text-lg font-semibold"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">
                {item.unit}
              </span>
            </div>
          </div>

          {/* Preview */}
          {(difference !== 0 || correctionType === 'adjust') && (
            <div className={`rounded-lg p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 ${
              difference > 0 ? 'bg-green-50 border border-green-200' :
              difference < 0 ? 'bg-red-50 border border-red-200' :
              'bg-gray-50 border border-gray-200'
            }`}>
              <div>
                <p className="text-sm text-gray-600">After Correction</p>
                <p className="text-xl font-bold">
                  {newStock} {item.unit}
                </p>
              </div>
              <div className={`text-right ${
                difference > 0 ? 'text-green-600' :
                difference < 0 ? 'text-red-600' :
                'text-gray-600'
              }`}>
                <p className="text-sm">Change</p>
                <p className="text-lg font-semibold">
                  {difference > 0 ? '+' : ''}{difference} {item.unit}
                </p>
              </div>
            </div>
          )}

          {/* Reason Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Reason *
            </label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
              className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
            >
              {CORRECTION_REASONS.map(r => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
            {reason && reason !== 'Other' && (
              <p className="text-xs text-gray-500 mt-1">
                {CORRECTION_REASONS.find(r => r.value === reason)?.description}
              </p>
            )}
          </div>

          {/* Custom Reason */}
          {reason === 'Other' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Custom Reason *
              </label>
              <input
                type="text"
                value={customReason}
                onChange={(e) => setCustomReason(e.target.value)}
                required
                className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                placeholder="Enter reason for correction"
              />
            </div>
          )}

          {/* Additional Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Additional Notes
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
              placeholder="Optional details about this correction..."
            />
          </div>

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
              disabled={loading || (difference === 0 && correctionType !== 'adjust')}
              className="inline-flex items-center justify-center w-full sm:w-auto px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50"
            >
              <Save className="h-4 w-4 mr-2" />
              {loading ? 'Saving...' : 'Save Correction'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default InventoryStockCorrection;
