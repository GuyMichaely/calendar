import { compareItemCreation, actionability, isSleeping, nextActionableStart, sleepInfo, toDate } from "../../site/domain.js";
import type { Task } from "./types";

export type TaskSort = "start" | "later" | "manual";
export function taskVisible(task: Task, now: Date, hideSleeping: boolean) {
  return !hideSleeping || !isSleeping(task, now);
}

// Due dates affect ordering, not whether a task is available to work on.
export function planTasks(tasks: Task[], now: Date, respectSleep: boolean, sort: TaskSort, horizon: Date | null) {
  const dateKey = (task: Task) => {
    const next = nextActionableStart(task, now);
    if (task.state !== "completed" && !next) return Infinity;
    let start = toDate(task.availableFrom)?.getTime() ?? -Infinity;
    if (task.availabilitySchedule?.enabled && next && next > now) start = Math.max(start, next.getTime());
    let key = sort === "later" ? Math.max(start, toDate(task.deadline)?.getTime() ?? -Infinity) : start;
    const sleep = sleepInfo(task, now);
    if (respectSleep && sleep.sleeping) key = sleep.indefinite ? Infinity : Math.max(key, sleep.until.getTime());
    return key;
  };
  const compare = (a: Task, b: Task): number => {
    if (sort === "manual") return (a.sortOrder ?? Infinity) - (b.sortOrder ?? Infinity) || compareItemCreation(a, b);
    const primary = dateKey(a) - dateKey(b);
    return primary || (toDate(a.deadline)?.getTime() ?? Infinity) - (toDate(b.deadline)?.getTime() ?? Infinity) || compareItemCreation(a, b);
  };
  const ordered = [...tasks].sort(compare);
  const open = ordered.filter(task => task.state !== "completed");
  const ready = (task: Task) => actionability(task, now).actionable && !(respectSleep && isSleeping(task, now));
  const upcoming = open.filter(task => !ready(task)).map(task => ({task, upcomingAt: nextActionableStart(task, now, {respectSleep})})).filter(row => {
    const sleep = sleepInfo(row.task, now);
    // Indefinite sleepers remain visible at the end of Upcoming, even with a horizon.
    if (respectSleep && sleep.sleeping && sleep.indefinite) return true;
    // Retain a sleeping task even if its latest-start window has already passed.
    const next = row.upcomingAt || (respectSleep && sleep.sleeping ? sleep.until : null);
    return !next || (next > now && (!horizon || next <= horizon));
  });
  return {
    now: open.filter(ready).map(task => ({task})),
    upcoming,
    completed: ordered.filter(task => task.state === "completed").map(task => ({task})),
  };
}
