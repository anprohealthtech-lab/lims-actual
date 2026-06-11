import React, { useState, useEffect } from 'react';
import {
  AlertTriangle,
  CreditCard,
  Wallet,
  ArrowRight,
  Loader2,
  X,
  CheckCircle,
  IndianRupee
} from 'lucide-react';
import { supabase } from '../../utils/supabase';
import type { CreditCheckResponse, InitiatePaymentResponse } from '../../types/payment';

const PAYMENT_FUNCTIONS_BASE_URL =
  import.meta.env.VITE_PAYMENT_FUNCTIONS_BASE_URL ||
  (window.location.hostname === 'app.limsapp.in'
    ? 'https://api.limsapp.in'
    : import.meta.env.VITE_SUPABASE_URL);

const PAYMENT_CALLBACK_URL =
  import.meta.env.VITE_CCAVENUE_CALLBACK_URL ||
  `${PAYMENT_FUNCTIONS_BASE_URL}/functions/v1/payment-callback?provider=ccavenue`;

const PAYMENT_CANCEL_URL =
  import.meta.env.VITE_PAYMENT_CANCEL_URL ||
  `${window.location.origin}/b2b/payment/cancelled`;

const roundUpPaymentAmount = (amount: number) =>
  amount > 0 ? Math.ceil(amount / 500) * 500 : 0;

interface CreditCheckModalProps {
  isOpen: boolean;
  onClose: () => void;
  accountId: string;
  labId: string;
  orderAmount: number;
  orderData?: Record<string, unknown>;
  onPaymentSuccess?: (paymentId: string) => void;
  onProceedWithCredit?: () => void;
}

