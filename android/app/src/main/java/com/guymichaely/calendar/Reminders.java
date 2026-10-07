package com.guymichaely.calendar;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;
import android.webkit.CookieManager;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The phone's reminders: scheduled as exact alarms (ReminderReceiver shows each one), kept so a
 * restart can schedule them again, and refreshed from the calendar's server when FCM says they
 * changed (ReminderMessagingService). The app sets them too, whenever it's open (RemindersPlugin).
 */
final class Reminders {
    static final String SITE = "https://calendar.guymichaely.com";
    private static final String TAG = "Reminders";
    private static final String PREFS = "calendar.reminders";

    private Reminders() {}

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** What this phone reminds about ({ taskStarts, events }), as Settings → Notifications has it. */
    static void saveSettings(Context context, String settings) {
        prefs(context).edit().putString("settings", settings).apply();
    }

    static void createChannels(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        manager.createNotificationChannel(new NotificationChannel("starts", "Tasks you can start", NotificationManager.IMPORTANCE_HIGH));
        manager.createNotificationChannel(new NotificationChannel("events", "Event reminders", NotificationManager.IMPORTANCE_HIGH));
    }

    private static PendingIntent alarm(Context context, int id, JSONObject reminder, int flags) {
        Intent intent = new Intent(context, ReminderReceiver.class).setAction(ReminderReceiver.ACTION);
        if (reminder != null) {
            intent.putExtra("id", id);
            intent.putExtra("title", reminder.optString("title"));
            intent.putExtra("body", reminder.optString("body"));
            intent.putExtra("itemId", reminder.optString("itemId"));
            intent.putExtra("channel", reminder.optString("channel", "starts"));
        }
        return PendingIntent.getBroadcast(context, id, intent, flags | PendingIntent.FLAG_IMMUTABLE);
    }

    /** Replaces the scheduled reminders with these ([{ id, at (ms), title, body, itemId, channel }]). */
    static synchronized void schedule(Context context, JSONArray reminders) {
        createChannels(context);
        AlarmManager alarms = context.getSystemService(AlarmManager.class);
        SharedPreferences prefs = prefs(context);
        for (String id : prefs.getString("ids", "").split(",")) {
            if (id.isEmpty()) continue;
            PendingIntent previous = alarm(context, Integer.parseInt(id), null, PendingIntent.FLAG_NO_CREATE);
            if (previous != null) alarms.cancel(previous);
        }
        boolean exact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarms.canScheduleExactAlarms();
        Set<String> shown = new HashSet<>(Arrays.asList(prefs.getString("shown", "").split(",")));
        StringBuilder ids = new StringBuilder();
        StringBuilder stillShown = new StringBuilder();
        long now = System.currentTimeMillis();
        for (int index = 0; index < reminders.length(); index++) {
            JSONObject reminder = reminders.optJSONObject(index);
            if (reminder == null) continue;
            String id = String.valueOf(reminder.optInt("id"));
            long at = reminder.optLong("at");
            if (shown.contains(id)) stillShown.append(id).append(',');
            // One already past (missed while the phone was off) goes off now, unless it showed.
            if (at <= now && shown.contains(id)) continue;
            PendingIntent intent = alarm(context, Integer.parseInt(id), reminder, PendingIntent.FLAG_UPDATE_CURRENT);
            if (exact) alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, Math.max(at, now), intent);
            else alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, Math.max(at, now), intent);
            ids.append(id).append(',');
        }
        prefs.edit().putString("reminders", reminders.toString()).putString("ids", ids.toString()).putString("shown", stillShown.toString()).apply();
    }

    /** Notes that a reminder showed, so scheduling the same list again (after a restart) doesn't repeat it. */
    static synchronized void shown(Context context, int id) {
        String shown = prefs(context).getString("shown", "");
        prefs(context).edit().putString("shown", shown + id + ",").apply();
    }

    /** After a restart, which clears alarms. */
    static void restore(Context context) {
        try {
            schedule(context, new JSONArray(prefs(context).getString("reminders", "[]")));
        } catch (Exception error) {
            Log.w(TAG, "Could not restore reminders", error);
        }
    }

    // The app's Cloudflare Access sign-in, from its web view's cookies.
    private static HttpURLConnection open(String path, String method) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(SITE + path).openConnection();
        connection.setRequestMethod(method);
        connection.setInstanceFollowRedirects(false);
        connection.setConnectTimeout(10_000);
        connection.setReadTimeout(10_000);
        String cookies = CookieManager.getInstance().getCookie(SITE);
        if (cookies != null) connection.setRequestProperty("Cookie", cookies);
        return connection;
    }

    /** Fetches this phone's reminders from the server and schedules them. Runs off the main thread. */
    static void refresh(Context context) {
        try {
            JSONObject settings = new JSONObject(prefs(context).getString("settings", "{}"));
            if (settings.length() == 0) return;
            // The settings as they are (true/false as 1/0), so what they hold can change without the app.
            StringBuilder query = new StringBuilder();
            for (Iterator<String> keys = settings.keys(); keys.hasNext(); ) {
                String key = keys.next();
                Object value = settings.get(key);
                query.append(query.length() == 0 ? "?" : "&").append(URLEncoder.encode(key, "UTF-8")).append('=')
                    .append(value instanceof Boolean ? ((Boolean) value ? "1" : "0") : URLEncoder.encode(String.valueOf(value), "UTF-8"));
            }
            HttpURLConnection connection = open("/sync/reminders" + query, "GET");
            if (connection.getResponseCode() != 200) {
                Log.w(TAG, "Reminders request answered " + connection.getResponseCode());
                return;
            }
            try (InputStream input = connection.getInputStream()) {
                ByteArrayOutputStream bytes = new ByteArrayOutputStream();
                byte[] buffer = new byte[8192];
                for (int read; (read = input.read(buffer)) != -1; ) bytes.write(buffer, 0, read);
                schedule(context, new JSONArray(bytes.toString("UTF-8")));
            }
        } catch (Exception error) {
            Log.w(TAG, "Could not refresh reminders", error);
        }
    }

    /** Tells the server this phone's FCM token. Runs off the main thread. */
    static void registerDevice(String token) {
        try {
            HttpURLConnection connection = open("/sync/devices", "PUT");
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json");
            try (OutputStream output = connection.getOutputStream()) {
                output.write(new JSONObject().put("token", token).toString().getBytes(StandardCharsets.UTF_8));
            }
            if (connection.getResponseCode() != 204) Log.w(TAG, "Device registration answered " + connection.getResponseCode());
        } catch (Exception error) {
            Log.w(TAG, "Could not register the device", error);
        }
    }
}
