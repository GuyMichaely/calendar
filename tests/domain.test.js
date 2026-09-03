import test from "node:test";
import assert from "node:assert/strict";
import {
  actionability,
  availabilityStartForDate,
  isPendingOnDate,
  taskMatchesFilter,
  withinAvailabilitySchedule,
} from "../site/domain.js";

const baseTask = {
  id: "1",
  kind: "task",
  title: "Call doctor",
  state: "open",
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
  const task = {
    ...baseTask,
    availabilitySchedule: { enabled: true, days: [1, 2, 3, 4, 5], start: "18:00", end: "23:59" },
  };
  assert.equal(withinAvailabilitySchedule(task, new Date("2026-09-03T17:00:00-04:00")), false);
  assert.equal(withinAvailabilitySchedule(task, new Date("2026-09-03T19:00:00-04:00")), true);
  assert.equal(withinAvailabilitySchedule(task, new Date("2026-09-05T19:00:00-04:00")), false);
});

test("open task outside today's action window appears in waiting", () => {
  const task = {
    ...baseTask,
    availabilitySchedule: { enabled: true, days: [1, 2, 3, 4, 5], start: "18:00", end: "23:59" },
  };
  assert.equal(taskMatchesFilter(task, "waiting", new Date("2026-09-03T13:00:00-04:00")), true);
  assert.equal(taskMatchesFilter(task, "waiting", new Date("2026-09-03T19:00:00-04:00")), false);
});

test("recurring availability produces a calendar start on matching days", () => {
  const task = {
    ...baseTask,
    availabilitySchedule: { enabled: true, days: [1, 2, 3, 4, 5], start: "18:00", end: "23:59" },
  };
  const start = availabilityStartForDate(task, new Date("2026-09-03T12:00:00-04:00"));
  assert.equal(start?.getHours(), 18);
  assert.equal(start?.getMinutes(), 0);
  assert.equal(availabilityStartForDate(task, new Date("2026-09-05T12:00:00-04:00")), null);
});

test("pending-today includes open tasks with an opportunity today", () => {
  const scheduled = {
    ...baseTask,
    availabilitySchedule: { enabled: true, days: [1, 2, 3, 4, 5], start: "18:00", end: "23:59" },
  };
  assert.equal(isPendingOnDate(baseTask, new Date("2026-09-03T12:00:00-04:00")), true);
  assert.equal(isPendingOnDate(scheduled, new Date("2026-09-03T12:00:00-04:00")), true);
  assert.equal(isPendingOnDate(scheduled, new Date("2026-09-05T12:00:00-04:00")), false);
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
