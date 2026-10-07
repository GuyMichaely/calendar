import { Capacitor, registerPlugin } from "@capacitor/core";
import { syncFetch } from "@guymichaely/app-sync";
import { VAPID_PUBLIC_KEY } from "./push-key";
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

/** Tells the calendar's server this phone's FCM token, so it can say when reminders change, or (`false`) to stop. Needs sync's sign-in. */
export async function registerDevice(register: boolean) {
  const { token } = await Reminders.token();
  const response = await syncFetch(`${import.meta.env.BASE_URL}sync/devices`, { method: register ? "PUT" : "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) });
  if (!response.ok) throw new Error(`Could not ${register ? "register for" : "stop"} reminder updates (${response.status}).`);
}

/** Calls `open` with the item a tapped notification is about. */
export function onReminderOpened(open: (itemId: string) => void) {
  void Reminders.addListener("opened", ({ itemId }) => open(itemId));
}

// In a browser, reminders are pushed by the server at their time (Web Push), to this browser's
// subscription: the app's own, or, shown in a frame by guymichaely.com/calendar/, that page's
// (a frame can't ask for notifications; the page around it asks, and its tapped notifications open
// it). One per browser, whichever page turned it on.
const PUSH_KEY = "calendar.push";
const framed = window.parent !== window;

export const webPushSupported = !inApp && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

type Subscribed = { subscription: PushSubscriptionJSON; open: string };

/** This browser's push subscription and the page its notifications open, when notifications are on here. */
export function webPushSubscribed(): Subscribed | null {
  try { return JSON.parse(localStorage.getItem(PUSH_KEY) || "null"); } catch { return null; }
}

// Asks the page around the app to turn its notifications on or off, and waits for its answer.
function askFrame(on: boolean): Promise<Subscribed | null> {
  return new Promise((resolve, reject) => {
    const answer = (event: MessageEvent) => {
      if (event.source !== window.parent || event.data?.frame !== "notify") return;
      window.removeEventListener("message", answer);
      if (event.data.error) reject(new Error(event.data.error)); else resolve(on ? { subscription: event.data.subscription, open: event.data.open } : null);
    };
    window.addEventListener("message", answer);
    window.parent.postMessage({ frame: "notify", on, key: VAPID_PUBLIC_KEY }, "*");
  });
}

async function subscribeHere(): Promise<Subscribed> {
  if (await Notification.requestPermission() !== "granted") throw new Error("Notifications are blocked for this site in the browser's settings.");
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: VAPID_PUBLIC_KEY });
  return { subscription: subscription.toJSON(), open: new URL(import.meta.env.BASE_URL, location.href).href };
}

const pushUrl = `${import.meta.env.BASE_URL}sync/push`;
async function tellServer(method: "PUT" | "DELETE", body: unknown) {
  const response = await syncFetch(pushUrl, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`Could not ${method === "PUT" ? "turn on" : "turn off"} notifications (${response.status}).`);
}

/** Turns this browser's notifications on: asks for permission (call it from a click), subscribes, and tells the server. Needs sync's sign-in. */
export async function enableWebPush(settings: ReminderSettings) {
  const subscribed = framed ? (await askFrame(true))! : await subscribeHere();
  await tellServer("PUT", { ...subscribed, settings });
  localStorage.setItem(PUSH_KEY, JSON.stringify(subscribed));
}

/** What this browser's notifications remind about, changed. */
export async function updateWebPush(settings: ReminderSettings) {
  const subscribed = webPushSubscribed();
  if (subscribed) await tellServer("PUT", { ...subscribed, settings });
}

/** Turns this browser's notifications off. */
export async function disableWebPush() {
  const subscribed = webPushSubscribed();
  if (subscribed) await tellServer("DELETE", { endpoint: subscribed.subscription.endpoint });
  localStorage.removeItem(PUSH_KEY);
  if (framed) await askFrame(false);
  else await (await (await navigator.serviceWorker.ready).pushManager.getSubscription())?.unsubscribe();
}
