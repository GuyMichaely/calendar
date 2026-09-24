import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { projectedStartBypassesSleep, projectedTaskStart } from "../src/calendar-projection.ts";
import type { Task } from "../src/types";

function task(patch: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    kind: "task",
    title: "Call office",
    state: "open",
    createdAt: "2026-09-01T12:00:00.000Z",
    updatedAt: "2026-09-01T12:00:00.000Z",
    availableFrom: "2026-09-05T13:00:00.000Z",
    ...patch,
  };
}

describe("Solid calendar task projection", () => {
  const now = new Date("2026-09-04T12:00:00.000Z");

  test("sleep can delay a projected start or be ignored", () => {
    const item = task({ sleep: { until: "2026-09-06T13:00:00.000Z", startedAt: "2026-09-04T12:00:00.000Z" } });

    assert.equal(projectedTaskStart(item, now, true)?.toISOString(), "2026-09-06T13:00:00.000Z");
    const ignored = projectedTaskStart(item, now, false);
    assert.equal(ignored?.toISOString(), "2026-09-05T13:00:00.000Z");
    assert.equal(projectedStartBypassesSleep(item, ignored!, now, false), true);
  });

  test("indefinite sleep removes a respected projection", () => {
    const item = task({ sleep: { until: null, startedAt: "2026-09-04T12:00:00.000Z" } });
    assert.equal(projectedTaskStart(item, now, true), null);
    assert.equal(projectedTaskStart(item, now, false)?.toISOString(), "2026-09-05T13:00:00.000Z");
  });

  test("sleep-delayed starts past latest start are not projected", () => {
    const item = task({
      latestStart: "2026-09-05T18:00:00.000Z",
      sleep: { until: "2026-09-06T13:00:00.000Z", startedAt: "2026-09-04T12:00:00.000Z" },
    });
    assert.equal(projectedTaskStart(item, now, true), null);
  });
});

test("elapsed can-start dates leave the calendar while future wake dates remain", () => {
  const now = new Date("2026-09-07T12:00:00Z");
  assert.equal(projectedTaskStart(task(), now, true), null);
  assert.equal(projectedTaskStart(task({ availableFrom: now.toISOString() }), now, true), null);
  assert.equal(projectedTaskStart(task({ sleep: { until: "2026-09-08T12:00:00Z", startedAt: now.toISOString() } }), now, true)?.toISOString(), "2026-09-08T12:00:00.000Z");
});


test("sleep supplies a calendar wake date even without a can-start date", () => {
  const now = new Date("2026-09-24T12:00:00Z");
  const item = task({availableFrom:null, sleep:{until:"2026-09-26T12:00:00Z", startedAt:now.toISOString()}});
  assert.equal(projectedTaskStart(item,now,true)?.toISOString(),"2026-09-26T12:00:00.000Z");
  assert.equal(projectedTaskStart(item,now,false),null);
});
