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
  sleep?: SleepState | null;
  availabilitySchedule?: AvailabilitySchedule | null;
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
  builtin?: "available" | "upcoming" | "sleeping" | "ungrouped";
};

export type Item = Task | CalendarEvent | Group;
