import { formatDateTime, sleepInfo, toDate, tomorrowMidnight } from "../../site/domain.js";
import { putItem } from "../../site/storage.js";
import { toStorageValue } from "./persistence";
import type { Task } from "./types";

type Refresh = () => Promise<void>;
type Toast = (message: string) => void;

async function mutateTask(
  task: Task,
  patch: Partial<Task>,
  historyEntry: { type: string; [key: string]: unknown },
  message: string,
  refresh: Refresh,
  toast: Toast,
) {
  const updatedAt = new Date().toISOString();
  await putItem(toStorageValue({
    ...task,
    ...patch,
    updatedAt,
    history: [...(task.history || []), { at: updatedAt, ...historyEntry }],
  }));
  await refresh();
  toast(message);
}

export async function completeTask(task: Task, refresh: Refresh, toast: Toast) {
  const updatedAt = new Date().toISOString();
  await putItem(toStorageValue({
    ...task,
    state: "completed",
    completedAt: updatedAt,
    sleep: null,
    updatedAt,
    history: [...(task.history || []), { at: updatedAt, type: "completed" }],
  }));
  await refresh();
  toast("Task completed");
}

export function sleepTomorrow(task: Task, refresh: Refresh, toast: Toast) {
  const started = new Date();
  const until = tomorrowMidnight(started).toISOString();
  return mutateTask(
    task,
    { sleep: { until, startedAt: task.sleep?.startedAt || started.toISOString() } },
    { type: "slept", until },
    "Sleeping until tomorrow",
    refresh,
    toast,
  );
}

export function sleepIndefinite(task: Task, refresh: Refresh, toast: Toast) {
  const startedAt = new Date().toISOString();
  return mutateTask(
    task,
    { sleep: { until: null, startedAt: task.sleep?.startedAt || startedAt } },
    { type: "slept", until: null },
    "Sleeping indefinitely",
    refresh,
    toast,
  );
}

export function wakeTask(task: Task, refresh: Refresh, toast: Toast) {
  return mutateTask(task, { sleep: null }, { type: "woke" }, "Task is awake", refresh, toast);
}

export async function sleepToWait(task: Task, refresh: Refresh, toast: Toast) {
  const sleep = sleepInfo(task, new Date());
  if (!sleep.sleeping || sleep.indefinite) return;
  const existingStart = toDate(task.availableFrom);
  const waitUntil = existingStart && existingStart > sleep.until ? existingStart : sleep.until;
  await mutateTask(
    task,
    { sleep: null, availableFrom: waitUntil.toISOString() },
    { type: "sleep-converted-to-wait", until: waitUntil.toISOString() },
    "Converted sleep to waiting",
    refresh,
    toast,
  );
}

export async function waitToSleep(task: Task, refresh: Refresh, toast: Toast) {
  const available = toDate(task.availableFrom);
  if (!available || available <= new Date()) return;
  const startedAt = new Date().toISOString();
  await mutateTask(
    task,
    { availableFrom: null, sleep: { until: available.toISOString(), startedAt } },
    { type: "wait-converted-to-sleep", until: available.toISOString() },
    "Converted waiting to sleep",
    refresh,
    toast,
  );
}

export function setTaskSleep(task: Task, until: string | null, refresh: Refresh, toast: Toast) {
  const startedAt = new Date().toISOString();
  return mutateTask(
    task,
    { sleep: { until, startedAt: task.sleep?.startedAt || startedAt } },
    { type: "slept", until },
    until ? `Sleeping until ${formatDateTime(until)}` : "Sleeping indefinitely",
    refresh,
    toast,
  );
}
