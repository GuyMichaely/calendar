import { expect, test } from "bun:test";
import { blankDraft, changedFields, withDefaultReminders, draftOf, draftProblem, itemFromDraft, rebased, withEnd, withStart, type Draft } from "../src/editor-draft";
import type { CalendarEvent, Task } from "../src/types";
import { fromInputValue, toInputValue } from "../src/zone";

const at = "2026-09-26T00:00:00.000Z";
const now = new Date("2026-09-26T12:00:00.000Z");
const blank = blankDraft("task", { notifyBefore: null }, now);
const task = (extra: Partial<Task> = {}): Task => ({ id: "t", kind: "task", title: "Call dentist", state: "open", createdAt: at, updatedAt: at, ...extra });
const event = (extra: Partial<CalendarEvent> = {}): CalendarEvent => ({ id: "e", kind: "event", title: "Lunch", start: "2026-09-27T12:00:00.000Z", end: "2026-09-27T13:00:00.000Z", createdAt: at, updatedAt: at, ...extra });
const context = { id: "t", now, dormant: false, groupId: null, attachments: [] };
const local = (iso: string) => toInputValue(iso);

test("a task survives the trip through the editor's fields unchanged", () => {
  const stored = task({
    notes: "**hi**", tags: ["a", "b"], deadline: "2026-10-01T23:59:00.000Z", availableFrom: "2026-09-28T09:00:00.000Z", windowId: "w",
    repeat: { unit: "week", every: 2, until: "2026-12-01T00:00:00.000Z", untilDone: true, ifMissed: "keep" }, remindAt: ["2026-09-30T08:00:00.000Z"],
    pushedDown: { until: "2026-09-29T00:00:00.000Z", at }, history: [{ at, type: "created" }],
  });
  const draft = draftOf(stored, blank, now);
  expect(draft).toMatchObject({ title: "Call dentist", tags: "a, b", pushed: true, pushUntil: local("2026-09-29T00:00:00.000Z"), repeatUnit: "week", repeatEvery: "2", repeatMissed: "keep", repeatUntilDone: true });
  const saved = itemFromDraft(draft, { ...context, previous: stored }) as Task;
  expect({ ...saved, updatedAt: at }).toEqual({ ...stored, parentId: null, groupId: null, attachments: [], completedAt: null, dependentOf: null, relativeDates: null });
});

test("an event's times and reminders survive the trip, and a new one notifies before it starts", () => {
  const stored = event({ remindAt: ["2026-09-27T11:50:00.000Z"] });
  const draft = draftOf(stored, blank, now);
  expect(itemFromDraft(draft, { ...context, id: "e", previous: stored })).toMatchObject({ kind: "event", start: stored.start, end: stored.end, remindAt: stored.remindAt });
  const fresh = blankDraft("event", { date: new Date("2026-09-27T00:00:00.000Z"), notifyBefore: 10 }, now);
  expect(fresh.remindAt).toEqual([toInputValue(new Date(fromInputValue(fresh.start)!.getTime() - 10 * 60_000))]);
});

test("what the draft saves: trimmed title, parsed tags, a count left blank as its default", () => {
  const draft: Draft = { ...blank, title: "  Write  ", tags: " x, ,y ", repeatUnit: "day", repeatEvery: "", pushed: true, pushUntil: "" };
  expect(itemFromDraft(draft, { ...context, previous: null })).toMatchObject({ title: "Write", tags: ["x", "y"], repeat: { unit: "day", every: 1 }, pushedDown: { until: null } });
});

