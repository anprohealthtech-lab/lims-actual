# Mobile UI Quick Reference

## Essential Classes

### Safe Area (Android Notches, Gesture Bars)
```tsx
safe-area-top       // Top padding (status bar/notch)
safe-area-bottom    // Bottom padding (gesture bar)
safe-area-x         // Left + right padding (16px + notches)
safe-area-y         // Top + bottom padding
safe-area-all       // All sides padding
```

### Mobile Spacing
```tsx
mobile-edge-padding     // 16px horizontal padding on mobile
mobile-content-padding  // 12px padding all around
card-mobile            // Proper card margins on mobile
```

### Touch Targets
```tsx
btn-mobile             // 44px min height, proper padding
min-h-touch           // 44px minimum height
min-w-touch           // 44px minimum width
```

## Quick Patterns

### Page Layout
```tsx
<MobilePage title="Page Title">
  <MobileContainer>
    <MobileCard>
      <h2>Content</h2>
    </MobileCard>
  </MobileContainer>
</MobilePage>
```

### Header/Footer
```tsx
<header className="safe-area-top safe-area-x">
  {/* Header content */}
</header>

<footer className="safe-area-bottom safe-area-x">
  {/* Footer content */}
</footer>
```

### Content Area
```tsx
<main className="safe-area-x safe-area-bottom p-4">
  {/* Main content */}
</main>
```

### Button
```tsx
<MobileButton variant="primary" fullWidth onClick={handleSave}>
  Save
</MobileButton>
```

### Form Input
```tsx
<MobileInput
  label="Name"
  value={name}
  onChange={setName}
  required
/>
```

### List
```tsx
{items.map(item => (
  <MobileListItem 
    key={item.id}
    onClick={() => handleSelect(item)}
    showChevron
  >
    <div>{item.name}</div>
  </MobileListItem>
))}
```

## Tailwind Responsive
```tsx
// Mobile-first approach
className="px-4 md:px-6 lg:px-8"  // 16px → 24px → 32px
className="text-sm md:text-base"   // Small → Base
className="hidden md:block"        // Hide on mobile
className="block md:hidden"        // Show only on mobile
```

## Common Issues & Fixes

### ❌ Content touches edges
```tsx
// Bad
<div className="p-4">

// Good
<div className="p-4 safe-area-x">
```

### ❌ Button too small to tap
```tsx
// Bad
<button className="px-2 py-1">

// Good
<MobileButton>
```

### ❌ Header hidden by notch
```tsx
// Bad
<header className="bg-white">

// Good
<header className="bg-white safe-area-top safe-area-x">
```

### ❌ Bottom content clipped
```tsx
// Bad
<div className="pb-4">

// Good
<div className="pb-4 safe-area-bottom">
```

## Import Statements
```tsx
import { 
  MobileContainer,
  MobileCard,
  MobilePage,
  MobileButton,
  MobileInput,
  MobileListItem
} from '@/components/ui/MobileComponents';

import { isNative, isAndroid } from '@/utils/platformHelper';
```

## Platform Detection
```tsx
if (isNative()) {
  // Native app specific code
}

if (isAndroid()) {
  // Android specific code
}
```

## Testing Checklist
- [ ] 16px minimum edge margins
- [ ] 44px minimum touch targets
- [ ] Safe areas respected (top/bottom)
- [ ] Text size ≥ 16px
- [ ] Scrolling works properly
- [ ] Forms are usable
- [ ] No content clipping

For detailed documentation, see: `MOBILE_UI_GUIDE.md`
