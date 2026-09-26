import { expect, test } from "bun:test";
import { completedTask, dependentGroupId, eventFromDraft, newTask, sleptTask, taskFromDraft, wokenTask, type TaskDraft } from "../src/item-changes";
import { groupPlacement, reorderPatches, ungroupPatches } from "../src/group-board";
import type { CalendarEvent, Group, Item, Task } from "../src/types";

const at = "2026-09-26T00:00:00.000Z";
const now = new Date("2026-09-26T12:00:00.000Z");
const task = (id: string, extra: Partial<Task> = {}): Task => ({ id, kind: "task", title: id, state: "open", createdAt: at, updatedAt: at, ...extra });
const group = (id: string, extra: Partial<Group> = {}): Group => ({ id, kind: "group", title: id, createdAt: at, updatedAt: at, ...extra });
const draft = (extra: Partial<TaskDraft> = {}): TaskDraft => ({
  title: "Write", notes: "", tags: [], attachments: [], state: "open", sleep: { mode: "awake" }, groupId: null,
  availableFrom: null, deadline: null, latestStart: null, schedule: null, relativeDates: {}, ...extra,
});

test("a new task is open, trimmed, and records its creation", () => {
  const created = newTask({ title: "  Call  ", groupId: "g" }, now);
  expect(created).toMatchObject({ kind: "task", title: "Call", state: "open", groupId: "g", createdAt: now.toISOString(), updatedAt: now.toISOString() });
  expect(created.history).toEqual([{ at: now.toISOString(), type: "created" }]);
});

test("completing a task ends its sleep and records the completion", () => {
  const done = completedTask(task("a", { sleep: { until: null, startedAt: at }, history: [{ at, type: "created" }] }), now);
  expect(done).toMatchObject({ state: "completed", completedAt: now.toISOString(), sleep: null });
  expect(done.history!.map(entry => entry.type)).toEqual(["created", "completed"]);
});

test("sleeping and waking record history", () => {
  const until = new Date("2026-09-27T00:00:00.000Z");
  const slept = sleptTask(task("a"), until, now);
  expect(slept.sleep).toEqual({ until: until.toISOString(), startedAt: now.toISOString() });
  expect(wokenTask(slept, now)).toMatchObject({ sleep: null, history: [{ type: "slept" }, { type: "woke" }] });
});

test("a dependent task goes in the group of its parent's top-level task", () => {
  const items: Item[] = [task("top", { groupId: "work" }), task("child", { parentId: "top" })];
  expect(dependentGroupId(items, items[1] as Task)).toBe("work");
});

test("a new task from a draft records its creation; a subtask ignores the chosen group", () => {
  const created = taskFromDraft(draft({ groupId: "home" }), { id: "n", previous: null, now, parentId: "p", dormant: false });
  expect(created).toMatchObject({ id: "n", parentId: "p", groupId: null, createdAt: now.toISOString(), history: [{ type: "created" }] });
});

test("editing a task records state and sleep changes", () => {
  const previous = task("a", { history: [{ at, type: "created" }] });
  const later = new Date("2026-09-28T00:00:00.000Z").toISOString();
  const edited = taskFromDraft(draft({ sleep: { mode: "until", until: later } }), { id: "a", previous, now, dormant: false });
  expect(edited.sleep).toEqual({ until: later, startedAt: now.toISOString() });
  expect(edited.history!.map(entry => entry.type)).toEqual(["created", "sleep-updated"]);
  const closed = taskFromDraft(draft({ state: "completed", sleep: { mode: "indefinite" } }), { id: "a", previous: edited, now, dormant: false });
  expect(closed).toMatchObject({ state: "completed", completedAt: now.toISOString(), sleep: null });
  expect(closed.history!.map(entry => entry.type)).toEqual(["created", "sleep-updated", "woke", "completed"]);
});

test("a sleep that already ended is dropped", () => {
  const edited = taskFromDraft(draft({ sleep: { mode: "until", until: at } }), { id: "a", previous: null, now, dormant: false });
  expect(edited.sleep).toBeNull();
});

test("only a dormant dependent task keeps its relative dates", () => {
  const previous = task("a", { dependentOf: "owner" });
  const input = draft({ relativeDates: { deadline: 2 } });
  expect(taskFromDraft(input, { id: "a", previous, now, dormant: true })).toMatchObject({ dependentOf: "owner", relativeDates: { deadline: 2 } });
  expect(taskFromDraft(input, { id: "a", previous, now, dormant: false })).toMatchObject({ dependentOf: null, relativeDates: null });
});

test("an event with one end lasts a day and keeps its creation time", () => {
  const previous: CalendarEvent = { id: "e", kind: "event", title: "Old", createdAt: at, updatedAt: at };
  const event = eventFromDraft({ title: "Trip", notes: "", tags: [], attachments: [], start: "2026-10-01T09:00:00.000Z", end: null }, { id: "e", previous, now });
  expect(event).toMatchObject({ title: "Trip", end: "2026-10-02T09:00:00.000Z", createdAt: at, updatedAt: now.toISOString() });
});

test("a group moved to the top level starts a new column; a subgroup goes last", () => {
  const items: Item[] = [group("a", { boardColumn: 0, sortOrder: 0 }), group("b", { parentId: "a", sortOrder: 0 })];
  expect(groupPlacement(items, null)).toEqual({ parentId: null, boardColumn: 1, sortOrder: 0 });
  expect(groupPlacement(items, "a")).toEqual({ parentId: "a", sortOrder: 1 });
});

test("reordering swaps a group with its neighbour", () => {
  const items: Item[] = [group("p"), group("x", { parentId: "p", sortOrder: 0 }), group("y", { parentId: "p", sortOrder: 1 })];
  expect(reorderPatches(items, items[2] as Group, -1).map(({ group, patch }) => [group.id, patch.sortOrder])).toEqual([["y", 0], ["x", 1]]);
  expect(reorderPatches(items, items[1] as Group, -1)).toEqual([]);
});

test("deleting a group moves its subgroups and tasks to its parent", () => {
  const items: Item[] = [group("p"), group("g", { parentId: "p" }), group("sub", { parentId: "g" }), task("t", { groupId: "g" })];
  const { groups, tasks } = ungroupPatches(items, items[1] as Group);
  expect(groups.map(({ group, patch }) => [group.id, patch.parentId])).toEqual([["sub", "p"]]);
  expect(tasks.map(({ task, patch }) => [task.id, patch.groupId])).toEqual([["t", "p"]]);
});
