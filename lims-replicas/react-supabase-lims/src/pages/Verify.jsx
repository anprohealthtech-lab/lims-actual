import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { verifyReportCode } from '../lib/qrVerification'

export default function Verify() {
  const [searchParams] = useSearchParams()
  const [orderNumber, setOrderNumber] = useState(searchParams.get('order') || '')
  const [code, setCode] = useState(searchParams.get('code') || '')
  const [status, setStatus] = useState(null) // 'valid', 'invalid', 'not_found', 'loading'
  const [orderDetails, setOrderDetails] = useState(null)

  useEffect(() => {
    if (searchParams.get('order') && searchParams.get('code')) {
      verifyReport()
    }
  }, [])

  async function verifyReport() {
    if (!orderNumber || !code) {
      setStatus('invalid')
      return
    }

    setStatus('loading')

    // Fetch order and results
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('*, patients(name)')
      .eq('order_number', orderNumber)
      .single()

    if (orderError || !order) {
      setStatus('not_found')
      return
    }

    const { data: results } = await supabase
      .from('results')
      .select('*')
      .eq('order_id', order.id)

    if (!results || results.length === 0) {
      setStatus('not_found')
      return
    }

    // Build order object for verification
    const orderForVerify = {
      order_number: order.order_number,
      patient_name: order.patients?.name || '',
      created_at: order.created_at
    }

    // Verify code
    const isValid = verifyReportCode(orderForVerify, results, code)

    if (isValid) {
      setStatus('valid')
      setOrderDetails({
        orderNumber: order.order_number,
        patientName: order.patients?.name,
        doctorName: order.doctor_name,
        orderDate: order.created_at,
        testCount: results.length,
        verifiedResults: results.filter(r => r.verification_status === 'verified').length
      })
    } else {
      setStatus('invalid')
    }
  }

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full">
        <h1 className="text-2xl font-bold text-center mb-6">Report Verification</h1>

        {/* Manual Entry Form */}
        {!status && (
          <div className="space-y-4">
            <div>
              <label className="label">Order Number</label>
              <input
                type="text"
                className="input"
                placeholder="e.g., ORD-240625-001"
                value={orderNumber}
                onChange={(e) => setOrderNumber(e.target.value)}
              />
            </div>
            <div>
              <label className="label">Verification Code</label>
              <input
                type="text"
                className="input"
                placeholder="e.g., ABC12345"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
              />
            </div>
            <button onClick={verifyReport} className="btn btn-primary w-full">
              Verify Report
            </button>
          </div>
        )}

        {/* Loading */}
        {status === 'loading' && (
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">Verifying...</p>
          </div>
        )}

        {/* Valid */}
        {status === 'valid' && orderDetails && (
          <div className="text-center">
            <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-12 h-12 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-green-700 mb-4">Report Verified</h2>
            <p className="text-gray-600 mb-6">This is an authentic laboratory report.</p>

            <div className="bg-gray-50 rounded-lg p-4 text-left space-y-2">
              <div className="flex justify-between">
                <span className="text-gray-500">Order #:</span>
                <span className="font-medium">{orderDetails.orderNumber}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Patient:</span>
                <span className="font-medium">{orderDetails.patientName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Doctor:</span>
                <span className="font-medium">{orderDetails.doctorName || 'N/A'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Date:</span>
                <span className="font-medium">
                  {new Date(orderDetails.orderDate).toLocaleDateString('en-IN')}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Results:</span>
                <span className="font-medium">
                  {orderDetails.verifiedResults}/{orderDetails.testCount} verified
                </span>
              </div>
            </div>

            <button
              onClick={() => { setStatus(null); setOrderDetails(null) }}
              className="btn btn-secondary mt-6"
            >
              Verify Another
            </button>
          </div>
        )}

        {/* Invalid */}
        {status === 'invalid' && (
          <div className="text-center">
            <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-12 h-12 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-red-700 mb-4">Verification Failed</h2>
            <p className="text-gray-600 mb-6">
              This report could not be verified. The verification code may be incorrect or the report may have been tampered with.
            </p>
            <button
              onClick={() => setStatus(null)}
              className="btn btn-secondary"
            >
              Try Again
            </button>
          </div>
        )}

        {/* Not Found */}
        {status === 'not_found' && (
          <div className="text-center">
            <div className="w-20 h-20 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-12 h-12 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-yellow-700 mb-4">Report Not Found</h2>
            <p className="text-gray-600 mb-6">
              No report found with this order number. Please check and try again.
            </p>
            <button
              onClick={() => setStatus(null)}
              className="btn btn-secondary"
            >
              Try Again
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
