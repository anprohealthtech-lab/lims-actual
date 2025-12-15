// WhatsApp Manual Link Utilities
// Generates platform-specific WhatsApp links for manual sending when backend is not connected

export interface WhatsAppLinkOptions {
  phoneNumber: string;
  message: string;
  countryCode?: string;
}

/**
 * Detect if user is on a mobile device
 */
export function isMobileDevice(): boolean {
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
}

/**
 * Normalize phone number to 10 digits (removes country code if present)
 */
export function normalizePhoneNumber(phone: string): string {
  if (!phone) return '';
  const digitsOnly = phone.replace(/\D/g, '');
  // If longer than 10 digits, take last 10 (removes country code)
  if (digitsOnly.length > 10) {
    return digitsOnly.slice(-10);
  }
  return digitsOnly;
}

/**
 * Format phone number with country code for WhatsApp links
 */
export function formatPhoneForWhatsApp(phone: string, countryCode: string = '91'): string {
  const normalized = normalizePhoneNumber(phone);
  if (!normalized || normalized.length < 10) return '';
  return `${countryCode}${normalized}`;
}

/**
 * Generate WhatsApp link based on device type
 * Mobile: whatsapp:// protocol opens native app
 * Desktop: https://web.whatsapp.com/ opens web version
 */
export function generateWhatsAppLink({
  phoneNumber,
  message,
  countryCode = '91'
}: WhatsAppLinkOptions): string {
  const isMobile = isMobileDevice();
  const baseUrl = isMobile ? 'whatsapp://' : 'https://web.whatsapp.com/';
  const formattedPhone = formatPhoneForWhatsApp(phoneNumber, countryCode);
  
  if (!formattedPhone) {
    console.warn('Invalid phone number for WhatsApp link:', phoneNumber);
    return '';
  }
  
  const encodedMessage = encodeURIComponent(message);
  return `${baseUrl}send?phone=${formattedPhone}&text=${encodedMessage}`;
}

// Track window handle to avoid multiple WhatsApp Web tabs
let waWindowHandle: Window | null = null;

/**
 * Open WhatsApp link in appropriate manner
 * Mobile: Uses location.href to open native app
 * Desktop: Opens/reuses WhatsApp Web tab
 */
export function openWhatsAppLink(url: string): void {
  if (!url) {
    console.error('No WhatsApp URL provided');
    return;
  }
  
  const isMobile = isMobileDevice();
  
  if (isMobile || url.startsWith('whatsapp://')) {
    // Mobile: Replace current tab to open native app
    window.location.href = url;
  } else {
    // Desktop: Open in new window/tab, reuse if exists
    if (waWindowHandle && !waWindowHandle.closed) {
      waWindowHandle.location.href = url;
      try {
        waWindowHandle.focus();
      } catch (e) {
        // Focus might fail due to browser restrictions
        console.warn('Could not focus WhatsApp window');
      }
    } else {
      waWindowHandle = window.open(url, '_blank');
    }
  }
}

/**
 * Build message content with PDF link embedded for manual sending
 */
export function buildMessageWithReportLink(
  baseMessage: string,
  reportUrl: string,
  recipientType: 'patient' | 'doctor'
): string {
  // Remove any trailing "Thank you." to append link before it
  let message = baseMessage.trim();
  const thankYouMatch = message.match(/\n*Thank you\.?\s*$/i);
  
  if (thankYouMatch) {
    message = message.replace(/\n*Thank you\.?\s*$/i, '');
  }
  
  // Add report link
  if (recipientType === 'patient') {
    message += `\n\n📎 Download Report:\n${reportUrl}`;
  } else {
    message += `\n\n📎 Report Link:\n${reportUrl}`;
  }
  
  // Add back thank you
  message += '\n\nThank you.';
  
  return message;
}

/**
 * Show confirmation dialog and open WhatsApp manual link
 * Returns true if user accepted, false if cancelled
 */
export async function openWhatsAppManually(
  phoneNumber: string,
  message: string,
  reportUrl?: string,
  recipientType: 'patient' | 'doctor' = 'patient'
): Promise<{ success: boolean; method: 'manual_link' | 'cancelled' }> {
  // Build final message with report link if provided
  let finalMessage = message;
  if (reportUrl) {
    finalMessage = buildMessageWithReportLink(message, reportUrl, recipientType);
  }
  
  const isMobile = isMobileDevice();
  const platformName = isMobile ? 'WhatsApp App' : 'WhatsApp Web';
  
  // Confirm with user
  const confirmed = window.confirm(
    `WhatsApp is not connected via backend.\n\n` +
    `Open ${platformName} manually to send?\n\n` +
    `The message will be pre-filled. You just need to tap/click Send in WhatsApp.`
  );
  
  if (!confirmed) {
    return { success: false, method: 'cancelled' };
  }
  
  // Generate and open link
  const link = generateWhatsAppLink({
    phoneNumber,
    message: finalMessage
  });
  
  if (!link) {
    alert('Invalid phone number. Cannot generate WhatsApp link.');
    return { success: false, method: 'cancelled' };
  }
  
  openWhatsAppLink(link);
  
  return { success: true, method: 'manual_link' };
}

/**
 * Check if manual WhatsApp sending should be offered
 * (When backend connection fails)
 */
export function shouldOfferManualSend(connectionStatus: {
  success: boolean;
  isConnected: boolean;
} | null): boolean {
  // Offer manual send if:
  // 1. Connection check failed entirely
  // 2. Backend says not connected
  return !connectionStatus?.success || !connectionStatus?.isConnected;
}
