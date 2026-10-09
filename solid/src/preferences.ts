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
  // Settings → Notifications (the Android app): whether this phone notifies at all, when tasks can
  // start, and for events' reminders (each on unless turned off).
  const [notify, setNotify] = shown("calendar.notify");
  const [notifyTaskStarts, setNotifyTaskStarts] = shown("calendar.notify.taskStarts");
  const [notifyEvents, setNotifyEvents] = shown("calendar.notify.events");
  const [subtaskMode, setSubtaskMode] = choice("calendar.today.subtasks", ["context", "nested"] as const);
  // Pretend time: milliseconds added to the real clock (0 = real time). Its clock in the top bar is
  // hidden unless Settings → Display turns it on (or time is being pretended).
  const [showTimeControl, setShowTimeControl] = flag("calendar.showTimeControl");
  // The Agenda: how many days it shows (1, 3, or 7), and whether Open todos (at its end) starts open.
  const [agendaDays, setAgendaDays] = stored<1 | 3 | 7>("calendar.agenda.days", raw => raw === "3" ? 3 : raw === "7" ? 7 : 1, value => value === 1 ? null : String(value));
  const [todosOpen, setTodosOpen] = flag("calendar.agenda.todosOpen");
  // The Calendar's view (month, three days, or a day by the hour), and the hour views' zoom (pixels an hour; unset: fit).
  const [calendarMode, setCalendarMode] = choice("calendar.calendar.mode", ["month", "3days", "day"] as const);
  // Whether the hour views show tasks too (off: only events and records).
  const [calendarTasks, setCalendarTasks] = flag("calendar.calendar.tasks");
  const [hourHeight, setHourHeight] = stored<number | null>("calendar.calendar.hourHeight", raw => Number(raw) || null, value => value ? String(Math.round(value)) : null);
  // Settings → Display: on wide screens, every editor opens beside the page (off: List and Boards
  // open tasks beside the list, and other editors open over the page).
  const [sideEditor, setSideEditor] = flag("calendar.editor.beside");
  // Settings → Display: search lists every matching task and event under the field (off: it only filters the view).
  const [findSearch, setFindSearch] = flag("calendar.search.find");
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
    notifyEvents, setNotifyEvents,
    subtaskMode, setSubtaskMode,
    showTimeControl, setShowTimeControl,
    timeOffset, setTimeOffset,
    findSearch, setFindSearch,
    sideEditor, setSideEditor,
    agendaDays, setAgendaDays,
    calendarMode, setCalendarMode,
    hourHeight, setHourHeight,
    calendarTasks, setCalendarTasks,
    todosOpen, setTodosOpen,
  };
}
