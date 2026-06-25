import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { format } from 'date-fns'

export default function NewOrder() {
  const navigate = useNavigate()
  const [patients, setPatients] = useState([])
  const [tests, setTests] = useState([])
  const [patientSearch, setPatientSearch] = useState('')
  const [selectedPatient, setSelectedPatient] = useState(null)
  const [selectedTests, setSelectedTests] = useState([])
  const [doctorName, setDoctorName] = useState('')
  const [priority, setPriority] = useState('Normal')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [showNewPatient, setShowNewPatient] = useState(false)
  const [newPatient, setNewPatient] = useState({ name: '', phone: '', gender: '', dob: '' })

  useEffect(() => {
    loadTests()
  }, [])

  useEffect(() => {
    if (patientSearch.length >= 2) {
      searchPatients()
    } else {
      setPatients([])
    }
  }, [patientSearch])

  async function loadTests() {
    const { data } = await supabase.from('test_catalog').select('*').order('name')
    setTests(data || [])
  }

  async function searchPatients() {
    const { data } = await supabase
      .from('patients')
      .select('*')
      .or(`name.ilike.%${patientSearch}%,phone.ilike.%${patientSearch}%`)
      .limit(5)
    setPatients(data || [])
  }

  function toggleTest(test) {
    if (selectedTests.find(t => t.id === test.id)) {
      setSelectedTests(selectedTests.filter(t => t.id !== test.id))
    } else {
      setSelectedTests([...selectedTests, test])
    }
  }

  async function createPatient() {
    if (!newPatient.name || !newPatient.phone) {
      alert('Name and phone are required')
      return
    }

    const { data, error } = await supabase
      .from('patients')
      .insert([newPatient])
      .select()
      .single()

    if (error) {
      alert('Error creating patient: ' + error.message)
      return
    }

    setSelectedPatient(data)
    setShowNewPatient(false)
    setNewPatient({ name: '', phone: '', gender: '', dob: '' })
  }

  async function createOrder() {
    if (!selectedPatient) {
      alert('Please select a patient')
      return
    }
    if (selectedTests.length === 0) {
      alert('Please select at least one test')
      return
    }

    setSaving(true)

    // Generate order number
    const today = format(new Date(), 'yyMMdd')
    const { count } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', format(new Date(), 'yyyy-MM-dd'))

    const orderNumber = `ORD-${today}-${String((count || 0) + 1).padStart(3, '0')}`
    const barcode = orderNumber.replace(/-/g, '')

    // Create order
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert([{
        order_number: orderNumber,
        barcode,
        patient_id: selectedPatient.id,
        doctor_name: doctorName,
        priority,
        notes,
        status: 'registered'
      }])
      .select()
      .single()

    if (orderError) {
      alert('Error creating order: ' + orderError.message)
      setSaving(false)
      return
    }

    // Create order tests
    const orderTests = selectedTests.map(test => ({
      order_id: order.id,
      test_id: test.id,
      test_code: test.code,
      test_name: test.name
    }))

    const { error: testsError } = await supabase.from('order_tests').insert(orderTests)

    if (testsError) {
      alert('Error adding tests: ' + testsError.message)
      setSaving(false)
      return
    }

    alert(`Order created: ${orderNumber}`)
    navigate('/orders')
  }

  const totalPrice = selectedTests.reduce((sum, t) => sum + (t.price || 0), 0)

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold mb-6">New Order</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Patient Selection */}
        <div className="card">
          <h2 className="text-lg font-semibold mb-4">Patient</h2>

          {selectedPatient ? (
            <div className="bg-blue-50 p-4 rounded-lg mb-4">
              <div className="font-medium">{selectedPatient.name}</div>
              <div className="text-sm text-gray-600">{selectedPatient.phone}</div>
              <button
                onClick={() => setSelectedPatient(null)}
                className="text-blue-600 text-sm mt-2"
              >
                Change patient
              </button>
            </div>
          ) : (
            <>
              <input
                type="text"
                className="input mb-2"
                placeholder="Search by name or phone..."
                value={patientSearch}
                onChange={(e) => setPatientSearch(e.target.value)}
              />

              {patients.length > 0 && (
                <div className="border rounded-lg mb-4">
                  {patients.map(p => (
                    <div
                      key={p.id}
                      onClick={() => {
                        setSelectedPatient(p)
                        setPatients([])
                        setPatientSearch('')
                      }}
                      className="p-3 border-b last:border-0 cursor-pointer hover:bg-gray-50"
                    >
                      <div className="font-medium">{p.name}</div>
                      <div className="text-sm text-gray-500">{p.phone}</div>
                    </div>
                  ))}
                </div>
              )}

              <button
                onClick={() => setShowNewPatient(true)}
                className="btn btn-secondary w-full"
              >
                + New Patient
              </button>

              {showNewPatient && (
                <div className="mt-4 p-4 border rounded-lg space-y-3">
                  <input
                    type="text"
                    className="input"
                    placeholder="Full Name *"
                    value={newPatient.name}
                    onChange={(e) => setNewPatient({ ...newPatient, name: e.target.value })}
                  />
                  <input
                    type="tel"
                    className="input"
                    placeholder="Phone *"
                    value={newPatient.phone}
                    onChange={(e) => setNewPatient({ ...newPatient, phone: e.target.value })}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      className="input"
                      value={newPatient.gender}
                      onChange={(e) => setNewPatient({ ...newPatient, gender: e.target.value })}
                    >
                      <option value="">Gender</option>
                      <option value="Male">Male</option>
                      <option value="Female">Female</option>
                    </select>
                    <input
                      type="date"
                      className="input"
                      value={newPatient.dob}
                      onChange={(e) => setNewPatient({ ...newPatient, dob: e.target.value })}
                    />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={createPatient} className="btn btn-primary flex-1">Save</button>
                    <button onClick={() => setShowNewPatient(false)} className="btn btn-secondary">Cancel</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Order Details */}
        <div className="card">
          <h2 className="text-lg font-semibold mb-4">Order Details</h2>

          <div className="space-y-4">
            <div>
              <label className="label">Referring Doctor</label>
              <input
                type="text"
                className="input"
                placeholder="Dr."
                value={doctorName}
                onChange={(e) => setDoctorName(e.target.value)}
              />
            </div>

            <div>
              <label className="label">Priority</label>
              <select
                className="input"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
              >
                <option value="Normal">Normal</option>
                <option value="Urgent">Urgent</option>
                <option value="STAT">STAT</option>
              </select>
            </div>

            <div>
              <label className="label">Notes</label>
              <textarea
                className="input"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* Test Selection */}
        <div className="card lg:col-span-2">
          <h2 className="text-lg font-semibold mb-4">Select Tests</h2>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 max-h-64 overflow-y-auto">
            {tests.map(test => (
              <label
                key={test.id}
                className={`flex items-start gap-2 p-3 border rounded-lg cursor-pointer transition-colors ${
                  selectedTests.find(t => t.id === test.id)
                    ? 'border-blue-500 bg-blue-50'
                    : 'hover:bg-gray-50'
                }`}
              >
                <input
                  type="checkbox"
                  checked={!!selectedTests.find(t => t.id === test.id)}
                  onChange={() => toggleTest(test)}
                  className="mt-1"
                />
                <div>
                  <div className="font-medium text-sm">{test.name}</div>
                  <div className="text-xs text-gray-500">{test.code}</div>
                  <div className="text-xs text-green-600">₹{test.price || 0}</div>
                </div>
              </label>
            ))}
          </div>

          {selectedTests.length > 0 && (
            <div className="mt-4 p-4 bg-gray-50 rounded-lg flex justify-between items-center">
              <div>
                <span className="font-medium">{selectedTests.length} tests selected</span>
                <div className="text-sm text-gray-500">
                  {selectedTests.map(t => t.code).join(', ')}
                </div>
              </div>
              <div className="text-xl font-bold text-green-600">₹{totalPrice}</div>
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-4 mt-6">
        <button
          onClick={createOrder}
          disabled={saving || !selectedPatient || selectedTests.length === 0}
          className="btn btn-primary"
        >
          {saving ? 'Creating...' : 'Create Order'}
        </button>
        <button onClick={() => navigate('/orders')} className="btn btn-secondary">
          Cancel
        </button>
      </div>
    </div>
  )
}
