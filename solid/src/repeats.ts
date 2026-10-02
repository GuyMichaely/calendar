import { addDays, endOfDay, partsOf, startOfDay, zonedDate } from "./zone";
import type { Repeat, Task } from "./types";

/*
 * A repeating task is one task whose Can start (and Due, if it has one) describe its
 * current occurrence. Checking an occurrence off moves both to the next one. A missed
 * occurrence (its due time, or its day, passed) either rolls forward on its own (Skip)
 * or stays, overdue, until it's done (Keep until done). Past its `until` date it stops.
 */

const time = (value?: string | null) => { if (!value) return null; const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date; };

/** The next occurrence's start after one starting at `start`. */
export function nextStart(start: Date, repeat: Repeat): Date {
  const every = Math.max(1, Math.round(repeat.every || 1));
  // Days and clock times are the calendar's time zone's.
  if (repeat.unit === "month") {
    const { year, month, day, hour, minute } = partsOf(start);
    // Short months clamp (Jan 31 → Feb 28).
    const length = new Date(Date.UTC(year, month - 1 + every + 1, 0)).getUTCDate();
    return zonedDate(year, month + every, Math.min(day, length), hour, minute);
  }
  if (repeat.unit === "week") return addDays(start, 7 * every);
  if (repeat.unit === "weekday") {
    let next = start;
    for (let steps = every; steps > 0;) { next = addDays(next, 1); const weekday = partsOf(next).weekday; if (weekday !== 0 && weekday !== 6) steps--; }
    return next;
  }
  return addDays(start, every);
}

export type Occurrence = { start: Date; due: Date | null; end: Date; missed: boolean; over: boolean };

/** Where a repeating task's anchor is: its Can start, else the start of the day it was made. */
function anchorOf(task: Task) {
  const start = time(task.availableFrom);
  if (start) return start;
  return startOfDay(time(task.createdAt) || new Date());
}

/** The occurrence a repeating task is on now. */
export function currentOccurrence(task: Task, now: Date): Occurrence | null {
  const repeat = task.repeat;
  if (!repeat) return null;
  let start = anchorOf(task);
  const dueOffset = time(task.deadline) ? time(task.deadline)!.getTime() - start.getTime() : null;
  const until = time(repeat.until);
  const occurrence = (from: Date) => {
    const due = dueOffset == null ? null : new Date(from.getTime() + dueOffset);
    return { start: from, due, end: due ?? endOfDay(from) };
  };
  let current = occurrence(start);
  // Skip: missed occurrences roll forward to the first one that hasn't ended.
  if (repeat.ifMissed === "skip") for (let guard = 0; current.end < now && guard < 5000; guard++) { start = nextStart(start, repeat); current = occurrence(start); }
  const over = !!until && current.start > endOfDay(until);
  return { ...current, missed: current.end < now, over };
}

/** The task as its current occurrence: that occurrence's start and due (a missed one kept until done counts as due then). */
export function occurrenceTask(task: Task, now: Date): Task {
  const occurrence = currentOccurrence(task, now);
  if (!occurrence) return task;
  const due = occurrence.due ?? (occurrence.missed ? occurrence.end : null);
  return { ...task, availableFrom: occurrence.start.toISOString(), deadline: due?.toISOString() ?? null };
}

/** The changes that move a repeating task past its current occurrence, or finish it after its last. */
export function advancedTask(task: Task, now: Date, entry: { type: string }): Task {
  const at = now.toISOString();
  const occurrence = currentOccurrence(task, now)!;
  const start = nextStart(occurrence.start, task.repeat!);
  const until = time(task.repeat!.until);
  const history = [...(task.history || []), { at, ...entry, occurrence: occurrence.start.toISOString() }];
  if (until && start > endOfDay(until)) return { ...task, state: "completed", completedAt: at, pushedDown: null, updatedAt: at, history };
  const shift = start.getTime() - anchorOf(task).getTime();
  const deadline = time(task.deadline);
  return {
    ...task,
    availableFrom: start.toISOString(),
    deadline: deadline ? new Date(deadline.getTime() + shift).toISOString() : null,
    // A push down was for the occurrence that's now done.
    pushedDown: null,
    updatedAt: at,
    history,
  };
}

/** "Daily", "Every 3 days", "Weekdays", "Weekly", "Every 2 months"… */
export function describeRepeat(repeat: Repeat) {
  const every = Math.max(1, Math.round(repeat.every || 1));
  const names = { day: ["Daily", "days"], weekday: ["Weekdays", "weekdays"], week: ["Weekly", "weeks"], month: ["Monthly", "months"] } as const;
  const [one, many] = names[repeat.unit];
  return every === 1 ? one : `Every ${every} ${many}`;
}

/** The latest check-in ("Not yet") on a check-in task, if any. */
export function lastCheckIn(task: Task) {
  const entry = [...(task.history || [])].reverse().find(item => item.type === "not-yet");
  return entry ? time(entry.at) : null;
}
