import { expect, test } from "bun:test";
import { calendarEntries, todaysWork, windowBands } from "../src/calendar-entries";
import type { Item, Task, TimeWindow } from "../src/types";

const at = "2026-09-01T00:00:00.000Z";
// Tuesday, Oct 6 2026, 2:20 pm local time.
const now = new Date(2026, 9, 6, 14, 20);
const local = (day: number, hours: number, minutes = 0) => new Date(2026, 9, day, hours, minutes);
const task = (id: string, extra: Partial<Task> = {}): Task => ({ id, kind: "task", title: id, state: "open", createdAt: at, updatedAt: at, ...extra });
const business: TimeWindow = { id: "business", kind: "window", title: "Business", days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00", createdAt: at, updatedAt: at };
const range = (items: Item[]) => calendarEntries(items, local(1, 0), local(31, 0), now).map(entry => [entry.item.id, entry.kind, entry.at.getDate(), entry.at.getHours()]);

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

test("windows band the days they open; today's work leaves out pushed-down and later tasks", () => {
  expect(windowBands([business], local(6, 0)).map(band => [band.window.id, band.opens.getHours(), band.closes.getHours()])).toEqual([["business", 9, 17]]);
  expect(windowBands([business], local(4, 0))).toEqual([]);
  const items: Item[] = [task("now"), task("pushed", { pushedDown: { until: null, at } }), task("later", { availableFrom: local(9, 9).toISOString() })];
  expect(todaysWork(items, now).map(item => item.id)).toEqual(["now"]);
});
