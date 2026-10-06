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
const event = (id: string, start: Date): CalendarEvent => ({ id, kind: "event", title: id, start: start.toISOString(), end: new Date(start.getTime() + 3_600_000).toISOString(), createdAt: at, updatedAt: at });
const evening: TimeWindow = { id: "evening", kind: "window", title: "Evening", days: [0, 1, 2, 3, 4, 5, 6], start: "18:00", end: "22:00", createdAt: at, updatedAt: at };
const on = { taskStarts: true, eventMinutes: 30 };
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

test("an event reminds the chosen time ahead, or not at all", () => {
  expect(when([event("doctor", local(8, 13))])).toEqual([["doctor", 8, 12, 30]]);
  expect(when([event("soon", local(6, 14, 40))])).toEqual([]);
  expect(when([event("doctor", local(8, 13))], { taskStarts: true, eventMinutes: null })).toEqual([]);
  expect(upcomingReminders([event("doctor", local(8, 13))], now, { taskStarts: false, eventMinutes: 0 })[0]).toMatchObject({ body: "Starting now", channel: "events" });
});

test("reminders are soonest first, within the coming days, and keep their ids", () => {
  const items = [event("b", local(9, 10)), task("a", { availableFrom: local(7, 9).toISOString() }), event("far", local(30, 10))];
  expect(when(items).map(([id]) => id)).toEqual(["a", "b"]);
  expect(upcomingReminders(items, now, on).map(reminder => reminder.id)).toEqual(upcomingReminders(items, now, on).map(reminder => reminder.id));
});
