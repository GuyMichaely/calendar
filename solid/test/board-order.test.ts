import { expect, test } from "bun:test";
import { boardLayout, boardLayoutPatches, placeBoard } from "../src/board-order";
import type { Group, Item } from "../src/types";

const at = "2026-09-01T00:00:00.000Z";
const board = (id: string, extra: Partial<Group> = {}): Group => ({ id, kind: "group", title: id, parentId: null, createdAt: at, updatedAt: at, ...extra });

test("boards not yet placed get columns before Upcoming, keeping their old board-page columns", () => {
  const items: Item[] = [board("notes", { boardColumn: 3, sortOrder: 1 }), board("ideas", { boardColumn: 3, sortOrder: 0 }), board("support", { boardColumn: 1 })];
  expect(boardLayout(items)).toEqual([["firm", "closing", "later"], ["available"], ["support"], ["ideas", "notes"], ["upcoming"], ["completed"]]);
});

test("a drop lands next to the visible board it's dropped beside; hidden boards keep their places", () => {
  const layout = [["firm", "closing", "later"], ["available"], ["notes"], ["upcoming"], ["completed"]];
  // Firm and Opens later today are hidden.
  const shown = [["closing"], ["available"], ["notes"], ["upcoming"], ["completed"]];
  // Stack Notes above Closing today: right before it, so Firm stays on top.
  expect(placeBoard(layout, shown, "notes", { column: 0, index: 0 })).toEqual([["firm", "notes", "closing", "later"], ["available"], ["upcoming"], ["completed"]]);
  // Below Closing today: right after it, above the hidden Opens later today.
  expect(placeBoard(layout, shown, "notes", { column: 0, index: 1 })).toEqual([["firm", "closing", "notes", "later"], ["available"], ["upcoming"], ["completed"]]);
  // A new column before everything, and one between Available and Notes (which changes nothing).
  expect(placeBoard(layout, shown, "available", { newColumn: 0 })).toEqual([["available"], ["firm", "closing", "later"], ["notes"], ["upcoming"], ["completed"]]);
  expect(placeBoard(layout, shown, "notes", { newColumn: 2 })).toEqual(layout);
  // Pulling Opens later today's column mate out into its own column after Upcoming.
  expect(placeBoard(layout, shown, "closing", { newColumn: 4 })).toEqual([["firm", "later"], ["available"], ["notes"], ["upcoming"], ["closing"], ["completed"]]);
});

test("storing a layout writes each board's column and row, creating built-in rows once", () => {
  const items: Item[] = [board("notes")];
  const layout = [["notes", "firm"], ["closing", "later", "available"], ["upcoming", "completed"]];
  const patches = boardLayoutPatches(items, layout);
  expect(patches.map(entry => [entry.group.id, entry.patch.layoutColumn, entry.patch.layoutRow, entry.create])).toEqual([
    ["notes", 0, 0, false], ["builtin-firm", 0, 1, true], ["builtin-closing", 1, 0, true], ["builtin-later", 1, 1, true], ["builtin-available", 1, 2, true], ["builtin-upcoming", 2, 0, true], ["builtin-completed", 2, 1, true],
  ]);
  const stored: Item[] = [{ ...board("notes"), layoutColumn: 0, layoutRow: 0 }, ...patches.filter(entry => entry.create).map(entry => ({ ...entry.group, ...entry.patch }))];
  expect(boardLayout(stored)).toEqual(layout);
  expect(boardLayoutPatches(stored, layout)).toEqual([]);
});

test("boards that never had a column get one each", () => {
  const items: Item[] = [board("b", { createdAt: "2026-09-02T00:00:00.000Z" }), board("a")];
  expect(boardLayout(items)).toEqual([["firm", "closing", "later"], ["available"], ["a"], ["b"], ["upcoming"], ["completed"]]);
});
