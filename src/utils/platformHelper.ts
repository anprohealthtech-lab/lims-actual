import { Capacitor } from '@capacitor/core';
import { Device } from '@capacitor/device';

export interface PlatformInfo {
  isNative: boolean;
  isAndroid: boolean;
  isIOS: boolean;
  isWeb: boolean;
  platform: string;
  operatingSystem?: string;
  osVersion?: string;
  model?: string;
  manufacturer?: string;
  isVirtual?: boolean;
}

let cachedPlatformInfo: PlatformInfo | null = null;

export const getPlatformInfo = async (): Promise<PlatformInfo> => {
  if (cachedPlatformInfo) {
    return cachedPlatformInfo;
  }

  const isNative = Capacitor.isNativePlatform();
  const platform = Capacitor.getPlatform();
  const isAndroid = platform === 'android';
  const isIOS = platform === 'ios';
  const isWeb = platform === 'web';

  let deviceInfo = {};
  
  if (isNative) {
    try {
      deviceInfo = await Device.getInfo();
    } catch (error) {
      console.warn('Failed to get device info:', error);
    }
  }

  cachedPlatformInfo = {
    isNative,
    isAndroid,
    isIOS,
    isWeb,
    platform,
    ...deviceInfo,
  };

  return cachedPlatformInfo;
};

/**
 * Hook for mobile-specific optimizations (Android only)
 * Returns compact styles for native Android app, normal styles for web
 */
export const useMobileOptimizations = () => {
  const isMobile = isNative() && isAndroid();
  
  return {
    isMobile,
    // Padding classes
    padding: isMobile ? 'p-3' : 'p-6',
    paddingX: isMobile ? 'px-3' : 'px-6',
    paddingY: isMobile ? 'py-3' : 'py-6',
    headerPadding: isMobile ? 'py-3' : 'py-8',
    
    // Card styling
    cardPadding: isMobile ? 'p-3' : 'p-4',
    cardSpacing: isMobile ? 'space-y-2' : 'space-y-4',
    
    // Typography
    titleSize: isMobile ? 'text-xl' : 'text-3xl',
    subtitleSize: isMobile ? 'text-base' : 'text-xl',
    textSize: isMobile ? 'text-sm' : 'text-base',
    
    // Buttons
    buttonSize: isMobile ? 'px-3 py-2 text-sm' : 'px-4 py-3 text-base',
    iconButtonSize: isMobile ? 'p-2' : 'p-3',
    
    // Spacing
    spacing: isMobile ? 'space-y-2' : 'space-y-4',
    gap: isMobile ? 'gap-2' : 'gap-4',
    
    // Layout
    containerPadding: isMobile ? 'px-4' : 'px-6',
    maxWidth: isMobile ? 'max-w-full' : 'max-w-7xl',
    
    // Grid
    gridCols: isMobile ? 'grid-cols-2' : 'grid-cols-4',
    
    // Safe areas (for Android bottom nav)
    safeBottom: isMobile ? 'pb-16' : '',
  };
};

export const isNative = (): boolean => {
  return Capacitor.isNativePlatform();
};

export const isAndroid = (): boolean => {
  return Capacitor.getPlatform() === 'android';
};

export const isIOS = (): boolean => {
  return Capacitor.getPlatform() === 'ios';
};

export const isWeb = (): boolean => {
  return Capacitor.getPlatform() === 'web';
};

export const getPlatform = (): string => {
  return Capacitor.getPlatform();
};

// Feature detection helpers
export const supportsCamera = (): boolean => {
  return isNative();
};

export const supportsFilesystem = (): boolean => {
  return isNative();
};

export const supportsHaptics = (): boolean => {
  return isNative();
};

export const supportsToast = (): boolean => {
  return isNative();
};

export const supportsShare = (): boolean => {
  return isNative() || ('share' in navigator);
};

// Get base URL for API calls
export const getBaseURL = (): string => {
  if (isWeb()) {
    return window.location.origin;
  }
  // For native apps, return your production API URL
  return import.meta.env.VITE_API_URL || 'https://your-production-url.com';
};

// Convert web URL to native URL (for Capacitor.convertFileSrc)
export const convertFileSrc = (filePath: string): string => {
  if (isNative()) {
    return Capacitor.convertFileSrc(filePath);
  }
  return filePath;
};

// Safe localStorage access (falls back to in-memory on native)
export const safeLocalStorage = {
  getItem: (key: string): string | null => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem: (key: string, value: string): void => {
    try {
      localStorage.setItem(key, value);
    } catch (error) {
      console.warn('localStorage unavailable:', error);
    }
  },
  removeItem: (key: string): void => {
    try {
      localStorage.removeItem(key);
    } catch (error) {
      console.warn('localStorage unavailable:', error);
    }
  },
  clear: (): void => {
    try {
      localStorage.clear();
    } catch (error) {
      console.warn('localStorage unavailable:', error);
    }
  },
};
