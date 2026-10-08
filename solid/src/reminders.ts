import { calendarEntries } from "./calendar-entries";
import { isDormant } from "./dependencies";
import { dateTimeText, clockText } from "./zone";
import type { CalendarEvent, CalendarRecord, Item, Task } from "./types";

/**
 * A notification to go off at `at`: when a task can start ("starts"), or a reminder ("events"):
 * before an event or record starts, or at a moment chosen for any task, event, or record.
 * `kind` says what it's about, so tapping it opens the right place.
 */
export type Reminder = { id: number; at: Date; title: string; body: string; itemId: string; kind: Item["kind"]; channel: "starts" | "events" };

/** What this device notifies about: tasks reaching their can-start time, and reminders (events' and records' lead times, and chosen moments). */
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
 * Reminders come before an event or record starts (its own lead time) and at the moments chosen
 * for any task, event, or record (not a finished task's, or an unstarted dependent's).
 */
export function upcomingReminders(items: Item[], now: Date, settings: ReminderSettings, days = 14, limit = 64): Reminder[] {
  const byId = new Map(items.map(item => [item.id, item]));
  const until = new Date(now.getTime() + days * DAY);
  const reminders: Reminder[] = [];
  if (settings.taskStarts) {
    for (const entry of calendarEntries(items, now, until, now)) {
      if (entry.kind !== "start" || entry.item.kind !== "task" || entry.pushed || entry.reopens || isDormant(entry.item, byId) || entry.at <= now) continue;
      const body = entry.until ? `Can start now, until ${clockText(entry.until)}` : "Can start now";
      reminders.push({ id: reminderId(`start:${entry.item.id}:${entry.at.toISOString()}`), at: entry.at, title: entry.item.title || "Untitled task", body, itemId: entry.item.id, kind: "task", channel: "starts" });
    }
  }
  if (settings.events) {
    const due = (at: Date) => at > now && at <= until;
    const startOf = (item: CalendarEvent | CalendarRecord) => { const start = item.start ? new Date(item.start) : null; return start && !Number.isNaN(start.getTime()) ? start : null; };
    const titleOf = (item: Task | CalendarEvent | CalendarRecord) => item.title || `Untitled ${item.kind}`;
    for (const item of items) {
      if (item.kind !== "task" && item.kind !== "event" && item.kind !== "record") continue;
      // A finished task, or one waiting to be started, has nothing to remind about.
      if (item.kind === "task" && (item.state === "completed" || isDormant(item, byId))) continue;
      const start = item.kind === "task" ? null : startOf(item);
      // Before it starts.
      if (item.kind !== "task" && start && item.reminderMinutes != null) {
        const at = new Date(start.getTime() - item.reminderMinutes * 60_000);
        if (due(at)) reminders.push({ id: reminderId(`${item.kind}:${item.id}:${at.toISOString()}`), at, title: titleOf(item), body: item.reminderMinutes ? `Starts at ${clockText(start)}` : "Starting now", itemId: item.id, kind: item.kind, channel: "events" });
      }
      // At moments chosen for it.
      for (const time of item.remindAt || []) {
        const at = new Date(time);
        if (Number.isNaN(at.getTime()) || !due(at)) continue;
        const deadline = item.kind === "task" && item.deadline ? new Date(item.deadline) : null;
        const body = start ? `Starts ${dateTimeText(start, at)}` : deadline && !Number.isNaN(deadline.getTime()) ? `Due ${dateTimeText(deadline, at)}` : "";
        reminders.push({ id: reminderId(`at:${item.id}:${at.toISOString()}`), at, title: titleOf(item), body, itemId: item.id, kind: item.kind, channel: "events" });
      }
    }
  }
  return reminders.sort((a, b) => a.at.getTime() - b.at.getTime()).slice(0, limit);
}
