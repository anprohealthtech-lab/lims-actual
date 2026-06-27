/**
 * Sample Data Loader with Full Settings
 */

function loadSampleData() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert(
    'Load Sample Data',
    'This will add sample test groups, analytes, test catalog and settings. Continue?',
    ui.ButtonSet.YES_NO
  );

  if (response !== ui.Button.YES) return;

  loadTestGroups();
  loadGlobalAnalytes();
  loadTestCatalog();
  loadSettings();
  loadSampleUsers();

  ui.alert('✅ Sample data loaded successfully!');
}

function loadTestGroups() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEETS.TEST_GROUPS);

  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 5).clearContent();
  }

  const groups = [
    [generateId(), 'Hematology', 'HEMA', 1, true],
    [generateId(), 'Biochemistry', 'BIOC', 2, true],
    [generateId(), 'Clinical Pathology', 'CLIP', 3, true],
    [generateId(), 'Immunology', 'IMMU', 4, true],
    [generateId(), 'Microbiology', 'MICR', 5, true],
    [generateId(), 'Serology', 'SERO', 6, true]
  ];

  groups.forEach(g => sheet.appendRow(g));
}

function loadGlobalAnalytes() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEETS.ANALYTES);

  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 12).clearContent();
  }

  const analytes = [
    // Hematology
    [generateId(), 'HGB', 'Hemoglobin', 'g/dL', 'numeric', '', '12-16', '13-17', '12-15', '7', '20', 1],
    [generateId(), 'WBC', 'WBC Count', 'x10^3/uL', 'numeric', '', '4-11', '', '', '2', '30', 2],
    [generateId(), 'RBC', 'RBC Count', 'x10^6/uL', 'numeric', '', '4.5-5.5', '', '', '', '', 2],
    [generateId(), 'PLT', 'Platelet Count', 'x10^3/uL', 'numeric', '', '150-400', '', '', '50', '1000', 0],

    // Biochemistry
    [generateId(), 'GLU_F', 'Glucose (Fasting)', 'mg/dL', 'numeric', '', '70-100', '', '', '40', '400', 0],
    [generateId(), 'UREA', 'Urea', 'mg/dL', 'numeric', '', '15-40', '', '', '', '200', 1],
    [generateId(), 'CREAT', 'Creatinine', 'mg/dL', 'numeric', '', '0.7-1.3', '', '', '', '10', 2],
    [generateId(), 'CHOL', 'Total Cholesterol', 'mg/dL', 'numeric', '', '< 200', '', '', '', '', 0],
    [generateId(), 'TRIG', 'Triglycerides', 'mg/dL', 'numeric', '', '< 150', '', '', '', '500', 0],
    [generateId(), 'HDL', 'HDL Cholesterol', 'mg/dL', 'numeric', '', '> 40', '', '', '', '', 0],
    [generateId(), 'TSH', 'TSH', 'mIU/L', 'numeric', '', '0.4-4.0', '', '', '', '', 2],

    // Urine - Dropdown types
    [generateId(), 'URIN_COL', 'Urine Color', '', 'dropdown', JSON.stringify(['Pale Yellow', 'Yellow', 'Dark Yellow', 'Amber', 'Red', 'Brown']), 'Pale Yellow', '', '', '', '', 0],
    [generateId(), 'URIN_APP', 'Urine Appearance', '', 'dropdown', JSON.stringify(['Clear', 'Slightly Turbid', 'Turbid', 'Cloudy']), 'Clear', '', '', '', '', 0],
    [generateId(), 'URIN_PRO', 'Urine Protein', '', 'dropdown', JSON.stringify(['Negative', 'Trace', '1+', '2+', '3+', '4+']), 'Negative', '', '', '', '', 0],
    [generateId(), 'URIN_GLU', 'Urine Glucose', '', 'dropdown', JSON.stringify(['Negative', 'Trace', '1+', '2+', '3+', '4+']), 'Negative', '', '', '', '', 0],

    // Serology - Dropdown types
    [generateId(), 'HIV', 'HIV I & II', '', 'dropdown', JSON.stringify(['Negative', 'Positive', 'Indeterminate']), 'Negative', '', '', '', '', 0],
    [generateId(), 'HBS_AG', 'HBsAg', '', 'dropdown', JSON.stringify(['Negative', 'Positive']), 'Negative', '', '', '', '', 0],
    [generateId(), 'VDRL', 'VDRL', '', 'dropdown', JSON.stringify(['Non-Reactive', 'Reactive', 'Weakly Reactive']), 'Non-Reactive', '', '', '', '', 0],
    [generateId(), 'WIDAL_O', 'Widal TO', '', 'dropdown', JSON.stringify(['Negative', '1:20', '1:40', '1:80', '1:160', '1:320']), 'Negative', '', '', '', '', 0],
    [generateId(), 'WIDAL_H', 'Widal TH', '', 'dropdown', JSON.stringify(['Negative', '1:20', '1:40', '1:80', '1:160', '1:320']), 'Negative', '', '', '', '', 0]
  ];

  analytes.forEach(a => sheet.appendRow(a));
}

