<script lang="ts">
  import {
    isoToLocalInput,
    localInputToIso,
    sleepInfo,
    toDate,
    tomorrowMidnight,
  } from "../../site/domain.js";
  import DialogShell from "./DialogShell.svelte";
  import { toStorageValue } from "./persistence";
  import type { Attachment, Item, Task } from "./types";
  import type { EditorRequest } from "./editor-types";

  type Props = {
    request: EditorRequest;
    onClose: () => void;
    onDelete: (item: Item) => Promise<void>;
    onSave: (item: Item, created: boolean) => Promise<void>;
  };

  let { request, onClose, onDelete, onSave }: Props = $props();
  const existing = request.item;
  const task = existing?.kind === "task" ? existing : null;
  const storedEvent = existing?.kind === "event" ? existing : null;
  const initialSleep = task ? sleepInfo(task, new Date()) : { sleeping: false as const, indefinite: false as const, until: null };
  const defaults = eventDefaults(request);

  let kind = $state<"task" | "event">(request.kind);
  let scheduleEnabled = $state(!!task?.availabilitySchedule?.enabled);
  let sleepMode = $state<"awake" | "until" | "indefinite">(
    initialSleep.sleeping ? (initialSleep.indefinite ? "indefinite" : "until") : "awake",
  );
  let eventStart = $state(defaults.start);
  let eventEnd = $state(defaults.end);
  let pendingFiles = $state<File[]>([]);
  let draggingAttachments = $state(false);
  let dirty = $state(false);
  let form: HTMLFormElement;

  const schedule = task?.availabilitySchedule;
  const selectedDays = schedule?.enabled ? schedule.days : [1, 2, 3, 4, 5];
  const sleepUntil = initialSleep.sleeping && !initialSleep.indefinite
    ? isoToLocalInput(initialSleep.until)
    : isoToLocalInput(tomorrowMidnight(new Date()));
  const defaultAvailableFrom = !existing && request.date
    ? (() => {
        const date = new Date(request.date);
        date.setHours(9, 0, 0, 0);
        return localDateInput(date);
      })()
    : "";

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

  function eventDefaults(editorRequest: EditorRequest) {
    const stored = editorRequest.item?.kind === "event" ? editorRequest.item : null;
    if (stored) return { start: isoToLocalInput(stored.start), end: isoToLocalInput(stored.end) };
    const start = editorRequest.date ? new Date(editorRequest.date) : new Date();
    if (editorRequest.date) start.setHours(9, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { start: localDateInput(start), end: localDateInput(end) };
  }

  function close() {
    if (dirty && !window.confirm("Discard your unsaved changes?")) return;
    onClose();
  }

  function addFiles(files: File[]) {
    const seen = new Set(pendingFiles.map((file) => `${file.name}:${file.size}:${file.lastModified}`));
    pendingFiles = [...pendingFiles, ...files.filter((file) => !seen.has(`${file.name}:${file.size}:${file.lastModified}`))];
    dirty = true;
  }

  function deriveEnd(value: string) {
    eventStart = value;
    if (!value || eventEnd) return;
    const start = new Date(value);
    if (Number.isNaN(start.getTime())) return;
    start.setDate(start.getDate() + 1);
    eventEnd = localDateInput(start);
  }

  function deriveStart(value: string) {
    eventEnd = value;
    if (!value || eventStart) return;
    const end = new Date(value);
    if (Number.isNaN(end.getTime())) return;
    end.setDate(end.getDate() - 1);
    eventStart = localDateInput(end);
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    const data = new FormData(form);
    const title = String(data.get("title") || "").trim();
    if (!title) return;
    const now = new Date().toISOString();
    const attachments: Attachment[] = pendingFiles.map((file) => ({
      id: uuid(), name: file.name, type: file.type, size: file.size, blob: file,
    }));
    let item: Item;

    if (kind === "task") {
      const taskState = String(data.get("taskState") || "open") as Task["state"];
      const closed = ["completed", "canceled"].includes(taskState);
      let sleep: Task["sleep"] = null;
      if (!closed && sleepMode === "indefinite") {
        sleep = { until: null, startedAt: task?.sleep?.startedAt || now };
      } else if (!closed && sleepMode === "until") {
        const until = localInputToIso(data.get("sleepUntil"));
        if (until && toDate(until) > new Date()) sleep = { until, startedAt: task?.sleep?.startedAt || now };
      }
      const historyEntries = [...(task?.history || (task ? [] : [{ at: now, type: "created" }]))];
      if (task && JSON.stringify(task.sleep || null) !== JSON.stringify(sleep)) {
        historyEntries.push({ at: now, type: sleep ? "sleep-updated" : "woke", until: sleep?.until ?? null });
      }
      item = {
        ...(task || {}),
        id: existing?.id || uuid(),
        kind: "task",
        title,
        notes: String(data.get("notes") || "").trim(),
        state: taskState,
        tags: parseTags(data.get("tags")),
        attachments: [...(task?.attachments || []), ...attachments],
        availableFrom: localInputToIso(data.get("availableFrom")),
        deadline: localInputToIso(data.get("deadline")),
        latestStart: localInputToIso(data.get("latestStart")),
        sleep,
        availabilitySchedule: scheduleEnabled ? {
          enabled: true,
          days: data.getAll("scheduleDay").map(Number),
          start: String(data.get("scheduleStart") || "08:00"),
          end: String(data.get("scheduleEnd") || "17:00"),
        } : null,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
        history: historyEntries,
      };
    } else {
      let start = localInputToIso(eventStart);
      let end = localInputToIso(eventEnd);
      if (start && !end) {
        const derived = toDate(start);
        if (derived) { derived.setDate(derived.getDate() + 1); end = derived.toISOString(); }
      } else if (!start && end) {
        const derived = toDate(end);
        if (derived) { derived.setDate(derived.getDate() - 1); start = derived.toISOString(); }
      }
      item = {
        ...(storedEvent || {}),
        id: existing?.id || uuid(),
        kind: "event",
        title,
        notes: String(data.get("notes") || "").trim(),
        tags: parseTags(data.get("tags")),
        attachments: [...(storedEvent?.attachments || []), ...attachments],
        start,
        end,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      };
    }
    dirty = false;
    await onSave(toStorageValue(item), !existing);
  }
</script>

<DialogShell labelledBy="editor-title" onClose={close}>
  <form bind:this={form} onsubmit={save} oninput={() => dirty = true}>
    <div class="dialog-header">
      <h2 id="editor-title">{existing ? "Edit item" : "New item"}</h2>
      <button type="button" class="icon-button" aria-label="Close" onclick={close}>×</button>
    </div>

    <div class="segmented kind-switch">
      <label><input type="radio" name="kind" value="task" bind:group={kind} onchange={() => dirty = true} /><span>Task</span></label>
      <label><input type="radio" name="kind" value="event" bind:group={kind} onchange={() => dirty = true} /><span>Event</span></label>
    </div>

    <label class="field full"><span>Title</span><input name="title" required maxlength="240" value={existing?.title || ""} data-autofocus /></label>
    <label class="field full"><span>Notes</span><textarea name="notes" rows="4">{existing?.notes || ""}</textarea></label>

    <div class="form-grid shared-item-fields">
      <label class="field full-span"><span>Tags</span><input name="tags" placeholder="project, errands" value={(existing?.tags || []).join(", ")} /></label>
      <label class="field full-span">
        <span>Attachments</span>
        <div
          class={`attachment-drop-zone ${draggingAttachments ? "dragging" : ""}`}
          ondragenter={(event) => { event.preventDefault(); draggingAttachments = true; }}
          ondragover={(event) => { event.preventDefault(); draggingAttachments = true; }}
          ondragleave={() => draggingAttachments = false}
          ondrop={(event) => {
            event.preventDefault();
            draggingAttachments = false;
            addFiles([...(event.dataTransfer?.files || [])]);
          }}
        >
          <input type="file" multiple onchange={(event) => addFiles([...(event.currentTarget.files || [])])} />
          <small class="field-hint">
            {existing?.attachments?.length ? `Attached: ${existing.attachments.map((attachment) => attachment.name).join(", ")}. New files are added to these.` : "Drop files here or use Choose Files."}
          </small>
          {#if pendingFiles.length}<div class="pending-files">Adding: {pendingFiles.map((file) => file.name).join(", ")}</div>{/if}
        </div>
      </label>
    </div>

    {#if kind === "task"}
      <div>
        <div class="form-grid">
          <label class="field"><span>State</span><select name="taskState" value={task?.state || "open"}><option value="open">Open</option><option value="completed">Completed</option><option value="canceled">Canceled</option></select></label>
          <label class="field"><span>Can start</span><input name="availableFrom" type="datetime-local" value={isoToLocalInput(task?.availableFrom) || defaultAvailableFrom} /></label>
          <label class="field"><span>Due</span><input name="deadline" type="datetime-local" value={isoToLocalInput(task?.deadline)} /></label>
          <label class="field"><span>Latest start</span><input name="latestStart" type="datetime-local" value={isoToLocalInput(task?.latestStart)} /></label>
          <label class="field"><span>Sleep</span><select name="sleepMode" bind:value={sleepMode} onchange={() => dirty = true}><option value="awake">Awake</option><option value="until">Until a date</option><option value="indefinite">Indefinitely</option></select></label>
          <label class={`field ${sleepMode !== "until" ? "disabled" : ""}`}><span>Sleep until</span><input name="sleepUntil" type="datetime-local" value={sleepUntil} disabled={sleepMode !== "until"} /></label>
        </div>
        <div class="schedule-box">
          <label class="toggle-row">
            <input type="checkbox" name="scheduleEnabled" bind:checked={scheduleEnabled} onchange={() => dirty = true} />
            <span><strong>Recurring action window</strong><small>The same task becomes actionable during these times until you close it.</small></span>
          </label>
          <div class={`schedule-options ${!scheduleEnabled ? "disabled" : ""}`}>
            <div class="weekday-picks" aria-label="Action days">
              {#each [[0, "S"], [1, "M"], [2, "T"], [3, "W"], [4, "T"], [5, "F"], [6, "S"]] as [day, label]}
                <label><input type="checkbox" name="scheduleDay" value={day} checked={selectedDays.includes(Number(day))} disabled={!scheduleEnabled} /><span>{label}</span></label>
              {/each}
            </div>
            <div class="time-pair">
              <label class="field"><span>From</span><input name="scheduleStart" type="time" value={schedule?.start || "08:00"} disabled={!scheduleEnabled} /></label>
              <label class="field"><span>Until</span><input name="scheduleEnd" type="time" value={schedule?.end || "17:00"} disabled={!scheduleEnabled} /></label>
            </div>
          </div>
        </div>
      </div>
    {:else}
      <div class="form-grid">
        <label class="field"><span>Starts</span><input name="eventStart" type="datetime-local" bind:value={eventStart} oninput={(event) => deriveEnd(event.currentTarget.value)} required /></label>
        <label class="field"><span>Ends</span><input name="eventEnd" type="datetime-local" bind:value={eventEnd} oninput={(event) => deriveStart(event.currentTarget.value)} /></label>
      </div>
    {/if}

    <div class="dialog-actions">
      {#if existing}<button type="button" class="danger-button" onclick={() => void onDelete(existing)}>Delete</button>{/if}
      <div class="spacer"></div>
      <button type="button" class="secondary-button" onclick={close}>Cancel</button>
      <button type="submit" class="primary-button">Save</button>
    </div>
  </form>
</DialogShell>
