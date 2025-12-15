# Dashboard Cards Outsourced Status Fix

## Issue
In the Orders dashboard cards, outsourced tests were displaying as "0/X analytes Pending" with a gray background, which was misleading and indistinguishable from pending in-house tests.

## Fix
1.  **Updated `Panel` Type**: Added `isOutsourced` (boolean) and `outsourcedLab` (string) properties to the `Panel` type in `src/pages/Orders.tsx`.
2.  **Enhanced Data Fetching**: Modified `fetchOrders` to check `order_tests` for `outsourced_lab_id` when constructing the `panels` array. It now correctly flags panels that contain outsourced tests.
3.  **Improved UI Rendering**:
    *   **Color Scheme**: Outsourced panels now use a **purple** color scheme (`bg-purple-50`, `text-purple-800`) to clearly distinguish them from in-house tests.
    *   **Status Text**: Instead of "0/X analytes", it now displays **"Outsourced"** and the **Destination Lab Name**.
    *   **Icon**: Added a hospital icon (🏥) next to the test name for outsourced panels.

## Result
Outsourced tests are now clearly visible on the dashboard cards with correct status and destination lab information.
