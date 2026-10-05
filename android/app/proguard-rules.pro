# IinPublic release R8 rules (OPEN-35).
#
# The WebView calls these bridges by exact method name from JavaScript
# (window.IinPublicCustody / IinPublicNearby / IinPublicAttestation, registered in
# MainActivity.addJavascriptInterface). R8 sees no Kotlin call site for those methods, so
# without these rules it would rename or strip them and identity custody would fail silently.
-keepattributes JavascriptInterface
-keepclassmembers class com.iinpublic.app.** {
    @android.webkit.JavascriptInterface <methods>;
}
-keep class com.iinpublic.app.NativeCustodyBridge { *; }
-keep class com.iinpublic.app.NearbyJavascriptBridge { *; }
-keep class com.iinpublic.app.NativeAttestationBridge { *; }

# JNI: native-lib.cpp exports Java_com_iinpublic_app_NodeBridge_nativeStartNode, which binds
# by the class and method name.
-keepclasseswithmembernames,includedescriptorclasses class * {
    native <methods>;
}
-keep class com.iinpublic.app.NodeBridge { *; }

# NearbyConnectivityManager loads the API-26 Wi-Fi Aware provider by name via
# Class.forName + getDeclaredConstructor(Context, Listener, Handler).
-keep class com.iinpublic.app.WifiAwareConnectivityProvider {
    <init>(android.content.Context, com.iinpublic.app.NearbyConnectivityManager$Listener, android.os.Handler);
}

# Keep crash stack traces readable once mapping.txt is uploaded to Play Console.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
