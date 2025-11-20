# Capacitor Android App Setup & UI Enhancement Guide

This guide walks you through converting a React/Vite web app to a native Android app using Capacitor, including Android-specific UI optimizations.

---

## **Part 1: Initial Capacitor Setup**

### **Prerequisites**
- Node.js 16+ and npm installed
- Android Studio installed
- JDK 17 or higher (JDK 23 recommended)
- Existing React/Vite web application

### **Step 1: Install Capacitor**

```bash
# Install Capacitor core and CLI
npm install @capacitor/core @capacitor/cli

# Initialize Capacitor (run from project root)
npx cap init
```

When prompted:
- **App name**: Your app display name (e.g., "My Task Manager")
- **App ID**: Reverse domain notation (e.g., "com.example.myapp")
- **Web asset directory**: `dist` (for Vite) or `build` (for Create React App)

### **Step 2: Add Android Platform**

```bash
# Install Android platform
npm install @capacitor/android

# Add Android project
npx cap add android
```

This creates an `android/` folder with a native Android Studio project.

### **Step 3: Configure Capacitor**

Create/update `capacitor.config.ts`:

```typescript
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.example.myapp',
  appName: 'My App Name',
  webDir: 'dist', // or 'build' for CRA
  server: {
    androidScheme: 'https' // Use HTTPS scheme for better security
  },
  android: {
    allowMixedContent: false,
    backgroundColor: '#ffffff',
    webContentsDebuggingEnabled: false, // Disable in production
    useLegacyBridge: false
  }
};

export default config;
```

### **Step 4: Build and Sync**

```bash
# Build your web app
npm run build

# Sync web assets to Android
npx cap sync android

# Open in Android Studio
npx cap open android
```

---

## **Part 2: Android-Specific UI Enhancements**

### **1. Safe Area Support for Notches/Status Bars**

**Problem**: Content appears too close to screen edges on devices with notches.

**Solution**: Add safe area CSS to `src/index.css`:

```css
/* Safe area support for Android notches and status bars */
.safe-area-container {
  padding: env(safe-area-inset-top) env(safe-area-inset-right) 
           env(safe-area-inset-bottom) env(safe-area-inset-left);
}

/* Android-specific header padding with fallback */
@supports (padding: max(0px)) {
  .android-header {
    padding-top: max(24px, env(safe-area-inset-top));
  }
}

/* Safe area utilities */
.pt-safe {
  padding-top: env(safe-area-inset-top, 0px);
}

.pb-safe {
  padding-bottom: env(safe-area-inset-bottom, 0px);
}

.pl-safe {
  padding-left: env(safe-area-inset-left, 0px);
}

.pr-safe {
  padding-right: env(safe-area-inset-right, 0px);
}
```

**Apply to components**:

```tsx
// In App.tsx - Main container
<div className="min-h-screen bg-gray-100 safe-area-container">
  {/* Your app content */}
</div>

// In Header.tsx - Header component
<header className="bg-white shadow-sm android-header">
  {/* Header content */}
</header>
```

### **2. Platform Detection Utility**

Create `src/utils/platformHelper.ts`:

```typescript
import { Capacitor } from '@capacitor/core';

/**
 * Check if the app is running on Android platform
 */
export const isAndroid = (): boolean => {
  return Capacitor.getPlatform() === 'android';
};

/**
 * Check if the app is running on iOS platform
 */
export const isIOS = (): boolean => {
  return Capacitor.getPlatform() === 'ios';
};

/**
 * Check if the app is running in a native context (iOS or Android)
 */
export const isNative = (): boolean => {
  return Capacitor.isNativePlatform();
};

/**
 * Check if the app is running in web browser
 */
export const isWeb = (): boolean => {
  return Capacitor.getPlatform() === 'web';
};

/**
 * Get the current platform name
 */
export const getPlatform = (): string => {
  return Capacitor.getPlatform();
};

/**
 * Check if the device is a mobile device (native iOS or Android)
 */
export const isMobile = (): boolean => {
  return isAndroid() || isIOS();
};
```

**Usage in components**:

