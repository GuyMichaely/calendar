import { expect, test } from "bun:test";
import { blankDraft, changedFields, noticeDraft, withKind, draftOf, draftProblem, itemFromDraft, rebased, withEnd, withStart, type Draft } from "../src/editor-draft";
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
    repeat: { unit: "week", every: 2, until: "2026-12-01T00:00:00.000Z", untilDone: true, ifMissed: "keep" }, notifications: [{ minutes: 1440 }, { minutes: 90, of: "due" }],
    pushedDown: { until: "2026-09-29T00:00:00.000Z", at }, history: [{ at, type: "created" }],
  });
  const draft = draftOf(stored, blank, now);
  expect(draft).toMatchObject({ title: "Call dentist", tags: "a, b", pushed: true, pushUntil: local("2026-09-29T00:00:00.000Z"), repeatUnit: "week", repeatEvery: "2", repeatMissed: "keep", repeatUntilDone: true });
  const saved = itemFromDraft(draft, { ...context, previous: stored }) as Task;
  expect({ ...saved, updatedAt: at }).toEqual({ ...stored, parentId: null, groupId: null, attachments: [], completedAt: null, dependentOf: null, relativeDates: null });
});

test("an event's times and reminders survive the trip, and a new one notifies before it starts", () => {
  const stored = event({ notifications: [{ minutes: 10 }] });
  const draft = draftOf(stored, blank, now);
  expect(itemFromDraft(draft, { ...context, id: "e", previous: stored })).toMatchObject({ kind: "event", start: stored.start, end: stored.end, notifications: [{ minutes: 10 }] });
  const fresh = blankDraft("event", { date: new Date("2026-09-27T00:00:00.000Z"), notifyBefore: 10 }, now);
  expect(fresh.notifications).toEqual([{ amount: "10", unit: "minutes", of: "start" }]);
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

test("a notification reads in the largest whole unit, and saves as minutes (only a task's can be before it's due)", () => {
  expect([0, 45, 90, 120, 1440, 2880, 10_080].map(minutes => noticeDraft(minutes)).map(({ amount, unit }) => `${amount} ${unit}`)).toEqual(["0 minutes", "45 minutes", "90 minutes", "2 hours", "1 days", "2 days", "1 weeks"]);
  const draft: Draft = { ...blank, title: "a", deadline: "2026-10-01T10:00", notifications: [{ amount: "1.5", unit: "hours", of: "due" }, { amount: "2", unit: "days", of: "start" }, { amount: "1.5", unit: "hours", of: "due" }] };
  expect(itemFromDraft(draft, { ...context, previous: null }).notifications).toEqual([{ minutes: 2880 }, { minutes: 90, of: "due" }]);
  expect(itemFromDraft({ ...draft, kind: "event" }, { ...context, previous: null }).notifications).toEqual([{ minutes: 2880 }, { minutes: 90 }]);
  expect(draftProblem({ ...draft, notifications: [{ amount: "", unit: "hours", of: "start" }] }, false)).toBe("Complete the required fields to save.");
  expect(draftProblem({ ...draft, notifications: [{ amount: "NaN", unit: "hours", of: "start" }] }, false)).toBe("Complete the required fields to save.");
});

test("a new item switched to an event gets the usual notification, unless its list was changed", () => {
  const task = blankDraft("task", { notifyBefore: 30 }, now);
  expect(task.notifications).toEqual([]);
  const made = withKind(task, "event", 30);
  expect(made.notifications).toEqual([{ amount: "30", unit: "minutes", of: "start" }]);
  expect(withKind(made, "task", 30).notifications).toEqual([]);
  const chosen = { ...made, notifications: [{ amount: "1", unit: "hours" as const, of: "start" as const }] };
  expect(withKind(chosen, "task", 30).notifications).toEqual(chosen.notifications);
  // An existing item (no usual one): kept as it is.
  expect(withKind(task, "event", null).notifications).toEqual([]);
});
