import { expect, test } from "bun:test";
import { boardOrder, boardOrderPatches, reorderedBoards } from "../src/board-order";
import type { Group, Item } from "../src/types";

const at = "2026-09-01T00:00:00.000Z";
const board = (id: string, extra: Partial<Group> = {}): Group => ({ id, kind: "group", title: id, parentId: null, createdAt: at, updatedAt: at, ...extra });

test("boards go between Available and Upcoming until placed, in their old board-page order", () => {
  const items: Item[] = [board("notes", { boardColumn: 2 }), board("support", { boardColumn: 1 })];
  expect(boardOrder(items)).toEqual(["firm", "closing", "later", "available", "support", "notes", "upcoming", "completed"]);
});

test("a drop lands next to the visible board it was dropped beside; hidden boards keep their places", () => {
  const order = ["firm", "closing", "later", "available", "upcoming", "completed"];
  // Firm hidden: dragging Available to the front puts it just before Closing today, so Firm stays first.
  expect(reorderedBoards(order, ["closing", "later", "available", "upcoming", "completed"], "available", 0)).toEqual(["firm", "available", "closing", "later", "upcoming", "completed"]);
  // Dropped after Opens later today (index 2 among the others on screen).
  expect(reorderedBoards(order, ["closing", "later", "available", "upcoming"], "available", 2)).toEqual(["firm", "closing", "later", "available", "upcoming", "completed"]);
  expect(reorderedBoards(order, ["firm", "closing", "available"], "firm", 3)).toEqual(["closing", "later", "available", "firm", "upcoming", "completed"]);
});

test("storing an order writes each board's place, creating built-in rows once", () => {
  const items: Item[] = [board("notes")];
  const patches = boardOrderPatches(items, ["notes", "firm", "closing", "later", "available", "upcoming", "completed"]);
  expect(patches.map(entry => [entry.group.id, entry.patch.boardOrder, entry.create])).toEqual([
    ["notes", 0, false], ["builtin-firm", 1, true], ["builtin-closing", 2, true], ["builtin-later", 3, true], ["builtin-available", 4, true], ["builtin-upcoming", 5, true], ["builtin-completed", 6, true],
  ]);
  const stored: Item[] = [{ ...board("notes"), boardOrder: 0 }, ...patches.filter(entry => entry.create).map(entry => ({ ...entry.group, ...entry.patch }))];
  expect(boardOrder(stored)).toEqual(["notes", "firm", "closing", "later", "available", "upcoming", "completed"]);
  expect(boardOrderPatches(stored, boardOrder(stored))).toEqual([]);
});
