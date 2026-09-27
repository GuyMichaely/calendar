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
// In "Under parent" mode a tree sits in its most urgent section: tasks that don't
// belong there are muted (dimmed, still checkable) when they lead to one that does,
// and otherwise folded into their parent's `hidden` list ("+2 subtasks").
export type TreeNode = { task: Task; context: boolean; muted?: boolean; placement?: Placement; children: TreeNode[]; hidden?: TreeNode[] };
export type SubtaskMode = "context" | "nested";

export type Section = { id: SectionId; trees: TreeNode[]; count: number };

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
  const sections: Section[] = [];

  if (options.mode === "context") {
    const bySection = new Map<SectionId, typeof placed>();
    for (const entry of placed) bySection.set(entry.placement.section, [...(bySection.get(entry.placement.section) || []), entry]);
    for (const id of SECTION_ORDER) {
      const entries = (bySection.get(id) || []).sort(compareTasks);
      if (!entries.length) continue;
      const trees: TreeNode[] = [], nodes = new Map<string, TreeNode>();
      const inSection = new Set(entries.map(entry => entry.task.id));
      for (const { task, placement } of entries) {
        let siblings = trees;
        for (const ancestor of ancestors(task, byId)) {
          let node = nodes.get(ancestor.id);
          if (!node) { node = { task: ancestor, context: !inSection.has(ancestor.id), placement: inSection.has(ancestor.id) ? placementOf.get(ancestor.id) : undefined, children: [] }; nodes.set(ancestor.id, node); siblings.push(node); }
          siblings = node.children;
        }
        const existing = nodes.get(task.id);
        if (existing) { existing.context = false; existing.placement = placement; continue; }
        const node: TreeNode = { task, context: false, placement, children: [] };
        nodes.set(task.id, node);
        siblings.push(node);
      }
      sections.push({ id, trees, count: count(trees) });
    }
    return sections;
  }

  // Under parent: each top task's whole tree goes to the most urgent section any of its
  // tasks belongs to (open tasks only, unless all are completed).
  const childrenOf = new Map<string, Task[]>();
  for (const { task } of placed) { const parent = taskParent(task, byId); if (parent && shown.has(parent.id)) childrenOf.set(parent.id, [...(childrenOf.get(parent.id) || []), task]); }
  // Subtasks keep their manual order under their parent.
  const kids = (task: Task, path: Set<string>) => (childrenOf.get(task.id) || []).filter(child => !path.has(child.id))
    .sort((a, b) => (a.sortOrder ?? Infinity) - (b.sortOrder ?? Infinity) || a.createdAt.localeCompare(b.createdAt));
  const members = (task: Task, path = new Set([task.id])): Task[] => [task, ...kids(task, path).flatMap(child => members(child, new Set(path).add(child.id)))];
  const plain = (task: Task, path: Set<string>): TreeNode => ({ task, context: false, placement: placementOf.get(task.id), children: kids(task, path).map(child => plain(child, new Set(path).add(child.id))) });
  const rank = (id: SectionId) => SECTION_ORDER.indexOf(id);
  const bySection = new Map<SectionId, { tree: TreeNode; lead: { task: Task; placement: Placement } }[]>();
  for (const root of placed.filter(entry => { const parent = taskParent(entry.task, byId); return !parent || !shown.has(parent.id); })) {
    const all = members(root.task).map(task => ({ task, placement: placementOf.get(task.id)! }));
    const open = all.filter(entry => entry.placement.section !== "completed");
    const pool = open.length ? open : all;
    const section = pool.reduce((best, entry) => rank(entry.placement.section) < rank(best) ? entry.placement.section : best, pool[0].placement.section);
    const lead = pool.filter(entry => entry.placement.section === section).sort(compareTasks)[0];
    const build = (task: Task, path: Set<string>): { node: TreeNode; relevant: boolean } => {
      const built = kids(task, path).map(child => ({ child, ...build(child, new Set(path).add(child.id)) }));
      const belongs = placementOf.get(task.id)!.section === section;
      const hidden = built.filter(entry => !entry.relevant).map(entry => plain(entry.child, new Set(path).add(entry.child.id)));
      return {
        relevant: belongs || built.some(entry => entry.relevant),
        node: { task, context: false, muted: !belongs, placement: placementOf.get(task.id), children: built.filter(entry => entry.relevant).map(entry => entry.node), ...(hidden.length ? { hidden } : {}) },
      };
    };
    bySection.set(section, [...(bySection.get(section) || []), { tree: build(root.task, new Set([root.task.id])).node, lead }]);
  }
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
