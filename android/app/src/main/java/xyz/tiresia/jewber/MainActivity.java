package xyz.tiresia.jewber;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.NotificationManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.location.LocationManager;
import android.media.AudioAttributes;
import android.speech.tts.TextToSpeech;
import java.util.Locale;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.provider.Settings;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.GeolocationPermissions;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.window.OnBackInvokedDispatcher;

import org.json.JSONObject;

/**
 * Jewber in a window: the live site in a WebView between the status bar and the navigation
 * bar (or the keyboard). Links to other places (Cash App, Venmo, Waze, Maps, phone, texts)
 * leave for their own apps. Back goes through the page first.
 */
public class MainActivity extends Activity {
    private WebView web;
    private FrameLayout root;
    private String lookNow = "";
    private String pendingPaid;
    private TextToSpeech tts;
    private ValueCallback<Uri[]> fileCb;
    private boolean ttsReady;
    private boolean pageReady;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        LiveService.channels(this);
        // the test build ("Jewber dev") opens its page to DevTools, for tools/android-check.js
        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true);
        root = new FrameLayout(this);
        root.setBackgroundColor(0xFF1A2E9A);
        web = new WebView(this);
        web.setBackgroundColor(0xFF1A2E9A);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setGeolocationEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setUserAgentString(s.getUserAgentString() + " " + Api.ua());
        web.addJavascriptInterface(new Bridge(this), "JewberApp");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
                Uri u = req.getUrl();
                Uri base = Uri.parse(BuildConfig.BASE_URL);
                if (base.getHost() != null && base.getHost().equals(u.getHost()) && !u.getPath().endsWith(".apk")) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, u));
                } catch (Exception ignored) {
                }
                return true;
            }

            @Override
            public void onPageFinished(WebView v, String url) {
                pageReady = true;
                if (pendingPaid != null) {
                    v.evaluateJavascript("window.jewberPaid && window.jewberPaid(" + JSONObject.quote(pendingPaid) + ")", null);
                    pendingPaid = null;
                }
            }

            @Override
            public void onReceivedError(WebView v, WebResourceRequest req, WebResourceError err) {
                if (req.isForMainFrame()) offline();
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            // a profile photo: the phone's own picker
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (fileCb != null) fileCb.onReceiveValue(null);
                fileCb = cb;
                try {
                    startActivityForResult(params.createIntent(), 7);
                } catch (Exception e) {
                    fileCb = null;
                    return false;
                }
                return true;
            }

            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback cb) {
                boolean ok = checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
                if (!ok) askLocation();
                cb.invoke(origin, ok, false);
            }
        });
        root.addView(web, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);

        // Draw edge to edge and keep the page clear of the bars and the keyboard ourselves.
        getWindow().setDecorFitsSystemWindows(false);
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            android.graphics.Insets i = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime() | WindowInsets.Type.displayCutout());
            v.setPadding(i.left, i.top, i.right, i.bottom);
            return WindowInsets.CONSUMED;
        });

        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::back);
        }

        tts = new TextToSpeech(this, status -> {
            if (status != TextToSpeech.SUCCESS) return;
            tts.setLanguage(Locale.US);
            tts.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build());
            ttsReady = true;
        });
        web.loadUrl(BuildConfig.BASE_URL + "/");
        askFirst();
        handle(getIntent());
    }

    // ---- what the page looks like behind the bars: blue signed out, white for friends, night for the driver
    void look(String role, boolean dark) {
        String key = role + dark;
        if (key.equals(lookNow)) return;
        lookNow = key;
        boolean out = !"driver".equals(role) && !"rider".equals(role);
        int bg = out ? 0xFF1A2E9A : dark ? 0xFF0B1328 : 0xFFF2ECE0;
        root.setBackgroundColor(bg);
        boolean darkIcons = !out && !dark;
        WindowInsetsController c = getWindow().getInsetsController();
        if (c != null) {
            int mask = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
            c.setSystemBarsAppearance(darkIcons ? mask : 0, mask);
        }
    }

    private void offline() {
        web.loadDataWithBaseURL(null, "<!doctype html><meta name=viewport content='width=device-width'>"
                + "<body style='margin:0;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:24px;background:#2347D9;color:#fff;font-family:sans-serif'>"
                + "<b style='font-size:44px'>Jewber</b><span style='font-size:18px'>No connection</span>"
                + "<button onclick='location.replace(\"" + BuildConfig.BASE_URL + "/\")' style='height:52px;padding:0 32px;border:0;border-radius:14px;background:#F5B82E;color:#111216;font-size:18px;font-weight:700'>Try again</button></body>",
                "text/html", "utf-8", null);
    }

    // ---- permissions
    private void askFirst() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS, Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, 1);
        } else {
            askLocation();
        }
    }

    void askLocation() {
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, 2);
        }
    }

    /** Once: ask to leave the driver's service alone when the battery is low on attention. */
    void askBattery() {
        if (Store.prefs(this).getBoolean("askedBattery", false)) return;
        Store.prefs(this).edit().putBoolean("askedBattery", true).apply();
        PowerManager pm = getSystemService(PowerManager.class);
        if (pm.isIgnoringBatteryOptimizations(getPackageName())) return;
        try {
            startActivity(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getPackageName())));
        } catch (Exception ignored) {
        }
    }

    /** Ask the phone for a new fix so the next location() is fresh. */
    void freshFix() {
        try {
            LocationManager lm = getSystemService(LocationManager.class);
            String p = lm.isProviderEnabled(LocationManager.GPS_PROVIDER) ? LocationManager.GPS_PROVIDER : LocationManager.NETWORK_PROVIDER;
            lm.getCurrentLocation(p, null, getMainExecutor(), l -> {});
        } catch (Exception ignored) {
        }
    }

    @Override
    @SuppressWarnings("deprecation")
    protected void onActivityResult(int code, int result, Intent data) {
        super.onActivityResult(code, result, data);
        if (code == 7 && fileCb != null) {
            fileCb.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
            fileCb = null;
        }
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        // a driver who just allowed location: start sharing it if they're on duty
        String sync = Store.prefs(this).getString("sync", null);
        if (sync != null) {
            try {
                LiveService.sync(this, new JSONObject(sync));
            } catch (Exception ignored) {
            }
        }
        web.evaluateJavascript("window.jewberRefresh && window.jewberRefresh()", null);
    }

    // ---- notification buttons that open the app (Accept, the ride notification)
    @Override
    protected void onNewIntent(Intent i) {
        super.onNewIntent(i);
        setIntent(i);
        handle(i);
    }

    private void handle(Intent i) {
        if (i == null) return;
        Uri data = i.getData();
        if (data != null && "jewber".equals(data.getScheme())) {
            String paid = data.getQueryParameter("paid");
            i.setData(null);
            if (paid == null) return;
            if (pageReady) web.evaluateJavascript("window.jewberPaid && window.jewberPaid(" + JSONObject.quote(paid) + ")", null);
            else pendingPaid = paid;
            return;
        }
        String act = i.getStringExtra("act");
        String id = i.getStringExtra("ride");
        if (act == null || id == null) return;
        i.removeExtra("act");
        getSystemService(NotificationManager.class).cancel(LiveService.requestNoteId(id));
        if ("accept".equals(act)) {
            new Thread(() -> {
                try {
                    Api.call(this, "POST", "/api/rides/" + id + "/accept", new JSONObject());
                } catch (Exception ignored) {
                }
                runOnUiThread(() -> web.evaluateJavascript("window.jewberRefresh && window.jewberRefresh()", null));
            }).start();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
        web.evaluateJavascript("window.jewberRefresh && window.jewberRefresh()", null);
    }

    @Override
    protected void onPause() {
        web.onPause();
        super.onPause();
    }

    private void back() {
        web.evaluateJavascript("window.jewberBack ? String(window.jewberBack()) : 'false'", v -> {
            if (!"\"true\"".equals(v) && !"true".equals(v)) moveTaskToBack(true);
        });
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        back();
    }

    void speak(String text) {
        if (ttsReady && text != null) tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "jewber-nav");
    }

    void stopSpeaking() {
        if (ttsReady) tts.stop();
    }

    @Override
    protected void onDestroy() {
        if (tts != null) tts.shutdown();
        root.removeView(web);
        web.destroy();
        super.onDestroy();
    }

    static Intent open(android.content.Context c) {
        return new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
    }
}
