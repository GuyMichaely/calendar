import { Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
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
  parseBackup,
  listItems,
  mergeSyncSnapshot,
  putItem,
  readSyncSnapshot,
  redo,
  redoLabel,
  undo,
  undoLabel,
} from "../../site/storage.js";
import { DialogShell } from "./DialogShell";
import { CalendarView } from "./CalendarView";
import { ItemEditor, SleepDialog, type EditorRequest } from "./ItemEditor";
import {
  configuredBackendUrl,
  createRemoteCalendarClient,
  createRemoteSyncQueue,
  saveConfiguredBackendUrl,
  type RemoteSession,
} from "./remote-sync";
import { KeyboardShortcutSettings, loadShortcuts, type Shortcuts } from "./shortcuts";
import { currentRovingTaskCard, focusBoundaryTask, TasksView } from "./TasksView";
import { ToastStack, type ToastMessage } from "./ToastStack";
import { loadPollSeconds } from "./settings";
import type { CalendarSleepMode, HorizonMode, Item, Task, View } from "./types";

function readView(): View { return location.hash === "#calendar" ? "calendar" : "tasks"; }
function readHorizon(): number | null {
  const stored = localStorage.getItem("calendar.upcomingHorizon");
  if (stored === "off") return null;
  const parsed = Number(stored);
  return [1, 7, 30].includes(parsed) ? parsed : 7;
}
function readHorizonMode(): HorizonMode { return localStorage.getItem("calendar.upcomingHorizonMode") === "boundary" ? "boundary" : "rolling"; }
function readCalendarSleepMode(): CalendarSleepMode { return localStorage.getItem("calendar.calendarSleepMode") === "ignore" ? "ignore" : "respect"; }
function editableTarget(target: EventTarget | null) { return target instanceof Element && !!target.closest("input, textarea, select, [contenteditable='true']"); }
function errorMessage(error: unknown, fallback: string) { return error instanceof Error && error.message ? error.message : fallback; }

type HistoryState = { canUndo: boolean; canRedo: boolean; undoLabel: string; redoLabel: string; };

