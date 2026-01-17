# Implementation Plan: Robust Result & Flag Styling

## Objective
To implement a reliable, architecture-agnostic system for highlighting abnormal test results (High, Low, Critical) in both values and flags. This system must work for "Screen/E-Copy" (using colors) and "Print" (using bold/grayscale) versions, supporting both new and existing templates.

## 1. The Strategy: "Smart Row" Post-Processing
Since existing templates may not have the correct `{{_VALUE_CLASS}}` placeholders, we cannot rely solely on the template engine. We will upgrade the HTML post-processor in the Edge Function to parse "Rows" rather than individual cells.

### Logic
1.  **Scan Table Rows**: Iterate through every `<tr>` in `.report-table`.
2.  **Detect Flag Context**: Check if any cell in the row contains a flag keyword (e.g., "Low", "High", "Critical").
3.  **Apply Row Classes**: Add a status class to the row itself (e.g., `<tr class="row-status-low">`).
4.  **Target Value & Flag Cells**:
    *   **Flag Cell**: Has the text match. Add `.flag-low`.
    *   **Result Cell**: The cell containing the numeric value (typically column index 1). Add `.value-low`.

## 2. Styling Rules

### A. Screen / E-Copy (Color Mode)
We will standardize the CSS variables for consistent "Lab Colors".

```css
:root {
  --c-low: #f59e0b;      /* Amber */
  --c-high: #dc2626;     /* Red */
  --c-critical: #991b1b; /* Dark Red */
  --c-normal: #16a34a;   /* Green */
}

.value-low, .flag-low { color: var(--c-low) !important; font-weight: 700; }
.value-high, .flag-high { color: var(--c-high) !important; font-weight: 700; }
.value-critical, .flag-critical { color: var(--c-critical) !important; font-weight: 900; }
```

### B. Print Version (Bold Mode)
For the printed version, we substitute color for **Typographic Emphasis** to ensure readability on black-and-white laser printers.

```css
/* In lims-print-css block */
.value-low, .flag-low,
.value-high, .flag-high,
.value-critical, .flag-critical {
  color: #000000 !important;
  font-weight: 900 !important; /* Extra Bold */
  text-decoration: none;       /* Clean look */
}

/* Optional: Add marker for criticals in print? */
.value-critical::after {
  content: " (!)";
  font-size: 0.8em;
}
```

## 3. Implementation Steps

1.  **Upgrade `addFlagClassesToHtml` function** in `index.ts`:
    *   Change from simple regex replace to a DOM-like parsing (using regex grouping on `<tr>`).
    *   Implement "Value Finder" logic (find numeric cell in the same row).

2.  **Update `letterheadStyles`**:
    *   Add the complete color map for E-Copies.

3.  **Update `buildPdfBodyDocumentV2` (Print Logic)**:
    *   Update the `lims-print-css` block to include the BOLD override rules.

4.  **Verify**:
    *   Test with a "Low" result.
    *   Test with a "High" result.
    *   Check E-Copy (Color).
    *   Check Print (Bold).
