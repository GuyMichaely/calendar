import { formatDateTime, nextActionableStart, sleepInfo } from "../../site/domain.js";
import type { Task } from "./types";

export function friendlyWhen(date: Date | null, now = new Date()) {
  if (!date) return "";
  const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const days = Math.round((target.getTime() - today.getTime()) / 86400000);
  if (days === 0) return `today · ${time}`;
  if (days === 1) return `tomorrow · ${time}`;
  if (days > 1 && days < 7) {
    return `${new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(date)} · ${time}`;
  }
  return `${new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date)} · ${time}`;
}

export function availabilitySummary(task: Task, now: Date, upcomingAt: Date | null | undefined, showAvailability: boolean) {
  if (!showAvailability) return "";
  const sleep = sleepInfo(task, now);
  const next = upcomingAt || nextActionableStart(task, now, { respectSleep: sleep.sleeping });
  if (sleep.sleeping && sleep.indefinite) return "Sleeping indefinitely";
  if (sleep.sleeping) {
    const sameMoment = next && Math.abs(next.getTime() - sleep.until.getTime()) < 60000;
    if (sameMoment || !next) return `Sleeping until ${friendlyWhen(sleep.until, now)}`;
    return `Sleeping until ${friendlyWhen(sleep.until, now)} · available ${friendlyWhen(next, now)}`;
  }
  return next ? `Available ${friendlyWhen(next, now)}` : "";
}

export function taskTiming(task: Task, now: Date, showAvailability: boolean) {
  const sleep = sleepInfo(task, now);
  const values: string[] = [];
  if (!showAvailability && task.availableFrom) values.push(`Starts ${formatDateTime(task.availableFrom)}`);
  if (task.deadline) values.push(`Due ${formatDateTime(task.deadline)}`);
  if (task.latestStart) values.push(`Latest start ${formatDateTime(task.latestStart)}`);
  if (!showAvailability && sleep.sleeping) {
    values.push(sleep.indefinite ? "Sleeping indefinitely" : `Sleeping until ${formatDateTime(sleep.until)}`);
  }

  const schedule = task.availabilitySchedule;
  if (schedule?.enabled) {
    const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const days = (schedule.days || []).map((day) => names[day]).join(", ");
    values.push(`${days || "No days"} ${schedule.start || ""}-${schedule.end || ""}`);
  }
  return values;
}
