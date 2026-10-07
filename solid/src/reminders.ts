import { calendarEntries } from "./calendar-entries";
import { isDormant } from "./dependencies";
import { clockText } from "./zone";
import type { CalendarEvent, Item } from "./types";

/** A notification to go off at `at`: when a task can start, or before an event. */
export type Reminder = { id: number; at: Date; title: string; body: string; itemId: string; channel: "starts" | "events" };

/** What this device notifies about: tasks reaching their can-start time, and events (each as its own reminder says). */
export type ReminderSettings = { taskStarts: boolean; events: boolean };

/** The lead times an event's reminder can have, in minutes, and how they read. */
export const reminderChoices: [number, string][] = [[0, "When it starts"], [5, "5 minutes before"], [10, "10 minutes before"], [15, "15 minutes before"], [30, "30 minutes before"], [60, "1 hour before"], [120, "2 hours before"], [1440, "1 day before"]];

const DAY = 86_400_000;

// Android wants a number for each notification; the same reminder keeps the same one.
function reminderId(key: string) {
  let hash = 0;
  for (let index = 0; index < key.length; index++) hash = (Math.imul(hash, 31) + key.charCodeAt(index)) | 0;
  return hash & 0x7fffffff;
}

/**
 * The reminders due in the next `days`, soonest first and at most `limit` (Android keeps only so
 * many alarms; later ones are scheduled as the app runs again). A task's comes when it can start:
 * at its can-start time (in a window, at the window's first opening from then), not when a window
 * it could already be done in merely reopens. Pushed-down tasks and unstarted dependents don't remind.
 */
export function upcomingReminders(items: Item[], now: Date, settings: ReminderSettings, days = 14, limit = 64): Reminder[] {
  const byId = new Map(items.map(item => [item.id, item]));
  const until = new Date(now.getTime() + days * DAY);
  const reminders: Reminder[] = [];
  if (settings.taskStarts) {
    for (const entry of calendarEntries(items, now, until, now)) {
      if (entry.kind !== "start" || entry.item.kind !== "task" || entry.pushed || entry.reopens || isDormant(entry.item, byId) || entry.at <= now) continue;
      const body = entry.until ? `Can start now, until ${clockText(entry.until)}` : "Can start now";
      reminders.push({ id: reminderId(`start:${entry.item.id}:${entry.at.toISOString()}`), at: entry.at, title: entry.item.title || "Untitled task", body, itemId: entry.item.id, channel: "starts" });
    }
  }
  if (settings.events) {
    for (const event of items.filter((item): item is CalendarEvent => item.kind === "event" && item.reminderMinutes != null)) {
      const start = event.start ? new Date(event.start) : null;
      if (!start || Number.isNaN(start.getTime())) continue;
      const at = new Date(start.getTime() - event.reminderMinutes! * 60_000);
      if (at <= now || at > until) continue;
      const body = event.reminderMinutes ? `Starts at ${clockText(start)}` : "Starting now";
      reminders.push({ id: reminderId(`event:${event.id}:${at.toISOString()}`), at, title: event.title || "Untitled event", body, itemId: event.id, channel: "events" });
    }
  }
  return reminders.sort((a, b) => a.at.getTime() - b.at.getTime()).slice(0, limit);
}
