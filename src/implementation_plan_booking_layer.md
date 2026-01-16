# Implementation Plan: Booking & Quotation Layer

## 1. Overview
This plan introduces a **Booking Layer** that sits *before* the Order Creation process. Ideally suited for:
*   **B2B Clients:** To register samples in bulk or request tests without immediate billing.
*   **Front Desk:** To "pre-book" patients, manage home collections, or generate quotations before confirming an order.
*   **Future Patient App:** To allow patients to book slots.

## 2. Database Schema Changes

We will create a new table `bookings` to hold these pre-order records. This keeps the main `orders` table clean.

### Table: `bookings`
| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | UUID | Primary Key |
| `lab_id` | UUID | Foreign Key to `labs` |
| `booking_source` | Text | `b2b_portal`, `front_desk`, `patient_app`, `phone_call` |
| `status` | Text | `pending`, `quoted`, `confirmed`, `converted`, `cancelled` |
| `patient_info` | JSONB | e.g. `{ name: "John", phone: "123", age: 30, gender: "Male" }` |
| `test_details` | JSONB | Array of requested tests: `[{ id: "...", name: "CBC" }]` |
| `scheduled_at` | Timestamp | Requested time for visit/collection |
| `collection_type` | Text | `home_collection`, `walk_in`, `lab_pickup` |
| `home_collection_address` | JSONB | Address details if Home Collection |
| `b2b_client_id` | UUID | Optional FK to `accounts` table (for B2B) |
| `quotation_amount` | Numeric | Calculated total price (if quoted) |
| `converted_order_id` | UUID | Link to the final `orders` record |
| `created_by` | UUID | User ID who created the booking |
| `created_at` | Timestamp | Creation time |

## 3. Workflow & Usage

### A. Front Desk Booking (Quotation Mode)
1.  **Action:** Staff clicks **"New Booking / Quote"** instead of "New Order".
2.  **Input:** Enters Patient Name, Phone, and selects Tests.
    *   *No immediate payment or strict validation required.*
3.  **Output:** A Booking record is created.
4.  **Quotation:** System calculates tentative price. Staff can "Share Quote" via WhatsApp.
5.  **Conversion:** When patient arrives or confirms, Staff opens Booking -> Clicks **"Convert to Order"** -> Finalizes details -> Booking becomes Order.

### B. B2B Portal (Sample Registration)
1.  **Action:** B2B Client logs into their portal.
2.  **Input:** Manual Entry or CSV Upload of patient details + tests.
3.  **Output:** Multiple `pending` Booking records are created for the Lab.
4.  **Lab Action:** Logistics team sees these as "Incoming Samples".
5.  **Conversion:** When samples reach the lab, they are scanned/verified and converted to live `Orders`.

## 4. UI/UX Components

### 1. Booking Queue (Dashboard Widget)
*   A list view showing incoming requests (sorted by time/status).
*   Quick actions: `View`, `Quote`, `Convert`, `Cancel`.

### 2. Quotation Builder
*   A simplified interface to select tests and apply discounts without generating a tax invoice.
*   Ability to print or share a "Proforma/Estimation".

### 3. Integrated "Convert" Flow
*   When converting, the system will check if `patient_info.phone` exists in `patients`.
    *   **Existing Patient:** Maps execution to that ID.
    *   **New Patient:** Auto-creates patient record during conversion.

## 5. Phased Rollout
1.  **Phase 1 (Core):** Database Table + Internal Front Desk Booking interface.
2.  **Phase 2 (B2B):** Expose Booking API/Interface to B2B portal.
3.  **Phase 3 (Automation):** Auto-convert B2B bookings when barcode is scanned.

---
**Discuss:**
*   Does `patient_info` need to be a strict link to the `patients` table *immediately*, or can it be loose text until conversion? (Recommendation: Loose text for flexibility).
*   Should "Home Collection" management be tied deeply into this, or kept separate?
