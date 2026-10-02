import { createSignal } from "solid-js";

/*
 * The calendar's one time zone. Moments (due dates, can-start dates, …) are stored as
 * exact instants; anything that's a clock time or a day (a window's hours, "today",
 * "tomorrow", a repeat's next day, the calendar's day boxes, the date fields, every
 * time shown) is read in this zone, whatever zone the device is in. It's synced (see
 * the settings item), so every device shows the same thing.
 */
export const deviceZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

const [zone, setZone] = createSignal(deviceZone());
/** The calendar's time zone (reactive). */
export const calendarZone = zone;
export function setCalendarZone(timeZone: string) { if (isTimeZone(timeZone)) setZone(timeZone); }

export function isTimeZone(timeZone: string) {
  try { new Intl.DateTimeFormat(undefined, { timeZone }); return true; } catch { return false; }
}

export function allTimeZones(): string[] {
  const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone");
  return supported?.length ? supported : [deviceZone()];
}

export type Parts = { year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: number };

const partFormatters = new Map<string, Intl.DateTimeFormat>();
const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** The wall-clock reading of a moment in a zone (month 1–12, weekday 0 = Sunday). */
export function partsOf(date: Date, timeZone = zone()): Parts {
  let formatter = partFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric", weekday: "short" });
    partFormatters.set(timeZone, formatter);
  }
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(date)) parts[part.type] = part.value;
  return { year: +parts.year, month: +parts.month, day: +parts.day, hour: +parts.hour % 24, minute: +parts.minute, second: +parts.second, weekday: WEEKDAY_INDEX[parts.weekday] };
}

const offsetAt = (time: number, timeZone: string) => {
  const parts = partsOf(new Date(time), timeZone);
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - Math.floor(time / 1000) * 1000;
};

/**
 * The moment a wall-clock reading names in a zone. Out-of-range fields roll over (day 32,
 * month 13, …). A time skipped by a clock change lands just after it; a repeated one, on
 * the first.
 */
export function zonedDate(year: number, month: number, day: number, hour = 0, minute = 0, timeZone = zone()): Date {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  // The zone's offset a day either side covers any clock change near this time.
  const before = wall - offsetAt(wall - 86_400_000, timeZone), after = wall - offsetAt(wall + 86_400_000, timeZone);
  const reads = (time: number) => wall - offsetAt(time, timeZone) === time;
  const valid = [before, after].filter(reads);
  return new Date(valid.length ? Math.min(...valid) : before);
}

export function startOfDay(date: Date, timeZone = zone()) {
  const parts = partsOf(date, timeZone);
  return zonedDate(parts.year, parts.month, parts.day, 0, 0, timeZone);
}
export function endOfDay(date: Date, timeZone = zone()) {
  return new Date(addDays(startOfDay(date, timeZone), 1, timeZone).getTime() - 1);
}
/** The same clock time some days later (or earlier). */
export function addDays(date: Date, days: number, timeZone = zone()) {
  const parts = partsOf(date, timeZone);
  return zonedDate(parts.year, parts.month, parts.day + days, parts.hour, parts.minute, timeZone);
}
/** A day's moment at a "HH:MM" time. */
export function atTime(day: Date, time: string, timeZone = zone()) {
  const [hours = 0, minutes = 0] = time.split(":").map(Number);
  const parts = partsOf(day, timeZone);
  return zonedDate(parts.year, parts.month, parts.day, hours, minutes, timeZone);
}
export function sameDay(a: Date, b: Date, timeZone = zone()) {
  return dayKey(a, timeZone) === dayKey(b, timeZone);
}
/** Whole days from one day to another (by the calendar, not by hours). */
export function daysBetween(from: Date, to: Date, timeZone = zone()) {
  const a = partsOf(from, timeZone), b = partsOf(to, timeZone);
  return Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86_400_000);
}

const pad = (value: number) => String(value).padStart(2, "0");
export function dayKey(date: Date, timeZone = zone()) {
  const parts = partsOf(date, timeZone);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
/** Text for a moment, as read in the calendar's zone. */
export function formatIn(date: Date, options: Intl.DateTimeFormatOptions, timeZone = zone()) {
  const key = `${timeZone}|${JSON.stringify(options)}`;
  let formatter = formatters.get(key);
  if (!formatter) { formatter = new Intl.DateTimeFormat(undefined, { ...options, timeZone }); formatters.set(key, formatter); }
  return formatter.format(date);
}
export const clockText = (date: Date) => formatIn(date, { hour: "numeric", minute: "2-digit" });
/** "Oct 12, 3:00 PM" (with the year only when it isn't this year). */
export function dateTimeText(date: Date, now = new Date()) {
  return formatIn(date, { month: "short", day: "numeric", ...(partsOf(date).year !== partsOf(now).year ? { year: "numeric" } : {}), hour: "numeric", minute: "2-digit" });
}

/** A "YYYY-MM-DDTHH:mm" field value for a moment, and back. */
export function toInputValue(value: Date | string | null | undefined, timeZone = zone()) {
  const date = value instanceof Date ? value : value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  const parts = partsOf(date, timeZone);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}
export function fromInputValue(value: string | FormDataEntryValue | null | undefined, timeZone = zone()): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(typeof value === "string" ? value : "");
  return match ? zonedDate(+match[1], +match[2], +match[3], +match[4], +match[5], timeZone) : null;
}
export const inputToIso = (value: string | FormDataEntryValue | null | undefined) => fromInputValue(value)?.toISOString() ?? null;

/** The same wall-clock reading in another zone: for moving a calendar between zones. */
export function sameClockIn(date: Date, from: string, to: string) {
  const parts = partsOf(date, from);
  return zonedDate(parts.year, parts.month, parts.day, parts.hour, parts.minute, to);
}
