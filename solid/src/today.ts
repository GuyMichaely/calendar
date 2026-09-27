import { isDormant } from "./dependencies";
import { nextOpening, openingOn, taskSchedule } from "./windows";
import type { Item, Task, TimeWindow } from "./types";

/*
 * The Today view puts every task in exactly one section, by the first rule that fits:
 * due and past its warning time (Firm); a window open now (Closing today) or opening
 * later today (Opens later today); can't start yet (Upcoming); flagged Anytime; else
 * Available. Pushed-down tasks stay in their section, at the bottom.
 */
export type SectionId = "firm" | "closing" | "later" | "available" | "anytime" | "upcoming" | "completed";
export const SECTION_ORDER: SectionId[] = ["firm", "closing", "later", "available", "anytime", "upcoming", "completed"];

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

const HOUR = 3_600_000;
const time = (value?: string | null) => { if (!value) return null; const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date; };
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** When a due task starts warning: its own warning time, or 24 hours before it's due. */
export function warnTime(task: Task) {
  const due = time(task.deadline);
  return due ? time(task.warnAt) ?? new Date(due.getTime() - 24 * HOUR) : null;
}

/** Pushed down (legacy sleep counts), and until when. */
export function pushedDownInfo(task: Task, now: Date) {
  const pushed = task.pushedDown ?? (task.sleep ? { until: task.sleep.until, at: task.sleep.startedAt } : null);
  if (!pushed || task.state === "completed") return { pushed: false, until: null as Date | null };
  const until = time(pushed.until);
  return until && until <= now ? { pushed: false, until: null } : { pushed: true, until };
}

export function placeTask(task: Task, now: Date, windows: Map<string, TimeWindow>): Placement {
  const pushed = pushedDownInfo(task, now).pushed;
  if (task.state === "completed") return { section: "completed", pushed: false };
  const due = time(task.deadline) ?? undefined;
  const warn = warnTime(task);
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
  return { section: task.anytime ? "anytime" : "available", due, pushed };
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
  for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] < kb[i] ? -1 : 1;
  return a.task.createdAt.localeCompare(b.task.createdAt) || a.task.id.localeCompare(b.task.id);
}

// A section is a forest. Context rows are ancestors shown only to explain where a
// subtask belongs: dimmed, openable, not checkable here.
//
// Subtasks are shown one of two ways, set for the view and overridable per top task:
// "context" (Spread out) places every task by its own timing, with its ancestors as
// context rows; "nested" (Keep together) shows each family once, in the most urgent
// section any of its open tasks belongs to, dimming (but not hiding) the tasks whose
// own timing is less urgent.
export type TreeNode = { task: Task; context: boolean; muted?: boolean; placement?: Placement; children: TreeNode[] };
export type SubtaskMode = "context" | "nested";

export type Section = { id: SectionId; trees: TreeNode[]; count: number };

/** How a family's subtasks are shown: its top task's own choice, else the view's. */
export function familyMode(top: Task, fallback: SubtaskMode): SubtaskMode {
  return top.subtaskLayout === "together" ? "nested" : top.subtaskLayout === "spread" ? "context" : fallback;
}

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

