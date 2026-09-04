# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
-renamesourcefileattribute SourceFile

# ══════════════════════════════════════════════════════════════
# ★ 2026-09-04 minifyEnabled true 로 켜면서 추가.
#   왜: Play 콘솔이 "앱 최적화가 기준점 미만입니다(난독화 4%)"를 지적해서 켰다.
#   Capacitor·Firebase·RevenueCat 등은 각자 라이브러리(AAR) 안에 자기 자신을
#   지키는 규칙(consumer proguard)을 이미 담고 있어 여기서 따로 안 적어도 된다
#   (여기서 그 라이브러리들까지 통째로 -keep 해버리면 난독화 비율이 다시
#    낮아져서 이 작업의 목적 자체가 없어진다).
#   이 앱 '자신'의 네이티브 플러그인 3개만 안전장치로 명시해 둔다.
# ══════════════════════════════════════════════════════════════
-keep class com.baesungchul.workreport.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin public class * {
    public *;
}
-keepclassmembers public class * extends com.getcapacitor.Plugin {
    @com.getcapacitor.PluginMethod public <methods>;
}
