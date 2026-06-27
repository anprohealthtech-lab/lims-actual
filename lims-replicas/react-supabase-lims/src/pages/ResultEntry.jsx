import { useState, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { calculateAnalyteValue } from '../lib/pdfReport'
import { extractResultsFromImage, fileToBase64, matchResultsToAnalytes } from '../lib/aiExtract'

export default function ResultEntry() {
  const [searchParams] = useSearchParams()
  const [orderNumber, setOrderNumber] = useState(searchParams.get('order') || '')
  const [order, setOrder] = useState(null)
  const [tests, setTests] = useState([])
  const [results, setResults] = useState({})
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [claudeApiKey, setClaudeApiKey] = useState('')
  const fileInputRef = useRef(null)

  useEffect(() => {
    if (searchParams.get('order')) {
      loadOrder(searchParams.get('order'))
    }
    // Load Claude API key from settings
    loadClaudeApiKey()
  }, [])

  async function loadClaudeApiKey() {
    const { data } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'claude_api_key')
      .single()
    if (data?.value) setClaudeApiKey(data.value)
  }

  async function loadOrder(orderNum) {
    setLoading(true)
    const num = orderNum || orderNumber

    // Get order with tests
    const { data: orderData, error: orderError } = await supabase
      .from('orders')
      .select('*, patients(name), order_tests(*, test_catalog(*))')
      .eq('order_number', num)
      .single()

    if (orderError || !orderData) {
      alert('Order not found')
      setLoading(false)
      return
    }

    setOrder(orderData)

    // Parse analytes for each test
    const testsWithAnalytes = orderData.order_tests.map(ot => {
      const catalog = ot.test_catalog
      let analytes = []

      if (catalog?.analytes) {
        try {
          analytes = typeof catalog.analytes === 'string'
            ? JSON.parse(catalog.analytes)
            : catalog.analytes
        } catch (e) {
          analytes = [{ name: catalog.name, unit: '', reference_range: '' }]
        }
      }

      return {
        ...ot,
        analytes
      }
    })

    setTests(testsWithAnalytes)

    // Load existing results
    const { data: existingResults } = await supabase
      .from('results')
      .select('*')
      .eq('order_id', orderData.id)

    const resultsMap = {}
    existingResults?.forEach(r => {
      resultsMap[`${r.test_code}_${r.analyte}`] = {
        value: r.value,
        unit: r.unit,
        reference_range: r.reference_range
      }
    })
    setResults(resultsMap)

    setLoading(false)
  }

  function handleResultChange(testCode, analyte, field, value) {
    const key = `${testCode}_${analyte}`
    const newResults = {
      ...results,
      [key]: {
        ...results[key],
        [field]: value
      }
    }
    setResults(newResults)

    // Auto-calculate dependent fields
    if (field === 'value') {
      autoCalculateFields(testCode, newResults)
    }
  }

  function autoCalculateFields(testCode, currentResults) {
    const test = tests.find(t => t.test_code === testCode)
    if (!test) return

    // Build existing results array for calculation
    const existingResults = test.analytes
      .map(a => {
        const key = `${testCode}_${a.name}`
        return {
          analyte: a.name,
          value: currentResults[key]?.value || ''
        }
      })
      .filter(r => r.value)

    // Find calculated analytes and compute their values
    const updatedResults = { ...currentResults }
    test.analytes.forEach(analyte => {
      if (analyte.is_calculated && analyte.formula) {
        const calcValue = calculateAnalyteValue(analyte.formula, existingResults)
        if (calcValue !== null) {
          const key = `${testCode}_${analyte.name}`
          updatedResults[key] = {
            ...updatedResults[key],
            value: String(calcValue),
            unit: analyte.unit || '',
            reference_range: analyte.reference_range || ''
          }
        }
      }
    })

    setResults(updatedResults)
  }

  function calculateFlag(value, refRange) {
    if (!refRange || !value) return 'normal'

    // For text/dropdown values - check if matches expected
    const numValue = parseFloat(value)
    if (isNaN(numValue)) {
      // Text comparison - if value equals refRange, it's normal
      const normalizedValue = value.toString().toLowerCase().trim()
      const normalizedRef = refRange.toString().toLowerCase().trim()
      if (normalizedValue === normalizedRef) return 'normal'
      // Common "normal" values for qualitative tests
      if (['negative', 'non-reactive', 'nil', 'absent', 'clear', 'normal'].includes(normalizedValue)) {
        return 'normal'
      }
      // If value doesn't match expected normal, mark as abnormal
      return 'abnormal'
    }

    // Numeric range: "10-20" or "10 - 20"
    const rangeMatch = refRange.match(/^([\d.]+)\s*[-–]\s*([\d.]+)$/)
    if (rangeMatch) {
      const low = parseFloat(rangeMatch[1])
      const high = parseFloat(rangeMatch[2])
      if (numValue < low) return 'low'
      if (numValue > high) return 'high'
      return 'normal'
    }

    // Less than: "< 100"
    const ltMatch = refRange.match(/^[<]\s*([\d.]+)$/)
    if (ltMatch) {
      return numValue > parseFloat(ltMatch[1]) ? 'high' : 'normal'
    }

    // Greater than: "> 5"
    const gtMatch = refRange.match(/^[>]\s*([\d.]+)$/)
    if (gtMatch) {
      return numValue < parseFloat(gtMatch[1]) ? 'low' : 'normal'
    }

    // Less than or equal: "<= 100"
    const lteMatch = refRange.match(/^[<]=?\s*([\d.]+)$/)
    if (lteMatch) {
      return numValue > parseFloat(lteMatch[1]) ? 'high' : 'normal'
    }

    // Greater than or equal: ">= 5"
    const gteMatch = refRange.match(/^[>]=?\s*([\d.]+)$/)
    if (gteMatch) {
      return numValue < parseFloat(gteMatch[1]) ? 'low' : 'normal'
    }

    return 'normal'
  }

  async function handleImageUpload(e) {
    const file = e.target.files?.[0]
    if (!file || tests.length === 0) return

    setExtracting(true)
    try {
      const { base64, mediaType } = await fileToBase64(file)

      // Get all analytes from current tests
      const allAnalytes = tests.flatMap(t => t.analytes.filter(a => !a.is_calculated))

      const extracted = await extractResultsFromImage(
        base64,
        mediaType,
        allAnalytes.map(a => a.name),
        claudeApiKey
      )

      if (extracted.length === 0) {
        alert('No results found in image. Please enter manually.')
        setExtracting(false)
        return
      }

      // Match and fill results
      const newResults = { ...results }
      tests.forEach(test => {
        const matched = matchResultsToAnalytes(extracted, test.analytes)
        Object.entries(matched).forEach(([analyteName, data]) => {
          const key = `${test.test_code}_${analyteName}`
          newResults[key] = {
            ...newResults[key],
            value: data.value,
            unit: data.unit || newResults[key]?.unit || ''
          }
        })
      })

      setResults(newResults)

      // Trigger auto-calculations
      tests.forEach(test => autoCalculateFields(test.test_code, newResults))

      alert(`Extracted ${extracted.length} values from image!`)
    } catch (err) {
      alert('AI extraction failed: ' + err.message)
    }
    setExtracting(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function saveResults() {
    if (!order) return
    setSaving(true)

    const resultRows = []

    tests.forEach(test => {
      test.analytes.forEach(analyte => {
        const key = `${test.test_code}_${analyte.name}`
        const resultData = results[key]

        if (resultData?.value) {
          const refRange = resultData.reference_range || analyte.reference_range || ''
          resultRows.push({
            order_id: order.id,
            test_code: test.test_code,
            test_name: test.test_name,
            analyte: analyte.name,
            value: resultData.value,
            unit: resultData.unit || analyte.unit || '',
            reference_range: refRange,
            flag: calculateFlag(resultData.value, refRange),
            is_calculated: analyte.is_calculated || false,
            verification_status: 'pending'
          })
        }
      })
    })

    if (resultRows.length === 0) {
      alert('Please enter at least one result')
      setSaving(false)
      return
    }

    // Delete existing results for this order
    await supabase.from('results').delete().eq('order_id', order.id)

    // Insert new results
    const { error } = await supabase.from('results').insert(resultRows)

    if (error) {
      alert('Error saving results: ' + error.message)
    } else {
      // Update order status
      await supabase.from('orders').update({ status: 'processing' }).eq('id', order.id)
      alert(`${resultRows.length} results saved successfully!`)
    }

    setSaving(false)
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Enter Results</h1>

      {/* Search */}
      <div className="card mb-6">
        <div className="flex gap-4">
          <input
            type="text"
            className="input flex-1"
            placeholder="Enter order number or barcode"
            value={orderNumber}
            onChange={(e) => setOrderNumber(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && loadOrder()}
          />
          <button onClick={() => loadOrder()} className="btn btn-primary">
            Load Order
          </button>
        </div>
      </div>

      {loading && <div className="text-center py-8">Loading order...</div>}

      {order && !loading && (
        <>
          {/* Order Info */}
          <div className="card mb-6 bg-blue-50">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <div className="text-sm text-gray-500">Order #</div>
                <div className="font-bold">{order.order_number}</div>
              </div>
              <div>
                <div className="text-sm text-gray-500">Patient</div>
                <div className="font-bold">{order.patients?.name}</div>
              </div>
              <div>
                <div className="text-sm text-gray-500">Doctor</div>
                <div className="font-bold">{order.doctor_name || 'N/A'}</div>
              </div>
              <div>
                <div className="text-sm text-gray-500">Status</div>
                <div className="font-bold">{order.status}</div>
              </div>
            </div>
          </div>

          {/* Result Entry */}
          {tests.map(test => (
            <div key={test.id} className="card mb-4">
              <h3 className="text-lg font-semibold mb-4 text-blue-600">
                {test.test_name} ({test.test_code})
              </h3>

              <div className="grid grid-cols-12 gap-2 text-sm font-medium text-gray-500 mb-2 px-2">
                <div className="col-span-3">Analyte</div>
                <div className="col-span-3">Value</div>
                <div className="col-span-2">Unit</div>
                <div className="col-span-3">Reference Range</div>
                <div className="col-span-1">Flag</div>
              </div>

              {test.analytes.map((analyte, idx) => {
                const key = `${test.test_code}_${analyte.name}`
                const resultData = results[key] || {}
                const flag = calculateFlag(resultData.value, resultData.reference_range || analyte.reference_range)
                const isDropdown = analyte.result_type === 'dropdown' && Array.isArray(analyte.expected_values) && analyte.expected_values.length > 0
                const isCalculated = analyte.is_calculated

                return (
                  <div key={idx} className={`grid grid-cols-12 gap-2 items-center py-2 border-b last:border-0 ${isCalculated ? 'bg-purple-50' : ''}`}>
                    <div className="col-span-3 font-medium">
                      {analyte.name}
                      {isCalculated && <span className="text-purple-600 text-xs ml-1">[Cal]</span>}
                    </div>
                    <div className="col-span-3">
                      {isDropdown ? (
                        <select
                          className={`input ${
                            flag === 'high' || flag === 'abnormal' ? 'border-red-500 bg-red-50' :
                            flag === 'low' ? 'border-yellow-500 bg-yellow-50' : ''
                          }`}
                          value={resultData.value || ''}
                          onChange={(e) => handleResultChange(test.test_code, analyte.name, 'value', e.target.value)}
                          disabled={isCalculated}
                        >
                          <option value="">-- Select --</option>
                          {analyte.expected_values.map((val, i) => {
                            const optValue = typeof val === 'object' ? val.value : val
                            const optLabel = typeof val === 'object' ? val.label : val
                            return <option key={i} value={optValue}>{optLabel}</option>
                          })}
                        </select>
                      ) : (
                        <input
                          type="text"
                          className={`input ${
                            flag === 'high' || flag === 'critical_high' ? 'border-red-500 bg-red-50' :
                            flag === 'low' || flag === 'critical_low' ? 'border-yellow-500 bg-yellow-50' : ''
                          } ${isCalculated ? 'bg-purple-100' : ''}`}
                          placeholder={isCalculated ? 'Auto' : 'Result'}
                          value={resultData.value || ''}
                          onChange={(e) => handleResultChange(test.test_code, analyte.name, 'value', e.target.value)}
                          readOnly={isCalculated}
                        />
                      )}
                    </div>
                    <div className="col-span-2">
                      <input
                        type="text"
                        className="input text-sm"
                        placeholder="Unit"
                        value={resultData.unit ?? analyte.unit ?? ''}
                        onChange={(e) => handleResultChange(test.test_code, analyte.name, 'unit', e.target.value)}
                      />
                    </div>
                    <div className="col-span-3">
                      <input
                        type="text"
                        className="input text-sm"
                        placeholder="Ref Range"
                        value={resultData.reference_range ?? analyte.reference_range ?? ''}
                        onChange={(e) => handleResultChange(test.test_code, analyte.name, 'reference_range', e.target.value)}
                      />
                    </div>
                    <div className="col-span-1">
                      <span className={`px-2 py-1 rounded text-xs font-bold ${
                        flag === 'high' || flag === 'critical_high' ? 'bg-red-100 text-red-700' :
                        flag === 'low' || flag === 'critical_low' ? 'bg-yellow-100 text-yellow-700' :
                        flag === 'abnormal' ? 'bg-orange-100 text-orange-700' :
                        'bg-green-100 text-green-700'
                      }`}>
                        {flag.toUpperCase()}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          ))}

          {/* AI Extract + Save Buttons */}
          <div className="flex gap-4 items-center">
            <input
              type="file"
              ref={fileInputRef}
              accept="image/*"
              onChange={handleImageUpload}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={extracting || !claudeApiKey}
              className="btn btn-secondary"
              title={!claudeApiKey ? 'Add Claude API key in Settings' : 'Upload analyzer image'}
            >
              {extracting ? 'Extracting...' : '📷 AI Extract from Image'}
            </button>
            <button
              onClick={saveResults}
              disabled={saving}
              className="btn btn-success"
            >
              {saving ? 'Saving...' : '💾 Save Results'}
            </button>
          </div>
          {!claudeApiKey && (
            <p className="text-sm text-gray-500 mt-2">
              Add your Claude API key in Settings to enable AI image extraction.
            </p>
          )}
        </>
      )}
    </div>
  )
}
