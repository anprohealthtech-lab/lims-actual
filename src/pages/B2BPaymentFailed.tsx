import React from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { XCircle, ArrowLeft, RefreshCw, HelpCircle } from 'lucide-react';

const B2BPaymentFailed: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const reason = searchParams.get('reason') || 'Payment could not be processed';
  const paymentId = searchParams.get('payment_id');

  return (
    <div className="min-h-screen bg-gradient-to-b from-red-50 to-white flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-8 text-center">
        <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <XCircle className="h-12 w-12 text-red-600" />
        </div>

        <h1 className="text-2xl font-bold text-gray-900 mb-2">Payment Failed</h1>
        <p className="text-gray-600 mb-4">
          We couldn't process your payment. Don't worry, no amount has been deducted.
        </p>

        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 text-left">
          <p className="text-sm text-red-700">
            <strong>Reason:</strong> {reason}
          </p>
          {paymentId && (
            <p className="text-xs text-red-500 mt-2">
              Reference: {paymentId}
            </p>
          )}
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 text-left">
          <h3 className="text-sm font-medium text-amber-800 mb-2 flex items-center gap-2">
            <HelpCircle className="h-4 w-4" />
            Common reasons for failure:
          </h3>
          <ul className="text-sm text-amber-700 space-y-1 list-disc list-inside">
            <li>Insufficient funds in your account</li>
            <li>Card declined by issuing bank</li>
            <li>Network timeout during transaction</li>
            <li>Incorrect card details entered</li>
          </ul>
        </div>

        <div className="space-y-3">
          <button
            onClick={() => navigate('/b2b/portal')}
            className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors font-medium"
          >
            <RefreshCw className="h-5 w-5" />
            Try Again
          </button>

          <button
            onClick={() => navigate('/b2b/portal')}
            className="w-full flex items-center justify-center gap-2 px-6 py-3 border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
            Back to Portal
          </button>
        </div>

        <p className="text-xs text-gray-500 mt-6">
          If the problem persists, please contact your lab administrator.
        </p>
      </div>
    </div>
  );
};

export default B2BPaymentFailed;
