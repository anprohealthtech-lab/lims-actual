import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.lims.builder',
  appName: 'LIMS Builder',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    cleartext: true, // Allow HTTP for development
    hostname: 'localhost',
  },
  plugins: {
    Camera: {
      saveToGallery: true,
      correctOrientation: true,
      quality: 90,
    },
    Filesystem: {
      androidScheme: 'https',
    },
    StatusBar: {
      backgroundColor: '#1a56db',
      style: 'dark',
      overlaysWebView: false, // Don't overlay web content
    },
    Keyboard: {
      resize: 'body',
      style: 'dark',
      resizeOnFullScreen: true,
    },
    FirebaseMessaging: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
  android: {
    allowMixedContent: true,
    captureInput: true,
    webContentsDebuggingEnabled: true,
    backgroundColor: '#ffffff',
    // Enable safe area insets
    overrideUserAgent: null,
    appendUserAgent: 'LIMS-Android',
  },
};

export default config;
