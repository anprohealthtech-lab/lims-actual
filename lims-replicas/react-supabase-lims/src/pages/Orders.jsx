import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { format } from 'date-fns'

export default function Orders() {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')

  useEffect(() => {
    loadOrders()
  }, [filter])

  async function loadOrders() {
    let query = supabase
      .from('orders')
      .select('*, patients(name)')
      .order('created_at', { ascending: false })
      .limit(100)

    if (filter !== 'all') {
      query = query.eq('status', filter)
    }

    const { data, error } = await query
    if (!error) setOrders(data || [])
    setLoading(false)
  }

  const statusColors = {
    registered: 'bg-gray-100 text-gray-700',
    sample_collected: 'bg-blue-100 text-blue-700',
    processing: 'bg-yellow-100 text-yellow-700',
    completed: 'bg-green-100 text-green-700',
    verified: 'bg-emerald-100 text-emerald-700'
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Orders</h1>
        <Link to="/orders/new" className="btn btn-primary">
          + New Order
        </Link>
      </div>

      {/* Filters */}
      <div className="card mb-6">
        <div className="flex gap-2">
          {['all', 'registered', 'processing', 'completed', 'verified'].map(status => (
            <button
              key={status}
              onClick={() => setFilter(status)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                filter === status
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {status.charAt(0).toUpperCase() + status.slice(1).replace('_', ' ')}
            </button>
          ))}
        </div>
      </div>

      {/* Orders Table */}
      <div className="card">
        <table className="w-full">
          <thead>
            <tr className="text-left text-gray-500 text-sm border-b">
              <th className="pb-3">Order #</th>
              <th className="pb-3">Patient</th>
              <th className="pb-3">Doctor</th>
              <th className="pb-3">Priority</th>
              <th className="pb-3">Status</th>
              <th className="pb-3">Date</th>
              <th className="pb-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {orders.map(order => (
              <tr key={order.id} className="border-b last:border-0">
                <td className="py-3 font-medium font-mono">{order.order_number}</td>
                <td className="py-3">{order.patients?.name || 'Unknown'}</td>
                <td className="py-3">{order.doctor_name || '-'}</td>
                <td className="py-3">
                  <span className={`px-2 py-1 rounded text-xs ${
                    order.priority === 'STAT' ? 'bg-red-100 text-red-700' :
                    order.priority === 'Urgent' ? 'bg-orange-100 text-orange-700' :
                    'bg-gray-100 text-gray-600'
                  }`}>
                    {order.priority}
                  </span>
                </td>
                <td className="py-3">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[order.status] || ''}`}>
                    {order.status}
                  </span>
                </td>
                <td className="py-3 text-gray-500">
                  {format(new Date(order.created_at), 'dd MMM HH:mm')}
                </td>
                <td className="py-3">
                  <Link
                    to={`/results?order=${order.order_number}`}
                    className="text-blue-600 hover:underline text-sm"
                  >
                    Enter Results
                  </Link>
                </td>
              </tr>
            ))}
            {!loading && orders.length === 0 && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-gray-500">
                  No orders found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
