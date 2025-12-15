# WhatsApp Manual Send Links - Implementation Guide

This document explains how to generate WhatsApp links that open in the appropriate client (mobile app or web) and allow manual message sending with pre-filled text.

## Overview

The system detects the user's device and generates platform-specific WhatsApp links:
- **Mobile devices** (iPhone, iPad, iPod, Android): Use `whatsapp://` protocol to open native WhatsApp app
- **Desktop/Laptop**: Use `https://web.whatsapp.com/` to open WhatsApp Web

## Core Implementation

### 1. Basic Link Generation Function

```typescript
// Location: src/utils/whatsappUtils.ts
export function generateWhatsAppLink(messageContent: string, phoneNumber: string): string {
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  const baseUrl = isMobile ? 'whatsapp://' : 'https://web.whatsapp.com/';
  const formattedPhone = `91${phoneNumber}`;  // Add country code (India +91)
  return `${baseUrl}send?phone=${formattedPhone}&text=${encodeURIComponent(messageContent)}`;
}
```

### 2. Device Detection Logic

```typescript
const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
```

**Regex Pattern Breakdown:**
- `iPhone|iPad|iPod` - iOS devices
- `Android` - Android devices
- `/i` flag - Case-insensitive matching

## Link Format Patterns

### Mobile (Native App)
```
whatsapp://send?phone=919876543210&text=Hello%20World
```

**Structure:**
- **Protocol**: `whatsapp://`
- **Endpoint**: `send`
- **Parameters**:
  - `phone`: Country code + phone number (no spaces, no +)
  - `text`: URL-encoded message content

### Desktop (Web Version)
```
https://web.whatsapp.com/send?phone=919876543210&text=Hello%20World
```

**Structure:**
- **Base URL**: `https://web.whatsapp.com/`
- **Endpoint**: `send`
- **Parameters**: Same as mobile

## Usage Examples in Codebase

### Example 1: Simple Message (Sequence Messages)
```typescript
// Location: src/pages/SequenceMessagesPage.tsx (Lines 98-103)

const generateWhatsAppLink = (message: string, phoneNumber: string) => {
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  const baseUrl = isMobile ? 'whatsapp://' : 'https://web.whatsapp.com/';
  const formattedPhone = `91${phoneNumber}`;
  return `${baseUrl}send?phone=${formattedPhone}&text=${encodeURIComponent(message)}`;
};

// Usage
const handleSendMessage = async (message: typeof sequenceMessages[0]) => {
  try {
    window.open(generateWhatsAppLink(message.messageContent, message.whatsappNumber), '_blank');
    updateSequenceMessageStatus(message.id, 'sent');
  } catch (error) {
    console.error('Error sending message:', error);
  }
};
```

### Example 2: Appointment Confirmation (Complex Message)
```typescript
// Location: src/pages/AppointmentsPage.tsx (Lines 107-133)

const generateWhatsAppLink = (appointment: typeof appointments[0]) => {
  const appointmentDateTime = new Date(`${appointment.appointmentDate}T${appointment.appointmentTime}`);
  const formattedDateTime = format(appointmentDateTime, 'PPp');
  const selectedDoctor = doctors.find(d => d.id === appointment.doctorId);
  
  const message = `Hello ${appointment.patientName},
  
Your appointment has been scheduled with ${user?.clinicName || 'our clinic'} for ${formattedDateTime}.

Doctor Details:
Name: ${selectedDoctor?.name || 'Not assigned'}
Contact: ${selectedDoctor?.contactNumber || 'Not available'}

Patient Details:
📍 Address: ${appointment.patientAddress}
📞 Contact: ${appointment.contactNumber}

Please arrive 15 minutes before your scheduled time.

Best regards,
Team ${user?.clinicName || 'our clinic'}`;

  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  const baseUrl = isMobile ? 'whatsapp://' : 'https://web.whatsapp.com/';
  const formattedPhone = `91${appointment.contactNumber}`;
  return `${baseUrl}send?phone=${formattedPhone}&text=${encodeURIComponent(message)}`;
};
```

### Example 3: Review Request with Modal UI
```typescript
// Location: src/components/SendMessagesModal.tsx (Lines 208-213)

const generateWhatsAppLink = (messageContent: string, phoneNumber: string) => {
  const isMobile = isMobileUA();  // Custom helper function
  const baseUrl = isMobile ? 'whatsapp://' : 'https://web.whatsapp.com/';
  const formattedPhone = `91${phoneNumber}`;
  return `${baseUrl}send?phone=${formattedPhone}&text=${encodeURIComponent(messageContent)}`;
};

// Advanced usage with window management
const navigateWA = (url: string) => {
  const isMobile = isMobileUA();
  let newWindow: Window | null = null;

  if (isMobile || url.startsWith('whatsapp://')) {
    // Mobile: Replace current tab
    window.location.href = url;
  } else {
    // Desktop: Open in new window/tab
    const existingWA = (window as any).__waHandle;
    if (existingWA && !existingWA.closed) {
      existingWA.location.href = url;
      newWindow = existingWA;
    } else {
      newWindow = window.open(url, '_blank');
    }
    
    if (newWindow) {
      (window as any).__waHandle = newWindow;
      try {
        newWindow.focus();
      } catch {}
    }
  }
};
```

## Important Implementation Notes

### 1. Phone Number Formatting
```typescript
// Always add country code (hardcoded for India)
const formattedPhone = `91${phoneNumber}`;

// Input: "9876543210"
// Output: "919876543210"
```

**For other countries:**
```typescript
const countryCode = '1';  // USA/Canada
const formattedPhone = `${countryCode}${phoneNumber}`;
```

