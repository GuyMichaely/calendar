import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import type { Reminder } from "./reminders";

/** Running in the Android app, where reminders become notifications. In a browser this does nothing. */
export const inApp = Capacitor.isNativePlatform();

export type NotificationAccess = "granted" | "denied" | "prompt";

let channels: Promise<unknown> | null = null;
// Separate channels, so Android's settings can quiet one kind and not the other.
const ensureChannels = () => channels ||= Promise.all([
  LocalNotifications.createChannel({ id: "starts", name: "Tasks you can start", importance: 4 }),
  LocalNotifications.createChannel({ id: "events", name: "Event reminders", importance: 4 }),
]);

export async function notificationAccess(): Promise<NotificationAccess> {
  const { display } = await LocalNotifications.checkPermissions();
  return display === "granted" ? "granted" : display === "denied" ? "denied" : "prompt";
}

/**
 * Replaces the scheduled notifications with these. Asks for permission the first time there's
 * something to schedule; without it, nothing is scheduled. Resolves to the permission.
 */
export async function scheduleReminders(reminders: Reminder[]): Promise<NotificationAccess> {
  let access = await notificationAccess();
  if (access === "prompt" && reminders.length) {
    const { display } = await LocalNotifications.requestPermissions();
    access = display === "granted" ? "granted" : "denied";
  }
  if (access !== "granted") return access;
  await ensureChannels();
  const pending = await LocalNotifications.getPending();
  if (pending.notifications.length) await LocalNotifications.cancel({ notifications: pending.notifications.map(({ id }) => ({ id })) });
  if (reminders.length) {
    await LocalNotifications.schedule({
      notifications: reminders.map(reminder => ({
        id: reminder.id,
        title: reminder.title,
        body: reminder.body,
        channelId: reminder.channel,
        // allowWhileIdle: on time even when the phone is idle (an exact alarm).
        schedule: { at: reminder.at, allowWhileIdle: true },
        extra: { itemId: reminder.itemId },
      })),
    });
  }
  return access;
}

/** Calls `open` with the item a tapped notification is about. */
export function onReminderOpened(open: (itemId: string) => void) {
  void LocalNotifications.addListener("localNotificationActionPerformed", ({ notification }) => {
    const itemId = (notification.extra as { itemId?: unknown } | undefined)?.itemId;
    if (typeof itemId === "string") open(itemId);
  });
}
