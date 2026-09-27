import { expect, test } from "bun:test";
import { formatDateTimeText, fromLocalValue, parseDateTimeText, toLocalValue } from "../src/datetime-text";

const now = new Date(2026, 8, 26, 9, 30);
const parsed = (text: string) => { const date = parseDateTimeText(text, now); return date && toLocalValue(date); };

test("typed dates accept month names, numbers, and ISO, with optional times", () => {
  expect(parsed("Oct 10 2026 5pm")).toBe("2026-10-10T17:00");
  expect(parsed("Sat, Oct 10, 2026, 5:00 PM")).toBe("2026-10-10T17:00");
  expect(parsed("october 10th at 9:15 am")).toBe("2026-10-10T09:15");
  expect(parsed("10/10/2026 17:00")).toBe("2026-10-10T17:00");
  expect(parsed("10/10/26")).toBe("2026-10-10T00:00");
  expect(parsed("2026-10-10")).toBe("2026-10-10T00:00");
  expect(parsed("Oct 10 12am")).toBe("2026-10-10T00:00");
  expect(parsed("Sat 10 Oct 2026, 17:00")).toBe("2026-10-10T17:00");
});

test("impossible or unreadable dates are rejected", () => {
  for (const text of ["", "soon", "Feb 30 2026", "13/1/2026", "Oct 10 25:00", "Oct 10 13pm", "Smarch 3"]) expect(parsed(text)).toBeNull();
});

test("the displayed text reads back as the same date and time", () => {
  const date = new Date(2026, 9, 10, 17, 5);
  expect(toLocalValue(parseDateTimeText(formatDateTimeText(date), now)!)).toBe("2026-10-10T17:05");
  expect(fromLocalValue("2026-10-10T17:05")?.getTime()).toBe(date.getTime());
  expect(fromLocalValue("")).toBeNull();
});

test("numeric text uses padded US dates and twelve-hour time", () => {
  expect(formatDateTimeText(new Date(2026, 0, 2, 0, 5))).toBe("01/02/2026 12:05 AM");
  expect(formatDateTimeText(new Date(2026, 9, 9, 17, 0))).toBe("10/09/2026 05:00 PM");
});

test("date-only deadlines use the end of the day while explicit times remain exact", () => {
  for (const text of ["10/09/2026", "2026-10-09", "Oct 9 2026", "9 Oct 2026"]) {
    expect(toLocalValue(parseDateTimeText(text, now, [23, 59])!)).toBe("2026-10-09T23:59");
    expect(toLocalValue(parseDateTimeText(text, now)!)).toBe("2026-10-09T00:00");
  }
  expect(toLocalValue(parseDateTimeText("10/09/2026 12:00 AM", now, [23, 59])!)).toBe("2026-10-09T00:00");
  expect(toLocalValue(parseDateTimeText("10/09/2026 05:00 PM", now, [23, 59])!)).toBe("2026-10-09T17:00");
  expect(parseDateTimeText("02/30/2026", now, [23, 59])).toBeNull();
});
