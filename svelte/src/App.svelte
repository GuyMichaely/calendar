<script lang="ts">
  import { onMount, tick } from "svelte";
  import { canRedo, canUndo, deleteItem, listItems, putItem, redoLabel, undoLabel } from "../../site/storage.js";
  import CalendarView from "./CalendarView.svelte";
  import ItemEditor from "./ItemEditor.svelte";
  import KeyboardShortcutsDialog from "./KeyboardShortcutsDialog.svelte";
  import SleepDialog from "./SleepDialog.svelte";
  import TasksView from "./TasksView.svelte";
  import ToastStack from "./ToastStack.svelte";
  import { applyRedo, applyUndo, exportBackup, importBackup } from "./app-io";
  import { editableTarget, initialView, readCalendarSleepMode, readHorizon, readHorizonMode, readView } from "./app-preferences";
  import type { EditorRequest } from "./editor-types";
  import { loadShortcuts, type Shortcuts } from "./shortcuts";
  import {
    completeTask as completeTaskAction,
    setTaskSleep,
    sleepIndefinite as sleepIndefiniteAction,
    sleepToWait as sleepToWaitAction,
    sleepTomorrow as sleepTomorrowAction,
    waitToSleep as waitToSleepAction,
    wakeTask as wakeTaskAction,
  } from "./task-actions";
  import { captureRovingTask, focusBoundaryTask } from "./task-focus";
  import type { ToastMessage } from "./toast-types";
  import type { CalendarSleepMode, HorizonMode, Item, Task, View } from "./types";

  let items = $state<Item[]>([]);
  let loadingError = $state("");
  let view = $state<View>(initialView());
  let query = $state("");
  let compact = $state(localStorage.getItem("calendar.compactTasks") === "1");
  let horizonDays = $state<number | null>(readHorizon());
  let horizonMode = $state<HorizonMode>(readHorizonMode());
  let calendarSleepMode = $state<CalendarSleepMode>(readCalendarSleepMode());
  const initialMonth = new Date();
  let calendarMonth = $state(new Date(initialMonth.getFullYear(), initialMonth.getMonth(), 1));
  let now = $state(new Date());
  let editor = $state<EditorRequest | null>(null);
  let sleepTask = $state<Task | null>(null);
  let toasts = $state<ToastMessage[]>([]);
  let toastSequence = 0;
  let shortcuts = $state<Shortcuts>(loadShortcuts());
  let showShortcutDialog = $state(false);
  let shortcutReturnTask: HTMLElement | null = null;
  let historyState = $state({ canUndo: canUndo(), canRedo: canRedo(), undoLabel: undoLabel(), redoLabel: redoLabel() });
  let importInput: HTMLInputElement;
  let menu: HTMLDetailsElement;

  function dismissToast(id: number) {
    toasts = toasts.filter((toast) => toast.id !== id);
  }

  function showToast(message: string) {
    if (message) toasts = [...toasts, { id: ++toastSequence, message }];
  }

  async function refresh() {
    items = [...await listItems()];
  }

  function navigate(next: View) {
    view = next;
    const hash = `#${next}`;
    if (location.hash !== hash) history.pushState(null, "", hash);
  }

  function openEditor(item: Item | null = null, kind?: "task" | "event", date?: Date) {
    editor = { item, kind: item?.kind || kind || "task", date, nonce: Date.now() };
  }

  const completeTask = (task: Task) => completeTaskAction(task, refresh, showToast);
  const sleepTomorrow = (task: Task) => sleepTomorrowAction(task, refresh, showToast);
  const sleepIndefinite = (task: Task) => sleepIndefiniteAction(task, refresh, showToast);
  const wakeTask = (task: Task) => wakeTaskAction(task, refresh, showToast);
  const sleepToWait = (task: Task) => sleepToWaitAction(task, refresh, showToast);
  const waitToSleep = (task: Task) => waitToSleepAction(task, refresh, showToast);

  function openShortcuts() {
    shortcutReturnTask = captureRovingTask();
    showShortcutDialog = true;
    if (menu) menu.open = false;
  }

  function closeShortcuts() {
    showShortcutDialog = false;
    const task = shortcutReturnTask;
    shortcutReturnTask = null;
    if (task?.isConnected) void tick().then(() => task.focus());
  }

  onMount(() => {
    refresh().catch((error: Error) => loadingError = error.message || "Could not open local storage.");
    const syncLocation = () => view = readView();
    const syncHistory = (event: Event) => {
      const detail = (event as CustomEvent).detail || {};
      historyState = {
        canUndo: detail.canUndo ?? canUndo(),
        canRedo: detail.canRedo ?? canRedo(),
        undoLabel: detail.undoLabel ?? undoLabel(),
        redoLabel: detail.redoLabel ?? redoLabel(),
      };
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      const dialogOpen = !!document.querySelector(".svelte-dialog-backdrop");
      if (!dialogOpen && !event.ctrlKey && !event.metaKey && !event.altKey && ["ArrowDown", "ArrowUp"].includes(event.key)) {
        const active = document.activeElement;
        if (active === document.body || active === document.documentElement) {
          if (focusBoundaryTask(event.key === "ArrowDown" ? 1 : -1)) event.preventDefault();
        }
      }
      if (dialogOpen || editableTarget(event.target)) return;
      const modifier = event.ctrlKey || event.metaKey;
      if (!modifier || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        void applyUndo(refresh, showToast);
      } else if ((key === "z" && event.shiftKey) || key === "y") {
        event.preventDefault();
        void applyRedo(refresh, showToast);
      }
    };
    const interval = window.setInterval(() => {
      if (!document.querySelector(".svelte-dialog-backdrop")) now = new Date();
    }, 30_000);
    window.addEventListener("hashchange", syncLocation);
    window.addEventListener("popstate", syncLocation);
    window.addEventListener("calendar:history-state", syncHistory);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("hashchange", syncLocation);
      window.removeEventListener("popstate", syncLocation);
      window.removeEventListener("calendar:history-state", syncHistory);
      document.removeEventListener("keydown", handleKeyDown);
    };
  });
