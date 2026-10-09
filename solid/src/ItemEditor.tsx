import { Icon } from "./Icon";
import { taskDescendants } from "../../site/task-tree.js";
import { For, Index, Show, createEffect, createMemo, createSignal, onMount, onCleanup, type JSX } from "solid-js";
import { atTime, fromInputValue, inputToIso as localInputToIso, partsOf, startOfDay, toInputValue as isoToLocalInput } from "./zone";
import { NotesEditor, type NotesEditorApi } from "./NotesEditor";
import { DateTimeField } from "./DateTimeField";
import { pushedDownInfo } from "./today";
import { describeSchedule } from "./windows";
import { RELATIVE_DATE_FIELDS, type RelativeDateField } from "./dependencies";
import { attachmentMarkdown } from "./markdown";
import { DialogShell } from "./DialogShell";
import { downloadAttachmentOnDemand } from "../../site/attachment-remote.js";
import { eventFromDraft, recordFromDraft, taskFromDraft, type TaskDraft } from "./item-changes";
import type { Attachment, CalendarEvent, CalendarRecord, CalendarSettings, Item, Repeat, Task, TimeWindow } from "./types";

/** What the editor edits: a task, an event (a set time to be somewhere), or a record (noted at a time). */
export type Editable = Task | CalendarEvent | CalendarRecord;
export type EditorRequest = {
  item: Editable | null;
  kind: Editable["kind"];
  date?: Date;
  parentId?: string;
  groupId?: string | null;
  nonce: number;
};

let editorInstances = 0;
// The dates a dependent task can set as days after starting.
const SHOWN_RELATIVE_FIELDS = ["availableFrom", "deadline"] as const;

function uuid() {
  return crypto.randomUUID();
}

function parseTags(value: FormDataEntryValue | null) {
  return String(value || "").split(",").map((tag) => tag.trim()).filter(Boolean);
}

const HOUR = 60 * 60 * 1000;
// An event's or record's times left off: a start at midnight, an end at 11:59 PM (whole days).
const dayStart = (date: Date) => !partsOf(date).hour && !partsOf(date).minute;
const dayEnd = (date: Date) => partsOf(date).hour === 23 && partsOf(date).minute === 59;

// A new event lasts an hour (a record has no end until you give it one), and an event notifies
// as long before it starts as the calendar's settings say new events do.
function eventDefaults(request: EditorRequest, items: Item[]) {
  const existing = request.item?.kind === "event" || request.item?.kind === "record" ? request.item : null;
  if (existing) return { start: isoToLocalInput(existing.start), end: isoToLocalInput(existing.end), notifyBefore: null };

  const start = request.date ? atTime(request.date, "09:00") : new Date();
  const settings = items.find((item): item is CalendarSettings => item.kind === "settings");
  return { start: isoToLocalInput(start), end: request.kind === "record" ? "" : isoToLocalInput(new Date(start.getTime() + HOUR)), notifyBefore: settings?.eventReminderMinutes ?? null };
}

