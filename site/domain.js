export const TASK_STATES = ["open", "completed", "canceled"];

export function isTask(item) {
  return item?.kind === "task";
}

export function isEvent(item) {
  return item?.kind === "event";
}

export function toDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function withinAvailabilitySchedule(task, now = new Date()) {
  const schedule = task.availabilitySchedule;
  if (!schedule?.enabled) return true;

  const days = Array.isArray(schedule.days) ? schedule.days : [];
  if (!days.includes(now.getDay())) return false;

  const minutes = now.getHours() * 60 + now.getMinutes();
  const [startHour = 0, startMinute = 0] = String(schedule.start || "00:00").split(":").map(Number);
  const [endHour = 23, endMinute = 59] = String(schedule.end || "23:59").split(":").map(Number);
  const start = startHour * 60 + startMinute;
  const end = endHour * 60 + endMinute;
  return minutes >= start && minutes <= end;
}

export function actionability(task, now = new Date()) {
  if (!isTask(task)) return { actionable: false, reason: "Not a task" };
  if (["completed", "canceled"].includes(task.state)) {
    return { actionable: false, reason: task.state === "completed" ? "Completed" : "Canceled" };
  }

  const available = toDate(task.availableFrom);
  if (available && available > now) {
    return { actionable: false, reason: `Available ${formatRelativeDateTime(available, now)}` };
  }

  const latestStart = toDate(task.latestStart);
  if (latestStart && latestStart < now) {
    return { actionable: false, reason: "Latest start has passed" };
  }

  if (!withinAvailabilitySchedule(task, now)) {
    return { actionable: false, reason: "Outside action window" };
  }

  return { actionable: true, reason: "Can do now" };
}

function sameLocalDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function availabilityEndForDate(task, date) {
  const schedule = task.availabilitySchedule;
  if (!schedule?.enabled) return null;
  const day = date instanceof Date ? new Date(date) : toDate(date);
  if (!day || !(schedule.days || []).includes(day.getDay())) return null;

  const [endHour = 23, endMinute = 59] = String(schedule.end || "23:59").split(":").map(Number);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), endHour, endMinute, 59, 999);
}

function rawAvailabilityStartForDate(task, date) {
  if (!isTask(task) || ["completed", "canceled"].includes(task.state)) return null;
  const schedule = task.availabilitySchedule;
  if (!schedule?.enabled) return null;

  const day = date instanceof Date ? new Date(date) : toDate(date);
  if (!day || !(schedule.days || []).includes(day.getDay())) return null;

  const [startHour = 0, startMinute = 0] = String(schedule.start || "00:00").split(":").map(Number);
  let start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), startHour, startMinute, 0, 0);
  const end = availabilityEndForDate(task, day);
  const endOfDay = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59, 59, 999);

  const available = toDate(task.availableFrom);
  if (available && available > endOfDay) return null;
  if (available && sameLocalDay(available, day) && available > start) start = available;

  const latestStart = toDate(task.latestStart);
  if (latestStart && latestStart < start) return null;
  if (!end || start > end) return null;

  return start;
}

export function nextAvailabilityStart(task, now = new Date()) {
  if (!isTask(task) || ["completed", "canceled"].includes(task.state)) return null;
  const schedule = task.availabilitySchedule;
  if (!schedule?.enabled || !(schedule.days || []).length) return null;

  let earliest = new Date(now);
  const available = toDate(task.availableFrom);
  if (available && available > earliest) earliest = available;

  const cursor = new Date(earliest.getFullYear(), earliest.getMonth(), earliest.getDate(), 0, 0, 0, 0);
  for (let offset = 0; offset < 14; offset += 1) {
    const day = new Date(cursor);
    day.setDate(cursor.getDate() + offset);
    const start = rawAvailabilityStartForDate(task, day);
    if (!start) continue;

    const end = availabilityEndForDate(task, day);
    if (sameLocalDay(day, now) && end && now > end) continue;
    return start;
  }

  return null;
}

export function sleepInfo(task, now = new Date()) {
  if (!isTask(task) || ["completed", "canceled"].includes(task.state) || !task.sleep) {
    return { sleeping: false, indefinite: false, until: null };
  }

  if (!task.sleep.until) return { sleeping: true, indefinite: true, until: null };

  const until = toDate(task.sleep.until);
  if (!until || until <= now) return { sleeping: false, indefinite: false, until: null };
  return { sleeping: true, indefinite: false, until };
}

export function isSleeping(task, now = new Date()) {
  return sleepInfo(task, now).sleeping;
}

