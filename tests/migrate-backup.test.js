import test from "node:test";
import assert from "node:assert/strict";
import { convertItems } from "../scripts/migrate-backup.js";

const at = "2026-09-01T00:00:00.000Z";
const now = new Date("2026-10-06T12:00:00.000Z");
const task = (id, extra = {}) => ({ id, kind: "task", title: id, state: "open", createdAt: at, updatedAt: at, ...extra });
const board = (id, extra = {}) => ({ id, kind: "group", title: id, createdAt: at, updatedAt: at, ...extra });
const byId = items => new Map(items.map(item => [item.id, item]));

test("sleep becomes pushed down; an ended sleep is dropped; untouched items stay as they are", () => {
  const plain = task("plain");
  const { items } = convertItems([task("asleep", { sleep: { until: "2026-10-09T00:00:00.000Z", startedAt: at } }), task("woke", { sleep: { until: "2026-10-01T00:00:00.000Z", startedAt: at } }), plain], now);
  const converted = byId(items);
  assert.deepEqual(converted.get("asleep").pushedDown, { until: "2026-10-09T00:00:00.000Z", at });
  assert.equal("sleep" in converted.get("asleep"), false);
  assert.equal("sleep" in converted.get("woke"), false);
  assert.equal("pushedDown" in converted.get("woke"), false);
  assert.equal(converted.get("plain"), plain);
});

test("working hours become one window per set of hours, reusing a matching window", () => {
  const business = { id: "business", kind: "window", title: "Business", days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00", createdAt: at, updatedAt: at };
  const hours = (days, start, end) => ({ availabilitySchedule: { enabled: true, days, start, end } });
  const { items, counts } = convertItems([business, task("a", hours([5, 4, 3, 2, 1], "09:00", "17:00")), task("b", hours([0, 6], "10:00", "12:00")), task("c", hours([6, 0], "10:00", "12:00"))], now);
  const converted = byId(items);
  assert.equal(converted.get("a").windowId, "business");
  assert.equal(converted.get("b").windowId, "window-hours-06-1000-1200");
  assert.equal(converted.get("c").windowId, "window-hours-06-1000-1200");
  assert.equal(converted.get("window-hours-06-1000-1200").title, "Sun, Sat 10:00–12:00");
  assert.equal(counts.windows, 1);
  for (const id of ["a", "b", "c"]) assert.equal("availabilitySchedule" in converted.get(id), false);
});

test("a task's own Deadline lead goes and latest start becomes a missing due date", () => {
  const converted = byId(convertItems([
    task("warn", { deadline: "2026-10-10T12:00:00.000Z", warnAt: "2026-10-08T12:00:00.000Z", warnHours: 48 }),
    task("latest", { latestStart: "2026-10-12T09:00:00.000Z" }),
    task("both", { deadline: "2026-10-13T09:00:00.000Z", latestStart: "2026-10-12T09:00:00.000Z" }),
    task("relative", { dependentOf: "latest", relativeDates: { availableFrom: 1, latestStart: 3 } }),
  ], now).items);
  assert.equal("warnHours" in converted.get("warn"), false);
  assert.equal("warnAt" in converted.get("warn"), false);
  assert.equal(converted.get("latest").deadline, "2026-10-12T09:00:00.000Z");
  assert.equal(converted.get("both").deadline, "2026-10-13T09:00:00.000Z");
  assert.deepEqual(converted.get("relative").relativeDates, { availableFrom: 1, deadline: 3 });
});

test("boards lose nesting and keep their old columns as their place in the Boards view", () => {
  const converted = byId(convertItems([
    board("notes", { parentId: null, boardColumn: 3, sortOrder: 1 }), board("ideas", { parentId: null, boardColumn: 3, sortOrder: 0 }),
    board("support", { parentId: null, boardColumn: 1 }), board("nested", { parentId: "support", sortOrder: 0 }),
    board("placed", { layoutColumn: 4, layoutRow: 0 }),
  ], now).items);
  assert.deepEqual(["support", "ideas", "notes", "nested"].map(id => [converted.get(id).layoutColumn, converted.get(id).layoutRow]), [[2, 0], [3, 0], [3, 1], [4, 0]]);
  assert.equal("parentId" in converted.get("nested"), false);
  assert.equal("boardColumn" in converted.get("notes"), false);
  assert.equal(converted.get("placed").layoutColumn, 4);
});