function loadTestCatalog() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEETS.TEST_CATALOG);

  // Clear existing data (keep header)
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).clearContent();
  }

  const tests = [
    ['CBC', 'Complete Blood Count', 'Hematology',
     JSON.stringify([
       { name: 'Hemoglobin', unit: 'g/dL', reference_range: '12-16', gender_specific: { male: '13-17', female: '12-15' } },
       { name: 'WBC', unit: 'x10^3/uL', reference_range: '4-11' },
       { name: 'RBC', unit: 'x10^6/uL', reference_range: '4.5-5.5' },
       { name: 'Platelets', unit: 'x10^3/uL', reference_range: '150-400' },
       { name: 'Hematocrit', unit: '%', reference_range: '36-48' },
       { name: 'MCV', unit: 'fL', reference_range: '80-100', is_calculated: true, formula: 'Hematocrit/RBC*10' },
       { name: 'MCH', unit: 'pg', reference_range: '27-33', is_calculated: true, formula: 'Hemoglobin/RBC*10' },
       { name: 'MCHC', unit: 'g/dL', reference_range: '32-36', is_calculated: true, formula: 'Hemoglobin/Hematocrit*100' }
     ]), 'EDTA Blood', 300],

    ['LFT', 'Liver Function Test', 'Biochemistry',
     JSON.stringify([
       { name: 'Bilirubin Total', unit: 'mg/dL', reference_range: '0.1-1.2' },
       { name: 'Bilirubin Direct', unit: 'mg/dL', reference_range: '0-0.3' },
       { name: 'Bilirubin Indirect', unit: 'mg/dL', reference_range: '0.1-0.9', is_calculated: true, formula: 'Bilirubin Total - Bilirubin Direct' },
       { name: 'SGOT/AST', unit: 'U/L', reference_range: '10-40' },
       { name: 'SGPT/ALT', unit: 'U/L', reference_range: '7-56' },
       { name: 'Alkaline Phosphatase', unit: 'U/L', reference_range: '44-147' },
       { name: 'Total Protein', unit: 'g/dL', reference_range: '6-8' },
       { name: 'Albumin', unit: 'g/dL', reference_range: '3.5-5' },
       { name: 'Globulin', unit: 'g/dL', reference_range: '2-3.5', is_calculated: true, formula: 'Total Protein - Albumin' },
       { name: 'A/G Ratio', unit: '', reference_range: '1-2', is_calculated: true, formula: 'Albumin / Globulin' }
     ]), 'Serum', 500],

    ['KFT', 'Kidney Function Test', 'Biochemistry',
     JSON.stringify([
       { name: 'Urea', unit: 'mg/dL', reference_range: '15-40' },
       { name: 'Creatinine', unit: 'mg/dL', reference_range: '0.7-1.3' },
       { name: 'Uric Acid', unit: 'mg/dL', reference_range: '3.5-7.2' },
       { name: 'BUN', unit: 'mg/dL', reference_range: '7-20', is_calculated: true, formula: 'Urea * 0.467' },
       { name: 'BUN/Creatinine Ratio', unit: '', reference_range: '10-20', is_calculated: true, formula: 'BUN / Creatinine' }
     ]), 'Serum', 400],

    ['LIPID', 'Lipid Profile', 'Biochemistry',
     JSON.stringify([
       { name: 'Total Cholesterol', unit: 'mg/dL', reference_range: '< 200' },
       { name: 'Triglycerides', unit: 'mg/dL', reference_range: '< 150' },
       { name: 'HDL Cholesterol', unit: 'mg/dL', reference_range: '> 40' },
       { name: 'LDL Cholesterol', unit: 'mg/dL', reference_range: '< 100', is_calculated: true, formula: 'Total Cholesterol - HDL - (Triglycerides/5)' },
       { name: 'VLDL Cholesterol', unit: 'mg/dL', reference_range: '< 30', is_calculated: true, formula: 'Triglycerides / 5' },
       { name: 'TC/HDL Ratio', unit: '', reference_range: '< 4.5', is_calculated: true, formula: 'Total Cholesterol / HDL' },
       { name: 'LDL/HDL Ratio', unit: '', reference_range: '< 3', is_calculated: true, formula: 'LDL / HDL' }
     ]), 'Serum (Fasting)', 450],

    ['TSH', 'Thyroid Stimulating Hormone', 'Immunology',
     JSON.stringify([
       { name: 'TSH', unit: 'mIU/L', reference_range: '0.4-4.0' }
     ]), 'Serum', 350],

    ['TFT', 'Thyroid Function Test', 'Immunology',
     JSON.stringify([
       { name: 'TSH', unit: 'mIU/L', reference_range: '0.4-4.0' },
       { name: 'T3', unit: 'ng/dL', reference_range: '80-200' },
       { name: 'T4', unit: 'ug/dL', reference_range: '5-12' },
       { name: 'Free T3', unit: 'pg/mL', reference_range: '2.3-4.2' },
       { name: 'Free T4', unit: 'ng/dL', reference_range: '0.8-1.8' }
     ]), 'Serum', 800],

    ['FBS', 'Fasting Blood Sugar', 'Biochemistry',
     JSON.stringify([
       { name: 'Glucose (Fasting)', unit: 'mg/dL', reference_range: '70-100' }
     ]), 'Fluoride Blood', 100],

    ['PPBS', 'Post Prandial Blood Sugar', 'Biochemistry',
     JSON.stringify([
       { name: 'Glucose (PP)', unit: 'mg/dL', reference_range: '< 140' }
     ]), 'Fluoride Blood', 100],

    ['HBA1C', 'Glycated Hemoglobin', 'Biochemistry',
     JSON.stringify([
       { name: 'HbA1c', unit: '%', reference_range: '< 5.7' },
       { name: 'Estimated Avg Glucose', unit: 'mg/dL', reference_range: '', is_calculated: true, formula: '(HbA1c * 28.7) - 46.7' }
     ]), 'EDTA Blood', 400],

    ['URINE', 'Urine Routine & Microscopy', 'Clinical Pathology',
     JSON.stringify([
       { name: 'Color', unit: '', result_type: 'dropdown', expected_values: ['Pale Yellow', 'Yellow', 'Dark Yellow', 'Amber', 'Red', 'Brown'], reference_range: 'Pale Yellow' },
       { name: 'Appearance', unit: '', result_type: 'dropdown', expected_values: ['Clear', 'Slightly Turbid', 'Turbid', 'Cloudy'], reference_range: 'Clear' },
       { name: 'pH', unit: '', result_type: 'numeric', reference_range: '4.5-8' },
       { name: 'Specific Gravity', unit: '', result_type: 'numeric', reference_range: '1.005-1.030' },
       { name: 'Protein', unit: '', result_type: 'dropdown', expected_values: ['Negative', 'Trace', '1+', '2+', '3+', '4+'], reference_range: 'Negative' },
       { name: 'Glucose', unit: '', result_type: 'dropdown', expected_values: ['Negative', 'Trace', '1+', '2+', '3+', '4+'], reference_range: 'Negative' },
       { name: 'Ketones', unit: '', result_type: 'dropdown', expected_values: ['Negative', 'Trace', 'Small', 'Moderate', 'Large'], reference_range: 'Negative' },
       { name: 'Blood', unit: '', result_type: 'dropdown', expected_values: ['Negative', 'Trace', '1+', '2+', '3+'], reference_range: 'Negative' },
       { name: 'RBC', unit: '/HPF', result_type: 'numeric', reference_range: '0-2' },
       { name: 'Pus Cells', unit: '/HPF', result_type: 'numeric', reference_range: '0-5' },
       { name: 'Epithelial Cells', unit: '/HPF', result_type: 'dropdown', expected_values: ['Nil', 'Few', 'Moderate', 'Many'], reference_range: 'Few' }
     ]), 'Urine', 150],

    ['WIDAL', 'Widal Test', 'Serology',
     JSON.stringify([
       { name: 'Salmonella Typhi O', result_type: 'dropdown', expected_values: ['Negative', '1:20', '1:40', '1:80', '1:160', '1:320'], reference_range: 'Negative' },
       { name: 'Salmonella Typhi H', result_type: 'dropdown', expected_values: ['Negative', '1:20', '1:40', '1:80', '1:160', '1:320'], reference_range: 'Negative' },
       { name: 'Salmonella Paratyphi AH', result_type: 'dropdown', expected_values: ['Negative', '1:20', '1:40', '1:80', '1:160', '1:320'], reference_range: 'Negative' },
       { name: 'Salmonella Paratyphi BH', result_type: 'dropdown', expected_values: ['Negative', '1:20', '1:40', '1:80', '1:160', '1:320'], reference_range: 'Negative' }
     ]), 'Serum', 250],

    ['HIV', 'HIV I & II Antibody', 'Serology',
     JSON.stringify([
       { name: 'HIV I & II', result_type: 'dropdown', expected_values: ['Negative', 'Positive', 'Indeterminate'], reference_range: 'Negative' }
     ]), 'Serum', 300],

    ['HBS', 'HBsAg', 'Serology',
     JSON.stringify([
       { name: 'HBsAg', result_type: 'dropdown', expected_values: ['Negative', 'Positive'], reference_range: 'Negative' }
     ]), 'Serum', 250],

    ['VDRL', 'VDRL Test', 'Serology',
     JSON.stringify([
       { name: 'VDRL', result_type: 'dropdown', expected_values: ['Non-Reactive', 'Reactive', 'Weakly Reactive'], reference_range: 'Non-Reactive' }
     ]), 'Serum', 200],

    ['RA', 'Rheumatoid Factor', 'Serology',
     JSON.stringify([
       { name: 'RA Factor', result_type: 'dropdown', expected_values: ['Negative', 'Positive'], reference_range: 'Negative' }
     ]), 'Serum', 250],

    ['CRP', 'C-Reactive Protein', 'Serology',
     JSON.stringify([
       { name: 'CRP', unit: 'mg/L', result_type: 'dropdown', expected_values: ['Negative', 'Positive', '6', '12', '24', '48', '96'], reference_range: 'Negative' }
     ]), 'Serum', 250],

    ['ASO', 'ASO Titre', 'Serology',
     JSON.stringify([
       { name: 'ASO Titre', unit: 'IU/mL', result_type: 'dropdown', expected_values: ['< 200', '200', '400', '800', '1600'], reference_range: '< 200' }
     ]), 'Serum', 250]
  ];

  tests.forEach(test => sheet.appendRow(test));
}

