export type TaskState = "open" | "completed" | "canceled";

export type Attachment = {
  id: string;
  name: string;
  type?: string;
  size?: number;
  blob?: Blob;
  url?: string;
  dataUrl?: string;
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
  availableFrom?: string | null;
  deadline?: string | null;
  latestStart?: string | null;
  sleep?: SleepState | null;
  availabilitySchedule?: AvailabilitySchedule | null;
  completedAt?: string | null;
  history?: HistoryEntry[];
};

export type CalendarEvent = BaseItem & {
  kind: "event";
  start?: string | null;
  end?: string | null;
};

export type Item = Task | CalendarEvent;
