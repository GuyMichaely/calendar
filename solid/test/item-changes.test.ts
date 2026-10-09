import { expect, test } from "bun:test";
import { completedTask, dependentGroupId, eventFromDraft, liftedTask, newTask, pushedTask, taskFromDraft, type TaskDraft } from "../src/item-changes";
import type { CalendarEvent, Group, Item, Task } from "../src/types";

const at = "2026-09-26T00:00:00.000Z";
const now = new Date("2026-09-26T12:00:00.000Z");
const task = (id: string, extra: Partial<Task> = {}): Task => ({ id, kind: "task", title: id, state: "open", createdAt: at, updatedAt: at, ...extra });
const group = (id: string, extra: Partial<Group> = {}): Group => ({ id, kind: "group", title: id, createdAt: at, updatedAt: at, ...extra });
const draft = (extra: Partial<TaskDraft> = {}): TaskDraft => ({
  title: "Write", notes: "", tags: [], attachments: [], state: "open", pushedDown: { mode: "normal" }, groupId: null,
  availableFrom: null, deadline: null, windowId: null, relativeDates: {}, ...extra,
});

test("a new task is open, trimmed, and records its creation", () => {
  const created = newTask({ title: "  Call  ", groupId: "g" }, now);
  expect(created).toMatchObject({ kind: "task", title: "Call", state: "open", groupId: "g", createdAt: now.toISOString(), updatedAt: now.toISOString() });
  expect(created.history).toEqual([{ at: now.toISOString(), type: "created" }]);
});

test("completing a task lifts it and records the completion", () => {
  const done = completedTask(task("a", { pushedDown: { until: null, at }, history: [{ at, type: "created" }] }), now);
  expect(done).toMatchObject({ state: "completed", completedAt: now.toISOString(), pushedDown: null });
  expect(done.history!.map(entry => entry.type)).toEqual(["created", "completed"]);
});

test("pushing down and lifting record history", () => {
  const until = new Date("2026-09-27T00:00:00.000Z");
  const pushed = pushedTask(task("a"), until, now);
  expect(pushed).toMatchObject({ pushedDown: { until: until.toISOString(), at: now.toISOString() } });
  expect(liftedTask(pushed, now)).toMatchObject({ pushedDown: null, history: [{ type: "pushed-down" }, { type: "lifted" }] });
});

test("a dependent task goes in the group of its parent's top-level task", () => {
  const items: Item[] = [task("top", { groupId: "work" }), task("child", { parentId: "top" })];
  expect(dependentGroupId(items, items[1] as Task)).toBe("work");
});

test("a new task from a draft records its creation; a subtask can have a board of its own", () => {
  const created = taskFromDraft(draft({ groupId: "home" }), { id: "n", previous: null, now, parentId: "p", dormant: false });
  expect(created).toMatchObject({ id: "n", parentId: "p", groupId: "home", createdAt: now.toISOString(), history: [{ type: "created" }] });
});

test("editing a task records state and push-down changes", () => {
  const previous = task("a", { history: [{ at, type: "created" }] });
  const later = new Date("2026-09-28T00:00:00.000Z").toISOString();
  const edited = taskFromDraft(draft({ pushedDown: { mode: "until", until: later } }), { id: "a", previous, now, dormant: false });
  expect(edited.pushedDown).toEqual({ until: later, at: now.toISOString() });
  expect(edited.history!.map(entry => entry.type)).toEqual(["created", "pushed-down"]);
  // Saving without a change records nothing.
  expect(taskFromDraft(draft({ pushedDown: { mode: "until", until: later } }), { id: "a", previous: edited, now, dormant: false }).history!.length).toBe(2);
  const closed = taskFromDraft(draft({ state: "completed", pushedDown: { mode: "indefinite" } }), { id: "a", previous: edited, now, dormant: false });
  expect(closed).toMatchObject({ state: "completed", completedAt: now.toISOString(), pushedDown: null });
  expect(closed.history!.map(entry => entry.type)).toEqual(["created", "pushed-down", "lifted", "completed"]);
});

test("a push down keeps when it started; an ended push is dropped", () => {
  const pushed = task("a", { history: [{ at, type: "created" }], pushedDown: { until: null, at } });
  const saved = taskFromDraft(draft({ pushedDown: { mode: "indefinite" }, windowId: "w" }), { id: "a", previous: pushed, now, dormant: false });
  expect(saved).toMatchObject({ pushedDown: { until: null, at }, windowId: "w" });
  expect(saved.history || []).toEqual([{ at, type: "created" }]);
  expect(taskFromDraft(draft({ pushedDown: { mode: "until", until: at } }), { id: "a", previous: null, now, dormant: false }).pushedDown).toBeNull();
});

test("only a dormant dependent task keeps its relative dates", () => {
  const previous = task("a", { dependentOf: "owner" });
  const input = draft({ relativeDates: { deadline: 2 } });
  expect(taskFromDraft(input, { id: "a", previous, now, dormant: true })).toMatchObject({ dependentOf: "owner", relativeDates: { deadline: 2 } });
  expect(taskFromDraft(input, { id: "a", previous, now, dormant: false })).toMatchObject({ dependentOf: null, relativeDates: null });
});

test("an event with one end lasts an hour and keeps its creation time", () => {
  const previous: CalendarEvent = { id: "e", kind: "event", title: "Old", createdAt: at, updatedAt: at };
  const event = eventFromDraft({ title: "Trip", notes: "", tags: [], attachments: [], start: "2026-10-01T09:00:00.000Z", end: null }, { id: "e", previous, now });
  expect(event).toMatchObject({ title: "Trip", end: "2026-10-01T10:00:00.000Z", createdAt: at, updatedAt: now.toISOString() });
});
