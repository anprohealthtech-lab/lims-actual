# Firebase Cloud Messaging (FCM) Setup Guide

## Overview
Firebase Cloud Messaging is now integrated into LIMS Builder Android app for push notifications.

## Configuration Details

### Firebase Project Info
- **Project ID**: task-manager-d391c
- **Project Number**: 967577828067
- **Package Name**: com.lims.builder
- **App ID**: 1:967577828067:android:34a605e57140219f76e3d6

### Files Added
1. ✅ `android/app/google-services.json` - Firebase configuration
2. ✅ `src/utils/firebaseMessaging.ts` - FCM service
3. ✅ `src/components/Settings/NotificationSettings.tsx` - User notification preferences

### Dependencies Installed
- `@capacitor-firebase/messaging` - Capacitor Firebase plugin
- Firebase BOM 32.7.0 (Android native)
- Firebase Messaging & Analytics

## Features

### 1. **Push Notifications**
- Real-time order updates
- Test result ready notifications
- Payment reminders
- System alerts

### 2. **Topic-Based Notifications**
Users can subscribe/unsubscribe from:
- `order-updates` - Order status changes
- `result-ready` - Test results available
- `payment-reminders` - Payment due notifications
- `system-alerts` - Important system updates

### 3. **Notification Handling**
- **Foreground**: Shows toast with notification content
- **Background**: Standard Android notification
- **Tap Action**: Deep links to relevant pages

## Usage

### Initialize Firebase (Auto-initialized on app start)
```typescript
import { initializeFirebaseMessaging } from '@/utils/firebaseMessaging';

// Called automatically in nativeInit.ts
await initializeFirebaseMessaging();
```

### Get FCM Token
```typescript
import { getFirebaseToken } from '@/utils/firebaseMessaging';

const token = await getFirebaseToken();
console.log('FCM Token:', token);

// Send this token to your backend to send notifications
```

### Subscribe to Topics
```typescript
import { subscribeToTopic } from '@/utils/firebaseMessaging';

await subscribeToTopic('order-updates');
await subscribeToTopic('result-ready');
```

### Unsubscribe from Topics
```typescript
import { unsubscribeFromTopic } from '@/utils/firebaseMessaging';

await unsubscribeFromTopic('order-updates');
```

### User Notification Settings
Add to Settings page:
```tsx
import { NotificationSettings } from '@/components/Settings/NotificationSettings';

<NotificationSettings />
```

## Notification Payload Format

### Send via Firebase Console or API

#### Basic Notification
```json
{
  "notification": {
    "title": "Order Completed",
    "body": "Order #12345 has been completed"
  },
  "data": {
    "type": "order_completed",
    "orderId": "12345"
  },
  "token": "DEVICE_FCM_TOKEN"
}
```

#### Result Ready Notification
```json
{
  "notification": {
    "title": "Test Results Ready",
    "body": "Results for patient John Doe are ready"
  },
  "data": {
    "type": "result_ready",
    "patientId": "67890",
    "orderId": "12345"
  },
  "token": "DEVICE_FCM_TOKEN"
}
```

#### Topic Notification
```json
{
  "notification": {
    "title": "System Maintenance",
    "body": "System will be under maintenance tonight"
  },
  "data": {
    "type": "system_alert"
  },
  "topic": "system-alerts"
}
```

## Backend Integration

### 1. Save FCM Token
When user logs in, save their FCM token to your database:

```sql
-- Add column to users table
ALTER TABLE users ADD COLUMN fcm_token TEXT;

-- Update token
UPDATE users 
SET fcm_token = 'USER_FCM_TOKEN'
WHERE id = 'USER_ID';
```

### 2. Send Notifications via Admin SDK

Install Firebase Admin SDK:
```bash
npm install firebase-admin
```

Initialize:
```typescript
import * as admin from 'firebase-admin';

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: 'task-manager-d391c',
    privateKey: process.env.FIREBASE_PRIVATE_KEY,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  }),
});
```

