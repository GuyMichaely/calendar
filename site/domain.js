export const TASK_STATES = ["open", "waiting", "completed", "canceled"];

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

export function isEffectivelyWaiting(task, now = new Date()) {
  if (task.state !== "waiting") return false;
  const wake = toDate(task.wakeAt);
  return !wake || wake > now;
}

export function withinAvailabilitySchedule(task, now = new Date()) {
  const schedule = task.availabilitySchedule;
  if (!schedule?.enabled) return true;

  const days = Array.isArray(schedule.days) ? schedule.days : [];
  if (!days.includes(now.getDay())) return false;

  const minutes = now.getHours() * 60 + now.getMinutes();
  const [startHour = 0, startMinute = 0] = String(schedule.start || "00:00")
    .split(":")
    .map(Number);
  const [endHour = 23, endMinute = 59] = String(schedule.end || "23:59")
    .split(":")
    .map(Number);
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

  const wake = toDate(task.wakeAt);
  if (task.state === "waiting" && (!wake || wake > now)) {
    return {
      actionable: false,
      reason: wake ? `Waiting until ${formatRelativeDateTime(wake, now)}` : "Waiting",
    };
  }

  const latestStart = toDate(task.latestStart);
  if (latestStart && latestStart < now) {
    return { actionable: false, reason: "Latest start has passed" };
  }

  if (!withinAvailabilitySchedule(task, now)) {
    return { actionable: false, reason: "Outside action window" };
  }

  return { actionable: true, reason: task.state === "waiting" ? "Ready again" : "Can do now" };
}

export function taskMatchesFilter(task, filter, now = new Date()) {
  if (!isTask(task)) return false;
  const state = task.state || "open";

  switch (filter) {
    case "now":
      return actionability(task, now).actionable;
    case "waiting":
      return isEffectivelyWaiting(task, now);
    case "due": {
      if (["completed", "canceled"].includes(state)) return false;
      const deadline = toDate(task.deadline);
      if (!deadline) return false;
      const horizon = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      return deadline <= horizon;
    }
    case "ongoing":
      return !["completed", "canceled"].includes(state) && !task.deadline;
    case "completed":
      return state === "completed";
    case "all":
    default:
      return !["completed", "canceled"].includes(state);
  }
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
