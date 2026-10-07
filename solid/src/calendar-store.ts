import { createSignal, onCleanup } from "solid-js";
import {
  canRedo,
  canUndo,
  deleteItem,
  exportData,
  getItem,
  historyBatch,
  importData,
  listItems,
  parseBackup,
  putItem,
  putItemWithoutUndo,
  readRawStoredBytes,
  redo,
  resetStoredDocument,
  redoLabel,
  undo,
  undoLabel,
} from "../../site/storage.js";
import { startedTask } from "./dependencies";
import { advancedTask } from "./repeats";
import { boardLayoutPatches, type BoardLayout } from "./board-order";
import { boardTasks, deleteBoardPatches, taskPlacePatches } from "./boards";
import { completedTask, dependentGroupId, liftedTask, reopenedTask, newGroup, newTask, newWindow, patchedItem, pushedTask } from "./item-changes";
import { sameClockIn } from "./zone";
import type { CalendarEvent, CalendarSettings, Group, Item, Task, TimeWindow } from "./types";

export const SETTINGS_ID = "settings";

export type HistoryState = { canUndo: boolean; canRedo: boolean; undoLabel: string; redoLabel: string };

/**
 * The calendar's items and every change to them. Each change is saved locally, the items are
 * reloaded, and `onChanged` runs (the app uses it to sync). Failures are thrown for the UI to report.
 */