export function App() {
  if (!["#tasks", "#calendar"].includes(location.hash)) history.replaceState(null, "", "#tasks");
  const backendUrl = configuredBackendUrl();
  const remote = backendUrl ? createRemoteCalendarClient({ backendUrl, storage: { readSnapshot: readSyncSnapshot, mergeSnapshot: mergeSyncSnapshot } }) : null;
  const [remoteUrlDraft, setRemoteUrlDraft] = createSignal(backendUrl);
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
  const [shortcutsDirty, setShortcutsDirty] = createSignal(false);
  const [showSettings, setShowSettings] = createSignal(false);
  const [settingsTab, setSettingsTab] = createSignal<"data" | "keyboard">("data");
  const [pollSeconds, setPollSeconds] = createSignal(loadPollSeconds());
  const [remoteSession, setRemoteSession] = createSignal<RemoteSession | null>(null);
  const [remoteBusy, setRemoteBusy] = createSignal(false);
  const [remoteError, setRemoteError] = createSignal("");
  const [lastSyncedAt, setLastSyncedAt] = createSignal<Date | null>(null);
  const [historyState, setHistoryState] = createSignal<HistoryState>({ canUndo: canUndo(), canRedo: canRedo(), undoLabel: undoLabel(), redoLabel: redoLabel() });
  const [pendingImport, setPendingImport] = createSignal<{ text: string; added: number; updated: number } | null>(null);
  const [importing, setImporting] = createSignal(false);
  let toastSequence = 0;
  let importRef!: HTMLInputElement;
  let settingsReturnTask: HTMLElement | null = null;

  const dismissToast = (id: number) => setToasts((current) => current.filter((toast) => toast.id !== id));
  const showToast = (message: string) => {
    if (!message) return;
    const id = ++toastSequence;
    setToasts((current) => [...current, { id, message }]);
  };
  const saveRemoteServer = () => {
    try {
      const normalized = saveConfiguredBackendUrl(remoteUrlDraft());
      setRemoteUrlDraft(normalized);

      window.location.reload();
    } catch (error) {
      showToast(errorMessage(error, "Invalid remote sync URL."));
    }
  };
  const refresh = async () => { const next = await listItems(); setItems([...next]); };
  const remoteQueue = remote ? createRemoteSyncQueue({
    sync: () => remote.sync(),
    onBusyChange: setRemoteBusy,
    onSynced: async () => { await refresh(); setRemoteError(""); setLastSyncedAt(new Date()); },
    onError: (error) => {
      const status = typeof error === "object" && error !== null && "status" in error ? (error as { status?: unknown }).status : null;
      if (status === 401) setRemoteSession({ authenticated: false, identity: null });
      setRemoteError(errorMessage(error, "Remote sync failed."));
    },
  }) : null;
  const requestRemoteSync = async (announce = false) => {
    if (!remoteQueue || !remoteSession()?.authenticated) return false;
    try {
      await remoteQueue.request();
      if (announce) showToast("Synced");
      return true;
    } catch (error) {
      const message = errorMessage(error, "Remote sync failed.");
      setRemoteError(message);
      if (announce) showToast(message);
      return false;
    }
  };
  const checkRemoteSession = async () => {
    if (!remote) return;
    setRemoteError("");
    try {
      const session = await remote.session();
      setRemoteSession(session);
      if (session.authenticated) await requestRemoteSync();
    } catch (error) {
      setRemoteSession(null);
      setRemoteError(errorMessage(error, "Could not reach calendar sync."));
    }
  };
  const refreshRemoteOnResume = () => {
    if (!remote) return;
    if (remoteSession()?.authenticated) void requestRemoteSync();
    else if (remoteSession() === null && remoteError()) void checkRemoteSession();
  };
  const signOutRemote = async () => {
    if (!remote) return;
    try {
      await remote.logout();
      setRemoteSession({ authenticated: false, identity: null });
      setRemoteError("");
      setLastSyncedAt(null);
      showToast("Signed out");
    } catch (error) { showToast(errorMessage(error, "Could not sign out.")); }
  };
  const remoteIdentityLabel = () => {
    const identity = remoteSession()?.identity;
    return identity?.name || identity?.email || identity?.subject || "Signed in";
  };
  const navigate = (next: View) => {
    setView(next);
    const hash = `#${next}`;
    if (location.hash !== hash) history.pushState(null, "", hash);
  };
  const openEditor = (item: Item | null = null, kind?: "task" | "event", date?: Date) => setEditor({ item, kind: item?.kind || kind || "task", date, nonce: Date.now() });
  const mutateTask = async (task: Task, patch: Partial<Task>, historyEntry: { type: string; [key: string]: unknown }, message: string) => {
    const now = new Date().toISOString();
    const next: Task = { ...task, ...patch, updatedAt: now, history: [...(task.history || []), { at: now, ...historyEntry }] };
    await putItem(next, task); await refresh(); void requestRemoteSync(); showToast(message);
  };
  const completeTask = async (task: Task) => {
    const now = new Date().toISOString();
    const next: Task = { ...task, state: "completed", completedAt: now, sleep: null, updatedAt: now, history: [...(task.history || []), { at: now, type: "completed" }] };
    await putItem(next, task); await refresh(); void requestRemoteSync(); showToast("Task completed");
  };
  const sleepTomorrow = async (task: Task) => {
    const now = new Date(); const until = tomorrowMidnight(now).toISOString();
    await mutateTask(task, { sleep: { until, startedAt: now.toISOString() } }, { type: "slept", until }, "Sleeping until tomorrow");
  };
  const sleepIndefinite = async (task: Task) => {
    const now = new Date().toISOString();
    await mutateTask(task, { sleep: { until: null, startedAt: now } }, { type: "slept", until: null }, "Sleeping indefinitely");
  };
  const wakeTask = (task: Task) => mutateTask(task, { sleep: null }, { type: "woke" }, "Task is awake");
  const sleepToWait = async (task: Task) => {
    const sleep = sleepInfo(task, new Date()); if (!sleep.sleeping || sleep.indefinite) return;
    const existingStart = toDate(task.availableFrom); const waitUntil = existingStart && existingStart > sleep.until ? existingStart : sleep.until;
    await mutateTask(task, { sleep: null, availableFrom: waitUntil.toISOString() }, { type: "sleep-converted-to-wait", until: waitUntil.toISOString() }, "Converted sleep to waiting");
  };
  const waitToSleep = async (task: Task) => {
    const available = toDate(task.availableFrom); if (!available || available <= new Date()) return;
    const now = new Date().toISOString();
    await mutateTask(task, { availableFrom: null, sleep: { until: available.toISOString(), startedAt: now } }, { type: "wait-converted-to-sleep", until: available.toISOString() }, "Converted waiting to sleep");
  };
  const applyUndo = async () => { const label = undoLabel(); if (!(await undo())) return; await refresh(); void requestRemoteSync(); showToast(`Undo${label ? ` ${label}` : ""}`); };
  const applyRedo = async () => { const label = redoLabel(); if (!(await redo())) return; await refresh(); void requestRemoteSync(); showToast(`Redo${label ? ` ${label}` : ""}`); };
  const exportBackup = async () => {
    const text = await exportData(); const blob = new Blob([text], { type: "application/json" }); const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
    anchor.href = url; anchor.download = `calendar-backup-${dateKey(new Date())}.json`; anchor.click(); URL.revokeObjectURL(url);
  };
  const importBackup = async (file: File) => {
    try {
      const text = await file.text();
      const incoming = parseBackup(text);
      const ids = new Set((await listItems()).map((item) => item.id));
      const updated = incoming.filter((item) => ids.has(item.id)).length;
      setPendingImport({ text, added: incoming.length - updated, updated });
    } catch (error) { showToast(errorMessage(error, "Import failed")); }
  };
  const confirmImport = async () => {
    const pending = pendingImport();
    if (!pending || importing()) return;
    setImporting(true);
    try {
      const count = await importData(pending.text);
      await refresh(); void requestRemoteSync();
      setPendingImport(null); showToast(`Imported ${count} items`);
    } catch (error) { showToast(errorMessage(error, "Import failed")); }
    finally { setImporting(false); }
  };
  const openSettings = () => { settingsReturnTask = currentRovingTaskCard(); setShowSettings(true); };
  const closeSettings = () => { if (shortcutsDirty() && !window.confirm("Discard your unsaved shortcut changes?")) return; setShowSettings(false); const task = settingsReturnTask; settingsReturnTask = null; if (task?.isConnected) requestAnimationFrame(() => task.focus()); };

  createEffect(() => {
    const seconds = pollSeconds();
    if (!seconds) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && navigator.onLine && !remoteBusy()) refreshRemoteOnResume();
    }, seconds * 1000);
    onCleanup(() => window.clearInterval(timer));
  });

  onMount(() => {
    void (async () => {
      try { await refresh(); } catch (error) { setLoadingError(errorMessage(error, "Could not open local storage.")); return; }
      if (remote) await checkRemoteSession();
    })();
    const clockTimer = window.setInterval(() => { if (!document.querySelector(".solid-dialog-backdrop")) setClock(new Date()); }, 30_000);
    const syncLocation = () => setView(readView());
    const syncRemoteWhenVisible = () => { if (document.visibilityState === "visible") refreshRemoteOnResume(); };
    const syncHistory = (event: Event) => {
      const detail = (event as CustomEvent<Partial<HistoryState>>).detail || {};
      setHistoryState({ canUndo: detail.canUndo ?? canUndo(), canRedo: detail.canRedo ?? canRedo(), undoLabel: detail.undoLabel ?? undoLabel(), redoLabel: detail.redoLabel ?? redoLabel() });
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
          if (key === "z" && !event.shiftKey) { event.preventDefault(); void applyUndo(); }
          else if ((key === "z" && event.shiftKey) || key === "y") { event.preventDefault(); void applyRedo(); }
        }
      }
    };
    window.addEventListener("hashchange", syncLocation); window.addEventListener("popstate", syncLocation); window.addEventListener("online", refreshRemoteOnResume); window.addEventListener("calendar:history-state", syncHistory); document.addEventListener("visibilitychange", syncRemoteWhenVisible); document.addEventListener("keydown", onKeyDown);
    onCleanup(() => {
      window.clearInterval(clockTimer); window.removeEventListener("hashchange", syncLocation); window.removeEventListener("popstate", syncLocation); window.removeEventListener("online", refreshRemoteOnResume); window.removeEventListener("calendar:history-state", syncHistory); document.removeEventListener("visibilitychange", syncRemoteWhenVisible); document.removeEventListener("keydown", onKeyDown);
    });
  });

  return (
    <Show when={!loadingError()} fallback={<div class="solid-error">Could not open local storage. {loadingError()}</div>}>
      <div class="app-shell">
        <header class="topbar">
          <div class="brand-row">
            <button class="icon-button settings-trigger" aria-label="Settings" title="Settings" onClick={openSettings}>⚙</button>
            <div class="mobile-history" aria-label="History">
              <button class="icon-button" aria-label="Undo" title={historyState().undoLabel || "Undo"} disabled={!historyState().canUndo} onClick={() => void applyUndo()}>↶</button>
              <button class="icon-button" aria-label="Redo" title={historyState().redoLabel || "Redo"} disabled={!historyState().canRedo} onClick={() => void applyRedo()}>↷</button>
            </div>
            <nav class="primary-nav" aria-label="Primary">
              <button class={`nav-button ${view() === "tasks" ? "active" : ""}`} aria-current={view() === "tasks" ? "page" : undefined} onClick={() => navigate("tasks")}>Tasks</button>
              <button class={`nav-button ${view() === "calendar" ? "active" : ""}`} aria-current={view() === "calendar" ? "page" : undefined} onClick={() => navigate("calendar")}>Calendar</button>
            </nav>
          </div>
          <div class="top-actions">
            <label class="search-box"><span aria-hidden="true">⌕</span><span class="visually-hidden">{view() === "calendar" ? "Search calendar" : "Search tasks"}</span><input type="search" placeholder={view() === "calendar" ? "Search calendar" : "Search tasks"} value={query()} onInput={(event) => setQuery(event.currentTarget.value)} autocomplete="off" /></label>
            <button class="primary-button" onClick={() => openEditor(null, view() === "calendar" ? "event" : "task")}>New</button>
            <input ref={(element) => { importRef = element; }} type="file" accept="application/json,.json" hidden onChange={(event) => { const input = event.currentTarget; const file = input.files?.[0]; if (file) { setShowSettings(false); void importBackup(file); } input.value = "";  }} />
          </div>
        </header>
        <div class="solid-menu-status" role="status">{remoteBusy() ? "Syncing…" : remoteError() ? `Saved locally · ${remoteError()}` : lastSyncedAt() ? `Synced at ${lastSyncedAt()!.toLocaleTimeString()}` : "Saved locally"}</div>
        <main>
          <Show when={view() === "tasks"} fallback={<CalendarView items={items()} query={query()} month={calendarMonth()} sleepMode={calendarSleepMode()} now={clock()} onMonthChange={setCalendarMonth} onSleepModeChange={(mode) => { setCalendarSleepMode(mode); localStorage.setItem("calendar.calendarSleepMode", mode); }} onEdit={(item) => openEditor(item)} onCreateForDay={(date) => openEditor(null, "event", date)} onOpenTodayTasks={() => { localStorage.setItem("calendar.section.now", "open"); localStorage.setItem("calendar.section.upcoming", "open"); navigate("tasks"); requestAnimationFrame(() => document.querySelector('[data-section="now"]')?.scrollIntoView({ block: "start" })); }} />}>
            <TasksView onAddSubtask={task => setEditor({ item: null, kind: "task", parentId: task.id, nonce: Date.now() })} items={items()} query={query()} compact={compact()} horizonDays={horizonDays()} horizonMode={horizonMode()} shortcuts={shortcuts()} now={clock()} onCompactChange={(value) => { setCompact(value); localStorage.setItem("calendar.compactTasks", value ? "1" : "0"); }} onHorizonChange={(value) => { setHorizonDays(value); localStorage.setItem("calendar.upcomingHorizon", value === null ? "off" : String(value)); }} onHorizonModeChange={(value) => { setHorizonMode(value); localStorage.setItem("calendar.upcomingHorizonMode", value); }} onEdit={(task) => openEditor(task)} onComplete={completeTask} onWake={wakeTask} onSleepTomorrow={sleepTomorrow} onSleepIndefinite={sleepIndefinite} onSleepCustom={setSleepTask} onSleepToWait={sleepToWait} onWaitToSleep={waitToSleep} />
          </Show>
        </main>
        <Show when={editor()} keyed>{(request) => <ItemEditor items={items()} onEditItem={task => openEditor(task)} onAddSubtask={task => setEditor({ item: null, kind: "task", parentId: task.id, nonce: Date.now() })} request={request} onClose={() => setEditor(null)} onDelete={async (item) => { await deleteItem(item.id); setEditor(null); await refresh(); void requestRemoteSync(); showToast("Deleted"); }} onSave={async (item, _created, baseline) => { const saved = await putItem(item, baseline); await refresh(); void requestRemoteSync(); return saved; }} onError={showToast} />}</Show>
        <Show when={sleepTask()} keyed>{(task) => <SleepDialog task={task} onClose={() => setSleepTask(null)} onInvalid={() => showToast("Choose a future sleep time")} onSave={async (until) => { const now = new Date().toISOString(); await mutateTask(task, { sleep: { until, startedAt: task.sleep?.startedAt || now } }, { type: "slept", until }, until ? `Sleeping until ${formatDateTime(until)}` : "Sleeping indefinitely"); setSleepTask(null); }} />}</Show>
        <Show when={showSettings()}><DialogShell labelledBy="settings-title" className="settings-dialog" onClose={closeSettings}>
          <div class="settings-content">
            <div class="dialog-header"><h2 id="settings-title">Settings</h2><button class="icon-button" aria-label="Close settings" onClick={closeSettings}>×</button></div>
            <div class="settings-tabs" role="tablist" aria-label="Settings sections">
              <button role="tab" aria-selected={settingsTab() === "data"} onClick={() => { if (!shortcutsDirty() || window.confirm("Discard your unsaved shortcut changes?")) setSettingsTab("data"); }}>Data</button>
              <button class="keyboard-settings-tab" role="tab" aria-selected={settingsTab() === "keyboard"} onClick={() => setSettingsTab("keyboard")}>Keyboard shortcuts</button>
            </div>
            <Show when={settingsTab() === "data"} fallback={<KeyboardShortcutSettings onDirtyChange={setShortcutsDirty} shortcuts={shortcuts()} onClose={closeSettings} onSave={(next) => { setShortcuts(next); showToast("Shortcuts saved"); }} />}>
              <section class="data-settings" aria-label="Data settings">
                <h3>Backup &amp; sync</h3>
                <button class="text-button" onClick={() => void exportBackup()}>Export backup</button>
                <button class="text-button" onClick={() => importRef.click()}>Import backup</button>
                <div class="solid-menu-divider" />
                <form class="solid-menu-remote" onSubmit={(event) => { event.preventDefault(); saveRemoteServer(); }}>
                  <label>
                    <span>Remote sync server</span>
                    <input
                      type="url"
                      inputmode="url"
                      placeholder="https://calendar-sync.guymichaely.com/"
                      value={remoteUrlDraft()}
                      onInput={(event) => setRemoteUrlDraft(event.currentTarget.value)}
                    />
                  </label>
                  <div class="solid-menu-status">Paste the backend base URL. Leave blank to disable remote sync.</div>
                  <button class="text-button" type="submit">Save sync server</button>
                </form>
                <Show when={remote}>
                  <div class="solid-menu-divider" />
                  <Show when={remoteSession() !== null} fallback={<button class="text-button" disabled={!remoteError()} onClick={() => void checkRemoteSession()}>{remoteError() ? "Retry remote connection" : "Checking remote…"}</button>}>
                    <Show when={remoteSession()?.authenticated} fallback={<button class="text-button" onClick={() => {  window.location.assign(remote!.loginUrl("google")); }}>Sign in with Google</button>}>
                      <div class="solid-menu-status">Signed in as {remoteIdentityLabel()}</div>
                      <button class="text-button" disabled={remoteBusy()} onClick={() => {  void requestRemoteSync(true); }}>{remoteBusy() ? "Syncing…" : "Sync now"}</button>
                      <button class="text-button" onClick={() => void signOutRemote()}>Sign out</button>
                      <Show when={lastSyncedAt()} keyed>{(syncedAt) => <div class="solid-menu-status">Last synced {syncedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</div>}</Show>
                    </Show>
                  </Show>
                  <Show when={remoteError()} keyed>{(message) => <div class="solid-menu-error">{message}</div>}</Show>
                </Show>

                <label class="field"><span>Check for remote changes</span><select value={pollSeconds()} onChange={(event) => { const value = Number(event.currentTarget.value); setPollSeconds(value); localStorage.setItem("calendar.pollSeconds", String(value)); }}>
                  <option value="5">Every 5 seconds</option><option value="15">Every 15 seconds</option><option value="30">Every 30 seconds</option><option value="60">Every minute</option><option value="300">Every 5 minutes</option><option value="0">Manual / after my edits</option>
                </select></label>
                <p class="field-hint">Applies on this device while the app is visible. Your edits save locally automatically and sync after editing, reconnecting, or returning to the app. Sync now is always available when signed in.</p>
              </section>
            </Show>
          </div>
        </DialogShell></Show>
        <Show when={pendingImport()} keyed>{(pending) => <DialogShell labelledBy="import-title" onClose={() => { if (!importing()) setPendingImport(null); }}>
          <div style={{ padding: "20px" }}>
            <h2 id="import-title">Import backup</h2>
            <p>Add {pending.added} new items and update {pending.updated} matching items.</p>
            <p>Matching IDs are updated with fields from the backup, including text, dates, tags, and attachment references. Items missing from the backup stay in your calendar. This does not replace your whole calendar.</p>
            <p>JSON backups include item values and each task’s activity history (such as creation, completion, and sleep changes). They do not include undo/redo history, the Automerge change history used for syncing, or attachment files. Referenced files must still exist on your sync server. Imported changes will sync to your other devices. You can undo this import.</p>
            <div class="dialog-actions"><button class="secondary-button" disabled={importing()} onClick={() => setPendingImport(null)}>Cancel</button><button class="primary-button" disabled={importing()} onClick={() => void confirmImport()}>{importing() ? "Importing…" : "Import and update matches"}</button></div>
          </div>
        </DialogShell>}</Show>
        <ToastStack toasts={toasts()} onDismiss={dismissToast} />
      </div>
    </Show>
  );
}
