import { expect, test } from "bun:test";
import { upcomingReminders } from "../src/reminders";
import { partsOf, setCalendarZone, zonedDate } from "../src/zone";
import type { CalendarEvent, Item, Task, TimeWindow } from "../src/types";

setCalendarZone("America/New_York");
const at = "2026-09-01T00:00:00.000Z";
// Tuesday, Oct 6 2026, 2:20 pm.
const now = zonedDate(2026, 10, 6, 14, 20);
const local = (day: number, hours: number, minutes = 0) => zonedDate(2026, 10, day, hours, minutes);
const task = (id: string, extra: Partial<Task> = {}): Task => ({ id, kind: "task", title: id, state: "open", createdAt: at, updatedAt: at, ...extra });
// An event notifying some minutes before it starts (null: not at all).
const event = (id: string, start: Date, minutes: number | null = 30): CalendarEvent => ({ id, kind: "event", title: id, start: start.toISOString(), end: new Date(start.getTime() + 3_600_000).toISOString(), notifications: minutes == null ? null : [{ minutes }], createdAt: at, updatedAt: at });
const evening: TimeWindow = { id: "evening", kind: "window", title: "Evening", days: [0, 1, 2, 3, 4, 5, 6], start: "18:00", end: "22:00", createdAt: at, updatedAt: at };
const on = { taskStarts: true, events: true };
const when = (items: Item[], settings = on) => upcomingReminders(items, now, settings).map(reminder => [reminder.itemId, partsOf(reminder.at).day, partsOf(reminder.at).hour, partsOf(reminder.at).minute]);

test("a task reminds when it can start, at its window's first opening from then", () => {
  expect(when([task("later", { availableFrom: local(8, 9).toISOString() })])).toEqual([["later", 8, 9, 0]]);
  expect(when([evening, task("windowed", { availableFrom: local(7, 9).toISOString(), windowId: "evening" })])).toEqual([["windowed", 7, 18, 0]]);
});

test("a task that could already start doesn't remind as its window reopens, nor do pushed-down or unstarted dependent ones", () => {
  expect(when([evening, task("ready", { windowId: "evening" })])).toEqual([]);
  expect(when([task("pushed", { availableFrom: local(8, 9).toISOString(), pushedDown: { until: null, at } })])).toEqual([]);
  expect(when([task("parent"), task("next", { dependentOf: "parent", availableFrom: local(8, 9).toISOString() })])).toEqual([]);
});

test("an event notifies at its times, saying when it starts, or not at all", () => {
  expect(when([event("doctor", local(8, 13)), event("dentist", local(8, 15), 60)])).toEqual([["doctor", 8, 12, 30], ["dentist", 8, 14, 0]]);
  expect(when([event("soon", local(6, 14, 40))])).toEqual([]);
  expect(when([event("quiet", local(8, 13), null)])).toEqual([]);
  expect(when([event("doctor", local(8, 13))], { taskStarts: true, events: false })).toEqual([]);
  expect(upcomingReminders([event("doctor", local(8, 13), 0)], now, { taskStarts: false, events: true })[0]).toMatchObject({ body: "Starting now", channel: "events" });
});

test("reminders are soonest first, within the coming days, and keep their ids", () => {
  const items = [event("b", local(9, 10)), task("a", { availableFrom: local(7, 9).toISOString() }), event("far", local(30, 10))];
  expect(when(items).map(([id]) => id)).toEqual(["a", "b"]);
  expect(upcomingReminders(items, now, on).map(reminder => reminder.id)).toEqual(upcomingReminders(items, now, on).map(reminder => reminder.id));
});

test("a notification goes off its time before an event or record starts, or before a task can start or is due", () => {
  const record: Item = { id: "bank", kind: "record", title: "Bank asked for statements", start: local(9, 10).toISOString(), end: null, notifications: [{ minutes: 2 * 1440 + 120 }, { minutes: 60 }], createdAt: at, updatedAt: at };
  const items: Item[] = [
    task("call", { availableFrom: local(6, 18).toISOString(), deadline: local(8, 17).toISOString(), notifications: [{ minutes: 120 }, { minutes: 1440 + 120, of: "due" }] }),
    { ...event("doctor", local(8, 13), null), notifications: [{ minutes: 17 * 60 }] },
    record,
  ];
  expect(when(items)).toEqual([["call", 6, 16, 0], ["call", 6, 18, 0], ["bank", 7, 8, 0], ["call", 7, 15, 0], ["doctor", 7, 20, 0], ["bank", 9, 9, 0]]);
  const found = upcomingReminders(items, now, { taskStarts: false, events: true });
  expect(found.map(reminder => [reminder.kind, reminder.channel])).toEqual([["task", "events"], ["record", "events"], ["task", "events"], ["event", "events"], ["record", "events"]]);
  expect(found[0].body).toBe("Can start at 6:00 PM");
  expect(found[2].body).toStartWith("Due ");
  expect(when(items, { taskStarts: true, events: false })).toEqual([["call", 6, 18, 0]]);
});

test("a task's notification waits for the time it's before; a repeating task's follows its current occurrence", () => {
  expect(when([task("someday", { notifications: [{ minutes: 30 }, { minutes: 30, of: "due" }] })])).toEqual([]);
  expect(when([task("bill", { availableFrom: local(1, 9).toISOString(), deadline: local(8, 17).toISOString(), repeat: { unit: "week", every: 1, until: null, untilDone: false, ifMissed: "skip" }, notifications: [{ minutes: 60, of: "due" }] })])).toEqual([["bill", 8, 16, 0]]);
});

test("a finished task, or one waiting to be started, doesn't notify", () => {
  expect(when([task("done", { state: "completed", deadline: local(8, 9).toISOString(), notifications: [{ minutes: 60, of: "due" }] })])).toEqual([]);
  expect(when([task("parent"), task("next", { dependentOf: "parent", deadline: local(8, 9).toISOString(), notifications: [{ minutes: 60, of: "due" }] })])).toEqual([]);
});
