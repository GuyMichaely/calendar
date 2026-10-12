import { RELATIVE_DATE_FIELDS, type RelativeDateField } from "./dependencies";
import { eventFromDraft, recordFromDraft, taskFromDraft } from "./item-changes";
import { pushedDownInfo } from "./today";
import type { Attachment, CalendarEvent, CalendarRecord, Item, Repeat, Task, TaskState } from "./types";
import { atTime, fromInputValue, inputToIso, partsOf, startOfDay, toInputValue } from "./zone";

/** What the editor edits: a task, an event (a set time to be somewhere), or a record (noted at a time). */
export type Editable = Task | CalendarEvent | CalendarRecord;

/**
 * What the editor's fields hold: an item as the form shows it, which needn't be one that can be
 * saved yet (a blank title, a count still being typed). Times are local input values
 * ("YYYY-MM-DDTHH:mm", "" for none) and text is as typed. The task fields and the event fields
 * are both kept, so switching kind back and forth loses nothing.
 */
export type Draft = {
  kind: Editable["kind"];
  title: string;
  notes: string;
  tags: string;
  state: TaskState;
  availableFrom: string;
  deadline: string;
  windowId: string;
  // Suppressed, until pushUntil if it's set (otherwise until lifted).
  pushed: boolean;
  pushUntil: string;
  // "" for not repeating.
  repeatUnit: string;
  repeatEvery: string;
  repeatMissed: "skip" | "keep";
  repeatUntil: string;
  repeatUntilDone: boolean;
  // A dormant dependent task's automatic start ("" for when you start it).
  startWhen: "" | "parent-done" | "not-yet";
  startAfter: string;
  stopParent: boolean;
  start: string;
  end: string;
  remindAt: string[];
} & { [F in RelativeDateField as `${F}Mode`]: "date" | "after" } & { [F in RelativeDateField as `${F}After`]: string };

const HOUR = 60 * 60 * 1000;
// An event's or record's times left off: a start at midnight, an end at 11:59 PM (whole days).
export const dayStart = (date: Date) => !partsOf(date).hour && !partsOf(date).minute;
export const dayEnd = (date: Date) => partsOf(date).hour === 23 && partsOf(date).minute === 59;

/** A new event notifies as long before it starts as the calendar's settings say (none for a whole day, a task or a record). */
export function defaultReminders(draft: Pick<Draft, "kind" | "start">, notifyBefore: number | null) {
  const start = draft.kind === "event" && notifyBefore != null ? fromInputValue(draft.start) : null;
  return start && !dayStart(start) ? [toInputValue(new Date(start.getTime() - notifyBefore! * 60_000))] : [];
}

/** A new item's draft: an event or record at 9:00 on the day it was started from (else now), an event for an hour. */
export function blankDraft(kind: Editable["kind"], { date, notifyBefore }: { date?: Date; notifyBefore: number | null }, now: Date): Draft {
  const start = date ? atTime(date, "09:00") : now;
  const draft: Draft = {
    kind, title: "", notes: "", tags: "", state: "open",
    availableFrom: "", deadline: "", availableFromMode: "date", deadlineMode: "date", availableFromAfter: "0", deadlineAfter: "0",
    windowId: "", pushed: false, pushUntil: "",
    repeatUnit: "", repeatEvery: "1", repeatMissed: "skip", repeatUntil: "", repeatUntilDone: false,
    startWhen: "", startAfter: "", stopParent: true,
    start: toInputValue(start), end: kind === "record" ? "" : toInputValue(new Date(start.getTime() + HOUR)), remindAt: [],
  };
  return { ...draft, remindAt: defaultReminders(draft, notifyBefore) };
}

/** A stored item as the editor shows it; what it doesn't have (an event's times on a task) comes from `blank`. */
export function draftOf(item: Editable | null, blank: Draft, now: Date): Draft {
  if (!item) return blank;
  const shared: Draft = { ...blank, kind: item.kind, title: item.title ?? "", notes: item.notes ?? "", tags: (item.tags || []).join(", "), remindAt: (item.remindAt || []).map(time => toInputValue(time)) };
  if (item.kind !== "task") return { ...shared, start: toInputValue(item.start), end: toInputValue(item.end) };
  const push = pushedDownInfo(item, now);
  const relative = Object.fromEntries(RELATIVE_DATE_FIELDS.flatMap(field => [[`${field}Mode`, item.relativeDates?.[field] != null ? "after" : "date"], [`${field}After`, String(item.relativeDates?.[field] ?? 0)]]));
  return {
    ...shared, ...relative,
    state: item.state,
    availableFrom: toInputValue(item.availableFrom),
    deadline: toInputValue(item.deadline),
    windowId: item.windowId || "",
    pushed: push.pushed,
    pushUntil: toInputValue(push.until),
    repeatUnit: item.repeat?.unit || "",
    repeatEvery: String(item.repeat?.every ?? 1),
    repeatMissed: item.repeat?.ifMissed ?? "skip",
    repeatUntil: toInputValue(item.repeat?.until),
    repeatUntilDone: !!item.repeat?.untilDone,
    startWhen: item.startWhen?.on || "",
    startAfter: toInputValue(item.startWhen?.on === "not-yet" ? item.startWhen.after : null),
    stopParent: item.stopParent !== false,
  };
}

