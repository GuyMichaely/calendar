export type Attachment = {
  id: string;
  name: string;
  type?: string;
  size?: number;
  blob?: Blob;
};

export type AvailabilitySchedule = {
  enabled: true;
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
};

export type Task = {
  id: string;
  kind: "task";
  title: string;
  notes?: string;
  state: "open" | "completed" | "canceled";
  tags?: string[];
  attachments?: Attachment[];
  availableFrom?: string | null;
  deadline?: string | null;
  latestStart?: string | null;
  sleep?: SleepState | null;
  availabilitySchedule?: AvailabilitySchedule | null;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
  history?: HistoryEntry[];
};

export type CalendarEvent = {
  id: string;
  kind: "event";
  title: string;
  notes?: string;
  tags?: string[];
  attachments?: Attachment[];
  start?: string | null;
  end?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Item = Task | CalendarEvent;
export type View = "tasks" | "calendar";
export type HorizonMode = "rolling" | "boundary";
export type CalendarSleepMode = "respect" | "ignore";
