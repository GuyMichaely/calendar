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

/** Groups nested under a group, at any depth. @param {import('./model').Item[]} items */
export function validateTaskGroup(items, groupId) {
  if (groupId == null || groupId === "") return;
  const group = items.find(item => item.id === groupId);
  if (group && group.kind !== "group") throw new Error("Tasks can only be placed on boards.");
}

/** Subtasks and not-yet-started dependent tasks under a task, at any depth. */
export function dependentTasks(items, id) {
  const result = [], seen = new Set([id]), pending = [id];
  while (pending.length) {
    const owner = pending.pop();
    for (const item of items) if (item.kind === "task" && (item.parentId === owner || item.dependentOf === owner) && !seen.has(item.id)) {
      seen.add(item.id); result.push(item); pending.push(item.id);
    }
  }
  return result;
}

/** A dependent task belongs to another task, never (through other dependent tasks) to itself. */
export function validateDependentOf(items, id, dependentOf) {
  if (dependentOf == null || dependentOf === "") return;
  if (typeof dependentOf !== "string") throw new Error("A dependent task must belong to a task ID.");
  const owner = items.find(item => item.id === dependentOf);
  if (owner && owner.kind !== "task") throw new Error("Dependent tasks can only belong to tasks.");
  const byId = new Map(items.map(item => [item.id, item]));
  for (let current = dependentOf, seen = new Set(); current; current = byId.get(current)?.dependentOf) {
    if (current === id || seen.has(current)) throw new Error("A task cannot depend on itself.");
    seen.add(current);
  }
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
