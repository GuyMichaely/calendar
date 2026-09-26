import { isDormant } from "./dependencies";
import type { Group, Item, Task } from "./types";

// Dependents are dependent tasks not yet started; they show under their parent task until started.
export type TaskNode = { task: Task; children: TaskNode[]; dependents: TaskNode[] };
export type GroupNode = { group: Group; tasks: TaskNode[]; groups: GroupNode[] };
export type Board = { ungrouped: TaskNode[]; groups: GroupNode[] };

type Ordered = { sortOrder?: number; createdAt: string };
export const byOrder = (a: Ordered, b: Ordered) =>
  (a.sortOrder ?? Infinity) - (b.sortOrder ?? Infinity) || a.createdAt.localeCompare(b.createdAt);

function push<T>(map: Map<string, T[]>, key: string, value: T) {
  const list = map.get(key);
  if (list) list.push(value); else map.set(key, [value]);
}

/** User groups: built-in sections are stored as groups only to remember their position. */
export function sortedGroups(items: Item[]) {
  return items.filter((item): item is Group => item.kind === "group" && !item.builtin).sort(byOrder);
}

// Built-in sections start in the leftmost columns, before any user column.
export const BUILTIN_GROUPS = [
  { id: "builtin-available", builtin: "available", title: "Available", boardColumn: -2, sortOrder: 0 },
  { id: "builtin-upcoming", builtin: "upcoming", title: "Upcoming", boardColumn: -2, sortOrder: 1 },
  { id: "builtin-sleeping", builtin: "sleeping", title: "Sleeping", boardColumn: -2, sortOrder: 2 },
  { id: "builtin-ungrouped", builtin: "ungrouped", title: "No group", boardColumn: -1, sortOrder: 0 },
] as const;
export type BuiltinKind = (typeof BUILTIN_GROUPS)[number]["builtin"];

export function builtinGroup(id: string, createdAt = new Date().toISOString()): Group | null {
  const spec = BUILTIN_GROUPS.find(entry => entry.id === id);
  return spec ? { id: spec.id, kind: "group", title: spec.title, builtin: spec.builtin, parentId: null, boardColumn: spec.boardColumn, sortOrder: spec.sortOrder, createdAt, updatedAt: createdAt } : null;
}

// Top-level groups have no (existing) parent. Groups caught in a cycle, which
// concurrent moves on two devices can create, are shown at the top level.
export function groupForest(groups: Group[]): { roots: Group[]; children: Map<string, Group[]> } {
  const ids = new Set(groups.map(group => group.id));
  const children = new Map<string, Group[]>();
  const roots: Group[] = [];
  for (const group of groups) {
    if (group.parentId && ids.has(group.parentId)) push(children, group.parentId, group);
    else roots.push(group);
  }
  const reached = new Set<string>();
  const visit = (group: Group) => { if (reached.has(group.id)) return; reached.add(group.id); (children.get(group.id) || []).forEach(visit); };
  roots.forEach(visit);
  for (const group of groups) if (!reached.has(group.id)) {
    roots.push(group);
    if (group.parentId) children.set(group.parentId, (children.get(group.parentId) || []).filter(child => child.id !== group.id));
    visit(group);
  }
  return { roots, children };
}

