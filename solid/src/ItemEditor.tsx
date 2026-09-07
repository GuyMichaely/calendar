import { For, Show, createMemo, createSignal, onMount, onCleanup } from "solid-js";
import {
  isoToLocalInput,
  localInputToIso,
  sleepInfo,
  toDate,
  tomorrowMidnight,
} from "../../site/domain.js";
import { DialogShell } from "./DialogShell";
import { downloadAttachmentOnDemand } from "../../site/attachment-remote.js";
import type { Attachment, Item, Task } from "./types";

export type EditorRequest = {
  item: Item | null;
  kind: "task" | "event";
  date?: Date;
  nonce: number;
};

function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
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

function serializeForm(form: HTMLFormElement, files: File[]) {
  return JSON.stringify({
    controls: [...form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input, textarea, select")].map((control, index) => ({
      key: control.name || control.id || String(index),
      type: control instanceof HTMLInputElement ? control.type : control.tagName.toLowerCase(),
      value: control instanceof HTMLInputElement && control.type === "file"
        ? [...(control.files || [])].map((file) => [file.name, file.size, file.lastModified])
        : control.value,
      checked: control instanceof HTMLInputElement ? control.checked : undefined,
    })),
    pendingFiles: files.map((file) => [file.name, file.size, file.lastModified]),
  });
}

