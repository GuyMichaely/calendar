import {
  isSleeping,
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
      return nextActionableStart(task, now, { respectSleep: true }) as Date | null;
    }
    return nextAvailabilityStart(task, now) as Date | null;
  }

  const available = toDate(task.availableFrom);
  if (!available) return null;

  let projected = available;
  if (respectSleep && sleep.sleeping) {
    if (sleep.indefinite) return null;
    if (sleep.until > projected) projected = sleep.until;
  }

  const latestStart = toDate(task.latestStart);
  if (latestStart && projected > latestStart) return null;
  return projected;
}

export function projectedStartBypassesSleep(task: Task, start: Date, now: Date, respectSleep: boolean) {
  if (respectSleep) return false;
  const sleep = sleepInfo(task, now);
  return isSleeping(task, now) && (sleep.indefinite || start < sleep.until);
}
