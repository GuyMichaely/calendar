// Converting between the "YYYY-MM-DDTHH:mm" local values the editor stores and text people read or type.

const pad = (value: number) => String(value).padStart(2, "0");

export function toLocalValue(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function fromLocalValue(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value || "");
  return match ? new Date(+match[1], +match[2] - 1, +match[3], +match[4], +match[5]) : null;
}

/** Compact form for narrow fields. */
export function formatDateTimeShort(date: Date) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

export function formatDateTimeText(date: Date) {
  return new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const WEEKDAY = /^(sun|mon|tue|wed|thu|fri|sat)[a-z]*\.?,?\s+/;

function parseTime(text: string): [number, number] | null {
  const match = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?$/.exec(text.replace(/\./g, "").trim());
  if (!match) return null;
  let hours = +match[1];
  const minutes = match[2] ? +match[2] : 0;
  const meridiem = match[3]?.[0];
  if (minutes > 59 || (meridiem ? hours < 1 || hours > 12 : hours > 23)) return null;
  if (meridiem === "p" && hours !== 12) hours += 12;
  if (meridiem === "a" && hours === 12) hours = 0;
  return [hours, minutes];
}

function build(year: number, month: number, day: number, time: string | undefined): Date | null {
  const [hours, minutes] = time?.trim() ? parseTime(time) ?? [NaN, NaN] : [0, 0];
  if (Number.isNaN(hours)) return null;
  const date = new Date(year, month, day, hours, minutes);
  return date.getMonth() === month && date.getDate() === day ? date : null;
}

/**
 * Read a typed date and optional time, e.g. "Oct 10 2026 5pm", "Sat, Oct 10, 2026, 5:00 PM",
 * "10/10/2026 17:00" or "2026-10-10 17:00". A missing year means this year; a missing time means midnight.
 */
export function parseDateTimeText(text: string, now = new Date()): Date | null {
  const input = text.trim().toLowerCase().replace(WEEKDAY, "");
  if (!input) return null;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[\st,]+(?:at\s+)?(.+))?$/.exec(input);
  if (match) return build(+match[1], +match[2] - 1, +match[3], match[4]);
  match = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?(?:[\s,]+(?:at\s+)?(.+))?$/.exec(input);
  if (match) {
    const year = match[3] ? (match[3].length === 2 ? 2000 + +match[3] : +match[3]) : now.getFullYear();
    return build(year, +match[1] - 1, +match[2], match[4]);
  }
  match = /^([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?(?:[\s,]+(?:at\s+)?(.+))?$/.exec(input);
  if (match) {
    const month = MONTHS.indexOf(match[1].slice(0, 3));
    if (month < 0) return null;
    return build(match[3] ? +match[3] : now.getFullYear(), month, +match[2], match[4]);
  }
  match = /^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)\.?(?:,?\s+(\d{4}))?(?:[\s,]+(?:at\s+)?(.+))?$/.exec(input);
  if (match) {
    const month = MONTHS.indexOf(match[2].slice(0, 3));
    if (month < 0) return null;
    return build(match[3] ? +match[3] : now.getFullYear(), month, +match[1], match[4]);
  }
  return null;
}
