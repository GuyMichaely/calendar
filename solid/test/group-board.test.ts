import { expect, test } from "bun:test";
import { buildBoard, groupOptions } from "../src/group-board";
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
