# The page calls these by name through window.JewberApp.
-keepclassmembers class xyz.tiresia.jewber.Bridge {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes JavascriptInterface
