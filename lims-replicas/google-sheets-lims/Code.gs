/**
 * LIMS Mini - Google Sheets Edition
 * Main entry point and menu setup
 */

// Sheet names
const SHEETS = {
  PATIENTS: 'Patients',
  ORDERS: 'Orders',
  ORDER_TESTS: 'OrderTests',
  RESULTS: 'Results',
  TEST_CATALOG: 'TestCatalog',
  TEST_GROUPS: 'TestGroups',
  ANALYTES: 'Analytes',
  USERS: 'Users',
  SETTINGS: 'Settings'
};

// Order/Result statuses
const ORDER_STATUS = {
  REGISTERED: 'registered',
  SAMPLE_COLLECTED: 'sample_collected',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  VERIFIED: 'verified'
};

const VERIFICATION_STATUS = {
  PENDING: 'pending',
  VERIFIED: 'verified',
  REJECTED: 'rejected'
};

function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('🔬 LIMS')
    .addItem('📋 New Order', 'showNewOrderForm')
    .addItem('🔍 Find Order', 'showFindOrderForm')
    .addSeparator()
    .addItem('📝 Enter Results', 'showResultEntryForm')
    .addItem('📷 AI Extract Results', 'showAIExtractDialog')
    .addItem('✅ Verify Results', 'showVerificationQueue')
    .addSeparator()
    .addItem('📄 Generate Report', 'showReportDialog')
    .addItem('🔐 Verify Report', 'showVerifyDialog')
    .addSeparator()
    .addSubMenu(ui.createMenu('⚙️ Setup')
      .addItem('Initialize Sheets', 'initializeSheets')
      .addItem('Load Sample Data', 'loadSampleData')
      .addItem('🧪 Manage Tests', 'showTestManagement'))
    .addToUi();
}

function initializeSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Patients sheet
  createSheetIfNotExists(ss, SHEETS.PATIENTS, [
    'patient_id', 'name', 'dob', 'gender', 'phone', 'email', 'address', 'created_at'
  ]);

  // Orders sheet
  createSheetIfNotExists(ss, SHEETS.ORDERS, [
    'order_id', 'order_number', 'patient_id', 'patient_name', 'doctor_name',
    'order_date', 'status', 'priority', 'barcode', 'notes', 'created_by', 'created_at'
  ]);

  // Order Tests (line items)
  createSheetIfNotExists(ss, SHEETS.ORDER_TESTS, [
    'order_test_id', 'order_id', 'test_code', 'test_name', 'department'
  ]);

  // Results
  createSheetIfNotExists(ss, SHEETS.RESULTS, [
    'result_id', 'order_id', 'order_number', 'test_code', 'test_name', 'analyte',
    'value', 'unit', 'reference_range', 'flag', 'verification_status',
    'entered_by', 'entered_at', 'verified_by', 'verified_at', 'notes'
  ]);

  // Test Groups
  createSheetIfNotExists(ss, SHEETS.TEST_GROUPS, [
    'group_id', 'name', 'code', 'display_order', 'is_active'
  ]);

  // Global Analytes Master
  createSheetIfNotExists(ss, SHEETS.ANALYTES, [
    'analyte_id', 'code', 'name', 'unit', 'result_type', 'expected_values', 'default_ref_range', 'ref_range_male', 'ref_range_female', 'critical_low', 'critical_high', 'decimal_places'
  ]);

  // Test Catalog
  createSheetIfNotExists(ss, SHEETS.TEST_CATALOG, [
    'test_code', 'test_name', 'group_code', 'department', 'analytes', 'sample_type', 'price'
  ]);

  // Users
  createSheetIfNotExists(ss, SHEETS.USERS, [
    'user_id', 'email', 'name', 'role', 'active'
  ]);

  // Settings
  createSheetIfNotExists(ss, SHEETS.SETTINGS, [
    'key', 'value', 'description'
  ]);

  SpreadsheetApp.getUi().alert('✅ All sheets initialized successfully!');
}

function createSheetIfNotExists(ss, sheetName, headers) {
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length)
      .setBackground('#4285f4')
      .setFontColor('#ffffff')
      .setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function generateId() {
  return Utilities.getUuid().substring(0, 8);
}

function generateOrderNumber() {
  const today = new Date();
  const dateStr = Utilities.formatDate(today, Session.getScriptTimeZone(), 'yyMMdd');
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ordersSheet = ss.getSheetByName(SHEETS.ORDERS);
  const lastRow = ordersSheet.getLastRow();

  let todayCount = 1;
  if (lastRow > 1) {
    const orders = ordersSheet.getRange(2, 2, lastRow - 1, 1).getValues();
    const todayOrders = orders.filter(o => o[0] && o[0].toString().includes(dateStr));
    todayCount = todayOrders.length + 1;
  }

  return `ORD-${dateStr}-${String(todayCount).padStart(3, '0')}`;
}

function generateBarcode(orderNumber) {
  return orderNumber.replace(/-/g, '');
}

function getCurrentUser() {
  const email = Session.getActiveUser().getEmail();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const usersSheet = ss.getSheetByName(SHEETS.USERS);

  if (!usersSheet || usersSheet.getLastRow() < 2) {
    return { email: email, name: email, role: 'Admin' };
  }

  const users = usersSheet.getDataRange().getValues();
  for (let i = 1; i < users.length; i++) {
    if (users[i][1] === email) {
      return { email: email, name: users[i][2], role: users[i][3] };
    }
  }
  return { email: email, name: email, role: 'Technician' };
}
