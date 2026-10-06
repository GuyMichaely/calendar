import { expect, test } from "bun:test";
import { calendarEntries, leafTasks, todaysWork } from "../src/calendar-entries";
import type { Item, Task, TimeWindow } from "../src/types";
import { partsOf, setCalendarZone, zonedDate } from "../src/zone";
import { shutsAt } from "../src/windows";

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
  // A late window shuts at midnight; one that opens again right then runs on, so it has no end.
  const evening: TimeWindow = { ...business, id: "evening", title: "Evening", start: "18:00", end: "22:00" };
  const late: TimeWindow = { ...business, id: "late", title: "Late", days: [0, 1, 2, 3, 4, 5, 6], start: "21:00", end: "00:00" };
  const allDay: TimeWindow = { ...late, id: "all", title: "All day", start: "00:00", end: "00:00" };
  const entries = calendarEntries([evening, business, late, task("e", { windowId: "evening" }), task("b", { windowId: "business" }), task("l", { windowId: "late" })], local(1, 0), local(31, 0), now);
  expect(entries.map(entry => [entry.item.id, entry.kind, partsOf(entry.at).day, partsOf(entry.at).hour, entry.until && partsOf(entry.until).hour])).toEqual([["e", "start", 6, 18, 22], ["l", "start", 6, 21, 0]]);
  expect(shutsAt(allDay, { closes: local(7, 0) })).toBeNull();
});

test("a container's work is its open leaf tasks", () => {
  const items: Item[] = [task("house"), task("room", { parentId: "house" }), task("vacuum", { parentId: "room" }), task("dust", { parentId: "room", state: "completed" }), task("dishes", { parentId: "house" }), task("solo")];
  expect(leafTasks(items, items[0] as Task).map(leaf => leaf.id)).toEqual(["vacuum", "dishes"]);
  expect(leafTasks(items, items[5] as Task).map(leaf => leaf.id)).toEqual(["solo"]);
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

test("today's work leaves out pushed-down and later tasks", () => {
  const items: Item[] = [task("now"), task("pushed", { pushedDown: { until: null, at } }), task("later", { availableFrom: local(9, 9).toISOString() })];
  expect(todaysWork(items, now).map(item => item.id)).toEqual(["now"]);
});
