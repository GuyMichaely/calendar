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
  sortOrder?: number;
};

export type Item = Task | CalendarEvent | Group;
