package xyz.tiresia.jewber;

import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import org.json.JSONObject;

/** Notification buttons that don't need the app on screen: Can't, Go off duty, I'm here, End trip. */
public class ActionReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent i) {
        PendingResult done = goAsync();
        String act = i.getAction();
        String ride = i.getStringExtra("ride");
        new Thread(() -> {
            try {
                if ("decline".equals(act) && ride != null) {
                    c.getSystemService(NotificationManager.class).cancel(LiveService.requestNoteId(ride));
                    Api.call(c, "POST", "/api/rides/" + ride + "/decline", new JSONObject());
                } else if (("here".equals(act) || "end".equals(act)) && ride != null) {
                    c.getSystemService(NotificationManager.class).cancel(LiveService.ID_ARRIVED);
                    Api.call(c, "POST", "/api/rides/" + ride + "/" + act, new JSONObject());
                } else if ("offduty".equals(act)) {
                    Api.call(c, "POST", "/api/driver/duty", new JSONObject().put("on", false));
                    LiveService.stop(c);
                }
            } catch (Exception ignored) {
            } finally {
                done.finish();
            }
        }).start();
    }
}
