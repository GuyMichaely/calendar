import { expect, test } from "bun:test";
import { advancedTask, currentOccurrence, describeRepeat, nextStart, occurrenceTask } from "../src/repeats";
import type { Repeat, Task } from "../src/types";

const at = "2026-09-01T00:00:00.000Z";
const local = (day: number, hours = 0, minutes = 0) => new Date(2026, 9, day, hours, minutes);
const repeat = (extra: Partial<Repeat> = {}): Repeat => ({ unit: "day", every: 1, until: null, untilDone: false, ifMissed: "skip", ...extra });
const task = (extra: Partial<Task> = {}): Task => ({ id: "t", kind: "task", title: "t", state: "open", createdAt: at, updatedAt: at, history: [], ...extra });

test("steps: days, weekdays over a weekend, weeks, and months that clamp", () => {
  expect(nextStart(local(5, 9), repeat({ every: 3 }))).toEqual(local(8, 9));
  expect(nextStart(local(9, 9), repeat({ unit: "weekday" }))).toEqual(local(12, 9)); // Fri → Mon
  expect(nextStart(local(5), repeat({ unit: "week", every: 2 }))).toEqual(local(19));
  expect(nextStart(new Date(2026, 0, 31), repeat({ unit: "month" }))).toEqual(new Date(2026, 1, 28));
  expect(describeRepeat(repeat())).toBe("Daily");
  expect(describeRepeat(repeat({ every: 3 }))).toBe("Every 3 days");
});

test("Skip rolls a missed occurrence forward; Keep leaves it overdue", () => {
  const now = local(8, 12);
  const skip = task({ availableFrom: local(5, 9).toISOString(), repeat: repeat() });
  expect(currentOccurrence(skip, now)).toMatchObject({ start: local(8, 9), missed: false });
  const keep = task({ availableFrom: local(5, 9).toISOString(), repeat: repeat({ ifMissed: "keep" }) });
  expect(currentOccurrence(keep, now)).toMatchObject({ start: local(5, 9), missed: true });
  // Kept and missed: due at the end of its day, so it's overdue now.
  expect(new Date(occurrenceTask(keep, now).deadline!).getTime()).toBeLessThan(now.getTime());
  // With a due time, each occurrence is due the same time after its start.
  const due = task({ availableFrom: local(5, 9).toISOString(), deadline: local(5, 17).toISOString(), repeat: repeat() });
  expect(occurrenceTask(due, now)).toMatchObject({ availableFrom: local(8, 9).toISOString(), deadline: local(8, 17).toISOString() });
});

test("checking off moves to the next occurrence, and past its until date finishes it", () => {
  const now = local(8, 12);
  const daily = task({ availableFrom: local(8, 9).toISOString(), deadline: local(8, 17).toISOString(), repeat: repeat({ until: local(9).toISOString() }) });
  const next = advancedTask(daily, now, { type: "occurrence-done" });
  expect(next).toMatchObject({ state: "open", availableFrom: local(9, 9).toISOString(), deadline: local(9, 17).toISOString() });
  expect(next.history!.at(-1)).toMatchObject({ type: "occurrence-done", occurrence: local(8, 9).toISOString() });
  expect(advancedTask(next, local(9, 12), { type: "occurrence-done" })).toMatchObject({ state: "completed" });
});
