# PDF Margins Guide for Background Header Images

## Problem
When using background header images in E-Copy PDFs, text content can overlap with the header if margins are not set correctly.

## Solution: Use Margins to Prevent Overlap

### Understanding the Settings

**For PDFs with Background Header Images (E-Copy/Letterhead):**

```json
{
  "margins": "120px 20px 80px 20px",  // top, right, bottom, left
  "displayheaderfooter": false,        // No separate header/footer
  "printbackground": true,             // MUST be true for background images
  "headerheight": "0px",               // Not used when displayheaderfooter is false
  "footerheight": "0px"                // Not used when displayheaderfooter is false
}
```

### Margin Breakdown

- **Top Margin (120px)**: 
  - Pushes content below the header background image
  - Should match your header image height
  - Typical header images are 100-120px tall

- **Right/Left Margins (20px)**:
  - Standard side margins for readability
  - Can be adjusted based on design preference

- **Bottom Margin (80px)**:
  - Space for footer background image if you have one
  - Or just bottom padding if no footer

### Why Margins Are Needed

1. **Background images don't create space** - They're rendered behind content
2. **Without margins**, text starts at (0, 0) and overlaps the header
3. **Margins push the content** into the safe area below the header

## Implementation

### 1. New "Letterhead" Preset Added

A new preset has been added to `PDFSettingsModal.tsx`:

```typescript
letterhead: {
  scale: 1.0,
  margins: { top: 120, right: 20, bottom: 80, left: 20 },
  headerHeight: 0,
  footerHeight: 0,
  displayHeaderFooter: false,  // Header is a background image
  mediaType: 'screen',
  printBackground: true,       // ESSENTIAL for background images
  paperSize: 'A4',
  orientation: 'portrait',
}
```

### 2. How to Use

**Option A: Use the Letterhead Preset**
1. Open PDF Settings modal
2. Click "Letterhead" preset button
3. Click "Save as Default"
4. All future PDFs will use these settings

**Option B: Customize Margins**
1. Open PDF Settings modal
2. Adjust the "Top" margin slider to match your header height
3. Adjust other margins as needed
4. Click "Save as Default"

### 3. Settings Are Saved in Database

When you click "Save as Default", the settings are saved to:
- **Database**: `labs.pdf_layout_settings` (lab-wide)
- **Backup**: `localStorage` (browser-specific)

This means:
- ✅ Settings persist across sessions
- ✅ Settings apply to all users in the lab
- ✅ Settings are used for all PDF generation methods

## Recommended Margin Values

| Header Image Height | Top Margin | Notes |
|---------------------|------------|-------|
| 80-100px | 100px | Small header |
| 100-120px | 120px | **Standard (Recommended)** |
| 120-140px | 140px | Large header |
| 140-160px | 160px | Extra large header |

**Pro Tip**: Add 10-20px extra to the header height for breathing room.

## Testing Your Settings

1. **Open PDF Settings** on the Reports page
2. **Select "Letterhead" preset** or adjust margins manually
3. **Click "Regenerate PDF"** to preview
4. **Check if text overlaps** with the header image
5. **Adjust top margin** if needed
6. **Save as Default** when satisfied

## Common Issues

### Issue: Text Still Overlaps Header
**Solution**: Increase the top margin by 20-30px

### Issue: Too Much White Space Below Header
**Solution**: Decrease the top margin by 10-20px

### Issue: Content Cut Off at Bottom
**Solution**: Reduce bottom margin or adjust scale

### Issue: Settings Not Applying
**Solution**: 
1. Make sure you clicked "Save as Default"
2. Refresh the page
3. Check that `labId` is being passed to the modal

## Technical Details

### Where Margins Are Used

1. **PDF.co API** (for E-Copy generation):
   ```javascript
   margins: `${settings.margins.top}px ${settings.margins.right}px ${settings.margins.bottom}px ${settings.margins.left}px`
   ```

2. **jsPDF** (for View button):
   - Margins are applied programmatically in the code
   - Content starts at `yPos = margin` (top margin)

3. **Database Storage**:
   ```sql
   UPDATE labs 
   SET pdf_layout_settings = '{"margins": {"top": 120, "right": 20, "bottom": 80, "left": 20}, ...}'
   WHERE id = 'lab-id';
   ```

## Best Practices

1. **Always use `printBackground: true`** for letterhead PDFs
2. **Set `displayHeaderFooter: false`** when using background images
3. **Match top margin to header height** (measure your header image)
4. **Test on actual reports** before saving as default
5. **Use the "Letterhead" preset** as a starting point

## Summary

✅ **YES, you need margins** when using background header images  
✅ **Top margin prevents overlap** with the header  
✅ **Settings are saved in database** for lab-wide consistency  
✅ **New "Letterhead" preset** is ready to use  
✅ **Margins are already supported** in the PDF Settings modal
