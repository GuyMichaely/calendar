import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { availabilitySummary, taskTiming } from "../src/task-display.ts";
import type { Task } from "../src/types";

function task(patch: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    kind: "task",
    title: "Call office",
    state: "open",
    createdAt: "2026-09-01T12:00:00.000Z",
    updatedAt: "2026-09-01T12:00:00.000Z",
    ...patch,
  };
}

describe("Solid task availability presentation", () => {
  const now = new Date(2026, 8, 4, 12, 0, 0);
  const tomorrowAtOne = new Date(2026, 8, 5, 13, 0, 0).toISOString();
  const tomorrowAtNine = new Date(2026, 8, 5, 9, 0, 0).toISOString();

  test("ordinary sections keep Starts timing and do not add an availability summary", () => {
    const item = task({ availableFrom: tomorrowAtOne });
    assert.ok(taskTiming(item, now, false).some((value) => value.startsWith("Starts ")));
    assert.equal(availabilitySummary(item, now, undefined, false), "");
  });

  test("Upcoming replaces Starts timing with the friendly Available summary", () => {
    const item = task({ availableFrom: tomorrowAtOne });
    assert.equal(taskTiming(item, now, true).some((value) => value.startsWith("Starts ")), false);
    assert.match(availabilitySummary(item, now, new Date(tomorrowAtOne), true), /^Available tomorrow · /);
  });

  test("sleeping cards use relative sleep text only in Upcoming/Sleeping", () => {
    const item = task({
      availableFrom: tomorrowAtOne,
      sleep: { until: tomorrowAtNine, startedAt: now.toISOString() },
    });

    const ordinaryTiming = taskTiming(item, now, false);
    assert.ok(ordinaryTiming.some((value) => value.startsWith("Starts ")));
    assert.ok(ordinaryTiming.some((value) => value.startsWith("Sleeping until ")));
    assert.equal(availabilitySummary(item, now, undefined, false), "");

    const upcomingTiming = taskTiming(item, now, true);
    assert.equal(upcomingTiming.some((value) => value.startsWith("Starts ")), false);
    assert.equal(upcomingTiming.some((value) => value.startsWith("Sleeping ")), false);
    const summary = availabilitySummary(item, now, undefined, true);
    assert.match(summary, /^Sleeping until tomorrow · /);
    assert.match(summary, / · available tomorrow · /);
  });
});
