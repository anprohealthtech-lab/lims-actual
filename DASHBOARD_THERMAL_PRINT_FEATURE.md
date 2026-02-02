# Thermal Slip Printing Added to Dashboard Order Modal

**Date**: 2026-01-21  
**Status**: ✅ **COMPLETED**

## Summary

Added thermal slip printing functionality to the Dashboard Order Modal, matching the feature that already exists in the Billing page. The thermal slip now automatically includes a UPI QR code if the location (or lab) has a UPI ID configured.

## Changes Made

### 1. Updated `src/components/Dashboard/DashboardOrderModal.tsx`

#### Import Added (Line 49)
```tsx
import { ThermalPrintButton } from "../Invoices/ThermalPrintButton";
```

#### Thermal Print Button Added (After Line 1476)
```tsx
{/* Thermal Print Button */}
{order.invoice_id && (
  <div className="w-full">
    <ThermalPrintButton
      invoiceId={order.invoice_id}
      format="thermal_80mm"
      variant="secondary"
      size="md"
      label="Print Thermal Slip"
    />
  </div>
)}
```

## How It Works

### Button Placement
The thermal print button appears in the billing section of the Dashboard Order Modal, positioned after the "Generate PDF" button and before the "Invoice Delivery Tracker".

### Button Visibility
- ✅ **Visible**: When an invoice has been created for the order (`order.invoice_id` exists)
- ❌ **Hidden**: When no invoice exists yet

### UPI QR Code Logic (Automatic)

The thermal slip intelligently handles UPI QR code printing based on configuration:

1. **Priority 1 - Location UPI ID**: Checks if the location has a UPI ID configured
   - Found in: `locations.upi_id` or `locations.bank_details.upi_id`
   
2. **Priority 2 - Lab UPI ID** (Fallback): If location doesn't have UPI ID, uses lab's UPI ID
   - Found in: `labs.upi_id` or `labs.bank_details.upi_id`

3. **QR Code Generation**: If a valid UPI ID is found AND invoice has balance due:
   - Generates UPI payment QR code with invoice details
   - Amount set to balance due
   - Transaction note includes invoice number
   - Supports all major UPI apps (PhonePe, GPay, Paytm, BHIM)

4. **No QR Code**: If no UPI ID configured OR invoice is fully paid:
   - Thermal slip prints without QR code
   - Shows only invoice details and items

### Thermal Slip Features

The thermal slip includes:
- **Lab/Location Header**: Name, address, phone, email, GSTIN
- **Invoice Information**: Invoice number, date, time
- **Patient Details**: Name, phone number
- **Items List**: All tests/services with prices
- **Financial Summary**: Subtotal, discount, tax, total, paid amount, balance due
- **Payment Status Badge**: "PAID" (green) or "PAYMENT DUE" (yellow)
- **UPI QR Code** (conditional): If UPI ID configured and balance due > 0
  - QR code for easy UPI payment
  - Shows UPI ID
  - Shows amount to pay
  - Lists supported apps
- **Invoice Barcode**: CODE128 barcode of invoice number
- **Footer**: Thank you message and disclaimer

## Database Schema Requirements

### Locations Table
```sql
CREATE TABLE locations (
  ...
  upi_id TEXT,  -- Location-specific UPI ID
  bank_details JSONB,  -- Can contain { "upi_id": "..." }
  ...
);
```

### Labs Table
```sql
CREATE TABLE labs (
  ...
  upi_id TEXT,  -- Lab-wide UPI ID (fallback)
  bank_details JSONB,  -- Can contain { "upi_id": "..." }
  ...
);
```

## Usage Flow

1. User opens an order from the Dashboard
2. User creates an invoice (if not already created)
3. "Print Thermal Slip" button appears in the billing section
4. User clicks "Print Thermal Slip"
5. Thermal invoice HTML is generated with:
   - Invoice details
   - UPI QR code (if location/lab has UPI ID configured)
   - Invoice barcode
6. Print dialog opens with thermal printer format (80mm width)
7. User prints the thermal slip

## Example Scenarios

### Scenario 1: Location with UPI ID ✅
- **Location**: "Downtown Lab" has `upi_id = "downtown@paytm"`
- **Result**: Thermal slip includes QR code with Downtown Lab's UPI ID
- **Payee Name**: "Downtown Lab"

### Scenario 2: Location without UPI, Lab with UPI ID ✅
- **Location**: "Branch A" has no UPI ID
- **Lab**: Main lab has `upi_id = "mainlab@phonepe"`
- **Result**: Thermal slip includes QR code with Main Lab's UPI ID
- **Payee Name**: Main lab name

### Scenario 3: No UPI ID Configured ⚠️
- **Location**: No UPI ID
- **Lab**: No UPI ID
- **Result**: Thermal slip prints without QR code, shows only invoice details

### Scenario 4: Invoice Fully Paid ℹ️
- **UPI ID**: Configured at location/lab
- **Balance Due**: ₹0 (fully paid)
- **Result**: Thermal slip prints without QR code, shows "PAID" badge

## Benefits

1. ✅ **Consistency**: Dashboard modal now has same features as Billing page
2. ✅ **Convenience**: Users can print thermal slip directly from order view
3. ✅ **Smart UPI Integration**: Automatically includes QR code based on configuration
4. ✅ **Location-Specific Payments**: Each location can have its own UPI ID
5. ✅ **Fallback Support**: Lab-wide UPI ID serves as fallback
6. ✅ **Professional**: Clean thermal receipt format optimized for 80mm printers

## Related Files

- **Component**: `src/components/Invoices/ThermalPrintButton.tsx`
- **Service**: `src/utils/thermalInvoiceService.ts`
- **UPI Service**: `src/utils/upiQrService.ts`
- **Modified**: `src/components/Dashboard/DashboardOrderModal.tsx`

## Testing Checklist

- [ ] Test thermal print with location having UPI ID
- [ ] Test thermal print with location without UPI ID (should use lab UPI)
- [ ] Test thermal print with no UPI ID configured (should work without QR)
- [ ] Test thermal print for fully paid invoice (no QR code)
- [ ] Test thermal print for partially paid invoice (QR with balance due)
- [ ] Verify QR code scans correctly with PhonePe/GPay
- [ ] Test on physical thermal printer (80mm)
- [ ] Verify barcode scans correctly

---

**Implementation Complete** ✨

The Dashboard Order Modal now has thermal slip printing with intelligent UPI QR code integration based on location/lab configuration.
