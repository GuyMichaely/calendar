import test from "node:test";
import assert from "node:assert/strict";
import {
  actionability,
  availabilityStartForDate,
  isPendingOnDate,
  nextActionableStart,
  nextAvailabilityStart,
  taskMatchesFilter,
  withinAvailabilitySchedule,
} from "../site/domain.js";

process.env.TZ = "America/New_York";

const baseTask = {
  id: "1",
  kind: "task",
  title: "Call doctor",
  state: "open",
};

const eveningTask = {
  ...baseTask,
  availabilitySchedule: { enabled: true, days: [1, 2, 3, 4, 5], start: "18:00", end: "23:59" },
};

test("future availableFrom blocks actionability and appears in waiting", () => {
  const now = new Date("2026-09-03T12:00:00-04:00");
  const task = { ...baseTask, availableFrom: "2026-09-04T08:00:00-04:00" };
  assert.equal(actionability(task, now).actionable, false);
  assert.equal(taskMatchesFilter(task, "waiting", now), true);
});

test("waiting task wakes without needing a new occurrence", () => {
  const task = { ...baseTask, state: "waiting", wakeAt: "2026-09-04T08:00:00-04:00" };
  assert.equal(actionability(task, new Date("2026-09-03T12:00:00-04:00")).actionable, false);
  assert.equal(actionability(task, new Date("2026-09-04T09:00:00-04:00")).actionable, true);
});

test("weekday action window is a recurring opportunity, not a recurrence instance", () => {
  assert.equal(withinAvailabilitySchedule(eveningTask, new Date("2026-09-03T17:00:00-04:00")), false);
  assert.equal(withinAvailabilitySchedule(eveningTask, new Date("2026-09-03T19:00:00-04:00")), true);
  assert.equal(withinAvailabilitySchedule(eveningTask, new Date("2026-09-05T19:00:00-04:00")), false);
});

test("open task outside today's action window appears in waiting", () => {
  assert.equal(taskMatchesFilter(eveningTask, "waiting", new Date("2026-09-03T13:00:00-04:00")), true);
  assert.equal(taskMatchesFilter(eveningTask, "waiting", new Date("2026-09-03T19:00:00-04:00")), false);
});

test("a woken task outside its current action window remains in waiting", () => {
  const task = { ...eveningTask, state: "waiting", wakeAt: "2026-09-03T08:00:00-04:00" };
  assert.equal(taskMatchesFilter(task, "waiting", new Date("2026-09-03T13:00:00-04:00")), true);
});

test("calendar shows only the current or next recurring opportunity", () => {
  const beforeWindow = new Date("2026-09-03T13:00:00-04:00");
  const today = new Date("2026-09-03T12:00:00-04:00");
  const tomorrow = new Date("2026-09-04T12:00:00-04:00");

  const nextBefore = nextAvailabilityStart(eveningTask, beforeWindow);
  assert.equal(nextBefore?.getDate(), 3);
  assert.equal(nextBefore?.getHours(), 18);
  assert.equal(availabilityStartForDate(eveningTask, today, beforeWindow)?.getHours(), 18);
  assert.equal(availabilityStartForDate(eveningTask, tomorrow, beforeWindow), null);

  const duringWindow = new Date("2026-09-03T20:00:00-04:00");
  assert.equal(availabilityStartForDate(eveningTask, today, duringWindow)?.getHours(), 18);
  assert.equal(availabilityStartForDate(eveningTask, tomorrow, duringWindow), null);

  const afterWindow = new Date("2026-09-04T00:01:00-04:00");
  assert.equal(availabilityStartForDate(eveningTask, today, afterWindow), null);
  assert.equal(availabilityStartForDate(eveningTask, tomorrow, afterWindow)?.getHours(), 18);
});

test("next actionable time works for one-off future availability", () => {
  const now = new Date("2026-09-03T14:00:00-04:00");
  const task = { ...baseTask, availableFrom: "2026-09-05T09:30:00-04:00" };
  assert.equal(nextActionableStart(task, now)?.toISOString(), new Date("2026-09-05T09:30:00-04:00").toISOString());
});

test("next actionable time uses a wake date", () => {
  const now = new Date("2026-09-03T14:00:00-04:00");
  const task = { ...baseTask, state: "waiting", wakeAt: "2026-09-04T00:00:00-04:00" };
  assert.equal(nextActionableStart(task, now)?.toISOString(), new Date("2026-09-04T00:00:00-04:00").toISOString());
});

test("indefinite waiting has no known upcoming actionable time", () => {
  const task = { ...baseTask, state: "waiting", wakeAt: null };
  assert.equal(nextActionableStart(task, new Date("2026-09-03T14:00:00-04:00")), null);
});

test("next actionable time follows the recurring action window", () => {
  const now = new Date("2026-09-03T14:00:00-04:00");
  const next = nextActionableStart(eveningTask, now);
  assert.equal(next?.getDate(), 3);
  assert.equal(next?.getHours(), 18);
});

test("pending-today includes open tasks with an opportunity today", () => {
  assert.equal(isPendingOnDate(baseTask, new Date("2026-09-03T12:00:00-04:00")), true);
  assert.equal(isPendingOnDate(eveningTask, new Date("2026-09-03T12:00:00-04:00")), true);
  assert.equal(isPendingOnDate(eveningTask, new Date("2026-09-05T12:00:00-04:00")), false);
});

test("future-deferred task is not pending before its wake date", () => {
  const task = { ...baseTask, state: "waiting", wakeAt: "2026-09-05T00:00:00-04:00" };
  assert.equal(isPendingOnDate(task, new Date("2026-09-03T12:00:00-04:00")), false);
  assert.equal(isPendingOnDate(task, new Date("2026-09-05T12:00:00-04:00")), true);
});

test("latest start can pass while task remains open", () => {
  const task = { ...baseTask, latestStart: "2026-09-27T23:59:00-04:00", deadline: "2026-09-30T23:59:00-04:00" };
  const result = actionability(task, new Date("2026-09-28T12:00:00-04:00"));
  assert.equal(result.actionable, false);
  assert.equal(task.state, "open");
  assert.match(result.reason, /Latest start/);
});
