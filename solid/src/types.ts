export type {
  Attachment,
  AvailabilitySchedule,
  CalendarEvent,
  Group,
  HistoryEntry,
  Item,
  PushedDown,
  SleepState,
  Task,
  TaskState,
  TimeWindow,
} from "../../site/model";
export type { HorizonMode } from "../../site/domain";

export type View = "tasks" | "calendar";
export type CalendarSleepMode = "respect" | "ignore";
