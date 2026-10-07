package com.guymichaely.calendar;

import android.Manifest;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

/** Shows a reminder when its alarm goes off, and schedules them again after a restart. */
public class ReminderReceiver extends BroadcastReceiver {
    static final String ACTION = "com.guymichaely.calendar.REMINDER";
    static final String ITEM = "reminderItemId";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) {
            Reminders.restore(context);
            return;
        }
        if (!ACTION.equals(intent.getAction())) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
        Reminders.createChannels(context);
        int id = intent.getIntExtra("id", 0);
        // Tapping it opens the app on the task or event.
        Intent open = new Intent(context, MainActivity.class)
            .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(ITEM, intent.getStringExtra("itemId"));
        PendingIntent content = PendingIntent.getActivity(context, id, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder notification = new NotificationCompat.Builder(context, intent.getStringExtra("channel"))
            .setSmallIcon(R.drawable.ic_stat_calendar)
            .setColor(0xFFEC9773)
            .setContentTitle(intent.getStringExtra("title"))
            .setContentText(intent.getStringExtra("body"))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setContentIntent(content)
            .setAutoCancel(true);
        NotificationManagerCompat.from(context).notify(id, notification.build());
        Reminders.shown(context, id);
    }
}
