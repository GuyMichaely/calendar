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
import { boardColumns, boardEntries, groupPlacement, layoutPatches, placeGroup as placeInLayout, reorderPatches, ungroupPatches, type BoardTarget } from "./group-board";
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

  return {
    items,
    history,
    refresh,
    getItem,

    saveItem: (item: Item, baseline: Item | null) => change(() => putItem(item, baseline)),
    deleteItem: (id: string) => change(() => deleteItem(id)),

    addTask: (groupId: string | null, title: string) => change(() => putItem(newTask({ title, groupId }, new Date()))),
    addSubtask: (parent: Task, title: string) => change(() => putItem(newTask({ title, parentId: parent.id }, new Date()))),
    addDependent: (parent: Task, title: string) => change(() => putItem(newTask({ title, dependentOf: parent.id, groupId: dependentGroupId(items(), parent) }, new Date()))),
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
      if (!entries.some(group => group.id === id)) return;
      const patches = layoutPatches(placeInLayout(boardColumns(entries), id, target), items());
      if (patches.length) await batch("Move group", async () => {
        for (const { group, patch, create } of patches) await (create ? putItem({ ...group, ...patch }) : patchGroup(group, patch));
      });
    },
    reorderGroup: async (group: Group, offset: -1 | 1) => {
      const patches = reorderPatches(items(), group, offset);
      if (patches.length) await batch("Reorder groups", async () => { for (const { group, patch } of patches) await patchGroup(group, patch); });
    },
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
