import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { downloadReport, openReportInNewTab } from '../lib/pdfReport'

export default function Report() {
  const [orderNumber, setOrderNumber] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [orderInfo, setOrderInfo] = useState(null)

  async function loadAndGenerate(action) {
    if (!orderNumber.trim()) {
      setError('Please enter an order number')
      return
    }

    setLoading(true)
    setError(null)

    // Get order
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('*, patients(name)')
      .eq('order_number', orderNumber.trim())
      .single()

    if (orderError || !order) {
      setError('Order not found')
      setLoading(false)
      return
    }

    // Get results
    const { data: results, error: resultsError } = await supabase
      .from('results')
      .select('*')
      .eq('order_id', order.id)
      .eq('verification_status', 'verified')

    if (resultsError) {
      setError('Error loading results')
      setLoading(false)
      return
    }

    if (!results || results.length === 0) {
      setError('No verified results found for this order')
      setLoading(false)
      return
    }

    // Get settings
    const { data: settingsData } = await supabase.from('settings').select('*')
    const settings = {}
    settingsData?.forEach(s => {
      settings[s.key] = s.value
    })

    // Prepare order data
    const orderData = {
      order_number: order.order_number,
      patient_name: order.patients?.name || 'Unknown',
      doctor_name: order.doctor_name,
      barcode: order.barcode,
      order_date: order.created_at
    }

    setOrderInfo(orderData)

    // Generate PDF
    if (action === 'download') {
      downloadReport(orderData, results, settings)
    } else {
      openReportInNewTab(orderData, results, settings)
    }

    setLoading(false)
  }

  return (
    <div className="max-w-xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Generate Report</h1>

      <div className="card">
        <div className="bg-blue-50 p-4 rounded-lg mb-6 text-sm text-blue-700">
          ℹ️ Reports can only be generated for orders with all results verified.
        </div>

        <div className="mb-4">
          <label className="label">Order Number</label>
          <input
            type="text"
            className="input"
            placeholder="e.g., ORD-250625-001"
            value={orderNumber}
            onChange={(e) => setOrderNumber(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && loadAndGenerate('preview')}
          />
        </div>

        {error && (
          <div className="bg-red-50 text-red-600 p-3 rounded-lg mb-4 text-sm">
            {error}
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={() => loadAndGenerate('download')}
            disabled={loading}
            className="btn btn-primary flex-1"
          >
            {loading ? '⏳ Generating...' : '📥 Download PDF'}
          </button>
          <button
            onClick={() => loadAndGenerate('preview')}
            disabled={loading}
            className="btn btn-secondary flex-1"
          >
            {loading ? '⏳ Generating...' : '👁️ Preview'}
          </button>
        </div>

        {orderInfo && (
          <div className="mt-6 p-4 bg-green-50 rounded-lg">
            <div className="text-green-700 font-medium">✅ Report generated!</div>
            <div className="text-sm text-green-600 mt-1">
              Order: {orderInfo.order_number} | Patient: {orderInfo.patient_name}
            </div>
          </div>
        )}
      </div>

      <div className="card mt-6">
        <h3 className="font-semibold mb-3">Report Includes:</h3>
        <ul className="text-sm text-gray-600 space-y-1">
          <li>✓ Lab header with name, address, phone</li>
          <li>✓ Patient information</li>
          <li>✓ Order details and barcode</li>
          <li>✓ Results grouped by test</li>
          <li>✓ Reference ranges and flags (highlighted)</li>
          <li>✓ Signature fields for technician & pathologist</li>
          <li>✓ Custom footer text</li>
        </ul>
      </div>
    </div>
  )
}
