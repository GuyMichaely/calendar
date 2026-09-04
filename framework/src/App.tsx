import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  actionability,
  availabilityStartForDate,
  calendarGridStart,
  dateKey,
  formatDateTime,
  isPendingOnDate,
  isSleeping,
  isoToLocalInput,
  localInputToIso,
  nextActionableStart,
  sleepInfo,
  sortTasks,
  taskMatchesFilter,
  textMatches,
  toDate,
  tomorrowMidnight,
  upcomingHorizonEnd,
} from "../../site/domain.js";
import {
  canRedo,
  canUndo,
  deleteItem,
  exportData,
  importData,
  listItems,
  putItem,
  redo,
  redoLabel,
  undo,
  undoLabel,
} from "../../site/storage.js";
import type {
  Attachment,
  CalendarEvent,
  CalendarSleepMode,
  HorizonMode,
  Item,
  Task,
  View,
} from "./types";

type EditorRequest = {
  item: Item | null;
  kind: "task" | "event";
  date?: Date;
  nonce: number;
};

type TaskRow = { task: Task; upcomingAt?: Date | null };

type CalendarEntry = {
  item: Item;
  className: string;
  label: string;
  title: string;
  sort: number;
};

const taskSections = [
  { id: "now", label: "Can do now", defaultOpen: true },
  { id: "upcoming", label: "Upcoming", defaultOpen: true },
  { id: "all", label: "All open", defaultOpen: false },
  { id: "completed", label: "Completed", defaultOpen: false },
] as const;

function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function readView(): View {
  return location.hash === "#calendar" ? "calendar" : "tasks";
}

function readHorizon(): number | null {
  const stored = localStorage.getItem("calendar.upcomingHorizon");
  if (stored === "off") return null;
  const parsed = Number(stored);
  return [1, 7, 30].includes(parsed) ? parsed : 7;
}

function readHorizonMode(): HorizonMode {
  return localStorage.getItem("calendar.upcomingHorizonMode") === "boundary" ? "boundary" : "rolling";
}

function readCalendarSleepMode(): CalendarSleepMode {
  return localStorage.getItem("calendar.calendarSleepMode") === "ignore" ? "ignore" : "respect";
}

function readSectionOpen(id: string, fallback: boolean) {
  const stored = localStorage.getItem(`calendar.section.${id}`);
  if (stored === "open") return true;
  if (stored === "closed") return false;
  return fallback;
}

