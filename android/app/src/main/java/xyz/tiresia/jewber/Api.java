package xyz.tiresia.jewber;

import android.content.Context;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/** Calls to the Jewber server with the device's token (never the window's cookie). */
final class Api {
    private Api() {}

    static String ua() {
        return "Jewber/" + BuildConfig.VERSION_NAME + " (Android)";
    }

    private static HttpURLConnection open(Context c, String method, String path, int readMs) throws IOException {
        String token = Store.token(c);
        if (token == null) throw new IOException("signed out");
        HttpURLConnection h = (HttpURLConnection) new URL(BuildConfig.BASE_URL + path).openConnection();
        h.setRequestMethod(method);
        h.setConnectTimeout(10000);
        h.setReadTimeout(readMs);
        h.setRequestProperty("Authorization", "Bearer " + token);
        h.setRequestProperty("User-Agent", ua());
        h.setRequestProperty("X-Jewber", "1");
        return h;
    }

    /** A JSON call; the answer carries "_status" (the HTTP code). */
    static JSONObject call(Context c, String method, String path, JSONObject body) throws Exception {
        HttpURLConnection h = open(c, method, path, 15000);
        try {
            if (body != null) {
                h.setDoOutput(true);
                h.setRequestProperty("Content-Type", "application/json");
                try (OutputStream o = h.getOutputStream()) {
                    o.write(body.toString().getBytes(StandardCharsets.UTF_8));
                }
            }
            int code = h.getResponseCode();
            InputStream in = code >= 400 ? h.getErrorStream() : h.getInputStream();
            String text = in == null ? "" : read(in);
            JSONObject j = text.isEmpty() ? new JSONObject() : new JSONObject(text);
            j.put("_status", code);
            return j;
        } finally {
            h.disconnect();
        }
    }

    interface Events {
        void onView(JSONObject view);
    }

    /**
     * Listens to /api/events until the connection drops (then returns) or the token is refused
     * (then throws SecurityException). Each event is the whole view for this account.
     */
    static void listen(Context c, Events cb, HttpURLConnection[] holder) throws Exception {
        HttpURLConnection h = open(c, "GET", "/api/events", 70000);
        holder[0] = h;
        h.setRequestProperty("Accept", "text/event-stream");
        try {
            int code = h.getResponseCode();
            if (code == 401) throw new SecurityException("signed out");
            if (code != 200) throw new IOException("events " + code);
            BufferedReader r = new BufferedReader(new InputStreamReader(h.getInputStream(), StandardCharsets.UTF_8));
            StringBuilder data = new StringBuilder();
            String line;
            while ((line = r.readLine()) != null) {
                if (line.isEmpty()) {
                    if (data.length() > 0) {
                        try {
                            cb.onView(new JSONObject(data.toString()));
                        } catch (Exception ignored) {
                        }
                        data.setLength(0);
                    }
                } else if (line.startsWith("data:")) {
                    data.append(line.substring(5).trim());
                }
            }
        } finally {
            h.disconnect();
        }
    }

    private static String read(InputStream in) throws IOException {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) b.write(buf, 0, n);
        in.close();
        return b.toString("UTF-8");
    }
}
