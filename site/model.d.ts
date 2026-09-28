export type TaskState = "open" | "completed";

export type Attachment = {
  id: string;
  name: string;
  type?: string;
  size?: number;
  blob?: Blob;
};

export type AvailabilitySchedule = {
  enabled: boolean;
  days: number[];
  start: string;
  end: string;
};

export type SleepState = {
  until: string | null;
  startedAt: string;
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
  latestStart?: string | null;
  // Legacy: sleep is read as pushed down (see pushedDownInfo); new edits write pushedDown.
  sleep?: SleepState | null;
  // Kept in its section but moved to the bottom, dimmed; until null means until lifted.
  pushedDown?: PushedDown | null;
  // Legacy inline hours; tasks now use a named window (windowId).
  availabilitySchedule?: AvailabilitySchedule | null;
  windowId?: string | null;
  // How many hours before it's due a task joins the Firm section (null: 24).
  warnHours?: number | null;
  // Legacy: an exact time to join Firm, kept until a lead time is chosen.
  warnAt?: string | null;
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
  latestStart?: number | null;
  deadline?: number | null;
};

export type CalendarEvent = BaseItem & {
  kind: "event";
  start?: string | null;
  end?: string | null;
};

// Groups form a strict tree. A group without a parent is top level.
export type Group = BaseItem & {
  kind: "group";
  parentId?: string | null;
  // Among siblings; for top-level groups, the position within their board column.
  sortOrder?: number;
  // Top-level groups only: which board column the group is stacked in.
  boardColumn?: number;
  // Built-in board sections store only their position; they hold no tasks.
  builtin?: "available" | "upcoming" | "sleeping" | "ungrouped" | "firm" | "closing" | "later" | "completed";
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

export type Item = Task | CalendarEvent | Group | TimeWindow;
