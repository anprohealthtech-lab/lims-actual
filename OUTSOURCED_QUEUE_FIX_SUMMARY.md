# Outsourced Tests Queue Fix Summary

## Issue
The status counts (Pending Dispatch, In Transit, Awaiting Report, Overdue) in the tabs and stats cards were not populated when the page was initially opened. They only updated when clicking on a specific section.

## Cause
The `fetchQueue` function was filtering the tests by the `activeTab` status in the database query. This meant that only the items for the current tab were fetched, resulting in 0 counts for other statuses.

## Fix
1.  **Modified `fetchQueue`**: Removed the `status` filter from the `getPendingTests` call. Now it fetches all active outsourced tests (pending, sent, awaiting report) regardless of the active tab.
2.  **Client-side Filtering**: Introduced `filteredItems` using `useMemo` to filter the fetched `queueItems` based on the `activeTab` for display purposes.
3.  **Updated Rendering**:
    *   The **Grid** now renders `filteredItems` instead of `queueItems`.
    *   **Stats Cards** and **Tab Buttons** continue to use `queueItems` (which now contains all items) to calculate and display correct global counts.
    *   **Selection Logic** (`Select All`) now operates on `filteredItems` to only select visible items.

## Result
All status counts are now correctly calculated and displayed immediately upon page load, and the grid correctly shows only the items relevant to the selected tab.
