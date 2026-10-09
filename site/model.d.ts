export type TaskState = "open" | "completed";

export type Attachment = {
  id: string;
  name: string;
  type?: string;
  size?: number;
  blob?: Blob;
};

export type HistoryEntry = {
  at: string;
  type: string;
  until?: string | null;
  [key: string]: unknown;
};

export type BaseItem = {
  id: string;
  title: string;
  notes?: string;
  tags?: string[];
  attachments?: Attachment[];
  createdAt: string;
  updatedAt: string;
};

export type Task = BaseItem & {
  kind: "task";
  state: TaskState;
  parentId?: string | null;
  sortOrder?: number;
  availableFrom?: string | null;
  deadline?: string | null;
  // Kept in its section but moved to the bottom, dimmed; until null means until lifted.
  pushedDown?: PushedDown | null;
  windowId?: string | null;
  // How its finished subtasks show while it's open: dimmed ("show") or folded into "+N completed" (default).
  completedSubtasks?: "show" | null;
  // Repeats: its Can start and Due are the current occurrence's (see solid/src/repeats.ts).
  repeat?: Repeat | null;
  // A dependent task that starts by itself: when its parent task is done, or on a
  // "Not yet" check-in on the parent on or after a date.
  startWhen?: { on: "parent-done" } | { on: "not-yet"; after: string | null } | null;
  // With a "not-yet" start: whether starting it also finishes the parent (default yes).
  stopParent?: boolean | null;
  completedAt?: string | null;
  // Notifies at these times (ISO), besides when it can start.
  remindAt?: string[] | null;
  history?: HistoryEntry[];
  // Only top-level tasks use this; subtasks appear wherever their parent task is.
  groupId?: string | null;
  // A dependent task: prepared under another task and dormant until started, which clears this.
  dependentOf?: string | null;
  // A dependent task's dates as days after it is started; they become fixed dates when it starts.
  relativeDates?: RelativeDates | null;
};

export type RelativeDates = {
  availableFrom?: number | null;
  deadline?: number | null;
};

export type CalendarEvent = BaseItem & {
  kind: "event";
  start?: string | null;
  end?: string | null;
  // Notifies at these times (ISO); a new one starts with the calendar's eventReminderMinutes before it starts.
  remindAt?: string[] | null;
};

// Something noted at a time, for the record (the bank asked for papers that day): on the
// Calendar and found by search, but nothing to do, so not in the Agenda or List. It can still
// notify you, at the times you choose. Its end is optional.
export type CalendarRecord = BaseItem & {
  kind: "record";
  start?: string | null;
  end?: string | null;
  remindAt?: string[] | null;
};

// A board. Built-in boards (Firm, Available, …) are stored as groups with a `builtin` key only to remember their place.
export type Group = BaseItem & {
  kind: "group";
  // Order in lists of boards.
  sortOrder?: number;
  builtin?: "firm" | "closing" | "later" | "available" | "upcoming" | "completed";
  // Its place in the Boards view's layout (built-in boards included): column, then row.
  layoutColumn?: number;
  layoutRow?: number;
};

export type Repeat = {
  unit: "day" | "weekday" | "week" | "month";
  every: number;
  // The last day an occurrence can start; null repeats indefinitely.
  until: string | null;
  // A check-in: each occurrence is "Not yet" or "It happened" (which finishes it for good).
  untilDone: boolean;
  // A missed occurrence rolls on to the next ("skip") or stays, overdue, until done ("keep").
  ifMissed: "skip" | "keep";
};

export type PushedDown = {
  until: string | null;
  at: string;
};

// A named, reusable time a task can be done in (for example business hours).
export type TimeWindow = BaseItem & {
  kind: "window";
  // 0 = Sunday.
  days: number[];
  // "HH:MM", local time.
  start: string;
  end: string;
};

// Calendar-wide settings: one item (id "settings"), synced with everything else.
export type CalendarSettings = BaseItem & {
  kind: "settings";
  // The calendar's time zone (IANA name): clock times and days are read in it.
  timeZone: string;
  // What a new event's reminder starts as (minutes before; unset or null: none).
  eventReminderMinutes?: number | null;
  // How far ahead of its due day a task joins Deadline, in days (unset or 0: on the day it's due).
  deadlineDays?: number | null;
};

export type Item = Task | CalendarEvent | CalendarRecord | Group | TimeWindow | CalendarSettings;