</script>

{#if loadingError}
  <div class="svelte-error">Could not open local storage. {loadingError}</div>
{:else}
  <div class="app-shell">
    <header class="topbar">
      <div class="brand-row">
        <details class="svelte-menu" bind:this={menu}>
          <summary class="icon-button menu-trigger" aria-label="Menu" title="Menu">☰</summary>
          <div class="svelte-menu-panel">
            <button class="text-button" disabled={!historyState.canUndo} onclick={() => void applyUndo(refresh, showToast)}>Undo{historyState.undoLabel ? ` · ${historyState.undoLabel}` : ""}</button>
            <button class="text-button" disabled={!historyState.canRedo} onclick={() => void applyRedo(refresh, showToast)}>Redo{historyState.redoLabel ? ` · ${historyState.redoLabel}` : ""}</button>
            <div class="menu-divider"></div>
            <button class="text-button" onclick={openShortcuts}>Keyboard shortcuts…</button>
            <button class="text-button" onclick={() => { if (menu) menu.open = false; void exportBackup(); }}>Export backup</button>
            <button class="text-button" onclick={() => importInput?.click()}>Import backup</button>
          </div>
        </details>
        <nav class="primary-nav" aria-label="Primary">
          <button class={`nav-button ${view === "tasks" ? "active" : ""}`} aria-current={view === "tasks" ? "page" : undefined} onclick={() => navigate("tasks")}>Tasks</button>
          <button class={`nav-button ${view === "calendar" ? "active" : ""}`} aria-current={view === "calendar" ? "page" : undefined} onclick={() => navigate("calendar")}>Calendar</button>
        </nav>
        <span class="svelte-badge">Svelte preview</span>
      </div>
      <div class="top-actions">
        <label class="search-box">
          <span aria-hidden="true">⌕</span>
          <span class="visually-hidden">{view === "calendar" ? "Filter calendar" : "Search tasks"}</span>
          <input type="search" placeholder={view === "calendar" ? "Filter calendar" : "Search tasks"} bind:value={query} autocomplete="off" />
        </label>
        <button class="primary-button" onclick={() => openEditor(null, view === "calendar" ? "event" : "task")}>New</button>
        <input bind:this={importInput} type="file" accept="application/json,.json" hidden onchange={(event) => {
          const input = event.currentTarget;
          const file = input.files?.[0];
          if (file) void importBackup(file, refresh, showToast);
          input.value = "";
          if (menu) menu.open = false;
        }} />
      </div>
    </header>

    <main>
      {#if view === "tasks"}
        <TasksView
          {items} {query} {compact} {horizonDays} {horizonMode} {now} {shortcuts}
          onCompactChange={(value) => { compact = value; localStorage.setItem("calendar.compactTasks", value ? "1" : "0"); }}
          onHorizonChange={(value) => { horizonDays = value; localStorage.setItem("calendar.upcomingHorizon", value === null ? "off" : String(value)); }}
          onHorizonModeChange={(value) => { horizonMode = value; localStorage.setItem("calendar.upcomingHorizonMode", value); }}
          onEdit={(task) => openEditor(task)}
          onComplete={completeTask}
          onWake={wakeTask}
          onSleepTomorrow={sleepTomorrow}
          onSleepIndefinite={sleepIndefinite}
          onSleepCustom={(task) => sleepTask = task}
          onSleepToWait={sleepToWait}
          onWaitToSleep={waitToSleep}
        />
      {:else}
        <CalendarView
          {items} {query} month={calendarMonth} {now} sleepMode={calendarSleepMode}
          onMonthChange={(month) => calendarMonth = month}
          onSleepModeChange={(mode) => { calendarSleepMode = mode; localStorage.setItem("calendar.calendarSleepMode", mode); }}
          onEdit={(item) => openEditor(item)}
          onCreateForDay={(date) => openEditor(null, "event", date)}
          onOpenTodayTasks={() => {
            localStorage.setItem("calendar.section.now", "open");
            localStorage.setItem("calendar.section.upcoming", "open");
            navigate("tasks");
          }}
        />
      {/if}
    </main>

    {#if editor}
      {#key `${editor.item?.id || "new"}:${editor.nonce}`}
        <ItemEditor request={editor} onClose={() => editor = null} onDelete={async (item) => {
          await deleteItem(item.id);
          editor = null;
          await refresh();
          showToast("Deleted");
        }} onSave={async (item, created) => {
          await putItem(item);
          editor = null;
          await refresh();
          showToast(created ? `${item.kind === "task" ? "Task" : "Event"} created` : "Saved");
        }} />
      {/key}
    {/if}

    {#if sleepTask}
      <SleepDialog task={sleepTask} onClose={() => sleepTask = null} onSave={async (until) => {
        if (!sleepTask) return;
        await setTaskSleep(sleepTask, until, refresh, showToast);
        sleepTask = null;
      }} />
    {/if}

    {#if showShortcutDialog}
      <KeyboardShortcutsDialog {shortcuts} onClose={closeShortcuts} onSave={(next) => { shortcuts = next; closeShortcuts(); }} />
    {/if}

    <ToastStack {toasts} onDismiss={dismissToast} />
  </div>
{/if}
