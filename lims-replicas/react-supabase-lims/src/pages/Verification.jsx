import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { format } from 'date-fns'

export default function Verification() {
  const [pendingOrders, setPendingOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedResults, setSelectedResults] = useState({})
  const [verifying, setVerifying] = useState(false)

  useEffect(() => {
    loadPendingResults()
  }, [])

  async function loadPendingResults() {
    // Get all pending results grouped by order
    const { data: results, error } = await supabase
      .from('results')
      .select('*, orders(order_number, patients(name))')
      .eq('verification_status', 'pending')
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error loading results:', error)
      setLoading(false)
      return
    }

    // Group by order
    const orderMap = {}
    results?.forEach(result => {
      const orderNum = result.orders?.order_number
      if (!orderMap[orderNum]) {
        orderMap[orderNum] = {
          order_number: orderNum,
          patient_name: result.orders?.patients?.name || 'Unknown',
          results: []
        }
      }
      orderMap[orderNum].results.push(result)
    })

    setPendingOrders(Object.values(orderMap))
    setLoading(false)
  }

  function toggleResult(resultId) {
    setSelectedResults({
      ...selectedResults,
      [resultId]: !selectedResults[resultId]
    })
  }

  function selectAllForOrder(orderNum) {
    const order = pendingOrders.find(o => o.order_number === orderNum)
    if (!order) return

    const newSelected = { ...selectedResults }
    const allSelected = order.results.every(r => selectedResults[r.id])

    order.results.forEach(r => {
      newSelected[r.id] = !allSelected
    })

    setSelectedResults(newSelected)
  }

  async function verifySelected(action) {
    const resultIds = Object.keys(selectedResults).filter(id => selectedResults[id])

    if (resultIds.length === 0) {
      alert('Please select at least one result')
      return
    }

    const actionText = action === 'verify' ? 'verify' : 'reject'
    if (!confirm(`Are you sure you want to ${actionText} ${resultIds.length} result(s)?`)) {
      return
    }

    setVerifying(true)

    const newStatus = action === 'verify' ? 'verified' : 'rejected'
    const { error } = await supabase
      .from('results')
      .update({
        verification_status: newStatus,
        verified_at: new Date().toISOString()
      })
      .in('id', resultIds)

    if (error) {
      alert('Error updating results: ' + error.message)
    } else {
      // Check if all results for each order are verified
      for (const order of pendingOrders) {
        const orderResultIds = order.results.map(r => r.id)
        const verifiedIds = orderResultIds.filter(id => resultIds.includes(id))

        if (verifiedIds.length === orderResultIds.length && action === 'verify') {
          // All results verified, update order status
          const { data: orderData } = await supabase
            .from('orders')
            .select('id')
            .eq('order_number', order.order_number)
            .single()

          if (orderData) {
            await supabase
              .from('orders')
              .update({ status: 'verified' })
              .eq('id', orderData.id)
          }
        }
      }

      setSelectedResults({})
      loadPendingResults()
    }

    setVerifying(false)
  }

  const flagColors = {
    normal: 'bg-green-100 text-green-700',
    high: 'bg-red-100 text-red-700',
    low: 'bg-yellow-100 text-yellow-700',
    critical: 'bg-red-600 text-white'
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Verification Queue</h1>
        <div className="flex gap-2">
          <button
            onClick={() => verifySelected('verify')}
            disabled={verifying}
            className="btn btn-success"
          >
            ✓ Verify Selected
          </button>
          <button
            onClick={() => verifySelected('reject')}
            disabled={verifying}
            className="btn btn-danger"
          >
            ✗ Reject Selected
          </button>
        </div>
      </div>

      {loading && <div className="text-center py-8">Loading...</div>}

      {!loading && pendingOrders.length === 0 && (
        <div className="card text-center py-12 text-gray-500">
          <div className="text-4xl mb-4">🎉</div>
          <div>No pending verifications!</div>
        </div>
      )}

      {pendingOrders.map(order => (
        <div key={order.order_number} className="card mb-4">
          <div className="flex justify-between items-center mb-4">
            <div>
              <div className="font-bold text-lg text-blue-600">{order.order_number}</div>
              <div className="text-gray-500">{order.patient_name}</div>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={order.results.every(r => selectedResults[r.id])}
                onChange={() => selectAllForOrder(order.order_number)}
                className="w-4 h-4"
              />
              <span className="text-sm">Select All</span>
            </label>
          </div>

          <table className="w-full">
            <thead>
              <tr className="text-left text-sm text-gray-500 border-b">
                <th className="pb-2 w-8"></th>
                <th className="pb-2">Test</th>
                <th className="pb-2">Analyte</th>
                <th className="pb-2">Value</th>
                <th className="pb-2">Unit</th>
                <th className="pb-2">Reference</th>
                <th className="pb-2">Flag</th>
              </tr>
            </thead>
            <tbody>
              {order.results.map(result => (
                <tr key={result.id} className="border-b last:border-0">
                  <td className="py-2">
                    <input
                      type="checkbox"
                      checked={!!selectedResults[result.id]}
                      onChange={() => toggleResult(result.id)}
                      className="w-4 h-4"
                    />
                  </td>
                  <td className="py-2 font-medium">{result.test_name}</td>
                  <td className="py-2">{result.analyte}</td>
                  <td className="py-2 font-mono">{result.value}</td>
                  <td className="py-2 text-gray-500">{result.unit}</td>
                  <td className="py-2 text-gray-500">{result.reference_range}</td>
                  <td className="py-2">
                    <span className={`px-2 py-1 rounded text-xs font-bold ${flagColors[result.flag] || flagColors.normal}`}>
                      {result.flag?.toUpperCase()}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}
