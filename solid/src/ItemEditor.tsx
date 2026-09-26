import { Icon } from "./Icon";
import { taskAncestors, taskDescendants } from "../../site/task-tree.js";
import { For, Show, createEffect, createMemo, createSignal, onMount, onCleanup, type JSX } from "solid-js";
import {
  actionability,
  formatDateTime,
  isoToLocalInput,
  localInputToIso,
  sleepInfo,
  sleepValidationMessage,
  toDate,
  tomorrowMidnight,
} from "../../site/domain.js";
import { MarkdownNotes } from "./MarkdownNotes";
import { DateTimeField } from "./DateTimeField";
import { groupOptions } from "./group-board";
import { RELATIVE_DATE_FIELDS, type RelativeDateField } from "./dependencies";
import { attachmentMarkdown } from "./markdown";
import { DialogShell } from "./DialogShell";
import { downloadAttachmentOnDemand } from "../../site/attachment-remote.js";
import type { Attachment, CalendarEvent, Item, Task } from "./types";
import type { RelativeDates } from "../../site/model";

export type EditorRequest = {
  item: Task | CalendarEvent | null;
  kind: "task" | "event";
  date?: Date;
  parentId?: string;
  groupId?: string | null;
  nonce: number;
};

let editorInstances = 0;

function uuid() {
  return crypto.randomUUID();
}

