# LIMS Mini - Google Sheets Edition

A minimal Laboratory Information Management System built entirely on Google Sheets + Apps Script.

## Features

- ✅ Patient registration
- ✅ Order creation with test selection
- ✅ Barcode generation
- ✅ Result entry with auto-flagging
- ✅ Verification workflow
- ✅ PDF report generation
- ✅ Role-based access (basic)

## Setup Instructions

### 1. Create Google Spreadsheet

1. Go to [Google Sheets](https://sheets.google.com)
2. Create a new blank spreadsheet
3. Name it "LIMS Mini"

### 2. Add Apps Script Code

1. Go to **Extensions → Apps Script**
2. Delete the default `Code.gs` content
3. Create the following files and paste the code:

| File Name | Purpose |
|-----------|---------|
| `Code.gs` | Main menu, initialization |
| `OrderService.gs` | Order & patient management |
| `ResultService.gs` | Result entry |
| `VerificationService.gs` | Verification workflow |
| `ReportService.gs` | PDF report generation |
| `SampleData.gs` | Sample test catalog |

4. Create HTML files:

| File Name | Purpose |
|-----------|---------|
| `OrderForm.html` | New order sidebar |
| `ResultEntry.html` | Result entry form |
| `VerificationQueue.html` | Verification queue |
| `ReportDialog.html` | Report generation |
| `FindOrder.html` | Order search |

### 3. Initialize

1. Save all files (Ctrl+S)
2. Refresh your spreadsheet
3. Click **🔬 LIMS → ⚙️ Setup → Initialize Sheets**
4. Click **🔬 LIMS → ⚙️ Setup → Load Sample Data**

### 4. Configure Settings

Edit the `Settings` sheet to customize:
- `lab_name` - Your laboratory name
- `lab_address` - Address for reports
- `lab_phone` - Contact number
- `footer_text` - Report footer

## Usage

### Creating an Order
1. Click **🔬 LIMS → 📋 New Order**
2. Search for existing patient or create new
3. Select tests from catalog
4. Click **Create Order**

### Entering Results
1. Click **🔬 LIMS → 📝 Enter Results**
2. Enter order number or scan barcode
3. Fill in result values (auto-flags abnormal)
4. Click **Save Results**

### Verifying Results
1. Click **🔬 LIMS → ✅ Verify Results**
2. Review pending results
3. Select results to verify/reject
4. Add notes if needed
5. Click **Verify Selected**

### Generating Reports
1. Click **🔬 LIMS → 📄 Generate Report**
2. Enter order number
3. Click **Generate PDF Report**
4. Download or share the PDF

## Sheets Structure

| Sheet | Purpose |
|-------|---------|
| Patients | Patient master data |
| Orders | Order headers |
| OrderTests | Order line items |
| Results | Result values with flags |
| TestCatalog | Test definitions & analytes |
| Users | User accounts & roles |
| Settings | Lab configuration |

## Limitations

- ~1000 orders/month recommended max
- Single lab only
- No external integrations
- Basic role checking (email-based)
- No real-time collaboration on forms

## Scaling Up

When you outgrow Google Sheets, consider:
- Firebase + Sheets hybrid
- Full React + Supabase solution (see /react-supabase-lims)
