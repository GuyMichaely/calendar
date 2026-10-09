import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, onMount, untrack } from "solid-js";
import { clockText, dayKey as dateKey, deviceZone, partsOf, setCalendarZone, startOfDay, zonedDate } from "./zone";
import { TimeControl } from "./TimeControl";
import { WorkspaceShell, type SyncState } from "./WorkspaceShell";
import { Icon } from "./Icon";
import { DialogShell } from "./DialogShell";
import { CalendarView } from "./CalendarView";
import { AgendaView } from "./AgendaView";
import { createFind } from "./SearchResults";
import { ItemEditor, type Editable, type EditorRequest } from "./ItemEditor";
import { createCloudSync } from "./cloud-sync";
import { disableWebPush, enableWebPush, inApp, onReminderOpened, registerDevice, scheduleReminders, updateWebPush, webPushSubscribed, webPushSupported, type NotificationAccess } from "./notifications";
import { reminderChoices, upcomingReminders } from "./reminders";
import { createCalendarStore } from "./calendar-store";
import { createPreferences } from "./preferences";
import { KeyboardShortcutSettings, loadShortcuts, type Shortcuts } from "./shortcuts";
import { TodayView, when } from "./TodayView";
import { TimeZoneSettings, WindowSettings } from "./SettingsPanels";
import { deadlineDaysOf, openWork } from "./today";
import { SAMPLE_PREFIX, sampleItems } from "./demo-data";
import { isDormant, projectDependents } from "./dependencies";
import { dependentTasks } from "../../site/task-tree.js";
import { boardTasks } from "./boards";
import { ToastStack, type ToastMessage } from "./ToastStack";
import { animationsEnabled } from "./settings";
import type { CalendarEvent, CalendarSettings, Group, Item, Task, View } from "./types";
import type { SyncMode } from "@guymichaely/app-sync";

