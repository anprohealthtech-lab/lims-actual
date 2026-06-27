import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, Link, useLocation } from 'react-router-dom'
import { supabase } from './lib/supabase'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Patients from './pages/Patients'
import Orders from './pages/Orders'
import NewOrder from './pages/NewOrder'
import ResultEntry from './pages/ResultEntry'
import Verification from './pages/Verification'
import Settings from './pages/Settings'
import Report from './pages/Report'
import Verify from './pages/Verify'
import TestManagement from './pages/TestManagement'

function Layout({ children, user, onSignOut }) {
  const location = useLocation()

  const navItems = [
    { path: '/', label: 'Dashboard', icon: '📊' },
    { path: '/patients', label: 'Patients', icon: '👥' },
    { path: '/orders', label: 'Orders', icon: '📋' },
    { path: '/orders/new', label: 'New Order', icon: '➕' },
    { path: '/results', label: 'Results', icon: '📝' },
    { path: '/verification', label: 'Verify', icon: '✅' },
    { path: '/report', label: 'Report', icon: '📄' },
    { path: '/tests', label: 'Tests', icon: '🧪' },
    { path: '/settings', label: 'Settings', icon: '⚙️' },
  ]

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside className="w-64 bg-slate-800 text-white p-4">
        <div className="text-xl font-bold mb-8 flex items-center gap-2">
          🔬 LIMS Mini
        </div>
        <nav className="space-y-1">
          {navItems.map(item => (
            <Link
              key={item.path}
              to={item.path}
              className={`flex items-center gap-3 px-4 py-2 rounded-lg transition-colors ${
                location.pathname === item.path
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-300 hover:bg-slate-700'
              }`}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>
        <div className="absolute bottom-4 left-4 right-4">
          <div className="text-sm text-slate-400 mb-2">{user?.email}</div>
          <button onClick={onSignOut} className="text-slate-400 hover:text-white text-sm">
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 p-8 overflow-auto">
        {children}
      </main>
    </div>
  )
}

function App() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })

    return () => subscription.unsubscribe()
  }, [])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
  }

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>
  }

  if (!user) {
    return <Login />
  }

  return (
    <BrowserRouter>
      <Routes>
        {/* Public verification page - no auth required */}
        <Route path="/verify" element={<Verify />} />

        {/* Protected routes */}
        <Route path="*" element={
          <Layout user={user} onSignOut={handleSignOut}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/patients" element={<Patients />} />
              <Route path="/orders" element={<Orders />} />
              <Route path="/orders/new" element={<NewOrder />} />
              <Route path="/results" element={<ResultEntry />} />
              <Route path="/verification" element={<Verification />} />
              <Route path="/report" element={<Report />} />
              <Route path="/tests" element={<TestManagement />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<Navigate to="/" />} />
            </Routes>
          </Layout>
        } />
      </Routes>
    </BrowserRouter>
  )
}

export default App