export function nextActionableStart(task, now = new Date(), { respectSleep = false } = {}) {
  if (!isTask(task) || ["completed", "canceled"].includes(task.state)) return null;

  if (respectSleep) {
    const sleep = sleepInfo(task, now);
    if (sleep.sleeping) {
      if (sleep.indefinite) return null;
      return nextActionableStart(task, sleep.until, { respectSleep: false });
    }
  }

  if (actionability(task, now).actionable) return new Date(now);

  const latestStart = toDate(task.latestStart);
  if (latestStart && latestStart < now) return null;

  if (task.availabilitySchedule?.enabled) return nextAvailabilityStart(task, now);

  const available = toDate(task.availableFrom);
  if (available && available > now) {
    if (latestStart && available > latestStart) return null;
    return available;
  }

  return null;
}

export function isWaitingForOpportunity(task, now = new Date()) {
  if (!isTask(task) || ["completed", "canceled"].includes(task.state)) return false;
  if (actionability(task, now).actionable) return false;
  const next = nextActionableStart(task, now);
  return !!next && next > now;
}

export function tomorrowMidnight(now = new Date()) {
  const result = new Date(now);
  result.setDate(result.getDate() + 1);
  result.setHours(0, 0, 0, 0);
  return result;
}

export function availabilityStartForDate(task, date, now = new Date(), { respectSleep = false } = {}) {
  const day = date instanceof Date ? new Date(date) : toDate(date);
  if (!day || !task.availabilitySchedule?.enabled) return null;

  if (respectSleep && isSleeping(task, now)) {
    const next = nextActionableStart(task, now, { respectSleep: true });
    return next && sameLocalDay(next, day) ? next : null;
  }

  const next = nextAvailabilityStart(task, now);
  return next && sameLocalDay(next, day) ? next : null;
}

export function isPendingOnDate(task, date) {
  if (!isTask(task) || ["completed", "canceled"].includes(task.state)) return false;

  const day = date instanceof Date ? new Date(date) : toDate(date);
  if (!day) return false;
  const startOfDay = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0, 0);
  const endOfDay = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59, 59, 999);

  const available = toDate(task.availableFrom);
  if (available && available > endOfDay) return false;

  const latestStart = toDate(task.latestStart);
  if (latestStart && latestStart < startOfDay) return false;

  if (task.availabilitySchedule?.enabled) return rawAvailabilityStartForDate(task, day) !== null;

  return true;
}

export function taskMatchesFilter(task, filter, now = new Date()) {
  if (!isTask(task)) return false;
  const state = task.state || "open";

  switch (filter) {
    case "now":
      return actionability(task, now).actionable;
    case "waiting":
      return isWaitingForOpportunity(task, now);
    case "completed":
      return state === "completed";
    case "all":
    default:
      return !["completed", "canceled"].includes(state);
  }
}

export function upcomingHorizonEnd(now = new Date(), horizonDays = 7, mode = "rolling") {
  if (mode !== "boundary") return new Date(now.getTime() + horizonDays * 24 * 60 * 60 * 1000);

  if (horizonDays === 1) {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  }

  if (horizonDays === 7) {
    const daysUntilSaturday = (6 - now.getDay() + 7) % 7;
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysUntilSaturday, 23, 59, 59, 999);
  }

  if (horizonDays === 30) {
    return new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  }

  return new Date(now.getTime() + horizonDays * 24 * 60 * 60 * 1000);
}

export function textMatches(item, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    item.title,
    item.notes,
    ...(Array.isArray(item.tags) ? item.tags : []),
    ...(Array.isArray(item.attachments) ? item.attachments.map((x) => x?.name || x?.url || "") : []),
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
  return haystack.includes(q);
}

export function sortTasks(tasks, now = new Date()) {
  return [...tasks].sort((a, b) => {
    const aa = actionability(a, now).actionable ? 0 : 1;
    const bb = actionability(b, now).actionable ? 0 : 1;
    if (aa !== bb) return aa - bb;

    const ad = toDate(a.deadline)?.getTime() ?? Number.POSITIVE_INFINITY;
    const bd = toDate(b.deadline)?.getTime() ?? Number.POSITIVE_INFINITY;
    if (ad !== bd) return ad - bd;

    return String(a.title || "").localeCompare(String(b.title || ""));
  });
}

export function formatDateTime(value) {
  const d = value instanceof Date ? value : toDate(value);
  if (!d) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: d.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

export function formatRelativeDateTime(value, now = new Date()) {
  const d = value instanceof Date ? value : toDate(value);
  if (!d) return "";
  const sameDay = d.toDateString() === now.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const isTomorrow = d.toDateString() === tomorrow.toDateString();
  const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(d);
  if (sameDay) return `today at ${time}`;
  if (isTomorrow) return `tomorrow at ${time}`;
  return formatDateTime(d);
}

export function isoToLocalInput(value) {
  const d = toDate(value);
  if (!d) return "";
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

export function localInputToIso(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function calendarGridStart(date) {
  const first = startOfMonth(date);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  start.setHours(0, 0, 0, 0);
  return start;
}

export function dateKey(value) {
  const d = value instanceof Date ? value : toDate(value);
  if (!d) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
