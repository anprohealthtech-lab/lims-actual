import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export default function Settings() {
  const [settings, setSettings] = useState({})
  const [tests, setTests] = useState([])
  const [brandingAssets, setBrandingAssets] = useState([])
  const [saving, setSaving] = useState(false)
  const [activeTab, setActiveTab] = useState('general')
  const [newTest, setNewTest] = useState({ code: '', name: '', department: '', price: '', analytes: '' })

  useEffect(() => {
    loadSettings()
    loadTests()
    loadBrandingAssets()
  }, [])

  async function loadSettings() {
    const { data } = await supabase.from('settings').select('*')
    const settingsMap = {}
    data?.forEach(s => {
      settingsMap[s.key] = s.value
    })
    setSettings(settingsMap)
  }

  async function loadTests() {
    const { data } = await supabase.from('test_catalog').select('*').order('name')
    setTests(data || [])
  }

  async function loadBrandingAssets() {
    const { data } = await supabase.from('branding_assets').select('*').order('created_at', { ascending: false })
    setBrandingAssets(data || [])
  }

  async function saveSetting(key, value) {
    await supabase.from('settings').upsert({ key, value }, { onConflict: 'key' })
    setSettings({ ...settings, [key]: value })
  }

  async function saveAllSettings() {
    setSaving(true)
    for (const [key, value] of Object.entries(settings)) {
      await supabase.from('settings').upsert({ key, value: String(value) }, { onConflict: 'key' })
    }
    setSaving(false)
    alert('Settings saved!')
  }

  async function addTest() {
    if (!newTest.code || !newTest.name) {
      alert('Code and name are required')
      return
    }

    let analytes = []
    if (newTest.analytes) {
      try {
        analytes = JSON.parse(newTest.analytes)
      } catch {
        analytes = newTest.analytes.split(',').map(a => ({
          name: a.trim(),
          unit: '',
          reference_range: ''
        }))
      }
    }

    const { error } = await supabase.from('test_catalog').insert([{
      code: newTest.code,
      name: newTest.name,
      department: newTest.department,
      price: parseFloat(newTest.price) || 0,
      analytes
    }])

    if (error) {
      alert('Error adding test: ' + error.message)
    } else {
      setNewTest({ code: '', name: '', department: '', price: '', analytes: '' })
      loadTests()
    }
  }

  async function deleteTest(id) {
    if (!confirm('Delete this test?')) return
    const { error } = await supabase.from('test_catalog').delete().eq('id', id)
    if (!error) loadTests()
  }

  async function uploadBrandingAsset(file, assetType) {
    const fileName = `${assetType}_${Date.now()}_${file.name}`
    const { data, error } = await supabase.storage
      .from('branding')
      .upload(fileName, file)

    if (error) {
      alert('Upload failed: ' + error.message)
      return
    }

    const { data: { publicUrl } } = supabase.storage.from('branding').getPublicUrl(fileName)

    await supabase.from('branding_assets').insert([{
      asset_type: assetType,
      asset_name: file.name,
      file_url: publicUrl,
      file_type: file.type
    }])

    loadBrandingAssets()
  }

  const tabs = [
    { id: 'general', label: 'Lab Info', icon: '🏥' },
    { id: 'report', label: 'Report Style', icon: '📄' },
    { id: 'branding', label: 'Header/Footer', icon: '🎨' },
    { id: 'signatures', label: 'Signatures', icon: '✍️' },
    { id: 'tests', label: 'Test Catalog', icon: '🧪' },
    { id: 'qr', label: 'QR Verification', icon: '📱' },
    { id: 'ai', label: 'AI Settings', icon: '🤖' }
  ]

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Settings</h1>

      {/* Tabs */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              activeTab === tab.id
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* Lab Info */}
      {activeTab === 'general' && (
        <div className="card">
          <h2 className="text-lg font-semibold mb-4">Lab Information</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">Lab Name</label>
              <input
                type="text"
                className="input"
                value={settings.lab_name || ''}
                onChange={(e) => setSettings({ ...settings, lab_name: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Phone</label>
              <input
                type="tel"
                className="input"
                value={settings.lab_phone || ''}
                onChange={(e) => setSettings({ ...settings, lab_phone: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Email</label>
              <input
                type="email"
                className="input"
                value={settings.lab_email || ''}
                onChange={(e) => setSettings({ ...settings, lab_email: e.target.value })}
              />
            </div>
            <div>
              <label className="label">License/Reg No</label>
              <input
                type="text"
                className="input"
                value={settings.lab_license || ''}
                onChange={(e) => setSettings({ ...settings, lab_license: e.target.value })}
              />
            </div>
            <div className="md:col-span-2">
              <label className="label">Address</label>
              <input
                type="text"
                className="input"
                value={settings.lab_address || ''}
                onChange={(e) => setSettings({ ...settings, lab_address: e.target.value })}
              />
            </div>
          </div>
          <button onClick={saveAllSettings} disabled={saving} className="btn btn-primary mt-4">
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      )}

      {/* Report Style */}
      {activeTab === 'report' && (
        <div className="card">
          <h2 className="text-lg font-semibold mb-4">Report Display Settings</h2>

          <div className="space-y-6">
            {/* Font Size */}
            <div>
              <label className="label">Base Font Size (px)</label>
              <input
                type="number"
                className="input w-32"
                min="8"
                max="16"
                value={settings.base_font_size || 12}
                onChange={(e) => setSettings({ ...settings, base_font_size: e.target.value })}
              />
            </div>

            {/* Flag Colors */}
            <div className="p-4 bg-gray-50 rounded-lg">
              <div className="flex items-center justify-between mb-4">
                <label className="font-medium">Enable Colored Flags</label>
                <input
                  type="checkbox"
                  checked={settings.flag_colors_enabled !== 'false'}
                  onChange={(e) => setSettings({ ...settings, flag_colors_enabled: String(e.target.checked) })}
                  className="w-5 h-5"
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="text-sm text-gray-600">HIGH Color</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={settings.flag_color_high || '#dc2626'}
                      onChange={(e) => setSettings({ ...settings, flag_color_high: e.target.value })}
                      className="h-10 w-16 p-1 border rounded"
                    />
                    <span className="text-xs">{settings.flag_color_high || '#dc2626'}</span>
                  </div>
                </div>
                <div>
                  <label className="text-sm text-gray-600">LOW Color</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={settings.flag_color_low || '#ea580c'}
                      onChange={(e) => setSettings({ ...settings, flag_color_low: e.target.value })}
                      className="h-10 w-16 p-1 border rounded"
                    />
                    <span className="text-xs">{settings.flag_color_low || '#ea580c'}</span>
                  </div>
                </div>
                <div>
                  <label className="text-sm text-gray-600">NORMAL Color</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={settings.flag_color_normal || '#16a34a'}
                      onChange={(e) => setSettings({ ...settings, flag_color_normal: e.target.value })}
                      className="h-10 w-16 p-1 border rounded"
                    />
                    <span className="text-xs">{settings.flag_color_normal || '#16a34a'}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Display Options */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <label className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.bold_abnormal_values !== 'false'}
                  onChange={(e) => setSettings({ ...settings, bold_abnormal_values: String(e.target.checked) })}
                  className="w-5 h-5"
                />
                <span>Bold Abnormal Values</span>
              </label>
              <label className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.show_flag_asterisk !== 'false'}
                  onChange={(e) => setSettings({ ...settings, show_flag_asterisk: String(e.target.checked) })}
                  className="w-5 h-5"
                />
                <span>Show * for Flagged</span>
              </label>
              <label className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.show_calculated_marker !== 'false'}
                  onChange={(e) => setSettings({ ...settings, show_calculated_marker: String(e.target.checked) })}
                  className="w-5 h-5"
                />
                <span>Show [Cal] Marker</span>
              </label>
            </div>

            {/* Footer Text */}
            <div>
              <label className="label">Footer Text</label>
              <textarea
                className="input"
                rows={2}
                value={settings.footer_text || ''}
                onChange={(e) => setSettings({ ...settings, footer_text: e.target.value })}
              />
            </div>
          </div>

          <button onClick={saveAllSettings} disabled={saving} className="btn btn-primary mt-4">
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      )}

      {/* Branding / Header Footer */}
      {activeTab === 'branding' && (
        <div className="card">
          <h2 className="text-lg font-semibold mb-4">Header & Footer Images</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Header */}
            <div>
              <label className="label">Header Image</label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) uploadBrandingAsset(file, 'header')
                }}
                className="input"
              />
              {brandingAssets.filter(a => a.asset_type === 'header').slice(0, 1).map(asset => (
                <div key={asset.id} className="mt-2 p-2 border rounded">
                  <img src={asset.file_url} alt="Header" className="max-h-20" />
                  <p className="text-xs text-gray-500 mt-1">{asset.asset_name}</p>
                </div>
              ))}
            </div>

            {/* Footer */}
            <div>
              <label className="label">Footer Image</label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) uploadBrandingAsset(file, 'footer')
                }}
                className="input"
              />
              {brandingAssets.filter(a => a.asset_type === 'footer').slice(0, 1).map(asset => (
                <div key={asset.id} className="mt-2 p-2 border rounded">
                  <img src={asset.file_url} alt="Footer" className="max-h-20" />
                  <p className="text-xs text-gray-500 mt-1">{asset.asset_name}</p>
                </div>
              ))}
            </div>

            {/* Logo */}
            <div>
              <label className="label">Logo</label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) uploadBrandingAsset(file, 'logo')
                }}
                className="input"
              />
              {brandingAssets.filter(a => a.asset_type === 'logo').slice(0, 1).map(asset => (
                <div key={asset.id} className="mt-2 p-2 border rounded">
                  <img src={asset.file_url} alt="Logo" className="max-h-16" />
                </div>
              ))}
            </div>

            {/* Letterhead */}
            <div>
              <label className="label">Full Letterhead Background</label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) uploadBrandingAsset(file, 'letterhead')
                }}
                className="input"
              />
              {brandingAssets.filter(a => a.asset_type === 'letterhead').slice(0, 1).map(asset => (
                <div key={asset.id} className="mt-2 p-2 border rounded">
                  <img src={asset.file_url} alt="Letterhead" className="max-h-32" />
                </div>
              ))}
            </div>
          </div>

          <div className="mt-6 p-4 bg-blue-50 rounded-lg text-sm text-blue-700">
            <strong>Note:</strong> Upload images (PNG, JPG) for your header/footer.
            Recommended width: 800-1200px. These will appear on all generated reports.
          </div>
        </div>
      )}

      {/* Signatures */}
      {activeTab === 'signatures' && (
        <div className="card">
          <h2 className="text-lg font-semibold mb-4">Signature Settings</h2>

          <div className="space-y-4">
            <label className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg cursor-pointer">
              <input
                type="checkbox"
                checked={settings.signature_enabled !== 'false'}
                onChange={(e) => setSettings({ ...settings, signature_enabled: String(e.target.checked) })}
                className="w-5 h-5"
              />
              <span>Enable Signature Section</span>
            </label>

            <div>
              <label className="label">Number of Signatures (1-3)</label>
              <select
                className="input w-32"
                value={settings.signature_count || '2'}
                onChange={(e) => setSettings({ ...settings, signature_count: e.target.value })}
              >
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="3">3</option>
              </select>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="label">Signature 1 Label</label>
                <input
                  type="text"
                  className="input"
                  value={settings.signature_1_name || 'Lab Technician'}
                  onChange={(e) => setSettings({ ...settings, signature_1_name: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Signature 2 Label</label>
                <input
                  type="text"
                  className="input"
                  value={settings.signature_2_name || 'Pathologist'}
                  onChange={(e) => setSettings({ ...settings, signature_2_name: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Signature 3 Label</label>
                <input
                  type="text"
                  className="input"
                  value={settings.signature_3_name || ''}
                  onChange={(e) => setSettings({ ...settings, signature_3_name: e.target.value })}
                />
              </div>
            </div>

            {/* Signature image uploads */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[1, 2, 3].map(i => (
                <div key={i}>
                  <label className="label">Signature {i} Image</label>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) uploadBrandingAsset(file, `signature_${i}`)
                    }}
                    className="input text-sm"
                  />
                  {brandingAssets.filter(a => a.asset_type === `signature_${i}`).slice(0, 1).map(asset => (
                    <div key={asset.id} className="mt-2">
                      <img src={asset.file_url} alt={`Signature ${i}`} className="max-h-12 border rounded p-1" />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>

          <button onClick={saveAllSettings} disabled={saving} className="btn btn-primary mt-4">
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      )}

      {/* Test Catalog */}
      {activeTab === 'tests' && (
        <div className="card">
          <h2 className="text-lg font-semibold mb-4">Test Catalog</h2>

          {/* Add Test Form */}
          <div className="bg-gray-50 p-4 rounded-lg mb-6">
            <h3 className="font-medium mb-3">Add New Test</h3>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <input
                type="text"
                className="input"
                placeholder="Code (e.g., CBC)"
                value={newTest.code}
                onChange={(e) => setNewTest({ ...newTest, code: e.target.value })}
              />
              <input
                type="text"
                className="input"
                placeholder="Name"
                value={newTest.name}
                onChange={(e) => setNewTest({ ...newTest, name: e.target.value })}
              />
              <input
                type="text"
                className="input"
                placeholder="Department"
                value={newTest.department}
                onChange={(e) => setNewTest({ ...newTest, department: e.target.value })}
              />
              <input
                type="number"
                className="input"
                placeholder="Price"
                value={newTest.price}
                onChange={(e) => setNewTest({ ...newTest, price: e.target.value })}
              />
              <button onClick={addTest} className="btn btn-primary">Add</button>
            </div>
            <div className="mt-3">
              <input
                type="text"
                className="input"
                placeholder='Analytes JSON: [{"name":"Hb","unit":"g/dL","reference_range":"12-16","is_calculated":false}]'
                value={newTest.analytes}
                onChange={(e) => setNewTest({ ...newTest, analytes: e.target.value })}
              />
              <p className="text-xs text-gray-500 mt-1">
                For calculated fields add: "is_calculated": true, "formula": "Total Protein - Albumin"
              </p>
            </div>
          </div>

          {/* Test List */}
          <table className="w-full">
            <thead>
              <tr className="text-left text-sm text-gray-500 border-b">
                <th className="pb-2">Code</th>
                <th className="pb-2">Name</th>
                <th className="pb-2">Department</th>
                <th className="pb-2">Price</th>
                <th className="pb-2">Analytes</th>
                <th className="pb-2"></th>
              </tr>
            </thead>
            <tbody>
              {tests.map(test => (
                <tr key={test.id} className="border-b last:border-0">
                  <td className="py-2 font-mono">{test.code}</td>
                  <td className="py-2 font-medium">{test.name}</td>
                  <td className="py-2">{test.department}</td>
                  <td className="py-2">₹{test.price}</td>
                  <td className="py-2 text-sm text-gray-500">
                    {Array.isArray(test.analytes)
                      ? test.analytes.map(a => (
                          <span key={a.name} className={a.is_calculated ? 'text-purple-600' : ''}>
                            {a.name}{a.is_calculated ? ' [Cal]' : ''}{', '}
                          </span>
                        ))
                      : '-'}
                  </td>
                  <td className="py-2">
                    <button
                      onClick={() => deleteTest(test.id)}
                      className="text-red-600 hover:underline text-sm"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* QR Verification Settings */}
      {activeTab === 'qr' && (
        <div className="card">
          <h2 className="text-lg font-semibold mb-4">QR Code Verification</h2>

          <div className="space-y-6">
            <label className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg cursor-pointer">
              <input
                type="checkbox"
                checked={settings.qr_enabled !== 'false'}
                onChange={(e) => setSettings({ ...settings, qr_enabled: String(e.target.checked) })}
                className="w-5 h-5"
              />
              <div>
                <span className="font-medium">Enable QR Code on Reports</span>
                <p className="text-sm text-gray-500">Adds a scannable QR code for online verification</p>
              </div>
            </label>

            <div>
              <label className="label">QR Code Position</label>
              <select
                className="input w-48"
                value={settings.qr_position || 'bottom_right'}
                onChange={(e) => setSettings({ ...settings, qr_position: e.target.value })}
              >
                <option value="bottom_right">Bottom Right</option>
                <option value="bottom_left">Bottom Left</option>
                <option value="top_right">Top Right</option>
              </select>
            </div>

            <div>
              <label className="label">Verification Base URL (optional)</label>
              <input
                type="url"
                className="input"
                placeholder="https://your-lab-domain.com"
                value={settings.verify_base_url || ''}
                onChange={(e) => setSettings({ ...settings, verify_base_url: e.target.value })}
              />
              <p className="text-sm text-gray-500 mt-1">
                Leave blank to use current domain. QR links to: {settings.verify_base_url || window.location.origin}/verify?order=...
              </p>
            </div>

            <div className="p-4 bg-green-50 rounded-lg">
              <h3 className="font-medium text-green-800 mb-2">How Verification Works</h3>
              <ul className="text-sm text-green-700 space-y-1 list-disc list-inside">
                <li>Each report gets a unique verification code based on order details</li>
                <li>QR code links to your /verify page with order number and code</li>
                <li>Anyone can scan to verify report authenticity</li>
                <li>Shows patient name, date, and result count if valid</li>
              </ul>
            </div>
          </div>

          <button onClick={saveAllSettings} disabled={saving} className="btn btn-primary mt-4">
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      )}

      {/* AI Settings */}
      {activeTab === 'ai' && (
        <div className="card">
          <h2 className="text-lg font-semibold mb-4">AI Image Extraction Settings</h2>

          <div className="space-y-6">
            <div>
              <label className="label">Claude API Key</label>
              <input
                type="password"
                className="input"
                placeholder="sk-ant-api03-..."
                value={settings.claude_api_key || ''}
                onChange={(e) => setSettings({ ...settings, claude_api_key: e.target.value })}
              />
              <p className="text-sm text-gray-500 mt-1">
                Get your API key from{' '}
                <a
                  href="https://console.anthropic.com/settings/keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline"
                >
                  console.anthropic.com
                </a>
              </p>
            </div>

            <div className="p-4 bg-blue-50 rounded-lg">
              <h3 className="font-medium text-blue-800 mb-2">How AI Extraction Works</h3>
              <ul className="text-sm text-blue-700 space-y-1 list-disc list-inside">
                <li>Upload a photo of your analyzer printout in Result Entry</li>
                <li>Claude Vision reads the image and extracts values</li>
                <li>Results are matched to your test analytes automatically</li>
                <li>Review extracted values and save</li>
              </ul>
            </div>

            <div className="p-4 bg-yellow-50 rounded-lg">
              <h3 className="font-medium text-yellow-800 mb-2">Cost Estimate</h3>
              <p className="text-sm text-yellow-700">
                Claude Sonnet costs ~$0.003 per image extraction (typical analyzer printout).
                At 100 extractions/day, expect ~$9/month.
              </p>
            </div>
          </div>

          <button onClick={saveAllSettings} disabled={saving} className="btn btn-primary mt-4">
            {saving ? 'Saving...' : 'Save API Key'}
          </button>
        </div>
      )}
    </div>
  )
}
