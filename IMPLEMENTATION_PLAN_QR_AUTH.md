# Implementation Plan: Universal QR Code for Report Authentication

## Objective
To add a dedicated "Authentication QR Code" to every generated PDF report (both E-Copy and Print versions). Scanning this code will redirect the user to a public verification page, confirming the report's validity.

## 1. Technical Strategy

### A. QR Code Generation
We will use a high-performance, public, or self-hosted QR code generation API to render the QR code as an image `src` on the fly.
*   **Source:** `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data={VERIFY_URL}` (or similar reliable service).
*   **Fallback:** If we want zero dependency, we can generate base64 QR server-side (using `qrcode` npm package), but an image URL is faster for the edge function.

### B. Verification URL
The URL encoded in the QR will be:
`{APP_URL}/verify/{report_id}` (or `order_id` if unique).
*   **Security:** We should eventually sign this URL, but for now, checking the ID against the DB is the first step.

### C. Placement Strategy (The "Robust" Part)
Templates vary wildly. To ensure the QR code doesn't break layouts or get hidden:
1.  **Position:** Absolute positioning in the **Top Right** of the report content container.
2.  **Styling:**
    ```css
    .report-qr-code {
        position: absolute;
        top: 20px;
        right: 20px;
        width: 80px;
        height: 80px;
        z-index: 50;
    }
    ```
3.  **HTML Injection:** We will inject this `<img class="report-qr-code" ... />` immediately after `<div class="limsv2-report">` (or similar root wrapper) in `buildPdfBodyDocumentV2`.

## 2. Implementation Steps

### Step 1: Define Verification URL
*   Define the base URL in `.env` or hardcode it (e.g., `https://lims-v2.netlify.app/verify`).
*   Construct the full URL: `const verifyUrl = ${baseUrl}/verify/${reportId}`;

### Step 2: Update `buildPdfBodyDocumentV2`
*   Add an optional `qrCodeUrl` parameter.
*   Inject the QR image HTML into the `wrappedBody`.
    ```html
    <!-- Verification QR -->
    <img src="https://api.qrserver.com/v1/create-qr-code/?data=${verifyUrl}" class="report-auth-qr" alt="Verify Report" />
    ```

### Step 3: Add CSS
*   Add `.report-auth-qr` styling to `BASELINE_CSS` so it's always available.
    *   Position: Absolute (top/right).
    *   Size: ~80px (scannable but unobtrusive).
    *   Print-friendly: Ensure it prints (it's an image, so it should).

### Step 4: Update `serve` Logic
*   Construct the verify URL using `orderId` or `sampleId`.
*   Pass it to `buildPdfBodyDocumentV2`.

## 3. Print Consideration
*   The QR code works perfectly in Black & White (high contrast).
*   It serves as a physical proof of authenticity.

## 4. Verification Page (Frontend Task - Separate)
*   We need a `/verify/:id` page in the React app (public route) that fetches the report status and displays "Verified" or "Not Found".

## Action Plan
1.  Update `index.ts` to construct the URL and inject the Image.
2.  Add the CSS classes.
3.  Deploy.
