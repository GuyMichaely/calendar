export type {
  Attachment,
  AvailabilitySchedule,
  CalendarEvent,
  HistoryEntry,
  Item,
  SleepState,
  Task,
  TaskState,
} from "../../site/model";
export type { HorizonMode } from "../../site/domain";

export type View = "tasks" | "calendar";
export type CalendarSleepMode = "respect" | "ignore";
