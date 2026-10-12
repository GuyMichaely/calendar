import { Icon } from "./Icon";
import { taskDescendants } from "../../site/task-tree.js";
import { For, Index, Show, batch, createEffect, createMemo, createRenderEffect, createSignal, onMount, onCleanup, untrack, type JSX } from "solid-js";
import { inputToIso as localInputToIso } from "./zone";
import { NotesEditor, type NotesEditorApi } from "./NotesEditor";
import { DateTimeField } from "./DateTimeField";
import { describeSchedule } from "./windows";
import type { RelativeDateField } from "./dependencies";
import { attachmentHref } from "./markdown";
import { DialogShell } from "./DialogShell";
import { downloadAttachmentOnDemand } from "../../site/attachment-remote.js";
import { blankDraft, changedFields, differs, draftOf, draftProblem, itemFromDraft, numberText, rebased, noticeDraft, withEnd, withKind, withStart, NOTICE_UNITS, type Draft, type Editable, type NoticeDraft, type NoticeUnit } from "./editor-draft";
import type { Attachment, CalendarSettings, Item, Task, TimeWindow } from "./types";

export type { Editable };
export type EditorRequest = {
  item: Editable | null;
  kind: Editable["kind"];
  date?: Date;
  parentId?: string;
  groupId?: string | null;
  nonce: number;
};

let editorInstances = 0;

function uuid() {
  return crypto.randomUUID();
}

// A text field's caret and selection, put back after its value changes under it.
const keepingSelection = (change: () => void) => {
  const field = document.activeElement;
  const text = field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement ? field : null;
  const [from, to] = [text?.selectionStart ?? null, text?.selectionEnd ?? null];
  change();
  if (text && from !== null) queueMicrotask(() => {
    if (document.activeElement !== text) return;
    const length = text.value.length;
    text.setSelectionRange(Math.min(from, length), Math.min(to ?? from, length));
  });
};

// A text box showing a value it also edits: written only when it differs from what the box reads
// as (`read`), so typing (and a number half typed) is never written over.
const shows = (value: () => string, read = (element: HTMLInputElement) => element.value) => (element: HTMLInputElement) => createRenderEffect(() => { const next = value(); if (read(element) !== next) element.value = next; });