function readView(): View { return location.hash === "#calendar" ? "calendar" : /^#boards(\/|$)/.test(location.hash) ? "boards" : /^#list(\/|$)/.test(location.hash) ? "list" : "agenda"; }
// The Agenda lives at #agenda, the Calendar at #calendar, List at #list and Boards at #boards; in
// those two a selected task (open in the side pane) follows a slash.
function readSelectedTask() { const match = /^#(?:list|boards)\/(.+)$/.exec(location.hash); return match ? decodeURIComponent(match[1]) : null; }
function tasksHash(id: string | null, view: View = readView()) { const base = view === "boards" ? "#boards" : "#list"; return id ? `${base}/${encodeURIComponent(id)}` : base; }
// List and Boards are the task views (TodayView): a task opens in their side pane when there's room.
const taskView = (view: View) => view === "list" || view === "boards";
// When tasks join Deadline: on their due day, or some days ahead of it.
const deadlineChoices: [number, string][] = [[0, "Due today (or overdue)"], [1, "Due by tomorrow"], [2, "Due within 3 days"], [6, "Due within a week"]];
function editableTarget(target: EventTarget | null) { return target instanceof Element && !!target.closest("input, textarea, select, [contenteditable='true']"); }
function errorMessage(error: unknown, fallback: string) { return error instanceof Error && error.message ? error.message : fallback; }

export function App() {
  // Changes sync once saved locally; other devices' changes reload the items once merged.
  const store = createCalendarStore({ onChanged: () => sync.changed() });
  const { controller: sync, snapshot: syncSnapshot } = createCloudSync({ onSynced: store.refresh });
  if (!/^#(agenda|list|boards|calendar)$/.test(location.hash) && !readSelectedTask()) history.replaceState(null, "", "#agenda");
  const prefs = createPreferences();
  const items = store.items;
  // The calendar's time zone, synced. A calendar that has none yet gets this device's, once
  // it holds something and (with sync) has caught up, so a new device doesn't impose its own.
  const settings = createMemo(() => items().find((item): item is CalendarSettings => item.kind === "settings"));
  const [ready, setReady] = createSignal(false);
  createEffect(() => { const zone = settings()?.timeZone; if (zone) setCalendarZone(zone); });
  let creatingSettings = false;
  createEffect(() => {
    if (!ready() || settings() || creatingSettings || !items().length || (syncSnapshot().settings?.enabled && !syncSnapshot().lastSyncedAt)) return;
    creatingSettings = true;
    void attempt(() => store.createSettings(deviceZone()), "Could not save the calendar's time zone.").finally(() => { creatingSettings = false; });
  });
  const [loadingError, setLoadingError] = createSignal("");
  const [view, setView] = createSignal<View>(readView());
  const [query, setQuery] = createSignal("");
  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const [reducedMotion, setReducedMotion] = createSignal(motionQuery.matches);
  const animations = () => animationsEnabled(prefs.animations(), reducedMotion());
  // The whole page follows it: off stops every transition and animation, not just the task lists'.
  createEffect(() => { document.documentElement.dataset.animations = animations() ? "on" : "off"; });
  onMount(() => {
    const update = () => setReducedMotion(motionQuery.matches);
    motionQuery.addEventListener("change", update);
    onCleanup(() => motionQuery.removeEventListener("change", update));
  });
  // Pretend time shifts what the lists, calendar, and editor treat as now; the clock keeps
  // ticking from there. Saved timestamps (created, completed, edited) stay real.
  const appNow = () => new Date(Date.now() + prefs.timeOffset());
  const nowAtStart = appNow();
  const [clock, setClock] = createSignal(nowAtStart);
  const pretend = (target: Date | null) => { prefs.setTimeOffset(target ? target.getTime() - Date.now() : 0); setClock(appNow()); };
  // The calendar leaves out dependent tasks that haven't started, or shows them as what-if entries.
  const calendarView = createMemo(() => {
    const byId = new Map(items().map(item => [item.id, item]));
    if (!prefs.showDependents()) return { items: items().filter(item => !isDormant(item, byId)), ghostIds: new Set<string>() };
    const projected = projectDependents(items(), clock());
    return { items: items().map(item => projected.get(item.id) || item), ghostIds: new Set(projected.keys()) };
  });
  // What the top bar says about sync. Edits are always saved in this browser first.
  const syncStatus = createMemo((): { state: SyncState; label: string; detail: string } => {
    const { settings, state, running, lastSyncedAt } = syncSnapshot();
    if (!settings?.enabled || state.kind === "off") return { state: "local", label: "Only in this browser", detail: "Your edits are saved in this browser only. Sign in (Settings → Data) to sync them with your other devices, or export a backup." };
    if (running) return { state: "busy", label: "Syncing", detail: "Sending your edits and fetching your other devices' edits." };
    if (state.kind === "signed-out") return { state: "signed-out", label: "Sign in again", detail: "Your sign-in has expired. Your edits are saved in this browser and sync once you sign in again (Settings → Data)." };
    if (state.kind === "offline") return { state: "offline", label: "Offline", detail: state.message };
    if (state.kind === "error") return { state: "error", label: "Sync needs attention", detail: `${state.message} Your edits are still saved in this browser.` };
    return lastSyncedAt ? { state: "synced", label: "Synced", detail: `Synced with your other devices at ${clockText(new Date(lastSyncedAt))}.` } : { state: "busy", label: "Not synced yet", detail: "Signed in; the first sync hasn't finished." };
  });
  const openCount = createMemo(() => openWork(items()).length);
  const [calendarMonth, setCalendarMonth] = createSignal(zonedDate(partsOf(nowAtStart).year, partsOf(nowAtStart).month, 1));
  // The first day the Calendar's hour views show.
  const [calendarDay, setCalendarDay] = createSignal(startOfDay(nowAtStart));
  const [editor, setEditor] = createSignal<EditorRequest | null>(null);
  // Wide screens keep the task list beside an embedded editor for the selected task.
  const splitQuery = window.matchMedia("(min-width: 1180px)");
  const [splitView, setSplitView] = createSignal(splitQuery.matches);
  onMount(() => {
    const update = () => setSplitView(splitQuery.matches);
    splitQuery.addEventListener("change", update);
    onCleanup(() => splitQuery.removeEventListener("change", update));
  });
  const [selectedTaskId, setSelectedTaskId] = createSignal<string | null>(readSelectedTask());
  const [detailVersion, setDetailVersion] = createSignal(0);
  let flushDetail: (() => Promise<boolean>) | null = null;
  let closeDetailEditor: (() => void) | null = null;
  const [toasts, setToasts] = createSignal<ToastMessage[]>([]);
  const [shortcuts, setShortcuts] = createSignal<Shortcuts>(loadShortcuts());
  const [shortcutsDirty, setShortcutsDirty] = createSignal(false);
  const [showSettings, setShowSettings] = createSignal(false);
  const [settingsTab, setSettingsTab] = createSignal<"data" | "keyboard" | "animations" | "windows" | "display" | "time" | "notifications">("data");
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
  /** Runs a change, reporting failure with a toast. Resolves to whether it succeeded. */
  const attempt = async (run: () => Promise<unknown>, failure: string, success?: string) => {
    try { await run(); } catch (error) { showToast(errorMessage(error, failure)); return false; }
    if (success) showToast(success);
    return true;
  };
  const syncNow = async () => { const state = await sync.syncNow(); showToast(state.kind === "synced" || state.kind === "idle" ? "Synced" : "message" in state ? state.message : "Sign in again to sync"); };
  const signOut = async () => { await sync.turnOff(true); showToast("Signed out; your edits stay in this browser"); };
  const navigate = (next: View) => {
    setView(next);
    const hash = taskView(next) ? tasksHash(selectedTaskId(), next) : `#${next}`;
    if (location.hash !== hash) history.pushState(null, "", hash);
  };
  const editorParents: string[] = [];
  const closeEditor = async () => {
    while (editorParents.length) {
      const item = await store.getItem(editorParents.pop()!);
      if (item && (item.kind === "task" || item.kind === "event" || item.kind === "record")) { setEditor({item, kind: item.kind, nonce: Date.now()}); return; }
    }
    setEditor(null);
  };
  const addEditorSubtask = async (task: Task) => {
    const parent = await store.getItem(task.id);
    if (parent?.kind !== "task") { showToast("Save the parent task before adding a subtask."); return; }
    editorParents.push(parent.id);
    setEditor({item: null, kind: "task", parentId: parent.id, nonce: Date.now()});
  };
  const selectedExists = createMemo(() => { const id = selectedTaskId(); return !!id && items().some(item => item.id === id); });
  const detailRequest = createMemo<EditorRequest | null>(() => {
    detailVersion();
    if (!selectedExists()) return null;
    const item = untrack(items).find(item => item.id === selectedTaskId());
    return item?.kind === "task" ? { item, kind: item.kind, nonce: Date.now() } : null;
  });
  // The detail pane animates in and out: it stays mounted (with its last request)
  // for a beat after closing while the board slides back to full width.
  const paneOpen = () => splitView() && taskView(view()) && !!detailRequest();
  const [paneMounted, setPaneMounted] = createSignal(false);
  const [paneClosing, setPaneClosing] = createSignal(false);
  let paneWasOpen = false, paneTimer: ReturnType<typeof setTimeout> | undefined, lastRequest: EditorRequest | null = null;
  createEffect(() => {
    if (detailRequest()) lastRequest = detailRequest();
    const open = paneOpen();
    if (open === paneWasOpen) return;
    paneWasOpen = open;
    clearTimeout(paneTimer);
    if (open) { setPaneMounted(true); setPaneClosing(false); return; }
    if (!animations()) { setPaneMounted(false); setPaneClosing(false); return; }
    setPaneClosing(true);
    paneTimer = setTimeout(() => { if (!paneOpen()) setPaneMounted(false); setPaneClosing(false); }, 260);
  });
  onCleanup(() => clearTimeout(paneTimer));
  // Save the open task before showing another; a failed save keeps it open with its error.
  const selectTask = async (id: string | null, replace = false) => {
    if (id === selectedTaskId()) return;
    if (flushDetail && !(await flushDetail())) return;
    setSelectedTaskId(id);
    const hash = taskView(view()) ? tasksHash(id, view()) : location.hash;
    if (location.hash !== hash) history[replace ? "replaceState" : "pushState"](null, "", hash);
  };
  const closeDetail = async () => {
    const id = selectedTaskId();
    await selectTask(null);
    if (!selectedTaskId() && id) document.querySelector<HTMLElement>(`[data-task-card][data-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
  };
  const editTask = (task: Task) => { if (splitView() && taskView(view())) void selectTask(task.id); else openEditor(task); };
  // Search that finds (Settings → Display): a result opens where you are; the Calendar also goes to its month.
  const find = createFind({ items, query, now: clock, onOpen: item => {
    if (view() !== "calendar") { if (item.kind === "task") editTask(item); else openEditor(item); return; }
    const at = item.kind === "task" ? item.availableFrom ?? item.deadline ?? item.completedAt : item.start;
    const date = at ? new Date(at) : null;
    if (date && !Number.isNaN(date.getTime())) { setCalendarMonth(zonedDate(partsOf(date).year, partsOf(date).month, 1)); setCalendarDay(startOfDay(date)); }
    openEditor(item);
  } });
  const openEditor = (item: Editable | null = null, kind?: Editable["kind"], date?: Date) => { editorParents.length = 0; setEditor({ item, kind: item?.kind || kind || "task", date, nonce: Date.now() }); };
  // In the Android app: notifications for tasks reaching their can-start time and before events,
  // rescheduled (in real time, not pretend time) whenever the calendar or these settings change
  // and on coming back to the app. While the app's closed, the server tells the phone (FCM) when the
  // calendar changes and it fetches them itself, so once synced, the phone registers for that.
  // Tapping one opens its item (once the calendar has loaded, if the tap opened the app).
  const [notifyAccess, setNotifyAccess] = createSignal<NotificationAccess | null>(null);
  // In a browser, the server pushes reminders (notifications.ts); this browser's switch, and what went wrong turning it.
  const [webPushOn, setWebPushOn] = createSignal(!!webPushSubscribed());
  const [webPushError, setWebPushError] = createSignal("");
  const reminderSettings = () => ({ taskStarts: prefs.notifyTaskStarts(), events: prefs.notifyEvents() });
  const switchWebPush = (wanted: boolean) => {
    setWebPushError("");
    return (wanted ? enableWebPush(reminderSettings()) : disableWebPush()).then(() => setWebPushOn(wanted), error => { setWebPushError(error instanceof Error ? error.message : String(error)); setWebPushOn(!!webPushSubscribed()); });
  };
  if (webPushSupported) createEffect(on(() => [prefs.notifyTaskStarts(), prefs.notifyEvents()], () => { if (untrack(webPushOn)) updateWebPush(reminderSettings()).catch(error => setWebPushError(error.message)); }, { defer: true }));
  if (inApp) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reschedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        // Off, the native side's own fetches (when FCM says the calendar changed) find nothing too.
        const settings = prefs.notify() ? { taskStarts: prefs.notifyTaskStarts(), events: prefs.notifyEvents() } : { taskStarts: false, events: false };
        void scheduleReminders(upcomingReminders(items(), new Date(), settings), settings).then(setNotifyAccess, error => console.error("Could not schedule notifications", error));
      }, 1000);
    };
    createEffect(() => { items(); prefs.notify(); prefs.notifyTaskStarts(); prefs.notifyEvents(); if (ready()) reschedule(); });
    const onVisible = () => { if (document.visibilityState === "visible") reschedule(); };
    document.addEventListener("visibilitychange", onVisible);
    onCleanup(() => { clearTimeout(timer); document.removeEventListener("visibilitychange", onVisible); });
    // Registered while notifications are on, so the server doesn't wake a phone that has nothing to do.
    let registered: boolean | null = null;
    createEffect(() => {
      const want = prefs.notify();
      if (registered === want || syncSnapshot().state.kind !== "synced") return;
      const was = registered;
      registered = want;
      registerDevice(want).catch(error => { registered = was; console.error("Could not change reminder updates", error); });
    });
    const [openedId, setOpenedId] = createSignal<string | null>(null);
    onReminderOpened(setOpenedId);
    createEffect(() => {
      const id = openedId();
      const item = id && ready() ? items().find(entry => entry.id === id) : undefined;
      if (!item) return;
      setOpenedId(null);
      if (item.kind === "task") untrack(() => editTask(item));
      else if (item.kind === "event" || item.kind === "record") untrack(() => openEditor(item));
    });
  }
  const saveItem = (item: Item, _created: boolean, baseline: Item | null) => store.saveItem(item, baseline);
  const quickAddSubtask = (parent: Task, title: string) => attempt(() => store.addSubtask(parent, title), "Could not add subtask.");
  const addTask = (groupId: string | null, title: string, extra: Partial<Task> = {}) => attempt(() => store.addTask(groupId, title, extra), "Could not add task.");
  const addDependent = (parent: Task, title: string) => attempt(() => store.addDependent(parent, title), "Could not add dependent task.");
  const setCompletedSubtasks = async (task: Task, value: Task["completedSubtasks"]) => { await attempt(() => store.patchTask(task, { completedSubtasks: value }), "Could not change how its completed subtasks show."); };
  const reopenTask = async (task: Task) => { await attempt(() => store.reopenTask(task), "Could not reopen the task.", "Reopened"); };
  // Checking off a repeating task finishes this occurrence; a check-in's tick means "It happened".
  const completeTask = async (task: Task) => {
    if (task.repeat && !task.repeat.untilDone) { await attempt(() => store.advanceTask(task, "occurrence-done"), "Could not check off the task.", "Done for now; it'll be back next time"); return; }
    await attempt(() => store.completeTask(task), "Could not complete task.", task.repeat?.untilDone ? "It happened" : "Task completed");
  };
  const finishTask = async (task: Task) => { await attempt(() => store.completeTask(task), "Could not finish the task.", "Finished for good"); };
  const notYet = async (task: Task) => { await attempt(() => store.advanceTask(task, "not-yet"), "Could not record the check-in.", "Checked: not yet"); };
  // The task editor turns a subtask into a dependent task, or back.
  const convertChild = (child: Task, to: "subtask" | "dependent", owner: Task) => attempt(() => to === "dependent" ? store.makeDependent(child, owner) : store.moveTask(child, { parent: owner }), "Could not move task.");
  const startDependent = async (task: Task, completeParent: boolean) => {
    try {
      const { completed } = await store.startDependent(task, completeParent);
      showToast(completed ? `Started “${task.title}” and completed “${completed.title}”` : `Started “${task.title}”`);
    } catch (error) { showToast(errorMessage(error, "Could not start task.")); }
  };
  // Deleting a task also deletes its subtasks and unstarted dependent tasks; one undo brings them back.
  const deleteTask = async (task: Task) => {
    const attached = dependentTasks(items(), task.id) as Task[];
    const title = task.title || "Untitled task";
    // Close the task pane first if it shows one of them, so its pending edits can't recreate a deleted task.
    const selected = selectedTaskId();
    if (selected && [task.id, ...attached.map(item => item.id)].includes(selected)) { await selectTask(null, true); if (selectedTaskId()) return; }
    await attempt(() => store.deleteItem(task.id), "Could not delete task.", `Deleted “${title}” (Ctrl+Z to undo)`);
  };
  const pushDown = async (task: Task, until: Date | null) => { await attempt(() => store.pushDown(task, until), "Could not push the task down.", until ? `Pushed down until ${when(until, new Date())}` : "Pushed down"); };
  const lift = async (task: Task) => { await attempt(() => store.lift(task), "Could not lift the task.", "Lifted back up"); };
  const windowChange = async (run: () => Promise<unknown>) => { await attempt(run, "Could not update windows."); };
  const groupChange = async (run: () => Promise<unknown>) => { await attempt(run, "Could not update boards."); };
  const createGroup = async (title: string) => {
    try { return await store.createGroup(title); }
    catch (error) { showToast(errorMessage(error, "Could not create board.")); return null; }
  };
  // Deleting a board deletes its tasks, or leaves them on no board. Undo brings it all back.
  const deleteGroup = async (group: Group, withTasks: boolean) => {
    const doomed = withTasks ? boardTasks(items(), group) : [];
    // Close the task pane first if it shows one of them, so its pending edits can't recreate a deleted task.
    const selected = selectedTaskId();
    if (selected && doomed.some(task => task.id === selected)) { await selectTask(null, true); if (selectedTaskId()) return; }
    const tasks = doomed.length === 1 ? "its task" : `its ${doomed.length} tasks`;
    if (await attempt(() => store.deleteGroup(group, withTasks), "Could not delete board.")) showToast(`Deleted “${group.title}”${doomed.length ? ` and ${tasks}` : ""} (Ctrl+Z to undo)`);
  };
  const renameGroup = (group: Group, title: string) => groupChange(() => store.renameGroup(group, title));
  // Undo and redo move rows the way the change itself did.
  let motion: ((run: () => Promise<unknown>) => Promise<void>) | null = null;
  const withMotion = async (run: () => Promise<unknown>) => { if (motion && taskView(view())) await motion(run); else await run(); };
  const applyUndo = async () => { let label: string | null = null; await withMotion(async () => { label = await store.undo(); }); if (label !== null) showToast(`Undo${label ? ` ${label}` : ""}`); };
  const applyRedo = async () => { let label: string | null = null; await withMotion(async () => { label = await store.redo(); }); if (label !== null) showToast(`Redo${label ? ` ${label}` : ""}`); };
  const exportBackup = async () => {
    const text = await store.exportBackup(); const blob = new Blob([text], { type: "application/json" }); const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
    anchor.href = url; anchor.download = `calendar-backup-${dateKey(new Date())}.json`; anchor.click(); URL.revokeObjectURL(url);
  };
  const importBackup = async (file: File) => {
    try {
      const text = await file.text();
      setPendingImport({ text, ...(await store.previewImport(text)) });
    } catch (error) { showToast(errorMessage(error, "Import failed")); }
  };
  const confirmImport = async () => {
    const pending = pendingImport();
    if (!pending || importing()) return;
    setImporting(true);
    try {
      const count = await store.importBackup(pending.text);
      setPendingImport(null); showToast(`Imported ${count} items`);
    } catch (error) { showToast(errorMessage(error, "Import failed")); }
    finally { setImporting(false); }
  };
  const openSettings = () => { settingsReturnTask = document.activeElement instanceof HTMLElement && document.activeElement.matches("[data-task-card]") ? document.activeElement : null; setShowSettings(true); };
  const closeSettings = () => { if (shortcutsDirty() && !window.confirm("Discard your unsaved shortcut changes?")) return; setShowSettings(false); const task = settingsReturnTask; settingsReturnTask = null; if (task?.isConnected) requestAnimationFrame(() => task.focus({ preventScroll: true })); };

  onMount(() => {
    void (async () => {
      try { await store.refresh(); } catch (error) { console.error(error); setLoadingError(errorMessage(error, "Could not open local storage.")); return; }
      // A fresh local development copy that isn't syncing starts with sample tasks.
      if (import.meta.env.DEV && !syncSnapshot().settings?.enabled && !items().length) await attempt(() => store.importBackup(JSON.stringify({ items: sampleItems() })), "Could not add the sample tasks.");
      sync.start();
      setReady(true);
    })();
    const clockTimer = window.setInterval(() => { if (!document.querySelector(".solid-dialog-backdrop")) setClock(appNow()); }, 30_000);
    const syncLocation = () => {
      setView(readView());
      const id = readSelectedTask();
      if (!taskView(readView()) || id === selectedTaskId()) return;
      const previous = selectedTaskId();
      void (async () => {
        if (flushDetail && !(await flushDetail())) { history.pushState(null, "", tasksHash(previous, view())); return; }
        setSelectedTaskId(id);
      })();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      // Escape closes the task pane even when focus is on the board (the pane handles it when focused inside).
      if (event.key === "Escape" && !event.defaultPrevented && closeDetailEditor && !document.querySelector(".solid-dialog-backdrop") && !editableTarget(event.target) && !(event.target instanceof Element && event.target.closest(".item-detail"))) {
        event.preventDefault(); closeDetailEditor(); return;
      }
      if (!document.querySelector(".solid-dialog-backdrop") && !editableTarget(event.target)) {
        const modifier = event.ctrlKey || event.metaKey;
        if (modifier && !event.altKey) {
          const key = event.key.toLowerCase();
          if (key === "z" && !event.shiftKey) { event.preventDefault(); void applyUndo(); }
          else if ((key === "z" && event.shiftKey) || key === "y") { event.preventDefault(); void applyRedo(); }
        }
      }
    };
    window.addEventListener("hashchange", syncLocation); window.addEventListener("popstate", syncLocation); document.addEventListener("keydown", onKeyDown);
    onCleanup(() => {
      sync.stop(); window.clearInterval(clockTimer); window.removeEventListener("hashchange", syncLocation); window.removeEventListener("popstate", syncLocation); document.removeEventListener("keydown", onKeyDown);
    });
  });

  return (
    <Show when={!loadingError()} fallback={<StorageRecovery message={loadingError()} readRaw={store.readRawBytes} onRecovered={async text => {
      await store.reset();
      if (text) await store.importBackup(text);
      setLoadingError("");
      sync.start();
      showToast(text ? "Backup imported" : "Started with an empty calendar");
    }} />}>
      <div class="app-shell">
        <input ref={(element) => { importRef = element; }} type="file" accept="application/json,.json" hidden onChange={(event) => { const input = event.currentTarget; const file = input.files?.[0]; if (file) { setShowSettings(false); void importBackup(file); } input.value = ""; }} />
        <WorkspaceShell notice={prefs.showTimeControl() || prefs.timeOffset() ? <TimeControl now={clock()} pretending={!!prefs.timeOffset()} onSet={pretend} onStep={ms => pretend(new Date(appNow().getTime() + ms))} onReset={() => pretend(null)} /> : undefined}
          view={view()} openCount={openCount()} query={query()} onQuery={setQuery}
          searchResults={prefs.findSearch() ? find.view : undefined} onSearchKeyDown={prefs.findSearch() ? find.onKeyDown : undefined} onSearchFocus={find.reopen} searchExpanded={find.open()}
          onNavigate={(next) => { navigate(next); window.scrollTo({top: 0, behavior: "instant"}); }}
          onNew={() => openEditor(null, view() === "calendar" ? "event" : "task")}
          onSettings={() => { setSettingsTab("data"); openSettings(); }}
          syncState={syncStatus().state} syncLabel={syncStatus().label} syncDetail={syncStatus().detail}
          canUndo={store.history().canUndo} canRedo={store.history().canRedo} undoLabel={store.history().undoLabel} redoLabel={store.history().redoLabel} onUndo={() => void applyUndo()} onRedo={() => void applyRedo()}>
          <Show when={view() !== "calendar"} fallback={<CalendarView items={calendarView().items} ghostIds={calendarView().ghostIds} showDependents={prefs.showDependents()} onShowDependentsChange={prefs.setShowDependents} query={query()} month={calendarMonth()} now={clock()} onMonthChange={setCalendarMonth} onEdit={(item) => openEditor(item)} onCreateForDay={(date) => openEditor(null, "event", date)} onOpenTodayTasks={() => navigate("agenda")} mode={prefs.calendarMode()} onModeChange={prefs.setCalendarMode} day={calendarDay()} onDayChange={setCalendarDay} hourHeight={prefs.hourHeight()} onHourHeight={prefs.setHourHeight} showTasks={prefs.calendarTasks()} onShowTasksChange={prefs.setCalendarTasks} />}>
            <Show when={view() !== "agenda"} fallback={<AgendaView items={items()} query={query()} now={clock()} days={prefs.agendaDays()} onDaysChange={prefs.setAgendaDays} todosOpen={prefs.todosOpen()} onEdit={item => openEditor(item)} />}>
            <div class="tasks-workspace" classList={{ split: paneOpen() }}>
            <TodayView items={items()} query={query()} now={clock()} selectedId={splitView() ? selectedTaskId() : null}
             
              view={view() === "boards" ? "boards" : "today"} showBoard={prefs.showBoard()} showTags={prefs.showTags()} pullTimed={prefs.pullTimed()} onPullTimedChange={prefs.setPullTimed} onLayoutBoards={layout => groupChange(() => store.layoutBoards(layout))} onCreateBoard={createGroup} onRenameBoard={renameGroup} onDeleteBoard={deleteGroup} compact={prefs.compact()} onCompactChange={prefs.setCompact} subtaskMode={prefs.subtaskMode()} onSubtaskModeChange={prefs.setSubtaskMode}
              liveEdits={store.liveEdits} onEdit={editTask} onEditEvent={item => openEditor(item)} onComplete={completeTask} onFinish={finishTask} onNotYet={notYet} onAddTask={addTask} onPushDown={pushDown} onLift={lift} onReopen={reopenTask} onCompletedSubtasks={setCompletedSubtasks} onDeleteTask={deleteTask} onStartDependent={startDependent} shortcuts={shortcuts()} onMoveTask={(task, to) => attempt(() => store.moveTask(task, to), "Could not move task.")} registerMotion={next => { motion = next; return () => { if (motion === next) motion = null; }; }} />
            <Show when={paneMounted()}>
              <aside class="task-detail-pane" classList={{ closing: paneClosing() }} aria-label="Task details">
                <Show when={detailRequest() || lastRequest} keyed fallback={<div class="task-detail-empty"><p class="page-eyebrow">Task details</p><h2>Pick a task to see everything about it.</h2><p>Notes, dates, subtasks, and attachments open here. The list stays where it is.</p></div>}>{(request) =>
                  <ItemEditor embedded request={request} items={items()} liveEdits={store.liveEdits} onLiveEdit={store.setLiveEdit} onConvertChild={(child, to) => convertChild(child, to, request.item as Task)} registerFlush={flush => { flushDetail = flush; return () => { if (flushDetail === flush) flushDetail = null; }; }} registerClose={close => { closeDetailEditor = close; return () => { if (closeDetailEditor === close) closeDetailEditor = null; }; }} onStale={() => setDetailVersion(version => version + 1)} onRevert={() => setDetailVersion(version => version + 1)}
                    onQuickAddSubtask={quickAddSubtask} onAddDependent={addDependent} onStartDependent={startDependent} onEditItem={task => void selectTask(task.id)} onAddSubtask={() => {}} onClose={() => void closeDetail()}
                    onDelete={async (item) => { await store.deleteItem(item.id); flushDetail = null; await selectTask(null, true); showToast("Deleted"); }}
                    onSave={saveItem} onError={showToast} onManageWindows={() => { setSettingsTab("windows"); openSettings(); }} now={clock()} />}
                </Show>
              </aside>
            </Show>
            </div>
            </Show>
          </Show>
        </WorkspaceShell>
        <Show when={editor()} keyed>{(request) => <ItemEditor items={items()} liveEdits={store.liveEdits} onLiveEdit={store.setLiveEdit} onConvertChild={(child, to) => convertChild(child, to, request.item as Task)} onAddDependent={addDependent} onStartDependent={startDependent} onEditItem={task => { if (request.item) editorParents.push(request.item.id); setEditor({item: task, kind: "task", nonce: Date.now()}); }} onAddSubtask={task => void addEditorSubtask(task)} request={request} onRevert={saved => setEditor({ ...request, item: saved?.kind === "task" || saved?.kind === "event" ? saved : request.item, nonce: Date.now() })} onClose={() => void closeEditor()} onDelete={async (item) => { const position = { left: window.scrollX, top: window.scrollY }; await store.deleteItem(item.id); await closeEditor(); requestAnimationFrame(() => window.scrollTo({ ...position, behavior: "instant" })); showToast("Deleted"); }} onSave={saveItem} onError={showToast} onManageWindows={() => { setSettingsTab("windows"); openSettings(); }} now={clock()} />}</Show>
        <Show when={showSettings()}><DialogShell labelledBy="settings-title" className="settings-dialog" onClose={closeSettings}>
          <div class="settings-content">
            <div class="dialog-header"><h2 id="settings-title">Settings</h2><button class="icon-button" aria-label="Close settings" onClick={closeSettings}>×</button></div>
            <div class="settings-tabs" role="tablist" aria-label="Settings sections">
              <button role="tab" aria-selected={settingsTab() === "data"} onClick={() => { if (!shortcutsDirty() || window.confirm("Discard your unsaved shortcut changes?")) setSettingsTab("data"); }}>Data</button>
              <button role="tab" aria-selected={settingsTab() === "windows"} onClick={() => { if (!shortcutsDirty() || window.confirm("Discard your unsaved shortcut changes?")) setSettingsTab("windows"); }}>Windows</button>
              <button role="tab" aria-selected={settingsTab() === "time"} onClick={() => { if (!shortcutsDirty() || window.confirm("Discard your unsaved shortcut changes?")) setSettingsTab("time"); }}>Time zone</button>
              <button role="tab" aria-selected={settingsTab() === "display"} onClick={() => { if (!shortcutsDirty() || window.confirm("Discard your unsaved shortcut changes?")) setSettingsTab("display"); }}>Display</button>
              <button role="tab" aria-selected={settingsTab() === "notifications"} onClick={() => { if (!shortcutsDirty() || window.confirm("Discard your unsaved shortcut changes?")) setSettingsTab("notifications"); }}>Notifications</button>
              <button role="tab" aria-selected={settingsTab() === "animations"} onClick={() => { if (!shortcutsDirty() || window.confirm("Discard your unsaved shortcut changes?")) setSettingsTab("animations"); }}>Animations</button>
              <button class="keyboard-settings-tab" role="tab" aria-selected={settingsTab() === "keyboard"} onClick={() => setSettingsTab("keyboard")}>Keyboard shortcuts</button>
            </div>
            <Show when={settingsTab() === "windows"}>
              <WindowSettings items={items()} onCreate={fields => windowChange(() => store.createWindow(fields))} onUpdate={(window, patch) => windowChange(() => store.updateWindow(window, patch))} onDelete={window => windowChange(() => store.deleteWindow(window))} />
            </Show>
            <Show when={settingsTab() === "time"}>
              <TimeZoneSettings settings={settings()} items={items()} now={clock()} onCreate={zone => attempt(() => store.createSettings(zone), "Could not save the time zone.")} onChange={(zone, keepClock) => attempt(() => store.changeTimeZone(settings()!, zone, keepClock), "Could not change the time zone.", keepClock ? "Time zone changed; dates moved to keep their times" : "Time zone changed")} />
            </Show>
            <Show when={settingsTab() === "display"}>
              <section class="appearance-settings" aria-label="Display">
                <label class="animation-setting"><span><strong>Show board on rows</strong><small>A task's board name at the right of its row.</small></span><input aria-label="Show board on rows" type="checkbox" role="switch" checked={prefs.showBoard()} onChange={event => prefs.setShowBoard(event.currentTarget.checked)} /></label>
                <label class="animation-setting"><span><strong>Show tags on rows</strong><small>A task's tags beside its other details.</small></span><input aria-label="Show tags on rows" type="checkbox" role="switch" checked={prefs.showTags()} onChange={event => prefs.setShowTags(event.currentTarget.checked)} /></label>
                <label class="animation-setting"><span><strong>Show open todos unfolded</strong><small>The Agenda ends with Open todos: tasks you can do now with nothing timed about them. On, they start unfolded; off, folded.</small></span><input aria-label="Show open todos unfolded" type="checkbox" role="switch" checked={prefs.todosOpen()} onChange={event => prefs.setTodosOpen(event.currentTarget.checked)} /></label>
                <label class="field"><span>Deadline shows tasks</span><select disabled={!settings()} onChange={event => { const days = Number(event.currentTarget.value); void attempt(() => store.changeDeadlineDays(settings()!, days), "Could not change when tasks join Deadline."); }}>
                  <For each={deadlineChoices}>{([days, label]) => <option value={days} selected={days === deadlineDaysOf(items())}>{label}</option>}</For>
                </select></label>
                <p class="field-hint">For the whole calendar, on every device. Days are calendar days: “due today” means by midnight.</p>
                <label class="animation-setting"><span><strong>Search everything</strong><small>Searching lists every matching task and event, past ones and done ones included, under the search field; picking one opens it. Off, search only narrows what the view shows.</small></span><input aria-label="Search everything" type="checkbox" role="switch" checked={prefs.findSearch()} onChange={event => prefs.setFindSearch(event.currentTarget.checked)} /></label>
                <label class="animation-setting"><span><strong>Pretend time</strong><small>A clock in the top bar that makes the app act as if it's another moment. Turning this off goes back to real time.</small></span><input aria-label="Pretend time" type="checkbox" role="switch" checked={prefs.showTimeControl()} onChange={event => { prefs.setShowTimeControl(event.currentTarget.checked); if (!event.currentTarget.checked) pretend(null); }} /></label>
              </section>
            </Show>
            <Show when={settingsTab() === "notifications"}>
              <section class="appearance-settings" aria-label="Notifications">
                <Show when={!inApp}>
                  <Show when={webPushSupported} fallback={<p class="field-hint">This browser can't show notifications.</p>}>
                    <label class="animation-setting"><span><strong>Notifications</strong><small>Whether this browser notifies you, even with no tab open (while the browser itself runs). They come from the calendar's server, so this needs syncing on (Settings → Data).</small></span><input aria-label="Notifications" type="checkbox" role="switch" disabled={!webPushOn() && syncStatus().state === "local"} checked={webPushOn()} onChange={event => { const box = event.currentTarget; void switchWebPush(box.checked).then(() => { box.checked = webPushOn(); }); }} /></label>
                    <Show when={webPushError()}><p class="solid-menu-error">{webPushError()}</p></Show>
                    <label class="animation-setting"><span><strong>Tasks you can start</strong><small>When a task reaches its can-start time (in a window, when the window opens then).</small></span><input aria-label="Tasks you can start" type="checkbox" role="switch" disabled={!webPushOn()} checked={prefs.notifyTaskStarts()} onChange={event => prefs.setNotifyTaskStarts(event.currentTarget.checked)} /></label>
                    <label class="animation-setting"><span><strong>Notifications you set</strong><small>The ones in each item's editor: before an event or record starts, and at the times you pick.</small></span><input aria-label="Notifications you set" type="checkbox" role="switch" disabled={!webPushOn()} checked={prefs.notifyEvents()} onChange={event => prefs.setNotifyEvents(event.currentTarget.checked)} /></label>
                    <p class="field-hint">For this browser.</p>
                  </Show>
                </Show>
                <Show when={inApp}>
                  <Show when={prefs.notify() && notifyAccess() === "denied"}><p class="solid-menu-error">Notifications are off for this app in Android's settings, so none go off.</p></Show>
                  <label class="animation-setting"><span><strong>Notifications</strong><small>Whether this phone notifies you at all.</small></span><input aria-label="Notifications" type="checkbox" role="switch" checked={prefs.notify()} onChange={event => prefs.setNotify(event.currentTarget.checked)} /></label>
                  <label class="animation-setting"><span><strong>Tasks you can start</strong><small>When a task reaches its can-start time (in a window, when the window opens then).</small></span><input aria-label="Tasks you can start" type="checkbox" role="switch" disabled={!prefs.notify()} checked={prefs.notifyTaskStarts()} onChange={event => prefs.setNotifyTaskStarts(event.currentTarget.checked)} /></label>
                  <label class="animation-setting"><span><strong>Notifications you set</strong><small>The ones in each item's editor: before an event or record starts, and at the times you pick.</small></span><input aria-label="Notifications you set" type="checkbox" role="switch" disabled={!prefs.notify()} checked={prefs.notifyEvents()} onChange={event => prefs.setNotifyEvents(event.currentTarget.checked)} /></label>
                  <p class="field-hint">For this phone. Each kind has its own channel in Android's notification settings.</p>
                </Show>
                <label class="field"><span>New events notify you</span><select disabled={!settings()} onChange={event => { const minutes = event.currentTarget.value === "off" ? null : Number(event.currentTarget.value); void attempt(() => store.changeEventReminderDefault(settings()!, minutes), "Could not change new events' reminder."); }}>
                  <option value="off">Not at all</option><For each={reminderChoices}>{([minutes, label]) => <option value={minutes} selected={minutes === settings()?.eventReminderMinutes}>{label}</option>}</For>
                </select></label>
                <p class="field-hint">How long before it starts a new event notifies you, on every device; each event can change its own.</p>
              </section>
            </Show>
            <Show when={settingsTab() === "animations"}>
            <section class="appearance-settings" aria-label="Appearance">
              <label class="animation-setting"><span><strong>Animations</strong></span><input aria-label="Animations" type="checkbox" role="switch" checked={animations()} onChange={event => prefs.setAnimations(event.currentTarget.checked ? "on" : "off")} /></label>
              <button type="button" class="text-button" disabled={prefs.animations() === null} onClick={() => prefs.setAnimations(null)}>Use device preference</button>
            </section>
            </Show>
            <Show when={settingsTab() === "data"} fallback={<Show when={settingsTab() === "keyboard"}><KeyboardShortcutSettings onDirtyChange={setShortcutsDirty} shortcuts={shortcuts()} onClose={closeSettings} onSave={(next) => { setShortcuts(next); showToast("Shortcuts saved"); }} /></Show>}>
              <section class="data-settings" aria-label="Data settings">
                <h3>Sync</h3>
                <Show when={syncSnapshot().settings?.enabled} fallback={<>
                  <p class="field-hint">Signing in keeps this calendar the same on every device you sign in on. Until then, it stays in this browser.</p>
                  <button class="text-button" onClick={() => void sync.signIn()}>Sign in with Cloudflare</button>
                </>}>
                  <Show when={syncSnapshot().state.kind !== "signed-out"} fallback={<>
                    <p class="field-hint">Your sign-in has expired. Your edits are saved in this browser and sync once you sign in again.</p>
                    <button class="text-button" onClick={() => void sync.signIn()}>Sign in again</button>
                  </>}>
                    <label class="field"><span>When to sync</span><select value={syncSnapshot().settings!.mode} onChange={(event) => void sync.setMode(event.currentTarget.value as SyncMode)}>
                      <option value="automatic">Automatically</option><option value="on-edit">When I edit</option><option value="manual">Manually</option>
                    </select></label>
                    <p class="field-hint">{{ automatic: "After your edits, on opening the app, and as soon as another device changes something.", "on-edit": "After your edits, on opening the app, and on coming back to it.", manual: "Only when you press Sync now." }[syncSnapshot().settings!.mode]}</p>
                    <button class="text-button" disabled={syncSnapshot().running} onClick={() => void syncNow()}>{syncSnapshot().running ? "Syncing…" : "Sync now"}</button>
                  </Show>
                  <button class="text-button" onClick={() => void signOut()}>Sign out</button>
                  <Show when={syncSnapshot().lastSyncedAt} keyed>{(syncedAt) => <div class="solid-menu-status">Last synced {clockText(new Date(syncedAt))}</div>}</Show>
                  <Show when={"message" in syncSnapshot().state && (syncSnapshot().state as { message: string }).message} keyed>{(message) => <div class="solid-menu-error">{message}</div>}</Show>
                </Show>
                <div class="solid-menu-divider" />
                <h3>Backup</h3>
                <button class="text-button" onClick={() => void exportBackup()}>Export backup</button>
                <button class="text-button" onClick={() => importRef.click()}>Import backup</button>
                <div class="solid-menu-divider" />
                <h3>Sample data</h3>
                <p class="field-hint">Something of everything, to try things on: tasks in every section (subtasks, dependent tasks, repeats, windows, push-down), events, records, and notifications, on their own boards. Removing deletes every sample item; both can be undone.</p>
                <button class="text-button" disabled={items().some(item => item.id.startsWith(SAMPLE_PREFIX))} onClick={() => void attempt(() => store.importBackup(JSON.stringify({ items: sampleItems() })), "Could not add the sample data.", "Added the sample data")}>Add sample data</button>
                <button class="text-button" disabled={!items().some(item => item.id.startsWith(SAMPLE_PREFIX))} onClick={() => void attempt(() => store.removeByPrefix(SAMPLE_PREFIX, "Remove sample data"), "Could not remove the sample data.", "Removed the sample data")}>Remove sample data</button>
              </section>
            </Show>
          </div>
        </DialogShell></Show>
        <Show when={pendingImport()} keyed>{(pending) => <DialogShell labelledBy="import-title" onClose={() => { if (!importing()) setPendingImport(null); }}>
          <div style={{ padding: "20px" }}>
            <h2 id="import-title">Import backup</h2>
            <p>Add {pending.added} new items and update {pending.updated} matching items.</p>
            <p>Matching IDs are updated with fields from the backup, including text, dates, tags, and attachment references. Items missing from the backup stay in your calendar. This does not replace your whole calendar.</p>
            <p>JSON backups include item values and each task’s activity history (such as creation, completion, and pushing down). They do not include undo/redo history, the Automerge change history used for syncing, or attachment files. Referenced files must still exist on your sync server. Imported changes will sync to your other devices. You can undo this import.</p>
            <div class="dialog-actions"><button class="secondary-button" disabled={importing()} onClick={() => setPendingImport(null)}>Cancel</button><button class="primary-button" disabled={importing()} onClick={() => void confirmImport()}>{importing() ? "Importing…" : "Import and update matches"}</button></div>
          </div>
        </DialogShell>}</Show>
        <ToastStack toasts={toasts()} onDismiss={dismissToast} />
      </div>
    </Show>
  );
}

/** Shown when the stored calendar can't be read: keep a copy of it, then import a backup or start over. */
function StorageRecovery(props: { message: string; readRaw: () => Promise<Uint8Array | null>; onRecovered: (backup: string | null) => Promise<void> }) {
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");
  let fileInput!: HTMLInputElement;
  const saveCopy = async () => {
    const bytes = await props.readRaw().catch(() => null);
    if (!bytes) return;
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "application/octet-stream" }));
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = `calendar-unreadable-${dateKey(new Date())}.automerge`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const recover = async (backup: string | null) => {
    setBusy(true); setError("");
    try { await saveCopy(); await props.onRecovered(backup); }
    catch (failure) { setError(errorMessage(failure, "That didn't work.")); }
    finally { setBusy(false); }
  };
  return <div class="storage-recovery" role="alert">
    <h2>This calendar's saved data can't be read</h2>
    <p class="muted">{props.message}</p>
    <p>Import a backup, or start with an empty calendar. Either way, a copy of the unreadable data downloads first so nothing is lost.</p>
    <div class="dialog-actions">
      <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void file.text().then(text => recover(text)); }} />
      <button class="primary-button" disabled={busy()} onClick={() => fileInput.click()}>Import a backup</button>
      <button class="secondary-button" disabled={busy()} onClick={() => void recover(null)}>Start fresh</button>
    </div>
    <Show when={error()}><p class="solid-menu-error">{error()}</p></Show>
  </div>;
}
