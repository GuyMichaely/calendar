import { actionability, nextActionableStart, sleepInfo, toDate } from "../../site/domain.js";
import { isDormant } from "./dependencies";
import { byOrder } from "./group-board";
import type { Item, Task } from "./types";

export const TODO_SECTIONS = [
  { id: "attention", title: "Needs Attention", description: "Due today or overdue", empty: "Nothing due today." },
  { id: "open", title: "Open Now", description: "Closing soonest first · manual order breaks ties", empty: "No action windows are open." },
  { id: "today", title: "Today", description: "Started today", empty: "No other tasks starting today." },
  { id: "upcoming", title: "Upcoming", description: "Waiting for a start, action window, or wake time", empty: "Nothing waiting." },
  { id: "anytime", title: "Anytime", description: "Ongoing work, at your pace", empty: "No anytime tasks." },
] as const;
export type TodoSection = typeof TODO_SECTIONS[number]["id"];
export type TodoRow = { task: Task; section: TodoSection; relevantToday: boolean; windowEnd: number | null; next: Date | null; reason: string; due: string };
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const time = (d: Date) => d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const day = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
const when = (d: Date, now: Date) => `${sameDay(d, now) ? "today" : day(d)} at ${time(d)}`;

/** Pure projection: moving the clock never writes task data or changes user priority. */
export function planTodos(items: Item[], now: Date, respectSleep = true, hideSleeping = false) {
  const byId = new Map(items.map(item => [item.id, item]));
  const endToday = new Date(now); endToday.setHours(23, 59, 59, 999);
  const rows: TodoRow[] = [];
  for (const task of items) {
    if (task.kind !== "task" || task.state === "completed" || isDormant(task, byId)) continue;
    const sleep = sleepInfo(task, now);
    if (hideSleeping && sleep.sleeping) continue;
    const starts = toDate(task.availableFrom), deadline = toDate(task.deadline);
    const next = nextActionableStart(task, now, { respectSleep });
    const ready = actionability(task, now).actionable && !(respectSleep && sleep.sleeping);
    const schedule = task.availabilitySchedule;
    let windowEnd: number | null = null;
    if (ready && schedule?.enabled) {
      const [h, m] = schedule.end.split(":").map(Number);
      const end = new Date(now); end.setHours(h, m, 59, 999); windowEnd = end.getTime();
    }
    const dueToday = !!deadline && deadline <= endToday;
    const startsToday = !!starts && sameDay(starts, now);
    const windowToday = !!schedule?.enabled && !!next && sameDay(next, now);
    // A hard deadline stays visible even when the task cannot currently be acted on.
    const section: TodoSection = dueToday ? "attention" : !ready ? "upcoming" : windowEnd !== null ? "open" : startsToday ? "today" : "anytime";
    const reason = ready ? windowEnd !== null ? `Open until ${time(new Date(windowEnd))}` : startsToday ? `Started today at ${time(starts!)}` : ""
      : respectSleep && sleep.sleeping && sleep.indefinite ? "Sleeping indefinitely"
      : next ? `${respectSleep && sleep.sleeping ? "Sleeping · available" : "Available"} ${when(next, now)}`
      : actionability(task, now).reason;
    const due = !deadline ? "" : deadline < now ? `Overdue · ${day(deadline)}${sameDay(deadline, now) ? `, ${time(deadline)}` : ""}` : sameDay(deadline, now) ? `Due today · ${time(deadline)}` : `Due ${day(deadline)}`;
    rows.push({ task, section, relevantToday: dueToday || startsToday || windowToday, windowEnd, next, reason, due });
  }
  const sectionOrder = TODO_SECTIONS.map(section => section.id);
  rows.sort((a, b) => sectionOrder.indexOf(a.section) - sectionOrder.indexOf(b.section)
    || (a.section === "open" ? a.windowEnd! - b.windowEnd! : 0) || byOrder(a.task, b.task));
  return rows;
}

/** Reordering a timing view changes priority only, never parent/group membership. */
export function priorityOrder(tasks: Task[], id: string, refId: string, before: boolean) {
  const ordered = [...tasks].sort(byOrder).filter(task => task.id !== id);
  const task = tasks.find(task => task.id === id), index = ordered.findIndex(task => task.id === refId);
  if (!task || index < 0 || id === refId) return [];
  ordered.splice(index + (before ? 0 : 1), 0, task);
  return ordered.map((task, sortOrder) => ({ task, sortOrder }));
}
