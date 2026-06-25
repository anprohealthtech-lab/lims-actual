/**
 * Result Verification Service
 */

function showVerificationQueue() {
  const html = HtmlService.createHtmlOutputFromFile('VerificationQueue')
    .setWidth(700)
    .setHeight(600)
    .setTitle('Verification Queue');
  SpreadsheetApp.getUi().showSidebar(html);
}

function verifyResults(orderNumber, resultIds, action, notes) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEETS.RESULTS);
  const user = getCurrentUser();
  const now = new Date();

  // Check role
  if (!['Admin', 'LabManager', 'Pathologist'].includes(user.role)) {
    throw new Error('You do not have permission to verify results');
  }

  const data = sheet.getDataRange().getValues();
  const headers = data[0];

  const verificationStatusCol = headers.indexOf('verification_status') + 1;
  const verifiedByCol = headers.indexOf('verified_by') + 1;
  const verifiedAtCol = headers.indexOf('verified_at') + 1;
  const notesCol = headers.indexOf('notes') + 1;

  let verifiedCount = 0;

  for (let i = 1; i < data.length; i++) {
    const resultId = data[i][0];
    if (resultIds.includes(resultId)) {
      const rowNum = i + 1;
      const newStatus = action === 'verify' ? VERIFICATION_STATUS.VERIFIED : VERIFICATION_STATUS.REJECTED;

      sheet.getRange(rowNum, verificationStatusCol).setValue(newStatus);
      sheet.getRange(rowNum, verifiedByCol).setValue(user.name);
      sheet.getRange(rowNum, verifiedAtCol).setValue(now);
      if (notes) {
        sheet.getRange(rowNum, notesCol).setValue(notes);
      }
      verifiedCount++;
    }
  }

  // Check if all results for this order are verified
  const orderResults = getResultsForOrder(orderNumber);
  const allVerified = orderResults.every(r => r.verification_status === VERIFICATION_STATUS.VERIFIED);

  if (allVerified && orderResults.length > 0) {
    const order = findOrderByNumber(orderNumber);
    if (order) {
      updateOrderStatus(order.order_id, ORDER_STATUS.VERIFIED);
    }
  }

  return { success: true, verifiedCount };
}

function getVerificationStats() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const resultsSheet = ss.getSheetByName(SHEETS.RESULTS);
  const ordersSheet = ss.getSheetByName(SHEETS.ORDERS);

  const stats = {
    pendingVerification: 0,
    verifiedToday: 0,
    totalOrders: 0,
    ordersToday: 0
  };

  if (resultsSheet && resultsSheet.getLastRow() > 1) {
    const results = resultsSheet.getRange(2, 1, resultsSheet.getLastRow() - 1, 16).getValues();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    results.forEach(row => {
      if (row[10] === VERIFICATION_STATUS.PENDING) {
        stats.pendingVerification++;
      }
      if (row[10] === VERIFICATION_STATUS.VERIFIED && row[14]) {
        const verifiedDate = new Date(row[14]);
        verifiedDate.setHours(0, 0, 0, 0);
        if (verifiedDate.getTime() === today.getTime()) {
          stats.verifiedToday++;
        }
      }
    });
  }

  if (ordersSheet && ordersSheet.getLastRow() > 1) {
    const orders = ordersSheet.getRange(2, 1, ordersSheet.getLastRow() - 1, 12).getValues();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    stats.totalOrders = orders.length;

    orders.forEach(row => {
      if (row[5]) {
        const orderDate = new Date(row[5]);
        orderDate.setHours(0, 0, 0, 0);
        if (orderDate.getTime() === today.getTime()) {
          stats.ordersToday++;
        }
      }
    });
  }

  return stats;
}