test("a draft that can't be saved says why", () => {
  expect(draftProblem({ ...blank, title: " " }, false)).toBe("Enter a title to save.");
  expect(draftProblem({ ...blank, title: "a", repeatUnit: "day", repeatEvery: "1.5" }, false)).toBe("Complete the required fields to save.");
  expect(draftProblem({ ...blank, title: "a", repeatUnit: "", repeatEvery: "0" }, false)).toBe("");
  expect(draftProblem({ ...blank, title: "a", deadlineMode: "after", deadlineAfter: "-1" }, true)).toBe("Complete the required fields to save.");
  expect(draftProblem({ ...blank, title: "a", deadlineMode: "after", deadlineAfter: "1.5" }, true)).toBe("");
  expect(draftProblem({ ...blank, kind: "record", title: "a", start: "" }, false)).toBe("Choose when the record starts.");
});

test("a dormant dependent task's dates can be days after starting", () => {
  const stored = task({ dependentOf: "p", relativeDates: { deadline: 2 } });
  const draft = draftOf(stored, blank, now);
  expect(draft).toMatchObject({ deadlineMode: "after", deadlineAfter: "2", availableFromMode: "date" });
  expect(itemFromDraft({ ...draft, deadline: "2026-10-01T10:00" }, { ...context, previous: stored, dormant: true })).toMatchObject({ relativeDates: { deadline: 2 }, deadline: null, dependentOf: "p" });
});

test("a newer version reaches the fields that weren't changed here, and only those", () => {
  const before = draftOf(task({ title: "Call dentist", deadline: "2026-10-01T10:00:00.000Z" }), blank, now);
  const after = draftOf(task({ title: "Call dentist re: crown", deadline: "2026-10-02T10:00:00.000Z", tags: ["health"] }), blank, now);
  // Edited here: the deadline. Untouched: the title (shown with a trailing space as typed) and the tags.
  const base = { ...before, title: "Call dentist " };
  const draft = { ...base, deadline: "2026-10-05T10:00" };
  const next = rebased(draft, base, before, after);
  expect(next).toMatchObject({ title: "Call dentist re: crown", tags: "health", deadline: "2026-10-05T10:00" });
  expect(changedFields(next, draft).sort()).toEqual(["tags", "title"]);
  // Nothing changed elsewhere: the draft stays as typed.
  expect(rebased(draft, base, before, before)).toEqual(draft);
});

test("setting one end of an event keeps the other on the right side of it", () => {
  const draft: Draft = { ...blank, kind: "event", start: "2026-09-27T10:00", end: "2026-09-27T11:00" };
  expect(withStart(draft, "2026-09-27T12:00").end).toBe("2026-09-27T13:00");
  expect(withStart(draft, "2026-09-27T09:00").end).toBe("2026-09-27T11:00");
  expect(withStart(draft, "2026-09-28T00:00").end).toBe("2026-09-28T23:59");
  expect(withEnd(draft, "2026-09-27T09:00").start).toBe("2026-09-27T08:00");
  expect(withEnd({ ...draft, start: "" }, "2026-09-27T23:59").start).toBe("2026-09-27T00:00");
});

test("a new event's notification follows its start until it's changed, and a change from elsewhere is kept", () => {
  const fresh = blankDraft("event", { date: new Date("2026-09-27T00:00:00.000Z"), notifyBefore: 30 }, now);
  const moved = withDefaultReminders(fresh, withStart(fresh, "2026-09-28T15:00"), 30);
  expect(moved.remindAt).toEqual(["2026-09-28T14:30"]);
  // Chosen by hand (or brought from elsewhere): moving the start leaves it.
  const chosen = { ...moved, remindAt: ["2026-09-28T09:00"] };
  expect(withDefaultReminders(chosen, withStart(chosen, "2026-09-29T15:00"), 30).remindAt).toEqual(["2026-09-28T09:00"]);
  // A new task has none; made an event, it gets the default.
  const task = blankDraft("task", { notifyBefore: 30 }, now);
  expect(withDefaultReminders(task, { ...task, kind: "event", start: "2026-09-28T15:00" }, 30).remindAt).toEqual(["2026-09-28T14:30"]);
  // An existing item (no default) is left alone.
  expect(withDefaultReminders(fresh, withStart(fresh, "2026-09-28T15:00"), null).remindAt).toEqual(fresh.remindAt);
});
