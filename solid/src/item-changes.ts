import { toDate } from "../../site/domain.js";
import { addDays } from "./zone";
import type { RelativeDateField } from "./dependencies";
import type { Attachment, CalendarEvent, Group, HistoryEntry, Item, PushedDown, Task, TaskState, TimeWindow } from "./types";
import type { RelativeDates } from "../../site/model";

// Pure record changes: each takes the current record and a moment and returns the record to store.

const withEntry = (task: Task | null, entry: HistoryEntry) => [...(task?.history || []), entry];

export function newTask(fields: Pick<Task, "title"> & Partial<Omit<Task, "id" | "kind" | "createdAt" | "updatedAt">>, now: Date): Task {
  const at = now.toISOString();
  return { id: crypto.randomUUID(), kind: "task", state: "open", tags: [], attachments: [], ...fields, title: fields.title.trim(), history: [{ at, type: "created" }], createdAt: at, updatedAt: at };
}

export function newGroup(fields: Pick<Group, "title"> & Partial<Pick<Group, "sortOrder">>, now: Date): Group {
  const at = now.toISOString();
  return { id: crypto.randomUUID(), kind: "group", ...fields, createdAt: at, updatedAt: at };
}

export function newWindow(fields: Pick<TimeWindow, "title" | "days" | "start" | "end">, now: Date): TimeWindow {
  const at = now.toISOString();
  return { id: crypto.randomUUID(), kind: "window", ...fields, createdAt: at, updatedAt: at };
}

export function completedTask(task: Task, now: Date): Task {
  const at = now.toISOString();
  return { ...task, state: "completed", completedAt: at, pushedDown: null, updatedAt: at, history: withEntry(task, { at, type: "completed" }) };
}

export function reopenedTask(task: Task, now: Date): Task {
  const at = now.toISOString();
  return { ...task, state: "open", completedAt: null, updatedAt: at, history: withEntry(task, { at, type: "reopened" }) };
}

/** Moved to the bottom of its section until a time, or until lifted (null). */
export function pushedTask(task: Task, until: Date | null, now: Date): Task {
  const at = now.toISOString(), to = until?.toISOString() ?? null;
  return { ...task, pushedDown: { until: to, at }, updatedAt: at, history: withEntry(task, { at, type: "pushed-down", until: to }) };
}

export function liftedTask(task: Task, now: Date): Task {
  const at = now.toISOString();
  return { ...task, pushedDown: null, updatedAt: at, history: withEntry(task, { at, type: "lifted" }) };
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
  warnHours: number | null;
  repeat?: Task["repeat"];
  // A dormant dependent task's automatic start, and whether it finishes its parent.
  startWhen?: Task["startWhen"];
  stopParent?: boolean;
  windowId: string | null;
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
  const since = task?.pushedDown?.at || at;
  const previousUntil = task?.pushedDown ? task.pushedDown.until : undefined;
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
    // A subtask with no board of its own follows its parent's.
    groupId: draft.groupId,
    completedAt: closed ? task?.completedAt || at : null,
    tags: draft.tags,
    attachments: draft.attachments,
    dependentOf: dormant ? task!.dependentOf : null,
    relativeDates: dormant && Object.keys(relativeDates).length ? relativeDates : null,
    ...(draft.repeat !== undefined ? { repeat: draft.repeat } : {}),
    ...(dormant && draft.startWhen !== undefined ? { startWhen: draft.startWhen, stopParent: draft.startWhen?.on === "not-yet" ? draft.stopParent ?? true : null } : {}),
    availableFrom: draft.availableFrom,
    deadline: draft.deadline,
    warnHours: draft.deadline ? draft.warnHours : null,
    pushedDown,
    windowId: draft.windowId,
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
    end = addDays(toDate(start)!, 1).toISOString();
  } else if (!start && end) {
    start = addDays(toDate(end)!, -1).toISOString();
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
