import { isDormant } from "./dependencies";
import { nextOpening, openingOn, taskSchedule } from "./windows";
import { occurrenceTask } from "./repeats";
import { addDays, sameDay, startOfDay } from "./zone";
import type { CalendarSettings, Item, Task, TimeWindow } from "./types";

/*
 * List puts every task in exactly one section, by the first rule that fits:
 * due today or overdue, or within the calendar's Deadline days (Deadline); a window open now (Closing today) or opening
 * later today (Opens later today); can't start yet (Upcoming); else Available. Pushed-down tasks stay in their section, at the bottom.
 */
export type SectionId = "firm" | "closing" | "later" | "available" | "upcoming" | "completed";
export const SECTION_ORDER: SectionId[] = ["firm", "closing", "later", "available", "upcoming", "completed"];

export type Placement = {
  section: SectionId;
  // The window's current opening (closing / later), or the next one (upcoming).
  opens?: Date;
  closes?: Date;
  // When an upcoming task can next be worked on (null: no known time).
  next?: Date | null;
  due?: Date;
  overdue?: boolean;
  pushed: boolean;
};

const time = (value?: string | null) => { if (!value) return null; const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date; };

/** How far ahead of its due day a task joins Deadline, for the whole calendar (its settings say; 0: on the day). */
export function deadlineDaysOf(items: Item[]) {
  const settings = items.find((item): item is CalendarSettings => item.kind === "settings");
  return Math.max(0, settings?.deadlineDays ?? 0);
}

/** When a due task joins Deadline: the start of its due day, or of the day `days` before it. */
export function warnTime(task: Task, days = 0) {
  const due = time(task.deadline);
  return due ? startOfDay(addDays(due, -days)) : null;
}

/** Pushed down, and until when. */
export function pushedDownInfo(task: Task, now: Date) {
  const pushed = task.pushedDown;
  if (!pushed || task.state === "completed") return { pushed: false, until: null as Date | null };
  const until = time(pushed.until);
  return until && until <= now ? { pushed: false, until: null } : { pushed: true, until };
}

export function placeTask(task: Task, now: Date, windows: Map<string, TimeWindow>, deadlineDays = 0): Placement {
  const pushed = pushedDownInfo(task, now).pushed;
  if (task.state === "completed") return { section: "completed", pushed: false };
  const due = time(task.deadline) ?? undefined;
  const warn = warnTime(task, deadlineDays);
  if (due && warn && now >= warn) return { section: "firm", due, overdue: now > due, pushed };
  const schedule = taskSchedule(task, windows);
  const start = time(task.availableFrom);
  const from = start && start > now ? start : now;
  if (schedule) {
    const opening = nextOpening(schedule, from);
    if (!opening) return { section: "upcoming", next: null, due, pushed };
    const opens = opening.opens > from ? opening.opens : from;
    if (opens <= now) return { section: "closing", opens: opening.opens, closes: opening.closes, due, pushed };
    if (sameDay(opens, now)) return { section: "later", opens, closes: opening.closes, due, pushed };
    return { section: "upcoming", next: opens, opens, closes: opening.closes, due, pushed };
  }
  if (start && start > now) return sameDay(start, now) ? { section: "later", opens: start, due, pushed } : { section: "upcoming", next: start, due, pushed };
  return { section: "available", due, pushed };
}

const orderKey = (task: Task, placement: Placement): number[] => {
  const t = (date?: Date | null) => date ? date.getTime() : Infinity;
  switch (placement.section) {
    case "firm": return [placement.overdue ? 0 : 1, t(placement.due)];
    case "closing": return [t(placement.closes)];
    case "later": return [t(placement.opens)];
    case "upcoming": return [t(placement.next)];
    case "completed": return [-(time(task.completedAt)?.getTime() ?? 0)];
    default: return [t(placement.due), task.sortOrder ?? Infinity];
  }
};

function compareTasks(a: { task: Task; placement: Placement }, b: { task: Task; placement: Placement }) {
  if (a.placement.pushed !== b.placement.pushed) return a.placement.pushed ? 1 : -1;
  const ka = orderKey(a.task, a.placement), kb = orderKey(b.task, b.placement);
  // Ties keep the tasks' manual order.
  ka.push(a.task.sortOrder ?? Infinity); kb.push(b.task.sortOrder ?? Infinity);
  for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] < kb[i] ? -1 : 1;
  return a.task.createdAt.localeCompare(b.task.createdAt) || a.task.id.localeCompare(b.task.id);
}

