import { expect, test } from "bun:test";
import { calendarEntries, todaysWork, windowsFor } from "../src/calendar-entries";
import type { Item, Task, TimeWindow } from "../src/types";
import { partsOf, setCalendarZone, zonedDate } from "../src/zone";

// Dates are read in the calendar's zone, not the device's (the suite runs with the device elsewhere).
setCalendarZone("America/New_York");

const at = "2026-09-01T00:00:00.000Z";
// Tuesday, Oct 6 2026, 2:20 pm local time.
const now = zonedDate(2026, 10, 6, 14, 20);
const local = (day: number, hours: number, minutes = 0) => zonedDate(2026, 10, day, hours, minutes);
const task = (id: string, extra: Partial<Task> = {}): Task => ({ id, kind: "task", title: id, state: "open", createdAt: at, updatedAt: at, ...extra });
const business: TimeWindow = { id: "business", kind: "window", title: "Business", days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00", createdAt: at, updatedAt: at };
const range = (items: Item[]) => calendarEntries(items, local(1, 0), local(31, 0), now).map(entry => [entry.item.id, entry.kind, partsOf(entry.at).day, partsOf(entry.at).hour]);

test("a task that could start but whose window is shut shows at the window's next opening", () => {
  // 2:20 pm Tuesday: an evening window opens later today; business hours are open now (nothing to show).
  const evening: TimeWindow = { ...business, id: "evening", title: "Evening", start: "18:00", end: "22:00" };
  const entries = calendarEntries([evening, business, task("e", { windowId: "evening" }), task("b", { windowId: "business" })], local(1, 0), local(31, 0), now);
  expect(entries.map(entry => [entry.item.id, entry.kind, partsOf(entry.at).day, partsOf(entry.at).hour, entry.window?.id])).toEqual([["e", "start", 6, 18, "evening"]]);
});

test("a task shows when it can start (at its window's opening) and when it's due", () => {
  expect(range([business, task("a", { availableFrom: local(8, 7).toISOString(), windowId: "business", deadline: local(9, 12).toISOString() })])).toEqual([["a", "start", 8, 9], ["a", "due", 9, 12]]);
  // Already startable: no start marker. Finished: nothing.
  expect(range([task("b", { availableFrom: local(2, 9).toISOString() })])).toEqual([]);
  expect(range([task("c", { deadline: local(9, 12).toISOString(), state: "completed" })])).toEqual([]);
});

test("a repeating task shows its current occurrence and its later ones, up to its end", () => {
  const weekly = task("w", { availableFrom: local(5, 9).toISOString(), deadline: local(5, 17).toISOString(), repeat: { unit: "week", every: 1, until: local(20, 0).toISOString(), untilDone: false, ifMissed: "skip" } });
  // Oct 5's occurrence is still open (due at 5 pm that day has passed, so Skip rolls to Oct 12).
  expect(range([weekly])).toEqual([["w", "start", 12, 9], ["w", "due", 12, 17], ["w", "repeat", 19, 17]]);
});

test("a day lists the windows its tasks use that open then; today's work leaves out pushed-down and later tasks", () => {
  const user = task("u", { windowId: "business" });
  expect(windowsFor([business], [user], local(6, 0)).map(opening => [opening.window.id, partsOf(opening.opens).hour, partsOf(opening.closes).hour])).toEqual([["business", 9, 17]]);
  expect(windowsFor([business], [user], local(4, 0))).toEqual([]);
  expect(windowsFor([business], [task("free")], local(6, 0))).toEqual([]);
  const items: Item[] = [task("now"), task("pushed", { pushedDown: { until: null, at } }), task("later", { availableFrom: local(9, 9).toISOString() })];
  expect(todaysWork(items, now).map(item => item.id)).toEqual(["now"]);
});
