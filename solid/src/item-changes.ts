import { toDate } from "../../site/domain.js";
import type { RelativeDateField } from "./dependencies";
import type { Attachment, AvailabilitySchedule, CalendarEvent, Group, HistoryEntry, Item, PushedDown, Task, TaskState, TimeWindow } from "./types";
import type { RelativeDates } from "../../site/model";

// Pure record changes: each takes the current record and a moment and returns the record to store.

const withEntry = (task: Task | null, entry: HistoryEntry) => [...(task?.history || []), entry];

export function newTask(fields: Pick<Task, "title"> & Partial<Omit<Task, "id" | "kind" | "createdAt" | "updatedAt">>, now: Date): Task {
  const at = now.toISOString();
  return { id: crypto.randomUUID(), kind: "task", state: "open", tags: [], attachments: [], ...fields, title: fields.title.trim(), history: [{ at, type: "created" }], createdAt: at, updatedAt: at };
}

export function newGroup(fields: Pick<Group, "title"> & Partial<Pick<Group, "parentId" | "sortOrder" | "boardColumn">>, now: Date): Group {
  const at = now.toISOString();
  return { id: crypto.randomUUID(), kind: "group", ...fields, createdAt: at, updatedAt: at };
}

export function newWindow(fields: Pick<TimeWindow, "title" | "days" | "start" | "end">, now: Date): TimeWindow {
  const at = now.toISOString();
  return { id: crypto.randomUUID(), kind: "window", ...fields, createdAt: at, updatedAt: at };
}

export function completedTask(task: Task, now: Date): Task {
  const at = now.toISOString();
  return { ...task, state: "completed", completedAt: at, sleep: null, pushedDown: null, updatedAt: at, history: withEntry(task, { at, type: "completed" }) };
}

/** Moved to the bottom of its section until a time, or until lifted (null). Replaces legacy sleep. */
export function pushedTask(task: Task, until: Date | null, now: Date): Task {
  const at = now.toISOString(), to = until?.toISOString() ?? null;
  return { ...task, sleep: null, pushedDown: { until: to, at }, updatedAt: at, history: withEntry(task, { at, type: "pushed-down", until: to }) };
}

export function liftedTask(task: Task, now: Date): Task {
  const at = now.toISOString();
  return { ...task, sleep: null, pushedDown: null, updatedAt: at, history: withEntry(task, { at, type: "lifted" }) };
}

export function patchedItem<T extends Item>(item: T, patch: Partial<T>, now: Date): T {
  return { ...item, ...patch, updatedAt: now.toISOString() };
}

/** A dependent task starts in the group of its parent task, or of that task's top-level ancestor. */
export function dependentGroupId(items: Item[], parent: Task): string | null {
  let top = parent;
  for (let next = items.find(item => item.id === top.parentId); next?.kind === "task"; next = items.find(item => item.id === top.parentId)) top = next;
  return top.groupId ?? null;
}

// What the item editor collects; dates are ISO strings or null.
export type TaskDraft = {
  title: string;
  notes: string;
  tags: string[];
  attachments: Attachment[];
  state: TaskState;
  pushedDown: { mode: "normal" | "indefinite" } | { mode: "until"; until: string | null };
  groupId: string | null;
  availableFrom: string | null;
  deadline: string | null;
  warnAt: string | null;
  windowId: string | null;
  // Legacy inline hours, kept while no named window replaces them.
  schedule: AvailabilitySchedule | null;
  takes: number | null;
  anytime: boolean;
  // Only a top task with subtasks sets this; undefined keeps whatever it had.
  subtaskLayout?: Task["subtaskLayout"];
  // Days after starting, for the fields a dormant dependent task measures that way.
  relativeDates: Partial<Record<RelativeDateField, number>>;
};

export type EventDraft = {
  title: string;
  notes: string;
  tags: string[];
  attachments: Attachment[];
  start: string | null;
  end: string | null;
};

type DraftContext = {
  id: string;
  // The stored item being edited, which may be of the other kind when the editor switched it.
  previous: Item | null;
  now: Date;
};

/** The task an editor draft describes. A subtask stays in its parent's group; only a dormant dependent task keeps relative dates. */
export function taskFromDraft(draft: TaskDraft, { id, previous, now, parentId, dormant }: DraftContext & { parentId?: string | null; dormant: boolean }): Task {
  const at = now.toISOString();
  const task = previous?.kind === "task" ? previous : null;
  const closed = draft.state === "completed";
  // Legacy sleep becomes pushed down the first time the task is saved here.
  const since = task?.pushedDown?.at || task?.sleep?.startedAt || at;
  const previousUntil = task?.pushedDown ? task.pushedDown.until : task?.sleep ? task.sleep.until : undefined;
  let pushedDown: PushedDown | null = null;
  if (!closed && draft.pushedDown.mode === "indefinite") pushedDown = { until: null, at: since };
  else if (!closed && draft.pushedDown.mode === "until" && draft.pushedDown.until && toDate(draft.pushedDown.until)! > now) pushedDown = { until: draft.pushedDown.until, at: since };

  const history = [...(task?.history || [{ at, type: "created" }])];
  const before = previousUntil === undefined ? "normal" : `pushed until ${previousUntil}`;
  const after = pushedDown ? `pushed until ${pushedDown.until}` : "normal";
  if (task && before !== after) history.push({ at, type: pushedDown ? "pushed-down" : "lifted", until: pushedDown?.until ?? null });
  if (task && task.state !== draft.state) history.push({ at, type: closed ? "completed" : "reopened" });

  const parent = task?.parentId || parentId || null;
  const relativeDates: RelativeDates = { ...draft.relativeDates };
  return {
    ...(task || {}),
    id,
    kind: "task",
    title: draft.title,
    notes: draft.notes,
    state: draft.state,
    parentId: parent,
    groupId: parent ? task?.groupId ?? null : draft.groupId,
    completedAt: closed ? task?.completedAt || at : null,
    tags: draft.tags,
    attachments: draft.attachments,
    dependentOf: dormant ? task!.dependentOf : null,
    relativeDates: dormant && Object.keys(relativeDates).length ? relativeDates : null,
    availableFrom: draft.availableFrom,
    deadline: draft.deadline,
    warnAt: draft.deadline ? draft.warnAt : null,
    sleep: null,
    pushedDown,
    windowId: draft.windowId,
    availabilitySchedule: draft.windowId ? null : draft.schedule,
    takes: draft.takes,
    anytime: draft.anytime || null,
    ...(draft.subtaskLayout !== undefined ? { subtaskLayout: draft.subtaskLayout } : {}),
    createdAt: previous?.createdAt || at,
    updatedAt: at,
    history,
  };
}

/** The event an editor draft describes. With only one end chosen, the event lasts a day. */
export function eventFromDraft(draft: EventDraft, { id, previous, now }: DraftContext): CalendarEvent {
  const at = now.toISOString();
  let { start, end } = draft;
  if (start && !end) {
    const derived = toDate(start)!;
    derived.setDate(derived.getDate() + 1);
    end = derived.toISOString();
  } else if (!start && end) {
    const derived = toDate(end)!;
    derived.setDate(derived.getDate() - 1);
    start = derived.toISOString();
  }
  return {
    ...(previous?.kind === "event" ? previous : {}),
    id,
    kind: "event",
    title: draft.title,
    notes: draft.notes,
    tags: draft.tags,
    attachments: draft.attachments,
    start,
    end,
    createdAt: previous?.createdAt || at,
    updatedAt: at,
  };
}
