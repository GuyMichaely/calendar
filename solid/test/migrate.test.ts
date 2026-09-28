import { expect, test } from "bun:test";
import { legacyChanges } from "../src/migrate";
import type { Group, Item, Task, TimeWindow } from "../src/types";

const at = "2026-09-01T00:00:00.000Z";
const now = new Date("2026-10-06T12:00:00.000Z");
const task = (id: string, extra: Partial<Task> = {}): Task => ({ id, kind: "task", title: id, state: "open", createdAt: at, updatedAt: at, ...extra });
const byId = (items: Item[]) => new Map(items.map(item => [item.id, item]));

test("sleep becomes pushed down; a sleep that has ended is dropped", () => {
  const changed = byId(legacyChanges([
    task("asleep", { sleep: { until: "2026-10-09T00:00:00.000Z", startedAt: at } }),
    task("forever", { sleep: { until: null, startedAt: at } }),
    task("woke", { sleep: { until: "2026-10-01T00:00:00.000Z", startedAt: at } }),
    task("current"),
  ], now));
  expect(changed.get("asleep")).toMatchObject({ sleep: null, pushedDown: { until: "2026-10-09T00:00:00.000Z", at } });
  expect(changed.get("forever")).toMatchObject({ sleep: null, pushedDown: { until: null, at } });
  expect(changed.get("woke")).toMatchObject({ sleep: null });
  expect((changed.get("woke") as Task).pushedDown).toBeUndefined();
  expect(changed.has("current")).toBe(false);
});

test("inline hours become one named window per set of hours, reusing a matching one", () => {
  const existing: TimeWindow = { id: "business", kind: "window", title: "Business", days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00", createdAt: at, updatedAt: at };
  const hours = (days: number[], start: string, end: string) => ({ availabilitySchedule: { enabled: true, days, start, end } });
  const changes = legacyChanges([existing,
    task("a", hours([5, 4, 3, 2, 1], "09:00", "17:00")),
    task("b", hours([0, 6], "10:00", "12:00")), task("c", hours([6, 0], "10:00", "12:00")),
    task("off", { availabilitySchedule: { enabled: false, days: [1], start: "08:00", end: "09:00" } }),
  ], now);
  const changed = byId(changes);
  expect(changed.get("a")).toMatchObject({ windowId: "business", availabilitySchedule: null });
  const weekend = changes.filter(item => item.kind === "window");
  expect(weekend.map(item => [item.id, item.title])).toEqual([["window-hours-06-1000-1200", "Sun, Sat 10:00–12:00"]]);
  expect([(changed.get("b") as Task).windowId, (changed.get("c") as Task).windowId]).toEqual(["window-hours-06-1000-1200", "window-hours-06-1000-1200"]);
  expect(changed.get("off")).toMatchObject({ availabilitySchedule: null });
  expect((changed.get("off") as Task).windowId).toBeUndefined();
});

test("warn-at becomes a lead time, latest start becomes a missing due date, nested boards go top level", () => {
  const changed = byId(legacyChanges([
    task("warn", { deadline: "2026-10-10T12:00:00.000Z", warnAt: "2026-10-08T12:00:00.000Z" }),
    task("latest", { latestStart: "2026-10-12T09:00:00.000Z" }),
    task("both", { deadline: "2026-10-13T09:00:00.000Z", latestStart: "2026-10-12T09:00:00.000Z" }),
    task("relative", { dependentOf: "latest", relativeDates: { availableFrom: 1, latestStart: 3 } }),
    { id: "top", kind: "group", title: "Top", createdAt: at, updatedAt: at } as Group,
    { id: "nested", kind: "group", title: "Nested", parentId: "top", createdAt: at, updatedAt: at } as Group,
  ], now));
  expect(changed.get("warn")).toMatchObject({ warnHours: 48, warnAt: null });
  expect(changed.get("latest")).toMatchObject({ deadline: "2026-10-12T09:00:00.000Z", latestStart: null });
  expect(changed.get("both")).toMatchObject({ deadline: "2026-10-13T09:00:00.000Z", latestStart: null });
  expect((changed.get("relative") as Task).relativeDates).toEqual({ availableFrom: 1, deadline: 3 });
  expect(changed.get("nested")).toMatchObject({ parentId: null });
  expect(changed.has("top")).toBe(false);
});
