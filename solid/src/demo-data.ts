import { addDays, atTime, partsOf } from "./zone";
import type { CalendarEvent, CalendarRecord, Group, Item, Task, TimeWindow } from "./types";

// Sample items share this id prefix so they can be removed again in one step.
export const SAMPLE_PREFIX = "sample-";

/*
 * Sample data for trying the calendar: something in every List section and every Agenda
 * kind of row, on boards and off, with each kind of timing (can start, due, windows,
 * repeats, check-ins, push-down), subtasks a few ways (to compare Keep together with
 * Spread out), dependent tasks, events and records, and reminders. Times are relative to
 * now, so it can be added whenever. Notes on some say what they show.
 */
export function sampleItems(now = new Date()): Item[] {
  const at = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const id = (name: string) => SAMPLE_PREFIX + name;
  const hours = (count: number) => new Date(now.getTime() + count * 3_600_000).toISOString();
  // Some days from today, at a clock time.
  const day = (count: number, time = "09:00") => atTime(addDays(now, count), time).toISOString();
  // "HH:MM" some hours from now, kept within today.
  const hhmm = (offset: number) => {
    const minutes = Math.max(0, Math.min(23 * 60 + 59, Math.round((partsOf(now).hour * 60 + partsOf(now).minute + offset * 60) / 30) * 30));
    return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  };
  const every = [0, 1, 2, 3, 4, 5, 6];
  const window = (name: string, title: string, days: number[], start: string, end: string): TimeWindow => ({ id: id(name), kind: "window", title, days, start, end, createdAt: at, updatedAt: at });
  const board = (name: string, title: string): Group => ({ id: id(name), kind: "group", title, sortOrder: 0, createdAt: at, updatedAt: at });
  let order = 0;
  const task = (name: string, title: string, extra: Partial<Task> = {}): Task => ({
    id: id(name), kind: "task", title, state: "open", notes: "", tags: [], attachments: [], sortOrder: order++,
    createdAt: at, updatedAt: at, history: [{ at, type: "created" }], ...extra,
  });
  const event = (name: string, title: string, start: string, end: string, extra: Partial<CalendarEvent> = {}): CalendarEvent => ({ id: id(name), kind: "event", title, notes: "", tags: [], attachments: [], start, end, reminderMinutes: 30, createdAt: at, updatedAt: at, ...extra });
  const record = (name: string, title: string, start: string, extra: Partial<CalendarRecord> = {}): CalendarRecord => ({ id: id(name), kind: "record", title, notes: "", tags: [], attachments: [], start, end: null, createdAt: at, updatedAt: at, ...extra });
  const yesterday = day(-1, "15:00");

  return [
    window("business", "Business hours", [1, 2, 3, 4, 5], "09:00", "17:00"),
    window("counter", "Pharmacy counter", every, hhmm(-1), hhmm(2)),
    window("evening", "Support line", every, hhmm(3), hhmm(5)),
    board("finances", "Finances"), board("home", "Home"), board("health", "Health"), board("work", "Work"),

    // Deadline: overdue, due tonight, and due tonight through a container.
    task("registration", "Renew car registration", { groupId: id("home"), deadline: day(-1, "17:00"), tags: ["car"] }),
    task("phone", "Pay phone bill", { groupId: id("finances"), deadline: day(0, "23:00"), remindAt: [hours(1)], notes: "Has a reminder of its own, an hour after the samples were added." }),
    task("house", "Clean the house", { groupId: id("home"), deadline: day(0, "23:30"), notes: "Due tonight, so its rooms are too: both show under Deadline. Checking this off finishes both." }),
    task("room", "Clean my room", { parentId: id("house") }),
    task("kitchen", "Clean the kitchen", { parentId: id("house") }),

    // Closing today (a window open now) and Opens later today (a window opening later, and a can-start time).
    task("refill", "Call pharmacy about refill", { groupId: id("health"), windowId: id("counter") }),
    task("isp", "Call internet provider support", { groupId: id("home"), windowId: id("evening") }),
    task("pickup", "Pick up dry cleaning", { availableFrom: hours(2), tags: ["errand"] }),

    // Available: plain, tagged, due in a few days, and a family whose subtasks are all available.
    task("plants", "Water the plants", { groupId: id("home") }),
    task("goggles", "Buy new swim goggles", { tags: ["errand", "sport"] }),
    task("cover", "Draft cover letter", { groupId: id("work"), deadline: day(4, "17:00") }),
    task("dinner", "Plan birthday dinner", { groupId: id("home"), notes: "Both open subtasks are available, so either way they nest here. Finishing both finishes the dinner." }),
    task("restaurant", "Pick a restaurant", { parentId: id("dinner") }),
    task("invites", "Send invites", { parentId: id("dinner") }),
    // A finished subtask under an open task folds into "+1 completed".
    task("budget", "Set a budget", { parentId: id("dinner"), state: "completed", completedAt: yesterday }),

    // Subtasks with three timings: Spread out puts each in its own section; Keep together keeps the family in its most urgent one.
    task("passport", "Renew passport", { groupId: id("home"), notes: "Spread out: the form is Available, the photos Closing today, mailing Upcoming. Keep together: the whole family under Closing today, the other two dimmed." }),
    task("form", "Fill out form DS-82", { parentId: id("passport") }),
    task("photos", "Get passport photos", { parentId: id("passport"), windowId: id("counter") }),
    task("mail-form", "Mail the application", { parentId: id("passport"), availableFrom: day(2) }),

    // Three levels deep: the grandchild is due tonight, under two containers.
    task("move", "Apartment move", { groupId: id("home") }),
    task("utilities", "Sort out utilities", { parentId: id("move"), availableFrom: day(4) }),
    task("cancel", "Cancel old internet plan", { parentId: id("utilities"), deadline: day(0, "22:00") }),

    // Upcoming: a can-start date, and business hours from tomorrow.
    task("dentist", "Schedule dentist cleaning", { groupId: id("health"), availableFrom: day(3) }),
    task("dispute", "Dispute charge with bank", { groupId: id("finances"), windowId: id("business"), availableFrom: day(1, "08:00") }),

    // Repeats: monthly (kept until done), weekdays, and a daily check-in whose "Not yet" from day 10 starts a dependent task.
    task("card", "Pay credit card", { groupId: id("finances"), availableFrom: day(-29), deadline: day(1, "17:00"), repeat: { unit: "month", every: 1, until: null, untilDone: false, ifMissed: "keep" } }),
    task("mailbox", "Check the mail", { groupId: id("home"), availableFrom: day(0), repeat: { unit: "weekday", every: 1, until: null, untilDone: false, ifMissed: "skip" } }),
    task("balance", "Check credit balance", { groupId: id("finances"), availableFrom: day(0), notes: "A check-in: each day, Not yet or It happened. A Not yet from day 10 on starts the follow-up call.", repeat: { unit: "day", every: 1, until: null, untilDone: true, ifMissed: "skip" } }),
    task("followup", "Call to follow up on refund", { groupId: id("finances"), dependentOf: id("balance"), windowId: id("business"), relativeDates: { deadline: 2 }, startWhen: { on: "not-yet", after: day(10) }, stopParent: true }),
    // A dependent task that starts when its parent is done.
    task("report", "Write up the quarter", { groupId: id("work"), deadline: day(6, "17:00") }),
    task("send-report", "Send the report to the team", { groupId: id("work"), dependentOf: id("report"), relativeDates: { deadline: 1 }, startWhen: { on: "parent-done" } }),

    // Pushed down: until lifted, and until tomorrow.
    task("photos-sort", "Reorganize photos", { groupId: id("home"), pushedDown: { until: null, at } }),
    task("index-funds", "Read about index funds", { pushedDown: { until: day(1, "00:00"), at } }),

    // Completed.
    task("returned", "Return library books", { groupId: id("home"), state: "completed", completedAt: yesterday }),

    // Events: earlier today (past), later today (with its reminder), tomorrow, and later this week.
    event("standup", "Morning standup", day(0, "09:00"), day(0, "09:15"), { reminderMinutes: null, tags: ["work"] }),
    event("doctor", "Doctor's appointment", hours(3), hours(4), { notes: "Reminds 30 minutes before it starts. Leaves List once it starts." }),
    event("lunch", "Lunch with Sam", day(1, "12:30"), day(1, "13:30"), { reminderMinutes: 60 }),
    event("concert", "Concert", day(4, "20:00"), day(4, "22:30"), { reminderMinutes: 120, remindAt: [day(3, "18:00")] }),

    // Records: noted, nothing to do; on the Calendar and found by search.
    record("bank-letter", "Bank asked for statements", day(-1, "11:00"), { notes: "Only a record: not in the Agenda or List." }),
    record("meter", "Meter reading due", day(5, "08:00"), { reminderMinutes: 60 }),
  ];
}