export function buildSections(items: Item[], now: Date, options: { mode: SubtaskMode; showCompleted: boolean; include: (task: Task) => boolean }): Section[] {
  const byId = new Map(items.map(item => [item.id, item]));
  const windows = new Map(items.filter((item): item is TimeWindow => item.kind === "window").map(item => [item.id, item]));
  // Dependent tasks that haven't started live in their parent's editor, not in the lists.
  const tasks = items.filter((item): item is Task => item.kind === "task" && !isDormant(item, byId));
  const placed = tasks.map(task => ({ task, placement: placeTask(task, now, windows) }))
    .filter(entry => (options.showCompleted || entry.placement.section !== "completed") && options.include(entry.task));
  const placementOf = new Map(placed.map(entry => [entry.task.id, entry.placement]));
  const shown = new Set(placed.map(entry => entry.task.id));
  const count = (nodes: TreeNode[]): number => nodes.reduce((total, node) => total + (node.context || node.muted ? 0 : 1) + count(node.children), 0);
  // Every tree remembers the task that decides its place in the section order.
  const bySection = new Map<SectionId, { tree: TreeNode; lead: { task: Task; placement: Placement } }[]>();
  const add = (section: SectionId, tree: TreeNode, lead: { task: Task; placement: Placement }) => bySection.set(section, [...(bySection.get(section) || []), { tree, lead }]);
  const top = (task: Task) => ancestors(task, byId)[0] || task;
  const spread = placed.filter(entry => familyMode(top(entry.task), options.mode) === "context");
  const together = placed.filter(entry => familyMode(top(entry.task), options.mode) === "nested");

  // Spread out: each task in its own section, under context rows for ancestors that aren't.
  for (const id of SECTION_ORDER) {
    const entries = spread.filter(entry => entry.placement.section === id).sort(compareTasks);
    const inSection = new Set(entries.map(entry => entry.task.id));
    const nodes = new Map<string, TreeNode>();
    for (const entry of entries) {
      let siblings: TreeNode[] | null = null;
      for (const ancestor of ancestors(entry.task, byId)) {
        let node = nodes.get(ancestor.id);
        if (!node) {
          node = { task: ancestor, context: !inSection.has(ancestor.id), placement: inSection.has(ancestor.id) ? placementOf.get(ancestor.id) : undefined, children: [] };
          nodes.set(ancestor.id, node);
          if (siblings) siblings.push(node); else add(id, node, entry);
        }
        siblings = node.children;
      }
      const existing = nodes.get(entry.task.id);
      if (existing) { existing.context = false; existing.placement = entry.placement; continue; }
      const node: TreeNode = { task: entry.task, context: false, placement: entry.placement, children: [] };
      nodes.set(entry.task.id, node);
      if (siblings) siblings.push(node); else add(id, node, entry);
    }
  }

  // Keep together: each family once, in its most urgent section.
  const childrenOf = new Map<string, Task[]>();
  for (const { task } of together) { const parent = taskParent(task, byId); if (parent && shown.has(parent.id)) childrenOf.set(parent.id, [...(childrenOf.get(parent.id) || []), task]); }
  // Subtasks keep their manual order under their parent.
  const kids = (task: Task, path: Set<string>) => (childrenOf.get(task.id) || []).filter(child => !path.has(child.id))
    .sort((a, b) => (a.sortOrder ?? Infinity) - (b.sortOrder ?? Infinity) || a.createdAt.localeCompare(b.createdAt));
  const members = (task: Task, path = new Set([task.id])): Task[] => [task, ...kids(task, path).flatMap(child => members(child, new Set(path).add(child.id)))];
  const rank = (id: SectionId) => SECTION_ORDER.indexOf(id);
  for (const root of together.filter(entry => { const parent = taskParent(entry.task, byId); return !parent || !shown.has(parent.id); })) {
    const all = members(root.task).map(task => ({ task, placement: placementOf.get(task.id)! }));
    const open = all.filter(entry => entry.placement.section !== "completed");
    const pool = open.length ? open : all;
    const section = pool.reduce((best, entry) => rank(entry.placement.section) < rank(best) ? entry.placement.section : best, pool[0].placement.section);
    const lead = pool.filter(entry => entry.placement.section === section).sort(compareTasks)[0];
    const grow = (task: Task, path: Set<string>): TreeNode => ({
      task, context: false, muted: placementOf.get(task.id)!.section !== section, placement: placementOf.get(task.id),
      children: kids(task, path).map(child => grow(child, new Set(path).add(child.id))),
    });
    add(section, grow(root.task, new Set([root.task.id])), lead);
  }

  const sections: Section[] = [];
  for (const id of SECTION_ORDER) {
    const entries = (bySection.get(id) || []).sort((a, b) => compareTasks(a.lead, b.lead));
    if (entries.length) sections.push({ id, trees: entries.map(entry => entry.tree), count: count(entries.map(entry => entry.tree)) });
  }
  return sections;
}

/** The group a task is filed under: its top-level ancestor's. */
export function taskGroupId(task: Task, byId: Map<string, Item>) {
  const top = ancestors(task, byId)[0] || task;
  const group = top.groupId ? byId.get(top.groupId) : undefined;
  return group?.kind === "group" ? group.id : null;
}
