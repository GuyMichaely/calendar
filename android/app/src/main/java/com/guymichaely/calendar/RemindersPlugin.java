package com.guymichaely.calendar;

import android.Manifest;
import android.content.Intent;
import android.os.Build;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.firebase.FirebaseApp;
import com.google.firebase.messaging.FirebaseMessaging;
import org.json.JSONArray;

/** The app's side of the phone's reminders (solid/src/notifications.ts). */
@CapacitorPlugin(name = "Reminders", permissions = { @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }) })
public class RemindersPlugin extends Plugin {
    @Override
    public void load() {
        opened(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        opened(intent);
    }

    // A tapped reminder opened the app; the app opens its task or event.
    private void opened(Intent intent) {
        String itemId = intent == null ? null : intent.getStringExtra(ReminderReceiver.ITEM);
        if (itemId == null || itemId.isEmpty()) return;
        intent.removeExtra(ReminderReceiver.ITEM);
        JSObject data = new JSObject();
        data.put("itemId", itemId);
        notifyListeners("opened", data, true);
    }

    private JSObject access() {
        JSObject result = new JSObject();
        if (NotificationManagerCompat.from(getContext()).areNotificationsEnabled()) result.put("access", "granted");
        else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && getPermissionState("notifications") != PermissionState.DENIED) result.put("access", "prompt");
        else result.put("access", "denied");
        return result;
    }

    @PluginMethod
    public void checkAccess(PluginCall call) {
        call.resolve(access());
    }

    @PluginMethod
    public void requestAccess(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "accessCallback");
        } else {
            call.resolve(access());
        }
    }

    @PermissionCallback
    private void accessCallback(PluginCall call) {
        call.resolve(access());
    }

    /** { reminders: [{ id, at, title, body, itemId, channel }], settings: { taskStarts, eventMinutes } } */
    @PluginMethod
    public void set(PluginCall call) {
        JSArray reminders = call.getArray("reminders", new JSArray());
        JSObject settings = call.getObject("settings", new JSObject());
        try {
            Reminders.saveSettings(getContext(), settings.toString());
            Reminders.schedule(getContext(), new JSONArray(reminders.toString()));
            call.resolve();
        } catch (Exception error) {
            call.reject("Could not schedule reminders", error);
        }
    }

    /** This phone's FCM token, for the server to tell it when reminders change. */
    @PluginMethod
    public void token(PluginCall call) {
        if (FirebaseApp.getApps(getContext()).isEmpty()) {
            call.reject("This build has no Firebase configuration");
            return;
        }
        FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task -> {
            if (!task.isSuccessful()) {
                call.reject("Could not get an FCM token", task.getException());
                return;
            }
            JSObject result = new JSObject();
            result.put("token", task.getResult());
            call.resolve(result);
        });
    }
}
