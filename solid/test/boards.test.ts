import { expect, test } from "bun:test";
import { boardTasks, deleteBoardPatches, sortedGroups, taskPlacePatches, taskSiblings } from "../src/boards";
import { projectDependents } from "../src/dependencies";
import type { Group, Item, Task } from "../src/types";

const at = "2026-09-26T00:00:00.000Z";
const task = (id: string, extra: Partial<Task> = {}): Task => ({ id, kind: "task", title: id, state: "open", createdAt: at, updatedAt: at, ...extra });
const group = (id: string, extra: Partial<Group> = {}): Group => ({ id, kind: "group", title: id, createdAt: at, updatedAt: at, ...extra });

test("your boards leave out the stored built-in ones", () => {
  expect(sortedGroups([group("b", { sortOrder: 1 }), group("a", { sortOrder: 0 }), group("builtin-firm", { builtin: "firm" })]).map(board => board.id)).toEqual(["a", "b"]);
});

test("taskSiblings lists a board's top level or a task's children, in order", () => {
  const items: Item[] = [
    group("work"),
    task("a", { groupId: "work", sortOrder: 1 }), task("b", { groupId: "work", sortOrder: 0 }),
    task("kid", { parentId: "a" }), task("loose"),
    task("waiting", { dependentOf: "a" }), // dormant dependents are not siblings
  ];
  expect(taskSiblings(items, null, "work").map(t => t.id)).toEqual(["b", "a"]);
  expect(taskSiblings(items, "a", null).map(t => t.id)).toEqual(["kid"]);
  expect(taskSiblings(items, null, null).map(t => t.id)).toEqual(["loose"]);
});

test("taskPlacePatches nests, un-nests, moves between boards, and indexes a task among new siblings", () => {
  const items: Item[] = [
    group("work"), group("home"),
    task("a", { groupId: "work", sortOrder: 0 }), task("b", { groupId: "work", sortOrder: 1 }),
    task("kid", { parentId: "a", sortOrder: 0 }),
  ];
  const [a, b, kid] = items.filter(item => item.kind === "task") as Task[];
  const clear = { dependentOf: null, relativeDates: null };
  expect(taskPlacePatches(items, b, a.id, null).map(({ task: t, patch }) => [t.id, patch]))
    .toEqual([["b", { sortOrder: 1, parentId: "a", groupId: null, ...clear }]]);
  expect(taskPlacePatches(items, b, null, "home").map(({ task: t, patch }) => [t.id, patch]))
    .toEqual([["b", { sortOrder: 0, parentId: null, groupId: "home", ...clear }]]);
  expect(taskPlacePatches(items, kid, null, "work", 0).map(({ task: t, patch }) => [t.id, patch]))
    .toEqual([["kid", { sortOrder: 0, parentId: null, groupId: "work", ...clear }], ["a", { sortOrder: 1 }], ["b", { sortOrder: 2 }]]);
});

test("deleting a board leaves its tasks on no board", () => {
  const items: Item[] = [group("g"), task("t", { groupId: "g" }), task("other", { groupId: "h" })];
  expect(deleteBoardPatches(items, items[0] as Group).map(({ task, patch }) => [task.id, patch.groupId])).toEqual([["t", null]]);
});

test("deleting a board with its tasks takes their subtasks and dependent tasks too", () => {
  const items: Item[] = [
    group("g"),
    task("t", { groupId: "g" }), task("kid", { parentId: "t", groupId: "h" }), task("next", { dependentOf: "t" }),
    task("own", { parentId: "elsewhere", groupId: "g" }), task("elsewhere", { groupId: "h" }), task("loose"),
  ];
  expect(boardTasks(items, items[0] as Group).map(t => t.id).sort()).toEqual(["kid", "next", "own", "t"]);
});

test("the calendar's what-if view starts dependent tasks on their parent task's latest date, through chains", () => {
  const items: Item[] = [task("balance", { deadline: "2026-10-10T12:00:00.000Z" }), task("mailbox", { dependentOf: "balance", relativeDates: { deadline: 4 } }), task("deposit", { dependentOf: "mailbox", relativeDates: { availableFrom: 1 } })];
  const projected = projectDependents(items, new Date(at));
  expect(projected.get("mailbox")!.deadline).toBe("2026-10-14T12:00:00.000Z");
  expect(projected.get("deposit")!.availableFrom).toBe("2026-10-15T12:00:00.000Z");
});