function localDateInput(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function parseTags(value: FormDataEntryValue | null) {
  return String(value || "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function friendlyWhen(date: Date | null, now = new Date()) {
  if (!date) return "";
  const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const days = Math.round((target.getTime() - today.getTime()) / 86400000);
  if (days === 0) return `today · ${time}`;
  if (days === 1) return `tomorrow · ${time}`;
  if (days > 1 && days < 7) {
    return `${new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(date)} · ${time}`;
  }
  return `${new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date)} · ${time}`;
}

function shortTime(value: string | null | undefined) {
  const date = toDate(value);
  return date ? new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date) : "";
}

function taskTitle(task: Task) {
  return String(task.title || "").replace(/[\p{Cf}\p{Cc}\s]/gu, "") ? task.title : "Untitled task";
}

export function App() {
  const [items, setItems] = useState<Item[]>([]);
  const [loadingError, setLoadingError] = useState("");
  const [view, setView] = useState<View>(() => {
    if (!["#tasks", "#calendar"].includes(location.hash)) history.replaceState(null, "", "#tasks");
    return readView();
  });
  const [query, setQuery] = useState("");
  const [compact, setCompact] = useState(() => localStorage.getItem("calendar.compactTasks") === "1");
  const [horizonDays, setHorizonDays] = useState<number | null>(readHorizon);
  const [horizonMode, setHorizonMode] = useState<HorizonMode>(readHorizonMode);
  const [calendarSleepMode, setCalendarSleepMode] = useState<CalendarSleepMode>(readCalendarSleepMode);
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [editor, setEditor] = useState<EditorRequest | null>(null);
  const [sleepTask, setSleepTask] = useState<Task | null>(null);
  const [toast, setToast] = useState("");
  const [historyState, setHistoryState] = useState(() => ({
    canUndo: canUndo(),
    canRedo: canRedo(),
    undoLabel: undoLabel(),
    redoLabel: redoLabel(),
  }));
  const toastTimer = useRef<number | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDetailsElement>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 2400);
  }, []);

  const refresh = useCallback(async () => {
    const next = (await listItems()) as Item[];
    setItems([...next]);
  }, []);

  useEffect(() => {
    refresh().catch((error: Error) => setLoadingError(error.message || "Could not open local storage."));
  }, [refresh]);

  useEffect(() => {
    const syncLocation = () => setView(readView());
    window.addEventListener("hashchange", syncLocation);
    window.addEventListener("popstate", syncLocation);
    return () => {
      window.removeEventListener("hashchange", syncLocation);
      window.removeEventListener("popstate", syncLocation);
    };
  }, []);

  useEffect(() => {
    const syncHistory = (event: Event) => {
      const detail = (event as CustomEvent).detail || {};
      setHistoryState({
        canUndo: detail.canUndo ?? canUndo(),
        canRedo: detail.canRedo ?? canRedo(),
        undoLabel: detail.undoLabel ?? undoLabel(),
        redoLabel: detail.redoLabel ?? redoLabel(),
      });
    };
    window.addEventListener("calendar:history-state", syncHistory);
    return () => window.removeEventListener("calendar:history-state", syncHistory);
  }, []);

  const navigate = useCallback((next: View) => {
    setView(next);
    const hash = `#${next}`;
    if (location.hash !== hash) history.pushState(null, "", hash);
  }, []);

  const openEditor = useCallback((item: Item | null = null, kind?: "task" | "event", date?: Date) => {
    setEditor({ item, kind: item?.kind || kind || "task", date, nonce: Date.now() });
  }, []);

  const mutateTask = useCallback(
    async (task: Task, patch: Partial<Task>, historyEntry: Record<string, unknown>, message: string) => {
      const now = new Date().toISOString();
      await putItem({
        ...task,
        ...patch,
        updatedAt: now,
        history: [...(task.history || []), { at: now, ...(historyEntry as { type: string }) }],
      });
      await refresh();
      showToast(message);
    },
    [refresh, showToast],
  );

  const completeTask = useCallback(
    async (task: Task) => {
      const now = new Date().toISOString();
      await putItem({
        ...task,
        state: "completed",
        completedAt: now,
        sleep: null,
        updatedAt: now,
        history: [...(task.history || []), { at: now, type: "completed" }],
      });
      await refresh();
      showToast("Task completed");
    },
    [refresh, showToast],
  );

  const sleepTomorrow = useCallback(
    async (task: Task) => {
      const now = new Date();
      const until = tomorrowMidnight(now).toISOString();
      await mutateTask(
        task,
        { sleep: { until, startedAt: task.sleep?.startedAt || now.toISOString() } },
        { type: "slept", until },
        "Sleeping until tomorrow",
      );
    },
    [mutateTask],
  );

  const wakeTask = useCallback(
    (task: Task) => mutateTask(task, { sleep: null }, { type: "woke" }, "Task is awake"),
    [mutateTask],
  );

  const sleepToWait = useCallback(
    async (task: Task) => {
      const sleep = sleepInfo(task, new Date());
      if (!sleep.sleeping || sleep.indefinite) return;
      const existingStart = toDate(task.availableFrom);
      const waitUntil = existingStart && existingStart > sleep.until ? existingStart : sleep.until;
      await mutateTask(
        task,
        { sleep: null, availableFrom: waitUntil.toISOString() },
        { type: "sleep-converted-to-wait", until: waitUntil.toISOString() },
        "Converted sleep to waiting",
      );
    },
    [mutateTask],
  );

  const waitToSleep = useCallback(
    async (task: Task) => {
      const available = toDate(task.availableFrom);
      if (!available || available <= new Date()) return;
      const now = new Date().toISOString();
      await mutateTask(
        task,
        { availableFrom: null, sleep: { until: available.toISOString(), startedAt: now } },
        { type: "wait-converted-to-sleep", until: available.toISOString() },
        "Converted waiting to sleep",
      );
    },
    [mutateTask],
  );

  const applyUndo = useCallback(async () => {
    const label = undoLabel();
    if (!(await undo())) return;
    await refresh();
    showToast(label ? `Undid ${label}` : "Undid change");
  }, [refresh, showToast]);

  const applyRedo = useCallback(async () => {
    const label = redoLabel();
    if (!(await redo())) return;
    await refresh();
    showToast(label ? `Redid ${label}` : "Redid change");
  }, [refresh, showToast]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const modifier = event.ctrlKey || event.metaKey;
      if (!modifier || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        void applyUndo();
      } else if ((key === "z" && event.shiftKey) || key === "y") {
        event.preventDefault();
        void applyRedo();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [applyRedo, applyUndo]);

  const exportBackup = useCallback(async () => {
    const text = await exportData();
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `calendar-backup-${dateKey(new Date())}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    if (menuRef.current) menuRef.current.open = false;
  }, []);

  const importBackup = useCallback(
    async (file: File) => {
      try {
        const count = await importData(await file.text());
        await refresh();
        showToast(`Imported ${count} items`);
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Import failed");
      }
    },
    [refresh, showToast],
  );

  if (loadingError) return <div class="framework-error">Could not open local storage. {loadingError}</div>;

  return (
    <div class="app-shell">
      <header class="topbar">
        <div class="brand-row">
          <details class="framework-menu" ref={menuRef}>
            <summary class="icon-button menu-trigger" aria-label="Menu" title="Menu">☰</summary>
            <div class="framework-menu-panel">
              <button class="text-button" disabled={!historyState.canUndo} onClick={() => void applyUndo()}>
                Undo{historyState.undoLabel ? ` · ${historyState.undoLabel}` : ""}
              </button>
              <button class="text-button" disabled={!historyState.canRedo} onClick={() => void applyRedo()}>
                Redo{historyState.redoLabel ? ` · ${historyState.redoLabel}` : ""}
              </button>
              <div class="menu-divider" />
              <button class="text-button" onClick={() => void exportBackup()}>Export backup</button>
              <button class="text-button" onClick={() => importRef.current?.click()}>Import backup</button>
            </div>
          </details>
          <nav class="primary-nav" aria-label="Primary">
            <button class={`nav-button ${view === "tasks" ? "active" : ""}`} onClick={() => navigate("tasks")}>Tasks</button>
            <button class={`nav-button ${view === "calendar" ? "active" : ""}`} onClick={() => navigate("calendar")}>Calendar</button>
          </nav>
          <span class="framework-badge">Preact preview</span>
        </div>
        <div class="top-actions">
          <label class="search-box">
            <span aria-hidden="true">⌕</span>
            <input
              type="search"
              placeholder={view === "calendar" ? "Filter calendar" : "Search tasks"}
              value={query}
              onInput={(event) => setQuery((event.currentTarget as HTMLInputElement).value)}
              autocomplete="off"
            />
          </label>
          <button class="primary-button" onClick={() => openEditor(null, view === "calendar" ? "event" : "task")}>New</button>
          <input
            ref={importRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(event) => {
              const input = event.currentTarget as HTMLInputElement;
              const file = input.files?.[0];
              if (file) void importBackup(file);
              input.value = "";
              if (menuRef.current) menuRef.current.open = false;
            }}
          />
        </div>
      </header>

      <main>
        {view === "tasks" ? (
          <TasksView
            items={items}
            query={query}
            compact={compact}
            horizonDays={horizonDays}
            horizonMode={horizonMode}
            onCompactChange={(value) => {
              setCompact(value);
              localStorage.setItem("calendar.compactTasks", value ? "1" : "0");
            }}
            onHorizonChange={(value) => {
              setHorizonDays(value);
              localStorage.setItem("calendar.upcomingHorizon", value === null ? "off" : String(value));
            }}
            onHorizonModeChange={(value) => {
              setHorizonMode(value);
              localStorage.setItem("calendar.upcomingHorizonMode", value);
            }}
            onEdit={(task) => openEditor(task)}
            onComplete={completeTask}
            onWake={wakeTask}
            onSleepTomorrow={sleepTomorrow}
            onSleepCustom={setSleepTask}
            onSleepToWait={sleepToWait}
            onWaitToSleep={waitToSleep}
          />
        ) : (
          <CalendarView
            items={items}
            query={query}
            month={calendarMonth}
            sleepMode={calendarSleepMode}
            onMonthChange={setCalendarMonth}
            onSleepModeChange={(mode) => {
              setCalendarSleepMode(mode);
              localStorage.setItem("calendar.calendarSleepMode", mode);
            }}
            onEdit={(item) => openEditor(item)}
            onCreateForDay={(date) => openEditor(null, "event", date)}
            onOpenTodayTasks={() => {
              localStorage.setItem("calendar.section.now", "open");
              localStorage.setItem("calendar.section.upcoming", "open");
              navigate("tasks");
            }}
          />
        )}
      </main>

      {editor ? (
        <ItemEditor
          key={`${editor.item?.id || "new"}:${editor.nonce}`}
          request={editor}
          onClose={() => setEditor(null)}
          onDelete={async (item) => {
            await deleteItem(item.id);
            setEditor(null);
            await refresh();
            showToast("Deleted");
          }}
          onSave={async (item, created) => {
            await putItem(item);
            setEditor(null);
            await refresh();
            showToast(created ? `${item.kind === "task" ? "Task" : "Event"} created` : "Saved");
          }}
        />
      ) : null}

      {sleepTask ? (
        <SleepDialog
          task={sleepTask}
          onClose={() => setSleepTask(null)}
          onSave={async (until) => {
            const now = new Date().toISOString();
            await mutateTask(
              sleepTask,
              { sleep: { until, startedAt: sleepTask.sleep?.startedAt || now } },
              { type: "slept", until },
              until ? `Sleeping until ${formatDateTime(until)}` : "Sleeping indefinitely",
            );
            setSleepTask(null);
          }}
        />
      ) : null}

      <div class={`toast ${toast ? "show" : ""}`} role="status" aria-live="polite">{toast}</div>
    </div>
  );
}

function TasksView(props: {
  items: Item[];
  query: string;
  compact: boolean;
  horizonDays: number | null;
  horizonMode: HorizonMode;
  onCompactChange: (value: boolean) => void;
  onHorizonChange: (value: number | null) => void;
  onHorizonModeChange: (value: HorizonMode) => void;
  onEdit: (task: Task) => void;
  onComplete: (task: Task) => Promise<void>;
  onWake: (task: Task) => Promise<void>;
  onSleepTomorrow: (task: Task) => Promise<void>;
  onSleepCustom: (task: Task) => void;
  onSleepToWait: (task: Task) => Promise<void>;
  onWaitToSleep: (task: Task) => Promise<void>;
}) {
  const now = new Date();
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(taskSections.map((section) => [section.id, readSectionOpen(section.id, section.defaultOpen)])),
  );

  const matching = useMemo(
    () => props.items.filter((item): item is Task => item.kind === "task").filter((task) => textMatches(task, props.query)),
    [props.items, props.query],
  );
  const openCount = matching.filter((task) => !["completed", "canceled"].includes(task.state)).length;

  const actionable = sortTasks(
    matching.filter((task) => taskMatchesFilter(task, "now", now) && !isSleeping(task, now)),
    now,
  ) as Task[];
  const horizonEnd = props.horizonDays === null ? null : upcomingHorizonEnd(now, props.horizonDays, props.horizonMode);
  const upcoming = matching
    .filter((task) => !["completed", "canceled"].includes(task.state) && !isSleeping(task, now))
    .map((task) => ({ task, upcomingAt: nextActionableStart(task, now) as Date | null }))
    .filter((row) => row.upcomingAt && row.upcomingAt > now && (!horizonEnd || row.upcomingAt <= horizonEnd))
    .sort((a, b) => (a.upcomingAt?.getTime() || 0) - (b.upcomingAt?.getTime() || 0));
  const sleeping = (sortTasks(
    matching.filter((task) => !["completed", "canceled"].includes(task.state) && isSleeping(task, now)),
    now,
  ) as Task[]).map((task) => ({ task, upcomingAt: nextActionableStart(task, now, { respectSleep: true }) as Date | null }));
  const rows: Record<string, TaskRow[]> = {
    now: actionable.map((task) => ({ task })),
    upcoming,
    all: (sortTasks(matching.filter((task) => taskMatchesFilter(task, "all", now)), now) as Task[]).map((task) => ({ task })),
    completed: (sortTasks(matching.filter((task) => taskMatchesFilter(task, "completed", now)), now) as Task[]).map((task) => ({ task })),
  };

  const horizonLabel = (days: number) => {
    if (props.horizonMode !== "boundary") return `${days}d`;
    if (days === 1) return "Today";
    if (days === 7) return "This week";
    return "This month";
  };

  return (
    <section class={`panel tasks-panel ${props.compact ? "compact" : ""}`}>
      <div class="panel-heading">
        <div>
          <h1>Tasks</h1>
          <p class="muted">
            {props.query ? `${openCount} matching open ${openCount === 1 ? "task" : "tasks"}` : `${openCount} open ${openCount === 1 ? "task" : "tasks"}`}
          </p>
        </div>
        <button
          type="button"
          class={`secondary-button density-toggle ${props.compact ? "active" : ""}`}
          aria-pressed={props.compact}
          onClick={() => props.onCompactChange(!props.compact)}
        >
          Compact
        </button>
      </div>

      <div class="task-sections">
        {taskSections.map((section) => {
          const sectionRows = rows[section.id];
          const sleepingRows = section.id === "upcoming" ? sleeping : [];
          const label = section.id === "upcoming" && props.horizonDays === null ? "Waiting" : section.label;
          return (
            <details
              class="task-section"
              data-section={section.id}
              open={openSections[section.id]}
              onToggle={(event) => {
                const open = (event.currentTarget as HTMLDetailsElement).open;
                setOpenSections((current) => ({ ...current, [section.id]: open }));
                localStorage.setItem(`calendar.section.${section.id}`, open ? "open" : "closed");
              }}
            >
              <summary>
                <span class="section-heading"><span class="section-chevron" aria-hidden="true">›</span><strong>{label}</strong></span>
                <span class="section-count">{sectionRows.length + sleepingRows.length}</span>
              </summary>
              <div class="task-section-body">
                {section.id === "upcoming" ? (
                  <div class="horizon-row">
                    <span class="horizon-label">{props.horizonDays === null ? "Showing all future opportunities" : "Limit to"}</span>
                    <div class="horizon-controls">
                      <div class="segmented horizon-control" aria-label="Upcoming task horizon">
                        {[1, 7, 30].map((days) => (
                          <button
                            type="button"
                            class={props.horizonDays === days ? "active" : ""}
                            aria-pressed={props.horizonDays === days}
                            onClick={() => props.onHorizonChange(props.horizonDays === days ? null : days)}
                          >
                            {horizonLabel(days)}
                          </button>
                        ))}
                      </div>
                      <button
                        type="button"
                        class={`secondary-button boundary-toggle ${props.horizonMode === "boundary" ? "active" : ""}`}
                        aria-pressed={props.horizonMode === "boundary"}
                        title="Use the end of the current day, week, or month instead of a rolling 1, 7, or 30 days."
                        onClick={() => props.onHorizonModeChange(props.horizonMode === "boundary" ? "rolling" : "boundary")}
                      >
                        End of day/week/month
                      </button>
                    </div>
                  </div>
                ) : null}

                <div class="task-list section-task-list">
                  {sectionRows.length ? sectionRows.map((row) => <TaskCard key={row.task.id} row={row} now={now} {...props} />) : (
                    <div class="section-empty">
                      {section.id === "now"
                        ? "Nothing is actionable right now."
                        : section.id === "completed"
                          ? "No completed tasks."
                          : section.id === "upcoming"
                            ? props.horizonDays === null
                              ? "Nothing is waiting for a known future opportunity."
                              : `Nothing becomes actionable by ${formatDateTime(horizonEnd)}.`
                            : "No open tasks."}
                    </div>
                  )}
                </div>

                {section.id === "upcoming" && sleepingRows.length ? (
                  <div class="sleeping-block">
                    <div class="sleeping-heading"><span>Sleeping</span><span>{sleepingRows.length}</span></div>
                    <div class="task-list section-task-list sleeping-task-list">
                      {sleepingRows.map((row) => <TaskCard key={row.task.id} row={row} now={now} {...props} />)}
                    </div>
                  </div>
                ) : null}
              </div>
            </details>
          );
        })}
      </div>
    </section>
  );
}

function TaskCard(props: {
  row: TaskRow;
  now: Date;
  onEdit: (task: Task) => void;
  onComplete: (task: Task) => Promise<void>;
  onWake: (task: Task) => Promise<void>;
  onSleepTomorrow: (task: Task) => Promise<void>;
  onSleepCustom: (task: Task) => void;
  onSleepToWait: (task: Task) => Promise<void>;
  onWaitToSleep: (task: Task) => Promise<void>;
  [key: string]: unknown;
}) {
  const { task, upcomingAt } = props.row;
  const result = actionability(task, props.now);
  const sleep = sleepInfo(task, props.now);
  const closed = ["completed", "canceled"].includes(task.state);
  const futureAvailable = toDate(task.availableFrom);
  const canConvertWaitToSleep = !sleep.sleeping && futureAvailable && futureAvailable > props.now;
  const tags = task.tags || [];
  const timing: string[] = [];
  if (task.deadline) timing.push(`Due ${formatDateTime(task.deadline)}`);
  if (task.latestStart) timing.push(`Latest start ${formatDateTime(task.latestStart)}`);
  const schedule = task.availabilitySchedule;
  if (schedule?.enabled) {
    const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    timing.push(`${schedule.days.map((day) => names[day]).join(", ") || "No days"} ${schedule.start}-${schedule.end}`);
  }
  const next = nextActionableStart(task, props.now, { respectSleep: sleep.sleeping }) as Date | null;
  const summary = sleep.sleeping && sleep.indefinite
    ? "Sleeping indefinitely"
    : sleep.sleeping
      ? next && Math.abs(next.getTime() - sleep.until.getTime()) >= 60000
        ? `Sleeping until ${friendlyWhen(sleep.until, props.now)} · available ${friendlyWhen(next, props.now)}`
        : `Sleeping until ${friendlyWhen(sleep.until, props.now)}`
      : upcomingAt
        ? `Available ${friendlyWhen(upcomingAt, props.now)}`
        : "";
  const statusText = sleep.sleeping
    ? sleep.indefinite ? "Sleeping indefinitely" : `Sleeping until ${formatDateTime(sleep.until)}`
    : result.reason;

  const openAttachment = (attachment: Attachment) => {
    if (!attachment.blob) return;
    const url = URL.createObjectURL(attachment.blob);
    window.open(url, "_blank", "noopener,noreferrer");
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  const onKeyDown = (event: any) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter") {
      event.preventDefault();
      props.onEdit(task);
      return;
    }
    if (!["ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const cards = [...document.querySelectorAll<HTMLElement>('[data-task-card="true"]')];
    const index = cards.indexOf(event.currentTarget as HTMLElement);
    const nextIndex = event.key === "ArrowUp" ? index - 1 : index + 1;
    cards[nextIndex]?.focus();
  };

  return (
    <article
      class={`task-card ${sleep.sleeping ? "sleeping-task" : ""}`}
      data-id={task.id}
      data-task-card="true"
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      <div class="task-main">
        {closed ? <span class="complete-indicator" aria-hidden="true">✓</span> : (
          <button class="complete-button" aria-label="Mark complete" title="Mark complete" onClick={() => void props.onComplete(task)} />
        )}
        <div class="task-copy">
          <div class="task-title-row">
            <h3>
              <button class="task-title-link" aria-label={`Edit ${taskTitle(task)}`} title={`Edit ${taskTitle(task)}`} onClick={() => props.onEdit(task)}>
                {taskTitle(task)}
              </button>
            </h3>
            <span class={`status-pill ${result.actionable && !sleep.sleeping ? "ready" : sleep.sleeping ? "sleeping" : "quiet"}`}>{statusText}</span>
          </div>
          {summary ? <div class="availability-summary">{summary}</div> : null}
          {task.notes ? <p class="notes">{task.notes}</p> : null}
          {timing.length ? <div class="timing">{timing.map((value) => <span>{value}</span>)}</div> : null}
          {tags.length ? <div class="tags">{tags.map((tag) => <span class="tag">{tag}</span>)}</div> : null}
          {task.attachments?.length ? (
            <div class="attachments">
              {task.attachments.map((attachment) => (
                <button class="attachment" onClick={() => openAttachment(attachment)}>Attachment: {attachment.name || "Attachment"}</button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      {!closed ? (
        <div class="task-actions">
          {sleep.sleeping ? (
            <>
              <button class="text-button" onClick={() => void props.onWake(task)}>Wake</button>
              <button class="text-button" onClick={() => props.onSleepCustom(task)}>Change sleep…</button>
              {!sleep.indefinite ? <button class="text-button" onClick={() => void props.onSleepToWait(task)}>Wait instead</button> : null}
            </>
          ) : (
            <>
              <button class="text-button" onClick={() => void props.onSleepTomorrow(task)}>Sleep until tomorrow</button>
              <button class="text-button" onClick={() => props.onSleepCustom(task)}>Sleep until…</button>
              {canConvertWaitToSleep ? <button class="text-button" onClick={() => void props.onWaitToSleep(task)}>Sleep instead</button> : null}
            </>
          )}
        </div>
      ) : null}
    </article>
  );
}

function CalendarView(props: {
  items: Item[];
  query: string;
  month: Date;
  sleepMode: CalendarSleepMode;
  onMonthChange: (date: Date) => void;
  onSleepModeChange: (mode: CalendarSleepMode) => void;
  onEdit: (item: Item) => void;
  onCreateForDay: (date: Date) => void;
  onOpenTodayTasks: () => void;
}) {
  const now = new Date();
  const today = dateKey(now);
  const start = calendarGridStart(props.month);
  const days = Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });

  const entriesForDay = (day: Date): CalendarEntry[] => {
    const key = dateKey(day);
    const respectSleep = props.sleepMode === "respect";
    const entries: CalendarEntry[] = [];
    for (const item of props.items) {
      if (item.kind === "event") {
        if (dateKey(item.start) !== key) continue;
        entries.push({
          item,
          className: "event event",
          label: `${shortTime(item.start)} ${item.title}`,
          title: item.title,
          sort: toDate(item.start)?.getTime() || 0,
        });
        continue;
      }
      if (["completed", "canceled"].includes(item.state)) continue;
      const scheduledStart = availabilityStartForDate(item, day, now, { respectSleep }) as Date | null;
      if (scheduledStart) {
        const sleep = sleepInfo(item, now);
        const bypassesSleep = !respectSleep && sleep.sleeping && (sleep.indefinite || scheduledStart < sleep.until);
        entries.push({
          item,
          className: `task start${bypassesSleep ? " sleep-bypassed" : ""}`,
          label: `${shortTime(scheduledStart.toISOString())} ${item.title}`,
          title: bypassesSleep ? `${item.title}: projected action window while sleep is ignored` : `${item.title}: projected action window`,
          sort: scheduledStart.getTime(),
        });
      }
      const sleep = sleepInfo(item, now);
      if (sleep.sleeping && !sleep.indefinite && dateKey(sleep.until) === key) {
        entries.push({
          item,
          className: "task sleep",
          label: `Sleep ends: ${item.title}`,
          title: `${item.title}: sleep ends ${formatDateTime(sleep.until)}`,
          sort: sleep.until.getTime(),
        });
      }
      for (const [field, role, prefix] of [
        ["availableFrom", "start", "Start:"],
        ["latestStart", "latest", "Latest:"],
        ["deadline", "due", "Due:"],
      ] as const) {
        if (item[field] && dateKey(item[field]) === key) {
          entries.push({
            item,
            className: `task ${role}`,
            label: `${prefix} ${item.title}`,
            title: `${item.title}: ${role}`,
            sort: toDate(item[field])?.getTime() || 0,
          });
        }
      }
    }
    return entries.sort((a, b) => a.sort - b.sort);
  };

  return (
    <section class="panel calendar-panel">
      <div class="calendar-toolbar">
        <div class="month-controls">
          <button class="icon-button" aria-label="Previous month" onClick={() => props.onMonthChange(new Date(props.month.getFullYear(), props.month.getMonth() - 1, 1))}>‹</button>
          <button class="text-button" onClick={() => {
            const date = new Date();
            props.onMonthChange(new Date(date.getFullYear(), date.getMonth(), 1));
          }}>Today</button>
          <button class="icon-button" aria-label="Next month" onClick={() => props.onMonthChange(new Date(props.month.getFullYear(), props.month.getMonth() + 1, 1))}>›</button>
        </div>
        <div class="calendar-heading-actions">
          <button
            type="button"
            class={`secondary-button calendar-sleep-toggle ${props.sleepMode === "respect" ? "active" : ""}`}
            aria-pressed={props.sleepMode === "respect"}
            title={props.sleepMode === "respect" ? "Sleeping tasks are treated as unavailable until they wake." : "Sleep is ignored when projecting task opportunities."}
            onClick={() => props.onSleepModeChange(props.sleepMode === "respect" ? "ignore" : "respect")}
          >
            {props.sleepMode === "respect" ? "Respect sleep" : "Ignore sleep"}
          </button>
          <h1>{new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(props.month)}</h1>
        </div>
      </div>
      <div class="calendar-grid">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((name) => <div class="weekday">{name}</div>)}
        {days.map((day) => {
          const key = dateKey(day);
          const pending = key === today
            ? props.items.filter((item): item is Task => item.kind === "task" && isPendingOnDate(item, day))
            : [];
          const matchingPending = props.query ? pending.filter((item) => textMatches(item, props.query)) : pending;
          const sleepingCount = matchingPending.filter((item) => isSleeping(item, now)).length;
          const entries = entriesForDay(day);
          const itemLimit = 4 - (pending.length ? 1 : 0);
          return (
            <div
              class={`calendar-day clickable ${day.getMonth() !== props.month.getMonth() ? "outside" : ""} ${key === today ? "today" : ""}`}
              onClick={(event) => {
                if ((event.target as Element).closest("button")) return;
                props.onCreateForDay(day);
              }}
            >
              <div class="day-number">{day.getDate()}</div>
              {pending.length ? (
                <button
                  class={`calendar-chip task start ${props.query && !matchingPending.length ? "search-dimmed" : ""}`}
                  title="Open today's tasks"
                  onClick={(event) => {
                    event.stopPropagation();
                    props.onOpenTodayTasks();
                  }}
                >
                  {matchingPending.length} {matchingPending.length === 1 ? "task" : "tasks"}{sleepingCount ? ` · ${sleepingCount} sleeping` : ""}
                </button>
              ) : null}
              {entries.slice(0, itemLimit).map((entry) => (
                <button
                  class={`calendar-chip ${entry.className} ${props.query && !textMatches(entry.item, props.query) ? "search-dimmed" : ""}`}
                  title={entry.title}
                  onClick={(event) => {
                    event.stopPropagation();
                    props.onEdit(entry.item);
                  }}
                >
                  {entry.label}
                </button>
              ))}
              {entries.length > itemLimit ? <div class="more-count">+{entries.length - itemLimit} more</div> : null}
            </div>
          );
        })}
      </div>
      <div class="calendar-legend">
        <span><i class="legend-dot event" />Event</span>
        <span><i class="legend-dot start" />Task start</span>
        <span><i class="legend-dot sleep" />Sleep ends</span>
        <span><i class="legend-dot latest" />Latest start</span>
        <span><i class="legend-dot due" />Due</span>
      </div>
    </section>
  );
}

function ItemEditor(props: {
  request: EditorRequest;
  onClose: () => void;
  onDelete: (item: Item) => Promise<void>;
  onSave: (item: Item, created: boolean) => Promise<void>;
}) {
  const existing = props.request.item;
  const [kind, setKind] = useState<"task" | "event">(props.request.kind);
  const [scheduleEnabled, setScheduleEnabled] = useState(existing?.kind === "task" && !!existing.availabilitySchedule?.enabled);
  const initialSleep = existing?.kind === "task" ? sleepInfo(existing, new Date()) : { sleeping: false, indefinite: false, until: null };
  const [sleepMode, setSleepMode] = useState<"awake" | "until" | "indefinite">(
    initialSleep.sleeping ? (initialSleep.indefinite ? "indefinite" : "until") : "awake",
  );
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [dirty, setDirty] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const defaultDate = props.request.date ? new Date(props.request.date) : new Date();
  defaultDate.setHours(9, 0, 0, 0);
  const defaultEnd = new Date(defaultDate);
  defaultEnd.setHours(10, 0, 0, 0);
  const task = existing?.kind === "task" ? existing : null;
  const event = existing?.kind === "event" ? existing : null;

  const close = () => {
    if (dirty && !window.confirm("Discard your unsaved changes?")) return;
    props.onClose();
  };

  const addFiles = (files: File[]) => {
    setPendingFiles((current) => {
      const seen = new Set(current.map((file) => `${file.name}:${file.size}:${file.lastModified}`));
      return [...current, ...files.filter((file) => !seen.has(`${file.name}:${file.size}:${file.lastModified}`))];
    });
    setDirty(true);
  };

  const save = async (eventObject: any) => {
    eventObject.preventDefault();
    const form = formRef.current;
    if (!form) return;
    const data = new FormData(form);
    const title = String(data.get("title") || "").trim();
    if (!title) return;
    const now = new Date().toISOString();
    const attachments = pendingFiles.map((file) => ({
      id: uuid(),
      name: file.name,
      type: file.type,
      size: file.size,
      blob: file,
    }));
    let item: Item;

    if (kind === "task") {
      const taskState = String(data.get("taskState") || "open") as Task["state"];
      const closed = ["completed", "canceled"].includes(taskState);
      let sleep = null;
      if (!closed && sleepMode === "indefinite") {
        sleep = { until: null, startedAt: task?.sleep?.startedAt || now };
      } else if (!closed && sleepMode === "until") {
        const until = localInputToIso(data.get("sleepUntil"));
        if (until && toDate(until) > new Date()) sleep = { until, startedAt: task?.sleep?.startedAt || now };
      }
      const historyEntries = [...(task?.history || (task ? [] : [{ at: now, type: "created" }]))];
      if (task && JSON.stringify(task.sleep || null) !== JSON.stringify(sleep)) {
        historyEntries.push({ at: now, type: sleep ? "sleep-updated" : "woke", until: sleep?.until ?? null });
      }
      item = {
        ...(task || {}),
        id: existing?.id || uuid(),
        kind: "task",
        title,
        notes: String(data.get("notes") || "").trim(),
        state: taskState,
        tags: parseTags(data.get("tags")),
        attachments: [...(task?.attachments || []), ...attachments],
        availableFrom: localInputToIso(data.get("availableFrom")),
        deadline: localInputToIso(data.get("deadline")),
        latestStart: localInputToIso(data.get("latestStart")),
        sleep,
        availabilitySchedule: scheduleEnabled
          ? {
              enabled: true,
              days: data.getAll("scheduleDay").map(Number),
              start: String(data.get("scheduleStart") || "08:00"),
              end: String(data.get("scheduleEnd") || "17:00"),
            }
          : null,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
        history: historyEntries,
      };
    } else {
      let start = localInputToIso(data.get("eventStart"));
      let end = localInputToIso(data.get("eventEnd"));
      if (start && !end) {
        const derived = toDate(start);
        if (derived) {
          derived.setHours(derived.getHours() + 1);
          end = derived.toISOString();
        }
      }
      item = {
        ...(event || {}),
        id: existing?.id || uuid(),
        kind: "event",
        title,
        notes: String(data.get("notes") || "").trim(),
        tags: parseTags(data.get("tags")),
        attachments: [...(event?.attachments || []), ...attachments],
        start,
        end,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      };
    }
    setDirty(false);
    await props.onSave(item, !existing);
  };

  const schedule = task?.availabilitySchedule;
  const selectedDays = schedule?.enabled ? schedule.days : [1, 2, 3, 4, 5];
  const sleepUntil = initialSleep.sleeping && !initialSleep.indefinite
    ? isoToLocalInput(initialSleep.until)
    : isoToLocalInput(tomorrowMidnight(new Date()));

  return (
    <div class="framework-dialog-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) close();
    }}>
      <div class="editor-dialog" role="dialog" aria-modal="true" aria-labelledby="editor-title">
        <form ref={formRef} onSubmit={save} onInput={() => setDirty(true)}>
          <div class="dialog-header">
            <h2 id="editor-title">{existing ? "Edit item" : "New item"}</h2>
            <button type="button" class="icon-button" aria-label="Close" onClick={close}>×</button>
          </div>

          <div class="segmented kind-switch">
            <label><input type="radio" name="kind" value="task" checked={kind === "task"} onChange={() => { setKind("task"); setDirty(true); }} /><span>Task</span></label>
            <label><input type="radio" name="kind" value="event" checked={kind === "event"} onChange={() => { setKind("event"); setDirty(true); }} /><span>Event</span></label>
          </div>

          <label class="field full"><span>Title</span><input name="title" required maxlength={240} defaultValue={existing?.title || ""} autofocus /></label>
          <label class="field full"><span>Notes</span><textarea name="notes" rows={4} defaultValue={existing?.notes || ""} /></label>

          <div class="form-grid shared-item-fields">
            <label class="field full-span"><span>Tags</span><input name="tags" placeholder="project, errands" defaultValue={(existing?.tags || []).join(", ")} /></label>
            <label class="field full-span">
              <span>Attachments</span>
              <div
                class="attachment-drop-zone"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  addFiles([...(event.dataTransfer?.files || [])]);
                }}
              >
                <input type="file" multiple onChange={(event) => addFiles([...(event.currentTarget.files || [])])} />
                <small class="field-hint">
                  {existing?.attachments?.length
                    ? `Attached: ${existing.attachments.map((attachment) => attachment.name).join(", ")}. New files are added to these.`
                    : "Drop files here or use Choose Files."}
                </small>
                {pendingFiles.length ? <div class="pending-files">Adding: {pendingFiles.map((file) => file.name).join(", ")}</div> : null}
              </div>
            </label>
          </div>

          {kind === "task" ? (
            <div>
              <div class="form-grid">
                <label class="field"><span>State</span><select name="taskState" defaultValue={task?.state || "open"}><option value="open">Open</option><option value="completed">Completed</option><option value="canceled">Canceled</option></select></label>
                <label class="field"><span>Can start</span><input name="availableFrom" type="datetime-local" defaultValue={isoToLocalInput(task?.availableFrom) || (!existing && props.request.date ? localDateInput(defaultDate) : "")} /></label>
                <label class="field"><span>Due</span><input name="deadline" type="datetime-local" defaultValue={isoToLocalInput(task?.deadline)} /></label>
                <label class="field"><span>Latest start</span><input name="latestStart" type="datetime-local" defaultValue={isoToLocalInput(task?.latestStart)} /></label>
                <label class="field"><span>Sleep</span><select name="sleepMode" value={sleepMode} onChange={(event) => { setSleepMode((event.currentTarget as HTMLSelectElement).value as typeof sleepMode); setDirty(true); }}><option value="awake">Awake</option><option value="until">Until a date</option><option value="indefinite">Indefinitely</option></select></label>
                <label class={`field ${sleepMode !== "until" ? "disabled" : ""}`}><span>Sleep until</span><input name="sleepUntil" type="datetime-local" defaultValue={sleepUntil} disabled={sleepMode !== "until"} /></label>
              </div>
              <div class="schedule-box">
                <label class="toggle-row">
                  <input type="checkbox" name="scheduleEnabled" checked={scheduleEnabled} onChange={(event) => { setScheduleEnabled((event.currentTarget as HTMLInputElement).checked); setDirty(true); }} />
                  <span><strong>Recurring action window</strong><small>The same task becomes actionable during these times until you close it.</small></span>
                </label>
                <div class={`schedule-options ${scheduleEnabled ? "" : "disabled"}`}>
                  <div class="weekday-picks" aria-label="Action days">
                    {["S", "M", "T", "W", "T", "F", "S"].map((name, day) => (
                      <label><input type="checkbox" name="scheduleDay" value={day} defaultChecked={selectedDays.includes(day)} disabled={!scheduleEnabled} /><span>{name}</span></label>
                    ))}
                  </div>
                  <div class="time-pair">
                    <label class="field"><span>From</span><input name="scheduleStart" type="time" defaultValue={schedule?.start || "08:00"} disabled={!scheduleEnabled} /></label>
                    <label class="field"><span>Until</span><input name="scheduleEnd" type="time" defaultValue={schedule?.end || "17:00"} disabled={!scheduleEnabled} /></label>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div class="form-grid">
              <label class="field"><span>Starts</span><input name="eventStart" type="datetime-local" required defaultValue={isoToLocalInput(event?.start) || localDateInput(defaultDate)} /></label>
              <label class="field"><span>Ends</span><input name="eventEnd" type="datetime-local" defaultValue={isoToLocalInput(event?.end) || (!existing ? localDateInput(defaultEnd) : "")} /></label>
            </div>
          )}

          <div class="dialog-actions">
            {existing ? <button type="button" class="danger-button" onClick={() => void props.onDelete(existing)}>Delete</button> : null}
            <div class="spacer" />
            <button type="button" class="secondary-button" onClick={close}>Cancel</button>
            <button type="submit" class="primary-button">Save</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function SleepDialog(props: {
  task: Task;
  onClose: () => void;
  onSave: (until: string | null) => Promise<void>;
}) {
  const sleep = sleepInfo(props.task, new Date());
  const [value, setValue] = useState(
    sleep.sleeping && !sleep.indefinite ? isoToLocalInput(sleep.until) : isoToLocalInput(tomorrowMidnight(new Date())),
  );

  return (
    <div class="framework-dialog-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) props.onClose();
    }}>
      <div class="editor-dialog sleep-dialog" role="dialog" aria-modal="true" aria-labelledby="sleep-title">
        <form onSubmit={(event) => {
          event.preventDefault();
          const until = localInputToIso(value);
          if (!until || toDate(until) <= new Date()) return;
          void props.onSave(until);
        }}>
          <div class="dialog-header">
            <div><h2 id="sleep-title">Sleep task</h2><p class="muted">{taskTitle(props.task)}</p></div>
            <button type="button" class="icon-button" aria-label="Close" onClick={props.onClose}>×</button>
          </div>
          <label class="field full"><span>Sleep until</span><input type="datetime-local" required value={value} onInput={(event) => setValue((event.currentTarget as HTMLInputElement).value)} /></label>
          <div class="dialog-actions">
            <button type="button" class="secondary-button" onClick={() => void props.onSave(null)}>Sleep indefinitely</button>
            <div class="spacer" />
            <button type="button" class="secondary-button" onClick={props.onClose}>Cancel</button>
            <button type="submit" class="primary-button">Sleep until</button>
          </div>
        </form>
      </div>
    </div>
  );
}
