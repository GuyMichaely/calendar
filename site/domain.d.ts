import type { CalendarEvent, Item, Task } from "./model";

export type DateInput = Date | string | number | null | undefined;
export type HorizonMode = "rolling" | "boundary";
export type TaskFilter = "now" | "waiting" | "completed" | "all";

export type Actionability = {
  actionable: boolean;
  reason: string;
};

export type SleepInfo =
  | { sleeping: false; indefinite: false; until: null }
  | { sleeping: true; indefinite: true; until: null }
  | { sleeping: true; indefinite: false; until: Date };

export const TASK_STATES: readonly ["open", "completed", "canceled"];

export function isTask(item: unknown): item is Task;
export function isEvent(item: unknown): item is CalendarEvent;
export function toDate(value: DateInput): Date | null;
export function withinAvailabilitySchedule(task: Task, now?: Date): boolean;
export function actionability(task: unknown, now?: Date): Actionability;
export function nextAvailabilityStart(task: Task, now?: Date): Date | null;
export function sleepInfo(task: unknown, now?: Date): SleepInfo;
export function isSleeping(task: unknown, now?: Date): boolean;
export function nextActionableStart(
  task: Task,
  now?: Date,
  options?: { respectSleep?: boolean },
): Date | null;
export function isWaitingForOpportunity(task: Task, now?: Date): boolean;
export function tomorrowMidnight(now?: Date): Date;
export function availabilityStartForDate(
  task: Task,
  date: DateInput,
  now?: Date,
  options?: { respectSleep?: boolean },
): Date | null;
export function isPendingOnDate(task: Task, date: DateInput): boolean;
export function taskMatchesFilter(task: Task, filter: TaskFilter | string, now?: Date): boolean;
export function upcomingHorizonEnd(now?: Date, horizonDays?: number, mode?: HorizonMode): Date;
export function textMatches(item: Item, query: string): boolean;
export function sortTasks<T extends Task>(tasks: readonly T[], now?: Date): T[];
export function formatDateTime(value: DateInput): string;
export function formatRelativeDateTime(value: DateInput, now?: Date): string;
export function isoToLocalInput(value: DateInput): string;
export function localInputToIso(value: string | FormDataEntryValue | null | undefined): string | null;
export function startOfMonth(date: Date): Date;
export function calendarGridStart(date: Date): Date;
export function dateKey(value: DateInput): string;
