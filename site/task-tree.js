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
export function nestTaskRows(rows, items, collapsed = new Set()) {
  const visible = new Set(rows.map(row => row.task.id));
  const children = new Map(), roots = [];
  for (const row of rows) {
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
      if (!hidden) result.push({ ...row, depth, hasChildren: nested.length > 0 });
      for (const child of [...nested].reverse()) pending.push({ row: child, depth: depth + 1, hidden: hidden || collapsed.has(row.task.id) });
    }
  }
  roots.forEach(visit);
  for (const row of rows) if (!seen.has(row.task.id)) visit(row);
  return result;
}