// A section is a forest of task rows. A task with open subtasks is a container: it is
// never placed by its own timing, only shown as a header above its subtasks (still
// checkable: finishing it finishes the whole family), and its constraints pass down to
// them (see `inherited`). Anything under a finished task counts as done.
//
// Subtasks show one of two ways, set for the whole view: "context" (Spread out) places
// every task by its own timing under its container headers; "nested" (Keep together)
// shows each family once, in the most urgent section any of its open tasks belongs to,
// dimming (not hiding) the tasks whose own timing is less urgent.
//
// A finished subtask of an open task isn't placed on its own: it goes with its parent,
// either dimmed below its open subtasks or folded into "+N completed", as the parent's
// `completedSubtasks` says. Show completed only governs the Completed section.
// Unstarted dependent tasks go with their parent task too (`dependents`), folded at first.
export type TreeNode = { task: Task; container: boolean; muted?: boolean; placement?: Placement; children: TreeNode[]; finished?: TreeNode[]; showFinished?: boolean; dependents?: TreeNode[]; dependent?: boolean };
export type SubtaskMode = "context" | "nested";

// A section is one of the urgency sections, or (in the Boards view) a board's id.
export type Section = { id: string; trees: TreeNode[]; count: number };

function taskParent(task: Task, byId: Map<string, Item>) {
  const parent = task.parentId ? byId.get(task.parentId) : undefined;
  return parent?.kind === "task" ? parent : null;
}

/** Ancestors from the top down, guarding against loops. */
export function ancestors(task: Task, byId: Map<string, Item>): Task[] {
  const chain: Task[] = [], seen = new Set([task.id]);
  for (let parent = taskParent(task, byId); parent && !seen.has(parent.id); parent = taskParent(parent, byId)) { chain.unshift(parent); seen.add(parent.id); }
  return chain;
}

/** Done itself, or under a finished container. */
export function effectivelyDone(task: Task, byId: Map<string, Item>) {
  return task.state === "completed" || ancestors(task, byId).some(ancestor => ancestor.state === "completed");
}

/**
 * The task as its containers constrain it: the earliest due date (with its warning),
 * the latest can-start date, the nearest window, and pushed down if any container is. Used only for placing it; nothing is stored.
 */
export function inherited(task: Task, chain: Task[], now: Date): Task {
  if (!chain.length) return task;
  const family = [...chain, task];
  const dueSource = family.filter(entry => time(entry.deadline)).sort((a, b) => time(a.deadline)!.getTime() - time(b.deadline)!.getTime())[0];
  const starts = family.map(entry => time(entry.availableFrom)).filter((date): date is Date => !!date);
  const windowSource = [...family].reverse().find(entry => entry.windowId);
  const pushedSource = [...family].reverse().find(entry => pushedDownInfo(entry, now).pushed);
  return {
    ...task,
    deadline: dueSource?.deadline ?? null,
    availableFrom: starts.length ? new Date(Math.max(...starts.map(date => date.getTime()))).toISOString() : null,
    windowId: windowSource?.windowId ?? null,
    pushedDown: pushedSource?.pushedDown ?? null,
  };
}

/** Where the Agenda places a task (with its containers' constraints and its current occurrence). */
export function placementOf(task: Task, items: Item[], now: Date): Placement {
  const byId = new Map(items.map(item => [item.id, item]));
  const windows = new Map(items.filter((item): item is TimeWindow => item.kind === "window").map(item => [item.id, item]));
  if (effectivelyDone(task, byId)) return { section: "completed", pushed: false };
  return placeTask(inherited(occurrenceTask(task, now), ancestors(task, byId).map(ancestor => occurrenceTask(ancestor, now)), now), now, windows, deadlineDaysOf(items));
}

/** Tasks that are actual work right now: open, started, not done through a container, and not containers themselves. */
export function openWork(items: Item[]) {
  const byId = new Map(items.map(item => [item.id, item]));
  const parents = new Set(items.filter(item => item.kind === "task" && item.state !== "completed").map(item => (item as Task).parentId));
  return items.filter((item): item is Task => item.kind === "task" && !isDormant(item, byId) && !effectivelyDone(item, byId) && !parents.has(item.id));
}

/**
 * `boardOf` (the Boards view) puts every open task that's on a board in that board's
 * section instead of its urgency section, most urgent first; finished tasks stay in
 * Completed. Tasks on no board are sectioned as usual.
 */
