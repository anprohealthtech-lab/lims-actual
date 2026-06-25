import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { format } from 'date-fns'

export default function Dashboard() {
  const [stats, setStats] = useState({
    ordersToday: 0,
    pendingResults: 0,
    pendingVerification: 0,
    completedToday: 0
  })
  const [recentOrders, setRecentOrders] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadDashboard()
  }, [])

  async function loadDashboard() {
    const today = format(new Date(), 'yyyy-MM-dd')

    // Get stats
    const [ordersToday, pendingResults, pendingVerification, completedToday] = await Promise.all([
      supabase.from('orders').select('id', { count: 'exact' }).gte('created_at', today),
      supabase.from('orders').select('id', { count: 'exact' }).eq('status', 'processing'),
      supabase.from('results').select('id', { count: 'exact' }).eq('verification_status', 'pending'),
      supabase.from('orders').select('id', { count: 'exact' }).eq('status', 'verified').gte('updated_at', today)
    ])

    setStats({
      ordersToday: ordersToday.count || 0,
      pendingResults: pendingResults.count || 0,
      pendingVerification: pendingVerification.count || 0,
      completedToday: completedToday.count || 0
    })

    // Get recent orders
    const { data: orders } = await supabase
      .from('orders')
      .select('*, patients(name)')
      .order('created_at', { ascending: false })
      .limit(10)

    setRecentOrders(orders || [])
    setLoading(false)
  }

  const statCards = [
    { label: 'Orders Today', value: stats.ordersToday, icon: '📋', color: 'bg-blue-500' },
    { label: 'Pending Results', value: stats.pendingResults, icon: '⏳', color: 'bg-yellow-500' },
    { label: 'Pending Verification', value: stats.pendingVerification, icon: '✅', color: 'bg-orange-500' },
    { label: 'Completed Today', value: stats.completedToday, icon: '✓', color: 'bg-green-500' }
  ]

  if (loading) {
    return <div>Loading dashboard...</div>
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Dashboard</h1>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {statCards.map(stat => (
          <div key={stat.label} className="card">
            <div className="flex items-center gap-4">
              <div className={`${stat.color} text-white p-3 rounded-lg text-2xl`}>
                {stat.icon}
              </div>
              <div>
                <div className="text-3xl font-bold">{stat.value}</div>
                <div className="text-gray-500 text-sm">{stat.label}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Recent Orders */}
      <div className="card">
        <h2 className="text-lg font-semibold mb-4">Recent Orders</h2>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-left text-gray-500 text-sm border-b">
                <th className="pb-3">Order #</th>
                <th className="pb-3">Patient</th>
                <th className="pb-3">Status</th>
                <th className="pb-3">Date</th>
              </tr>
            </thead>
            <tbody>
              {recentOrders.map(order => (
                <tr key={order.id} className="border-b last:border-0">
                  <td className="py-3 font-medium">{order.order_number}</td>
                  <td className="py-3">{order.patients?.name || 'Unknown'}</td>
                  <td className="py-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                      order.status === 'verified' ? 'bg-green-100 text-green-700' :
                      order.status === 'processing' ? 'bg-yellow-100 text-yellow-700' :
                      'bg-gray-100 text-gray-700'
                    }`}>
                      {order.status}
                    </span>
                  </td>
                  <td className="py-3 text-gray-500">
                    {format(new Date(order.created_at), 'dd MMM yyyy HH:mm')}
                  </td>
                </tr>
              ))}
              {recentOrders.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-gray-500">
                    No orders yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
