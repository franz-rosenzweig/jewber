package xyz.tiresia.jewber;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationManager;
import android.net.Uri;
import android.webkit.JavascriptInterface;

import org.json.JSONObject;

/** window.JewberApp: what the page asks of the phone. Called on the WebView's own thread. */
final class Bridge {
    private final MainActivity act;

    Bridge(MainActivity act) {
        this.act = act;
    }

    @JavascriptInterface
    public void setToken(String token) {
        if (token != null && !token.isEmpty()) Store.setToken(act, token);
    }

    @JavascriptInterface
    public void signedOut() {
        Store.clear(act);
        LiveService.stop(act);
        act.runOnUiThread(() -> act.look("out", true));
    }

    /** {role, onDuty, ride, state, line, shabbat}: the service starts or stops to match. */
    @JavascriptInterface
    public void sync(String json) {
        try {
            JSONObject s = new JSONObject(json);
            Store.prefs(act).edit().putString("sync", json).apply();
            String role = s.optString("role", "rider");
            boolean dark = s.optBoolean("dark", "driver".equals(role));
            act.runOnUiThread(() -> {
                act.look(role, dark);
                LiveService.sync(act, s);
                if ("driver".equals(role) && s.optBoolean("onDuty")) act.askBattery();
            });
        } catch (Exception ignored) {
        }
    }

    /** The freshest fix the phone has, as {lat, lng, acc}, or null. */
    @JavascriptInterface
    public String location() {
        if (act.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED
                && act.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            act.runOnUiThread(act::askLocation);
            return "null";
        }
        LocationManager lm = act.getSystemService(LocationManager.class);
        Location best = null;
        try {
            for (String p : lm.getProviders(true)) {
                Location l = lm.getLastKnownLocation(p);
                if (l != null && (best == null || l.getTime() > best.getTime())) best = l;
            }
        } catch (SecurityException ignored) {
        }
        act.runOnUiThread(act::freshFix);
        if (best == null) return "null";
        try {
            return new JSONObject().put("lat", best.getLatitude()).put("lng", best.getLongitude()).put("acc", best.getAccuracy()).toString();
        } catch (Exception e) {
            return "null";
        }
    }

    @JavascriptInterface
    public void open(String url) {
        act.runOnUiThread(() -> {
            try {
                act.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            } catch (Exception ignored) {
            }
        });
    }

    /** Directions out loud, over the music (which ducks for it). */
    @JavascriptInterface
    public void speak(String text) {
        act.runOnUiThread(() -> act.speak(text));
    }

    @JavascriptInterface
    public void stopSpeaking() {
        act.runOnUiThread(act::stopSpeaking);
    }

    @JavascriptInterface
    public String version() {
        return BuildConfig.VERSION_NAME;
    }
}