const CreditCheckModal: React.FC<CreditCheckModalProps> = ({
  isOpen,
  onClose,
  accountId,
  labId,
  orderAmount,
  orderData,
  onPaymentSuccess,
  onProceedWithCredit,
}) => {
  const [loading, setLoading] = useState(true);
  const [creditInfo, setCreditInfo] = useState<CreditCheckResponse | null>(null);
  const [selectedAmount, setSelectedAmount] = useState<number>(0);
  const [customAmount, setCustomAmount] = useState<string>('');
  const [initiatingPayment, setInitiatingPayment] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      checkCredit();
    }
  }, [isOpen, accountId, orderAmount]);

  const checkCredit = async () => {
    setLoading(true);
    setError(null);

    try {
      const { data, error } = await supabase.functions.invoke('check-b2b-credit', {
        body: { account_id: accountId, lab_id: labId, order_amount: orderAmount },
      });

      if (error) throw error;
      setCreditInfo(data);

      // Give the account a useful round-number top-up while covering the order.
      if (data.shortfall > 0) {
        setSelectedAmount(roundUpPaymentAmount(data.shortfall));
      }
    } catch (err: any) {
      console.error('Credit check error:', err);
      setError(err.message || 'Failed to check credit');
    } finally {
      setLoading(false);
    }
  };

  const handlePaymentOption = (amount: number) => {
    if (amount === 0) {
      // Custom amount selected
      setSelectedAmount(0);
    } else {
      setSelectedAmount(amount);
      setCustomAmount('');
    }
  };

  const handleCustomAmountChange = (value: string) => {
    setCustomAmount(value);
    const numValue = parseFloat(value) || 0;
    setSelectedAmount(numValue);
  };

  const initiatePayment = async () => {
    if (selectedAmount <= 0) {
      setError('Please select or enter a payment amount');
      return;
    }

    setInitiatingPayment(true);
    setError(null);

    try {
      const { data, error } = await supabase.functions.invoke<InitiatePaymentResponse>('initiate-payment', {
        body: {
          account_id: accountId,
          lab_id: labId,
	          amount: selectedAmount,
	          purpose: orderData && selectedAmount >= (creditInfo?.shortfall || 0)
              ? 'shortfall_payment'
              : 'credit_topup',
	          order_data: orderData,
	          return_url: PAYMENT_CALLBACK_URL,
	          cancel_url: PAYMENT_CANCEL_URL,
	        },
	      });

      if (error) throw error;

      if (data?.redirect_required && data.gateway_url) {
        // CCAvenue - redirect via form submission
        const form = document.createElement('form');
        form.method = data.form_method || 'POST';
        form.action = data.gateway_url;

        Object.entries(data.form_data || {}).forEach(([key, value]) => {
          const input = document.createElement('input');
          input.type = 'hidden';
          input.name = key;
          input.value = value;
          form.appendChild(input);
        });

        document.body.appendChild(form);
        form.submit();
      } else if (data?.razorpay_order_id) {
        // Razorpay - open checkout
        openRazorpayCheckout(data);
      }
    } catch (err: any) {
      console.error('Payment initiation error:', err);
      setError(err.message || 'Failed to initiate payment');
      setInitiatingPayment(false);
    }
  };

  const openRazorpayCheckout = (paymentData: InitiatePaymentResponse) => {
    // Load Razorpay script if not already loaded
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => {
      const options = {
        key: paymentData.razorpay_key_id,
        amount: (paymentData.amount || 0) * 100,
        currency: paymentData.currency || 'INR',
        name: paymentData.name || 'Credit Payment',
        description: paymentData.description,
        order_id: paymentData.razorpay_order_id,
        prefill: paymentData.prefill,
        notes: paymentData.notes,
        handler: async (response: any) => {
          // Verify payment
          try {
            const { data, error } = await supabase.functions.invoke('payment-callback/verify', {
              body: {
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
                payment_id: paymentData.payment_id,
              },
            });

            if (error) throw error;

            if (data?.success) {
              onPaymentSuccess?.(paymentData.payment_id);
              onClose();
            } else {
              setError('Payment verification failed');
            }
          } catch (err: any) {
            setError(err.message || 'Payment verification failed');
          }
          setInitiatingPayment(false);
        },
        modal: {
          ondismiss: () => {
            setInitiatingPayment(false);
          },
        },
      };

      const rzp = new (window as any).Razorpay(options);
      rzp.open();
    };
    document.body.appendChild(script);
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(amount);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
              <Wallet className="h-6 w-6 text-blue-600" />
              Credit Check
            </h2>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 rounded-full transition-colors"
            >
              <X className="h-5 w-5 text-gray-500" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-8">
              <Loader2 className="h-8 w-8 text-blue-600 animate-spin mb-4" />
              <p className="text-gray-600">Checking available credit...</p>
            </div>
          ) : error && !creditInfo ? (
            <div className="text-center py-8">
              <AlertTriangle className="h-12 w-12 text-red-500 mx-auto mb-4" />
              <p className="text-red-600">{error}</p>
              <button
                onClick={checkCredit}
                className="mt-4 px-4 py-2 text-blue-600 hover:bg-blue-50 rounded-lg"
              >
                Retry
              </button>
            </div>
          ) : creditInfo ? (
            <div className="space-y-6">
              {/* Credit Summary */}
              <div className="bg-gray-50 rounded-lg p-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-gray-500">Credit Limit</span>
                    <p className="font-semibold text-gray-900">
                      {formatCurrency(creditInfo.credit_limit)}
                    </p>
                  </div>
                  <div>
                    <span className="text-gray-500">Used</span>
                    <p className="font-semibold text-gray-900">
                      {formatCurrency(creditInfo.credit_used)}
                    </p>
                  </div>
                  <div>
                    <span className="text-gray-500">Available Credit</span>
                    <p className={`font-semibold ${
                      creditInfo.available_credit >= orderAmount ? 'text-green-600' : 'text-orange-600'
                    }`}>
                      {formatCurrency(creditInfo.available_credit)}
                    </p>
                  </div>
                  <div>
                    <span className="text-gray-500">Order Amount</span>
                    <p className="font-semibold text-gray-900">
                      {formatCurrency(creditInfo.order_amount)}
                    </p>
                  </div>
                </div>
              </div>

              {/* Can Proceed */}
              {creditInfo.can_proceed ? (
                <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-start gap-3">
                  <CheckCircle className="h-5 w-5 text-green-600 mt-0.5" />
                  <div>
                    <p className="font-medium text-green-800">Sufficient Credit Available</p>
                    <p className="text-sm text-green-700 mt-1">
                      You have enough credit to proceed with this order.
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  {/* Shortfall Warning */}
                  <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 flex items-start gap-3">
                    <AlertTriangle className="h-5 w-5 text-orange-600 mt-0.5" />
                    <div>
                      <p className="font-medium text-orange-800">Insufficient Credit</p>
                      <p className="text-sm text-orange-700 mt-1">
                        You need {formatCurrency(creditInfo.shortfall)} more to place this order.
                      </p>
                    </div>
                  </div>

                  {/* Payment Options */}
                  {creditInfo.payment_gateway_enabled && (
                    <div className="space-y-3">
                      <h3 className="font-medium text-gray-900">Select Payment Amount</h3>

                      <button
                        onClick={() => handlePaymentOption(roundUpPaymentAmount(creditInfo.shortfall))}
                        className={`w-full p-4 rounded-lg border-2 text-left transition-colors ${
                          selectedAmount === roundUpPaymentAmount(creditInfo.shortfall)
                            ? 'border-blue-500 bg-blue-50'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <p className="font-medium text-gray-900">Pay Now</p>
                            <p className="text-sm text-gray-500">
                              Rounded up to the next ₹500 and applied to your account credit
                            </p>
                          </div>
                          <span className="text-lg font-semibold text-gray-900">
                            {formatCurrency(roundUpPaymentAmount(creditInfo.shortfall))}
                          </span>
                        </div>
                      </button>

                      {creditInfo.suggested_payments
                        .filter(option => option.amount !== roundUpPaymentAmount(creditInfo.shortfall))
                        .map((option, index) => (
                        <button
                          key={index}
                          onClick={() => handlePaymentOption(option.amount)}
                          className={`w-full p-4 rounded-lg border-2 text-left transition-colors ${
                            option.amount > 0 && selectedAmount === option.amount
                              ? 'border-blue-500 bg-blue-50'
                              : 'border-gray-200 hover:border-gray-300'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="font-medium text-gray-900">{option.label}</p>
                              <p className="text-sm text-gray-500">{option.description}</p>
                            </div>
                            {option.amount > 0 && (
                              <span className="text-lg font-semibold text-gray-900">
                                {formatCurrency(option.amount)}
                              </span>
                            )}
                          </div>
                        </button>
                      ))}

                      {/* Custom Amount Input */}
                      {creditInfo.suggested_payments.some(p => p.amount === 0) && (
                        <div className={`p-4 rounded-lg border-2 ${
                          customAmount ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
                        }`}>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Enter Custom Amount
                          </label>
                          <div className="relative">
                            <IndianRupee className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                            <input
                              type="number"
                              value={customAmount}
                              onChange={(e) => handleCustomAmountChange(e.target.value)}
                              min={creditInfo.minimum_payment}
                              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                              placeholder={`Min: ${formatCurrency(creditInfo.minimum_payment)}`}
                            />
                          </div>
                        </div>
                      )}

                      {error && (
                        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                          {error}
                        </div>
                      )}
                    </div>
                  )}

                  {!creditInfo.payment_gateway_enabled && (
                    <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-center">
                      <p className="text-gray-600">
                        No active online payment gateway is configured for this lab.
                      </p>
                      <p className="text-sm text-gray-500 mt-1">
                        Ask the lab administrator to enable CCAvenue or Razorpay in Payment Gateway settings.
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-gray-200 bg-gray-50 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-white"
          >
            Cancel
          </button>

          {creditInfo?.can_proceed && onProceedWithCredit && (
            <button
              onClick={onProceedWithCredit}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
            >
              Proceed with Order
              <ArrowRight className="h-4 w-4" />
            </button>
          )}

          {creditInfo?.payment_required && creditInfo.payment_gateway_enabled && (
            <button
              onClick={initiatePayment}
              disabled={selectedAmount <= 0 || initiatingPayment}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {initiatingPayment ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <CreditCard className="h-4 w-4" />
                  Pay {selectedAmount > 0 ? formatCurrency(selectedAmount) : 'Now'}
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default CreditCheckModal;