### 2. Message Encoding
```typescript
// ALWAYS use encodeURIComponent for the message text
const encodedMessage = encodeURIComponent(messageContent);
```

**Why?** Special characters, line breaks, and spaces must be URL-encoded:
- Space → `%20`
- Newline → `%0A`
- Emoji → Proper UTF-8 encoding

### 3. Opening the Link

**Option A: New Tab/Window (Desktop Preferred)**
```typescript
window.open(whatsappLink, '_blank');
```

**Option B: Current Tab (Mobile Preferred)**
```typescript
window.location.href = whatsappLink;
```

**Option C: Anchor Tag**
```tsx
<a href={generateWhatsAppLink(message, phone)} target="_blank" rel="noopener noreferrer">
  Send WhatsApp
</a>
```

### 4. Window Management for Multi-Message Flow
```typescript
// Store reference to avoid opening multiple WhatsApp Web tabs
window.__waHandle = window.open(url, '_blank');

// Reuse existing window
if (window.__waHandle && !window.__waHandle.closed) {
  window.__waHandle.location.href = newUrl;
  window.__waHandle.focus();
}
```

## User Experience Flow

### Mobile Flow:
1. User clicks "Send" button
2. `whatsapp://send?phone=...` link opens
3. WhatsApp mobile app launches
4. Chat opens with pre-filled message
5. User taps send button in WhatsApp
6. Browser tab remains in background

### Desktop Flow:
1. User clicks "Send" button
2. `https://web.whatsapp.com/send?phone=...` opens in new tab
3. WhatsApp Web loads (QR scan if not logged in)
4. Chat opens with pre-filled message
5. User clicks send in WhatsApp Web
6. Original app tab remains open for next message

## Complete Working Example

```typescript
// reusable-whatsapp-link.ts

interface WhatsAppLinkOptions {
  phoneNumber: string;
  message: string;
  countryCode?: string;
}

export function generateWhatsAppLink({
  phoneNumber,
  message,
  countryCode = '91'  // Default to India
}: WhatsAppLinkOptions): string {
  // Device detection
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  
  // Select base URL
  const baseUrl = isMobile ? 'whatsapp://' : 'https://web.whatsapp.com/';
  
  // Format phone with country code
  const formattedPhone = `${countryCode}${phoneNumber}`;
  
  // URL encode the message
  const encodedMessage = encodeURIComponent(message);
  
  // Construct final URL
  return `${baseUrl}send?phone=${formattedPhone}&text=${encodedMessage}`;
}

// Usage
export function sendWhatsAppMessage(phoneNumber: string, message: string) {
  const link = generateWhatsAppLink({ phoneNumber, message });
  window.open(link, '_blank');
}

// Example with multi-line message
const appointmentMessage = `Hello John,

Your appointment is confirmed for:
📅 Date: Dec 15, 2025
🕐 Time: 10:00 AM
🏥 Clinic: ABC Diagnostics

Please arrive 10 minutes early.

Thank you!`;

sendWhatsAppMessage('9876543210', appointmentMessage);
```

## Testing Checklist

- [ ] Test on iPhone Safari
- [ ] Test on Android Chrome
- [ ] Test on desktop Chrome
- [ ] Test on desktop Firefox
- [ ] Test with special characters in message
- [ ] Test with emojis in message
- [ ] Test with very long messages (>1000 chars)
- [ ] Test with phone numbers without country code
- [ ] Test WhatsApp Web QR login flow
- [ ] Test rapid successive message sending

## Common Issues & Solutions

### Issue 1: Link doesn't open on mobile
**Solution:** Ensure `whatsapp://` protocol is used (not `https://`)

### Issue 2: Message text is garbled
**Solution:** Use `encodeURIComponent()` on the message content

### Issue 3: Multiple WhatsApp Web tabs opening
**Solution:** Implement window handle tracking (see Example 3)

### Issue 4: Phone number format rejected
**Solution:** Remove all spaces, dashes, parentheses. Use only digits with country code.

### Issue 5: iOS blocks popup
**Solution:** Use `window.location.href` instead of `window.open()` on mobile

## Browser Compatibility

| Browser | Platform | Status | Notes |
|---------|----------|--------|-------|
| Chrome | Desktop | ✅ Works | Opens WhatsApp Web |
| Firefox | Desktop | ✅ Works | Opens WhatsApp Web |
| Safari | Desktop | ✅ Works | Opens WhatsApp Web |
| Safari | iOS | ✅ Works | Opens WhatsApp app |
| Chrome | Android | ✅ Works | Opens WhatsApp app |
| Edge | Desktop | ✅ Works | Opens WhatsApp Web |

## Security Considerations

1. **Never expose user phone numbers** in client-side logs
2. **Sanitize message content** if user-generated to prevent XSS
3. **Validate phone numbers** before generating links
4. **Use HTTPS** for web version (default)
5. **Rate limit** manual send buttons to prevent abuse

## Integration for Other Apps

To replicate this pattern in your other apps:

1. **Copy** the `generateWhatsAppLink` function
2. **Adjust** the `countryCode` parameter for your region
3. **Implement** device detection with the regex pattern
4. **Use** `encodeURIComponent` for all message text
5. **Test** on both mobile and desktop devices
6. **Consider** window management for multi-message flows

## References

- [WhatsApp Click to Chat API](https://faq.whatsapp.com/general/chats/how-to-use-click-to-chat)
- [WhatsApp Business API Documentation](https://developers.facebook.com/docs/whatsapp)
- [URL Encoding Reference](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/encodeURIComponent)