export function buildSections(items: Item[], now: Date, options: { mode: SubtaskMode; showCompleted: boolean; include: (task: Task) => boolean; boardOf?: (task: Task, placement: Placement) => string | null }): Section[] {
  const byId = new Map(items.map(item => [item.id, item]));
  const windows = new Map(items.filter((item): item is TimeWindow => item.kind === "window").map(item => [item.id, item]));
  const deadlineDays = deadlineDaysOf(items);
  // Dependent tasks that haven't started live in their parent's editor, not in the lists.
  const tasks = items.filter((item): item is Task => item.kind === "task" && !isDormant(item, byId));
  const chainOf = new Map(tasks.map(task => [task.id, ancestors(task, byId)]));
  const done = new Map(tasks.map(task => [task.id, task.state === "completed" || chainOf.get(task.id)!.some(ancestor => ancestor.state === "completed")]));
  const childrenOf = new Map<string, Task[]>();
  for (const task of tasks) { const parent = taskParent(task, byId); if (parent) childrenOf.set(parent.id, [...(childrenOf.get(parent.id) || []), task]); }
  const openContainer = (task: Task) => !done.get(task.id) && (childrenOf.get(task.id) || []).some(child => !done.get(child.id));
  // Done, but part of a finished subtree under an open task: it shows with that task.
  const withOpenParent = (task: Task) => {
    const family = [...chainOf.get(task.id)!, task];
    const index = family.findIndex(entry => entry.state === "completed");
    return index > 0;
  };
  const byOrder = (a: Task, b: Task) => (a.sortOrder ?? Infinity) - (b.sortOrder ?? Infinity) || a.createdAt.localeCompare(b.createdAt);
  const doneTree = (task: Task, path: Set<string>): TreeNode => ({ task, container: false, muted: true, placement: { section: "completed", pushed: false },
    children: (childrenOf.get(task.id) || []).filter(child => !path.has(child.id)).sort(byOrder).map(child => doneTree(child, new Set(path).add(child.id))) });
  // An open task's finished subtasks, attached to the first row shown for it.
  const attached = new Set<string>();
  const dormantOf = new Map<string, Task[]>();
  for (const item of items) if (item.kind === "task" && isDormant(item, byId) && item.state !== "completed") dormantOf.set(item.dependentOf!, [...(dormantOf.get(item.dependentOf!) || []), item]);
  // A dependent's own dependents wait under it.
  const waitingTree = (task: Task, path: Set<string>): TreeNode => {
    const next = (dormantOf.get(task.id) || []).filter(child => !path.has(child.id)).sort(byOrder);
    return { task, container: false, dependent: true, children: [], ...(next.length ? { dependents: next.map(child => waitingTree(child, new Set(path).add(child.id))) } : {}) };
  };
  const finish = (node: TreeNode): TreeNode => {
    if (done.get(node.task.id) || attached.has(node.task.id)) return node;
    const waiting = (dormantOf.get(node.task.id) || []).sort(byOrder);
    if (waiting.length) node.dependents = waiting.map(task => waitingTree(task, new Set([node.task.id, task.id])));
    const finished = (childrenOf.get(node.task.id) || []).filter(child => child.state === "completed").sort(byOrder);
    attached.add(node.task.id);
    if (!finished.length) return node;
    return Object.assign(node, { finished: finished.map(child => doneTree(child, new Set([node.task.id, child.id]))), showFinished: node.task.completedSubtasks === "show" });
  };
  const placementFor = (task: Task): Placement => done.get(task.id)
    ? { section: "completed", pushed: false }
    : placeTask(inherited(occurrenceTask(task, now), chainOf.get(task.id)!.map(ancestor => occurrenceTask(ancestor, now)), now), now, windows, deadlineDays);
  // Placed tasks: everything except open containers. A search or group filter keeps a
  // task when it or one of its containers matches.
  const placed = tasks.filter(task => !openContainer(task) && !withOpenParent(task))
    .map(task => ({ task, placement: placementFor(task) }))
    .filter(entry => (options.showCompleted || entry.placement.section !== "completed") && [entry.task, ...chainOf.get(entry.task.id)!].some(options.include));
  const placementOf = new Map(placed.map(entry => [entry.task.id, entry.placement]));
  // Everything a tree needs: placed tasks and the containers above them.
  const shown = new Set(placed.flatMap(entry => [entry.task.id, ...chainOf.get(entry.task.id)!.map(ancestor => ancestor.id)]));
  const count = (nodes: TreeNode[]): number => nodes.reduce((total, node) => total + (node.container || node.muted ? 0 : 1) + count(node.children), 0);
  // Every tree remembers the task that decides its place in the section order.
  type Entry = { task: Task; placement: Placement };
  const bySection = new Map<string, { tree: TreeNode; lead: Entry }[]>();
  const add = (section: string, tree: TreeNode, lead: Entry) => bySection.set(section, [...(bySection.get(section) || []), { tree, lead }]);
  const rank = (id: string) => { const index = SECTION_ORDER.indexOf(id as SectionId); return index < 0 ? SECTION_ORDER.indexOf("available") : index; };
  // A board mixes urgencies: pushed down last, then by urgency section, then as within one.
  const compareAcross = (a: Entry, b: Entry) => (a.placement.pushed === b.placement.pushed ? 0 : a.placement.pushed ? 1 : -1) || rank(a.placement.section) - rank(b.placement.section) || compareTasks(a, b);
  const boardKey = (entry: Entry) => entry.placement.section === "completed" ? null : options.boardOf?.(entry.task, entry.placement) ?? null;
  const onBoards = placed.filter(entry => boardKey(entry)), rest = placed.filter(entry => !boardKey(entry));

  // Spread out: each task in its own section, under headers for its containers.
  const spread = (entries: Entry[], keyOf: (entry: Entry) => string, compare: (a: Entry, b: Entry) => number) => {
    for (const key of new Set(entries.map(keyOf))) {
      const list = entries.filter(entry => keyOf(entry) === key).sort(compare);
      const inSection = new Set(list.map(entry => entry.task.id));
      const nodes = new Map<string, TreeNode>();
      for (const entry of list) {
        let siblings: TreeNode[] | null = null;
        for (const ancestor of chainOf.get(entry.task.id)!) {
          let node = nodes.get(ancestor.id);
          if (!node) {
            node = { task: ancestor, container: !inSection.has(ancestor.id), placement: placementOf.get(ancestor.id), children: [] };
            nodes.set(ancestor.id, node);
            if (siblings) siblings.push(node); else add(key, node, entry);
          }
          siblings = node.children;
        }
        const existing = nodes.get(entry.task.id);
        if (existing) { existing.container = false; existing.placement = entry.placement; continue; }
        const node: TreeNode = { task: entry.task, container: false, placement: entry.placement, children: [] };
        nodes.set(entry.task.id, node);
        if (siblings) siblings.push(node); else add(key, node, entry);
      }
    }
  };

  if (options.mode === "context") spread(rest, entry => entry.placement.section, compareTasks);
  else {
    // Keep together: each family once, in its most urgent section.
    const families = new Map<string, Entry[]>();
    for (const entry of rest) { const top = chainOf.get(entry.task.id)![0] || entry.task; families.set(top.id, [...(families.get(top.id) || []), entry]); }
    const inRest = new Set(rest.flatMap(entry => [entry.task.id, ...chainOf.get(entry.task.id)!.map(ancestor => ancestor.id)]));
    // Subtasks with due dates come first, soonest first (a container by its soonest due
    // subtask); the rest, and ties, keep their manual order.
    const shownKids = (task: Task, path: Set<string>) => (childrenOf.get(task.id) || []).filter(child => shown.has(child.id) && inRest.has(child.id) && !path.has(child.id));
    const dueCache = new Map<string, number>();
    const dueOf = (task: Task, path: Set<string>): number => {
      if (!dueCache.has(task.id)) dueCache.set(task.id, Math.min(placementOf.get(task.id)?.due?.getTime() ?? Infinity, ...shownKids(task, path).map(child => dueOf(child, new Set(path).add(child.id)))));
      return dueCache.get(task.id)!;
    };
    const kids = (task: Task, path: Set<string>) => shownKids(task, path)
      .sort((a, b) => dueOf(a, new Set(path).add(a.id)) - dueOf(b, new Set(path).add(b.id)) || byOrder(a, b));
    for (const [topId, entries] of families) {
      const open = entries.filter(entry => entry.placement.section !== "completed");
      const pool = open.length ? open : entries;
      const section = pool.reduce((best, entry) => rank(entry.placement.section) < rank(best) ? entry.placement.section : best, pool[0].placement.section);
      const lead = pool.filter(entry => entry.placement.section === section).sort(compareTasks)[0];
      const grow = (task: Task, path: Set<string>): TreeNode => {
        const placement = placementOf.get(task.id);
        return {
          task, container: !placement, muted: !!placement && placement.section !== section, placement,
          children: kids(task, path).map(child => grow(child, new Set(path).add(child.id))),
        };
      };
      add(section, grow(byId.get(topId) as Task, new Set([topId])), lead);
    }
  }
  spread(onBoards, entry => boardKey(entry)!, compareAcross);

  const sections: Section[] = [];
  const keys = [...SECTION_ORDER.filter(id => bySection.has(id)), ...[...bySection.keys()].filter(id => !SECTION_ORDER.includes(id as SectionId))];
  for (const id of keys) {
    const builtIn = SECTION_ORDER.includes(id as SectionId);
    const entries = bySection.get(id)!.sort((a, b) => builtIn ? compareTasks(a.lead, b.lead) : compareAcross(a.lead, b.lead));
    const walk = (node: TreeNode): void => { finish(node); node.children.forEach(walk); };
    entries.forEach(entry => walk(entry.tree));
    sections.push({ id, trees: entries.map(entry => entry.tree), count: count(entries.map(entry => entry.tree)) });
  }
  return sections;
}

/** The board a task is on: its own, else the nearest one above it. (Boards are stored as groups.) */
export function taskGroupId(task: Task, byId: Map<string, Item>) {
  for (const entry of [task, ...ancestors(task, byId).reverse()]) {
    const board = entry.groupId ? byId.get(entry.groupId) : undefined;
    if (board?.kind === "group" && !board.builtin) return board.id;
  }
  return null;
}
