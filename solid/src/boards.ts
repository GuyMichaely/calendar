import { isDormant } from "./dependencies";
import { dependentTasks } from "../../site/task-tree.js";
import { effectivelyDone } from "./today";
import type { Group, Item, Task } from "./types";

/*
 * Boards are stored as `group` items. A built-in board (Firm, Available, …) is stored as a
 * group with a `builtin` key only to remember where it sits in the Boards view.
 */
type Ordered = { sortOrder?: number; createdAt: string };
export const byOrder = (a: Ordered, b: Ordered) =>
  (a.sortOrder ?? Infinity) - (b.sortOrder ?? Infinity) || a.createdAt.localeCompare(b.createdAt);

/** Your boards (not the built-in ones), in their stored order. */
export function sortedGroups(items: Item[]) {
  return items.filter((item): item is Group => item.kind === "group" && !item.builtin).sort(byOrder);
}

/** A board's top-level tasks (`groupId`, null for none), or a task's subtasks (`parentId`), in order. Unstarted dependent tasks aren't anyone's siblings. */
export function taskSiblings(items: Item[], parentId: string | null, groupId: string | null): Task[] {
  const byId = new Map(items.map(item => [item.id, item]));
  const groupIds = new Set(items.filter(item => item.kind === "group").map(item => item.id));
  return items.filter((item): item is Task => {
    if (item.kind !== "task") return false;
    if (parentId) return item.parentId === parentId && byId.get(parentId)?.kind === "task";
    if (item.parentId && byId.get(item.parentId)?.kind === "task") return false;
    if (isDormant(item, byId)) return false;
    return (item.groupId && groupIds.has(item.groupId) ? item.groupId : null) === groupId;
  }).sort(byOrder);
}

/** The sortOrder (and parent and board) changes that place `task` among new siblings at `index`, the end by default. */
export function taskPlacePatches(items: Item[], task: Task, parentId: string | null, groupId: string | null, index?: number) {
  const siblings = taskSiblings(items, parentId, groupId).filter(sibling => sibling.id !== task.id);
  const at = index == null ? siblings.length : Math.max(0, Math.min(index, siblings.length));
  siblings.splice(at, 0, task);
  return siblings.flatMap((sibling, sortOrder) =>
    // Placing a task as a sibling also wakes it out of any dormant dependent state.
    sibling.id === task.id ? [{ task: sibling, patch: { sortOrder, parentId, groupId, dependentOf: null, relativeDates: null } }]
      : sibling.sortOrder !== sortOrder ? [{ task: sibling, patch: { sortOrder } }] : []);
}

/** Deleting a board but keeping its tasks leaves them on no board. */
export function deleteBoardPatches(items: Item[], board: Group) {
  return items.flatMap(item => item.kind === "task" && item.groupId === board.id ? [{ task: item, patch: { groupId: null } as Partial<Task> }] : []);
}

/**
 * The tasks deleting a board with its tasks removes: its open tasks, with their subtasks
 * and dependent tasks. A finished task isn't on its board any more (it only keeps the
 * board's name, as a record), so it stays, on no board.
 */
export function boardTasks(items: Item[], board: Group): Task[] {
  const byId = new Map(items.map(item => [item.id, item]));
  const found = new Map<string, Task>();
  for (const item of items) {
    if (item.kind !== "task" || item.groupId !== board.id || effectivelyDone(item, byId)) continue;
    for (const task of [item, ...dependentTasks(items, item.id) as Task[]]) found.set(task.id, task);
  }
  return [...found.values()];
}
