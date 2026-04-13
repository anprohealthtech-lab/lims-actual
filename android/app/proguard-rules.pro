# Add project specific ProGuard rules here.

# Keep line numbers for debugging crash stack traces
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# ===== CAPACITOR =====
-keep class com.getcapacitor.** { *; }
-keep class com.getcapacitor.plugin.** { *; }
-keepclassmembers class * extends com.getcapacitor.Plugin {
    @com.getcapacitor.annotation.CapacitorPlugin <methods>;
    @com.getcapacitor.PluginMethod <methods>;
}

# ===== FIREBASE =====
-keep class com.google.firebase.** { *; }
-keep class com.google.android.gms.** { *; }
-dontwarn com.google.firebase.**
-dontwarn com.google.android.gms.**

# Firebase Messaging
-keep class com.google.firebase.messaging.** { *; }

# ===== WEBVIEW / JAVASCRIPT INTERFACE =====
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# ===== ANDROIDX =====
-keep class androidx.** { *; }
-dontwarn androidx.**

# ===== APP CLASSES =====
-keep class com.lims.builder.** { *; }

# ===== GENERAL =====
-keepattributes *Annotation*
-keepattributes Signature
-keepattributes Exceptions
