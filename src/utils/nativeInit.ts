import { StatusBar, Style } from '@capacitor/status-bar';
import { App as CapApp } from '@capacitor/app';
import { Network } from '@capacitor/network';
import { isNative, isAndroid } from './platformHelper';
import { initializeFirebaseMessaging, cleanupFirebaseMessaging as cleanupFCM } from './firebaseMessaging';

/**
 * Initialize native platform features
 */
export const initializeNativePlatform = async (): Promise<void> => {
  if (!isNative()) {
    console.log('Running on web platform - skipping native initialization');
    return;
  }

  console.log('Initializing native platform features...');

  try {
    // Configure status bar
    if (isAndroid()) {
      await StatusBar.setStyle({ style: Style.Dark });
      await StatusBar.setBackgroundColor({ color: '#1a56db' });
    }

    // Initialize Firebase Cloud Messaging
    await initializeFirebaseMessaging();

    // Initialize Camera permissions check
    console.log('Checking camera availability...');
    try {
      const { Camera } = await import('@capacitor/camera');
      const permissions = await Camera.checkPermissions();
      console.log('Camera permissions status:', permissions);
    } catch (error) {
      console.warn('Camera initialization warning:', error);
    }

    // Listen for app state changes
    CapApp.addListener('appStateChange', ({ isActive }) => {
      console.log('App state changed. Is active:', isActive);
      // You can add logic here to pause/resume operations
    });

    // Listen for app URL open (deep linking)
    CapApp.addListener('appUrlOpen', (data) => {
      console.log('App opened with URL:', data.url);
      // Handle deep linking here
    });

    // Monitor network status
    Network.addListener('networkStatusChange', (status) => {
      console.log('Network status changed:', status);
      // You can show offline/online notifications
    });

    // Get initial network status
    const networkStatus = await Network.getStatus();
    console.log('Initial network status:', networkStatus);

    console.log('Native platform initialization complete');
  } catch (error) {
    console.error('Failed to initialize native platform:', error);
  }
};

/**
 * Clean up native listeners on app unmount
 */
export const cleanupNativePlatform = (): void => {
  if (!isNative()) {
    return;
  }

  try {
    CapApp.removeAllListeners();
    Network.removeAllListeners();
    cleanupFCM();
    console.log('Native platform cleanup complete');
  } catch (error) {
    console.error('Failed to cleanup native platform:', error);
  }
};
