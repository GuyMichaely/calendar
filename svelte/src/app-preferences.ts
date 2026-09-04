import type { CalendarSleepMode, HorizonMode, View } from "./types";

export function readView(): View {
  return location.hash === "#calendar" ? "calendar" : "tasks";
}

export function initialView(): View {
  if (!["#tasks", "#calendar"].includes(location.hash)) history.replaceState(null, "", "#tasks");
  return readView();
}

export function readHorizon(): number | null {
  const stored = localStorage.getItem("calendar.upcomingHorizon");
  if (stored === "off") return null;
  const parsed = Number(stored);
  return [1, 7, 30].includes(parsed) ? parsed : 7;
}

export function readHorizonMode(): HorizonMode {
  return localStorage.getItem("calendar.upcomingHorizonMode") === "boundary" ? "boundary" : "rolling";
}

export function readCalendarSleepMode(): CalendarSleepMode {
  return localStorage.getItem("calendar.calendarSleepMode") === "ignore" ? "ignore" : "respect";
}

export function editableTarget(target: EventTarget | null) {
  return target instanceof Element && !!target.closest("input, textarea, select, [contenteditable='true']");
}