function loadSettings() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEETS.SETTINGS);

  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).clearContent();
  }

  const settings = [
    // Lab Information
    ['lab_name', 'Your Diagnostic Laboratory', 'Name of the laboratory'],
    ['lab_address', '123 Medical Center Road, City - 400001', 'Laboratory address'],
    ['lab_phone', '+91 9876543210', 'Contact number'],
    ['lab_email', 'lab@example.com', 'Laboratory email'],
    ['lab_license', 'NABL/MCI-12345', 'License/Registration number'],

    // Header/Footer Images (Google Drive URLs)
    ['header_image_url', '', 'URL to header image (from Google Drive)'],
    ['footer_image_url', '', 'URL to footer image (from Google Drive)'],
    ['logo_url', '', 'URL to lab logo image'],
    ['letterhead_url', '', 'URL to full letterhead background'],

    // Report Text Settings
    ['header_text', '', 'Custom header text (if no image)'],
    ['footer_text', 'This is a computer-generated report. Validated results do not require signature.', 'Report footer text'],

    // PDF Layout Settings
    ['header_height', '90', 'Header height in pixels'],
    ['footer_height', '80', 'Footer height in pixels'],
    ['margin_top', '100', 'Top margin in pixels'],
    ['margin_bottom', '80', 'Bottom margin in pixels'],
    ['margin_left', '20', 'Left margin in pixels'],
    ['margin_right', '20', 'Right margin in pixels'],

    // Result Display Settings
    ['base_font_size', '12', 'Base font size for reports (10-16)'],
    ['flag_colors_enabled', 'true', 'Enable colored flags (true/false)'],
    ['flag_color_high', '#dc2626', 'Color for HIGH values (red)'],
    ['flag_color_low', '#ea580c', 'Color for LOW values (orange)'],
    ['flag_color_normal', '#16a34a', 'Color for NORMAL values (green)'],
    ['flag_color_critical', '#7f1d1d', 'Color for CRITICAL values (dark red)'],
    ['bold_abnormal_values', 'true', 'Bold abnormal values (true/false)'],
    ['show_flag_asterisk', 'true', 'Show asterisk for flagged values'],
    ['show_calculated_marker', 'true', 'Show [Cal] marker for calculated values'],

    // Signature Settings
    ['signature_enabled', 'true', 'Enable signature section (true/false)'],
    ['signature_count', '2', 'Number of signature slots (1-3)'],
    ['signature_1_name', 'Lab Technician', 'First signature label'],
    ['signature_1_image_url', '', 'First signature image URL'],
    ['signature_2_name', 'Pathologist', 'Second signature label'],
    ['signature_2_image_url', '', 'Second signature image URL'],
    ['signature_3_name', '', 'Third signature label (optional)'],
    ['signature_3_image_url', '', 'Third signature image URL'],

    // Watermark Settings
    ['watermark_enabled', 'false', 'Enable watermark (true/false)'],
    ['watermark_image_url', '', 'Watermark image URL'],
    ['watermark_opacity', '0.15', 'Watermark opacity (0.05-0.5)'],
    ['watermark_position', 'center', 'Watermark position (center/repeat)'],

    // QR Code Settings
    ['qr_enabled', 'true', 'Enable QR code on reports (true/false)'],
    ['qr_position', 'bottom_right', 'QR code position (bottom_left/bottom_right/top_right)'],
    ['verify_base_url', '', 'Base URL for verification page (optional)'],
    ['web_app_url', '', 'Google Apps Script Web App URL for verification'],

    // Barcode Settings
    ['barcode_prefix', 'LAB', 'Prefix for barcode generation'],

    // AI Settings
    ['claude_api_key', '', 'Claude API key for AI image extraction (from console.anthropic.com)']
  ];

  settings.forEach(setting => sheet.appendRow(setting));
}

