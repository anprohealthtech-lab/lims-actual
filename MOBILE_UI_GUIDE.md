# Mobile UI Optimization Guide

## Overview
This document describes the mobile UI optimizations implemented for the LIMS Builder Android app, focusing on proper edge margins, safe areas, and touch-friendly interfaces.

## Safe Area Implementation

### CSS Custom Properties
```css
:root {
  --safe-area-inset-top: env(safe-area-inset-top, 0px);
  --safe-area-inset-right: env(safe-area-inset-right, 0px);
  --safe-area-inset-bottom: env(safe-area-inset-bottom, 0px);
  --safe-area-inset-left: env(safe-area-inset-left, 0px);
  --mobile-edge-margin: 16px;
  --mobile-content-padding: 12px;
}
```

### Utility Classes

#### Safe Area Padding
- `safe-area-top` - Adds safe top padding (notches, status bar)
- `safe-area-bottom` - Adds safe bottom padding (gesture bars)
- `safe-area-left` - Adds safe left padding
- `safe-area-right` - Adds safe right padding
- `safe-area-x` - Adds horizontal safe padding (left + right)
- `safe-area-y` - Adds vertical safe padding (top + bottom)
- `safe-area-all` - Adds padding on all sides

#### Mobile Edge Margins
- `mobile-edge-padding` - Adds 16px horizontal padding on mobile
- `mobile-content-padding` - Adds 12px padding all around
- `card-mobile` - Proper margins for cards on mobile

## Component Usage

### MobileContainer
Wrapper for content with automatic edge margins:
```tsx
import { MobileContainer } from '@/components/ui/MobileComponents';

<MobileContainer useSafeArea={true}>
  <YourContent />
</MobileContainer>
```

### MobileCard
Card component with proper mobile spacing:
```tsx
import { MobileCard } from '@/components/ui/MobileComponents';

<MobileCard>
  <CardContent />
</MobileCard>
```

### MobilePage
Full page wrapper with header and safe areas:
```tsx
import { MobilePage } from '@/components/ui/MobileComponents';

<MobilePage title="Page Title">
  <PageContent />
</MobilePage>
```

### MobileButton
Touch-optimized button (minimum 44px height):
```tsx
import { MobileButton } from '@/components/ui/MobileComponents';

<MobileButton 
  variant="primary" 
  fullWidth={true}
  onClick={handleClick}
>
  Submit
</MobileButton>
```

### MobileInput
Mobile-optimized input with proper sizing:
```tsx
import { MobileInput } from '@/components/ui/MobileComponents';

<MobileInput
  label="Patient Name"
  value={name}
  onChange={setName}
  required={true}
/>
```

### MobileListItem
Touch-friendly list item:
```tsx
import { MobileListItem } from '@/components/ui/MobileComponents';

<MobileListItem 
  onClick={handleClick}
  showChevron={true}
>
  <ListItemContent />
</MobileListItem>
```

## Layout Updates

### Header Component
- Added `safe-area-top` and `safe-area-x` classes
- Increased touch targets to minimum 44px
- Responsive spacing: `space-x-2 md:space-x-4`
- Larger avatar on mobile: `h-10 w-10` instead of `h-8 w-8`

### Main Layout
- Added `safe-area-x` and `safe-area-bottom` to main content
- Responsive padding: `p-6 md:p-6` (mobile adapts via safe area classes)

## Touch Target Guidelines

### Minimum Sizes
All interactive elements should be at least **44x44px** to meet accessibility standards.

```css
button, a, .clickable {
  min-height: 44px;
  min-width: 44px;
}
```

### Button Sizing
```css
.btn-mobile {
  padding: 12px 16px;
  font-size: 16px;
}
```

## Responsive Patterns

### Mobile-First Breakpoints
- Default: Mobile styles (< 768px)
- `md:` Desktop styles (≥ 768px)
- `lg:` Large desktop (≥ 1024px)

### Example Usage
```tsx
<div className="px-4 md:px-6 lg:px-8">
  {/* 16px mobile, 24px tablet, 32px desktop */}
</div>

<div className="safe-area-x">
  {/* Auto-adjusts for notches + 16px base margin */}
</div>
```

## Best Practices

### 1. Always Use Safe Areas for Full-Width Elements
```tsx
// ✅ Good
<header className="safe-area-top safe-area-x">
  <HeaderContent />
</header>

// ❌ Bad - content may be hidden by notch
<header>
  <HeaderContent />
</header>
```

### 2. Add Edge Margins to Content
```tsx
// ✅ Good
<div className="mobile-edge-padding">
  <Content />
</div>

// ❌ Bad - content touches screen edges
<div>
  <Content />
</div>
```

### 3. Use Mobile Components for Consistency
```tsx
// ✅ Good
<MobileButton onClick={save}>Save</MobileButton>

// ❌ Bad - may be too small to tap
<button onClick={save} className="px-2 py-1">Save</button>
```

### 4. Test on Real Devices
- Android devices with notches
- Various screen sizes
- Gesture navigation vs button navigation

## Viewport Configuration

### HTML Meta Tag
```html
<meta 
  name="viewport" 
  content="width=device-width, initial-scale=1.0, viewport-fit=cover, user-scalable=no" 
/>
```

- `viewport-fit=cover` - Allows content to extend into safe areas
- `user-scalable=no` - Prevents accidental zoom on input focus

## Android-Specific Considerations

### Capacitor Configuration
See `capacitor.config.ts` for Android-specific settings:
- `androidScheme: 'https'` - Required for safe area support
- `captureInput: true` - Proper keyboard handling
- `allowMixedContent: true` - Development flexibility

### Status Bar
Configured in `src/utils/nativeInit.ts`:
```typescript
await StatusBar.setStyle({ style: Style.Dark });
await StatusBar.setBackgroundColor({ color: '#1a56db' });
```

## Testing Checklist

- [ ] Content doesn't touch screen edges (16px margin)
- [ ] Headers respect status bar and notches
- [ ] Bottom navigation/buttons respect gesture areas
- [ ] All buttons are at least 44x44px
- [ ] Text is readable (minimum 16px font size)
- [ ] Forms are properly spaced
- [ ] Cards have appropriate margins
- [ ] Full-width elements use safe areas
- [ ] Content scrolls properly without clipping

## Migration Guide

### Updating Existing Components

1. **Add safe areas to headers/footers:**
```tsx
// Before
<header className="bg-white">

// After
<header className="bg-white safe-area-top safe-area-x">
```

2. **Add edge padding to content:**
```tsx
// Before
<div className="p-4">

// After
<div className="p-4 safe-area-x">
```

3. **Increase button sizes:**
```tsx
// Before
<button className="px-3 py-2">

// After  
<button className="btn-mobile"> {/* 12px vertical, 16px horizontal */}
```

4. **Use mobile components:**
```tsx
// Before
<div className="bg-white rounded shadow p-4">

// After
<MobileCard>
```

## Resources

- [iOS Safe Area Guide](https://developer.apple.com/design/human-interface-guidelines/layout)
- [Android Material Design - Layout](https://material.io/design/layout/understanding-layout.html)
- [W3C Touch Target Size](https://www.w3.org/WAI/WCAG21/Understanding/target-size.html)
- [Capacitor Safe Area Plugin](https://capacitorjs.com/docs/apis/status-bar)

## File Locations

- CSS: `src/index.css`
- Components: `src/components/ui/MobileComponents.tsx`
- Layout: `src/components/Layout/Layout.tsx`, `Header.tsx`
- Config: `capacitor.config.ts`, `tailwind.config.js`
- Init: `src/utils/nativeInit.ts`