/** Arrange tasks under their groups. `include` filters tasks; an excluded task stays when a descendant is included. */
export function buildBoard(items: Item[], include: (task: Task) => boolean): Board {
  const groups = sortedGroups(items);
  const groupIds = new Set(groups.map(group => group.id));
  const tasks = items.filter((item): item is Task => item.kind === "task").sort(byOrder);
  const taskIds = new Set(tasks.map(task => task.id));
  const byId = new Map(items.map(item => [item.id, item]));
  const childTasks = new Map<string, Task[]>();
  const dependentTasks = new Map<string, Task[]>();
  const topTasks = new Map<string | null, Task[]>();
  for (const task of tasks) {
    if (task.parentId && taskIds.has(task.parentId)) push(childTasks, task.parentId, task);
    else if (isDormant(task, byId)) push(dependentTasks, task.dependentOf!, task);
    else {
      const groupId = task.groupId && groupIds.has(task.groupId) ? task.groupId : null;
      const list = topTasks.get(groupId);
      if (list) list.push(task); else topTasks.set(groupId, [task]);
    }
  }
  // The path guard stops loops that concurrent edits on two devices could create.
  const taskNode = (task: Task, path: Set<string>): TaskNode | null => {
    if (path.has(task.id)) return null;
    const inner = new Set(path).add(task.id);
    const nodes = (list: Task[] = []) => list.map(entry => taskNode(entry, inner)).filter((node): node is TaskNode => !!node);
    // Unstarted dependent tasks of a completed task are hidden along with it.
    const children = nodes(childTasks.get(task.id)), dependents = include(task) || task.state !== "completed" ? nodes(dependentTasks.get(task.id)) : [];
    return include(task) || children.length || dependents.length ? { task, children, dependents } : null;
  };
  const taskNodes = (groupId: string | null) => (topTasks.get(groupId) || []).map(task => taskNode(task, new Set())).filter((node): node is TaskNode => !!node);
  const { roots, children } = groupForest(groups);
  const groupNode = (group: Group): GroupNode => ({
    group,
    tasks: taskNodes(group.id),
    groups: (children.get(group.id) || []).map(groupNode),
  });
  return { ungrouped: taskNodes(null), groups: roots.map(groupNode) };
}

export function flattenGroupNodes(nodes: GroupNode[], into = new Map<string, GroupNode>()) {
  for (const node of nodes) { into.set(node.group.id, node); flattenGroupNodes(node.groups, into); }
  return into;
}

/** Groups in tree order with their depth, for pickers. */
export function groupOptions(items: Item[], exclude = new Set<string>()) {
  const { roots, children } = groupForest(sortedGroups(items));
  const options: { group: Group; depth: number }[] = [];
  const walk = (group: Group, depth: number) => {
    if (exclude.has(group.id)) return;
    options.push({ group, depth });
    (children.get(group.id) || []).forEach(child => walk(child, depth + 1));
  };
  roots.forEach(group => walk(group, 0));
  return options;
}

// Top-level groups are stacked in board columns. A group without a stored
// column (created before columns existed) gets a column of its own.
const columnKey = (group: Group) => group.boardColumn ?? group.sortOrder ?? 0;

/** Everything placed on the board: top-level user groups and the built-in sections (stored or default). */
export function boardEntries(items: Item[]): Group[] {
  const stored = new Map(items.filter((item): item is Group => item.kind === "group" && !!item.builtin).map(group => [group.id, group]));
  const builtins = BUILTIN_GROUPS.map(spec => stored.get(spec.id) || builtinGroup(spec.id, new Date(0).toISOString())!);
  return [...builtins, ...groupForest(sortedGroups(items)).roots];
}

export function boardColumns(entries: Group[]): string[][] {
  const columns = new Map<number, Group[]>();
  for (const group of [...entries].sort(byOrder)) columns.set(columnKey(group), [...(columns.get(columnKey(group)) || []), group]);
  return [...columns.entries()].sort(([a], [b]) => a - b).map(([, groups]) => groups.map(group => group.id));
}

export function nextColumnKey(roots: Group[]) {
  return Math.max(-1, ...roots.map(columnKey)) + 1;
}

export type BoardTarget = { column: number; index: number } | { newColumn: number };

/** Move a top-level group within the column layout; empty columns disappear. */
export function placeGroup(columns: string[][], id: string, target: BoardTarget): string[][] {
  const next: (string | null)[][] = columns.map(column => column.map(entry => entry === id ? null : entry));
  if ("newColumn" in target) next.splice(target.newColumn, 0, [id]);
  else next[target.column]?.splice(target.index, 0, id);
  return next.map(column => column.filter((entry): entry is string => entry !== null)).filter(column => column.length);
}

/** The column and position each group needs to match a layout. Built-in sections not yet stored are created. */
export function layoutPatches(columns: string[][], items: Item[]) {
  const byId = new Map(items.filter((item): item is Group => item.kind === "group").map(group => [group.id, group]));
  return columns.flatMap((column, boardColumn) => column.flatMap((id, sortOrder) => {
    const stored = byId.get(id);
    const group = stored || builtinGroup(id);
    if (!group || (stored && group.boardColumn === boardColumn && group.sortOrder === sortOrder)) return [];
    return [{ group, patch: { boardColumn, sortOrder }, create: !stored }];
  }));
}