```tsx
import { isAndroid, isNative } from '../utils/platformHelper';

// Conditionally render native components
{isAndroid() && <AndroidSpecificButton />}

// Apply platform-specific styles
<div className={isNative() ? 'native-styles' : 'web-styles'}>
  {/* Content */}
</div>

// Different behavior for native vs web
const handleClick = () => {
  if (isNative()) {
    // Use native dialog
    Dialog.alert({ title: 'Hello', message: 'Native alert!' });
  } else {
    // Use web alert
    alert('Web alert!');
  }
};
```

### **3. Native UI Plugins**

Install essential native UI plugins:

```bash
npm install @capacitor/action-sheet @capacitor/dialog @capacitor/haptics
```

**Action Sheet** (Native bottom menus):

```tsx
import { ActionSheet } from '@capacitor/action-sheet';

const showActions = async () => {
  const result = await ActionSheet.showActions({
    title: 'Choose an option',
    options: [
      { title: 'Edit Task' },
      { title: 'Delete Task', style: 'destructive' },
      { title: 'Cancel', style: 'cancel' }
    ]
  });
  
  if (result.index === 0) {
    // Handle Edit
  } else if (result.index === 1) {
    // Handle Delete
  }
};
```

**Native Dialogs**:

```tsx
import { Dialog } from '@capacitor/dialog';

// Confirm dialog
const confirmDelete = async () => {
  const { value } = await Dialog.confirm({
    title: 'Confirm',
    message: 'Are you sure you want to delete this task?'
  });
  
  if (value) {
    // User confirmed
  }
};

// Alert dialog
await Dialog.alert({
  title: 'Success',
  message: 'Task created successfully!'
});

// Prompt dialog
const { value, cancelled } = await Dialog.prompt({
  title: 'Enter task name',
  message: 'What would you like to call this task?'
});
```

**Haptic Feedback**:

```tsx
import { Haptics, ImpactStyle } from '@capacitor/haptics';

// Light tap feedback (for buttons)
const handleButtonClick = async () => {
  await Haptics.impact({ style: ImpactStyle.Light });
  // ... rest of button logic
};

// Medium impact (for important actions)
const handleDelete = async () => {
  await Haptics.impact({ style: ImpactStyle.Medium });
  // ... delete logic
};

// Notification haptic
await Haptics.notification({ type: 'SUCCESS' });
```

### **4. Keyboard Handling**

Update `android/app/src/main/AndroidManifest.xml`:

```xml
<activity
    android:name=".MainActivity"
    android:windowSoftInputMode="adjustResize"
    ...other attributes...>
```

This ensures the keyboard doesn't cover input fields.

### **5. Status Bar Configuration**

Install Status Bar plugin:

```bash
npm install @capacitor/status-bar
```

Configure in `capacitor.config.ts`:

```typescript
plugins: {
  StatusBar: {
    style: 'default', // or 'dark', 'light'
    backgroundColor: '#ffffff'
  }
}
```

Use programmatically:

```tsx
import { StatusBar, Style } from '@capacitor/status-bar';
import { useEffect } from 'react';

useEffect(() => {
  if (isAndroid()) {
    StatusBar.setStyle({ style: Style.Light });
    StatusBar.setBackgroundColor({ color: '#ffffff' });
  }
}, []);
```

---

## **Part 3: Build & Release**

### **Update Version Numbers**

Edit `android/app/build.gradle`:

```gradle
defaultConfig {
    ...
    versionCode 1      // Increment for each release
    versionName "1.0.0" // User-visible version
}
```

### **Configure Signing (for Release Builds)**

1. **Generate Keystore** (first time only):

```bash
keytool -genkey -v -keystore my-release-key.jks -keyalg RSA -keysize 2048 -validity 10000 -alias my-key-alias
```

2. **Configure in `android/app/build.gradle`**:

```gradle
android {
    ...
    signingConfigs {
        release {
            storeFile file('../../my-release-key.jks')
            storePassword 'your-store-password'
            keyAlias 'my-key-alias'
            keyPassword 'your-key-password'
        }
    }
    
    buildTypes {
        release {
            signingConfig signingConfigs.release
            minifyEnabled false
            proguardFiles getDefaultProguardFile('proguard-android.txt'), 'proguard-rules.pro'
        }
    }
}
```

