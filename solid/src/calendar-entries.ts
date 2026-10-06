import { effectivelyDone, openWork, placementOf, pushedDownInfo, type SectionId } from "./today";
import { currentOccurrence, nextStart, occurrenceTask } from "./repeats";
import { nextOpening, shutsAt, taskSchedule, windowsById } from "./windows";
import { isDormant } from "./dependencies";
import { endOfDay } from "./zone";
import type { CalendarEvent, Item, Task } from "./types";

/*
 * What the month calendar shows for a task: when it can start, if it can't now (a task in a
 * window starts at the window's first opening from its start, so a task that could start
 * but whose window is shut shows at the window's next opening), when it's due, and a
 * repeating task's later occurrences. A pushed-down task still shows, marked as such.
 */
export type CalendarEntry = {
  item: Task | CalendarEvent;
  kind: "event" | "start" | "due" | "repeat";
  at: Date;
  // A start at a window's opening: when the window shuts (null: it runs on into the next day).
  until?: Date | null;
  // A start only because the task's window is shut now (the task could otherwise start already).
  reopens?: boolean;
  pushed?: boolean;
  overdue?: boolean;
};

const time = (value?: string | null) => { if (!value) return null; const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date; };
const MAX_REPEATS = 62;

/** Every entry from `from` to `to` (inclusive days), for events and for tasks that aren't done. */
export function calendarEntries(items: Item[], from: Date, to: Date, now: Date): CalendarEntry[] {
  const byId = new Map(items.map(item => [item.id, item]));
  const windows = windowsById(items);
  const last = endOfDay(to);
  const inRange = (date: Date | null): date is Date => !!date && date >= from && date <= last;
  const entries: CalendarEntry[] = [];
  for (const item of items) {
    if (item.kind === "event") { const start = time(item.start); if (inRange(start)) entries.push({ item, kind: "event", at: start }); continue; }
    if (item.kind !== "task" || effectivelyDone(item, byId)) continue;
    const task = occurrenceTask(item, now);
    const pushed = pushedDownInfo(item, now).pushed;
    // A dormant dependent task shows only as projected by the app (its dates as if started).
    const start = time(task.availableFrom);
    const from = start && start > now ? start : now;
    const schedule = isDormant(item, byId) ? null : taskSchedule(task, windows);
    const opening = schedule ? nextOpening(schedule, from) : null;
    const at = opening && opening.opens > from ? opening.opens : start && start > now ? start : null;
    if (inRange(at)) entries.push({ item, kind: "start", at, pushed, ...(opening && at === opening.opens ? { until: shutsAt(schedule!, opening) } : {}), ...(start && start > now ? {} : { reopens: true }) });
    const due = time(task.deadline);
    if (inRange(due)) entries.push({ item, kind: "due", at: due, pushed, overdue: due < now });
    // Later occurrences of a repeating task.
    const current = item.repeat ? currentOccurrence(item, now) : null;
    if (current && !current.over) {
      const until = time(item.repeat!.until);
      const dueOffset = current.due ? current.due.getTime() - current.start.getTime() : null;
      let next = nextStart(current.start, item.repeat!);
      for (let count = 0; next <= last && count < MAX_REPEATS && (!until || next <= endOfDay(until)); count++, next = nextStart(next, item.repeat!)) {
        const occurrenceDue = dueOffset == null ? null : new Date(next.getTime() + dueOffset);
        const at = occurrenceDue ?? next;
        if (inRange(at)) entries.push({ item, kind: "repeat", at });
      }
    }
  }
  return entries.sort((a, b) => a.at.getTime() - b.at.getTime() || (a.item.createdAt || "").localeCompare(b.item.createdAt || ""));
}

/**
 * What's actually done for a task: its open leaf tasks (a task with open subtasks is a
 * container), or the task itself when nothing open is under it.
 */
export function leafTasks(items: Item[], task: Task): Task[] {
  const byId = new Map(items.map(item => [item.id, item]));
  const under = (leaf: Task) => {
    for (let parent = leaf.parentId ? byId.get(leaf.parentId) : undefined, seen = new Set<string>(); parent?.kind === "task" && !seen.has(parent.id); seen.add(parent.id), parent = parent.parentId ? byId.get(parent.parentId) : undefined)
      if (parent.id === task.id) return true;
    return false;
  };
  const leaves = openWork(items).filter(under);
  return leaves.length ? leaves : [task];
}

const TODAY: SectionId[] = ["firm", "closing", "later", "available"];

/** The tasks the Agenda has for today: in its sections up to Available, and not pushed down. */
export function todaysWork(items: Item[], now: Date): Task[] {
  return openWork(items).filter(task => {
    const placement = placementOf(task, items, now);
    return TODAY.includes(placement.section) && !placement.pushed;
  });
}
