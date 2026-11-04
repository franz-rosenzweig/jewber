package xyz.tiresia.jewber;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

import org.json.JSONArray;
import org.json.JSONObject;

import java.net.HttpURLConnection;
import java.text.DateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * What runs while the app isn't on screen, as a foreground service with its own notification.
 * The driver, on duty: GPS to the server every few seconds (screen off, Waze in front, whatever),
 * and each new request rings like a call, with Accept and Can't on it. A friend, during a ride:
 * the ride's progress in the notification, and a ping when the driver's on the way, is here,
 * or the ride is over. Both listen to /api/events with the device's token.
 */
public class LiveService extends Service {
    static final String CH_LIVE = "live", CH_REQ = "requests", CH_RIDE = "ride";
    static final int ID_LIVE = 1, ID_RIDE = 2, ID_ARRIVED = 3;
    private static final int GOLD = 0xFFF5B82E;

    static int requestNoteId(String rideId) {
        return 1000 + (rideId.hashCode() & 0x7fffff);
    }

    static void channels(Context c) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        NotificationChannel live = new NotificationChannel(CH_LIVE, "On duty and rides", NotificationManager.IMPORTANCE_LOW);
        live.setShowBadge(false);
        NotificationChannel req = new NotificationChannel(CH_REQ, "Ride requests", NotificationManager.IMPORTANCE_HIGH);
        req.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE), new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
        req.enableVibration(true);
        req.setVibrationPattern(new long[]{0, 600, 300, 600, 300, 600});
        req.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        NotificationChannel ride = new NotificationChannel(CH_RIDE, "Your ride", NotificationManager.IMPORTANCE_HIGH);
        ride.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannels(Arrays.asList(live, req, ride));
    }

    /** The page's latest {role, onDuty, ride, state, shabbat}: run as the driver, as a friend in a ride, or not at all. */
    static void sync(Context c, JSONObject s) {
        if (Store.token(c) == null) { stop(c); return; }
        boolean driver = "driver".equals(s.optString("role"));
        String state = s.isNull("state") ? "" : s.optString("state");
        if (driver && s.optBoolean("onDuty") && !s.optBoolean("shabbat")) {
            if (c.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) start(c, "driver");
        } else if (!driver && Arrays.asList("requested", "accepted", "here", "riding").contains(state)) {
            start(c, "rider");
        } else {
            stop(c);
        }
    }

    static void start(Context c, String mode) {
        try {
            c.startForegroundService(new Intent(c, LiveService.class).putExtra("mode", mode));
        } catch (Exception ignored) {
        }
    }

    static void stop(Context c) {
        c.stopService(new Intent(c, LiveService.class));
    }

    private String mode;
    private volatile boolean running;
    private Thread events;
    private final HttpURLConnection[] conn = new HttpURLConnection[1];
    private LocationManager lm;
    private LocationListener listener;
    private final ExecutorService posts = Executors.newSingleThreadExecutor();
    private final AtomicBoolean posting = new AtomicBoolean(false);
    private long lastPost, lastGps;
    private final Map<String, Integer> ringing = new HashMap<>();
    private String riderWas = "";
    // the driver's ride right now, for noticing arrival from the GPS: id, state, where
    private String activeId, activeState, activeName, activeLabel;
    private double activeLat, activeLng;
    private final Set<String> arrived = new HashSet<>();
    private final Handler main = new Handler(Looper.getMainLooper());
    private NotificationManager nm;
    private Notification shown;

    @Override
    public void onCreate() {
        super.onCreate();
        nm = getSystemService(NotificationManager.class);
        channels(this);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String m = intent != null ? intent.getStringExtra("mode") : null;
        if (m == null) m = Store.prefs(this).getString("mode", null);
        if (m == null || Store.token(this) == null) { stopSelf(); return START_NOT_STICKY; }
        Store.prefs(this).edit().putString("mode", m).apply();
        boolean changed = !m.equals(mode);
        mode = m;
        boolean driver = "driver".equals(m);
        // the page syncs often: keep what the notification already says unless the mode changed
        if (changed || shown == null) shown = live(driver ? "On duty" : "Jewber", driver ? "Waiting for requests" : "Your ride", driver);
        try {
            startForeground(ID_LIVE, shown, driver ? ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION : ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        } catch (Exception e) {
            stopSelf();
            return START_NOT_STICKY;
        }
        if (changed) {
            stopGps();
            if (driver) startGps();
        }
        if (!running) {
            running = true;
            events = new Thread(this::listen, "jewber-events");
            events.start();
        }
        return driver ? START_STICKY : START_NOT_STICKY;
    }

    // ---- the server's view, live
    private void listen() {
        long wait = 2000;
        while (running) {
            try {
                Api.listen(this, v -> main.post(() -> view(v)), conn);
                wait = 2000;
            } catch (SecurityException e) {
                main.post(() -> {
                    Store.clear(this);
                    stopSelf();
                });
                return;
            } catch (Exception ignored) {
            }
            if (!running) return;
            try {
                Thread.sleep(wait);
            } catch (InterruptedException e) {
                return;
            }
            wait = Math.min(30000, wait * 2);
        }
    }

    private void view(JSONObject v) {
        if (!running) return;
        JSONObject me = v.optJSONObject("me");
        if (me == null) return;
        if ("driver".equals(me.optString("role"))) driverView(v);
        else riderView(v);
    }

    private static String typeName(JSONObject v, String id) {
        JSONArray t = v.optJSONArray("types");
        for (int i = 0; t != null && i < t.length(); i++) if (id.equals(t.optJSONObject(i).optString("id"))) return t.optJSONObject(i).optString("name");
        return "ride";
    }

    private static String price(JSONObject v, JSONObject r) {
        JSONArray pm = v.optJSONArray("payMethods");
        String pay = r.optString("pay");
        for (int i = 0; pm != null && i < pm.length(); i++) {
            JSONObject p = pm.optJSONObject(i);
            if (!pay.equals(p.optString("id"))) continue;
            String kind = p.optString("kind");
            if ("treat".equals(kind)) return "1 " + p.optString("unit");
            if ("free".equals(kind)) return "a mitzvah";
            return String.format(java.util.Locale.US, "$%.2f %s", r.optDouble("fare"), p.optString("name"));
        }
        return String.format(java.util.Locale.US, "$%.2f", r.optDouble("fare"));
    }

    private static int minutesLeft(JSONObject eta) {
        if (eta == null) return -1;
        double left = eta.optDouble("seconds") - (System.currentTimeMillis() - eta.optLong("at")) / 1000.0;
        return (int) Math.max(1, Math.round(left / 60));
    }

    private void driverView(JSONObject v) {
        JSONObject d = v.optJSONObject("driver");
        if (d == null || !d.optBoolean("onDuty")) {
            for (int id : ringing.values()) nm.cancel(id);
            ringing.clear();
            stopSelf();
            return;
        }
        JSONArray reqs = v.optJSONArray("requests");
        Set<String> now = new HashSet<>();
        for (int i = 0; reqs != null && i < reqs.length(); i++) {
            JSONObject r = reqs.optJSONObject(i);
            String id = r.optString("id");
            now.add(id);
            if (!ringing.containsKey(id)) {
                ring(v, r);
                ringing.put(id, requestNoteId(id));
            }
        }
        for (String id : new ArrayList<>(ringing.keySet())) {
            if (!now.contains(id)) nm.cancel(ringing.remove(id));
        }
        JSONObject a = v.optJSONObject("active");
        if (a != null) {
            String st = a.optString("state");
            JSONObject t = "riding".equals(st) ? a.optJSONObject("dropoff") : a.optJSONObject("pickup");
            activeId = a.optString("id");
            activeState = st;
            activeName = a.optJSONObject("rider") != null ? a.optJSONObject("rider").optString("name") : "";
            activeLabel = t != null ? t.optString("label") : "";
            activeLat = t != null ? t.optDouble("lat") : 0;
            activeLng = t != null ? t.optDouble("lng") : 0;
        } else {
            activeId = null;
            nm.cancel(ID_ARRIVED);
        }
        String text;
        if (a != null) {
            String name = a.optJSONObject("rider") != null ? a.optJSONObject("rider").optString("name") : "";
            String st = a.optString("state");
            int m = minutesLeft(a.optJSONObject("eta"));
            if ("accepted".equals(st)) text = "Picking up " + name + (m > 0 ? " · " + m + " min" : "");
            else if ("here".equals(st)) text = "Waiting for " + name;
            else text = "Dropping off " + name + " · " + a.optJSONObject("dropoff").optString("label");
        } else if (now.size() > 0) {
            text = now.size() == 1 ? "1 request" : now.size() + " requests";
        } else {
            text = "Waiting for requests";
        }
        show(live("On duty", text, true));
    }

    private void ring(JSONObject v, JSONObject r) {
        String id = r.optString("id");
        int nid = requestNoteId(id);
        JSONObject rider = r.optJSONObject("rider");
        String name = rider != null ? rider.optString("name") : "A friend";
        long when = r.isNull("when") ? 0 : r.optLong("when");
        String title = name + " wants a " + typeName(v, r.optString("type"))
                + (when > 0 ? " · " + DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(new Date(when)) : "");
        String text = r.optJSONObject("pickup").optString("label") + " → " + r.optJSONObject("dropoff").optString("label") + " · " + price(v, r);
        PendingIntent open = PendingIntent.getActivity(this, nid, MainActivity.open(this), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        PendingIntent accept = PendingIntent.getActivity(this, nid + 1, MainActivity.open(this).putExtra("act", "accept").putExtra("ride", id), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        PendingIntent cant = PendingIntent.getBroadcast(this, nid + 2, new Intent(this, ActionReceiver.class).setAction("decline").putExtra("ride", id), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification.Builder b = new Notification.Builder(this, CH_REQ)
                .setSmallIcon(R.drawable.ic_car)
                .setColor(GOLD)
                .setContentTitle(title)
                .setContentText(text)
                .setStyle(new Notification.BigTextStyle().bigText(text))
                .setCategory(when > 0 ? Notification.CATEGORY_EVENT : Notification.CATEGORY_CALL)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setContentIntent(open)
                .setAutoCancel(true)
                .addAction(new Notification.Action.Builder(null, when > 0 ? "Book it" : "Accept", accept).build())
                .addAction(new Notification.Action.Builder(null, "Can't", cant).build());
        if (when == 0) b.setFullScreenIntent(open, true);
        long expires = r.isNull("expires") ? 0 : r.optLong("expires");
        if (expires > 0) b.setTimeoutAfter(Math.max(5000, expires - System.currentTimeMillis()));
        Notification n = b.build();
        // a ride now keeps ringing until it's answered or runs out, like a phone call
        if (when == 0) n.flags |= Notification.FLAG_INSISTENT;
        nm.notify(nid, n);
    }

    private void riderView(JSONObject v) {
        JSONObject r = v.optJSONObject("ride");
        String dn = v.optJSONObject("driver") != null ? v.optJSONObject("driver").optString("name") : "Your driver";
        if (r == null) {
            stopSelf();
            return;
        }
        String st = r.optString("state");
        boolean fresh = !st.equals(riderWas);
        riderWas = st;
        int m = minutesLeft(r.optJSONObject("eta"));
        String pickup = r.optJSONObject("pickup").optString("label");
        switch (st) {
            case "requested":
                show(live("Jewber", "Asking " + dn, false));
                break;
            case "accepted":
                show(live(dn + "'s on the way", m > 0 ? m + " min · " + pickup : pickup, false));
                if (fresh) alert(dn + "'s on the way", pickup);
                break;
            case "here":
                show(live(dn + " is here", pickup, false));
                if (fresh) alert(dn + " is here", "Head out to the car");
                break;
            case "riding":
                String eta = m > 0 ? DateFormat.getTimeInstance(DateFormat.SHORT).format(new Date(System.currentTimeMillis() + m * 60000L)) : "";
                show(live("Heading to " + r.optJSONObject("dropoff").optString("label"), eta.isEmpty() ? "" : "Arriving " + eta, false));
                break;
            case "done":
                alert("You're here", price(v, r) + " · Pay and rate");
                stopSelf();
                break;
            case "missed":
                alert(dn + " didn't answer", "Try again in a bit");
                stopSelf();
                break;
            case "declined":
                alert(dn + " can't right now", "Try again in a bit");
                stopSelf();
                break;
            case "cancelled":
                if (!"rider".equals(r.optString("cancelledBy"))) alert(dn + " cancelled", "Try again in a bit");
                stopSelf();
                break;
            default:
                break;
        }
    }

    private void show(Notification n) {
        shown = n;
        nm.notify(ID_LIVE, n);
    }

    private void alert(String title, String text) {
        PendingIntent open = PendingIntent.getActivity(this, ID_RIDE, MainActivity.open(this), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        nm.notify(ID_RIDE, new Notification.Builder(this, CH_RIDE)
                .setSmallIcon(R.drawable.ic_car)
                .setColor(0xFF2347D9)
                .setContentTitle(title)
                .setContentText(text)
                .setContentIntent(open)
                .setAutoCancel(true)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .build());
    }

    private Notification live(String title, String text, boolean driver) {
        PendingIntent open = PendingIntent.getActivity(this, 0, MainActivity.open(this), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification.Builder b = new Notification.Builder(this, CH_LIVE)
                .setSmallIcon(R.drawable.ic_car)
                .setColor(driver ? GOLD : 0xFF2347D9)
                .setContentTitle(title)
                .setContentText(text)
                .setContentIntent(open)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setCategory(driver ? Notification.CATEGORY_SERVICE : Notification.CATEGORY_NAVIGATION)
                .setVisibility(Notification.VISIBILITY_PUBLIC);
        if (driver) {
            PendingIntent off = PendingIntent.getBroadcast(this, 7, new Intent(this, ActionReceiver.class).setAction("offduty"), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            b.addAction(new Notification.Action.Builder(null, "Go off duty", off).build());
        }
        return b.build();
    }

    // ---- the driver's GPS
    private void startGps() {
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) return;
        lm = getSystemService(LocationManager.class);
        listener = this::fix;
        try {
            if (lm.isProviderEnabled(LocationManager.GPS_PROVIDER)) lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, 2000, 5f, listener, Looper.getMainLooper());
            if (lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) lm.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 5000, 20f, listener, Looper.getMainLooper());
        } catch (SecurityException ignored) {
        }
    }

    private void stopGps() {
        if (lm != null && listener != null) lm.removeUpdates(listener);
        listener = null;
    }

    private void fix(Location l) {
        long now = System.currentTimeMillis();
        nearby(l);
        boolean gps = LocationManager.GPS_PROVIDER.equals(l.getProvider());
        if (gps) lastGps = now;
        else if (now - lastGps < 15000) return;
        if (now - lastPost < 2500 || !posting.compareAndSet(false, true)) return;
        lastPost = now;
        try {
            JSONObject body = new JSONObject()
                    .put("lat", l.getLatitude())
                    .put("lng", l.getLongitude())
                    .put("acc", l.getAccuracy());
            if (l.hasBearing() && l.hasSpeed() && l.getSpeed() > 1) body.put("heading", l.getBearing());
            if (l.hasSpeed()) body.put("speed", l.getSpeed());
            posts.execute(() -> {
                try {
                    JSONObject j = Api.call(this, "POST", "/api/driver/location", body);
                    int code = j.optInt("_status");
                    if (code == 401) main.post(() -> { Store.clear(this); stopSelf(); });
                    else if (code == 200 && !j.optBoolean("onDuty", true)) main.post(this::stopSelf);
                } catch (Exception ignored) {
                } finally {
                    posting.set(false);
                }
            });
        } catch (Exception e) {
            posting.set(false);
        }
    }

    /** Within 60 m of the pickup or the drop-off: a notification with I'm here / End trip on it. */
    private void nearby(Location l) {
        if (activeId == null || !("accepted".equals(activeState) || "riding".equals(activeState))) return;
        float[] d = new float[1];
        Location.distanceBetween(l.getLatitude(), l.getLongitude(), activeLat, activeLng, d);
        String key = activeId + "|" + activeState;
        if (d[0] > 60 || arrived.contains(key)) return;
        arrived.add(key);
        boolean pickup = "accepted".equals(activeState);
        PendingIntent open = PendingIntent.getActivity(this, ID_ARRIVED, MainActivity.open(this), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        PendingIntent act = PendingIntent.getBroadcast(this, ID_ARRIVED + 1, new Intent(this, ActionReceiver.class).setAction(pickup ? "here" : "end").putExtra("ride", activeId), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        nm.notify(ID_ARRIVED, new Notification.Builder(this, CH_RIDE)
                .setSmallIcon(R.drawable.ic_car)
                .setColor(GOLD)
                .setContentTitle(pickup ? "You're at " + activeName + "'s pickup" : "You're at " + activeLabel)
                .setContentText(pickup ? activeLabel : "Dropping off " + activeName)
                .setContentIntent(open)
                .setAutoCancel(true)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .addAction(new Notification.Action.Builder(null, pickup ? "I'm here" : "End trip", act).build())
                .build());
    }

    @Override
    public void onDestroy() {
        running = false;
        Store.prefs(this).edit().remove("mode").apply();
        HttpURLConnection c = conn[0];
        if (c != null) new Thread(c::disconnect).start();
        if (events != null) events.interrupt();
        stopGps();
        posts.shutdownNow();
        for (int id : ringing.values()) nm.cancel(id);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