export function ItemEditor(props: {
  request: EditorRequest;
  items: Item[];
  onAddSubtask: (task: Task) => void;
  onEditItem: (task: Task) => void;
  onClose: () => void;
  onDelete: (item: Item) => Promise<void>;
  onSave: (item: Item, created: boolean, baseline: Item | null) => Promise<Item>;
  onError?: (message: string) => void;
  // Embedded editors sit beside the task list instead of in a modal drawer.
  embedded?: boolean;
  /** The address that opens an item, for the links to a task's parents. */
  itemHref?: (id: string) => string;
  registerFlush?: (flush: () => Promise<boolean>) => () => void;
  onQuickAddSubtask?: (parent: Task, title: string) => Promise<boolean>;
  onAddDependent?: (parent: Task, title: string) => Promise<boolean>;
  onStartDependent?: (task: Task, completeParent: boolean) => Promise<void>;
  // Lets the app close an embedded editor (e.g. Escape pressed outside it) through the same checks.
  registerClose?: (close: () => void) => () => void;
  // Rows drag between the Subtasks and Dependent tasks sections to switch relation.
  onConvertChild?: (child: Task, to: "subtask" | "dependent") => Promise<unknown>;
  // Subtasks (or dependent tasks) in a new order.
  onReorderChildren?: (ordered: Task[]) => Promise<unknown>;
  // Unsaved text mirrors to the board card as it's typed (no debounce).
  onLiveEdit?: (taskId: string, patch: Partial<Task> | null) => void;
  // Opens the settings where named windows are edited.
  onManageWindows?: () => void;
  // What counts as now for showing status (pretend time); saves still use the real time.
  now?: Date;
}) {
  const existing = props.request.item;
  const domId = `${++editorInstances}`;
  const itemId = existing?.id || uuid();
  const now = () => props.now ?? new Date();
  const settings = props.items.find((item): item is CalendarSettings => item.kind === "settings");
  // A new event notifies as long before it starts as the calendar's settings say.
  const notifyBefore = existing ? null : settings?.eventReminderMinutes ?? null;
  const blank = blankDraft(props.request.kind, { date: props.request.date, notifyBefore }, now());
  // The stored version the fields stand on (the baseline a save is merged against), what they
  // showed when they last matched it (`base`), and what they show now (`draft`). They differ
  // from `base` in the fields edited here and not yet saved.
  let currentItem = existing;
  const [base, setBase] = createSignal(draftOf(existing, blank, now()));
  const [draft, setDraft] = createSignal(base());
  const [hasSavedItem, setHasSavedItem] = createSignal(!!existing);
  const [savedAttachments, setSavedAttachments] = createSignal(existing?.attachments || []);
  const adopt = (item: Editable) => { currentItem = item; setHasSavedItem(true); setSavedAttachments(item.attachments || []); };
  const [removedAttachments, setRemovedAttachments] = createSignal(new Set<string>());
  const [pendingFiles, setPendingFiles] = createSignal<File[]>([]);
  const kind = () => draft().kind;
  const taskState = () => draft().state;
  let notesApi: NotesEditorApi | null = null;
  const [saving, setSaving] = createSignal(false);
  const [saveError, setSaveError] = createSignal("");
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<boolean> | null = null;
  let closing = false;
  // The task as stored now (it can change while open: started, moved).
  const task = () => { const item = props.items.find(entry => entry.id === itemId) ?? currentItem; return item?.kind === "task" ? item : null; };
  // A dependent task that hasn't started: its dates can be days after starting instead of fixed.
  const dormant = () => !!task()?.dependentOf && props.items.some(item => item.id === task()!.dependentOf && item.kind === "task");
  const [draggingAttachments, setDraggingAttachments] = createSignal(false);
  const dirty = createMemo(() => differs(draft(), base()) || pendingFiles().length > 0 || removedAttachments().size > 0);
  // Why the draft can't save, if it can't.
  const invalid = createMemo(() => draftProblem(draft(), dormant()));
  // The editor doesn't choose a board (Boards does, by dragging): a task keeps the one it's on
  // now, however it got there while open, and a new one takes the one it was started from.
  const boardOf = () => { const stored = props.items.find(item => item.id === itemId); return stored?.kind === "task" ? stored.groupId ?? null : props.request.groupId ?? null; };
  // What the board card should show right now.
  const draftPatch = (): Partial<Task> | null => kind() !== "task" ? null : {
    title: draft().title,
    notes: draft().notes,
    availableFrom: localInputToIso(draft().availableFrom),
    deadline: localInputToIso(draft().deadline),
    groupId: boardOf(),
    state: taskState(),
  };

  // An edit made here: it shows on the board card at once and saves after a pause.
  const edited = () => {
    setCloseBlocked(false);
    if (kind() === "task") props.onLiveEdit?.(itemId, draftPatch());
    clearTimeout(saveTimer);
    if (dirty() && !closing) saveTimer = setTimeout(() => { void persist(); }, 800);
  };
  const edit = (change: Partial<Draft> | ((draft: Draft) => Draft)) => {
    setDraft(current => typeof change === "function" ? change(current) : { ...current, ...change });
    edited();
  };
  const editNotices = (change: (list: NoticeDraft[]) => NoticeDraft[]) => edit(current => ({ ...current, notifications: change(current.notifications) }));
  const editNotice = (index: number, patch: Partial<NoticeDraft>) => editNotices(list => list.map((notice, at) => at === index ? { ...notice, ...patch } : notice));
  // A new one is the calendar's usual lead time (else 30 minutes), ready to change.
  let noticesRef!: HTMLDivElement;
  const addNotice = () => {
    editNotices(list => [...list, noticeDraft(settings?.eventReminderMinutes ?? 30)]);
    queueMicrotask(() => { const added = [...noticesRef.querySelectorAll<HTMLInputElement>(".notice-amount")].pop(); added?.focus(); added?.select(); });
  };
  // A task's notifications go off before a time it may not have yet.
  const unanchored = () => {
    const current = draft();
    if (current.kind !== "task") return "";
    const missing = (of: NoticeDraft["of"]) => current.notifications.some(notice => notice.of === of) && !current[of === "due" ? "deadline" : "availableFrom"] && !(dormant() && current[of === "due" ? "deadlineMode" : "availableFromMode"] === "after");
    return missing("start") && missing("due") ? "These go off once it has a can-start time and a due time." : missing("start") ? "Set when it can start for these to go off." : missing("due") ? "Set when it's due for these to go off." : "";
  };

  // Closing saves first. If the edits can't be saved, say why and offer to revert to the last saved version.
  const [closeBlocked, setCloseBlocked] = createSignal(false);
  const close = async () => {
    // Closing twice while the "can't save" notice is up discards and reverts.
    if (closeBlocked()) { revertAndClose(); return; }
    closing = true;
    clearTimeout(saveTimer);
    if (inFlight) await inFlight;
    while (dirty()) {
      if (invalid()) { closing = false; setCloseBlocked(true); return; }
      if (!(await persist())) { closing = false; setCloseBlocked(true); return; }
    }
    props.onClose();
  };
  // Reverting skips the save that closing would otherwise require (the app flushes before switching tasks).
  let reverting = false;
  const revertAndClose = () => { reverting = closing = true; clearTimeout(saveTimer); props.onClose(); };
  // Reverting puts the fields back as last saved. Autosave waits for an 800ms pause, so that is
  // the last valid state that stood still, not whatever briefly passed through the fields while typing.
  const revert = async () => {
    reverting = true;
    clearTimeout(saveTimer);
    if (inFlight) await inFlight;
    setDraft(base());
    notesApi?.setMarkdown(base().notes);
    setPendingFiles([]);
    setRemovedAttachments(new Set<string>());
    setSaveError("");
    setCloseBlocked(false);
    props.onLiveEdit?.(itemId, null);
    reverting = false;
  };
  onMount(() => { const unregister = props.registerClose?.(() => void close()); onCleanup(() => unregister?.()); });
  const beforeUnload = (event: BeforeUnloadEvent) => {
    if (dirty() || saving()) { event.preventDefault(); event.returnValue = ""; }
  };
  onMount(() => window.addEventListener("beforeunload", beforeUnload));
  onCleanup(() => {
    clearTimeout(saveTimer); window.removeEventListener("beforeunload", beforeUnload);
    props.onLiveEdit?.(itemId, null);
    // An embedded editor can be replaced without closing it; keep edits that were still waiting to save.
    if (props.embedded && dirty() && !closing) void persist();
  });
  const flush = async () => {
    if (reverting) return true;
    clearTimeout(saveTimer);
    if (inFlight) await inFlight;
    while (dirty()) { if (!(await persist())) return false; }
    return true;
  };
  onMount(() => { const unregister = props.registerFlush?.(flush); onCleanup(() => unregister?.()); });

  // The item changed elsewhere (another view, another device, undo): the fields that changed
  // there take the new version in place, except ones edited here and not yet saved.
  const follow = (before: Draft, after: Draft) => {
    const changed = changedFields(before, after);
    if (!changed.length) return;
    keepingSelection(() => batch(() => { setDraft(current => rebased(current, base(), before, after)); setBase(current => rebased(current, current, before, after)); }));
    if (changed.includes("notes") && draft().notes === after.notes) notesApi?.setMarkdown(after.notes);
    props.onLiveEdit?.(itemId, dirty() ? draftPatch() : null);
  };
  // A save is merged against the stored version it was edited from (text edits merge with ones
  // made elsewhere since), so a newer one is taken up only with nothing unsaved; edits waiting to
  // save go first, and whatever their save brings back follows (saveOnce).
  createEffect(() => {
    const stored = props.items.find(item => item.id === itemId);
    if (!stored || !currentItem || stored === currentItem || dirty() || saving()) return;
    if (stored.kind !== "task" && stored.kind !== "event" && stored.kind !== "record") return;
    // Wakes for the stored items only, not the fields or the clock it reads on the way.
    untrack(() => {
      const moment = now(), before = draftOf(currentItem!, blank, moment);
      adopt(stored);
      follow(before, draftOf(stored, blank, moment));
    });
  });

  const addFiles = (files: File[]) => {
    setPendingFiles((current) => {
      const seen = new Set(current.map((file) => `${file.name}:${file.size}:${file.lastModified}`));
      return [...current, ...files.filter((file) => !seen.has(`${file.name}:${file.size}:${file.lastModified}`))];
    });
    edited();
  };

  const saveOnce = async (): Promise<boolean> => {
    if (!dirty()) return true;
    const problem = invalid();
    if (problem) { setSaveError(problem); return false; }
    const submitted = draft();
    const submittedFiles = [...pendingFiles()];
    const submittedRemoved = new Set(removedAttachments());
    const attachments = [
      ...(currentItem?.attachments || []).filter(file => !submittedRemoved.has(file.id)),
      ...submittedFiles.map((file): Attachment => ({ id: uuid(), name: file.name, type: file.type, size: file.size, blob: file })),
    ];
    const item = itemFromDraft(submitted, { id: itemId, previous: currentItem, now: new Date(), parentId: props.request.parentId, dormant: dormant(), groupId: boardOf(), attachments });
    try {
      const saved = await props.onSave(item, !currentItem, currentItem);
      if (!saved) throw new Error("This item was deleted on another device. Close and reopen the calendar to review it.");
      adopt(saved as Editable);
      // What was saved is now what the fields stand on; anything typed since stays unsaved, and
      // what the stored version has from elsewhere (which the save kept) comes in.
      setBase(submitted);
      const moment = now();
      follow(draftOf(item, blank, moment), draftOf(saved as Editable, blank, moment));
      setPendingFiles((files) => files.filter((file) => !submittedFiles.includes(file)));
      setRemovedAttachments(current => new Set([...current].filter(id => !submittedRemoved.has(id))));
      setSaveError("");
      return true;
    } catch (error) {
      console.error(error);
      setSaveError(error instanceof Error ? error.message : "Could not save item");
      return false;
    }
  };

  const persist = (): Promise<boolean> => {
    if (inFlight) return inFlight;
    setSaving(true);
    inFlight = saveOnce().finally(() => {
      inFlight = null;
      setSaving(false);
      if (dirty() && !closing && !saveError()) {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => { void persist(); }, 800);
      }
    });
    return inFlight;
  };

  const descendants = () => taskDescendants(props.items, itemId);
  const bySortOrder = (a: Task, b: Task) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
  const children = () => props.items.filter((item): item is Task => item.kind === "task" && item.parentId === itemId).sort(bySortOrder);
  const navigateTask = async (task?: Task) => {
    if (!hasSavedItem() || !props.items.some(item => item.id === itemId)) return;
    closing = true; clearTimeout(saveTimer);
    if (inFlight) await inFlight;
    do { if (!(await persist())) { closing = false; return; } } while (dirty());
    if (task) props.onEditItem(task);
    else if (currentItem?.kind === "task") props.onAddSubtask(currentItem);
    else closing = false;
  };

  const deleteCurrent = async () => {
    if (!currentItem || saving()) return;
    closing = true;
    clearTimeout(saveTimer);
    try { await props.onDelete(currentItem); }
    catch (error) {
      closing = false;
      props.onError?.(error instanceof Error ? error.message : "Could not delete item.");
    }
  };

  const download = async (attachment: Attachment) => {
    try {
      const blob = await downloadAttachmentOnDemand(attachment);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = attachment.name || "attachment";
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      props.onError?.(error instanceof Error ? error.message : "Could not download attachment.");
    }
  };

  const windowList = createMemo(() => props.items.filter((item): item is TimeWindow => item.kind === "window").sort((a, b) => a.title.localeCompare(b.title)));
  const removeAttachment = (attachment: Attachment) => {
    setRemovedAttachments(current => new Set([...current, attachment.id]));
    edited();
  };
  const onNotesChange = (notes: string) => edit({ notes });
  // The files as they stand (not counting ones removed here), for the notes' links to them, and
  // the one pointed at: its row and its links in the notes light up together.
  const liveFiles = createMemo(() => new Map(savedAttachments().filter(file => !removedAttachments().has(file.id)).map(file => [file.id, file.name] as const)));
  const [litFile, setLitFile] = createSignal<string | null>(null);
  const downloadById = (id: string) => { const file = savedAttachments().find(entry => entry.id === id); if (file) void download(file); };
  const insertAttachmentLink = (attachment: Attachment) => {
    // The editor syncs the hidden notes field and dirty state via onNotesChange.
    notesApi?.insertLink(attachment.name, attachmentHref(attachment.id));
  };
  const toggleCompleted = () => {
    edit(current => ({ ...current, state: current.state === "open" ? "completed" : "open" }));
  };

  // Options are keyed by id: rebuilding <option> elements would reset the select's choice.
  // The tasks above this one, outermost first: what it's a subtask or dependent task of (a new
  // subtask's parent too).
  const ancestors = () => {
    const byId = new Map(props.items.map(item => [item.id, item]));
    const chain: Task[] = [], seen = new Set([itemId]);
    let child = byId.get(itemId) ?? ({ kind: "task", parentId: props.request.parentId } as Task);
    while (child?.kind === "task") {
      const id = child.parentId || child.dependentOf;
      if (!id || seen.has(id)) break;
      seen.add(id);
      const parent = byId.get(id);
      if (parent?.kind !== "task") break;
      chain.push(parent); child = parent;
    }
    return chain.reverse();
  };
  // Under the title: only that a dependent task hasn't started (where it sits in List shows there).
  const status = () => dormant() && props.items.some(item => item.id === itemId) ? `Dependent task of “${parentTask()?.title || "Untitled task"}” · not started` : "";
  const [subtaskDraft, setSubtaskDraft] = createSignal("");
  const addSubtaskInline = async () => {
    const title = subtaskDraft().trim();
    if (!title || currentItem?.kind !== "task" || !props.onQuickAddSubtask) return;
    if (await props.onQuickAddSubtask(currentItem, title)) setSubtaskDraft(value => value.trim() === title ? "" : value);
  };
  const completionButton = (compact: boolean) => <button type="button" class={compact ? `detail-complete ${taskState() === "completed" ? "done" : ""}` : taskState() === "open" ? "primary-button" : "secondary-button"} aria-label={compact ? (taskState() === "open" ? "Complete task" : "Reopen task") : undefined} title={compact && descendants().length && taskState() === "open" ? `Complete task and ${descendants().length} subtasks` : undefined} onClick={toggleCompleted}>{compact ? (taskState() === "completed" ? "✓" : "") : taskState() === "open" ? (descendants().length ? `✓ Complete task + ${descendants().length} subtasks` : "✓ Complete task") : "↶ Reopen task"}</button>;

  const dateField = (field: RelativeDateField, label: string, input: JSX.Element) =>
    <div class="field">
      <span>{label}<Show when={dormant()}> <select class="date-mode" name={`${field}Mode`} aria-label={`${label} is set`} value={draft()[`${field}Mode`]} onChange={event => edit({ [`${field}Mode`]: event.currentTarget.value as "date" | "after" })}><option value="date">on a date</option><option value="after">days after starting</option></select></Show></span>
      <Show when={dormant() && draft()[`${field}Mode`] === "after"} fallback={input}><input name={`${field}After`} aria-label={`${label}: days after starting`} type="number" min="0" step="0.5" ref={shows(() => draft()[`${field}After`], numberText)} onInput={event => edit({ [`${field}After`]: numberText(event.currentTarget) })} /></Show>
    </div>;
  const dependents = () => props.items.filter((item): item is Task => item.kind === "task" && item.dependentOf === itemId).sort(bySortOrder);
  const parentTask = () => props.items.find((item): item is Task => item.kind === "task" && item.id === task()?.dependentOf);
  const [dependentDraft, setDependentDraft] = createSignal("");
  const addDependentInline = async () => {
    const title = dependentDraft().trim();
    if (!title || currentItem?.kind !== "task" || !props.onAddDependent) return;
    if (await props.onAddDependent(currentItem, title)) setDependentDraft(value => value.trim() === title ? "" : value);
  };
  // Starting saves pending edits first; the drawer then closes since the task is no longer dependent.
  const startDependent = async (dependent: Task, completeParent: boolean) => {
    if (!props.onStartDependent || !(await flush())) return;
    const own = dependent.id === itemId;
    await props.onStartDependent(own ? (currentItem as Task) : dependent, completeParent);
    if (own && !props.embedded) { closing = true; props.onClose(); }
  };
  // A row's left-edge grip drags it up or down its list to reorder it.
  const startRowDrag = (child: Task) => (event: PointerEvent) => {
    if (event.button !== 0 || !props.onReorderChildren) return;
    event.preventDefault();
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture(event.pointerId);
    const row = handle.closest<HTMLElement>(".subtask-row, .dependent-row");
    const list = row?.parentElement;
    if (!row || !list) return;
    const rows = [...list.querySelectorAll<HTMLElement>(":scope > .subtask-row, :scope > .dependent-row")];
    const ids = rows.map(element => element.dataset.id!);
    const ghost = row.cloneNode(true) as HTMLElement;
    const startY = event.clientY, rect = row.getBoundingClientRect();
    ghost.classList.add("row-ghost");
    Object.assign(ghost.style, { position: "fixed", left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, margin: "0", zIndex: "70" });
    document.body.appendChild(ghost);
    row.classList.add("dragging");
    // Where it would go: before the row at `slot` (rows.length: after the last).
    let slot = rows.indexOf(row), live = true;
    const mark = () => rows.forEach((element, index) => { element.classList.toggle("drop-before", index === slot && slot !== ids.indexOf(child.id) && slot !== ids.indexOf(child.id) + 1); element.classList.toggle("drop-after", index === rows.length - 1 && slot === rows.length && index !== ids.indexOf(child.id)); });
    const move = (next: PointerEvent) => {
      ghost.style.transform = `translate(0, ${next.clientY - startY}px)`;
      slot = rows.filter(element => { const box = element.getBoundingClientRect(); return box.top + box.height / 2 < next.clientY; }).length;
      mark();
    };
    const commit = props.onReorderChildren;
    const finish = (drop: boolean) => {
      if (!live) return;
      live = false;
      ghost.remove();
      rows.forEach(element => element.classList.remove("dragging", "drop-before", "drop-after"));
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", cancel);
      document.removeEventListener("keydown", escape, true);
      if (!drop) return;
      const from = ids.indexOf(child.id), order = ids.filter(id => id !== child.id);
      order.splice(slot > from ? slot - 1 : slot, 0, child.id);
      if (order.join() === ids.join()) return;
      const byId = new Map(props.items.map(item => [item.id, item]));
      void commit(order.map(id => byId.get(id)).filter((item): item is Task => item?.kind === "task"));
    };
    const up = () => finish(true);
    const cancel = () => finish(false);
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); finish(false); } };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up, { once: true });
    handle.addEventListener("pointercancel", cancel, { once: true });
    document.addEventListener("keydown", escape, true);
  };

  const startButtons = (dependent: Task, parent?: Task) => <>
    <button type="button" class="text-button" onClick={() => void startDependent(dependent, false)}>Start</button>
    <Show when={parent && parent.state !== "completed"}><button type="button" class="text-button" title={`Start this and complete “${parent?.title || "Untitled task"}”`} onClick={() => void startDependent(dependent, true)}>Start & complete</button></Show>
  </>;

  const form = (
      <form onSubmit={(event) => { event.preventDefault(); void close(); }}>
        <div class="editor-close-bar"><button type="button" class="icon-button editor-close" classList={{ invalid: dirty() && !!(saveError() || invalid()) }} aria-label={dirty() && (saveError() || invalid()) ? "Close (reverts the unsaved changes)" : "Close"} title={dirty() && (saveError() || invalid()) ? `Can't save: ${saveError() || invalid()} — closing reverts` : "Close (Esc)"} onClick={() => void close()}>×</button></div>
        <Show when={closeBlocked() && dirty() && (saveError() || invalid())}>
          <div class="close-blocked" role="alert">
            <p><strong>Can't save this {kind()}:</strong> {saveError() || invalid()}</p>
            <div><button type="button" class="danger-button" onClick={() => void revert()}>Revert</button></div>
          </div>
        </Show>
        <Show when={kind() === "task" && ancestors().length > 0}>
          <nav class="detail-path" aria-label="Part of"><For each={ancestors()}>{parent => <><a href={props.itemHref?.(parent.id)} onClick={event => { if (event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return; event.preventDefault(); void navigateTask(parent); }}>{parent.title || "Untitled task"}</a><span aria-hidden="true">&gt;</span></>}</For></nav>
        </Show>
        <div class="dialog-header">
          <Show when={props.embedded && kind() === "task"}>{completionButton(true)}</Show>
          <label class="editor-title-field"><span class="visually-hidden" id={`editor-title-${domId}`}>Item title</span><input class="editor-title-input" name="title" aria-label="Item title" required maxLength={240} placeholder="Untitled item" ref={shows(() => draft().title)} onInput={event => edit({ title: event.currentTarget.value })} data-dialog-autofocus={true} /><span class="title-edit-hint" aria-hidden="true">✎</span></label>
        </div>

        <Show when={props.embedded && status()}><p class="detail-status">{status()}</p></Show>
        <Show when={dormant() && props.onStartDependent && task()}>{own => <div class="dependent-start">{startButtons(own(), parentTask())}</div>}</Show>
        <div class="segmented kind-switch">
          <label><input type="radio" name="kind" value="task" checked={kind() === "task"} onChange={() => edit(current => withKind(current, "task", notifyBefore))} /><span>Task</span></label>
          <label title="A set time to be somewhere: in the Agenda, and in List until it starts"><input type="radio" name="kind" value="event" checked={kind() === "event"} onChange={() => edit(current => withKind(current, "event", notifyBefore))} /><span>Event</span></label>
          <label title="Noted at a time, nothing to do: on the Calendar and in search only"><input type="radio" name="kind" value="record" checked={kind() === "record"} onChange={() => edit(current => withKind(current, "record", notifyBefore))} /><span>Record</span></label>
        </div>

        <Show when={kind() === "task"} fallback={
          <div class="form-grid">
            <div class="field"><span>Starts</span><DateTimeField name="eventStart" label="Starts" value={draft().start} onChange={value => edit(current => withStart(current, value))} /></div>
            <div class="field"><span>{kind() === "record" ? "Ends (optional)" : "Ends"}</span><DateTimeField name="eventEnd" label="Ends" value={draft().end} onChange={value => edit(current => withEnd(current, value))} /></div>
          </div>
        }>
          <div>
            <div class="form-grid">
              <div class="task-completion full-span"><Show when={!props.embedded}>{completionButton(false)}</Show></div>
              {dateField("availableFrom", "Can start", <DateTimeField name="availableFrom" label="Can start" value={draft().availableFrom} onChange={availableFrom => edit({ availableFrom })} />)}
              {dateField("deadline", "Due", <DateTimeField name="deadline" label="Due" value={draft().deadline} onChange={deadline => edit({ deadline })} />)}
              <div class="field"><span class="field-label-row"><span>Window</span><Show when={props.onManageWindows}><button type="button" class="inline-link" onClick={() => props.onManageWindows?.()}>Manage</button></Show></span>
                <select name="windowId" aria-label="Window" value={draft().windowId} onChange={event => edit({ windowId: event.currentTarget.value })}>
                  <option value="">Any time</option>
                  <For each={windowList().map(window => window.id)}>{id => { const window = () => windowList().find(entry => entry.id === id); const hours = () => window() ? describeSchedule(window()!) : ""; return <option value={id}>{window()?.title === hours() ? hours() : `${window()?.title} · ${hours()}`}</option>; }}</For>
                </select>
              </div>
              {/* One option: pushed down until the date if one is set, else until lifted. */}
              <div class="field"><label class="field-label-row field-check"><input type="checkbox" checked={draft().pushed} onChange={event => edit({ pushed: event.currentTarget.checked })} /><span>Suppress</span></label>
                <DateTimeField name="pushUntil" label="Suppressed until" placeholder="Until you unsuppress it" value={draft().pushUntil} disabled={!draft().pushed} onChange={pushUntil => edit({ pushUntil })} /></div>
              {/* Repeats: all controls always shown (disabled until it repeats) so nothing shifts. */}
              <div class="field full-span repeat-field"><span>Repeat</span>
                <div class="repeat-controls">
                  <select name="repeatUnit" aria-label="Repeats" value={draft().repeatUnit} onChange={event => edit({ repeatUnit: event.currentTarget.value })}>
                    <option value="">Doesn't repeat</option><option value="day">Daily</option><option value="weekday">Weekdays</option><option value="week">Weekly</option><option value="month">Monthly</option>
                  </select>
                  <label class="repeat-every">every <input name="repeatEvery" type="number" min="1" step="1" aria-label="Repeat every" ref={shows(() => draft().repeatEvery, numberText)} onInput={event => edit({ repeatEvery: numberText(event.currentTarget) })} disabled={!draft().repeatUnit} /></label>
                  <select name="repeatMissed" aria-label="If an occurrence is missed" title="What happens when an occurrence passes without being done" value={draft().repeatMissed} onChange={event => edit({ repeatMissed: event.currentTarget.value === "keep" ? "keep" : "skip" })} disabled={!draft().repeatUnit}>
                    <option value="skip">If missed: skip it</option><option value="keep">If missed: keep until done</option>
                  </select>
                  <div class="repeat-until"><DateTimeField name="repeatUntil" label="Repeat until" placeholder="Repeats until…" value={draft().repeatUntil} disabled={!draft().repeatUnit} onChange={repeatUntil => edit({ repeatUntil })} /></div>
                  <label class="field-check" title="Each time: Not yet (see it again next time) or It happened (finished for good)"><input type="checkbox" name="repeatUntilDone" checked={draft().repeatUntilDone} onChange={event => edit({ repeatUntilDone: event.currentTarget.checked })} disabled={!draft().repeatUnit} /> Check in until it happens</label>
                </div>
              </div>
              <Show when={dormant()}>
                <div class="field full-span repeat-field"><span>Starts</span>
                  <div class="repeat-controls">
                    <select aria-label="Starts" value={draft().startWhen} onChange={event => edit({ startWhen: event.currentTarget.value as Draft["startWhen"] })}>
                      <option value="">When I start it</option><option value="parent-done">When “{parentTask()?.title || "its parent"}” is done</option><option value="not-yet">On a “Not yet” for “{parentTask()?.title || "its parent"}”</option>
                    </select>
                    <div class="repeat-until"><DateTimeField name="startAfter" label="On or after" placeholder="On or after…" value={draft().startAfter} disabled={draft().startWhen !== "not-yet"} onChange={startAfter => edit({ startAfter })} /></div>
                    <label class="field-check"><input type="checkbox" name="stopParent" checked={draft().stopParent} onChange={event => edit({ stopParent: event.currentTarget.checked })} disabled={draft().startWhen !== "not-yet"} /> Finish “{parentTask()?.title || "its parent"}” when this starts</label>
                  </div>
                </div>
              </Show>
            </div>
          </div>
        </Show>

        <div class="form-grid reminders-grid">
          <div class="field full-span remind-at-field" ref={noticesRef}><span>Notifications</span>
            <Index each={draft().notifications}>{(notice, index) => <div class="remind-at">
              <input class="notice-amount" type="number" min="0" step="any" aria-label={`Notification ${index + 1}: how long before`} ref={shows(() => notice().amount, numberText)} onInput={event => editNotice(index, { amount: numberText(event.currentTarget) })} />
              <select aria-label={`Notification ${index + 1}: unit`} value={notice().unit} onChange={event => editNotice(index, { unit: event.currentTarget.value as NoticeUnit })}>
                <For each={NOTICE_UNITS}>{([unit]) => <option value={unit}>{Number(notice().amount) === 1 ? unit.slice(0, -1) : unit}</option>}</For>
              </select>
              <span>before</span>
              <Show when={kind() === "task"} fallback={<span>it starts</span>}>
                <select aria-label={`Notification ${index + 1}: before what`} value={notice().of} onChange={event => editNotice(index, { of: event.currentTarget.value === "due" ? "due" : "start" })}>
                  <option value="start">it can start</option><option value="due">it's due</option>
                </select>
              </Show>
              <button type="button" class="icon-button" aria-label={`Remove notification ${index + 1}`} onClick={() => editNotices(list => list.filter((_, at) => at !== index))}>×</button>
            </div>}</Index>
            <Show when={unanchored()}><small class="field-hint">{unanchored()}</small></Show>
            <button type="button" class="text-button remind-add" onClick={addNotice}>+ Add a notification</button>
          </div>
        </div>

        <section class="notes-editor" aria-label="Notes">
          <div class="notes-toolbar"><span>Notes</span></div>
          <NotesEditor ariaLabel="Notes" placeholder="Write notes…" initialMarkdown={untrack(draft).notes} onChange={onNotesChange} onEditor={api => { notesApi = api; }}
            files={liveFiles} lit={litFile} onLight={setLitFile} onDownload={downloadById} />
        </section>

        <div class="form-grid shared-item-fields">
          <label class="field full-span"><span>Tags</span><input name="tags" placeholder="project, errands" ref={shows(() => draft().tags)} onInput={event => edit({ tags: event.currentTarget.value })} /></label>

        </div>


          <section class="attachments-section full-span" aria-labelledby={`attachments-title-${domId}`}>
            <h3 id={`attachments-title-${domId}`}>Attachments</h3>
            <div class={`attachment-drop-zone ${draggingAttachments() ? "dragging" : ""}`}
              onDragEnter={event => { event.preventDefault(); setDraggingAttachments(true); }}
              onDragOver={event => { event.preventDefault(); setDraggingAttachments(true); }}
              onDragLeave={() => setDraggingAttachments(false)}
              onDrop={event => { event.preventDefault(); setDraggingAttachments(false); addFiles([...(event.dataTransfer?.files || [])]); }}>
              <label class="file-picker"><Icon name="paperclip" size={20} /><span><strong>Choose files</strong> or drop them here</span><input class="visually-hidden" type="file" aria-label="Add attachments" multiple onChange={event => { addFiles([...(event.currentTarget.files || [])]); event.currentTarget.value = ""; }} /></label>
            </div>
            <ul class="attachment-list">
              <For each={savedAttachments().filter(file => !removedAttachments().has(file.id))}>{attachment => <li classList={{ lit: litFile() === attachment.id }} onMouseEnter={() => setLitFile(attachment.id)} onMouseLeave={() => setLitFile(null)}>
                <button type="button" class="attachment-name" onClick={() => insertAttachmentLink(attachment)} title="Link it in the notes">{attachment.name}</button>
                <div class="attachment-actions"><button type="button" class="text-button" onClick={() => void download(attachment)}>Download</button><button type="button" class="text-button danger-text" aria-label={`Remove ${attachment.name}`} onClick={() => removeAttachment(attachment)}>Remove</button></div>
              </li>}</For>
              <For each={pendingFiles()}>{file => <li><span>{file.name} · waiting to save</span><button type="button" class="text-button" disabled={saving()} onClick={() => { setPendingFiles(files => files.filter(candidate => candidate !== file)); edited(); }}>Remove</button></li>}</For>
            </ul>
          </section>
          <Show when={kind() === "task"}>
              <div class="subtask-editor full-span"><div class="subtask-heading"><strong>Subtasks</strong><button type="button" class="text-button" hidden={!!props.onQuickAddSubtask} disabled={!hasSavedItem() || !props.items.some(item => item.id === itemId)} title={hasSavedItem() ? "Add a child task" : "Name this task first"} onClick={() => void navigateTask()}>+ Add subtask</button></div><For each={children()}>{child => <div class="subtask-row" data-id={child.id}><span class="subtask-grip" title="Drag to reorder" aria-hidden="true" onPointerDown={startRowDrag(child)} /><button type="button" class="subtask-editor-link" onClick={() => void navigateTask(child)}><span aria-label={child.state === "completed" ? "Completed" : "Open"}>{child.state === "completed" ? "✓" : "○"}</span> {child.title || "Untitled task"}</button><Show when={props.onConvertChild && hasSavedItem()}><button type="button" class="text-button convert-button" title="Make this a dependent task: one that starts after this task" onClick={() => void props.onConvertChild!(child, "dependent")}>Make dependent</button></Show></div>}</For>
                <Show when={props.onQuickAddSubtask}><div class="subtask-quick-add"><span aria-hidden="true">+</span><input aria-label="New subtask title" placeholder={hasSavedItem() ? "Add a subtask…" : "Name this task first"} disabled={!hasSavedItem()} maxLength={240} value={subtaskDraft()} onInput={event => setSubtaskDraft(event.currentTarget.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void addSubtaskInline(); } }} /><button type="button" class="text-button" disabled={!subtaskDraft().trim()} onClick={() => void addSubtaskInline()}>Add</button></div></Show>
                </div>
                <Show when={hasSavedItem() && props.onAddDependent}>
                   <div class="subtask-editor dependents-editor full-span"><div class="subtask-heading"><strong>Dependent tasks</strong></div>
                     <For each={dependents()}>{dependent => <div class="dependent-row" data-id={dependent.id}><span class="subtask-grip" title="Drag to reorder" aria-hidden="true" onPointerDown={startRowDrag(dependent)} /><button type="button" class="subtask-editor-link" onClick={() => void navigateTask(dependent)}><span aria-hidden="true">◌</span> {dependent.title || "Untitled task"}</button>{startButtons(dependent, currentItem?.kind === "task" ? currentItem : undefined)}<Show when={props.onConvertChild}><button type="button" class="text-button convert-button" title="Make this a subtask: part of this task" onClick={() => void props.onConvertChild!(dependent, "subtask")}>Make subtask</button></Show></div>}</For>
                    <div class="subtask-quick-add"><span aria-hidden="true">+</span><input aria-label="New dependent task title" placeholder="Add a dependent task…" maxLength={240} value={dependentDraft()} onInput={event => setDependentDraft(event.currentTarget.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void addDependentInline(); } }} /><button type="button" class="text-button" disabled={!dependentDraft().trim()} onClick={() => void addDependentInline()}>Add</button></div>
                  </div>
                </Show>
          </Show>


        <div class="dialog-actions">
          <Show when={hasSavedItem()}><button type="button" class="danger-button" disabled={saving()} onClick={() => void deleteCurrent()}>Delete</button></Show>
          <span role="status" title="Saved locally means this browser has stored the edit. Remote sync is reported in the app header.">{saving() ? "Saving…" : saveError() || (dirty() ? "Unsaved changes" : (hasSavedItem() ? "Saved locally" : "Not saved yet"))}</span>
          <div class="spacer" />
          <button type="submit" class="secondary-button">Close</button>
        </div>
      </form>
  );

  return props.embedded
    ? <section class="item-detail" aria-labelledby={`editor-title-${domId}`} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); void close(); } }}>{form}</section>
    : <DialogShell labelledBy={`editor-title-${domId}`} className="item-editor-dialog" initialFocus={existing && window.matchMedia("(pointer: coarse)").matches ? "dialog" : "content"} onClose={close}>{form}</DialogShell>;
}
