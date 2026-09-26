import { createSignal, type Accessor } from "solid-js";
import { loadPollSeconds } from "./settings";
import type { CalendarSleepMode } from "./types";

// Per-browser view preferences, kept in localStorage.
function stored<T>(key: string, read: (raw: string | null) => T, write: (value: T) => string | null): [Accessor<T>, (value: T) => void] {
  const [value, setValue] = createSignal(read(localStorage.getItem(key)));
  return [value, (next: T) => {
    setValue(() => next);
    const raw = write(next);
    if (raw === null) localStorage.removeItem(key); else localStorage.setItem(key, raw);
  }];
}

const flag = (key: string) => stored(key, raw => raw === "1", value => value ? "1" : "0");

export function createPreferences() {
  const [showCompleted, setShowCompleted] = flag("calendar.groups.showCompleted");
  const [compact, setCompact] = flag("calendar.compactTasks");
  const [showDependents, setShowDependents] = flag("calendar.showDependents");
  const [hideSleeping, setHideSleeping] = flag("calendar.hideSleeping");
  const [calendarSleepMode, setCalendarSleepMode] = stored<CalendarSleepMode>("calendar.calendarSleepMode", raw => raw === "ignore" ? "ignore" : "respect", value => value);
  // "on" or "off" overrides the device's reduced-motion setting; null follows it.
  const [animations, setAnimations] = stored<string | null>("calendar.animations", raw => raw, value => value);
  const [pollSeconds, setPollSeconds] = stored("calendar.pollSeconds", () => loadPollSeconds(), value => String(value));
  return {
    showCompleted, setShowCompleted,
    compact, setCompact,
    showDependents, setShowDependents,
    hideSleeping, setHideSleeping,
    calendarSleepMode, setCalendarSleepMode,
    animations, setAnimations,
    pollSeconds, setPollSeconds,
  };
}