Send notification:
```typescript
async function sendNotification(token: string, orderId: string) {
  const message = {
    notification: {
      title: 'Order Completed',
      body: `Order #${orderId} has been completed`,
    },
    data: {
      type: 'order_completed',
      orderId: orderId,
    },
    token: token,
    android: {
      priority: 'high',
      notification: {
        sound: 'default',
        color: '#1a56db',
      },
    },
  };

  try {
    const response = await admin.messaging().send(message);
    console.log('Notification sent:', response);
  } catch (error) {
    console.error('Error sending notification:', error);
  }
}
```

### 3. Send to Topic
```typescript
async function sendTopicNotification(topic: string, title: string, body: string) {
  const message = {
    notification: { title, body },
    topic: topic,
  };

  await admin.messaging().send(message);
}
```

## Testing

### 1. Test from Firebase Console
1. Go to Firebase Console → Cloud Messaging
2. Click "Send your first message"
3. Enter notification title and body
4. Target: Single device → Paste FCM token
5. Send test message

### 2. Test Topics
1. App subscribes to topic
2. Send to topic from Firebase Console
3. All subscribed devices receive notification

### 3. Test Deep Linking
Send notification with data:
```json
{
  "data": {
    "orderId": "12345"
  }
}
```
Tap notification → App opens to `/orders/12345`

## Notification Types & Actions

| Type | Title | Body | Action |
|------|-------|------|--------|
| `order_completed` | Order Completed | Order #{id} completed | Navigate to order details |
| `result_ready` | Results Ready | Results for {patient} ready | Navigate to results page |
| `payment_due` | Payment Reminder | Payment of ₹{amount} due | Navigate to billing |
| `system_alert` | System Alert | {message} | Show in-app |

## Android Notification Channels

Defined in Android for better notification management:

```kotlin
// High priority for urgent notifications
val urgentChannel = NotificationChannel(
    "urgent",
    "Urgent Notifications",
    NotificationManager.IMPORTANCE_HIGH
)

// Default for regular updates
val defaultChannel = NotificationChannel(
    "default",
    "General Notifications",
    NotificationManager.IMPORTANCE_DEFAULT
)
```

## Permissions

### Auto-requested Permissions
- `POST_NOTIFICATIONS` (Android 13+)
- Internet access

### Manifest Permissions (already added)
```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
```

## Troubleshooting

### Notifications Not Received
1. **Check Permissions**: Settings → Apps → LIMS Builder → Notifications → Enabled
2. **Check FCM Token**: Verify token is saved to database
3. **Check Firebase Console**: Verify message sent successfully
4. **Check Network**: Device must be online
5. **Check Battery Optimization**: Disable for LIMS Builder

### Token Not Generated
1. Check `google-services.json` is in `android/app/`
2. Rebuild app: `npm run android:sync`
3. Check logs: `adb logcat | grep FCM`

### Deep Links Not Working
1. Verify notification data includes navigation info
2. Check `handleNotificationAction` in `firebaseMessaging.ts`
3. Test navigation routes exist

## Build & Deploy

### Sync Changes to Android
```bash
npm run build
npx cap sync android
```

### Open in Android Studio
```bash
npx cap open android
```

### Build APK
```bash
cd android
./gradlew assembleRelease
```

## Security Best Practices

1. ✅ Never commit Firebase credentials to git
2. ✅ Use environment variables for sensitive data
3. ✅ Validate notification data before processing
4. ✅ Implement server-side token validation
5. ✅ Rotate FCM tokens periodically
6. ✅ Implement rate limiting on backend

## Next Steps

### Backend Implementation
1. Create API endpoint to save FCM tokens
2. Set up Firebase Admin SDK
3. Create notification service
4. Trigger notifications on order/result updates

### Database Schema
```sql
CREATE TABLE user_fcm_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  fcm_token TEXT NOT NULL,
  device_info JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, fcm_token)
);

CREATE TABLE notification_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  notification_type TEXT,
  title TEXT,
  body TEXT,
  data JSONB,
  sent_at TIMESTAMP DEFAULT NOW(),
  delivered BOOLEAN DEFAULT FALSE
);
```

## Resources

- [Firebase Console](https://console.firebase.google.com/project/task-manager-d391c)
- [Capacitor Firebase Messaging](https://github.com/capawesome-team/capacitor-firebase/tree/main/packages/messaging)
- [Firebase Cloud Messaging Docs](https://firebase.google.com/docs/cloud-messaging)
- [Firebase Admin SDK](https://firebase.google.com/docs/admin/setup)

## Support

For issues or questions:
1. Check Firebase Console logs
2. Review `adb logcat` for Android errors
3. Test with Firebase Console first
4. Verify google-services.json configuration
