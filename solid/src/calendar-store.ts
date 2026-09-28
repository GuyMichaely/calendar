import { demoTasks } from "./demo-tasks";
import { priorityOrder } from "./todo-planning";
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
  redo,
  redoLabel,
  undo,
  undoLabel,
} from "../../site/storage.js";
import { tomorrowMidnight } from "../../site/domain.js";
import { startedTask } from "./dependencies";
import { boardColumns, boardEntries, groupPlacement, layoutPatches, placeGroups as placeInLayout, reorderPatches, taskPlacePatches, taskSiblings, ungroupPatches, type BoardTarget } from "./group-board";
import { completedTask, dependentGroupId, newGroup, newTask, patchedItem, sleptTask, wokenTask } from "./item-changes";
import type { Group, Item, Task } from "./types";

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

    loadDemoTasks: (now = new Date()) => batch("Load demo tasks", async () => {
      const existing = new Set((await listItems()).map(item => item.id));
      const examples = demoTasks(now).filter(item => !existing.has(item.id));
      for (const item of examples) await putItem(item);
      return examples.length;
    }),
    addTask: (groupId: string | null, title: string) => change(() => putItem(newTask({ title, groupId }, new Date()))),
    addSubtask: (parent: Task, title: string) => change(() => putItem(newTask({ title, parentId: parent.id }, new Date()))),
    addDependent: (parent: Task, title: string) => change(() => putItem(newTask({ title, dependentOf: parent.id, groupId: dependentGroupId(items(), parent) }, new Date()))),
    prioritizeTask: (task: Task, ref: Task, before: boolean) => batch("Reorder priority", async () => {
      const tasks = items().filter((item): item is Task => item.kind === "task");
      for (const entry of priorityOrder(tasks, task.id, ref.id, before)) {
        if (entry.task.sortOrder !== entry.sortOrder) await putItem(patchedItem(entry.task, { sortOrder: entry.sortOrder }, new Date()), entry.task);
      }
    }),
    patchTask: (task: Task, patch: Partial<Task>) => change(() => putItem(patchedItem(task, patch, new Date()), task)),
    completeTask: (task: Task) => change(() => putItem(completedTask(task, new Date()), task)),
    sleepTask: (task: Task) => change(() => { const now = new Date(); return putItem(sleptTask(task, tomorrowMidnight(now), now), task); }),
    wakeTask: (task: Task) => change(() => putItem(wokenTask(task, new Date()), task)),
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

    createGroup: async (parentId: string | null) => {
      const group = newGroup({ title: "New group", ...groupPlacement(items(), parentId) }, new Date());
      await change(() => putItem(group));
      return group.id;
    },
    renameGroup: (group: Group, title: string) => batch("Rename group", () => patchGroup(group, { title })),
    moveGroup: (group: Group, parentId: string | null) => batch("Move group", () => patchGroup(group, groupPlacement(items(), parentId))),
    placeGroup: async (id: string, target: BoardTarget) => {
      const entries = boardEntries(items());
      const dragged = items().find((item): item is Group => item.kind === "group" && item.id === id);
      if (!entries.some(group => group.id === id) && (!dragged || dragged.builtin)) return;
      const patches: { group: Group; patch: Partial<Group>; create: boolean }[] = layoutPatches(placeInLayout(boardColumns(entries), [id], target), items());
      // A nested group dragged onto the board leaves its parent and becomes a column entry.
      if (dragged?.parentId) {
        const own = patches.find(entry => entry.group.id === id);
        if (own) own.patch = { ...own.patch, parentId: null };
        else patches.unshift({ group: dragged, patch: { parentId: null }, create: false });
      }
      if (patches.length) await batch("Move group", async () => {
        for (const { group, patch, create } of patches) await (create ? putItem({ ...group, ...patch }) : patchGroup(group, patch));
      });
    },
    /** Move a whole column's worth of top-level groups to one board position in a single undoable step. */
    placeGroups: async (ids: string[], target: BoardTarget) => {
      const entries = boardEntries(items());
      const valid = new Set(entries.map(group => group.id));
      const moving = ids.filter(id => valid.has(id));
      if (!moving.length) return;
      const patches = layoutPatches(placeInLayout(boardColumns(entries), moving, target), items());
      if (patches.length) await batch("Move groups", async () => {
        for (const { group, patch, create } of patches) await (create ? putItem({ ...group, ...patch }) : patchGroup(group, patch));
      });
    },
    reorderGroup: async (group: Group, offset: -1 | 1) => {
      const patches = reorderPatches(items(), group, offset);
      if (patches.length) await batch("Reorder groups", async () => { for (const { group, patch } of patches) await patchGroup(group, patch); });
    },
    /** Turn a task into a dormant dependent of another task (un-nests it if it was a subtask). */
    makeDependent: (task: Task, owner: Task) => batch("Make dependent", () =>
      putItem(patchedItem(task, { parentId: null, dependentOf: owner.id, groupId: dependentGroupId(items(), owner) }, new Date()), task)),

    /** Nest as a task's last subtask, or move between groups / onto the top level of one. */
    moveTask: (task: Task, target: { parent: Task } | { groupId: string | null } | { ref: Task; before: boolean }) => batch("Move task", async () => {
      let patches: { task: Task; patch: Partial<Task> }[];
      if ("parent" in target) {
        patches = taskPlacePatches(items(), task, target.parent.id, null);
      } else if ("ref" in target) {
        const byId = new Map(items().map(item => [item.id, item]));
        const ref = target.ref;
        const parentId = ref.parentId && byId.get(ref.parentId)?.kind === "task" ? ref.parentId : null;
        const groupId = parentId ? null : (ref.groupId && byId.get(ref.groupId)?.kind === "group" ? ref.groupId : null);
        const siblings = taskSiblings(items(), parentId, groupId).filter(sibling => sibling.id !== task.id);
        const index = siblings.findIndex(sibling => sibling.id === ref.id);
        patches = taskPlacePatches(items(), task, parentId, groupId, index < 0 ? undefined : target.before ? index : index + 1);
      } else {
        patches = taskPlacePatches(items(), task, null, target.groupId);
      }
      for (const { task: item, patch } of patches) await putItem(patchedItem(item, patch, new Date()), item);
    }),

    deleteGroup: (group: Group) => batch(`Delete group “${group.title}”`, async () => {
      const { groups, tasks } = ungroupPatches(items(), group);
      for (const { group, patch } of groups) await patchGroup(group, patch);
      for (const { task, patch } of tasks) await putItem(patchedItem(task, patch, new Date()), task);
      await deleteItem(group.id);
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
  };
}

export type CalendarStore = ReturnType<typeof createCalendarStore>;
