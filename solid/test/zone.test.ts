import { expect, test } from "bun:test";
import { addDays, atTime, dayKey, daysBetween, endOfDay, fromInputValue, partsOf, sameClockIn, startOfDay, toInputValue, zonedDate } from "../src/zone";

const ny = "America/New_York", tokyo = "Asia/Tokyo";

test("wall-clock readings and moments convert both ways in any zone", () => {
  const moment = zonedDate(2026, 10, 6, 14, 20, ny);
  expect(moment.toISOString()).toBe("2026-10-06T18:20:00.000Z");
  expect(partsOf(moment, tokyo)).toMatchObject({ year: 2026, month: 10, day: 7, hour: 3, minute: 20, weekday: 3 });
  expect(dayKey(moment, ny)).toBe("2026-10-06");
  expect(dayKey(moment, tokyo)).toBe("2026-10-07");
  expect(toInputValue(moment, ny)).toBe("2026-10-06T14:20");
  expect(fromInputValue("2026-10-06T14:20", ny)!.getTime()).toBe(moment.getTime());
  // Rolling over: day 32 of October is November 1.
  expect(dayKey(zonedDate(2026, 10, 32, 9, 0, ny), ny)).toBe("2026-11-01");
});

test("days keep their clock time across a clock change", () => {
  // New York leaves daylight time on Nov 1, 2026.
  const before = zonedDate(2026, 10, 31, 9, 0, ny);
  const after = addDays(before, 1, ny);
  expect(partsOf(after, ny)).toMatchObject({ day: 1, hour: 9 });
  expect(after.getTime() - before.getTime()).toBe(25 * 3_600_000);
  expect(daysBetween(before, after, ny)).toBe(1);
  expect(endOfDay(before, ny).getTime() - startOfDay(before, ny).getTime()).toBe(86_400_000 - 1);
  expect(atTime(before, "17:30", ny).toISOString()).toBe("2026-10-31T21:30:00.000Z");
  // A skipped time (2:30 am on Mar 8, 2026) lands just after the change; a repeated one on the first.
  expect(zonedDate(2026, 3, 8, 2, 30, ny).toISOString()).toBe("2026-03-08T07:30:00.000Z");
  expect(zonedDate(2026, 11, 1, 1, 30, ny).toISOString()).toBe("2026-11-01T05:30:00.000Z");
});

test("moving to another zone keeps the clock reading", () => {
  const moment = zonedDate(2026, 10, 6, 9, 0, ny);
  expect(toInputValue(sameClockIn(moment, ny, tokyo), tokyo)).toBe("2026-10-06T09:00");
});
