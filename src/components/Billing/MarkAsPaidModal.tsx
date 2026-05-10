import React, { useState } from 'react';
import { X, CreditCard, FileText, Calendar } from 'lucide-react';
import { useEscapeModalClose } from '../../hooks/useEscapeModalClose';

interface MarkAsPaidModalProps {
  isOpen: boolean;
  onClose: () => void;
  invoiceId: string;
  invoiceTotal: number;
  paidAmount: number;
  onSubmit: (invoiceId: string, paymentMethod: string, amount: number, reference: string) => Promise<void>;
}

const MarkAsPaidModal: React.FC<MarkAsPaidModalProps> = ({
  isOpen,
  onClose,
  invoiceId,
  invoiceTotal,
  paidAmount,
  onSubmit
}) => {
  useEscapeModalClose(onClose, isOpen);
  const remainingAmount = invoiceTotal - paidAmount;

  const [formData, setFormData] = useState({
    paymentMethod: 'Cash',
    amount: remainingAmount,
    reference: '',
    isSubmitting: false,
    error: ''
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;

    if (name === 'amount') {
      const numValue = parseFloat(value);
      if (isNaN(numValue) || numValue <= 0) {
        setFormData(prev => ({
          ...prev,
          [name]: value,
          error: 'Amount must be greater than zero'
        }));
        return;
      }

      if (numValue > remainingAmount) {
        setFormData(prev => ({
          ...prev,
          [name]: remainingAmount,
          error: `Amount cannot exceed remaining balance of ₹${remainingAmount}`
        }));
        return;
      }

      setFormData(prev => ({
        ...prev,
        [name]: numValue,
        error: ''
      }));
    } else {
      setFormData(prev => ({
        ...prev,
        [name]: value
      }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (formData.amount <= 0) {
      setFormData(prev => ({
        ...prev,
        error: 'Amount must be greater than zero'
      }));
      return;
    }

    setFormData(prev => ({
      ...prev,
      isSubmitting: true,
      error: ''
    }));

    try {
      await onSubmit(invoiceId, formData.paymentMethod, formData.amount, formData.reference);
      onClose();
    } catch (error) {
      setFormData(prev => ({
        ...prev,
        isSubmitting: false,
        error: 'Failed to process payment. Please try again.'
      }));
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-75 flex items-center justify-center z-50 px-4 py-8 overflow-y-auto">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">Record Payment</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-500 p-1 rounded"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {formData.error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <div className="text-red-700 text-sm">{formData.error}</div>
            </div>
          )}

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <div className="text-blue-600 font-medium">Invoice Total</div>
                <div className="text-blue-900 font-semibold">₹{invoiceTotal.toFixed(2)}</div>
              </div>
              <div>
                <div className="text-blue-600 font-medium">Amount Paid</div>
                <div className="text-blue-900 font-semibold">₹{paidAmount.toFixed(2)}</div>
              </div>
              <div className="col-span-2">
                <div className="text-blue-600 font-medium">Remaining Balance</div>
                <div className="text-blue-900 font-semibold">₹{remainingAmount.toFixed(2)}</div>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Payment Method *
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                  <CreditCard className="h-5 w-5 text-gray-400" />
                </div>
                <select
                  name="paymentMethod"
                  required
                  value={formData.paymentMethod}
                  onChange={handleChange}
                  className="block w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="Cash">Cash</option>
                  <option value="Credit Card">Credit Card</option>
                  <option value="Debit Card">Debit Card</option>
                  <option value="UPI">UPI</option>
                  <option value="Bank Transfer">Bank Transfer</option>
                  <option value="Cheque">Cheque</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Amount *
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                  <span className="text-gray-400 text-sm font-medium">₹</span>
                </div>
                <input
                  type="number"
                  name="amount"
                  required
                  min="0.01"
                  step="0.01"
                  max={remainingAmount}
                  value={formData.amount}
                  onChange={handleChange}
                  className="block w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Payment Reference (Optional)
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                  <FileText className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  type="text"
                  name="reference"
                  value={formData.reference}
                  onChange={handleChange}
                  placeholder="Transaction ID, Cheque Number, etc."
                  className="block w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Payment Date
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                  <Calendar className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  type="date"
                  name="paymentDate"
                  defaultValue={new Date().toISOString().split('T')[0]}
                  disabled
                  className="block w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md bg-gray-50 text-gray-500"
                />
              </div>
              <div className="text-xs text-gray-500 mt-1">Payment date is set to today</div>
            </div>
          </div>

          <div className="flex items-center justify-end space-x-4 pt-6 mt-6 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 transition-colors flex-shrink-0"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={formData.isSubmitting || formData.amount <= 0}
              className="px-6 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors flex-shrink-0"
            >
              {formData.isSubmitting ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent mr-2 inline-block"></div>
                  Processing...
                </>
              ) : (
                'Record Payment'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default MarkAsPaidModal;
