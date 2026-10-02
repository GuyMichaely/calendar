import { sortedGroups } from "./boards";
import type { SectionId } from "./today";
import type { Group, Item } from "./types";

/*
 * The Boards view arranges your boards and the built-in ones (Firm, Closing today, …) in
 * columns, several stacked in a column. One saved layout covers every board, including
 * those not showing now (an empty built-in one is hidden): each board stores its column
 * (`layoutColumn`) and its place in that column (`layoutRow`). A built-in board is stored
 * as a group with that `builtin` key once it has been moved.
 */
export const BUILTIN_BOARDS: { key: SectionId; id: string; column: number; row: number }[] = [
  { key: "firm", id: "builtin-firm", column: 0, row: 0 },
  { key: "closing", id: "builtin-closing", column: 0, row: 1 },
  { key: "later", id: "builtin-later", column: 0, row: 2 },
  { key: "available", id: "builtin-available", column: 1, row: 0 },
  // Your boards default to columns between Available and Upcoming.
  { key: "upcoming", id: "builtin-upcoming", column: 1000, row: 0 },
  { key: "completed", id: "builtin-completed", column: 1001, row: 0 },
];

export type BoardLayout = string[][];

/** Every board's key (a built-in board's section id, or your board's id), by column, top to bottom. */
export function boardLayout(items: Item[]): BoardLayout {
  const stored = new Map(items.filter((item): item is Group => item.kind === "group" && !!item.builtin).map(group => [group.builtin, group]));
  const places = BUILTIN_BOARDS.map((entry, index) => {
    const saved = stored.get(entry.key);
    return { key: entry.key as string, column: saved?.layoutColumn ?? entry.column, row: saved?.layoutRow ?? entry.row, tie: index };
  });
  // A board not yet placed (a new one) gets a column of its own just before Upcoming's.
  const upcoming = places.find(entry => entry.key === "upcoming")!.column;
  const boards = sortedGroups(items);
  const unplaced = boards.filter(board => board.layoutColumn == null).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  boards.forEach((board, index) => places.push({
    key: board.id,
    column: board.layoutColumn ?? upcoming - 1 + (unplaced.indexOf(board) + 1) / (unplaced.length + 1),
    row: board.layoutRow ?? 0,
    tie: BUILTIN_BOARDS.length + index,
  }));
  const columns = new Map<number, typeof places>();
  for (const place of places) columns.set(place.column, [...(columns.get(place.column) || []), place]);
  return [...columns].sort(([a], [b]) => a - b).map(([, column]) => column.sort((a, b) => a.row - b.row || a.tie - b.tie).map(place => place.key));
}

/** Your boards, column by column, top to bottom. */
export function userBoards(items: Item[]): Group[] {
  const boards = new Map(sortedGroups(items).map(board => [board.id, board]));
  return boardLayout(items).flat().flatMap(key => boards.get(key) ?? []);
}

export type BoardTarget = { column: number; index: number } | { newColumn: number };

/**
 * The full layout after dropping `moved` on a spot in the layout on screen (`shown`,
 * which leaves out hidden boards and still holds `moved`): into a column it goes right
 * after the board above the spot, or right before the one below; as a new column, right
 * after the column on its left, or before the first. Hidden boards keep their places.
 */
export function placeBoard(layout: BoardLayout, shown: BoardLayout, moved: string, target: BoardTarget): BoardLayout {
  const next = layout.map(column => column.filter(key => key !== moved));
  const columnOf = (key: string) => next.findIndex(column => column.includes(key));
  if ("column" in target) {
    const keys = shown[target.column] || [];
    const above = keys.slice(0, target.index).filter(key => key !== moved).at(-1);
    const below = keys.slice(target.index).find(key => key !== moved);
    if (above) { const column = next[columnOf(above)]; column.splice(column.indexOf(above) + 1, 0, moved); }
    else if (below) { const column = next[columnOf(below)]; column.splice(column.indexOf(below), 0, moved); }
    else return layout;
  } else {
    const left = shown[target.newColumn - 1]?.find(key => key !== moved);
    const right = shown.slice(target.newColumn).flat().find(key => key !== moved);
    const at = left != null ? columnOf(left) + 1 : right != null ? columnOf(right) : next.length;
    next.splice(at, 0, [moved]);
  }
  return next.filter(column => column.length);
}

export function sameLayout(a: BoardLayout, b: BoardLayout) {
  return a.length === b.length && a.every((column, index) => column.length === b[index].length && column.every((key, row) => key === b[index][row]));
}

/** What to store so the boards sit as in `layout`, creating built-in rows as needed. */
export function boardLayoutPatches(items: Item[], layout: BoardLayout) {
  const groups = new Map(items.filter((item): item is Group => item.kind === "group").map(group => [group.id, group]));
  const at = new Date().toISOString();
  return layout.flatMap((column, layoutColumn) => column.flatMap((key, layoutRow) => {
    const builtIn = BUILTIN_BOARDS.find(entry => entry.key === key);
    const stored = groups.get(builtIn ? builtIn.id : key);
    if (stored?.layoutColumn === layoutColumn && stored.layoutRow === layoutRow) return [];
    if (stored) return [{ group: stored, patch: { layoutColumn, layoutRow }, create: false }];
    if (!builtIn) return [];
    const group: Group = { id: builtIn.id, kind: "group", title: builtIn.key, builtin: builtIn.key, createdAt: at, updatedAt: at };
    return [{ group, patch: { layoutColumn, layoutRow }, create: true }];
  }));
}
