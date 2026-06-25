/**
 * Claude AI Image-to-Results Extraction for Google Sheets LIMS
 * Uses Claude Vision API to extract lab values from analyzer printout images
 */

/**
 * Extract results from an image URL or Drive file
 * @param {string} imageSource - Google Drive file ID or public image URL
 * @param {Array} expectedAnalytes - Array of analyte names to look for
 * @returns {Array} - Array of {analyte, value, unit}
 */
function extractResultsFromImage(imageSource, expectedAnalytes) {
  const apiKey = getSetting('claude_api_key');
  if (!apiKey) {
    throw new Error('Claude API key not configured. Add claude_api_key in Settings sheet.');
  }

  // Get image as base64
  let imageBlob;
  let mediaType = 'image/jpeg';

  if (imageSource.startsWith('http')) {
    // Fetch from URL
    imageBlob = UrlFetchApp.fetch(imageSource).getBlob();
  } else {
    // Assume it's a Drive file ID
    const file = DriveApp.getFileById(imageSource);
    imageBlob = file.getBlob();
  }

  mediaType = imageBlob.getContentType() || 'image/jpeg';
  const base64 = Utilities.base64Encode(imageBlob.getBytes());

  const analyteList = expectedAnalytes.join(', ');

  const payload = {
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
            data: base64
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
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', options);
  const responseCode = response.getResponseCode();

  if (responseCode !== 200) {
    const error = JSON.parse(response.getContentText());
    throw new Error(error.error?.message || 'Claude API error: ' + responseCode);
  }

  const data = JSON.parse(response.getContentText());
  let content = data.content?.[0]?.text || '[]';

  // Remove markdown code blocks if present
  content = content.trim();
  if (content.startsWith('```')) {
    content = content.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
  }

  try {
    const results = JSON.parse(content);
    return Array.isArray(results) ? results : [];
  } catch (e) {
    console.error('Failed to parse Claude response:', content);
    return [];
  }
}

/**
 * Show AI extraction dialog
 */
function showAIExtractDialog() {
  const html = HtmlService.createHtmlOutputFromFile('AIExtractDialog')
    .setWidth(500)
    .setHeight(400)
    .setTitle('AI Extract Results from Image');
  SpreadsheetApp.getUi().showModalDialog(html, 'AI Extract Results');
}

/**
 * Process uploaded image for a specific order
 * Called from AIExtractDialog
 */
function processImageForOrder(orderNumber, driveFileId) {
  const order = findOrderByNumber(orderNumber);
  if (!order) throw new Error('Order not found');

  // Get tests for this order
  const orderTests = getOrderTests(order.order_id);
  if (orderTests.length === 0) throw new Error('No tests found for this order');

  // Collect all analytes from tests
  const allAnalytes = [];
  const analyteDetails = {};

  orderTests.forEach(ot => {
    const testAnalytes = getTestAnalytes(ot.test_code);
    testAnalytes.forEach(a => {
      if (!a.is_calculated) {
        allAnalytes.push(a.name);
        analyteDetails[a.name] = {
          test_code: ot.test_code,
          test_name: ot.test_name,
          unit: a.unit || '',
          reference_range: a.reference_range || ''
        };
      }
    });
  });

  // Extract from image
  const extracted = extractResultsFromImage(driveFileId, allAnalytes);

  if (extracted.length === 0) {
    return { success: false, message: 'No results found in image' };
  }

  // Match extracted to analytes
  const matched = matchExtractedToAnalytes(extracted, analyteDetails);

  return {
    success: true,
    matched: matched,
    count: matched.length
  };
}

/**
 * Match extracted results to expected analytes (fuzzy matching)
 */
function matchExtractedToAnalytes(extracted, analyteDetails) {
  const matched = [];

  Object.keys(analyteDetails).forEach(analyteName => {
    const lowerName = analyteName.toLowerCase();
    const details = analyteDetails[analyteName];

    // Find match in extracted
    const match = extracted.find(r => {
      const extractedName = (r.analyte || '').toLowerCase();
      return (
        extractedName === lowerName ||
        extractedName.includes(lowerName) ||
        lowerName.includes(extractedName) ||
        // Common abbreviations
        (lowerName === 'hemoglobin' && extractedName.includes('hgb')) ||
        (lowerName === 'hematocrit' && extractedName.includes('hct')) ||
        (lowerName.includes('wbc') && extractedName.includes('white')) ||
        (lowerName.includes('rbc') && extractedName.includes('red'))
      );
    });

    if (match) {
      matched.push({
        analyte: analyteName,
        value: match.value,
        unit: match.unit || details.unit,
        reference_range: details.reference_range,
        test_code: details.test_code,
        test_name: details.test_name
      });
    }
  });

  return matched;
}

/**
 * Save AI-extracted results
 */
function saveExtractedResults(orderNumber, results) {
  return saveResults(orderNumber, results);
}

/**
 * Get test analytes (uses existing function from ResultService.gs)
 */
function getOrderTests(orderId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEETS.ORDERS);
  if (!sheet || sheet.getLastRow() < 2) return [];

  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 8).getValues();
  const orderRow = data.find(row => row[0] === orderId);

  if (!orderRow || !orderRow[5]) return [];

  // Parse tests from order (stored as JSON or comma-separated)
  try {
    const tests = JSON.parse(orderRow[5]);
    return tests;
  } catch (e) {
    return orderRow[5].split(',').map(t => {
      const [code, name] = t.split(':');
      return { test_code: code?.trim(), test_name: name?.trim() || code?.trim() };
    });
  }
}
