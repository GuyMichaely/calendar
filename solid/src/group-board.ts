import type { Group, Item, Task } from "./types";

export type TaskNode = { task: Task; children: TaskNode[] };
export type GroupNode = { group: Group; tasks: TaskNode[]; groups: GroupNode[] };
export type Board = { ungrouped: TaskNode[]; groups: GroupNode[] };

type Ordered = { sortOrder?: number; createdAt: string };
export const byOrder = (a: Ordered, b: Ordered) =>
  (a.sortOrder ?? Infinity) - (b.sortOrder ?? Infinity) || a.createdAt.localeCompare(b.createdAt);

function push<T>(map: Map<string, T[]>, key: string, value: T) {
  const list = map.get(key);
  if (list) list.push(value); else map.set(key, [value]);
}

export function sortedGroups(items: Item[]) {
  return items.filter((item): item is Group => item.kind === "group").sort(byOrder);
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
  const childTasks = new Map<string, Task[]>();
  const topTasks = new Map<string | null, Task[]>();
  for (const task of tasks) {
    if (task.parentId && taskIds.has(task.parentId)) push(childTasks, task.parentId, task);
    else {
      const groupId = task.groupId && groupIds.has(task.groupId) ? task.groupId : null;
      const list = topTasks.get(groupId);
      if (list) list.push(task); else topTasks.set(groupId, [task]);
    }
  }
  const seen = new Set<string>();
  const taskNode = (task: Task): TaskNode | null => {
    if (seen.has(task.id)) return null;
    seen.add(task.id);
    const children = (childTasks.get(task.id) || []).map(taskNode).filter((node): node is TaskNode => !!node);
    return include(task) || children.length ? { task, children } : null;
  };
  const taskNodes = (groupId: string | null) => (topTasks.get(groupId) || []).map(taskNode).filter((node): node is TaskNode => !!node);
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
