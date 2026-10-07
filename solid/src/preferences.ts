import { createSignal, type Accessor } from "solid-js";

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
  const [compact, setCompact] = flag("calendar.compactTasks");
  const [showDependents, setShowDependents] = flag("calendar.showDependents");
  // "on" or "off" overrides the device's reduced-motion setting; null follows it.
  const [animations, setAnimations] = stored<string | null>("calendar.animations", raw => raw, value => value);
  // How the Agenda and Boards views show tasks.
  const choice = <T extends string>(key: string, options: readonly T[]) => stored<T>(key, raw => options.includes(raw as T) ? raw as T : options[0], value => value);
  // Settings → Display: a task's board and tags on its row (both on unless turned off).
  const shown = (key: string) => stored(key, raw => raw !== "0", value => value ? null : "0");
  const [showBoard, setShowBoard] = shown("calendar.rows.showBoard");
  const [showTags, setShowTags] = shown("calendar.rows.showTags");
  const [pullTimed, setPullTimed] = flag("calendar.boards.pullTimed");
  // Settings → Notifications (the Android app): whether this phone notifies at all (on unless turned
  // off); when tasks can start (on unless turned off), and this many minutes before events (30
  // unless set; null: no event reminders).
  const [notify, setNotify] = shown("calendar.notify");
  const [notifyTaskStarts, setNotifyTaskStarts] = shown("calendar.notify.taskStarts");
  const [eventReminderMinutes, setEventReminderMinutes] = stored<number | null>("calendar.notify.eventMinutes",
    raw => raw === "off" ? null : raw !== null && Number.isFinite(Number(raw)) ? Number(raw) : 30, value => value === null ? "off" : String(value));
  const [subtaskMode, setSubtaskMode] = choice("calendar.today.subtasks", ["context", "nested"] as const);
  // Pretend time: milliseconds added to the real clock (0 = real time). Its clock in the top bar is
  // hidden unless Settings → Display turns it on (or time is being pretended).
  const [showTimeControl, setShowTimeControl] = flag("calendar.showTimeControl");
  const [timeOffset, setTimeOffset] = stored("calendar.timeOffset", raw => Number(raw) || 0, value => value ? String(value) : null);
  return {
    compact, setCompact,
    showDependents, setShowDependents,
    animations, setAnimations,
    showBoard, setShowBoard,
    showTags, setShowTags,
    pullTimed, setPullTimed,
    notify, setNotify,
    notifyTaskStarts, setNotifyTaskStarts,
    eventReminderMinutes, setEventReminderMinutes,
    subtaskMode, setSubtaskMode,
    showTimeControl, setShowTimeControl,
    timeOffset, setTimeOffset,
  };
}