/**
 * Setting one end of an event fills in a missing other end an hour away, and moves it there when
 * it would come out on the wrong side. A record's end is optional: it's only moved. Leaving the
 * times off makes it all day: a start without one ends that day (11:59 PM), and giving the start
 * a time again brings the end back to an hour after it.
 */
export function withStart(draft: Draft, value: string): Draft {
  const before = fromInputValue(draft.start), start = fromInputValue(value), end = fromInputValue(draft.end);
  const next = { ...draft, start: value };
  if (!start) return next;
  const missing = !end && draft.kind === "event";
  if (dayStart(start)) return missing || (end && (end < start || !dayEnd(end))) ? { ...next, end: toInputValue(atTime(start, "23:59")) } : next;
  return missing || (end && end < start) || (end && dayEnd(end) && before && dayStart(before)) ? { ...next, end: toInputValue(new Date(start.getTime() + HOUR)) } : next;
}

export function withEnd(draft: Draft, value: string): Draft {
  const start = fromInputValue(draft.start), end = fromInputValue(value);
  const next = { ...draft, end: value };
  if (!end || (draft.start && !(start && start > end))) return next;
  return { ...next, start: toInputValue(dayEnd(end) ? startOfDay(end) : new Date(end.getTime() - HOUR)) };
}

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

/** The fields where two drafts differ. */
export function changedFields(a: Draft, b: Draft) {
  return (Object.keys(a) as (keyof Draft)[]).filter(field => !same(a[field], b[field]));
}

/**
 * The draft on a newer version of its item: each field that changed from `before` to `after`
 * (the old and new stored versions) takes the new value, unless the draft has changed it from
 * `base` (what it started from), which keeps it.
 */
export function rebased(draft: Draft, base: Draft, before: Draft, after: Draft): Draft {
  const next = { ...draft } as Record<keyof Draft, unknown>;
  for (const field of changedFields(before, after)) if (same(draft[field], base[field])) next[field] = after[field];
  return next as Draft;
}

// A number as typed: blank (the default), or at least `min` in steps of `step`.
const fits = (value: string, min: number, step: number) => !value.trim() || (Number.isFinite(Number(value)) && Number(value) >= min && Number.isInteger((Number(value) - min) / step));

/** Why the draft can't be saved yet, if it can't. `dormant`: a dependent task that hasn't started (its dates can be days after starting). */
export function draftProblem(draft: Draft, dormant: boolean) {
  if (!draft.title.trim()) return "Enter a title to save.";
  if (draft.kind === "task") {
    const counts = [draft.repeatUnit ? fits(draft.repeatEvery, 1, 1) : true, ...RELATIVE_DATE_FIELDS.map(field => !dormant || draft[`${field}Mode`] === "date" || fits(draft[`${field}After`], 0, 0.5))];
    if (counts.includes(false)) return "Complete the required fields to save.";
  } else if (draft.kind === "record" ? !draft.start : !draft.start && !draft.end) return `Choose when the ${draft.kind} starts.`;
  return "";
}

export const parseTags = (value: string) => value.split(",").map(tag => tag.trim()).filter(Boolean);

/** The item a draft describes, to store. `previous`: the stored item it was edited from (null for a new one). */
export function itemFromDraft(draft: Draft, { id, previous, now, parentId, dormant, groupId, attachments }: { id: string; previous: Item | null; now: Date; parentId?: string | null; dormant: boolean; groupId: string | null; attachments: Attachment[] }): Editable {
  const shared = { title: draft.title.trim(), notes: draft.notes, tags: parseTags(draft.tags), attachments, remindAt: draft.remindAt.map(value => inputToIso(value)).filter((time): time is NonNullable<typeof time> => !!time) };
  const context = { id, previous, now };
  if (draft.kind !== "task") {
    const times = { ...shared, start: inputToIso(draft.start), end: inputToIso(draft.end) };
    return draft.kind === "record" ? recordFromDraft(times, context) : eventFromDraft(times, context);
  }
  // A date set as days after starting has no date of its own until then.
  const after = (field: RelativeDateField) => dormant && draft[`${field}Mode`] === "after";
  const relativeDates: Partial<Record<RelativeDateField, number>> = {};
  for (const field of RELATIVE_DATE_FIELDS) if (after(field)) relativeDates[field] = Math.max(0, Number(draft[`${field}After`]) || 0);
  const until = inputToIso(draft.pushUntil);
  return taskFromDraft({
    ...shared,
    state: draft.state,
    pushedDown: !draft.pushed ? { mode: "normal" } : until ? { mode: "until", until } : { mode: "indefinite" },
    groupId,
    availableFrom: after("availableFrom") ? null : inputToIso(draft.availableFrom),
    deadline: after("deadline") ? null : inputToIso(draft.deadline),
    windowId: draft.windowId || null,
    relativeDates,
    repeat: draft.repeatUnit ? { unit: draft.repeatUnit as Repeat["unit"], every: Math.max(1, Math.round(Number(draft.repeatEvery) || 1)), until: inputToIso(draft.repeatUntil), untilDone: draft.repeatUntilDone, ifMissed: draft.repeatMissed } : null,
    ...(dormant ? { startWhen: draft.startWhen === "parent-done" ? { on: "parent-done" as const } : draft.startWhen === "not-yet" ? { on: "not-yet" as const, after: inputToIso(draft.startAfter) } : null, stopParent: draft.stopParent } : {}),
  }, { ...context, parentId, dormant });
}