function localDateInput(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function parseTags(value: FormDataEntryValue | null) {
  return String(value || "").split(",").map((tag) => tag.trim()).filter(Boolean);
}

function eventDefaults(request: EditorRequest) {
  const existing = request.item?.kind === "event" ? request.item : null;
  if (existing) return { start: isoToLocalInput(existing.start), end: isoToLocalInput(existing.end) };

  const start = request.date ? new Date(request.date) : new Date();
  if (request.date) start.setHours(9, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start: localDateInput(start), end: localDateInput(end) };
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
}) {
  const existing = props.request.item;
  const domId = `${++editorInstances}`;
  let currentItem = existing;
  const [hasSavedItem, setHasSavedItem] = createSignal(!!existing);
  const itemId = existing?.id || uuid();
  const [removedAttachments, setRemovedAttachments] = createSignal(new Set<string>());
  const [notes, setNotes] = createSignal(existing?.notes || "");
  const [previewNotes, setPreviewNotes] = createSignal(false);
  const [taskState, setTaskState] = createSignal<Task["state"]>(existing?.kind === "task" ? existing.state : "open");
  let notesRef!: HTMLTextAreaElement;
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
  const storedEvent = existing?.kind === "event" ? existing : null;
  const initialSleep = task ? sleepInfo(task, new Date()) : null;
  const defaults = eventDefaults(props.request);
  const [kind, setKind] = createSignal<"task" | "event">(props.request.kind);
  const [scheduleEnabled, setScheduleEnabled] = createSignal(!!task?.availabilitySchedule?.enabled);
  const [deadlineInput, setDeadlineInput] = createSignal(isoToLocalInput(task?.deadline));
  const [sleepMode, setSleepMode] = createSignal<"awake" | "until" | "indefinite">(
    initialSleep?.sleeping ? (initialSleep.indefinite ? "indefinite" : "until") : "awake",
  );
  const [eventStart, setEventStart] = createSignal(defaults.start);
  const [eventEnd, setEventEnd] = createSignal(defaults.end);
  const [pendingFiles, setPendingFiles] = createSignal<File[]>([]);
  const [draggingAttachments, setDraggingAttachments] = createSignal(false);
  const [dirty, setDirty] = createSignal(false);
  let formRef!: HTMLFormElement;
  let baseline = "";
  let edited = false;

  const syncDirty = () => {
    edited = true;
    queueMicrotask(() => {
      setDirty(!!baseline && serializeForm(formRef, pendingFiles(), removedAttachments()) !== baseline);
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
    closing = true;
    clearTimeout(saveTimer);
    if (inFlight) await inFlight;
    while (dirty()) {
      if (!(await persist())) { closing = false; setCloseBlocked(true); return; }
    }
    props.onClose();
  };
  // Reverting skips the save that closing would otherwise require (the app flushes before switching tasks).
  let reverting = false;
  const revertAndClose = () => { reverting = closing = true; clearTimeout(saveTimer); props.onClose(); };
  onMount(() => { const unregister = props.registerClose?.(() => void close()); onCleanup(() => unregister?.()); });
  const beforeUnload = (event: BeforeUnloadEvent) => {
    if (dirty() || saving()) { event.preventDefault(); event.returnValue = ""; }
  };
  onMount(() => window.addEventListener("beforeunload", beforeUnload));
  onCleanup(() => {
    clearTimeout(saveTimer); window.removeEventListener("beforeunload", beforeUnload);
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
  // Reload when another view or device changes the item while this editor is idle.
  createEffect(() => {
    const stored = props.items.find(item => item.id === itemId);
    if (!props.onStale || !stored || !currentItem || dirty() || saving()) return;
    if (stored.updatedAt === currentItem.updatedAt) return;
    const active = document.activeElement;
    if (active && formRef?.contains(active) && active.matches("input, textarea, select")) return;
    props.onStale();
  });

  const addFiles = (files: File[]) => {
    setPendingFiles((current) => {
      const seen = new Set(current.map((file) => `${file.name}:${file.size}:${file.lastModified}`));
      return [...current, ...files.filter((file) => !seen.has(`${file.name}:${file.size}:${file.lastModified}`))];
    });
    syncDirty();
  };

  const deriveEnd = (value: string) => {
    setEventStart(value);
    if (!value || eventEnd()) return;
    const start = new Date(value);
    if (Number.isNaN(start.getTime())) return;
    start.setDate(start.getDate() + 1);
    setEventEnd(localDateInput(start));
  };

  const deriveStart = (value: string) => {
    setEventEnd(value);
    if (!value || eventStart()) return;
    const end = new Date(value);
    if (Number.isNaN(end.getTime())) return;
    end.setDate(end.getDate() - 1);
    setEventStart(localDateInput(end));
  };

  const saveOnce = async (): Promise<boolean> => {
    if (!dirty()) return true;
    if (!String(new FormData(formRef).get("title") || "").trim()) { setSaveError("Enter a title to save."); return false; }
    if (!formRef.checkValidity()) {
      const sleepInput = formRef.elements.namedItem("sleepUntil") as HTMLInputElement | null;
      setSaveError(sleepInput?.validity.rangeOverflow ? "Sleep must end on or before the task’s due date." : "Complete the required fields to save.");
      return false;
    }
    const submittedForm = serializeForm(formRef, pendingFiles(), removedAttachments());
    const submittedFiles = [...pendingFiles()];
    const submittedRemoved = new Set(removedAttachments());
    const task = currentItem?.kind === "task" ? currentItem : null;
    const storedEvent = currentItem?.kind === "event" ? currentItem : null;
    const data = new FormData(formRef);
    const title = String(data.get("title") || "").trim();
    if (!title) { setSaveError("Enter a title to save."); return false; }
    const now = new Date().toISOString();
    const attachments: Attachment[] = submittedFiles.map((file) => ({
      id: uuid(),
      name: file.name,
      type: file.type,
      size: file.size,
      blob: file,
    }));
    let item: Item;

    if (kind() === "task") {
      const nextState = taskState();
      const closed = nextState === "completed";
      let sleep = null;
      if (!closed && sleepMode() === "indefinite") {
        sleep = { until: null, startedAt: task?.sleep?.startedAt || now };
      } else if (!closed && sleepMode() === "until") {
        const until = localInputToIso(data.get("sleepUntil"));
        if (until && toDate(until) > new Date()) sleep = { until, startedAt: task?.sleep?.startedAt || now };
      }
      const historyEntries = [...(task?.history || [{ at: now, type: "created" }])];
      if (task && JSON.stringify(task.sleep || null) !== JSON.stringify(sleep)) {
        historyEntries.push({ at: now, type: sleep ? "sleep-updated" : "woke", until: sleep?.until ?? null });
      }
      if (task && task.state !== nextState) historyEntries.push({ at: now, type: nextState === "completed" ? "completed" : "reopened" });
      item = {
        ...(task || {}),
        id: itemId,
        kind: "task",
        title,
        notes: String(data.get("notes") || ""),
        state: nextState,
        parentId: task?.parentId || props.request.parentId || null,
        groupId: task?.parentId || props.request.parentId ? task?.groupId ?? null : String(data.get("groupId") || "") || null,
        completedAt: nextState === "completed" ? task?.completedAt || now : null,
        tags: parseTags(data.get("tags")),
        attachments: [...(currentItem?.attachments || []).filter(file => !submittedRemoved.has(file.id)), ...attachments],
        dependentOf: dormant() ? task!.dependentOf : null,
        relativeDates: dormant() ? (() => {
          const relative: RelativeDates = {};
          for (const field of RELATIVE_DATE_FIELDS) if (dateModes()[field] === "after") relative[field] = Math.max(0, Number(data.get(`${field}After`)) || 0);
          return Object.keys(relative).length ? relative : null;
        })() : null,
        availableFrom: localInputToIso(data.get("availableFrom")),
        deadline: localInputToIso(data.get("deadline")),
        latestStart: localInputToIso(data.get("latestStart")),
        sleep,
        availabilitySchedule: scheduleEnabled() ? {
          enabled: true,
          days: data.getAll("scheduleDay").map(Number),
          start: String(data.get("scheduleStart") || "08:00"),
          end: String(data.get("scheduleEnd") || "17:00"),
        } : null,
        createdAt: currentItem?.createdAt || now,
        updatedAt: now,
        history: historyEntries,
      };
    } else {
      if (!eventStart() && !eventEnd()) { setSaveError("Choose when the event starts."); return false; }
      let start = localInputToIso(eventStart());
      let end = localInputToIso(eventEnd());
      if (start && !end) {
        const derived = toDate(start);
        derived.setDate(derived.getDate() + 1);
        end = derived.toISOString();
      } else if (!start && end) {
        const derived = toDate(end);
        derived.setDate(derived.getDate() - 1);
        start = derived.toISOString();
      }
      item = {
        ...(storedEvent || {}),
        id: itemId,
        kind: "event",
        title,
        notes: String(data.get("notes") || ""),
        tags: parseTags(data.get("tags")),
        attachments: [...(currentItem?.attachments || []).filter(file => !submittedRemoved.has(file.id)), ...attachments],
        start,
        end,
        createdAt: currentItem?.createdAt || now,
        updatedAt: now,
      };
    }

    const sleepError = sleepValidationMessage(item);
    if (sleepError) { setSaveError(sleepError); return false; }
    try {
      const saved = await props.onSave(item, !currentItem, currentItem);
      if (!saved) throw new Error("This item was deleted on another device. Close and reopen the calendar to review it.");
      currentItem = saved as Task | CalendarEvent;
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
  const children = () => props.items.filter((item): item is Task => item.kind === "task" && item.parentId === itemId);
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
    if (children().length && !window.confirm(`Delete this task and all ${descendants().length} subtasks? You can undo this together.`)) return;
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

  const schedule = task?.availabilitySchedule;
  const selectedDays = schedule?.enabled ? schedule.days : [1, 2, 3, 4, 5];
  const sleepUntil = initialSleep?.sleeping && !initialSleep.indefinite
    ? isoToLocalInput(initialSleep.until)
    : isoToLocalInput(tomorrowMidnight(new Date()));
  const removeAttachment = (attachment: Attachment) => {
    setRemovedAttachments(current => new Set([...current, attachment.id]));
    syncDirty();
  };
  const insertAttachmentLink = (attachment: Attachment) => {
    const start = notesRef.selectionStart ?? notes().length;
    const end = notesRef.selectionEnd ?? start;
    const link = attachmentMarkdown(attachment.id, attachment.name);
    setNotes(value => value.slice(0, start) + link + value.slice(end));
    setPreviewNotes(false);
    queueMicrotask(() => { notesRef.focus(); notesRef.setSelectionRange(start + link.length, start + link.length); syncDirty(); });
  };
  const toggleCompleted = () => {
    setTaskState(state => state === "open" ? "completed" : "open");
    syncDirty();
  };

  // Options are keyed by id: rebuilding <option> elements would reset the select's choice.
  const groupChoices = createMemo(() => groupOptions(props.items));
  const groupLabel = (id: string) => { const option = groupChoices().find(choice => choice.group.id === id); return option ? `${"— ".repeat(option.depth)}${option.group.title}` : ""; };
  const ancestors = () => (taskAncestors(props.items, itemId) as Task[]).reverse();
  const status = () => {
    const stored = props.items.find(item => item.id === itemId);
    if (stored?.kind !== "task") return "";
    if (stored.state === "completed") return "Completed";
    if (dormant()) return `Dependent task of “${parentTask()?.title || "Untitled task"}” · not started`;
    const sleep = sleepInfo(stored, new Date());
    if (sleep.sleeping) return sleep.indefinite ? "Sleeping indefinitely" : `Sleeping until ${formatDateTime(sleep.until)}`;
    return actionability(stored, new Date()).reason;
  };
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
  const dependents = () => props.items.filter((item): item is Task => item.kind === "task" && item.dependentOf === itemId);
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
  const startButtons = (dependent: Task, parent?: Task) => <>
    <button type="button" class="text-button" onClick={() => void startDependent(dependent, false)}>Start</button>
    <Show when={parent && parent.state !== "completed"}><button type="button" class="text-button" title={`Start this and complete “${parent?.title || "Untitled task"}”`} onClick={() => void startDependent(dependent, true)}>Start & complete</button></Show>
  </>;

  const form = (
      <form ref={(element) => { formRef = element; }} onSubmit={(event) => { event.preventDefault(); void close(); }} onInput={syncDirty}>
        <div class="editor-close-bar"><button type="button" class="icon-button editor-close" classList={{ invalid: dirty() && !!saveError() }} aria-label={dirty() && saveError() ? "Close (this item can't be saved as is)" : "Close"} title={dirty() && saveError() ? `Can't save: ${saveError()}` : "Close (Esc)"} onClick={() => void close()}>×</button></div>
        <Show when={closeBlocked() && dirty() && saveError()}>
          <div class="close-blocked" role="alert">
            <p><strong>Can't save this {kind()}:</strong> {saveError()}</p>
            <p>Closing now reverts it to the last saved version.</p>
            <div><button type="button" class="secondary-button" onClick={() => setCloseBlocked(false)}>Keep editing</button><button type="button" class="danger-button" onClick={revertAndClose}>Revert & close</button></div>
          </div>
        </Show>
        <Show when={props.embedded} fallback={<p class="editor-eyebrow">{existing ? "The details" : props.request.parentId ? "New subtask" : "Make a little space for it"}</p>}>
          <nav class="detail-path" aria-label="Task path"><button type="button" class="text-button" onClick={close}>Tasks</button><For each={ancestors()}>{parent => <><span aria-hidden="true">›</span><button type="button" class="text-button" onClick={() => void navigateTask(parent)}>{parent.title || "Untitled task"}</button></>}</For></nav>
        </Show>
        <div class="dialog-header">
          <Show when={props.embedded && kind() === "task"}>{completionButton(true)}</Show>
          <label class="editor-title-field"><span class="visually-hidden" id={`editor-title-${domId}`}>Item title</span><input class="editor-title-input" name="title" aria-label="Item title" required maxLength={240} placeholder="Untitled item" value={existing?.title || ""} data-dialog-autofocus={true} /><span class="title-edit-hint" aria-hidden="true">✎</span></label>
        </div>

        <Show when={props.embedded && status()}><p class="detail-status">{status()}</p></Show>
        <Show when={dormant() && props.onStartDependent && task}>{own => <div class="dependent-start">{startButtons(own(), parentTask())}</div>}</Show>
        <div class="segmented kind-switch">
          <label><input type="radio" name="kind" value="task" checked={kind() === "task"} onChange={() => { setKind("task"); syncDirty(); }} /><span>Task</span></label>
          <label><input type="radio" name="kind" value="event" checked={kind() === "event"} onChange={() => { setKind("event"); syncDirty(); }} /><span>Event</span></label>
        </div>

        <Show when={kind() === "task"} fallback={
          <div class="form-grid">
            <div class="field"><span>Starts</span><DateTimeField name="eventStart" label="Starts" value={eventStart()} onChange={value => { deriveEnd(value); syncDirty(); }} /></div>
            <div class="field"><span>Ends</span><DateTimeField name="eventEnd" label="Ends" value={eventEnd()} onChange={value => { deriveStart(value); syncDirty(); }} /></div>
          </div>
        }>
          <div>
            <div class="form-grid">
              <div class="task-completion full-span"><input type="hidden" name="taskState" value={taskState()} /><Show when={!props.embedded}>{completionButton(false)}</Show></div>
              {dateField("availableFrom", "Can start", <DateTimeField name="availableFrom" label="Can start" value={isoToLocalInput(task?.availableFrom)} onChange={syncDirty} />)}
              {dateField("deadline", "Due", <DateTimeField name="deadline" label="Due" value={deadlineInput()} onChange={value => { setDeadlineInput(value); syncDirty(); }} />)}
              {dateField("latestStart", "Latest start", <DateTimeField name="latestStart" label="Latest start" value={isoToLocalInput(task?.latestStart)} onChange={syncDirty} />)}
              <Show when={!task?.parentId && !props.request.parentId}><label class="field"><span>Group</span><select name="groupId" value={task?.groupId || props.request.groupId || ""}><option value="">No group</option><For each={groupChoices().map(option => option.group.id)}>{id => <option value={id}>{groupLabel(id)}</option>}</For></select></label></Show>
              <label class="field"><span>Sleep</span><select name="sleepMode" value={sleepMode()} onChange={(event) => { setSleepMode(event.currentTarget.value as ReturnType<typeof sleepMode>); syncDirty(); }}><option value="awake">Awake</option><option value="until">Until a date</option><option value="indefinite" disabled={!!deadlineInput()}>Indefinitely</option></select></label>
              <div class="field" hidden={sleepMode() !== "until"}><span>Sleep until</span><DateTimeField name="sleepUntil" label="Sleep until" value={sleepUntil} disabled={sleepMode() !== "until"} onChange={syncDirty} /></div>
            </div>
            <details class="schedule-box" open={!!task?.availabilitySchedule?.enabled}><summary><Icon name="clock" size={16} />Working hours<span>Optional</span></summary>
              <label class="toggle-row">
                <input type="checkbox" name="scheduleEnabled" checked={scheduleEnabled()} onChange={(event) => { setScheduleEnabled(event.currentTarget.checked); syncDirty(); }} />
                <span><strong>Recurring action window</strong><small>The same task becomes actionable during these times until you close it.</small></span>
              </label>
              <div class={`schedule-options ${scheduleEnabled() ? "" : "disabled"}`}>
                <div class="weekday-picks" aria-label="Action days">
                  <For each={["S", "M", "T", "W", "T", "F", "S"]}>{(name, day) => <label><input type="checkbox" name="scheduleDay" value={day()} checked={selectedDays.includes(day())} disabled={!scheduleEnabled()} /><span>{name}</span></label>}</For>
                </div>
                <div class="time-pair">
                  <label class="field"><span>From</span><input name="scheduleStart" type="time" value={schedule?.start || "08:00"} disabled={!scheduleEnabled()} /></label>
                  <label class="field"><span>Until</span><input name="scheduleEnd" type="time" value={schedule?.end || "17:00"} disabled={!scheduleEnabled()} /></label>
                </div>
              </div>
            </details>
          </div>
        </Show>

        <section class="notes-editor" aria-label="Notes">
          <div class="notes-toolbar"><label for={`item-notes-${domId}`}>Notes</label><button type="button" class="text-button" aria-pressed={previewNotes()} onClick={() => setPreviewNotes(value => !value)}>{previewNotes() ? "Write" : "Preview"}</button></div>
          <textarea ref={notesRef} id={`item-notes-${domId}`} name="notes" rows={5} hidden={previewNotes()} value={notes()} onInput={event => setNotes(event.currentTarget.value)} placeholder="Write notes… Markdown supported" />
          <Show when={previewNotes()}><MarkdownNotes text={notes() || "*No notes yet.*"} attachments={savedAttachments().filter(file => !removedAttachments().has(file.id))} onDownload={file => void download(file)} onError={props.onError} /></Show>
          <small class="field-hint">Markdown supported. Add download links using “Link in notes” below.</small>
        </section>

        <div class="form-grid shared-item-fields">
          <label class="field full-span"><span>Tags</span><input name="tags" placeholder="project, errands" value={(existing?.tags || []).join(", ")} /></label>

        </div>


          <Show when={kind() === "task"}>
              <div class="subtask-editor full-span"><div class="subtask-heading"><strong>Subtasks</strong><button type="button" class="text-button" hidden={props.embedded} disabled={!hasSavedItem() || !props.items.some(item => item.id === itemId)} title={hasSavedItem() ? "Add a child task" : "Name this task first"} onClick={() => void navigateTask()}>+ Add subtask</button></div><For each={children()}>{child => <button type="button" class="subtask-editor-link" onClick={() => void navigateTask(child)}><span aria-label={child.state === "completed" ? "Completed" : "Open"}>{child.state === "completed" ? "✓" : "○"}</span> {child.title || "Untitled task"}</button>}</For>
                <Show when={props.embedded && props.onQuickAddSubtask}><div class="subtask-quick-add"><span aria-hidden="true">+</span><input data-editor-ignore aria-label="New subtask title" placeholder={hasSavedItem() ? "Add a next step…" : "Name this task first"} disabled={!hasSavedItem()} maxLength={240} value={subtaskDraft()} onInput={event => setSubtaskDraft(event.currentTarget.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void addSubtaskInline(); } }} /><button type="button" class="text-button" disabled={!subtaskDraft().trim()} onClick={() => void addSubtaskInline()}>Add</button></div></Show>
                <small class="muted">Completed together. Each subtask can have its own dates and notes.</small></div>
                <Show when={hasSavedItem() && props.onAddDependent}>
                  <div class="subtask-editor dependents-editor full-span"><div class="subtask-heading"><strong>Dependent tasks</strong></div>
                    <For each={dependents()}>{dependent => <div class="dependent-row"><button type="button" class="subtask-editor-link" onClick={() => void navigateTask(dependent)}><span aria-hidden="true">◌</span> {dependent.title || "Untitled task"}</button>{startButtons(dependent, currentItem?.kind === "task" ? currentItem : undefined)}</div>}</For>
                    <div class="subtask-quick-add"><span aria-hidden="true">+</span><input data-editor-ignore aria-label="New dependent task title" placeholder="Add a dependent task…" maxLength={240} value={dependentDraft()} onInput={event => setDependentDraft(event.currentTarget.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void addDependentInline(); } }} /><button type="button" class="text-button" disabled={!dependentDraft().trim()} onClick={() => void addDependentInline()}>Add</button></div>
                    <small class="muted">Prepared next steps, hidden until you start one. Starting makes it a normal task with its dates set from that moment.</small>
                  </div>
                </Show>
          </Show>
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
              <For each={savedAttachments().filter(file => !removedAttachments().has(file.id))}>{attachment => <li>
                <button type="button" class="attachment-name" onClick={() => void download(attachment)} title="Download attachment">↓ {attachment.name}</button>
                <div class="attachment-actions"><button type="button" class="text-button" onClick={() => insertAttachmentLink(attachment)}>Link in notes</button><button type="button" class="text-button danger-text" aria-label={`Remove ${attachment.name}`} onClick={() => removeAttachment(attachment)}>Remove</button></div>
              </li>}</For>
              <For each={pendingFiles()}>{file => <li><span>{file.name} · waiting to save</span><button type="button" class="text-button" disabled={saving()} onClick={() => { setPendingFiles(files => files.filter(candidate => candidate !== file)); syncDirty(); }}>Remove</button></li>}</For>
            </ul>
            <small class="field-hint">Click a filename to download. Attachment changes can be undone.</small>
          </section>

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

export function SleepDialog(props: {
  task: Task;
  onClose: () => void;
  onSave: (until: string | null) => Promise<void>;
  onInvalid: () => void;
}) {
  const sleep = sleepInfo(props.task, new Date());
  const initialValue = sleep.sleeping && !sleep.indefinite
    ? isoToLocalInput(sleep.until)
    : isoToLocalInput(tomorrowMidnight(new Date()));
  const [value, setValue] = createSignal(initialValue);
  const title = String(props.task.title || "").replace(/[\p{Cf}\p{Cc}\s]/gu, "") ? props.task.title : "Untitled task";

  const close = () => {
    if (value() !== initialValue && !window.confirm("Discard your unsaved changes?")) return;
    props.onClose();
  };

  return (
    <DialogShell labelledBy="sleep-title" className="sleep-dialog" onClose={close}>
      <form onSubmit={(event) => {
        event.preventDefault();
        const until = localInputToIso(value());
        if (!until || toDate(until) <= new Date()) {
          props.onInvalid();
          return;
        }
        void props.onSave(until);
      }}>
        <div class="dialog-header">
          <div><h2 id="sleep-title">Sleep task</h2><p class="muted">{title}</p></div>
          <button type="button" class="icon-button" aria-label="Close" onClick={close}>×</button>
        </div>
        <div class="sleep-presets"><button type="button" class="secondary-button" disabled={!!props.task.deadline && tomorrowMidnight(new Date()) > toDate(props.task.deadline)!} onClick={() => void props.onSave(tomorrowMidnight(new Date()).toISOString())}><Icon name="sun" size={16} />Until tomorrow</button><button type="button" class="secondary-button" disabled={!!props.task.deadline} onClick={() => void props.onSave(null)}><Icon name="moon" size={16} />Indefinitely</button></div>
        <Show when={props.task.deadline}><p class="field-hint">Sleep must end by {formatDateTime(props.task.deadline)}. Indefinite sleep is unavailable while this task has a due date.</p></Show>
        <label class="field full"><span>Or choose a date</span><input type="datetime-local" max={isoToLocalInput(props.task.deadline) || undefined} required value={value()} onInput={(event) => setValue(event.currentTarget.value)} data-dialog-autofocus={true} /></label>
        <div class="dialog-actions">
          <div class="spacer" />
          <button type="button" class="secondary-button" onClick={close}>Cancel</button>
          <button type="submit" class="primary-button">Sleep until</button>
        </div>
      </form>
    </DialogShell>
  );
}
