import { Capacitor, registerPlugin } from "@capacitor/core";
import { syncFetch } from "@guymichaely/app-sync";
import type { Reminder, ReminderSettings } from "./reminders";

/** Running in the Android app, where reminders become notifications. In a browser this does nothing. */
export const inApp = Capacitor.isNativePlatform();

export type NotificationAccess = "granted" | "denied" | "prompt";

// The app's native side (android/…/RemindersPlugin.java): it schedules the reminders as exact alarms
// and keeps them, and when FCM says the calendar changed elsewhere it fetches them again itself.
type NativeReminder = Omit<Reminder, "at"> & { at: number };
const Reminders = registerPlugin<{
  checkAccess(): Promise<{ access: NotificationAccess }>;
  requestAccess(): Promise<{ access: NotificationAccess }>;
  set(options: { reminders: NativeReminder[]; settings: ReminderSettings }): Promise<void>;
  token(): Promise<{ token: string }>;
  addListener(event: "opened", listener: (data: { itemId: string }) => void): Promise<unknown>;
}>("Reminders");

/**
 * Replaces the scheduled notifications with these, and remembers `settings` for when the native
 * side fetches reminders itself. Asks for permission the first time there's something to schedule;
 * without it, nothing is scheduled. Resolves to the permission.
 */
export async function scheduleReminders(reminders: Reminder[], settings: ReminderSettings): Promise<NotificationAccess> {
  let { access } = await Reminders.checkAccess();
  if (access === "prompt" && reminders.length) ({ access } = await Reminders.requestAccess());
  await Reminders.set({ reminders: access === "granted" ? reminders.map(reminder => ({ ...reminder, at: reminder.at.getTime() })) : [], settings });
  return access;
}

/** Tells the calendar's server this phone's FCM token, so it can say when reminders change. Needs sync's sign-in. */
export async function registerDevice() {
  const { token } = await Reminders.token();
  const response = await syncFetch(`${import.meta.env.BASE_URL}sync/devices`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) });
  if (!response.ok) throw new Error(`Could not register for reminder updates (${response.status}).`);
}

/** Calls `open` with the item a tapped notification is about. */
export function onReminderOpened(open: (itemId: string) => void) {
  void Reminders.addListener("opened", ({ itemId }) => open(itemId));
}
