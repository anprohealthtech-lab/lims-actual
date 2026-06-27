/**
 * Result Entry and Management Service
 */

function showResultEntryForm() {
  const html = HtmlService.createHtmlOutputFromFile('ResultEntry')
    .setWidth(600)
    .setHeight(700)
    .setTitle('Enter Results');
  SpreadsheetApp.getUi().showSidebar(html);
}

function getTestAnalytes(testCode) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEETS.TEST_CATALOG);
  if (!sheet || sheet.getLastRow() < 2) return [];

  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getValues();
  const test = data.find(row => row[0] === testCode);

  if (!test || !test[3]) return [{ name: testCode, unit: '', reference_range: '' }];

  // Parse analytes from JSON string or comma-separated
  try {
    const analytes = JSON.parse(test[3]);
    return analytes;
  } catch (e) {
    return test[3].split(',').map(a => ({
      name: a.trim(),
      unit: '',
      reference_range: ''
    }));
  }
}

function saveResults(orderNumber, results) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEETS.RESULTS);
  const user = getCurrentUser();
  const now = new Date();

  const order = findOrderByNumber(orderNumber);
  if (!order) throw new Error('Order not found');

  results.forEach(result => {
    const flag = calculateFlag(result.value, result.reference_range);

    sheet.appendRow([
      generateId(),
      order.order_id,
      orderNumber,
      result.test_code,
      result.test_name,
      result.analyte,
      result.value,
      result.unit,
      result.reference_range,
      flag,
      VERIFICATION_STATUS.PENDING,
      user.name,
      now,
      '', // verified_by
      '', // verified_at
      ''  // notes
    ]);
  });

  // Update order status
  updateOrderStatus(order.order_id, ORDER_STATUS.PROCESSING);

  return { success: true, count: results.length };
}

function calculateFlag(value, referenceRange) {
  if (!referenceRange || !value) return 'normal';

  const rangeStr = referenceRange.toString().trim();
  const numValue = parseFloat(value);

  // For text/dropdown values - check if matches expected
  if (isNaN(numValue)) {
    const normalizedValue = value.toString().toLowerCase().trim();
    const normalizedRef = rangeStr.toLowerCase().trim();

    // If value equals expected normal, it's normal
    if (normalizedValue === normalizedRef) return 'normal';

    // Common "normal" values for qualitative tests
    const normalValues = ['negative', 'non-reactive', 'nil', 'absent', 'clear', 'normal', 'few'];
    if (normalValues.includes(normalizedValue)) return 'normal';

    // Otherwise mark as abnormal
    return 'abnormal';
  }

  // Range format: "10-20" or "10 - 20"
  const rangeMatch = rangeStr.match(/^([\d.]+)\s*[-–]\s*([\d.]+)$/);
  if (rangeMatch) {
    const low = parseFloat(rangeMatch[1]);
    const high = parseFloat(rangeMatch[2]);
    if (numValue < low) return 'low';
    if (numValue > high) return 'high';
    return 'normal';
  }

  // Less than format: "< 100" or "<= 100"
  const ltMatch = rangeStr.match(/^[<]=?\s*([\d.]+)$/);
  if (ltMatch) {
    const max = parseFloat(ltMatch[1]);
    return numValue > max ? 'high' : 'normal';
  }

  // Greater than format: "> 5" or ">= 5"
  const gtMatch = rangeStr.match(/^[>]=?\s*([\d.]+)$/);
  if (gtMatch) {
    const min = parseFloat(gtMatch[1]);
    return numValue < min ? 'low' : 'normal';
  }

  return 'normal';
}

function getResultsForOrder(orderNumber) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEETS.RESULTS);
  if (!sheet || sheet.getLastRow() < 2) return [];

  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 16).getValues();

  return data
    .filter(row => row[2] === orderNumber)
    .map(row => ({
      result_id: row[0],
      order_id: row[1],
      order_number: row[2],
      test_code: row[3],
      test_name: row[4],
      analyte: row[5],
      value: row[6],
      unit: row[7],
      reference_range: row[8],
      flag: row[9],
      verification_status: row[10],
      entered_by: row[11],
      entered_at: row[12],
      verified_by: row[13],
      verified_at: row[14],
      notes: row[15]
    }));
}

function getPendingResults() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEETS.RESULTS);
  if (!sheet || sheet.getLastRow() < 2) return [];

  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 16).getValues();

  // Group by order
  const orderMap = {};
  data
    .filter(row => row[10] === VERIFICATION_STATUS.PENDING)
    .forEach(row => {
      const orderNumber = row[2];
      if (!orderMap[orderNumber]) {
        orderMap[orderNumber] = {
          order_number: orderNumber,
          results: []
        };
      }
      orderMap[orderNumber].results.push({
        result_id: row[0],
        test_name: row[4],
        analyte: row[5],
        value: row[6],
        unit: row[7],
        reference_range: row[8],
        flag: row[9]
      });
    });

  return Object.values(orderMap);
}
