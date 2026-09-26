import { expect, test } from "bun:test";
import { boardColumns, boardEntries, buildBoard, groupOptions, layoutPatches, nextColumnKey, placeGroup } from "../src/group-board";
import { projectDependents, startedTask } from "../src/dependencies";
import type { Group, Item, Task } from "../src/types";

const at = "2026-09-26T00:00:00.000Z";
const group = (id: string, parentId: string | null = null, sortOrder?: number): Group => ({ id, kind: "group", title: id, parentId, sortOrder, createdAt: at, updatedAt: at });
const task = (id: string, extra: Partial<Task> = {}): Task => ({ id, kind: "task", title: id, state: "open", createdAt: at, updatedAt: at, ...extra });
const titles = (nodes: { task: Task }[]) => nodes.map(node => node.task.title);

test("tasks sit under their group, subtasks under their task, the rest in no group", () => {
  const items: Item[] = [group("work"), group("home"), task("a", { groupId: "work" }), task("b", { parentId: "a" }), task("c"), task("d", { groupId: "missing" })];
  const board = buildBoard(items, () => true);
  expect(titles(board.ungrouped)).toEqual(["c", "d"]);
  const work = board.groups.find(node => node.group.id === "work")!;
  expect(titles(work.tasks)).toEqual(["a"]);
  expect(titles(work.tasks[0].children)).toEqual(["b"]);
});

test("groups nest and keep their manual order", () => {
  const board = buildBoard([group("b", null, 2), group("a", null, 1), group("child", "a")], () => true);
  expect(board.groups.map(node => node.group.id)).toEqual(["a", "b"]);
  expect(board.groups[0].groups.map(node => node.group.id)).toEqual(["child"]);
});

test("a cycle of groups stays visible at the top level", () => {
  const board = buildBoard([group("x", "y"), group("y", "x")], () => true);
  const ids = [...board.groups.map(node => node.group.id), ...board.groups.flatMap(node => node.groups.map(child => child.group.id))];
  expect(ids.sort()).toEqual(["x", "y"]);
});

test("a filtered-out task stays when one of its subtasks matches", () => {
  const board = buildBoard([task("parent"), task("match", { parentId: "parent" }), task("other")], item => item.title === "match");
  expect(titles(board.ungrouped)).toEqual(["parent"]);
  expect(titles(board.ungrouped[0].children)).toEqual(["match"]);
});

test("group options list the tree in order and can exclude a subtree", () => {
  const items = [group("a", null, 1), group("a1", "a"), group("b", null, 2)];
  expect(groupOptions(items).map(option => [option.group.id, option.depth])).toEqual([["a", 0], ["a1", 1], ["b", 0]]);
  expect(groupOptions(items, new Set(["a"])).map(option => option.group.id)).toEqual(["b"]);
});

test("top-level groups stack in columns; older groups get a column each", () => {
  const stacked = [{ ...group("a", null, 0), boardColumn: 0 }, { ...group("b", null, 1), boardColumn: 0 }, { ...group("c", null, 0), boardColumn: 3 }];
  expect(boardColumns(stacked)).toEqual([["a", "b"], ["c"]]);
  expect(boardColumns([group("x", null, 0), group("y", null, 1)])).toEqual([["x"], ["y"]]);
  expect(nextColumnKey(stacked)).toBe(4);
});

test("placing a group moves it between columns, into new columns, and drops empty ones", () => {
  const columns = [["a", "b"], ["c"]];
  expect(placeGroup(columns, "c", { column: 0, index: 1 })).toEqual([["a", "c", "b"]]);
  expect(placeGroup(columns, "a", { column: 0, index: 2 })).toEqual([["b", "a"], ["c"]]);
  expect(placeGroup(columns, "b", { newColumn: 0 })).toEqual([["b"], ["a"], ["c"]]);
  expect(placeGroup(columns, "a", { newColumn: 2 })).toEqual([["b"], ["c"], ["a"]]);
  const groups = [group("a", null, 0), group("b", null, 1), group("c", null, 2)];
  expect(layoutPatches([["b", "a"], ["c"]], groups).map(({ group, patch }) => [group.id, patch])).toEqual([["b", { boardColumn: 0, sortOrder: 0 }], ["a", { boardColumn: 0, sortOrder: 1 }], ["c", { boardColumn: 1, sortOrder: 0 }]]);
});

test("built-in sections start leftmost, are created when first moved, and never count as user groups", () => {
  const items: Item[] = [{ ...group("work", null, 0), boardColumn: 0 }];
  expect(boardColumns(boardEntries(items))).toEqual([["builtin-available", "builtin-upcoming", "builtin-sleeping"], ["builtin-ungrouped"], ["work"]]);
  const moved = placeGroup(boardColumns(boardEntries(items)), "builtin-sleeping", { column: 2, index: 1 });
  const patches = layoutPatches(moved, items);
  const sleeping = patches.find(entry => entry.group.id === "builtin-sleeping")!;
  expect(sleeping).toMatchObject({ create: true, patch: { boardColumn: 2, sortOrder: 1 }, group: { kind: "group", builtin: "sleeping" } });
  const patched = new Map(patches.map(entry => [entry.group.id, { ...entry.group, ...entry.patch }]));
  const stored = [...items.map(item => patched.get(item.id) || item), ...patches.filter(entry => entry.create).map(entry => patched.get(entry.group.id)!)];
  expect(boardColumns(boardEntries(stored))).toEqual(moved);
  expect(groupOptions(stored).map(option => option.group.id)).toEqual(["work"]);
  expect(buildBoard(stored, () => true).groups.map(node => node.group.id)).toEqual(["work"]);
});

test("dependent tasks show under their parent task until started, then in their own group", () => {
  const dependent = task("check mailbox", { groupId: "home", dependentOf: "balance" });
  const board = buildBoard([group("home"), task("balance"), dependent], () => true);
  expect(titles(board.ungrouped)).toEqual(["balance"]);
  expect(titles(board.ungrouped[0].dependents)).toEqual(["check mailbox"]);
  expect(board.groups[0].tasks).toEqual([]);
  const started = startedTask({ ...dependent, relativeDates: { availableFrom: 0, deadline: 4 } }, new Date("2026-10-07T12:00:00.000Z"));
  expect(started).toMatchObject({ dependentOf: null, relativeDates: null, availableFrom: null, deadline: "2026-10-11T12:00:00.000Z" });
  expect(titles(buildBoard([group("home"), task("balance"), started], () => true).groups[0].tasks)).toEqual(["check mailbox"]);
  const openOnly = (item: Task) => item.state !== "completed";
  expect(buildBoard([task("balance", { state: "completed" }), dependent], openOnly).ungrouped).toEqual([]);
});

test("the calendar's what-if view starts dependent tasks on their parent task's latest date, through chains", () => {
  const items: Item[] = [task("balance", { deadline: "2026-10-10T12:00:00.000Z" }), task("mailbox", { dependentOf: "balance", relativeDates: { deadline: 4 } }), task("deposit", { dependentOf: "mailbox", relativeDates: { availableFrom: 1 } })];
  const projected = projectDependents(items, new Date(at));
  expect(projected.get("mailbox")!.deadline).toBe("2026-10-14T12:00:00.000Z");
  expect(projected.get("deposit")!.availableFrom).toBe("2026-10-15T12:00:00.000Z");
});
