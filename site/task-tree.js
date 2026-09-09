import { sortTasks } from './domain.js';
/** @param {import('./model').Item[]} items */
export function taskDescendants(items, id) {
  const children = new Map();
  for (const item of items) if (item.kind === "task" && item.parentId) {
    const list = children.get(item.parentId) || [];
    list.push(item); children.set(item.parentId, list);
  }
  const result = [], seen = new Set([id]), pending = [...(children.get(id) || [])];
  while (pending.length) {
    const task = pending.pop();
    if (seen.has(task.id)) continue;
    seen.add(task.id); result.push(task); pending.push(...(children.get(task.id) || []));
  }
  return result;
}

/** @param {import('./model').Item[]} items */
export function taskAncestors(items, id) {
  const tasks = new Map(items.filter(item => item.kind === "task").map(item => [item.id, item]));
  const result = [], seen = new Set([id]);
  let parent = tasks.get(id)?.parentId;
  while (parent && tasks.has(parent) && !seen.has(parent)) {
    seen.add(parent); const task = tasks.get(parent); result.push(task); parent = task.parentId;
  }
  return result;
}

export function validateTaskParent(items, id, parentId) {
  if (parentId == null || parentId === "") return;
  if (typeof parentId !== "string") throw new Error("A parent task must have a task ID.");
  if (parentId === id || taskDescendants(items, id).some(task => task.id === parentId)) throw new Error("A task cannot be its own ancestor.");
  const parent = items.find(item => item.id === parentId);
  if (parent && parent.kind !== "task") throw new Error("Only tasks can contain subtasks.");
}

// Preserve the section's ordering among siblings. Missing/filtered parents are
// skipped; concurrent move cycles become visible roots instead of hiding tasks.
export function nestTaskRows(rows, items, collapsed = new Set(), includeHidden = false) {
  const visible = new Set(rows.map(row => row.task.id));
  const children = new Map(), roots = [];
  const ordered = [...rows].sort((a, b) => (a.task.sortOrder ?? Infinity) - (b.task.sortOrder ?? Infinity));
  for (const row of ordered) {
    const parent = taskAncestors(items, row.task.id).find(task => visible.has(task.id));
    if (!parent) roots.push(row);
    else { const list = children.get(parent.id) || []; list.push(row); children.set(parent.id, list); }
  }
  const result = [], seen = new Set();
  function visit(root) {
    const pending = [{ row: root, depth: 0, hidden: false }];
    while (pending.length) {
      const {row, depth, hidden} = pending.pop();
      if (seen.has(row.task.id)) continue;
      seen.add(row.task.id);
      const nested = children.get(row.task.id) || [];
      if (!hidden || includeHidden) result.push({ ...row, depth, hidden, hasChildren: nested.length > 0 });
      for (const child of [...nested].reverse()) pending.push({ row: child, depth: depth + 1, hidden: hidden || collapsed.has(row.task.id) });
    }
  }
  roots.forEach(visit);
  for (const row of rows) if (!seen.has(row.task.id)) visit(row);
  return result;
}

export function taskMoveUpdates(items, id, targetId, placement) {
  const task = items.find(item => item.id === id && item.kind === 'task');
  const target = items.find(item => item.id === targetId && item.kind === 'task');
  if (!task || (targetId && !target)) throw new Error('The task is no longer available.');
  if (id === targetId) return [];
  if (!['before', 'after', 'inside', 'root'].includes(placement)) throw new Error('Invalid task placement.');
  const parentId = placement === 'root' ? null : placement === 'inside' ? target.id : target.parentId || null;
  validateTaskParent(items, id, parentId);
  const siblings = sortTasks(items.filter(item => item.kind === 'task' && item.id !== id && (item.parentId || null) === parentId));
  siblings.sort((a, b) => (a.sortOrder ?? Infinity) - (b.sortOrder ?? Infinity));
  const index = placement === 'before' || placement === 'after' ? siblings.findIndex(item => item.id === targetId) + (placement === 'after' ? 1 : 0) : siblings.length;
  siblings.splice(index, 0, task);
  return siblings.map((item, sortOrder) => ({id: item.id, parentId, sortOrder}));
}