### **Build Release APK/AAB**

**Option 1: Command Line**

```bash
cd android
./gradlew clean assembleRelease    # For APK
./gradlew clean bundleRelease       # For AAB (Google Play)
```

Output location:
- APK: `android/app/build/outputs/apk/release/app-release.apk`
- AAB: `android/app/build/outputs/bundle/release/app-release.aab`

**Option 2: Android Studio**

1. Open project: `npx cap open android`
2. Build → Generate Signed Bundle/APK
3. Select APK or Android App Bundle
4. Choose your keystore and enter passwords
5. Select `release` build variant
6. Click Finish

---

## **Part 4: Common Issues & Solutions**

### **Issue 1: Java Version Errors**

**Error**: `Cannot find Java installation matching requirements`

**Solution**: Set JAVA_HOME in gradle.properties:

```properties
# android/gradle.properties
org.gradle.java.home=C:\\Program Files\\Java\\jdk-23
```

Or set environment variable before building:

```bash
$env:JAVA_HOME = "C:\Program Files\Java\jdk-23"
cd android
./gradlew assembleDebug
```

### **Issue 2: Kotlin Duplicate Classes**

**Error**: `Duplicate class kotlin.collections.jdk8.CollectionsJDK8Kt`

**Solution**: Add to `android/app/build.gradle`:

```gradle
dependencies {
    // Kotlin BOM to align all Kotlin versions
    implementation platform('org.jetbrains.kotlin:kotlin-bom:1.8.22')
    
    // Exclude old Kotlin stdlib variants
    implementation(project(':capacitor-cordova-android-plugins')) {
        exclude group: 'org.jetbrains.kotlin', module: 'kotlin-stdlib-jdk7'
        exclude group: 'org.jetbrains.kotlin', module: 'kotlin-stdlib-jdk8'
    }
}

// Global exclusion
configurations.all {
    exclude group: 'org.jetbrains.kotlin', module: 'kotlin-stdlib-jdk7'
    exclude group: 'org.jetbrains.kotlin', module: 'kotlin-stdlib-jdk8'
    
    resolutionStrategy {
        force "org.jetbrains.kotlin:kotlin-stdlib:1.8.22"
    }
}
```

### **Issue 3: capacitor-filesystem Java 21 Requirement**

**Error**: `Cannot find Java installation matching languageVersion=21`

**Solution**: Patch the plugin (temporary fix until npm install):

```bash
# PowerShell
$filePath = "node_modules\@capacitor\filesystem\android\build.gradle"
(Get-Content $filePath) -replace 'JavaVersion.VERSION_21', 'JavaVersion.VERSION_17' -replace 'jvmToolchain\(21\)', 'jvmToolchain(17)' | Set-Content $filePath
```

Then remove toolchain requirement:

```bash
$filePath = "node_modules\@capacitor\filesystem\android\build.gradle"
$content = Get-Content $filePath -Raw
$newContent = $content -replace 'kotlin \{[\s\S]*?jvmToolchain\(17\)[\s\S]*?\}', ''
$newContent | Set-Content $filePath
```

### **Issue 4: AAR Metadata Warnings (androidx.core)**

**Error**: `Dependency requires compileSdk 36 / AGP 8.9`

**Solution**: Force older androidx.core version in `android/app/build.gradle`:

```gradle
dependencies {
    implementation "androidx.core:core:$androidxCoreVersion"
    implementation "androidx.core:core-ktx:$androidxCoreVersion"
    ...
}

configurations.all {
    resolutionStrategy.eachDependency { details ->
        if (details.requested.group == 'androidx.core' && 
            details.requested.name in ['core', 'core-ktx']) {
            details.useVersion(rootProject.ext.androidxCoreVersion)
            details.because('androidx.core 1.17+ requires compileSdk 36')
        }
    }
}
```

---

## **Part 5: Additional Capacitor Plugins**

### **Essential Plugins**

