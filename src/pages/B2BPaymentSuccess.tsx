import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { CheckCircle, ArrowRight, Loader2, Receipt, CreditCard } from 'lucide-react';
import { supabase } from '../utils/supabase';

const B2BPaymentSuccess: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
	  const [paymentDetails, setPaymentDetails] = useState<{
	    amount: number;
	    status: string;
	    gateway_order_id?: string;
	    tracking_id?: string;
	    payment_method?: string;
	    completed_at?: string;
	  } | null>(null);

  const paymentId = searchParams.get('payment_id');

  useEffect(() => {
    const fetchPaymentDetails = async () => {
      if (!paymentId) {
        setLoading(false);
        return;
      }

      try {
	        const { data, error } = await supabase
	          .from('b2b_payment_attempts')
	          .select('amount, status, gateway_order_id, gateway_tracking_id, payment_method, completed_at')
	          .eq('id', paymentId)
	          .single();

        if (!error && data) {
          setPaymentDetails({
	            amount: data.amount,
	            status: data.status,
	            gateway_order_id: data.gateway_order_id,
	            tracking_id: data.gateway_tracking_id,
	            payment_method: data.payment_method,
	            completed_at: data.completed_at,
          });
        }
      } catch (err) {
        console.error('Error fetching payment details:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchPaymentDetails();
  }, [paymentId]);

	  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(amount);
	  };

	  const paymentDate = paymentDetails?.completed_at
	    ? new Date(paymentDetails.completed_at).toLocaleString('en-IN')
	    : new Date().toLocaleString('en-IN');

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="h-8 w-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  return (
	    <div className="min-h-screen bg-gradient-to-b from-green-50 to-white flex items-center justify-center p-4">
	      <style>{`
	        @media print {
	          body * { visibility: hidden; }
	          #payment-receipt, #payment-receipt * { visibility: visible; }
	          #payment-receipt {
	            position: absolute;
	            left: 0;
	            top: 0;
	            width: 100%;
	            padding: 24px;
	            color: #111827;
	          }
	          .no-print { display: none !important; }
	        }
	      `}</style>
	      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-8 text-center">
	        <div className="no-print w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
	          <CheckCircle className="h-12 w-12 text-green-600" />
	        </div>

        <h1 className="text-2xl font-bold text-gray-900 mb-2">Payment Successful!</h1>
        <p className="text-gray-600 mb-6">
          Your payment has been processed and credit has been added to your account.
        </p>

	        <div id="payment-receipt" className="bg-gray-50 rounded-xl p-4 mb-6 text-left">
	          <div className="hidden print:block text-center mb-6">
	            <h2 className="text-xl font-bold text-gray-900">Payment Receipt</h2>
	            <p className="text-sm text-gray-500">AnPro LIMS</p>
	          </div>
	          <div className="flex items-center justify-between py-2 border-b border-gray-200">
	            <span className="text-sm text-gray-500">Status</span>
	            <span className="text-sm font-semibold text-green-600">Success</span>
	          </div>
	          {paymentDetails ? (
	            <>
	              <div className="flex items-center justify-between py-2 border-b border-gray-200">
	                <span className="text-sm text-gray-500">Amount Paid</span>
	                <span className="text-lg font-bold text-green-600">
	                  {formatCurrency(paymentDetails.amount)}
	                </span>
	              </div>
	              {paymentDetails.gateway_order_id && (
	                <div className="flex items-center justify-between gap-4 py-2 border-b border-gray-200">
	                  <span className="text-sm text-gray-500">Order ID</span>
	                  <span className="text-sm font-mono text-gray-900 break-all text-right">
	                    {paymentDetails.gateway_order_id}
	                  </span>
	                </div>
	              )}
	              {paymentDetails.tracking_id && (
	                <div className="flex items-center justify-between gap-4 py-2 border-b border-gray-200">
	                  <span className="text-sm text-gray-500">Transaction ID</span>
	                  <span className="text-sm font-mono text-gray-900 break-all text-right">
	                    {paymentDetails.tracking_id}
	                  </span>
	                </div>
	              )}
	              {paymentDetails.payment_method && (
	                <div className="flex items-center justify-between py-2 border-b border-gray-200">
	                  <span className="text-sm text-gray-500">Payment Method</span>
	                  <span className="text-sm text-gray-900 capitalize flex items-center gap-1">
	                    <CreditCard className="h-4 w-4" />
	                    {paymentDetails.payment_method}
	                  </span>
	                </div>
	              )}
	            </>
	          ) : (
	            <div className="flex items-center justify-between gap-4 py-2 border-b border-gray-200">
	              <span className="text-sm text-gray-500">Reference</span>
	              <span className="text-sm font-mono text-gray-900 break-all text-right">{paymentId || '-'}</span>
	            </div>
	          )}
	          <div className="flex items-center justify-between py-2">
	            <span className="text-sm text-gray-500">Date</span>
	            <span className="text-sm text-gray-900">{paymentDate}</span>
	          </div>
	        </div>

	        <div className="no-print space-y-3">
	          <button
            onClick={() => navigate('/b2b/portal')}
            className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors font-medium"
          >
            Continue to Portal
            <ArrowRight className="h-5 w-5" />
          </button>

	          <button
            onClick={() => window.print()}
            className="w-full flex items-center justify-center gap-2 px-6 py-3 border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 transition-colors"
          >
            <Receipt className="h-5 w-5" />
            Print Receipt
          </button>
        </div>
      </div>
    </div>
  );
};

export default B2BPaymentSuccess;
