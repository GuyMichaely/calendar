import {
  nextActionableStart,
  nextAvailabilityStart,
  sleepInfo,
  toDate,
} from "../../site/domain.js";
import type { Task } from "./types";

export function projectedTaskStart(task: Task, now: Date, respectSleep: boolean): Date | null {
  const sleep = sleepInfo(task, now);

  if (task.availabilitySchedule?.enabled) {
    if (respectSleep && sleep.sleeping) {
      if (sleep.indefinite) return null;
      return nextActionableStart(task, now, { respectSleep: true });
    }
    return nextAvailabilityStart(task, now);
  }

  const available = toDate(task.availableFrom);
  let projected = available || (respectSleep && sleep.sleeping && !sleep.indefinite ? sleep.until : null);
  if (!projected) return null;
  if (respectSleep && sleep.sleeping) {
    if (sleep.indefinite) return null;
    if (sleep.until > projected) projected = sleep.until;
  }

  const latestStart = toDate(task.latestStart);
  if (latestStart && projected > latestStart) return null;
  return projected > now ? projected : null;
}

export function projectedStartBypassesSleep(task: Task, start: Date, now: Date, respectSleep: boolean) {
  if (respectSleep) return false;
  const sleep = sleepInfo(task, now);
  return sleep.sleeping && (sleep.indefinite || start < sleep.until);
}
