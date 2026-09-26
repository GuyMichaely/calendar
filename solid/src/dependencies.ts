import type { Item, Task } from "./types";

export const RELATIVE_DATE_FIELDS = ["availableFrom", "latestStart", "deadline"] as const;
export type RelativeDateField = (typeof RELATIVE_DATE_FIELDS)[number];
const DAY_MS = 86_400_000;

/** A dependent task that hasn't been started. One whose parent task is gone counts as started. */
export function isDormant(item: Item, byId: Map<string, Item>): boolean {
  return item.kind === "task" && !!item.dependentOf && byId.get(item.dependentOf)?.kind === "task";
}

/** Dates measured from a start moment: offsets become fixed dates; fixed dates stay as they are. */
export function datesFrom(task: Task, start: Date) {
  const dates: Partial<Pick<Task, RelativeDateField>> = {};
  for (const field of RELATIVE_DATE_FIELDS) {
    const days = task.relativeDates?.[field];
    if (days != null) dates[field] = field === "availableFrom" && days === 0 ? null : new Date(start.getTime() + days * DAY_MS).toISOString();
  }
  return dates;
}

/** Starting a dependent task detaches it from its parent task and fixes its dates. */
export function startedTask(task: Task, at: Date): Task {
  const iso = at.toISOString();
  return { ...task, ...datesFrom(task, at), dependentOf: null, relativeDates: null, updatedAt: iso, history: [...(task.history || []), { at: iso, type: "started", from: task.dependentOf }] };
}

/**
 * For the calendar's what-if view: each dormant dependent task as if started on its parent task's
 * latest date (due, else latest start, else now). Chains of dependent tasks build on each other.
 */
export function projectDependents(items: Item[], now: Date): Map<string, Task> {
  const byId = new Map(items.map(item => [item.id, item]));
  const projected = new Map<string, Task>();
  const project = (task: Task, depth = 0): Task => {
    if (!isDormant(task, byId) || depth > 50) return task;
    const cached = projected.get(task.id);
    if (cached) return cached;
    const owner = project(byId.get(task.dependentOf!) as Task, depth + 1);
    const base = [owner.deadline, owner.latestStart].map(value => value && new Date(value)).find(date => date && !Number.isNaN(date.getTime())) || now;
    const result = { ...task, ...datesFrom(task, base as Date) };
    projected.set(task.id, result);
    return result;
  };
  for (const item of items) if (item.kind === "task" && isDormant(item, byId)) project(item);
  return projected;
}
