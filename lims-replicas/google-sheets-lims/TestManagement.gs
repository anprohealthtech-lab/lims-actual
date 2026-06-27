/**
 * Test Management Service
 * Manage Test Groups, Global Analytes, and Test Catalog
 */

function showTestManagement() {
  const html = HtmlService.createHtmlOutputFromFile('TestManagement')
    .setWidth(800)
    .setHeight(600)
    .setTitle('Test Management');
  SpreadsheetApp.getUi().showModalDialog(html, 'Test Management');
}

// ==========================================
// TEST GROUPS
// ==========================================

function getTestGroups() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEETS.TEST_GROUPS);
  if (!sheet || sheet.getLastRow() < 2) return [];

  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 5).getValues();
  return data.map(row => ({
    group_id: row[0],
    name: row[1],
    code: row[2],
    display_order: row[3],
    is_active: row[4]
  })).filter(g => g.name);
}

function addTestGroup(name, code) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEETS.TEST_GROUPS);
  const groups = getTestGroups();

  sheet.appendRow([
    generateId(),
    name,
    code.toUpperCase(),
    groups.length + 1,
    true
  ]);

  return { success: true };
}

function deleteTestGroup(groupId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEETS.TEST_GROUPS);
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === groupId) {
      sheet.deleteRow(i + 1);
      return { success: true };
    }
  }
  return { success: false, error: 'Group not found' };
}

// ==========================================
// GLOBAL ANALYTES
// ==========================================

function getGlobalAnalytes() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEETS.ANALYTES);
  if (!sheet || sheet.getLastRow() < 2) return [];

  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 12).getValues();
  return data.map(row => ({
    analyte_id: row[0],
    code: row[1],
    name: row[2],
    unit: row[3],
    result_type: row[4] || 'numeric',
    expected_values: parseExpectedValues(row[5]),
    default_ref_range: row[6],
    ref_range_male: row[7],
    ref_range_female: row[8],
    critical_low: row[9],
    critical_high: row[10],
    decimal_places: row[11] || 2
  })).filter(a => a.code);
}

function parseExpectedValues(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  try {
    return JSON.parse(val);
  } catch (e) {
    return val.split(',').map(v => v.trim());
  }
}

function addGlobalAnalyte(analyte) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEETS.ANALYTES);

  let expectedValues = '';
  if (analyte.expected_values) {
    if (Array.isArray(analyte.expected_values)) {
      expectedValues = JSON.stringify(analyte.expected_values);
    } else {
      expectedValues = JSON.stringify(analyte.expected_values.split(',').map(v => v.trim()));
    }
  }

  sheet.appendRow([
    generateId(),
    analyte.code.toUpperCase(),
    analyte.name,
    analyte.unit || '',
    analyte.result_type || 'numeric',
    expectedValues,
    analyte.default_ref_range || '',
    analyte.ref_range_male || '',
    analyte.ref_range_female || '',
    analyte.critical_low || '',
    analyte.critical_high || '',
    analyte.decimal_places || 2
  ]);

  return { success: true };
}

function deleteGlobalAnalyte(analyteId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEETS.ANALYTES);
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === analyteId) {
      sheet.deleteRow(i + 1);
      return { success: true };
    }
  }
  return { success: false, error: 'Analyte not found' };
}

// ==========================================
// TEST CATALOG
// ==========================================

function getTestCatalogFull() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEETS.TEST_CATALOG);
  if (!sheet || sheet.getLastRow() < 2) return [];

  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 7).getValues();
  return data.map(row => {
    let analytes = [];
    try {
      analytes = typeof row[4] === 'string' ? JSON.parse(row[4]) : row[4];
    } catch (e) {
      analytes = [];
    }

    return {
      test_code: row[0],
      test_name: row[1],
      group_code: row[2],
      department: row[3],
      analytes: analytes,
      sample_type: row[5],
      price: row[6]
    };
  }).filter(t => t.test_code);
}

function addTest(test) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEETS.TEST_CATALOG);

  let analytes = test.analytes || [];
  if (typeof analytes === 'string') {
    try {
      analytes = JSON.parse(analytes);
    } catch (e) {
      analytes = [];
    }
  }

  sheet.appendRow([
    test.test_code.toUpperCase(),
    test.test_name,
    test.group_code || '',
    test.department || '',
    JSON.stringify(analytes),
    test.sample_type || '',
    test.price || 0
  ]);

  return { success: true };
}

function updateTestAnalytes(testCode, analytes) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEETS.TEST_CATALOG);
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === testCode) {
      sheet.getRange(i + 1, 5).setValue(JSON.stringify(analytes));
      return { success: true };
    }
  }
  return { success: false, error: 'Test not found' };
}

function deleteTest(testCode) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEETS.TEST_CATALOG);
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === testCode) {
      sheet.deleteRow(i + 1);
      return { success: true };
    }
  }
  return { success: false, error: 'Test not found' };
}

// ==========================================
// UTILITY: Import analyte from global to test
// ==========================================

function getAnalyteTemplate(analyteCode) {
  const analytes = getGlobalAnalytes();
  const found = analytes.find(a => a.code === analyteCode);
  if (!found) return null;

  return {
    name: found.name,
    code: found.code,
    unit: found.unit,
    result_type: found.result_type,
    expected_values: found.expected_values,
    reference_range: found.default_ref_range,
    reference_range_male: found.ref_range_male,
    reference_range_female: found.ref_range_female,
    is_calculated: false
  };
}
