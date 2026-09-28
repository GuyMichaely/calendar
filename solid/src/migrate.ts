import { describeSchedule } from "./windows";
import type { Group, Item, Task, TimeWindow } from "./types";

/*
 * Old data, converted to the current model when the calendar loads and after each sync:
 * - sleep becomes pushed down (a sleep that has ended is just dropped);
 * - inline working hours become a named window, shared by every task with the same hours
 *   (its id comes from the hours, so two devices converting the same hours make one window);
 * - an exact "warn at" time becomes a lead time in hours before the due date;
 * - a latest start becomes the due date when there's none (else it's dropped);
 * - boards nested on the old board page become top-level boards.
 * Returns only what changes.
 */
export function legacyChanges(items: Item[], now: Date): Item[] {
  const at = now.toISOString();
  const changed: Item[] = [];
  const windows = new Map(items.filter((item): item is TimeWindow => item.kind === "window").map(item => [item.id, item]));
  const windowFor = (days: number[], start: string, end: string) => {
    const sorted = [...new Set(days)].sort((a, b) => a - b);
    const same = [...windows.values()].find(window => window.start === start && window.end === end && [...window.days].sort((a, b) => a - b).join() === sorted.join());
    if (same) return same.id;
    const id = `window-hours-${sorted.join("")}-${start.replace(":", "")}-${end.replace(":", "")}`;
    const window: TimeWindow = { id, kind: "window", title: describeSchedule({ days: sorted, start, end }), days: sorted, start, end, createdAt: at, updatedAt: at };
    windows.set(id, window);
    changed.push(window);
    return id;
  };
  for (const item of items) {
    if (item.kind === "group") {
      if (item.parentId) changed.push({ ...item, parentId: null, updatedAt: at } as Group);
      continue;
    }
    if (item.kind !== "task") continue;
    const patch: Partial<Task> = {};
    if (item.sleep) {
      const until = item.sleep.until ? new Date(item.sleep.until) : null;
      if (!item.pushedDown && item.state !== "completed" && (!until || until > now)) patch.pushedDown = { until: item.sleep.until, at: item.sleep.startedAt };
      patch.sleep = null;
    }
    const hours = item.availabilitySchedule;
    if (hours) {
      if (hours.enabled && !item.windowId && hours.days?.length && hours.start && hours.end) patch.windowId = windowFor(hours.days, hours.start, hours.end);
      patch.availabilitySchedule = null;
    }
    if (item.warnAt) {
      const due = item.deadline ? new Date(item.deadline).getTime() : NaN, warn = new Date(item.warnAt).getTime();
      if (!item.warnHours && Number.isFinite(due) && Number.isFinite(warn)) patch.warnHours = Math.max(1, Math.round((due - warn) / 3_600_000));
      patch.warnAt = null;
    }
    if (item.latestStart) {
      if (!item.deadline) patch.deadline = item.latestStart;
      patch.latestStart = null;
    }
    if (item.relativeDates?.latestStart != null) {
      const { latestStart, ...rest } = item.relativeDates;
      patch.relativeDates = { ...rest, ...(rest.deadline == null ? { deadline: latestStart } : {}) };
    }
    if (Object.keys(patch).length) changed.push({ ...item, ...patch, updatedAt: at });
  }
  return changed;
}
