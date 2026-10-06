package com.guymichaely.calendar;

import androidx.annotation.NonNull;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

/**
 * FCM's messages, which arrive even when the app is closed: "reminders" means the calendar changed
 * on another device, so this phone fetches its reminders again (Reminders.refresh).
 */
public class ReminderMessagingService extends FirebaseMessagingService {
    @Override
    public void onMessageReceived(@NonNull RemoteMessage message) {
        if ("reminders".equals(message.getData().get("type"))) Reminders.refresh(getApplicationContext());
    }

    @Override
    public void onNewToken(@NonNull String token) {
        Reminders.registerDevice(token);
    }
}