/**
 * Nest a flat list (like Available or Upcoming) so each task sits under its nearest ancestor that is also
 * in the list; order is kept. Ancestors that would loop (concurrent moves) leave the task at the top level.
 */
export function nestList(tasks: Task[], items: Item[]): TaskNode[] {
  const byId = new Map(items.map(item => [item.id, item]));
  const inList = new Set(tasks.map(task => task.id));
  const host = (task: Task) => {
    const seen = new Set([task.id]);
    for (let id = task.parentId; id && !seen.has(id); ) {
      if (inList.has(id)) return id;
      seen.add(id);
      const parent = byId.get(id);
      id = parent?.kind === "task" ? parent.parentId : null;
    }
    return null;
  };
  const hosts = new Map(tasks.map(task => [task.id, host(task)]));
  const loops = (id: string) => { const seen = new Set<string>(); for (let at = hosts.get(id); at; at = hosts.get(at)) { if (at === id || seen.has(at)) return true; seen.add(at); } return false; };
  const nodes = new Map(tasks.map(task => [task.id, { task, children: [], dependents: [] } as TaskNode]));
  const roots: TaskNode[] = [];
  for (const task of tasks) {
    const parent = hosts.get(task.id);
    (parent && !loops(task.id) ? nodes.get(parent)!.children : roots).push(nodes.get(task.id)!);
  }
  return roots;
}

// Groups: siblings share a parent (top-level groups share none) and are ordered by sortOrder.
export function siblingGroups(items: Item[], parentId: string | null) {
  const forest = groupForest(sortedGroups(items));
  return parentId ? forest.children.get(parentId) || [] : forest.roots;
}

export function nextGroupOrder(items: Item[], parentId: string | null) {
  return Math.max(-1, ...siblingGroups(items, parentId).map(group => group.sortOrder ?? -1)) + 1;
}

/** Where a group goes when it moves under a parent: last among its siblings. A group that becomes top level starts a new board column at the right. */
export function groupPlacement(items: Item[], parentId: string | null, column = nextColumnKey(boardEntries(items))): Pick<Group, "parentId" | "sortOrder" | "boardColumn"> {
  return parentId ? { parentId, sortOrder: nextGroupOrder(items, parentId) } : { parentId: null, boardColumn: column, sortOrder: 0 };
}

/** The sortOrder changes that move a group one place up or down among its siblings. */
export function reorderPatches(items: Item[], group: Group, offset: -1 | 1) {
  const siblings = [...siblingGroups(items, group.parentId && items.some(item => item.id === group.parentId) ? group.parentId : null)];
  const from = siblings.findIndex(sibling => sibling.id === group.id), to = from + offset;
  if (from < 0 || to < 0 || to >= siblings.length) return [];
  [siblings[from], siblings[to]] = [siblings[to], siblings[from]];
  return siblings.flatMap((sibling, sortOrder) => sibling.sortOrder === sortOrder ? [] : [{ group: sibling, patch: { sortOrder } }]);
}

/** Deleting a group keeps its contents: subgroups and tasks move up to its parent (or the top level). */
export function ungroupPatches(items: Item[], group: Group) {
  const parent = items.find((item): item is Group => item.kind === "group" && item.id === group.parentId) || null;
  let order = nextGroupOrder(items, parent?.id || null), column = nextColumnKey(boardEntries(items));
  const groups: { group: Group; patch: Partial<Group> }[] = [], tasks: { task: Task; patch: Partial<Task> }[] = [];
  for (const item of items) {
    if (item.kind === "group" && item.parentId === group.id) groups.push({ group: item, patch: parent ? { parentId: parent.id, sortOrder: order++ } : groupPlacement(items, null, column++) });
    if (item.kind === "task" && item.groupId === group.id) tasks.push({ task: item, patch: { groupId: parent?.id || null } });
  }
  return { parent, groups, tasks };
}
