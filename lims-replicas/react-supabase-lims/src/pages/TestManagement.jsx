import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export default function TestManagement() {
  const [activeTab, setActiveTab] = useState('groups')
  const [groups, setGroups] = useState([])
  const [analytes, setAnalytes] = useState([])
  const [tests, setTests] = useState([])
  const [loading, setLoading] = useState(true)

  // Forms
  const [newGroup, setNewGroup] = useState({ name: '', code: '' })
  const [newAnalyte, setNewAnalyte] = useState({
    code: '', name: '', unit: '', result_type: 'numeric',
    expected_values: '', default_ref_range: ''
  })

  useEffect(() => {
    loadAll()
  }, [])

  async function loadAll() {
    setLoading(true)
    const [groupsRes, analytesRes, testsRes] = await Promise.all([
      supabase.from('test_groups').select('*').order('display_order'),
      supabase.from('analytes').select('*').order('name'),
      supabase.from('test_catalog').select('*').order('name')
    ])
    setGroups(groupsRes.data || [])
    setAnalytes(analytesRes.data || [])
    setTests(testsRes.data || [])
    setLoading(false)
  }

  // Group functions
  async function addGroup() {
    if (!newGroup.name || !newGroup.code) return alert('Name and code required')
    const { error } = await supabase.from('test_groups').insert([{
      name: newGroup.name,
      code: newGroup.code.toUpperCase(),
      display_order: groups.length + 1
    }])
    if (error) alert(error.message)
    else {
      setNewGroup({ name: '', code: '' })
      loadAll()
    }
  }

  async function deleteGroup(id) {
    if (!confirm('Delete this group?')) return
    await supabase.from('test_groups').delete().eq('id', id)
    loadAll()
  }

  // Analyte functions
  async function addAnalyte() {
    if (!newAnalyte.code || !newAnalyte.name) return alert('Code and name required')

    let expectedValues = []
    if (newAnalyte.expected_values) {
      try {
        expectedValues = JSON.parse(newAnalyte.expected_values)
      } catch {
        expectedValues = newAnalyte.expected_values.split(',').map(v => v.trim())
      }
    }

    const { error } = await supabase.from('analytes').insert([{
      code: newAnalyte.code.toUpperCase(),
      name: newAnalyte.name,
      unit: newAnalyte.unit,
      result_type: newAnalyte.result_type,
      expected_values: expectedValues,
      default_ref_range: newAnalyte.default_ref_range
    }])
    if (error) alert(error.message)
    else {
      setNewAnalyte({ code: '', name: '', unit: '', result_type: 'numeric', expected_values: '', default_ref_range: '' })
      loadAll()
    }
  }

  async function deleteAnalyte(id) {
    if (!confirm('Delete this analyte?')) return
    await supabase.from('analytes').delete().eq('id', id)
    loadAll()
  }

  const tabs = [
    { id: 'groups', label: 'Test Groups', icon: '📁' },
    { id: 'analytes', label: 'Global Analytes', icon: '🧬' },
    { id: 'tests', label: 'Test Catalog', icon: '🧪' }
  ]

  if (loading) return <div className="text-center py-8">Loading...</div>

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Test Management</h1>

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 rounded-lg font-medium ${
              activeTab === tab.id ? 'bg-blue-600 text-white' : 'bg-gray-100 hover:bg-gray-200'
            }`}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* Test Groups */}
      {activeTab === 'groups' && (
        <div className="card">
          <h2 className="text-lg font-semibold mb-4">Test Groups / Categories</h2>

          <div className="bg-gray-50 p-4 rounded-lg mb-4">
            <div className="grid grid-cols-3 gap-3">
              <input
                type="text"
                className="input"
                placeholder="Group Name (e.g., Hematology)"
                value={newGroup.name}
                onChange={(e) => setNewGroup({ ...newGroup, name: e.target.value })}
              />
              <input
                type="text"
                className="input"
                placeholder="Code (e.g., HEMA)"
                value={newGroup.code}
                onChange={(e) => setNewGroup({ ...newGroup, code: e.target.value.toUpperCase() })}
              />
              <button onClick={addGroup} className="btn btn-primary">Add Group</button>
            </div>
          </div>

          <table className="w-full">
            <thead>
              <tr className="text-left text-sm text-gray-500 border-b">
                <th className="pb-2">Order</th>
                <th className="pb-2">Name</th>
                <th className="pb-2">Code</th>
                <th className="pb-2">Tests</th>
                <th className="pb-2"></th>
              </tr>
            </thead>
            <tbody>
              {groups.map(group => (
                <tr key={group.id} className="border-b">
                  <td className="py-2">{group.display_order}</td>
                  <td className="py-2 font-medium">{group.name}</td>
                  <td className="py-2 font-mono text-sm">{group.code}</td>
                  <td className="py-2 text-gray-500">
                    {tests.filter(t => t.group_id === group.id).length} tests
                  </td>
                  <td className="py-2">
                    <button onClick={() => deleteGroup(group.id)} className="text-red-600 text-sm">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Global Analytes */}
      {activeTab === 'analytes' && (
        <div className="card">
          <h2 className="text-lg font-semibold mb-4">Global Analytes (Master List)</h2>
          <p className="text-sm text-gray-500 mb-4">
            Define analytes once here. They can be reused across multiple tests with custom reference ranges.
          </p>

          <div className="bg-gray-50 p-4 rounded-lg mb-4">
            <div className="grid grid-cols-6 gap-3 mb-3">
              <input
                type="text"
                className="input"
                placeholder="Code (HGB)"
                value={newAnalyte.code}
                onChange={(e) => setNewAnalyte({ ...newAnalyte, code: e.target.value.toUpperCase() })}
              />
              <input
                type="text"
                className="input"
                placeholder="Name"
                value={newAnalyte.name}
                onChange={(e) => setNewAnalyte({ ...newAnalyte, name: e.target.value })}
              />
              <input
                type="text"
                className="input"
                placeholder="Unit"
                value={newAnalyte.unit}
                onChange={(e) => setNewAnalyte({ ...newAnalyte, unit: e.target.value })}
              />
              <select
                className="input"
                value={newAnalyte.result_type}
                onChange={(e) => setNewAnalyte({ ...newAnalyte, result_type: e.target.value })}
              >
                <option value="numeric">Numeric</option>
                <option value="dropdown">Dropdown</option>
                <option value="text">Text</option>
              </select>
              <input
                type="text"
                className="input"
                placeholder="Default Ref Range"
                value={newAnalyte.default_ref_range}
                onChange={(e) => setNewAnalyte({ ...newAnalyte, default_ref_range: e.target.value })}
              />
              <button onClick={addAnalyte} className="btn btn-primary">Add</button>
            </div>
            {newAnalyte.result_type === 'dropdown' && (
              <input
                type="text"
                className="input"
                placeholder='Expected values: Negative, Trace, 1+, 2+ OR ["Negative", "Positive"]'
                value={newAnalyte.expected_values}
                onChange={(e) => setNewAnalyte({ ...newAnalyte, expected_values: e.target.value })}
              />
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="pb-2">Code</th>
                  <th className="pb-2">Name</th>
                  <th className="pb-2">Unit</th>
                  <th className="pb-2">Type</th>
                  <th className="pb-2">Reference Range</th>
                  <th className="pb-2">Expected Values</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {analytes.map(a => (
                  <tr key={a.id} className="border-b">
                    <td className="py-2 font-mono">{a.code}</td>
                    <td className="py-2 font-medium">{a.name}</td>
                    <td className="py-2">{a.unit}</td>
                    <td className="py-2">
                      <span className={`px-2 py-1 rounded text-xs ${
                        a.result_type === 'dropdown' ? 'bg-purple-100 text-purple-700' :
                        a.result_type === 'text' ? 'bg-blue-100 text-blue-700' :
                        'bg-gray-100'
                      }`}>
                        {a.result_type}
                      </span>
                    </td>
                    <td className="py-2">{a.default_ref_range}</td>
                    <td className="py-2 text-gray-500 max-w-xs truncate">
                      {a.result_type === 'dropdown' && Array.isArray(a.expected_values)
                        ? a.expected_values.join(', ')
                        : '-'}
                    </td>
                    <td className="py-2">
                      <button onClick={() => deleteAnalyte(a.id)} className="text-red-600">Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Test Catalog - Link to existing Settings page */}
      {activeTab === 'tests' && (
        <div className="card">
          <h2 className="text-lg font-semibold mb-4">Test Catalog</h2>
          <p className="text-gray-500 mb-4">
            Tests are managed in Settings → Test Catalog tab.
            Each test can include multiple analytes with custom reference ranges.
          </p>

          <table className="w-full">
            <thead>
              <tr className="text-left text-sm text-gray-500 border-b">
                <th className="pb-2">Code</th>
                <th className="pb-2">Name</th>
                <th className="pb-2">Department</th>
                <th className="pb-2">Sample</th>
                <th className="pb-2">Analytes</th>
                <th className="pb-2">Price</th>
              </tr>
            </thead>
            <tbody>
              {tests.map(test => (
                <tr key={test.id} className="border-b">
                  <td className="py-2 font-mono">{test.code}</td>
                  <td className="py-2 font-medium">{test.name}</td>
                  <td className="py-2">{test.department}</td>
                  <td className="py-2 text-sm text-gray-500">{test.sample_type}</td>
                  <td className="py-2">
                    {Array.isArray(test.analytes) ? (
                      <div className="flex flex-wrap gap-1">
                        {test.analytes.slice(0, 5).map((a, i) => (
                          <span key={i} className={`px-1 py-0.5 text-xs rounded ${
                            a.is_calculated ? 'bg-purple-100 text-purple-700' :
                            a.result_type === 'dropdown' ? 'bg-blue-100 text-blue-700' :
                            'bg-gray-100'
                          }`}>
                            {a.name}
                          </span>
                        ))}
                        {test.analytes.length > 5 && (
                          <span className="text-gray-400 text-xs">+{test.analytes.length - 5} more</span>
                        )}
                      </div>
                    ) : '-'}
                  </td>
                  <td className="py-2">₹{test.price}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
