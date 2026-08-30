import test from "node:test";
import assert from "node:assert/strict";
import { actionability, taskMatchesFilter, withinAvailabilitySchedule } from "../site/domain.js";

const baseTask = {
  id: "1",
  kind: "task",
  title: "Call doctor",
  state: "open",
};

test("future availableFrom blocks actionability", () => {
  const now = new Date("2026-08-30T12:00:00-04:00");
  const result = actionability({ ...baseTask, availableFrom: "2026-08-31T08:00:00-04:00" }, now);
  assert.equal(result.actionable, false);
});

test("waiting task wakes without needing a new occurrence", () => {
  const task = { ...baseTask, state: "waiting", wakeAt: "2026-08-31T08:00:00-04:00" };
  assert.equal(actionability(task, new Date("2026-08-30T12:00:00-04:00")).actionable, false);
  assert.equal(actionability(task, new Date("2026-08-31T09:00:00-04:00")).actionable, true);
});

test("weekday action window is a recurring opportunity, not a recurrence instance", () => {
  const task = {
    ...baseTask,
    availabilitySchedule: { enabled: true, days: [1, 2, 3, 4, 5], start: "08:00", end: "17:00" },
  };
  assert.equal(withinAvailabilitySchedule(task, new Date("2026-08-31T09:00:00-04:00")), true);
  assert.equal(withinAvailabilitySchedule(task, new Date("2026-08-31T18:00:00-04:00")), false);
  assert.equal(withinAvailabilitySchedule(task, new Date("2026-09-01T09:00:00-04:00")), true);
});

test("latest start can pass while task remains open", () => {
  const task = { ...baseTask, latestStart: "2026-09-27T23:59:00-04:00", deadline: "2026-09-30T23:59:00-04:00" };
  const result = actionability(task, new Date("2026-09-28T12:00:00-04:00"));
  assert.equal(result.actionable, false);
  assert.equal(task.state, "open");
  assert.match(result.reason, /Latest start/);
});

test("ongoing filter selects open tasks without deadlines", () => {
  const task = { ...baseTask, deadline: null };
  assert.equal(taskMatchesFilter(task, "ongoing", new Date()), true);
});
