import test from "node:test";
import assert from "node:assert/strict";
import {
  actionability,
  availabilityStartForDate,
  isPendingOnDate,
  isSleeping,
  nextActionableStart,
  nextAvailabilityStart,
  sleepInfo,
  taskMatchesFilter,
  tomorrowMidnight,
  upcomingHorizonEnd,
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

test("future start blocks actionability and appears in waiting", () => {
  const now = new Date("2026-09-03T12:00:00-04:00");
  const task = { ...baseTask, availableFrom: "2026-09-04T08:00:00-04:00" };
  assert.equal(actionability(task, now).actionable, false);
  assert.equal(taskMatchesFilter(task, "waiting", now), true);
});

test("waiting is computed from future opportunity rather than stored state", () => {
  const now = new Date("2026-09-03T12:00:00-04:00");
  const legacyWaitingTask = { ...baseTask, state: "waiting" };
  assert.equal(actionability(legacyWaitingTask, now).actionable, true);
  assert.equal(taskMatchesFilter(legacyWaitingTask, "waiting", now), false);
});

test("weekday action window is a recurring opportunity", () => {
  assert.equal(withinAvailabilitySchedule(eveningTask, new Date("2026-09-03T17:00:00-04:00")), false);
  assert.equal(withinAvailabilitySchedule(eveningTask, new Date("2026-09-03T19:00:00-04:00")), true);
  assert.equal(withinAvailabilitySchedule(eveningTask, new Date("2026-09-05T19:00:00-04:00")), false);
});

test("task outside today's action window appears in waiting", () => {
  assert.equal(taskMatchesFilter(eveningTask, "waiting", new Date("2026-09-03T13:00:00-04:00")), true);
  assert.equal(taskMatchesFilter(eveningTask, "waiting", new Date("2026-09-03T19:00:00-04:00")), false);
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

test("next actionable time follows the recurring action window", () => {
  const now = new Date("2026-09-03T14:00:00-04:00");
  const next = nextActionableStart(eveningTask, now);
  assert.equal(next?.getDate(), 3);
  assert.equal(next?.getHours(), 18);
});

test("sleep suppresses UI without changing real actionability", () => {
  const now = new Date("2026-09-03T14:00:00-04:00");
  const until = tomorrowMidnight(now);
  const task = { ...baseTask, sleep: { until: until.toISOString(), startedAt: now.toISOString() } };
  assert.equal(actionability(task, now).actionable, true);
  assert.equal(taskMatchesFilter(task, "now", now), true);
  assert.equal(isSleeping(task, now), true);
  assert.equal(isSleeping(task, new Date("2026-09-04T00:00:01-04:00")), false);
});

test("indefinite sleep stays active and has no sleep-respecting next action", () => {
  const now = new Date("2026-09-03T14:00:00-04:00");
  const task = { ...baseTask, sleep: { until: null, startedAt: now.toISOString() } };
  assert.deepEqual(sleepInfo(task, now), { sleeping: true, indefinite: true, until: null });
  assert.equal(nextActionableStart(task, now, { respectSleep: true }), null);
  assert.equal(nextActionableStart(task, now, { respectSleep: false })?.getTime(), now.getTime());
});

test("sleep-respecting scheduling delays an actionable task until wake", () => {
  const now = new Date("2026-09-03T14:00:00-04:00");
  const task = { ...baseTask, sleep: { until: "2026-09-04T00:00:00-04:00", startedAt: now.toISOString() } };
  assert.equal(nextActionableStart(task, now, { respectSleep: true })?.toISOString(), new Date("2026-09-04T00:00:00-04:00").toISOString());
});

test("sleep-respecting recurring scheduling can wake inside an action window", () => {
  const now = new Date("2026-09-03T14:00:00-04:00");
  const task = { ...eveningTask, sleep: { until: "2026-09-03T20:00:00-04:00", startedAt: now.toISOString() } };
  const next = nextActionableStart(task, now, { respectSleep: true });
  assert.equal(next?.getHours(), 20);
  assert.equal(availabilityStartForDate(task, new Date("2026-09-03T12:00:00-04:00"), now, { respectSleep: true })?.getHours(), 20);
});

test("pending-today still describes the underlying task while sleeping", () => {
  const now = new Date("2026-09-03T14:00:00-04:00");
  const task = { ...baseTask, sleep: { until: tomorrowMidnight(now).toISOString(), startedAt: now.toISOString() } };
  assert.equal(isPendingOnDate(task, now), true);
});

test("pending-today includes open tasks with an opportunity today", () => {
  assert.equal(isPendingOnDate(baseTask, new Date("2026-09-03T12:00:00-04:00")), true);
  assert.equal(isPendingOnDate(eveningTask, new Date("2026-09-03T12:00:00-04:00")), true);
  assert.equal(isPendingOnDate(eveningTask, new Date("2026-09-05T12:00:00-04:00")), false);
});

test("latest start can pass while task remains open", () => {
  const task = { ...baseTask, latestStart: "2026-09-27T23:59:00-04:00", deadline: "2026-09-30T23:59:00-04:00" };
  const result = actionability(task, new Date("2026-09-28T12:00:00-04:00"));
  assert.equal(result.actionable, false);
  assert.equal(task.state, "open");
  assert.match(result.reason, /Latest start/);
});

test("calendar-boundary horizons end at day, week, or month boundaries", () => {
  const now = new Date("2026-09-03T16:44:00-04:00");
  assert.equal(upcomingHorizonEnd(now, 1, "boundary").toString().includes("23:59:59"), true);

  const weekEnd = upcomingHorizonEnd(now, 7, "boundary");
  assert.equal(weekEnd.getDay(), 6);
  assert.equal(weekEnd.getDate(), 5);

  const monthEnd = upcomingHorizonEnd(now, 30, "boundary");
  assert.equal(monthEnd.getMonth(), 8);
  assert.equal(monthEnd.getDate(), 30);
});

test("rolling horizons remain exact day multiples", () => {
  const now = new Date("2026-09-03T16:44:00-04:00");
  assert.equal(upcomingHorizonEnd(now, 7, "rolling").getTime() - now.getTime(), 7 * 24 * 60 * 60 * 1000);
});
