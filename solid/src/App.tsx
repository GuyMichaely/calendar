import { SleepControls } from "./SleepControls";
import { Show, createMemo, createSignal, onCleanup, onMount, untrack } from "solid-js";
import { dateKey, sleepInfo } from "../../site/domain.js";
import { WorkspaceShell } from "./WorkspaceShell";
import { DialogShell } from "./DialogShell";
import { CalendarView } from "./CalendarView";
import { ItemEditor, type EditorRequest } from "./ItemEditor";
import { configuredBackendUrl, saveConfiguredBackendUrl } from "./remote-sync";
import { createRemoteSync } from "./remote-session";
import { createCalendarStore } from "./calendar-store";
import { createPreferences } from "./preferences";
import { KeyboardShortcutSettings, loadShortcuts, type Shortcuts } from "./shortcuts";
import { GroupsView } from "./GroupsView";
import { isDormant, projectDependents } from "./dependencies";
import { dependentTasks } from "../../site/task-tree.js";
import { ToastStack, type ToastMessage } from "./ToastStack";
import { animationsEnabled } from "./settings";
import type { CalendarEvent, Group, Item, Task, View } from "./types";

function readView(): View { return location.hash === "#calendar" ? "calendar" : "tasks"; }
function readSelectedTask() { const match = /^#tasks\/(.+)$/.exec(location.hash); return match ? decodeURIComponent(match[1]) : null; }
function tasksHash(id: string | null) { return id ? `#tasks/${encodeURIComponent(id)}` : "#tasks"; }
function editableTarget(target: EventTarget | null) { return target instanceof Element && !!target.closest("input, textarea, select, [contenteditable='true']"); }
function errorMessage(error: unknown, fallback: string) { return error instanceof Error && error.message ? error.message : fallback; }

export function App() {
  if (!["#tasks", "#calendar"].includes(location.hash) && !readSelectedTask()) history.replaceState(null, "", "#tasks");
  const backendUrl = configuredBackendUrl();
  const prefs = createPreferences();
  // Changes sync once saved locally; remote changes reload the items once merged.
  const store = createCalendarStore({ onChanged: () => void remote.request() });
  const remote = createRemoteSync({ backendUrl, pollSeconds: prefs.pollSeconds, onSynced: store.refresh });
  const items = store.items;
  const [remoteUrlDraft, setRemoteUrlDraft] = createSignal(backendUrl);
  const [loadingError, setLoadingError] = createSignal("");
  const [view, setView] = createSignal<View>(readView());
  const [query, setQuery] = createSignal("");
  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const [reducedMotion, setReducedMotion] = createSignal(motionQuery.matches);
  const animations = () => animationsEnabled(prefs.animations(), reducedMotion());
  onMount(() => {
    const update = () => setReducedMotion(motionQuery.matches);
    motionQuery.addEventListener("change", update);
    onCleanup(() => motionQuery.removeEventListener("change", update));
  });
  const nowAtStart = new Date();
  const [clock, setClock] = createSignal(nowAtStart);
  // The calendar leaves out dependent tasks that haven't started, or shows them as what-if entries.
  const calendarView = createMemo(() => {
    const byId = new Map(items().map(item => [item.id, item]));
    if (!prefs.showDependents()) return { items: items().filter(item => !isDormant(item, byId)), ghostIds: new Set<string>() };
    const projected = projectDependents(items(), clock());
    return { items: items().map(item => projected.get(item.id) || item), ghostIds: new Set(projected.keys()) };
  });
  const openCount = createMemo(() => items().filter(item => item.kind === "task" && item.state !== "completed" && (!prefs.hideSleeping() || !sleepInfo(item, clock()).sleeping)).length);
  const [calendarMonth, setCalendarMonth] = createSignal(new Date(nowAtStart.getFullYear(), nowAtStart.getMonth(), 1));
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
  const [settingsTab, setSettingsTab] = createSignal<"data" | "keyboard" | "animations" | "tasks">("data");
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
  const saveRemoteServer = () => {
    try {
      const normalized = saveConfiguredBackendUrl(remoteUrlDraft());
      setRemoteUrlDraft(normalized);

      window.location.reload();
    } catch (error) {
      showToast(errorMessage(error, "Invalid remote sync URL."));
    }
  };
  const syncNow = async () => { const failure = await remote.request(); showToast(failure || "Synced"); };
  const signOutRemote = () => attempt(remote.signOut, "Could not sign out.", "Signed out");
  const navigate = (next: View) => {
    setView(next);
    const hash = next === "tasks" ? tasksHash(selectedTaskId()) : `#${next}`;
    if (location.hash !== hash) history.pushState(null, "", hash);
  };
  const editorParents: string[] = [];
  const closeEditor = async () => {
    while (editorParents.length) {
      const item = await store.getItem(editorParents.pop()!);
      if (item && item.kind !== "group") { setEditor({item, kind: item.kind, nonce: Date.now()}); return; }
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
  // Save the open task before showing another; a failed save keeps it open with its error.
  const selectTask = async (id: string | null, replace = false) => {
    if (id === selectedTaskId()) return;
    if (flushDetail && !(await flushDetail())) return;
    setSelectedTaskId(id);
    const hash = tasksHash(id);
    if (location.hash !== hash) history[replace ? "replaceState" : "pushState"](null, "", hash);
  };
  const closeDetail = async () => {
    const id = selectedTaskId();
    await selectTask(null);
    if (!selectedTaskId() && id) document.querySelector<HTMLElement>(`[data-task-card][data-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
  };
  const editTask = (task: Task) => { if (splitView()) void selectTask(task.id); else openEditor(task); };
  const openEditor = (item: Task | CalendarEvent | null = null, kind?: "task" | "event", date?: Date) => { editorParents.length = 0; setEditor({ item, kind: item?.kind || kind || "task", date, nonce: Date.now() }); };
  const saveItem = (item: Item, _created: boolean, baseline: Item | null) => store.saveItem(item, baseline);
  const quickAddSubtask = (parent: Task, title: string) => attempt(() => store.addSubtask(parent, title), "Could not add subtask.");
  const addTask = (groupId: string | null, title: string) => attempt(() => store.addTask(groupId, title), "Could not add task.");
  const addDependent = (parent: Task, title: string) => attempt(() => store.addDependent(parent, title), "Could not add dependent task.");
  const completeTask = async (task: Task) => { await attempt(() => store.completeTask(task), "Could not complete task.", "Task completed"); };
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
    if (attached.length && !window.confirm(`Delete “${title}” and the ${attached.length} subtask${attached.length === 1 ? "" : "s"} or dependent task${attached.length === 1 ? "" : "s"} under it?`)) return;
    // Close the task pane first if it shows one of them, so its pending edits can't recreate a deleted task.
    const selected = selectedTaskId();
    if (selected && [task.id, ...attached.map(item => item.id)].includes(selected)) { await selectTask(null, true); if (selectedTaskId()) return; }
    await attempt(() => store.deleteItem(task.id), "Could not delete task.", `Deleted “${title}” (Ctrl+Z to undo)`);
  };
  const sleepTask = async (task: Task) => { await attempt(() => store.sleepTask(task), "Could not sleep task.", "Sleeping until tomorrow"); };
  const wakeTask = async (task: Task) => { await attempt(() => store.wakeTask(task), "Could not wake task.", "Task is awake"); };
  const patchTask = async (task: Task, patch: Partial<Task>) => { await attempt(() => store.patchTask(task, patch), "Could not update task."); };
  const groupChange = async (run: () => Promise<unknown>) => { await attempt(run, "Could not update groups."); };
  const createGroup = async (parentId: string | null) => {
    try { return await store.createGroup(parentId); }
    catch (error) { showToast(errorMessage(error, "Could not create group.")); return null; }
  };
  // Deleting a group keeps its contents: subgroups and tasks move up to its parent.
  const deleteGroup = async (group: Group) => {
    const parent = items().find((item): item is Group => item.kind === "group" && item.id === group.parentId) || null;
    if (!window.confirm(`Delete “${group.title}”? Its tasks and subgroups move to ${parent ? `“${parent.title}”` : "the top level"}.`)) return;
    await groupChange(() => store.deleteGroup(group));
  };
  const applyUndo = async () => { const label = await store.undo(); if (label !== null) showToast(`Undo${label ? ` ${label}` : ""}`); };
  const applyRedo = async () => { const label = await store.redo(); if (label !== null) showToast(`Redo${label ? ` ${label}` : ""}`); };
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
      try { await store.refresh(); } catch (error) { setLoadingError(errorMessage(error, "Could not open local storage.")); return; }
      await remote.checkSession();
    })();
    const clockTimer = window.setInterval(() => { if (!document.querySelector(".solid-dialog-backdrop")) setClock(new Date()); }, 30_000);
    const syncLocation = () => {
      setView(readView());
      const id = readSelectedTask();
      if (readView() !== "tasks" || id === selectedTaskId()) return;
      const previous = selectedTaskId();
      void (async () => {
        if (flushDetail && !(await flushDetail())) { history.pushState(null, "", tasksHash(previous)); return; }
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
      window.clearInterval(clockTimer); window.removeEventListener("hashchange", syncLocation); window.removeEventListener("popstate", syncLocation); document.removeEventListener("keydown", onKeyDown);
    });
  });

  return (
    <Show when={!loadingError()} fallback={<div class="solid-error">Could not open local storage. {loadingError()}</div>}>
      <div class="app-shell">
        <input ref={(element) => { importRef = element; }} type="file" accept="application/json,.json" hidden onChange={(event) => { const input = event.currentTarget; const file = input.files?.[0]; if (file) { setShowSettings(false); void importBackup(file); } input.value = ""; }} />
        <WorkspaceShell view={view()} openCount={openCount()} query={query()} onQuery={setQuery}
          onNavigate={(next) => { navigate(next); window.scrollTo({top: 0, behavior: "instant"}); }}
          onNew={() => openEditor(null, view() === "calendar" ? "event" : "task")}
          onSettings={() => { setSettingsTab("data"); openSettings(); }}
          syncState={remote.busy() ? "busy" : remote.error() ? "error" : remote.lastSyncedAt() ? "synced" : "local"}
          syncLabel={remote.busy() ? "Syncing" : remote.error() ? "Sync needs attention" : remote.lastSyncedAt() ? "Synced" : "On this device"}
          syncDetail={remote.error() || (remote.lastSyncedAt() ? `Last synced at ${remote.lastSyncedAt()!.toLocaleTimeString()}` : "Your edits are saved in this browser. Open Settings to connect another device.")}
          identity={remote.session()?.authenticated ? remote.identityLabel() : ""}
          canUndo={store.history().canUndo} canRedo={store.history().canRedo} undoLabel={store.history().undoLabel} redoLabel={store.history().redoLabel} onUndo={() => void applyUndo()} onRedo={() => void applyRedo()}>
          <Show when={view() === "tasks"} fallback={<CalendarView items={calendarView().items} ghostIds={calendarView().ghostIds} showDependents={prefs.showDependents()} onShowDependentsChange={prefs.setShowDependents} query={query()} month={calendarMonth()} sleepMode={prefs.calendarSleepMode()} now={clock()} onMonthChange={setCalendarMonth} onSleepModeChange={prefs.setCalendarSleepMode} hideSleeping={prefs.hideSleeping()} onHideSleepingChange={prefs.setHideSleeping} onEdit={(item) => openEditor(item)} onCreateForDay={(date) => openEditor(null, "event", date)} onOpenTodayTasks={() => navigate("tasks")} />}>
            <div class="tasks-workspace" classList={{ split: splitView() && !!detailRequest() }}>
            <GroupsView items={items()} query={query()} now={clock()} selectedId={splitView() ? selectedTaskId() : null} showCompleted={prefs.showCompleted()} onShowCompletedChange={prefs.setShowCompleted}
              compact={prefs.compact()} onCompactChange={prefs.setCompact} onPatchTask={patchTask}
              onEdit={editTask} onComplete={completeTask} onAddTask={addTask} onCreateGroup={createGroup} onRenameGroup={(group, title) => groupChange(() => store.renameGroup(group, title))} onMoveGroup={(group, parentId) => groupChange(() => store.moveGroup(group, parentId))} onReorderGroup={(group, offset) => groupChange(() => store.reorderGroup(group, offset))} onDeleteGroup={deleteGroup} onPlaceGroup={(id, target) => groupChange(() => store.placeGroup(id, target))} onStartDependent={startDependent} onDeleteTask={deleteTask} onSleepTask={sleepTask} onWakeTask={wakeTask} respectSleep={prefs.calendarSleepMode() === "respect"} />
            <Show when={splitView() && detailRequest()}>
              <aside class="task-detail-pane" aria-label="Task details">
                <Show when={detailRequest()} keyed fallback={<div class="task-detail-empty"><p class="page-eyebrow">Task details</p><h2>Pick a task to see everything about it.</h2><p>Notes, dates, subtasks, and attachments open here. The list stays where it is.</p></div>}>{(request) =>
                  <ItemEditor embedded request={request} items={items()} registerFlush={flush => { flushDetail = flush; return () => { if (flushDetail === flush) flushDetail = null; }; }} registerClose={close => { closeDetailEditor = close; return () => { if (closeDetailEditor === close) closeDetailEditor = null; }; }} onStale={() => setDetailVersion(version => version + 1)}
                    onQuickAddSubtask={quickAddSubtask} onAddDependent={addDependent} onStartDependent={startDependent} onEditItem={task => void selectTask(task.id)} onAddSubtask={() => {}} onClose={() => void closeDetail()}
                    onDelete={async (item) => { await store.deleteItem(item.id); flushDetail = null; await selectTask(null, true); showToast("Deleted"); }}
                    onSave={saveItem} onError={showToast} />}
                </Show>
              </aside>
            </Show>
            </div>
          </Show>
        </WorkspaceShell>
        <Show when={editor()} keyed>{(request) => <ItemEditor items={items()} onAddDependent={addDependent} onStartDependent={startDependent} onEditItem={task => { if (request.item) editorParents.push(request.item.id); setEditor({item: task, kind: "task", nonce: Date.now()}); }} onAddSubtask={task => void addEditorSubtask(task)} request={request} onClose={() => void closeEditor()} onDelete={async (item) => { const position = { left: window.scrollX, top: window.scrollY }; await store.deleteItem(item.id); await closeEditor(); requestAnimationFrame(() => window.scrollTo({ ...position, behavior: "instant" })); showToast("Deleted"); }} onSave={saveItem} onError={showToast} />}</Show>
        <Show when={showSettings()}><DialogShell labelledBy="settings-title" className="settings-dialog" onClose={closeSettings}>
          <div class="settings-content">
            <div class="dialog-header"><h2 id="settings-title">Settings</h2><button class="icon-button" aria-label="Close settings" onClick={closeSettings}>×</button></div>
            <div class="settings-tabs" role="tablist" aria-label="Settings sections">
              <button role="tab" aria-selected={settingsTab() === "data"} onClick={() => { if (!shortcutsDirty() || window.confirm("Discard your unsaved shortcut changes?")) setSettingsTab("data"); }}>Data</button>
              <button role="tab" aria-selected={settingsTab() === "tasks"} onClick={() => { if (!shortcutsDirty() || window.confirm("Discard your unsaved shortcut changes?")) setSettingsTab("tasks"); }}>Tasks</button>
              <button role="tab" aria-selected={settingsTab() === "animations"} onClick={() => { if (!shortcutsDirty() || window.confirm("Discard your unsaved shortcut changes?")) setSettingsTab("animations"); }}>Animations</button>
              <button class="keyboard-settings-tab" role="tab" aria-selected={settingsTab() === "keyboard"} onClick={() => setSettingsTab("keyboard")}>Keyboard shortcuts</button>
            </div>
            <Show when={settingsTab() === "tasks"}>
              <section aria-label="Task settings">
                <SleepControls mode={prefs.calendarSleepMode()} hideSleeping={prefs.hideSleeping()} onModeChange={prefs.setCalendarSleepMode} onHideChange={prefs.setHideSleeping} />
                <p class="field-hint">Respect sleep keeps tasks unavailable until they wake. Turn it off to use their normal start dates and working hours. Hide sleeping tasks removes them from both views, even when sleep is ignored.</p>
              </section>
            </Show>
            <Show when={settingsTab() === "animations"}>
            <section class="appearance-settings" aria-label="Appearance">
              <label class="animation-setting"><span><strong>Animations</strong><small>Animate expanding, collapsing, completing, undoing, and dragging tasks.</small></span><input aria-label="Animations" type="checkbox" role="switch" checked={animations()} onChange={event => prefs.setAnimations(event.currentTarget.checked ? "on" : "off")} /></label>
              <p class="field-hint">{prefs.animations() === "on" ? "Animations are on for this browser, overriding its reduced-motion preference." : prefs.animations() === "off" ? "Animations are off for this browser." : reducedMotion() ? "Following your device: reduced motion is on. Enable the switch to animate anyway." : "Following your device: animations are on."}</p>
              <button type="button" class="text-button" disabled={prefs.animations() === null} onClick={() => prefs.setAnimations(null)}>Use device preference</button>
            </section>
            </Show>
            <Show when={settingsTab() === "data"} fallback={<Show when={settingsTab() === "keyboard"}><KeyboardShortcutSettings onDirtyChange={setShortcutsDirty} shortcuts={shortcuts()} onClose={closeSettings} onSave={(next) => { setShortcuts(next); showToast("Shortcuts saved"); }} /></Show>}>
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
                <Show when={remote.enabled}>
                  <div class="solid-menu-divider" />
                  <Show when={remote.session() !== null} fallback={<button class="text-button" disabled={!remote.error()} onClick={() => void remote.checkSession()}>{remote.error() ? "Retry remote connection" : "Checking remote…"}</button>}>
                    <Show when={remote.session()?.authenticated} fallback={<button class="text-button" onClick={() => {  window.location.assign(remote.loginUrl(new URL(import.meta.env.VITE_CALENDAR_PRIMARY_BASE || import.meta.env.BASE_URL, location.origin).href + location.hash)); }}>Sign in with Google</button>}>
                      <div class="solid-menu-status">Signed in as {remote.identityLabel()}</div>
                      <button class="text-button" disabled={remote.busy()} onClick={() => void syncNow()}>{remote.busy() ? "Syncing…" : "Sync now"}</button>
                      <button class="text-button" onClick={() => void signOutRemote()}>Sign out</button>
                      <Show when={remote.lastSyncedAt()} keyed>{(syncedAt) => <div class="solid-menu-status">Last synced {syncedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</div>}</Show>
                    </Show>
                  </Show>
                  <Show when={remote.error()} keyed>{(message) => <div class="solid-menu-error">{message}</div>}</Show>
                </Show>

                <label class="field"><span>Check for remote changes</span><select value={prefs.pollSeconds()} onChange={(event) => prefs.setPollSeconds(Number(event.currentTarget.value))}>
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