export function createCalendarStore(options: { onChanged: () => void }) {
  const [items, setItems] = createSignal<Item[]>([]);
  const readHistory = (): HistoryState => ({ canUndo: canUndo(), canRedo: canRedo(), undoLabel: undoLabel(), redoLabel: redoLabel() });
  const [history, setHistory] = createSignal<HistoryState>(readHistory());
  const onHistory = (event: Event) => {
    const detail = (event as CustomEvent<Partial<HistoryState>>).detail || {};
    setHistory({ canUndo: detail.canUndo ?? canUndo(), canRedo: detail.canRedo ?? canRedo(), undoLabel: detail.undoLabel ?? undoLabel(), redoLabel: detail.redoLabel ?? redoLabel() });
  };
  window.addEventListener("calendar:history-state", onHistory);
  onCleanup(() => window.removeEventListener("calendar:history-state", onHistory));

  const refresh = async () => { const next = await listItems(); setItems([...next]); };
  const changed = async () => { await refresh(); options.onChanged(); };
  // Reload even after a failure: part of a batch may have been saved.
  const change = async <T>(run: () => Promise<T>): Promise<T> => {
    try { return await run(); }
    finally { await changed(); }
  };
  const batch = <T>(label: string, run: () => Promise<T>) => change(() => historyBatch(label, run));
  const patchGroup = (group: Group, patch: Partial<Group>) => putItem(patchedItem(group, patch, new Date()), group);
  // Dependent tasks that start by themselves: when their parent is done, or on a "Not yet"
  // on it on or after their date (optionally finishing the parent then).
  const startFollowUps = async (owner: Task, event: "done" | "not-yet", now: Date) => {
    for (const task of items()) {
      if (task.kind !== "task" || task.dependentOf !== owner.id || task.state === "completed" || !task.startWhen) continue;
      const when = task.startWhen;
      const fires = when.on === "parent-done" ? event === "done" : event === "not-yet" && (!when.after || now >= new Date(when.after));
      if (!fires) continue;
      await putItem(startedTask(task, now), task);
      if (when.on === "not-yet" && task.stopParent !== false) {
        const current = await getItem(owner.id);
        if (current?.kind === "task" && current.state !== "completed") await putItem({ ...completedTask(current, now), history: [...(current.history || []), { at: now.toISOString(), type: "completed", byFollowUp: task.id }] }, current);
      }
    }
  };

  // Unsaved editor text that the board renders immediately (before the debounced save).
  const [liveEdits, setLiveEdits] = createSignal(new Map<string, Partial<Task>>());
  const setLiveEdit = (id: string, patch: Partial<Task> | null) => setLiveEdits(current => {
    const next = new Map(current);
    if (patch) next.set(id, { ...next.get(id), ...patch });
    else next.delete(id);
    return next;
  });

  return {
    items,
    history,
    refresh,
    getItem,
    liveEdits,
    setLiveEdit,

    saveItem: (item: Item, baseline: Item | null) => change(() => putItem(item, baseline)),
    deleteItem: (id: string) => change(() => deleteItem(id)),

    addTask: (groupId: string | null, title: string, extra: Partial<Task> = {}) => change(() => putItem(newTask({ ...extra, title, groupId }, new Date()))),
    addSubtask: (parent: Task, title: string) => change(() => putItem(newTask({ title, parentId: parent.id }, new Date()))),
    addDependent: (parent: Task, title: string) => change(() => putItem(newTask({ title, dependentOf: parent.id, groupId: dependentGroupId(items(), parent) }, new Date()))),
    patchTask: (task: Task, patch: Partial<Task>) => change(() => putItem(patchedItem(task, patch, new Date()), task)),
    /** Finished for good (for a check-in, "It happened"); dependent tasks set to start then do. */
    completeTask: (task: Task) => batch(`Complete “${task.title}”`, async () => {
      const now = new Date();
      await putItem(completedTask(task, now), task);
      await startFollowUps(task, "done", now);
    }),
    /** A repeating task's occurrence done, or a check-in's "Not yet": it moves to its next occurrence. */
    advanceTask: (task: Task, type: "occurrence-done" | "not-yet") => batch(type === "not-yet" ? `“Not yet” for “${task.title}”` : `Done for now: “${task.title}”`, async () => {
      const now = new Date();
      await putItem(advancedTask(task, now, { type }), task);
      if (type === "not-yet") await startFollowUps(task, "not-yet", now);
    }),
    reopenTask: (task: Task) => change(() => putItem(reopenedTask(task, new Date()), task)),
    pushDown: (task: Task, until: Date | null) => change(() => putItem(pushedTask(task, until, new Date()), task)),
    lift: (task: Task) => change(() => putItem(liftedTask(task, new Date()), task)),

    createWindow: async (fields: Pick<TimeWindow, "title" | "days" | "start" | "end">) => {
      const window = newWindow(fields, new Date());
      await change(() => putItem(window));
      return window.id;
    },
    updateWindow: (window: TimeWindow, patch: Partial<Pick<TimeWindow, "title" | "days" | "start" | "end">>) => change(() => putItem(patchedItem(window, patch, new Date()), window)),
    /** Tasks in a deleted window become doable any time; one undo restores both. */
    deleteWindow: (window: TimeWindow) => batch(`Delete window “${window.title}”`, async () => {
      for (const task of items()) if (task.kind === "task" && task.windowId === window.id) await putItem(patchedItem(task, { windowId: null }, new Date()), task);
      await deleteItem(window.id);
    }),
    // Starting a dependent task detaches it with fixed dates; optionally its parent task is completed in the same undo step.
    startDependent: async (task: Task, completeParent: boolean) => {
      const now = new Date();
      const parent = items().find((item): item is Task => item.kind === "task" && item.id === task.dependentOf);
      const closing = completeParent && parent && parent.state !== "completed" ? parent : null;
      await batch(`Start “${task.title}”`, async () => {
        await putItem(startedTask(task, now), task);
        if (closing) await putItem(completedTask(closing, now), closing);
      });
      return { completed: closing };
    },

    createGroup: async (title: string) => {
      const group = newGroup({ title }, new Date());
      await batch(`Add board “${title}”`, () => putItem(group));
      return group.id;
    },
    renameGroup: (group: Group, title: string) => batch("Rename board", () => patchGroup(group, { title })),
    /** Arrange the Boards view's boards (built-in ones included) as in this layout, in one undo step. */
    layoutBoards: async (layout: BoardLayout) => {
      const patches = boardLayoutPatches(items(), layout);
      if (patches.length) await batch("Reorder boards", async () => {
        for (const { group, patch, create } of patches) await (create ? putItem({ ...group, ...patch }) : patchGroup(group, patch));
      });
    },
    /** Turn a task into a dormant dependent of another task (un-nests it if it was a subtask). */
    makeDependent: (task: Task, owner: Task) => batch("Make dependent", () =>
      putItem(patchedItem(task, { parentId: null, dependentOf: owner.id, groupId: dependentGroupId(items(), owner) }, new Date()), task)),

    /** Nest as a task's last subtask, or move to the top level of a board (null: no board). */
    moveTask: (task: Task, target: { parent: Task } | { groupId: string | null }) => batch("Move task", async () => {
      const patches = "parent" in target ? taskPlacePatches(items(), task, target.parent.id, null) : taskPlacePatches(items(), task, null, target.groupId);
      for (const { task: item, patch } of patches) await putItem(patchedItem(item, patch, new Date()), item);
    }),

    /** Delete a board with its tasks, or leave them on no board. */
    deleteGroup: (group: Group, withTasks: boolean) => batch(withTasks ? `Delete board “${group.title}” and its tasks` : `Delete board “${group.title}”`, async () => {
      // Deleting a task takes its subtasks and dependent tasks with it (and skips one already gone).
      // Whatever stays (finished tasks, or all of them) is left on no board.
      const doomed = withTasks ? boardTasks(items(), group) : [];
      const gone = new Set(doomed.map(task => task.id));
      const patches = deleteBoardPatches(items(), group).filter(({ task }) => !gone.has(task.id));
      for (const task of doomed) await deleteItem(task.id);
      for (const { task, patch } of patches) await putItem(patchedItem(task, patch, new Date()), task);
      await deleteItem(group.id);
    }),

    /** The calendar's settings, set up once (not an edit, so not undoable). */
    createSettings: (timeZone: string) => {
      const at = new Date().toISOString();
      const settings: CalendarSettings = { id: SETTINGS_ID, kind: "settings", title: "Settings", timeZone, eventReminderMinutes: 30, createdAt: at, updatedAt: at };
      return change(() => putItemWithoutUndo(settings));
    },
    /** What new events' reminders start as (minutes before; null: none). */
    changeEventReminderDefault: (settings: CalendarSettings, minutes: number | null) => batch("Change new events' reminder", async () => {
      await putItem(patchedItem(settings, { eventReminderMinutes: minutes }, new Date()), settings);
    }),
    /**
     * A new calendar time zone. With `keepClock`, task and event dates move so they read the
     * same clock time in the new zone (9 AM stays 9 AM); otherwise they stay the same moments.
     * Records of when things happened (completed, created, history) never move.
     */
    changeTimeZone: (settings: CalendarSettings, timeZone: string, keepClock: boolean) => batch("Change time zone", async () => {
      const from = settings.timeZone, now = new Date();
      const move = (value?: string | null) => value ? sameClockIn(new Date(value), from, timeZone).toISOString() : value;
      if (keepClock) for (const item of items()) {
        if (item.kind === "task") {
          const patch: Partial<Task> = {};
          if (item.availableFrom) patch.availableFrom = move(item.availableFrom);
          if (item.deadline) patch.deadline = move(item.deadline);
          if (item.pushedDown?.until) patch.pushedDown = { ...item.pushedDown, until: move(item.pushedDown.until)! };
          if (item.repeat?.until) patch.repeat = { ...item.repeat, until: move(item.repeat.until)! };
          if (item.startWhen?.on === "not-yet" && item.startWhen.after) patch.startWhen = { on: "not-yet", after: move(item.startWhen.after)! };
          if (Object.keys(patch).length) await putItem(patchedItem(item, patch, now), item);
        } else if (item.kind === "event" && (item.start || item.end)) {
          await putItem(patchedItem(item, { start: move(item.start), end: move(item.end) } as Partial<CalendarEvent>, now), item);
        }
      }
      await putItem(patchedItem(settings, { timeZone }, now), settings);
    }),

    /** Returns the label of the undone change, or null when there was nothing to undo. */
    undo: async () => { const label = undoLabel(); if (!(await undo())) return null; await changed(); return label; },
    redo: async () => { const label = redoLabel(); if (!(await redo())) return null; await changed(); return label; },

    exportBackup: exportData,
    /** How a backup would change the calendar, without applying it. */
    previewImport: async (text: string) => {
      const incoming = parseBackup(text);
      const ids = new Set((await listItems()).map(item => item.id));
      const updated = incoming.filter(item => ids.has(item.id)).length;
      return { added: incoming.length - updated, updated };
    },
    importBackup: (text: string) => change(() => importData(text)),
    /** Remove every item whose id starts with the prefix (the sample tasks) in one undoable step. */
    removeByPrefix: (prefix: string, label: string) => batch(label, async () => {
      // Tasks first (a task takes its subtasks with it), then the windows and groups they used.
      const doomed = items().filter(item => item.id.startsWith(prefix)).sort((a, b) => Number(a.kind !== "task") - Number(b.kind !== "task"));
      for (const item of doomed) await deleteItem(item.id);
    }),
    /** For storage that can't be read: its raw bytes to keep, then an empty calendar. */
    readRawBytes: readRawStoredBytes,
    reset: async () => { await resetStoredDocument(); await refresh(); },
  };
}

export type CalendarStore = ReturnType<typeof createCalendarStore>;
