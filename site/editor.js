import {
  formatDateTime,
  isoToLocalInput,
  localInputToIso,
  sleepInfo,
  toDate,
  tomorrowMidnight,
} from "./domain.js";
import { deleteItem, putItem } from "./storage.js";
import { localDateInput, parseTags, uuid } from "./ui.js";

function serializeForm(form) {
  return JSON.stringify(
    [...form.querySelectorAll("input, textarea, select")].map((control, index) => ({
      key: control.name || control.id || String(index),
      type: control.type,
      value: control.type === "file"
        ? [...(control.files || [])].map((file) => [file.name, file.size, file.lastModified])
        : control.value,
      checked: "checked" in control ? control.checked : undefined,
    })),
  );
}

function outsideRect(dialog, event) {
  const rect = dialog.getBoundingClientRect();
  return event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
}

function mergeFiles(input, incoming) {
  if (!input || !incoming?.length) return;
  const transfer = new DataTransfer();
  const seen = new Set();
  for (const file of [...(input.files || []), ...incoming]) {
    const key = `${file.name}:${file.size}:${file.lastModified}`;
    if (seen.has(key)) continue;
    seen.add(key);
    transfer.items.add(file);
  }
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function attachmentRecords(files) {
  return [...(files || [])].map((file) => ({
    id: uuid(),
    name: file.name,
    type: file.type,
    size: file.size,
    blob: file,
  }));
}

export function createEditor({ getItem, onChanged, showToast }) {
  const dialog = document.querySelector("#editor-dialog");
  const form = document.querySelector("#editor-form");
  const dialogTitle = document.querySelector("#dialog-title");
  const deleteButton = document.querySelector("#delete-item");
  const kindTask = document.querySelector("#kind-task");
  const kindEvent = document.querySelector("#kind-event");
  const taskFields = document.querySelector("#task-fields");
  const eventFields = document.querySelector("#event-fields");
  const sleepUntilField = document.querySelector("#sleep-until-field");
  const scheduleOptions = document.querySelector("#schedule-options");
  const existingAttachments = document.querySelector("#existing-attachments");
  const dropZone = document.querySelector("[data-attachment-drop-zone]");

  const sleepDialog = document.querySelector("#sleep-dialog");
  const sleepForm = document.querySelector("#sleep-form");
  const sleepTaskTitle = document.querySelector("#sleep-task-title");
  const quickSleepUntil = document.querySelector("#quick-sleep-until");
  const sleepIndefiniteButton = document.querySelector("#sleep-indefinite");

  let editingId = null;
  let sleepEditingId = null;
  let baseline = "";

  function setBaseline() {
    requestAnimationFrame(() => {
      baseline = serializeForm(form);
    });
  }

  function isDirty() {
    return !!baseline && serializeForm(form) !== baseline;
  }

  function confirmClose() {
    return !isDirty() || window.confirm("Discard your unsaved changes?");
  }

  function syncKindFields() {
    const taskActive = kindTask.checked;
    taskFields.hidden = !taskActive;
    eventFields.hidden = taskActive;
    eventFields.querySelectorAll("input, select, textarea, button").forEach((control) => {
      control.disabled = taskActive;
    });
    form.elements.eventStart.required = !taskActive;
  }

  function syncScheduleFields() {
    const enabled = form.elements.scheduleEnabled.checked;
    scheduleOptions.classList.toggle("disabled", !enabled);
    scheduleOptions.querySelectorAll("input").forEach((input) => {
      input.disabled = !enabled;
    });
  }

  function syncSleepFields() {
    const enabled = form.elements.sleepMode.value === "until";
    sleepUntilField.classList.toggle("disabled", !enabled);
    form.elements.sleepUntil.disabled = !enabled;
  }

  function fillEventCounterpart(changed) {
    const start = form.elements.eventStart;
    const end = form.elements.eventEnd;
    if (changed === "start" && start.value && !end.value) {
      const date = new Date(start.value);
      if (!Number.isNaN(date.getTime())) {
        date.setDate(date.getDate() + 1);
        end.value = localDateInput(date);
      }
    } else if (changed === "end" && end.value && !start.value) {
      const date = new Date(end.value);
      if (!Number.isNaN(date.getTime())) {
        date.setDate(date.getDate() - 1);
        start.value = localDateInput(date);
      }
    }
  }

  function sleepFromForm(existing, closed, now) {
    if (closed) return null;
    const mode = form.elements.sleepMode.value;
    if (mode === "indefinite") return { until: null, startedAt: existing?.sleep?.startedAt || now };
    if (mode === "until") {
      const until = localInputToIso(form.elements.sleepUntil.value);
      if (until && toDate(until) > new Date()) return { until, startedAt: existing?.sleep?.startedAt || now };
    }
    return null;
  }

  function populateAttachments(item) {
    const names = (item?.attachments || []).map((attachment) => attachment.name).filter(Boolean);
    existingAttachments.textContent = names.length
      ? `Attached: ${names.join(", ")}. New files are added to these.`
      : "Drop files here or use Choose Files.";
  }

  function open(item = null, defaultKind = "task", options = {}) {
    editingId = item?.id || null;
    form.reset();
    deleteButton.hidden = !item;
    dialogTitle.textContent = item ? "Edit item" : "New item";

    const kind = item?.kind || defaultKind;
    kindTask.checked = kind === "task";
    kindEvent.checked = kind === "event";
    syncKindFields();

    form.elements.title.value = item?.title || "";
    form.elements.notes.value = item?.notes || "";
    form.elements.tags.value = (item?.tags || []).join(", ");
    populateAttachments(item);

    if (kind === "task") {
      form.elements.taskState.value = ["completed", "canceled"].includes(item?.state) ? item.state : "open";
      form.elements.availableFrom.value = isoToLocalInput(item?.availableFrom);
      form.elements.deadline.value = isoToLocalInput(item?.deadline);
      form.elements.latestStart.value = isoToLocalInput(item?.latestStart);

      const sleep = sleepInfo(item, new Date());
      form.elements.sleepMode.value = sleep.sleeping ? (sleep.indefinite ? "indefinite" : "until") : "awake";
      form.elements.sleepUntil.value = sleep.sleeping && !sleep.indefinite
        ? isoToLocalInput(sleep.until)
        : isoToLocalInput(tomorrowMidnight(new Date()));
      syncSleepFields();

      const schedule = item?.availabilitySchedule;
      form.elements.scheduleEnabled.checked = !!schedule?.enabled;
      form.elements.scheduleStart.value = schedule?.start || "08:00";
      form.elements.scheduleEnd.value = schedule?.end || "17:00";
      document.querySelectorAll("[name='scheduleDay']").forEach((input) => {
        input.checked = schedule?.enabled
          ? (schedule.days || []).includes(Number(input.value))
          : [1, 2, 3, 4, 5].includes(Number(input.value));
      });
      syncScheduleFields();
    } else {
      const defaultStart = options.eventDay ? new Date(options.eventDay) : new Date();
      if (options.eventDay) defaultStart.setHours(9, 0, 0, 0);
      form.elements.eventStart.value = isoToLocalInput(item?.start) || localDateInput(defaultStart);
      form.elements.eventEnd.value = isoToLocalInput(item?.end);
      if (!item && options.eventDay) fillEventCounterpart("start");
    }

    dialog.showModal();
    setBaseline();
    requestAnimationFrame(() => form.elements.title.focus());
  }

  async function save(event) {
    event.preventDefault();
    const data = new FormData(form);
    const existing = editingId ? getItem(editingId) : null;
    const kind = String(data.get("kind") || "task");
    const title = String(data.get("title") || "").trim();
    if (!title) return;
    const now = new Date().toISOString();
    const newAttachments = attachmentRecords(form.elements.attachments.files);

    let item;
    if (kind === "task") {
      const taskState = String(data.get("taskState") || "open");
      const closed = ["completed", "canceled"].includes(taskState);
      const currentTask = existing?.kind === "task" ? existing : null;
      const sleep = sleepFromForm(currentTask, closed, now);
      const history = [...(currentTask?.history || [{ at: now, type: "created" }])];
      const oldSleep = currentTask?.sleep || null;
      if (JSON.stringify(oldSleep) !== JSON.stringify(sleep)) {
        history.push({ at: now, type: sleep ? "sleep-updated" : "woke", until: sleep?.until ?? null });
      }

      item = {
        ...(currentTask || {}),
        id: existing?.id || uuid(),
        kind: "task",
        title,
        notes: String(data.get("notes") || "").trim(),
        state: taskState,
        tags: parseTags(data.get("tags")),
        attachments: [...(currentTask?.attachments || []), ...newAttachments],
        availableFrom: localInputToIso(data.get("availableFrom")),
        deadline: localInputToIso(data.get("deadline")),
        latestStart: localInputToIso(data.get("latestStart")),
        sleep,
        availabilitySchedule: data.get("scheduleEnabled") === "on"
          ? {
              enabled: true,
              days: data.getAll("scheduleDay").map(Number),
              start: String(data.get("scheduleStart") || "08:00"),
              end: String(data.get("scheduleEnd") || "17:00"),
            }
          : null,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
        history,
      };
    } else {
      fillEventCounterpart(form.elements.eventStart.value ? "start" : "end");
      const currentEvent = existing?.kind === "event" ? existing : null;
      item = {
        ...(currentEvent || {}),
        id: existing?.id || uuid(),
        kind: "event",
        title,
        notes: String(data.get("notes") || "").trim(),
        tags: parseTags(data.get("tags")),
        attachments: [...(currentEvent?.attachments || []), ...newAttachments],
        start: localInputToIso(form.elements.eventStart.value),
        end: localInputToIso(form.elements.eventEnd.value),
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      };
    }

    await putItem(item);
    baseline = serializeForm(form);
    dialog.close();
    editingId = null;
    await onChanged();
    showToast(existing ? "Saved" : `${kind === "task" ? "Task" : "Event"} created`);
  }

  async function remove() {
    if (!editingId) return;
    await deleteItem(editingId);
    baseline = serializeForm(form);
    dialog.close();
    editingId = null;
    await onChanged();
    showToast("Deleted");
  }

  function openSleep(item) {
    sleepEditingId = item.id;
    const sleep = sleepInfo(item, new Date());
    sleepTaskTitle.textContent = item.title || "Untitled task";
    quickSleepUntil.value = sleep.sleeping && !sleep.indefinite
      ? isoToLocalInput(sleep.until)
      : isoToLocalInput(tomorrowMidnight(new Date()));
    sleepDialog.showModal();
    requestAnimationFrame(() => quickSleepUntil.focus());
  }

  async function saveSleepMutation(item, patch, historyEntry, message) {
    const now = new Date().toISOString();
    await putItem({
      ...item,
      ...patch,
      updatedAt: now,
      history: [...(item.history || []), { at: now, ...historyEntry }],
    });
    await onChanged();
    showToast(message);
  }

  async function saveCustomSleep(event) {
    event.preventDefault();
    const item = sleepEditingId ? getItem(sleepEditingId) : null;
    if (!item) return;
    const until = localInputToIso(quickSleepUntil.value);
    if (!until || toDate(until) <= new Date()) {
      showToast("Choose a future sleep time");
      return;
    }
    const now = new Date().toISOString();
    await saveSleepMutation(
      item,
      { sleep: { until, startedAt: item.sleep?.startedAt || now } },
      { type: "slept", until },
      `Sleeping until ${formatDateTime(until)}`,
    );
    sleepEditingId = null;
    sleepDialog.close();
  }

  async function sleepIndefinitely() {
    const item = sleepEditingId ? getItem(sleepEditingId) : null;
    if (!item) return;
    const now = new Date().toISOString();
    await saveSleepMutation(
      item,
      { sleep: { until: null, startedAt: item.sleep?.startedAt || now } },
      { type: "slept", until: null },
      "Sleeping indefinitely",
    );
    sleepEditingId = null;
    sleepDialog.close();
  }

  kindTask.addEventListener("change", syncKindFields);
  kindEvent.addEventListener("change", syncKindFields);
  form.elements.scheduleEnabled.addEventListener("change", syncScheduleFields);
  form.elements.sleepMode.addEventListener("change", syncSleepFields);
  form.elements.eventStart.addEventListener("change", () => fillEventCounterpart("start"));
  form.elements.eventEnd.addEventListener("change", () => fillEventCounterpart("end"));
  form.addEventListener("submit", (event) => save(event).catch((error) => {
    console.error(error);
    showToast("Could not save item");
  }));
  deleteButton.addEventListener("click", () => remove().catch(console.error));

  for (const button of [document.querySelector("#cancel-editor"), document.querySelector("#cancel-editor-bottom")]) {
    button?.addEventListener("click", (event) => {
      event.preventDefault();
      if (confirmClose()) dialog.close();
    });
  }

  dialog.addEventListener("cancel", (event) => {
    if (!confirmClose()) event.preventDefault();
  });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog && outsideRect(dialog, event)) {
      event.preventDefault();
      if (confirmClose()) dialog.close();
    }
  });
  dialog.addEventListener("close", () => {
    editingId = null;
    baseline = "";
  });

  if (dropZone) {
    for (const type of ["dragenter", "dragover"]) {
      dropZone.addEventListener(type, (event) => {
        event.preventDefault();
        dropZone.classList.add("dragging");
      });
    }
    for (const type of ["dragleave", "drop"]) {
      dropZone.addEventListener(type, () => dropZone.classList.remove("dragging"));
    }
    dropZone.addEventListener("drop", (event) => {
      event.preventDefault();
      mergeFiles(form.elements.attachments, [...(event.dataTransfer?.files || [])]);
    });
  }

  sleepForm.addEventListener("submit", (event) => saveCustomSleep(event).catch(console.error));
  sleepIndefiniteButton.addEventListener("click", () => sleepIndefinitely().catch(console.error));
  document.querySelector("#cancel-sleep")?.addEventListener("click", () => sleepDialog.close());
  sleepDialog.addEventListener("close", () => {
    sleepEditingId = null;
  });

  return { open, openSleep };
}
