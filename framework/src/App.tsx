import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import {
  dateKey,
  formatDateTime,
  isSleeping,
  sleepInfo,
  toDate,
  tomorrowMidnight,
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
import { CalendarView } from "./CalendarView";
import { ItemEditor, SleepDialog, type EditorRequest } from "./ItemEditor";
import type { Shortcuts } from "./shortcuts";
import { TasksView } from "./TasksView";
import { ToastStack, type ToastMessage } from "./ToastStack";
import type { CalendarSleepMode, HorizonMode, Item, Task, View } from "./types";

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

function editableTarget(target: EventTarget | null) {
  return target instanceof Element && !!target.closest("input, textarea, select, [contenteditable='true']");
}

export function App(props: { shortcuts: Shortcuts; onOpenShortcuts: () => void }) {
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
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const toastSequence = useRef(0);
  const [historyState, setHistoryState] = useState(() => ({
    canUndo: canUndo(),
    canRedo: canRedo(),
    undoLabel: undoLabel(),
    redoLabel: redoLabel(),
  }));
  const importRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDetailsElement>(null);

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback((message: string) => {
    if (!message) return;
    const id = ++toastSequence.current;
    setToasts((current) => [...current, { id, message }]);
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

  const completeTask = useCallback(async (task: Task) => {
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
  }, [refresh, showToast]);

  const sleepTomorrow = useCallback(async (task: Task) => {
    const now = new Date();
    const until = tomorrowMidnight(now).toISOString();
    await mutateTask(
      task,
      { sleep: { until, startedAt: task.sleep?.startedAt || now.toISOString() } },
      { type: "slept", until },
      "Sleeping until tomorrow",
    );
  }, [mutateTask]);

  const sleepIndefinite = useCallback(async (task: Task) => {
    const now = new Date().toISOString();
    await mutateTask(
      task,
      { sleep: { until: null, startedAt: task.sleep?.startedAt || now } },
      { type: "slept", until: null },
      "Sleeping indefinitely",
    );
  }, [mutateTask]);

  const wakeTask = useCallback(
    (task: Task) => mutateTask(task, { sleep: null }, { type: "woke" }, "Task is awake"),
    [mutateTask],
  );

  const sleepToWait = useCallback(async (task: Task) => {
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
  }, [mutateTask]);

  const waitToSleep = useCallback(async (task: Task) => {
    const available = toDate(task.availableFrom);
    if (!available || available <= new Date()) return;
    const now = new Date().toISOString();
    await mutateTask(
      task,
      { availableFrom: null, sleep: { until: available.toISOString(), startedAt: now } },
      { type: "wait-converted-to-sleep", until: available.toISOString() },
      "Converted waiting to sleep",
    );
  }, [mutateTask]);

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
      if (document.querySelector(".framework-dialog-backdrop") || editableTarget(event.target)) return;
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

  const importBackup = useCallback(async (file: File) => {
    try {
      const count = await importData(await file.text());
      await refresh();
      showToast(`Imported ${count} items`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Import failed");
    }
  }, [refresh, showToast]);

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
              <button class="text-button" onClick={() => {
                if (menuRef.current) menuRef.current.open = false;
                props.onOpenShortcuts();
              }}>Keyboard shortcuts…</button>
              <button class="text-button" onClick={() => void exportBackup()}>Export backup</button>
              <button class="text-button" onClick={() => importRef.current?.click()}>Import backup</button>
            </div>
          </details>
          <nav class="primary-nav" aria-label="Primary">
            <button class={`nav-button ${view === "tasks" ? "active" : ""}`} aria-current={view === "tasks" ? "page" : undefined} onClick={() => navigate("tasks")}>Tasks</button>
            <button class={`nav-button ${view === "calendar" ? "active" : ""}`} aria-current={view === "calendar" ? "page" : undefined} onClick={() => navigate("calendar")}>Calendar</button>
          </nav>
          <span class="framework-badge">Preact preview</span>
        </div>
        <div class="top-actions">
          <label class="search-box">
            <span aria-hidden="true">⌕</span>
            <span class="visually-hidden">{view === "calendar" ? "Filter calendar" : "Search tasks"}</span>
            <input
              type="search"
              placeholder={view === "calendar" ? "Filter calendar" : "Search tasks"}
              value={query}
              onInput={(event) => setQuery(event.currentTarget.value)}
              autoComplete="off"
            />
          </label>
          <button class="primary-button" onClick={() => openEditor(null, view === "calendar" ? "event" : "task")}>New</button>
          <input
            ref={importRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(event) => {
              const input = event.currentTarget;
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
            shortcuts={props.shortcuts}
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
            onSleepIndefinite={sleepIndefinite}
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

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
