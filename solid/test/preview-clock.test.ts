import { expect, test } from "bun:test";
import { PREVIEW_CLOCK_KEY, readPreviewTime, shiftPreviewTime } from "../src/preview-clock";

test("preview time is namespaced and invalid saved values fall back to real time", () => {
  expect(PREVIEW_CLOCK_KEY.startsWith('calendar-todo-prototype:')).toBe(true);
  expect(readPreviewTime(null)).toBeNull();expect(readPreviewTime('invalid')).toBeNull();
  expect(readPreviewTime('2026-10-09T14:30:00.000Z')?.toISOString()).toBe('2026-10-09T14:30:00.000Z');
});
test("clock steps cross month boundaries without changing the input date", () => {
  const now=new Date(2026,8,30,23,30);
  expect(shiftPreviewTime(now,1).getDate()).toBe(1);
  expect(shiftPreviewTime(now,24).getMonth()).toBe(9);
  expect(shiftPreviewTime(now,24).getHours()).toBe(23);
  expect(shiftPreviewTime(now,-24).getDate()).toBe(29);
  expect(now.getDate()).toBe(30);
});