export function ItemEditor(props: {
  request: EditorRequest;
  onClose: () => void;
  onDelete: (item: Item) => Promise<void>;
  onSave: (item: Item, created: boolean, baseline: Item | null) => Promise<Item>;
  onError?: (message: string) => void;
}) {
  const existing = props.request.item;
  let currentItem = existing;
  const [hasSavedItem, setHasSavedItem] = createSignal(!!existing);
  const itemId = existing?.id || uuid();
  const [saving, setSaving] = createSignal(false);
  const [saveError, setSaveError] = createSignal("");
  const [savedAttachments, setSavedAttachments] = createSignal(existing?.attachments || []);
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<boolean> | null = null;
  let closing = false;
  const task = existing?.kind === "task" ? existing : null;
  const storedEvent = existing?.kind === "event" ? existing : null;
  const initialSleep = task ? sleepInfo(task, new Date()) : null;
  const defaults = eventDefaults(props.request);
  const [kind, setKind] = createSignal<"task" | "event">(props.request.kind);
  const [scheduleEnabled, setScheduleEnabled] = createSignal(!!task?.availabilitySchedule?.enabled);
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

  const syncDirty = () => {
    queueMicrotask(() => {
      setDirty(!!baseline && serializeForm(formRef, pendingFiles()) !== baseline);
      clearTimeout(saveTimer);
      if (dirty() && !closing) saveTimer = setTimeout(() => { void persist(); }, 800);
    });
  };

  onMount(() => {
    requestAnimationFrame(() => {
      baseline = serializeForm(formRef, pendingFiles());
      setDirty(false);
    });
  });

  const close = async () => {
    closing = true;
    clearTimeout(saveTimer);
    if (inFlight) await inFlight;
    while (dirty()) {
      if (!(await persist())) { closing = false; return; }
    }
    props.onClose();
  };
  const beforeUnload = (event: BeforeUnloadEvent) => {
    if (dirty() || saving()) { event.preventDefault(); event.returnValue = ""; }
  };
  onMount(() => window.addEventListener("beforeunload", beforeUnload));
  onCleanup(() => { clearTimeout(saveTimer); window.removeEventListener("beforeunload", beforeUnload); });

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
    if (!formRef.checkValidity()) {
      setSaveError("Complete the required fields to save.");
      return false;
    }
    const submittedForm = serializeForm(formRef, pendingFiles());
    const submittedFiles = [...pendingFiles()];
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
      const taskState = String(data.get("taskState") || "open") as Task["state"];
      const closed = ["completed", "canceled"].includes(taskState);
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
      item = {
        ...(task || {}),
        id: itemId,
        kind: "task",
        title,
        notes: String(data.get("notes") || ""),
        state: taskState,
        tags: parseTags(data.get("tags")),
        attachments: [...(currentItem?.attachments || []), ...attachments],
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
        attachments: [...(currentItem?.attachments || []), ...attachments],
        start,
        end,
        createdAt: currentItem?.createdAt || now,
        updatedAt: now,
      };
    }

    try {
      const saved = await props.onSave(item, !currentItem, currentItem);
      if (!saved) throw new Error("This item was deleted on another device. Close and reopen the calendar to review it.");
      currentItem = saved;
      setHasSavedItem(true);
      setSavedAttachments(currentItem.attachments || []);
      const unchanged = serializeForm(formRef, pendingFiles()) === submittedForm;
      setPendingFiles((files) => files.filter((file) => !submittedFiles.includes(file)));
      if (unchanged) {
        baseline = serializeForm(formRef, pendingFiles());
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

  const schedule = task?.availabilitySchedule;
  const selectedDays = schedule?.enabled ? schedule.days : [1, 2, 3, 4, 5];
  const sleepUntil = initialSleep?.sleeping && !initialSleep.indefinite
    ? isoToLocalInput(initialSleep.until)
    : isoToLocalInput(tomorrowMidnight(new Date()));
  const attachedNames = createMemo(() => existing?.attachments?.map((attachment) => attachment.name).join(", ") || "");
  const attachmentHint = createMemo(() => attachedNames()
    ? `Attached: ${attachedNames()}. New files are added to these.`
    : "Attachment files are stored on the sync server and downloaded on demand.");

  return (
    <DialogShell labelledBy="editor-title" onClose={close}>
      <form ref={(element) => { formRef = element; }} onSubmit={(event) => { event.preventDefault(); void close(); }} onInput={syncDirty}>
        <div class="dialog-header">
          <h2 id="editor-title">{existing ? "Edit item" : "New item"}</h2>
          <button type="button" class="icon-button" aria-label="Close" onClick={close}>×</button>
        </div>

        <div class="segmented kind-switch">
          <label><input type="radio" name="kind" value="task" checked={kind() === "task"} onChange={() => { setKind("task"); syncDirty(); }} /><span>Task</span></label>
          <label><input type="radio" name="kind" value="event" checked={kind() === "event"} onChange={() => { setKind("event"); syncDirty(); }} /><span>Event</span></label>
        </div>

        <label class="field full"><span>Title</span><input name="title" required maxLength={240} value={existing?.title || ""} autofocus /></label>
        <label class="field full"><span>Notes</span><textarea name="notes" rows={4}>{existing?.notes || ""}</textarea></label>

        <div class="form-grid shared-item-fields">
          <label class="field full-span"><span>Tags</span><input name="tags" placeholder="project, errands" value={(existing?.tags || []).join(", ")} /></label>
          <label class="field full-span">
            <span>Attachments</span>
            <div
              class={`attachment-drop-zone ${draggingAttachments() ? "dragging" : ""}`}
              onDragEnter={(event) => { event.preventDefault(); setDraggingAttachments(true); }}
              onDragOver={(event) => { event.preventDefault(); setDraggingAttachments(true); }}
              onDragLeave={() => setDraggingAttachments(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDraggingAttachments(false);
                addFiles([...(event.dataTransfer?.files || [])]);
              }}
            >
              <input type="file" multiple onChange={(event) => addFiles([...(event.currentTarget.files || [])])} />
              <small class="field-hint">{attachmentHint()}</small>
              <Show when={pendingFiles().length}><div class="pending-files">Adding: {pendingFiles().map((file) => file.name).join(", ")}</div></Show>
            </div>
          </label>
        </div>

        <div class="attachment-downloads"><For each={savedAttachments()}>{(attachment) => <button type="button" class="secondary-button" onClick={() => void download(attachment)}>Download {attachment.name}</button>}</For></div>

        <Show when={kind() === "task"} fallback={
          <div class="form-grid">
            <label class="field"><span>Starts</span><input name="eventStart" type="datetime-local" required value={eventStart()} onInput={(event) => { deriveEnd(event.currentTarget.value); syncDirty(); }} /></label>
            <label class="field"><span>Ends</span><input name="eventEnd" type="datetime-local" value={eventEnd()} onInput={(event) => { deriveStart(event.currentTarget.value); syncDirty(); }} /></label>
          </div>
        }>
          <div>
            <div class="form-grid">
              <label class="field"><span>State</span><select name="taskState" value={task?.state || "open"}><option value="open">Open</option><option value="completed">Completed</option><option value="canceled">Canceled</option></select></label>
              <label class="field"><span>Can start</span><input name="availableFrom" type="datetime-local" value={isoToLocalInput(task?.availableFrom)} /></label>
              <label class="field"><span>Due</span><input name="deadline" type="datetime-local" value={isoToLocalInput(task?.deadline)} /></label>
              <label class="field"><span>Latest start</span><input name="latestStart" type="datetime-local" value={isoToLocalInput(task?.latestStart)} /></label>
              <label class="field"><span>Sleep</span><select name="sleepMode" value={sleepMode()} onChange={(event) => { setSleepMode(event.currentTarget.value as ReturnType<typeof sleepMode>); syncDirty(); }}><option value="awake">Awake</option><option value="until">Until a date</option><option value="indefinite">Indefinitely</option></select></label>
              <label class={`field ${sleepMode() !== "until" ? "disabled" : ""}`}><span>Sleep until</span><input name="sleepUntil" type="datetime-local" value={sleepUntil} disabled={sleepMode() !== "until"} /></label>
            </div>
            <div class="schedule-box">
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
            </div>
          </div>
        </Show>

        <div class="dialog-actions">
          <Show when={hasSavedItem()}><button type="button" class="danger-button" disabled={saving()} onClick={() => void deleteCurrent()}>Delete</button></Show>
          <span role="status">{saving() ? "Saving…" : saveError() || (dirty() ? "Unsaved changes" : "Saved on this device")}</span>
          <div class="spacer" />
          <Show when={dirty() && saveError()}><button type="button" class="secondary-button" disabled={saving()} onClick={() => { if (window.confirm("Discard your unsaved changes?")) { closing = true; clearTimeout(saveTimer); props.onClose(); } }}>Discard unsaved changes</button></Show>
          <button type="submit" class="primary-button">Done</button>
        </div>
      </form>
    </DialogShell>
  );
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
        <label class="field full"><span>Sleep until</span><input type="datetime-local" required value={value()} onInput={(event) => setValue(event.currentTarget.value)} autofocus /></label>
        <div class="dialog-actions">
          <button type="button" class="secondary-button" onClick={() => void props.onSave(null)}>Sleep indefinitely</button>
          <div class="spacer" />
          <button type="button" class="secondary-button" onClick={close}>Cancel</button>
          <button type="submit" class="primary-button">Sleep until</button>
        </div>
      </form>
    </DialogShell>
  );
}
