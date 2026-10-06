import { addDays, atTime, partsOf, startOfDay } from "./zone";
import type { Item, Task, TimeWindow } from "./types";

// A window's weekly hours: the days it's open (0 = Sunday) and its start/end times, in the calendar's time zone.
export type Schedule = { days: number[]; start: string; end: string };

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The hours a task can be done in: its window, if it has one. */
export function taskSchedule(task: Task, windows: Map<string, TimeWindow>): Schedule | null {
  return (task.windowId ? windows.get(task.windowId) : undefined) ?? null;
}

export function windowsById(items: Item[]) {
  return new Map(items.filter((item): item is TimeWindow => item.kind === "window").map(item => [item.id, item]));
}

/** The window's opening on the given day, if it opens that day. An end at or before the start runs to midnight. */
export function openingOn(schedule: Schedule, day: Date): { opens: Date; closes: Date } | null {
  if (!schedule.days.includes(partsOf(day).weekday)) return null;
  const opens = atTime(day, schedule.start);
  let closes = atTime(day, schedule.end);
  if (closes <= opens) closes = addDays(startOfDay(day), 1);
  return { opens, closes };
}

/** The first opening that hasn't closed by `from` (the current one, if open), within two weeks. */
export function nextOpening(schedule: Schedule, from: Date) {
  for (let offset = 0; offset < 15; offset++) {
    const day = addDays(startOfDay(from), offset);
    const opening = openingOn(schedule, day);
    if (opening && opening.closes > from) return opening;
  }
  return null;
}

/** When an opening really shuts: its close, or null when the window opens again right then (running on into the next day). */
export function shutsAt(schedule: Schedule, opening: { closes: Date }): Date | null {
  const next = openingOn(schedule, opening.closes);
  return next && next.opens.getTime() === opening.closes.getTime() ? null : opening.closes;
}

export function describeSchedule(schedule: Schedule) {
  const days = [...schedule.days].sort((a, b) => a - b);
  // Consecutive days read as a range ("Mon–Fri").
  const runs: number[][] = [];
  for (const day of days) {
    const run = runs.at(-1);
    if (run && run.at(-1) === day - 1) run.push(day); else runs.push([day]);
  }
  const dayText = days.length === 7 ? "Daily" : runs.map(run => run.length > 2 ? `${WEEKDAYS[run[0]]}–${WEEKDAYS[run.at(-1)!]}` : run.map(day => WEEKDAYS[day]).join(", ")).join(", ");
  return `${dayText || "No days"} ${schedule.start}–${schedule.end}`;
}
