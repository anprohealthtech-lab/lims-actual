/**
 * Order Management Service
 */

function showNewOrderForm() {
  const html = HtmlService.createHtmlOutputFromFile('OrderForm')
    .setWidth(500)
    .setHeight(600)
    .setTitle('New Order');
  SpreadsheetApp.getUi().showSidebar(html);
}

function showFindOrderForm() {
  const html = HtmlService.createHtmlOutputFromFile('FindOrder')
    .setWidth(400)
    .setHeight(300)
    .setTitle('Find Order');
  SpreadsheetApp.getUi().showSidebar(html);
}

function getTestCatalog() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEETS.TEST_CATALOG);
  if (!sheet || sheet.getLastRow() < 2) return [];

  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).getValues();
  return data.map(row => ({
    test_code: row[0],
    test_name: row[1],
    department: row[2],
    analytes: row[3],
    sample_type: row[4],
    price: row[5]
  }));
}

function searchPatients(query) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEETS.PATIENTS);
  if (!sheet || sheet.getLastRow() < 2) return [];

  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 8).getValues();
  const lowerQuery = query.toLowerCase();

  return data
    .filter(row => row[1].toString().toLowerCase().includes(lowerQuery) ||
                   row[4].toString().includes(query))
    .slice(0, 10)
    .map(row => ({
      patient_id: row[0],
      name: row[1],
      dob: row[2],
      gender: row[3],
      phone: row[4]
    }));
}

function createPatient(patientData) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEETS.PATIENTS);

  const patientId = generateId();
  const now = new Date();

  sheet.appendRow([
    patientId,
    patientData.name,
    patientData.dob,
    patientData.gender,
    patientData.phone,
    patientData.email || '',
    patientData.address || '',
    now
  ]);

  return patientId;
}

function createOrder(orderData) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ordersSheet = ss.getSheetByName(SHEETS.ORDERS);
  const orderTestsSheet = ss.getSheetByName(SHEETS.ORDER_TESTS);

  const orderId = generateId();
  const orderNumber = generateOrderNumber();
  const barcode = generateBarcode(orderNumber);
  const now = new Date();
  const user = getCurrentUser();

  // Create order
  ordersSheet.appendRow([
    orderId,
    orderNumber,
    orderData.patient_id,
    orderData.patient_name,
    orderData.doctor_name || '',
    now,
    ORDER_STATUS.REGISTERED,
    orderData.priority || 'Normal',
    barcode,
    orderData.notes || '',
    user.name,
    now
  ]);

  // Add order tests
  orderData.tests.forEach(test => {
    orderTestsSheet.appendRow([
      generateId(),
      orderId,
      test.test_code,
      test.test_name,
      test.department
    ]);
  });

  return { orderId, orderNumber, barcode };
}

function findOrderByNumber(orderNumber) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ordersSheet = ss.getSheetByName(SHEETS.ORDERS);
  const orderTestsSheet = ss.getSheetByName(SHEETS.ORDER_TESTS);

  if (ordersSheet.getLastRow() < 2) return null;

  const orders = ordersSheet.getRange(2, 1, ordersSheet.getLastRow() - 1, 12).getValues();
  const orderRow = orders.find(row =>
    row[1] === orderNumber || row[8] === orderNumber.replace(/-/g, '')
  );

  if (!orderRow) return null;

  const orderId = orderRow[0];

  // Get tests for this order
  const allTests = orderTestsSheet.getRange(2, 1, Math.max(1, orderTestsSheet.getLastRow() - 1), 5).getValues();
  const orderTests = allTests.filter(t => t[1] === orderId).map(t => ({
    test_code: t[2],
    test_name: t[3],
    department: t[4]
  }));

  return {
    order_id: orderRow[0],
    order_number: orderRow[1],
    patient_id: orderRow[2],
    patient_name: orderRow[3],
    doctor_name: orderRow[4],
    order_date: orderRow[5],
    status: orderRow[6],
    priority: orderRow[7],
    barcode: orderRow[8],
    tests: orderTests
  };
}

function updateOrderStatus(orderId, status) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEETS.ORDERS);
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === orderId) {
      sheet.getRange(i + 1, 7).setValue(status);
      return true;
    }
  }
  return false;
}
