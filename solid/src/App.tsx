import { Show, createSignal, onCleanup, onMount } from "solid-js";
import {
  dateKey,
  formatDateTime,
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
import { KeyboardShortcutsDialog, loadShortcuts, type Shortcuts } from "./shortcuts";
import { currentRovingTaskCard, focusBoundaryTask, TasksView } from "./TasksView";
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

type HistoryState = {
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string;
  redoLabel: string;
};

export function App() {
  if (!["#tasks", "#calendar"].includes(location.hash)) history.replaceState(null, "", "#tasks");

  const [items, setItems] = createSignal<Item[]>([]);
  const [loadingError, setLoadingError] = createSignal("");
  const [view, setView] = createSignal<View>(readView());
  const [query, setQuery] = createSignal("");
  const [compact, setCompact] = createSignal(localStorage.getItem("calendar.compactTasks") === "1");
  const [horizonDays, setHorizonDays] = createSignal<number | null>(readHorizon());
  const [horizonMode, setHorizonMode] = createSignal<HorizonMode>(readHorizonMode());
  const [calendarSleepMode, setCalendarSleepMode] = createSignal<CalendarSleepMode>(readCalendarSleepMode());
  const nowAtStart = new Date();
  const [clock, setClock] = createSignal(nowAtStart);
  const [calendarMonth, setCalendarMonth] = createSignal(new Date(nowAtStart.getFullYear(), nowAtStart.getMonth(), 1));
  const [editor, setEditor] = createSignal<EditorRequest | null>(null);
  const [sleepTask, setSleepTask] = createSignal<Task | null>(null);
  const [toasts, setToasts] = createSignal<ToastMessage[]>([]);
  const [shortcuts, setShortcuts] = createSignal<Shortcuts>(loadShortcuts());
  const [showShortcutDialog, setShowShortcutDialog] = createSignal(false);
  const [historyState, setHistoryState] = createSignal<HistoryState>({
    canUndo: canUndo(),
    canRedo: canRedo(),
    undoLabel: undoLabel(),
    redoLabel: redoLabel(),
  });
  let toastSequence = 0;
  let importRef!: HTMLInputElement;
  let menuRef!: HTMLDetailsElement;
  let shortcutReturnTask: HTMLElement | null = null;

  const dismissToast = (id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  };

  const showToast = (message: string) => {
    if (!message) return;
    const id = ++toastSequence;
    setToasts((current) => [...current, { id, message }]);
  };

  const refresh = async () => {
    const next = await listItems();
    setItems([...next]);
  };

  const navigate = (next: View) => {
    setView(next);
    const hash = `#${next}`;
    if (location.hash !== hash) history.pushState(null, "", hash);
  };

  const openEditor = (item: Item | null = null, kind?: "task" | "event", date?: Date) => {
    setEditor({ item, kind: item?.kind || kind || "task", date, nonce: Date.now() });
  };

  const mutateTask = async (
    task: Task,
    patch: Partial<Task>,
    historyEntry: { type: string; [key: string]: unknown },
    message: string,
  ) => {
    const now = new Date().toISOString();
    const next: Task = {
      ...task,
      ...patch,
      updatedAt: now,
      history: [...(task.history || []), { at: now, ...historyEntry }],
    };
    await putItem(next, task);
    await refresh();
    showToast(message);
  };

  const completeTask = async (task: Task) => {
    const now = new Date().toISOString();
    const next: Task = {
      ...task,
      state: "completed",
      completedAt: now,
      sleep: null,
      updatedAt: now,
      history: [...(task.history || []), { at: now, type: "completed" }],
    };
    await putItem(next, task);
    await refresh();
    showToast("Task completed");
  };

  const sleepTomorrow = async (task: Task) => {
    const now = new Date();
    const until = tomorrowMidnight(now).toISOString();
    await mutateTask(
      task,
      { sleep: { until, startedAt: now.toISOString() } },
      { type: "slept", until },
      "Sleeping until tomorrow",
    );
  };

  const sleepIndefinite = async (task: Task) => {
    const now = new Date().toISOString();
    await mutateTask(
      task,
      { sleep: { until: null, startedAt: now } },
      { type: "slept", until: null },
      "Sleeping indefinitely",
    );
  };

  const wakeTask = (task: Task) => mutateTask(task, { sleep: null }, { type: "woke" }, "Task is awake");

  const sleepToWait = async (task: Task) => {
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
  };

  const waitToSleep = async (task: Task) => {
    const available = toDate(task.availableFrom);
    if (!available || available <= new Date()) return;
    const now = new Date().toISOString();
    await mutateTask(
      task,
      { availableFrom: null, sleep: { until: available.toISOString(), startedAt: now } },
      { type: "wait-converted-to-sleep", until: available.toISOString() },
      "Converted waiting to sleep",
    );
  };

  const applyUndo = async () => {
    const label = undoLabel();
    if (!(await undo())) return;
    await refresh();
    showToast(`Undo${label ? ` ${label}` : ""}`);
  };

  const applyRedo = async () => {
    const label = redoLabel();
    if (!(await redo())) return;
    await refresh();
    showToast(`Redo${label ? ` ${label}` : ""}`);
  };

  const exportBackup = async () => {
    const text = await exportData();
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `calendar-backup-${dateKey(new Date())}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    menuRef.open = false;
  };

  const importBackup = async (file: File) => {
    try {
      const count = await importData(await file.text());
      await refresh();
      showToast(`Imported ${count} items`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Import failed");
    }
  };

  const openShortcuts = () => {
    shortcutReturnTask = currentRovingTaskCard();
    setShowShortcutDialog(true);
  };

  const closeShortcuts = () => {
    setShowShortcutDialog(false);
    const task = shortcutReturnTask;
    shortcutReturnTask = null;
    if (task?.isConnected) requestAnimationFrame(() => task.focus());
  };

  onMount(() => {
    void refresh().catch((error: Error) => setLoadingError(error.message || "Could not open local storage."));

    const clockTimer = window.setInterval(() => {
      if (!document.querySelector(".solid-dialog-backdrop")) setClock(new Date());
    }, 30_000);

    const syncLocation = () => setView(readView());
    const syncHistory = (event: Event) => {
      const detail = (event as CustomEvent<Partial<HistoryState>>).detail || {};
      setHistoryState({
        canUndo: detail.canUndo ?? canUndo(),
        canRedo: detail.canRedo ?? canRedo(),
        undoLabel: detail.undoLabel ?? undoLabel(),
        redoLabel: detail.redoLabel ?? redoLabel(),
      });
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!document.querySelector(".solid-dialog-backdrop") && !editableTarget(event.target)) {
        if ((event.key === "ArrowDown" || event.key === "ArrowUp") && !event.ctrlKey && !event.metaKey && !event.altKey) {
          const active = document.activeElement;
          if (active === document.body || active === document.documentElement) {
            if (focusBoundaryTask(event.key === "ArrowDown" ? 1 : -1)) event.preventDefault();
            return;
          }
        }

        const modifier = event.ctrlKey || event.metaKey;
        if (modifier && !event.altKey) {
          const key = event.key.toLowerCase();
          if (key === "z" && !event.shiftKey) {
            event.preventDefault();
            void applyUndo();
          } else if ((key === "z" && event.shiftKey) || key === "y") {
            event.preventDefault();
            void applyRedo();
          }
        }
      }
    };

    window.addEventListener("hashchange", syncLocation);
    window.addEventListener("popstate", syncLocation);
    window.addEventListener("calendar:history-state", syncHistory);
    document.addEventListener("keydown", onKeyDown);

    onCleanup(() => {
      window.clearInterval(clockTimer);
      window.removeEventListener("hashchange", syncLocation);
      window.removeEventListener("popstate", syncLocation);
      window.removeEventListener("calendar:history-state", syncHistory);
      document.removeEventListener("keydown", onKeyDown);
    });
  });

  return (
    <Show when={!loadingError()} fallback={<div class="solid-error">Could not open local storage. {loadingError()}</div>}>
      <div class="app-shell">
        <header class="topbar">
          <div class="brand-row">
            <details class="solid-menu" ref={(element) => { menuRef = element; }}>
              <summary class="icon-button menu-trigger" aria-label="Menu" title="Menu">☰</summary>
              <div class="solid-menu-panel">
                <button class="text-button" disabled={!historyState().canUndo} onClick={() => void applyUndo()}>
                  Undo{historyState().undoLabel ? ` ${historyState().undoLabel}` : ""}
                </button>
                <button class="text-button" disabled={!historyState().canRedo} onClick={() => void applyRedo()}>
                  Redo{historyState().redoLabel ? ` ${historyState().redoLabel}` : ""}
                </button>
                <button class="text-button" onClick={() => void exportBackup()}>Export backup</button>
                <button class="text-button" onClick={() => importRef.click()}>Import backup</button>
                <button class="text-button" onClick={() => { menuRef.open = false; openShortcuts(); }}>Keyboard shortcuts…</button>
              </div>
            </details>
            <nav class="primary-nav" aria-label="Primary">
              <button class={`nav-button ${view() === "tasks" ? "active" : ""}`} aria-current={view() === "tasks" ? "page" : undefined} onClick={() => navigate("tasks")}>Tasks</button>
              <button class={`nav-button ${view() === "calendar" ? "active" : ""}`} aria-current={view() === "calendar" ? "page" : undefined} onClick={() => navigate("calendar")}>Calendar</button>
            </nav>
          </div>
          <div class="top-actions">
            <label class="search-box">
              <span aria-hidden="true">⌕</span>
              <span class="visually-hidden">{view() === "calendar" ? "Search calendar" : "Search tasks"}</span>
              <input
                type="search"
                placeholder={view() === "calendar" ? "Search calendar" : "Search tasks"}
                value={query()}
                onInput={(event) => setQuery(event.currentTarget.value)}
                autocomplete="off"
              />
            </label>
            <button class="primary-button" onClick={() => openEditor(null, view() === "calendar" ? "event" : "task")}>New</button>
            <input
              ref={(element) => { importRef = element; }}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(event) => {
                const input = event.currentTarget;
                const file = input.files?.[0];
                if (file) void importBackup(file);
                input.value = "";
                menuRef.open = false;
              }}
            />
          </div>
        </header>

        <main>
          <Show when={view() === "tasks"} fallback={
            <CalendarView
              items={items()}
              query={query()}
              month={calendarMonth()}
              sleepMode={calendarSleepMode()}
              now={clock()}
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
                requestAnimationFrame(() => document.querySelector('[data-section="now"]')?.scrollIntoView({ block: "start" }));
              }}
            />
          }>
            <TasksView
              items={items()}
              query={query()}
              compact={compact()}
              horizonDays={horizonDays()}
              horizonMode={horizonMode()}
              shortcuts={shortcuts()}
              now={clock()}
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
          </Show>
        </main>

        <Show when={editor()} keyed>{(request) => (
          <ItemEditor
            request={request}
            onClose={() => setEditor(null)}
            onDelete={async (item) => {
              await deleteItem(item.id);
              setEditor(null);
              await refresh();
              showToast("Deleted");
            }}
            onSave={async (item, created) => {
              await putItem(item, request.item);
              setEditor(null);
              await refresh();
              showToast(created ? `${item.kind === "task" ? "Task" : "Event"} created` : "Saved");
            }}
            onError={showToast}
          />
        )}</Show>

        <Show when={sleepTask()} keyed>{(task) => (
          <SleepDialog
            task={task}
            onClose={() => setSleepTask(null)}
            onInvalid={() => showToast("Choose a future sleep time")}
            onSave={async (until) => {
              const now = new Date().toISOString();
              await mutateTask(
                task,
                { sleep: { until, startedAt: task.sleep?.startedAt || now } },
                { type: "slept", until },
                until ? `Sleeping until ${formatDateTime(until)}` : "Sleeping indefinitely",
              );
              setSleepTask(null);
            }}
          />
        )}</Show>

        <Show when={showShortcutDialog()}>
          <KeyboardShortcutsDialog
            shortcuts={shortcuts()}
            onClose={closeShortcuts}
            onSave={(next) => {
              setShortcuts(next);
              closeShortcuts();
            }}
          />
        </Show>

        <ToastStack toasts={toasts()} onDismiss={dismissToast} />
      </div>
    </Show>
  );
}
