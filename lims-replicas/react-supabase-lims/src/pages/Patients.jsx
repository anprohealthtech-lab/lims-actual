import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { format } from 'date-fns'

export default function Patients() {
  const [patients, setPatients] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ name: '', dob: '', gender: '', phone: '', email: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    loadPatients()
  }, [])

  async function loadPatients() {
    let query = supabase.from('patients').select('*').order('created_at', { ascending: false })

    if (search) {
      query = query.or(`name.ilike.%${search}%,phone.ilike.%${search}%`)
    }

    const { data, error } = await query.limit(100)
    if (!error) setPatients(data || [])
    setLoading(false)
  }

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)

    const { error } = await supabase.from('patients').insert([form])

    if (error) {
      alert('Error saving patient: ' + error.message)
    } else {
      setShowModal(false)
      setForm({ name: '', dob: '', gender: '', phone: '', email: '' })
      loadPatients()
    }
    setSaving(false)
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Patients</h1>
        <button onClick={() => setShowModal(true)} className="btn btn-primary">
          + Add Patient
        </button>
      </div>

      {/* Search */}
      <div className="card mb-6">
        <input
          type="text"
          className="input"
          placeholder="Search by name or phone..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && loadPatients()}
        />
      </div>

      {/* Patients Table */}
      <div className="card">
        <table className="w-full">
          <thead>
            <tr className="text-left text-gray-500 text-sm border-b">
              <th className="pb-3">Name</th>
              <th className="pb-3">Phone</th>
              <th className="pb-3">Gender</th>
              <th className="pb-3">DOB</th>
              <th className="pb-3">Registered</th>
            </tr>
          </thead>
          <tbody>
            {patients.map(patient => (
              <tr key={patient.id} className="border-b last:border-0">
                <td className="py-3 font-medium">{patient.name}</td>
                <td className="py-3">{patient.phone}</td>
                <td className="py-3">{patient.gender || '-'}</td>
                <td className="py-3">{patient.dob ? format(new Date(patient.dob), 'dd MMM yyyy') : '-'}</td>
                <td className="py-3 text-gray-500">
                  {format(new Date(patient.created_at), 'dd MMM yyyy')}
                </td>
              </tr>
            ))}
            {!loading && patients.length === 0 && (
              <tr>
                <td colSpan={5} className="py-8 text-center text-gray-500">
                  No patients found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Add Patient Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">Add Patient</h2>
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="label">Full Name *</label>
                <input
                  type="text"
                  className="input"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="label">Phone *</label>
                <input
                  type="tel"
                  className="input"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Date of Birth</label>
                  <input
                    type="date"
                    className="input"
                    value={form.dob}
                    onChange={(e) => setForm({ ...form, dob: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Gender</label>
                  <select
                    className="input"
                    value={form.gender}
                    onChange={(e) => setForm({ ...form, gender: e.target.value })}
                  >
                    <option value="">Select</option>
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="label">Email</label>
                <input
                  type="email"
                  className="input"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </div>
              <div className="flex gap-3 justify-end">
                <button type="button" onClick={() => setShowModal(false)} className="btn btn-secondary">
                  Cancel
                </button>
                <button type="submit" disabled={saving} className="btn btn-primary">
                  {saving ? 'Saving...' : 'Save Patient'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
