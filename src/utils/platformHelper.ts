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
