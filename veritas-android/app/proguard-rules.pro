# Veritas Android - ProGuard / R8 rules

# Keep annotations for reflection
-keepattributes *Annotation*
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# Keep app classes accessed from JNI/Reflection
-keep class com.veritas.ai.** { *; }
-keepclassmembers class com.veritas.ai.** { *; }

# Keep Kotlin coroutines (lifecycleScope)
-dontwarn kotlinx.coroutines.**
-keep class kotlinx.coroutines.** { *; }

# Keep Kotlin metadata
-keepattributes RuntimeVisibleAnnotations
-keep class kotlin.Metadata { *; }

# WebView JS bridge
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Keep JSON classes (Org.json)
-keep class org.json.** { *; }

# AndroidX
-dontwarn androidx.**
-keep class androidx.** { *; }

# CameraX
-dontwarn androidx.camera.**