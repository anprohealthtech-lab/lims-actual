import { FirebaseMessaging } from '@capacitor-firebase/messaging';
import { isNative } from './platformHelper';
import { Toast } from '@capacitor/toast';

export interface PushNotification {
  title?: string;
  body?: string;
  data?: { [key: string]: string };
  id?: string;
}

/**
 * Initialize Firebase Cloud Messaging
 */
export const initializeFirebaseMessaging = async (): Promise<void> => {
  if (!isNative()) {
    console.log('Firebase Messaging only available on native platforms');
    return;
  }

  try {
    // Request notification permissions
    const permissionResult = await FirebaseMessaging.requestPermissions();
    
    if (permissionResult.receive === 'granted') {
      console.log('Push notification permission granted');
      
      // Get FCM token
      const { token } = await FirebaseMessaging.getToken();
      console.log('FCM Token:', token);
      
      // TODO: Send token to your backend server
      // await sendTokenToServer(token);
      
      // Listen for token refresh
      await FirebaseMessaging.addListener('tokenReceived', (event) => {
        console.log('FCM Token refreshed:', event.token);
        // TODO: Update token on your server
      });
      
      // Listen for incoming notifications
      await FirebaseMessaging.addListener('notificationReceived', (notification) => {
        console.log('Notification received:', notification);
        handleNotification(notification);
      });
      
      // Listen for notification taps
      await FirebaseMessaging.addListener('notificationActionPerformed', (action) => {
        console.log('Notification action performed:', action);
        handleNotificationAction(action);
      });
      
    } else {
      console.warn('Push notification permission denied');
    }
  } catch (error) {
    console.error('Failed to initialize Firebase Messaging:', error);
  }
};

/**
 * Handle incoming notification
 */
const handleNotification = async (notification: PushNotification): Promise<void> => {
  try {
    // Show toast for foreground notifications
    await Toast.show({
      text: `${notification.title}: ${notification.body}`,
      duration: 'long',
      position: 'top',
    });
    
    // You can add custom logic here based on notification data
    if (notification.data?.type === 'order_completed') {
      // Navigate to orders page or refresh data
      console.log('Order completed notification');
    } else if (notification.data?.type === 'result_ready') {
      // Navigate to results page
      console.log('Result ready notification');
    }
  } catch (error) {
    console.error('Error handling notification:', error);
  }
};

/**
 * Handle notification tap/action
 */
const handleNotificationAction = (action: any): void => {
  const { notification, actionId } = action;
  
  console.log('User tapped notification:', notification);
  console.log('Action ID:', actionId);
  
  // Navigate based on notification data
  if (notification.data?.orderId) {
    // TODO: Navigate to order details
    window.location.href = `/orders/${notification.data.orderId}`;
  } else if (notification.data?.patientId) {
    // TODO: Navigate to patient details
    window.location.href = `/patients/${notification.data.patientId}`;
  }
};

/**
 * Get current FCM token
 */
export const getFirebaseToken = async (): Promise<string | null> => {
  if (!isNative()) {
    return null;
  }
  
  try {
    const { token } = await FirebaseMessaging.getToken();
    return token;
  } catch (error) {
    console.error('Failed to get FCM token:', error);
    return null;
  }
};

/**
 * Delete FCM token (logout scenario)
 */
export const deleteFirebaseToken = async (): Promise<void> => {
  if (!isNative()) {
    return;
  }
  
  try {
    await FirebaseMessaging.deleteToken();
    console.log('FCM token deleted');
  } catch (error) {
    console.error('Failed to delete FCM token:', error);
  }
};

/**
 * Subscribe to a topic
 */
export const subscribeToTopic = async (topic: string): Promise<void> => {
  if (!isNative()) {
    return;
  }
  
  try {
    await FirebaseMessaging.subscribeToTopic({ topic });
    console.log(`Subscribed to topic: ${topic}`);
  } catch (error) {
    console.error(`Failed to subscribe to topic ${topic}:`, error);
  }
};

/**
 * Unsubscribe from a topic
 */
export const unsubscribeFromTopic = async (topic: string): Promise<void> => {
  if (!isNative()) {
    return;
  }
  
  try {
    await FirebaseMessaging.unsubscribeFromTopic({ topic });
    console.log(`Unsubscribed from topic: ${topic}`);
  } catch (error) {
    console.error(`Failed to unsubscribe from topic ${topic}:`, error);
  }
};

/**
 * Remove all notification listeners
 */
export const cleanupFirebaseMessaging = async (): Promise<void> => {
  if (!isNative()) {
    return;
  }
  
  try {
    await FirebaseMessaging.removeAllListeners();
    console.log('Firebase Messaging listeners cleaned up');
  } catch (error) {
    console.error('Failed to cleanup Firebase Messaging:', error);
  }
};
