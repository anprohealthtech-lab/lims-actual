import React, { useState, useEffect } from 'react';
import { X, AlertCircle, DollarSign, CreditCard, Wallet, Banknote, Building2 } from 'lucide-react';
import { database } from '../../utils/supabase';
import type { RefundMethod, RefundReasonCategory, RefundedItem } from '../../types';
import { useEscapeModalClose } from '../../hooks/useEscapeModalClose';

interface InvoiceItem {
  id?: string;
  test_name: string;
  price: number;
  quantity?: number;
  total?: number;
}

interface RefundRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  invoiceId: string;
  invoiceTotal: number;
  amountPaid: number;
  totalRefunded: number;
  patientName?: string;
  invoiceItems?: InvoiceItem[];
  onSuccess?: () => void;
}

const REFUND_METHODS: { value: RefundMethod; label: string; icon: React.ReactNode }[] = [
  { value: 'cash', label: 'Cash', icon: <Banknote className="h-4 w-4" /> },
  { value: 'card', label: 'Card', icon: <CreditCard className="h-4 w-4" /> },
  { value: 'upi', label: 'UPI', icon: <Wallet className="h-4 w-4" /> },
  { value: 'bank_transfer', label: 'Bank Transfer', icon: <Building2 className="h-4 w-4" /> },
  { value: 'cheque', label: 'Cheque', icon: <DollarSign className="h-4 w-4" /> },
  { value: 'credit_adjustment', label: 'Credit Adjustment', icon: <DollarSign className="h-4 w-4" /> },
];

const REASON_CATEGORIES: { value: RefundReasonCategory; label: string }[] = [
  { value: 'test_cancelled', label: 'Test Cancelled' },
  { value: 'duplicate_billing', label: 'Duplicate Billing' },
  { value: 'patient_request', label: 'Patient Request' },
  { value: 'price_correction', label: 'Price Correction' },
  { value: 'insurance_adjustment', label: 'Insurance Adjustment' },
  { value: 'error_correction', label: 'Error Correction' },
  { value: 'other', label: 'Other' },
];

