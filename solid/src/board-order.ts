import { sortedGroups } from "./group-board";
import type { SectionId } from "./today";
import type { Group, Item } from "./types";

/*
 * The Boards view shows your boards and the built-in ones (Firm, Closing today, …) as
 * columns in one saved order that covers every board, including those not showing now
 * (an empty built-in one is hidden). Each board's place is its `boardOrder`; a built-in
 * board is stored as a group with that `builtin` key once it has been moved.
 */
export const BUILTIN_BOARDS: { key: SectionId; id: string; order: number }[] = [
  { key: "firm", id: "builtin-firm", order: 0 },
  { key: "closing", id: "builtin-closing", order: 1 },
  { key: "later", id: "builtin-later", order: 2 },
  { key: "available", id: "builtin-available", order: 3 },
  // Your boards default to here, between Available and Upcoming.
  { key: "upcoming", id: "builtin-upcoming", order: 1000 },
  { key: "completed", id: "builtin-completed", order: 1001 },
];

/** Every board's key in order: a built-in board's section id, or your board's id. */
export function boardOrder(items: Item[]): string[] {
  const stored = new Map(items.filter((item): item is Group => item.kind === "group" && !!item.builtin).map(group => [group.builtin, group.boardOrder]));
  const builtIn = BUILTIN_BOARDS.map(entry => ({ key: entry.key as string, order: stored.get(entry.key) ?? entry.order }));
  // A board not yet placed (new, or from before boards had an order) goes just before
  // Upcoming, in the order boards had on the old board page.
  const upcoming = builtIn.find(entry => entry.key === "upcoming")!.order;
  const unplaced = sortedGroups(items).filter(board => board.boardOrder == null)
    .sort((a, b) => (a.boardColumn ?? 0) - (b.boardColumn ?? 0) || (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.createdAt.localeCompare(b.createdAt));
  const mine = sortedGroups(items).map(board => ({ key: board.id, order: board.boardOrder ?? upcoming - 1 + (unplaced.indexOf(board) + 1) / (unplaced.length + 1) }));
  return [...builtIn, ...mine].sort((a, b) => a.order - b.order).map(entry => entry.key);
}

/** Your boards, in their saved order. */
export function userBoards(items: Item[]): Group[] {
  const boards = new Map(sortedGroups(items).map(board => [board.id, board]));
  return boardOrder(items).flatMap(key => boards.get(key) ?? []);
}

/**
 * The full order after dropping `moved` at `index` among the boards on screen: it goes
 * right after the visible board it landed behind (or right before the first one), so
 * boards that aren't showing keep their places relative to everything else.
 */
export function reorderedBoards(order: string[], visible: string[], moved: string, index: number): string[] {
  const shown = visible.filter(key => key !== moved);
  const next = order.filter(key => key !== moved);
  const at = index <= 0 ? next.indexOf(shown[0]) : next.indexOf(shown[Math.min(index, shown.length) - 1]) + 1;
  next.splice(at < 0 ? next.length : at, 0, moved);
  return next;
}

/** What to store so the boards come in `order`: each place as its boardOrder, creating built-in rows as needed. */
export function boardOrderPatches(items: Item[], order: string[]) {
  const groups = new Map(items.filter((item): item is Group => item.kind === "group").map(group => [group.id, group]));
  const at = new Date().toISOString();
  return order.flatMap((key, boardOrder) => {
    const builtIn = BUILTIN_BOARDS.find(entry => entry.key === key);
    const stored = groups.get(builtIn ? builtIn.id : key);
    if (stored?.boardOrder === boardOrder) return [];
    if (stored) return [{ group: stored, patch: { boardOrder }, create: false }];
    if (!builtIn) return [];
    const group: Group = { id: builtIn.id, kind: "group", title: builtIn.key, builtin: builtIn.key, parentId: null, createdAt: at, updatedAt: at };
    return [{ group, patch: { boardOrder }, create: true }];
  });
}
