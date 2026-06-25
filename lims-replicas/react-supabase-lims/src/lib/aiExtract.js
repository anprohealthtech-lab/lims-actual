/**
 * Claude AI Image-to-Results Extraction
 * Single API call - extracts lab values from analyzer printout images
 */

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages'

/**
 * Extract lab results from an image using Claude Vision
 * @param {string} imageBase64 - Base64 encoded image data (without data:image prefix)
 * @param {string} mediaType - Image type: 'image/jpeg', 'image/png', 'image/webp'
 * @param {Array} expectedAnalytes - Array of analyte names to look for
 * @param {string} apiKey - Claude API key
 * @returns {Promise<Array>} - Array of {analyte, value, unit}
 */
export async function extractResultsFromImage(imageBase64, mediaType, expectedAnalytes, apiKey) {
  if (!apiKey) {
    throw new Error('Claude API key is required. Add it in Settings.')
  }

  const analyteList = expectedAnalytes.join(', ')

  const response = await fetch(CLAUDE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType,
              data: imageBase64
            }
          },
          {
            type: 'text',
            text: `Extract lab test results from this image. Look for these analytes: ${analyteList}

Return ONLY a JSON array with the extracted values. Each item should have:
- "analyte": exact name from the list above (match as closely as possible)
- "value": the numeric or text value
- "unit": the unit if visible

Example response:
[{"analyte": "Hemoglobin", "value": "14.5", "unit": "g/dL"}, {"analyte": "WBC", "value": "8200", "unit": "/uL"}]

If a value is not found in the image, do not include it. Return only the JSON array, no other text.`
          }
        ]
      }]
    })
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error?.message || 'Claude API error')
  }

  const data = await response.json()
  const content = data.content?.[0]?.text || '[]'

  // Parse JSON from response (Claude may include markdown code blocks)
  let jsonStr = content.trim()
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```/g, '').trim()
  }

  try {
    const results = JSON.parse(jsonStr)
    return Array.isArray(results) ? results : []
  } catch (e) {
    console.error('Failed to parse Claude response:', content)
    return []
  }
}

/**
 * Convert File to base64
 * @param {File} file - Image file
 * @returns {Promise<{base64: string, mediaType: string}>}
 */
export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result
      const base64 = dataUrl.split(',')[1]
      const mediaType = file.type || 'image/jpeg'
      resolve({ base64, mediaType })
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

/**
 * Match extracted results to expected analytes (fuzzy matching)
 * @param {Array} extractedResults - Results from Claude
 * @param {Array} expectedAnalytes - Analyte definitions from test catalog
 * @returns {Object} - Map of analyteName -> {value, unit}
 */
export function matchResultsToAnalytes(extractedResults, expectedAnalytes) {
  const matched = {}

  expectedAnalytes.forEach(analyte => {
    const analyteName = analyte.name.toLowerCase()

    // Find best match in extracted results
    const match = extractedResults.find(r => {
      const extracted = (r.analyte || '').toLowerCase()
      return (
        extracted === analyteName ||
        extracted.includes(analyteName) ||
        analyteName.includes(extracted) ||
        // Common abbreviations
        (analyteName === 'hemoglobin' && extracted.includes('hgb')) ||
        (analyteName === 'hematocrit' && extracted.includes('hct')) ||
        (analyteName.includes('wbc') && extracted.includes('white')) ||
        (analyteName.includes('rbc') && extracted.includes('red'))
      )
    })

    if (match) {
      matched[analyte.name] = {
        value: match.value,
        unit: match.unit || analyte.unit || ''
      }
    }
  })

  return matched
}