const RefundRequestModal: React.FC<RefundRequestModalProps> = ({
  isOpen,
  onClose,
  invoiceId,
  invoiceTotal,
  amountPaid,
  totalRefunded,
  patientName,
  invoiceItems = [],
  onSuccess,
}) => {
  useEscapeModalClose(onClose, isOpen);
  const maxRefundable = amountPaid - totalRefunded;
  
  const [formData, setFormData] = useState({
    refundAmount: '',
    refundMethod: 'cash' as RefundMethod,
    reasonCategory: '' as RefundReasonCategory | '',
    reasonDetails: '',
  });
  const [selectedItems, setSelectedItems] = useState<Map<string, RefundedItem>>(new Map());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refundType, setRefundType] = useState<'full' | 'partial' | 'items'>('partial');

  useEffect(() => {
    if (isOpen) {
      setFormData({
        refundAmount: '',
        refundMethod: 'cash',
        reasonCategory: '',
        reasonDetails: '',
      });
      setSelectedItems(new Map());
      setError(null);
      setRefundType('partial');
    }
  }, [isOpen]);

  // Calculate refund amount based on selected items
  useEffect(() => {
    if (refundType === 'items') {
      const itemsTotal = Array.from(selectedItems.values()).reduce((sum, item) => sum + item.amount, 0);
      setFormData(prev => ({ ...prev, refundAmount: itemsTotal.toString() }));
    } else if (refundType === 'full') {
      setFormData(prev => ({ ...prev, refundAmount: maxRefundable.toString() }));
    }
  }, [refundType, selectedItems, maxRefundable]);

  const handleItemSelect = (item: InvoiceItem, selected: boolean) => {
    const newSelectedItems = new Map(selectedItems);
    const itemKey = item.id || item.test_name;
    
    if (selected) {
      newSelectedItems.set(itemKey, {
        item_id: item.id,
        test_name: item.test_name,
        amount: item.price * (item.quantity || 1),
      });
    } else {
      newSelectedItems.delete(itemKey);
    }
    
    setSelectedItems(newSelectedItems);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    
    const refundAmount = parseFloat(formData.refundAmount);
    
    if (isNaN(refundAmount) || refundAmount <= 0) {
      setError('Please enter a valid refund amount');
      return;
    }
    
    if (refundAmount > maxRefundable) {
      setError(`Refund amount cannot exceed maximum refundable amount (₹${maxRefundable.toFixed(2)})`);
      return;
    }
    
    if (!formData.reasonCategory) {
      setError('Please select a reason for the refund');
      return;
    }
    
    setIsSubmitting(true);
    
    try {
      const refundedItems = Array.from(selectedItems.values());
      
      const { data, error: apiError } = await database.refundRequests.create({
        invoice_id: invoiceId,
        refund_amount: refundAmount,
        refund_method: formData.refundMethod,
        reason_category: formData.reasonCategory || undefined,
        reason_details: formData.reasonDetails || undefined,
        refunded_items: refundedItems.length > 0 ? refundedItems : undefined,
      });
      
      if (apiError) {
        throw apiError;
      }
      
      // Check if the RPC returned success
      if (data && typeof data === 'object' && 'success' in data) {
        if (!data.success) {
          throw new Error(data.error || 'Failed to create refund request');
        }
      }
      
      onSuccess?.();
      onClose();
    } catch (err: any) {
      console.error('Error creating refund request:', err);
      setError(err.message || 'Failed to create refund request');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-75 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Request Refund</h2>
            {patientName && (
              <p className="text-sm text-gray-600 mt-1">Patient: {patientName}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-500 p-1 rounded"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Invoice Summary */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <div className="text-blue-600 font-medium">Invoice Total</div>
                <div className="text-blue-900 font-semibold">₹{invoiceTotal.toFixed(2)}</div>
              </div>
              <div>
                <div className="text-blue-600 font-medium">Amount Paid</div>
                <div className="text-blue-900 font-semibold">₹{amountPaid.toFixed(2)}</div>
              </div>
              <div>
                <div className="text-blue-600 font-medium">Already Refunded</div>
                <div className="text-orange-600 font-semibold">₹{totalRefunded.toFixed(2)}</div>
              </div>
              <div>
                <div className="text-blue-600 font-medium">Max Refundable</div>
                <div className="text-green-600 font-semibold">₹{maxRefundable.toFixed(2)}</div>
              </div>
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-red-500 mt-0.5 flex-shrink-0" />
              <div className="text-red-700 text-sm">{error}</div>
            </div>
          )}

          {/* Refund Type Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Refund Type</label>
            <div className="grid grid-cols-3 gap-3">
              <button
                type="button"
                onClick={() => setRefundType('partial')}
                className={`px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
                  refundType === 'partial'
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}
              >
                Partial Amount
              </button>
              <button
                type="button"
                onClick={() => setRefundType('full')}
                className={`px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
                  refundType === 'full'
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}
              >
                Full Refund
              </button>
              {invoiceItems.length > 0 && (
                <button
                  type="button"
                  onClick={() => setRefundType('items')}
                  className={`px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
                    refundType === 'items'
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  Select Items
                </button>
              )}
            </div>
          </div>

          {/* Item Selection (if refund type is items) */}
          {refundType === 'items' && invoiceItems.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Select Items to Refund
              </label>
              <div className="border border-gray-200 rounded-lg divide-y divide-gray-200">
                {invoiceItems.map((item, index) => {
                  const itemKey = item.id || item.test_name;
                  const isSelected = selectedItems.has(itemKey);
                  const itemTotal = item.price * (item.quantity || 1);
                  
                  return (
                    <label
                      key={index}
                      className={`flex items-center justify-between p-3 cursor-pointer hover:bg-gray-50 ${
                        isSelected ? 'bg-blue-50' : ''
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(e) => handleItemSelect(item, e.target.checked)}
                          className="h-4 w-4 text-blue-600 rounded border-gray-300"
                        />
                        <span className="text-sm font-medium text-gray-900">{item.test_name}</span>
                      </div>
                      <span className="text-sm font-medium text-gray-600">₹{itemTotal.toFixed(2)}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {/* Refund Amount */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Refund Amount *
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                <span className="text-gray-400 text-sm font-medium">₹</span>
              </div>
              <input
                type="number"
                required
                min="0.01"
                step="0.01"
                max={maxRefundable}
                value={formData.refundAmount}
                onChange={(e) => {
                  if (refundType === 'partial') {
                    setFormData(prev => ({ ...prev, refundAmount: e.target.value }));
                  }
                }}
                disabled={refundType !== 'partial'}
                className={`block w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                  refundType !== 'partial' ? 'bg-gray-50' : ''
                }`}
                placeholder="0.00"
              />
            </div>
          </div>

          {/* Refund Method */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Refund Method *
            </label>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {REFUND_METHODS.map(method => (
                <button
                  key={method.value}
                  type="button"
                  onClick={() => setFormData(prev => ({ ...prev, refundMethod: method.value }))}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                    formData.refundMethod === method.value
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {method.icon}
                  {method.label}
                </button>
              ))}
            </div>
          </div>

          {/* Reason Category */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Reason for Refund *
            </label>
            <select
              required
              value={formData.reasonCategory}
              onChange={(e) => setFormData(prev => ({ ...prev, reasonCategory: e.target.value as RefundReasonCategory }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">Select a reason...</option>
              {REASON_CATEGORIES.map(reason => (
                <option key={reason.value} value={reason.value}>{reason.label}</option>
              ))}
            </select>
          </div>

          {/* Reason Details */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Additional Details
            </label>
            <textarea
              value={formData.reasonDetails}
              onChange={(e) => setFormData(prev => ({ ...prev, reasonDetails: e.target.value }))}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Provide any additional details about the refund..."
            />
          </div>

          {/* Info Box */}
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-amber-500 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-amber-700">
                <p className="font-medium">Refund requires approval</p>
                <p className="mt-1">This refund request will be sent for approval by a lab admin before it can be processed.</p>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end space-x-4 pt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !formData.refundAmount || parseFloat(formData.refundAmount) <= 0}
              className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                  <span>Submitting...</span>
                </>
              ) : (
                <>
                  <DollarSign className="h-4 w-4" />
                  <span>Submit Request</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default RefundRequestModal;