```bash
# Camera access
npm install @capacitor/camera

# File system operations
npm install @capacitor/filesystem

# Device information
npm install @capacitor/device

# Network status
npm install @capacitor/network

# Push notifications
npm install @capacitor/push-notifications

# Local storage
npm install @capacitor/preferences

# Share content
npm install @capacitor/share

# Toast notifications
npm install @capacitor/toast
```

### **Usage Examples**

**Camera**:

```tsx
import { Camera, CameraResultType } from '@capacitor/camera';

const takePicture = async () => {
  const image = await Camera.getPhoto({
    quality: 90,
    allowEditing: false,
    resultType: CameraResultType.DataUrl
  });
  
  const imageUrl = image.dataUrl;
  // Use imageUrl in your app
};
```

**Network Status**:

```tsx
import { Network } from '@capacitor/network';

const checkConnection = async () => {
  const status = await Network.getStatus();
  console.log('Network status:', status.connected);
};

// Listen for changes
Network.addListener('networkStatusChange', status => {
  console.log('Network status changed:', status.connected);
});
```

**Toast Notification**:

```tsx
import { Toast } from '@capacitor/toast';

await Toast.show({
  text: 'Task created successfully!',
  duration: 'short', // or 'long'
  position: 'bottom' // or 'top', 'center'
});
```

---

## **Part 6: Development Workflow**

### **Live Reload Setup**

For faster development, use live reload:

1. Update `capacitor.config.ts`:

```typescript
const config: CapacitorConfig = {
  ...
  server: {
    url: 'http://192.168.1.100:5173', // Your local IP:port
    cleartext: true
  }
};
```

2. Start dev server:

```bash
npm run dev
```

3. Sync and run:

```bash
npx cap sync android
npx cap run android
```

**Important**: Remove `server.url` before building for production!

### **Debugging**

**View logs in Android Studio**:
- Open Logcat (View → Tool Windows → Logcat)
- Filter by package name: `com.example.myapp`

**Enable web debugging**:

```typescript
// capacitor.config.ts (dev only)
android: {
  webContentsDebuggingEnabled: true
}
```

Then open `chrome://inspect` in Chrome to debug WebView.

### **Clean Build**

If encountering build issues:

```bash
cd android
Remove-Item .gradle -Recurse -Force
Remove-Item build -Recurse -Force
Remove-Item app\build -Recurse -Force
./gradlew clean
```

---

## **Part 7: Testing Checklist**

Before releasing:

- [ ] Test on multiple Android versions (minimum supported to latest)
- [ ] Test on different screen sizes (phone, tablet)
- [ ] Test with/without network connection
- [ ] Test keyboard behavior on all input fields
- [ ] Verify safe areas on devices with notches
- [ ] Test push notifications (if implemented)
- [ ] Check app permissions work correctly
- [ ] Verify app icons and splash screen display correctly
- [ ] Test deep links and app scheme URLs
- [ ] Performance test (app launch time, memory usage)
- [ ] Security test (no sensitive data in logs)

---

## **Summary of UI Enhancements Applied**

✅ **Safe Area CSS** - Proper padding for notches/status bars  
✅ **Platform Detection** - Conditional rendering based on platform  
✅ **Native Dialogs** - Action sheets, alerts, confirms  
✅ **Haptic Feedback** - Tactile response for interactions  
✅ **Keyboard Handling** - `adjustResize` for proper input field visibility  
✅ **Capacitor Config** - Optimized Android settings  
✅ **Version Control** - Proper versionCode/versionName management  
✅ **Build Configuration** - Release signing and optimization  

---

## **Resources**

- [Capacitor Documentation](https://capacitorjs.com/docs)
- [Capacitor Android Guide](https://capacitorjs.com/docs/android)
- [Android Developer Docs](https://developer.android.com)
- [Capacitor Plugins](https://capacitorjs.com/docs/plugins)

---

**Last Updated**: November 2025  
**Capacitor Version**: 7.x  
**Android Gradle Plugin**: 8.7.2  
**Minimum Android SDK**: 23 (Android 6.0)  
**Target Android SDK**: 35 (Android 15)