function serializeForm(form: HTMLFormElement, files: File[], removed: Set<string>) {
  return JSON.stringify({
    controls: [...form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input:not([data-editor-ignore]), textarea, select")].map((control, index) => ({
      key: control.name || control.id || String(index),
      type: control instanceof HTMLInputElement ? control.type : control.tagName.toLowerCase(),
      value: control instanceof HTMLInputElement && control.type === "file"
        ? [...(control.files || [])].map((file) => [file.name, file.size, file.lastModified])
        : control.value,
      checked: control instanceof HTMLInputElement ? control.checked : undefined,
    })),
    removed: [...removed].sort(),
    pendingFiles: files.map((file) => [file.name, file.size, file.lastModified]),
  });
}

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
  registerFlush?: (flush: () => Promise<boolean>) => () => void;
  onStale?: () => void;
  onQuickAddSubtask?: (parent: Task, title: string) => Promise<boolean>;
  onAddDependent?: (parent: Task, title: string) => Promise<boolean>;
  onStartDependent?: (task: Task, completeParent: boolean) => Promise<void>;
  // Lets the app close an embedded editor (e.g. Escape pressed outside it) through the same checks.
  registerClose?: (close: () => void) => () => void;
  // Rows drag between the Subtasks and Dependent tasks sections to switch relation.
  onConvertChild?: (child: Task, to: "subtask" | "dependent") => Promise<unknown>;
  // Subtasks (or dependent tasks) in a new order.
  onReorderChildren?: (ordered: Task[]) => Promise<unknown>;
  // Unsaved text mirrors to the board card as it's typed (no debounce), and inline
  // board edits flow back into this editor through the same map.
  liveEdits?: () => Map<string, Partial<Task>>;
  onLiveEdit?: (taskId: string, patch: Partial<Task> | null) => void;
  // Reopens the editor on the given saved item (null: a fresh editor for the same request).
  onRevert?: (saved: Item | null) => void;
  // Opens the settings where named windows are edited.
  onManageWindows?: () => void;
  // What counts as now for showing status (pretend time); saves still use the real time.
  now?: Date;
}) {
  const existing = props.request.item;
  const domId = `${++editorInstances}`;
  let currentItem = existing;
  const [hasSavedItem, setHasSavedItem] = createSignal(!!existing);
  const itemId = existing?.id || uuid();
  const [removedAttachments, setRemovedAttachments] = createSignal(new Set<string>());
  const [taskState, setTaskState] = createSignal<Task["state"]>(existing?.kind === "task" ? existing.state : "open");
  let notesRef!: HTMLTextAreaElement;
  let notesApi: NotesEditorApi | null = null;
  const [saving, setSaving] = createSignal(false);
  const [saveError, setSaveError] = createSignal("");
  const [savedAttachments, setSavedAttachments] = createSignal(existing?.attachments || []);
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<boolean> | null = null;
  let closing = false;
  const task = existing?.kind === "task" ? existing : null;
  // A dependent task that hasn't started: its dates can be days after starting instead of fixed.
  const dormant = () => !!task?.dependentOf && props.items.some(item => item.id === task.dependentOf && item.kind === "task");
  const [dateModes, setDateModes] = createSignal(Object.fromEntries(RELATIVE_DATE_FIELDS.map(field => [field, task?.relativeDates?.[field] != null ? "after" : "date"])) as Record<RelativeDateField, "date" | "after">);
  const now = () => props.now ?? new Date();
  const initialPush = task ? pushedDownInfo(task, now()) : null;
  const defaults = eventDefaults(props.request, props.items);
  const [kind, setKind] = createSignal<Editable["kind"]>(props.request.kind);
  // A window's id, or "" for any time.
  const [windowChoice, setWindowChoice] = createSignal(task?.windowId || "");
  // Pushed down, until a date if one is set (otherwise until lifted).
  const [pushed, setPushed] = createSignal(!!initialPush?.pushed);
  // Repeats ("" for not repeating), and a dependent task's automatic start.
  const [repeatUnit, setRepeatUnit] = createSignal<string>(task?.repeat?.unit || "");
  const [startWhen, setStartWhen] = createSignal<string>(task?.startWhen?.on || "");
  const [eventStart, setEventStart] = createSignal(defaults.start);
  // Notifications: at the times in the list. A new event starts with the calendar's (some minutes
  // before it starts), which follows its start until you change the list yourself; a new task or
  // record starts with none, as does an all-day event (its start is midnight).
  const [remindAts, setRemindAts] = createSignal<string[]>((existing?.remindAt || []).map(time => isoToLocalInput(time)));
  const chosenReminders = () => remindAts().map(value => localInputToIso(value)).filter((time): time is NonNullable<typeof time> => !!time);
  const [defaultNotice, setDefaultNotice] = createSignal(!existing && defaults.notifyBefore != null);
  const editNotices = (change: (list: string[]) => string[]) => { setDefaultNotice(false); setRemindAts(change); };
  createEffect(() => {
    if (!defaultNotice()) return;
    const start = kind() === "event" && eventStart() ? fromInputValue(eventStart()) : null;
    setRemindAts(start && !dayStart(start) ? [isoToLocalInput(new Date(start.getTime() - defaults.notifyBefore! * 60_000))] : []);
  });
  const [eventEnd, setEventEnd] = createSignal(defaults.end);
  const [pendingFiles, setPendingFiles] = createSignal<File[]>([]);
  const [draggingAttachments, setDraggingAttachments] = createSignal(false);
  const [dirty, setDirty] = createSignal(false);
  let formRef!: HTMLFormElement;
  let baseline = "";
  let edited = false;

  // Why the current form can't save, if it can't. (Validates without saving.)
  const [invalid, setInvalid] = createSignal("");
  const validate = () => {
    if (!formRef) return "";
    if (!String(new FormData(formRef).get("title") || "").trim()) return "Enter a title to save.";
    if (!formRef.checkValidity()) return "Complete the required fields to save.";
    return "";
  };
  // The editor doesn't choose a board (Boards does, by dragging): a task keeps the one it's on
  // now, however it got there while open, and a new one takes the one it was started from.
  const boardOf = () => { const stored = props.items.find(item => item.id === itemId); return stored?.kind === "task" ? stored.groupId ?? null : props.request.groupId ?? null; };
  // What the board card should show right now (the form in flushable field shape).
  const draftPatch = (): Partial<Task> | null => {
    if (kind() !== "task" || !formRef) return null;
    const data = new FormData(formRef);
    return {
      title: String(data.get("title") || ""),
      notes: String(data.get("notes") || ""),
      availableFrom: localInputToIso(data.get("availableFrom")),
      deadline: localInputToIso(data.get("deadline")),
      groupId: boardOf(),
      state: taskState(),
    };
  };

  const syncDirty = () => {
    edited = true;
    queueMicrotask(() => {
      setDirty(!!baseline && serializeForm(formRef, pendingFiles(), removedAttachments()) !== baseline);
      setInvalid(validate());
      setCloseBlocked(false);
      if (kind() === "task") props.onLiveEdit?.(itemId, draftPatch());
      clearTimeout(saveTimer);
      if (dirty() && !closing) saveTimer = setTimeout(() => { void persist(); }, 800);
    });
  };

  onMount(() => {
    // Capture now so early edits count; refresh after the first frame if nothing was edited yet.
    baseline = serializeForm(formRef, pendingFiles(), removedAttachments());
    requestAnimationFrame(() => {
      if (edited) return;
      baseline = serializeForm(formRef, pendingFiles(), removedAttachments());
      setDirty(false);
    });
  });

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
  // Reverting reopens the editor on the last saved version. Autosave waits for an
  // 800ms pause, so that is the last valid state that stood still, not whatever
  // briefly passed through the fields while typing.
  const revert = async () => {
    reverting = closing = true;
    clearTimeout(saveTimer);
    if (inFlight) await inFlight;
    props.onLiveEdit?.(itemId, null);
    if (props.onRevert) props.onRevert(currentItem); else props.onClose();
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
  // Inline board edits flow back in live: the title input re-renders from the store
  // (see its value=), and the notes editor is updated unless it's the focused field.
  createEffect(() => {
    const draft = props.liveEdits?.().get(itemId);
    if (!draft) return;
    if (draft.notes !== undefined && notesRef && notesRef.value !== draft.notes) {
      notesRef.value = draft.notes;
      notesApi?.setMarkdown(draft.notes);
    }
  });
  const flush = async () => {
    if (reverting) return true;
    clearTimeout(saveTimer);
    if (inFlight) await inFlight;
    while (dirty()) { if (!(await persist())) return false; }
    return true;
  };
  onMount(() => { const unregister = props.registerFlush?.(flush); onCleanup(() => unregister?.()); });
  // Reload when another view or device changes the item while this editor is idle.
  createEffect(() => {
    const stored = props.items.find(item => item.id === itemId);
    if (!props.onStale || !stored || !currentItem || dirty() || saving()) return;
    if (stored.updatedAt === currentItem.updatedAt) return;
    const active = document.activeElement;
    if (active && formRef?.contains(active) && active.matches("input, textarea, select, [contenteditable]")) return;
    props.onStale();
  });

  const addFiles = (files: File[]) => {
    setPendingFiles((current) => {
      const seen = new Set(current.map((file) => `${file.name}:${file.size}:${file.lastModified}`));
      return [...current, ...files.filter((file) => !seen.has(`${file.name}:${file.size}:${file.lastModified}`))];
    });
    syncDirty();
  };

  // Setting one end of an event fills in a missing other end an hour away, and moves it there
  // when it would come out on the wrong side. A record's end is optional: it's only moved.
  // Leaving the times off makes it all day: a start without one ends that day (11:59 PM), and
  // giving the start a time again brings the end back to an hour after it.
  const deriveEnd = (value: string) => {
    const before = eventStart() ? fromInputValue(eventStart()) : null;
    setEventStart(value);
    const start = value ? fromInputValue(value) : null;
    if (!start) return;
    const end = eventEnd() ? fromInputValue(eventEnd()) : null;
    const missing = !end && kind() === "event";
    if (dayStart(start)) { if (missing || (end && (end < start || !dayEnd(end)))) setEventEnd(isoToLocalInput(atTime(start, "23:59"))); }
    else if (missing || (end && end < start) || (end && dayEnd(end) && before && dayStart(before))) setEventEnd(isoToLocalInput(new Date(start.getTime() + HOUR)));
  };

  const deriveStart = (value: string) => {
    setEventEnd(value);
    const end = value ? fromInputValue(value) : null;
    if (!end) return;
    const start = eventStart() ? fromInputValue(eventStart()) : null;
    if (!eventStart() || (start && start > end)) setEventStart(isoToLocalInput(dayEnd(end) ? startOfDay(end) : new Date(end.getTime() - HOUR)));
  };

  const saveOnce = async (): Promise<boolean> => {
    if (!dirty()) return true;
    if (!String(new FormData(formRef).get("title") || "").trim()) { setSaveError("Enter a title to save."); return false; }
    if (!formRef.checkValidity()) { setSaveError("Complete the required fields to save."); return false; }
    const submittedForm = serializeForm(formRef, pendingFiles(), removedAttachments());
    const submittedFiles = [...pendingFiles()];
    const submittedRemoved = new Set(removedAttachments());
    const data = new FormData(formRef);
    const title = String(data.get("title") || "").trim();
    if (!title) { setSaveError("Enter a title to save."); return false; }
    const shared = {
      title,
      notes: String(data.get("notes") || ""),
      tags: parseTags(data.get("tags")),
      attachments: [
        ...(currentItem?.attachments || []).filter(file => !submittedRemoved.has(file.id)),
        ...submittedFiles.map((file): Attachment => ({ id: uuid(), name: file.name, type: file.type, size: file.size, blob: file })),
      ],
    };
    const context = { id: itemId, previous: currentItem, now: new Date() };
    let item: Item;
    if (kind() === "task") {
      const relativeDates: TaskDraft["relativeDates"] = {};
      for (const field of SHOWN_RELATIVE_FIELDS) if (dateModes()[field] === "after") relativeDates[field] = Math.max(0, Number(data.get(`${field}After`)) || 0);
      const choice = windowChoice();
      item = taskFromDraft({
        ...shared,
        state: taskState(),
        pushedDown: !pushed() ? { mode: "normal" } : localInputToIso(data.get("pushUntil")) ? { mode: "until", until: localInputToIso(data.get("pushUntil")) } : { mode: "indefinite" },
        groupId: boardOf(),
        availableFrom: localInputToIso(data.get("availableFrom")),
        deadline: localInputToIso(data.get("deadline")),
        windowId: choice || null,
        relativeDates,
        repeat: repeatUnit() ? { unit: repeatUnit() as Repeat["unit"], every: Math.max(1, Math.round(Number(data.get("repeatEvery")) || 1)), until: localInputToIso(data.get("repeatUntil")), untilDone: data.get("repeatUntilDone") === "on", ifMissed: data.get("repeatMissed") === "keep" ? "keep" : "skip" } : null,
        remindAt: chosenReminders(),
        ...(dormant() ? { startWhen: startWhen() === "parent-done" ? { on: "parent-done" as const } : startWhen() === "not-yet" ? { on: "not-yet" as const, after: localInputToIso(data.get("startAfter")) } : null, stopParent: data.get("stopParent") === "on" } : {}),
      }, { ...context, parentId: props.request.parentId, dormant: dormant() });
    } else {
      if (kind() === "record" ? !eventStart() : !eventStart() && !eventEnd()) { setSaveError(`Choose when the ${kind()} starts.`); return false; }
      const draft = { ...shared, start: localInputToIso(eventStart()), end: localInputToIso(eventEnd()), remindAt: chosenReminders() };
      item = kind() === "record" ? recordFromDraft(draft, context) : eventFromDraft(draft, context);
    }

    try {
      const saved = await props.onSave(item, !currentItem, currentItem);
      if (!saved) throw new Error("This item was deleted on another device. Close and reopen the calendar to review it.");
      currentItem = saved as Editable;
      setHasSavedItem(true);
      setSavedAttachments(currentItem.attachments || []);
      const unchanged = serializeForm(formRef, pendingFiles(), removedAttachments()) === submittedForm;
      setPendingFiles((files) => files.filter((file) => !submittedFiles.includes(file)));
      setRemovedAttachments(current => new Set([...current].filter(id => !submittedRemoved.has(id))));
      if (unchanged) {
        baseline = serializeForm(formRef, pendingFiles(), removedAttachments());
        setDirty(false);
      }
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

  const pushUntil = isoToLocalInput(initialPush?.until);
  const windowList = createMemo(() => props.items.filter((item): item is TimeWindow => item.kind === "window").sort((a, b) => a.title.localeCompare(b.title)));
  const removeAttachment = (attachment: Attachment) => {
    setRemovedAttachments(current => new Set([...current, attachment.id]));
    syncDirty();
  };
  const onNotesChange = (markdown: string) => {
    notesRef.value = markdown;
    syncDirty();
  };
  // The files as they stand (not counting ones removed here), for the notes' links to them, and
  // the one pointed at: its row and its links in the notes light up together.
  const liveFiles = createMemo(() => new Map(savedAttachments().filter(file => !removedAttachments().has(file.id)).map(file => [file.id, file.name] as const)));
  const [litFile, setLitFile] = createSignal<string | null>(null);
  const downloadById = (id: string) => { const file = savedAttachments().find(entry => entry.id === id); if (file) void download(file); };
  const insertAttachmentLink = (attachment: Attachment) => {
    // The editor syncs the hidden notes field and dirty state via onNotesChange.
    notesApi?.insertMarkdown(attachmentMarkdown(attachment.id, attachment.name));
  };
  const toggleCompleted = () => {
    setTaskState(state => state === "open" ? "completed" : "open");
    syncDirty();
  };

  // Options are keyed by id: rebuilding <option> elements would reset the select's choice.
  const ancestors = () => {
    const byId = new Map(props.items.map(item => [item.id, item]));
    const chain: Task[] = [], seen = new Set([itemId]);
    let child = byId.get(itemId);
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
      <span>{label}<Show when={dormant()}> <select class="date-mode" name={`${field}Mode`} aria-label={`${label} is set`} value={dateModes()[field]} onChange={event => { const mode = event.currentTarget.value as "date" | "after"; setDateModes(modes => ({ ...modes, [field]: mode })); syncDirty(); }}><option value="date">on a date</option><option value="after">days after starting</option></select></Show></span>
      <Show when={dormant() && dateModes()[field] === "after"} fallback={input}><input name={`${field}After`} aria-label={`${label}: days after starting`} type="number" min="0" step="0.5" value={task?.relativeDates?.[field] ?? 0} /></Show>
    </div>;
  const dependents = () => props.items.filter((item): item is Task => item.kind === "task" && item.dependentOf === itemId).sort(bySortOrder);
  const parentTask = () => props.items.find((item): item is Task => item.kind === "task" && item.id === task?.dependentOf);
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
      <form ref={(element) => { formRef = element; }} onSubmit={(event) => { event.preventDefault(); void close(); }} onInput={syncDirty}>
        <div class="editor-close-bar"><button type="button" class="icon-button editor-close" classList={{ invalid: dirty() && !!(saveError() || invalid()) }} aria-label={dirty() && (saveError() || invalid()) ? "Close (reverts the unsaved changes)" : "Close"} title={dirty() && (saveError() || invalid()) ? `Can't save: ${saveError() || invalid()} — closing reverts` : "Close (Esc)"} onClick={() => void close()}>×</button></div>
        <Show when={closeBlocked() && dirty() && (saveError() || invalid())}>
          <div class="close-blocked" role="alert">
            <p><strong>Can't save this {kind()}:</strong> {saveError() || invalid()}</p>
            <div><button type="button" class="danger-button" onClick={() => void revert()}>Revert</button></div>
          </div>
        </Show>
        <Show when={(props.embedded && kind() === "task") || ancestors().length > 0} fallback={<p class="editor-eyebrow">{existing ? "The details" : props.request.parentId ? "New subtask" : "Make a little space for it"}</p>}>
          <nav class="detail-path" aria-label="Task path"><button type="button" class="text-button" onClick={close}>Tasks</button><For each={ancestors()}>{parent => <><span aria-hidden="true">›</span><button type="button" class="text-button" onClick={() => void navigateTask(parent)}>{parent.title || "Untitled task"}</button></>}</For></nav>
        </Show>
        <div class="dialog-header">
          <Show when={props.embedded && kind() === "task"}>{completionButton(true)}</Show>
          <label class="editor-title-field"><span class="visually-hidden" id={`editor-title-${domId}`}>Item title</span><input class="editor-title-input" name="title" aria-label="Item title" required maxLength={240} placeholder="Untitled item" value={props.liveEdits?.().get(itemId)?.title ?? existing?.title ?? ""} data-dialog-autofocus={true} /><span class="title-edit-hint" aria-hidden="true">✎</span></label>
        </div>

        <Show when={props.embedded && status()}><p class="detail-status">{status()}</p></Show>
        <Show when={dormant() && props.onStartDependent && task}>{own => <div class="dependent-start">{startButtons(own(), parentTask())}</div>}</Show>
        <div class="segmented kind-switch">
          <label><input type="radio" name="kind" value="task" checked={kind() === "task"} onChange={() => { setKind("task"); syncDirty(); }} /><span>Task</span></label>
          <label title="A set time to be somewhere: in the Agenda, and in List until it starts"><input type="radio" name="kind" value="event" checked={kind() === "event"} onChange={() => { setKind("event"); syncDirty(); }} /><span>Event</span></label>
          <label title="Noted at a time, nothing to do: on the Calendar and in search only"><input type="radio" name="kind" value="record" checked={kind() === "record"} onChange={() => { setKind("record"); syncDirty(); }} /><span>Record</span></label>
        </div>

        <Show when={kind() === "task"} fallback={
          <div class="form-grid">
            <div class="field"><span>Starts</span><DateTimeField name="eventStart" label="Starts" value={eventStart()} onChange={value => { deriveEnd(value); syncDirty(); }} /></div>
            <div class="field"><span>{kind() === "record" ? "Ends (optional)" : "Ends"}</span><DateTimeField name="eventEnd" label="Ends" value={eventEnd()} onChange={value => { deriveStart(value); syncDirty(); }} /></div>
          </div>
        }>
          <div>
            <div class="form-grid">
              <div class="task-completion full-span"><input type="hidden" name="taskState" value={taskState()} /><Show when={!props.embedded}>{completionButton(false)}</Show></div>
              {dateField("availableFrom", "Can start", <DateTimeField name="availableFrom" label="Can start" value={isoToLocalInput(task?.availableFrom)} onChange={syncDirty} />)}
              {dateField("deadline", "Due", <DateTimeField name="deadline" label="Due" value={isoToLocalInput(task?.deadline)} onChange={syncDirty} />)}
              <div class="field"><span class="field-label-row"><span>Window</span><Show when={props.onManageWindows}><button type="button" class="inline-link" onClick={() => props.onManageWindows?.()}>Manage</button></Show></span>
                <select name="windowId" aria-label="Window" value={windowChoice()} onChange={event => { setWindowChoice(event.currentTarget.value); syncDirty(); }}>
                  <option value="">Any time</option>
                  <For each={windowList().map(window => window.id)}>{id => { const window = () => windowList().find(entry => entry.id === id); const hours = () => window() ? describeSchedule(window()!) : ""; return <option value={id}>{window()?.title === hours() ? hours() : `${window()?.title} · ${hours()}`}</option>; }}</For>
                </select>
              </div>
              {/* One option: pushed down until the date if one is set, else until lifted. */}
              <div class="field"><label class="field-label-row field-check"><input type="checkbox" checked={pushed()} onChange={event => { setPushed(event.currentTarget.checked); syncDirty(); }} /><span>Suppress</span></label>
                <DateTimeField name="pushUntil" label="Suppressed until" placeholder="Until you unsuppress it" value={pushUntil} disabled={!pushed()} onChange={syncDirty} /></div>
              {/* Repeats: all controls always shown (disabled until it repeats) so nothing shifts. */}
              <div class="field full-span repeat-field"><span>Repeat</span>
                <div class="repeat-controls">
                  <select name="repeatUnit" aria-label="Repeats" value={repeatUnit()} onChange={event => { setRepeatUnit(event.currentTarget.value); syncDirty(); }}>
                    <option value="">Doesn't repeat</option><option value="day">Daily</option><option value="weekday">Weekdays</option><option value="week">Weekly</option><option value="month">Monthly</option>
                  </select>
                  <label class="repeat-every">every <input name="repeatEvery" type="number" min="1" step="1" aria-label="Repeat every" value={task?.repeat?.every ?? 1} disabled={!repeatUnit()} /></label>
                  <select name="repeatMissed" aria-label="If an occurrence is missed" title="What happens when an occurrence passes without being done" value={task?.repeat?.ifMissed ?? "skip"} disabled={!repeatUnit()}>
                    <option value="skip">If missed: skip it</option><option value="keep">If missed: keep until done</option>
                  </select>
                  <div class="repeat-until"><DateTimeField name="repeatUntil" label="Repeat until" placeholder="Repeats until…" value={isoToLocalInput(task?.repeat?.until)} disabled={!repeatUnit()} onChange={syncDirty} /></div>
                  <label class="field-check" title="Each time: Not yet (see it again next time) or It happened (finished for good)"><input type="checkbox" name="repeatUntilDone" checked={!!task?.repeat?.untilDone} disabled={!repeatUnit()} /> Check in until it happens</label>
                </div>
              </div>
              <Show when={dormant()}>
                <div class="field full-span repeat-field"><span>Starts</span>
                  <div class="repeat-controls">
                    <select aria-label="Starts" value={startWhen()} onChange={event => { setStartWhen(event.currentTarget.value); syncDirty(); }}>
                      <option value="">When I start it</option><option value="parent-done">When “{parentTask()?.title || "its parent"}” is done</option><option value="not-yet">On a “Not yet” for “{parentTask()?.title || "its parent"}”</option>
                    </select>
                    <div class="repeat-until"><DateTimeField name="startAfter" label="On or after" placeholder="On or after…" value={isoToLocalInput(task?.startWhen?.on === "not-yet" ? task.startWhen.after : null)} disabled={startWhen() !== "not-yet"} onChange={syncDirty} /></div>
                    <label class="field-check"><input type="checkbox" name="stopParent" checked={task?.stopParent !== false} disabled={startWhen() !== "not-yet"} /> Finish “{parentTask()?.title || "its parent"}” when this starts</label>
                  </div>
                </div>
              </Show>
            </div>
          </div>
        </Show>

        <div class="form-grid reminders-grid">
          <div class="field full-span remind-at-field"><span>Notify me at</span>
            <Index each={remindAts()}>{(value, index) => <div class="remind-at">
              <DateTimeField name="remindAt" label={`Notification ${index + 1}`} value={value()} onChange={next => { editNotices(list => list.map((entry, at) => at === index ? next : entry)); syncDirty(); }} />
              <button type="button" class="icon-button" aria-label={`Remove notification ${index + 1}`} onClick={() => { editNotices(list => list.filter((_, at) => at !== index)); queueMicrotask(syncDirty); }}>×</button>
            </div>}</Index>
            <button type="button" class="text-button remind-add" onClick={() => editNotices(list => [...list, ""])}>+ Add a notification</button>
          </div>
        </div>

        <section class="notes-editor" aria-label="Notes">
          <div class="notes-toolbar"><span>Notes</span></div>
          <NotesEditor ariaLabel="Notes" placeholder="Write notes…" initialMarkdown={props.liveEdits?.().get(itemId)?.notes ?? existing?.notes ?? ""} onChange={onNotesChange} onEditor={api => { notesApi = api; }}
            files={liveFiles} lit={litFile} onLight={setLitFile} onDownload={downloadById} />
          <textarea ref={notesRef} id={`item-notes-${domId}`} name="notes" hidden value={existing?.notes || ""} />
        </section>

        <div class="form-grid shared-item-fields">
          <label class="field full-span"><span>Tags</span><input name="tags" placeholder="project, errands" value={(existing?.tags || []).join(", ")} /></label>

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
                <button type="button" class="attachment-name" onClick={() => void download(attachment)} title="Download attachment">↓ {attachment.name}</button>
                <div class="attachment-actions"><button type="button" class="text-button" onClick={() => insertAttachmentLink(attachment)}>Link in notes</button><button type="button" class="text-button danger-text" aria-label={`Remove ${attachment.name}`} onClick={() => removeAttachment(attachment)}>Remove</button></div>
              </li>}</For>
              <For each={pendingFiles()}>{file => <li><span>{file.name} · waiting to save</span><button type="button" class="text-button" disabled={saving()} onClick={() => { setPendingFiles(files => files.filter(candidate => candidate !== file)); syncDirty(); }}>Remove</button></li>}</For>
            </ul>
            <small class="field-hint">Click a filename to download. Attachment changes can be undone.</small>
          </section>
          <Show when={kind() === "task"}>
              <div class="subtask-editor full-span"><div class="subtask-heading"><strong>Subtasks</strong><button type="button" class="text-button" hidden={props.embedded} disabled={!hasSavedItem() || !props.items.some(item => item.id === itemId)} title={hasSavedItem() ? "Add a child task" : "Name this task first"} onClick={() => void navigateTask()}>+ Add subtask</button></div><For each={children()}>{child => <div class="subtask-row" data-id={child.id}><span class="subtask-grip" title="Drag to reorder" aria-hidden="true" onPointerDown={startRowDrag(child)} /><button type="button" class="subtask-editor-link" onClick={() => void navigateTask(child)}><span aria-label={child.state === "completed" ? "Completed" : "Open"}>{child.state === "completed" ? "✓" : "○"}</span> {child.title || "Untitled task"}</button><Show when={props.onConvertChild && hasSavedItem()}><button type="button" class="text-button convert-button" title="Make this a dependent task: one that starts after this task" onClick={() => void props.onConvertChild!(child, "dependent")}>Make dependent</button></Show></div>}</For>
                <Show when={props.embedded && props.onQuickAddSubtask}><div class="subtask-quick-add"><span aria-hidden="true">+</span><input data-editor-ignore aria-label="New subtask title" placeholder={hasSavedItem() ? "Add a next step…" : "Name this task first"} disabled={!hasSavedItem()} maxLength={240} value={subtaskDraft()} onInput={event => setSubtaskDraft(event.currentTarget.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void addSubtaskInline(); } }} /><button type="button" class="text-button" disabled={!subtaskDraft().trim()} onClick={() => void addSubtaskInline()}>Add</button></div></Show>
                </div>
                <Show when={hasSavedItem() && props.onAddDependent}>
                   <div class="subtask-editor dependents-editor full-span"><div class="subtask-heading"><strong>Dependent tasks</strong></div>
                     <For each={dependents()}>{dependent => <div class="dependent-row" data-id={dependent.id}><span class="subtask-grip" title="Drag to reorder" aria-hidden="true" onPointerDown={startRowDrag(dependent)} /><button type="button" class="subtask-editor-link" onClick={() => void navigateTask(dependent)}><span aria-hidden="true">◌</span> {dependent.title || "Untitled task"}</button>{startButtons(dependent, currentItem?.kind === "task" ? currentItem : undefined)}<Show when={props.onConvertChild}><button type="button" class="text-button convert-button" title="Make this a subtask: part of this task" onClick={() => void props.onConvertChild!(dependent, "subtask")}>Make subtask</button></Show></div>}</For>
                    <div class="subtask-quick-add"><span aria-hidden="true">+</span><input data-editor-ignore aria-label="New dependent task title" placeholder="Add a dependent task…" maxLength={240} value={dependentDraft()} onInput={event => setDependentDraft(event.currentTarget.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void addDependentInline(); } }} /><button type="button" class="text-button" disabled={!dependentDraft().trim()} onClick={() => void addDependentInline()}>Add</button></div>
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