function loadSampleUsers() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEETS.USERS);

  const currentEmail = Session.getActiveUser().getEmail();

  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 5).clearContent();
  }

  const users = [
    [generateId(), currentEmail, 'Admin User', 'Admin', true],
    [generateId(), 'technician@example.com', 'Lab Technician', 'Technician', true],
    [generateId(), 'manager@example.com', 'Lab Manager', 'LabManager', true],
    [generateId(), 'reception@example.com', 'Receptionist', 'Receptionist', true]
  ];

  users.forEach(user => sheet.appendRow(user));
}

/**
 * Get all settings as an object
 */
function getAllSettings() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEETS.SETTINGS);

  const defaults = {};
  if (!sheet || sheet.getLastRow() < 2) return defaults;

  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
  data.forEach(row => {
    if (row[0]) {
      // Parse booleans and numbers
      let value = row[1];
      if (value === 'true') value = true;
      else if (value === 'false') value = false;
      else if (!isNaN(value) && value !== '') value = parseFloat(value);
      defaults[row[0]] = value;
    }
  });

  return defaults;
}

/**
 * Get a single setting value
 */
function getSetting(key) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEETS.SETTINGS);
  if (!sheet || sheet.getLastRow() < 2) return null;

  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
  for (let i = 0; i < data.length; i++) {
    if (data[i][0] === key) {
      return data[i][1];
    }
  }
  return null;
}

/**
 * Update a single setting
 */
function updateSetting(key, value) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEETS.SETTINGS);
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === key) {
      sheet.getRange(i + 1, 2).setValue(value);
      return true;
    }
  }

  // Key not found, add new row
  sheet.appendRow([key, value, '']);
  return true;
}
