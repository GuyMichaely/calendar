import { isEvent, isoToLocalInput, localInputToIso } from "./domain.js";
import { listItemsSnapshot, putItem } from "./storage.js";

const editorDialog = document.querySelector("#editor-dialog");
const editorForm = document.querySelector("#editor-form");
const sleepDialog = document.querySelector("#sleep-dialog");
const eventStart = editorForm?.elements.eventStart;
const eventEnd = editorForm?.elements.eventEnd;
const tagsInput = editorForm?.elements.tags;
const attachmentsInput = editorForm?.elements.attachments;
const existingAttachments = document.querySelector("#existing-attachments");
const baselines = new WeakMap();

function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function toast(message) {
  window.dispatchEvent(new CustomEvent("calendar:toast", { detail: { message } }));
}

function serializeForm(form) {
  if (!form) return "";
  return JSON.stringify(
    [...form.querySelectorAll("input, textarea, select")].map((control, index) => ({
      key: control.name || control.id || control.dataset.shortcut || String(index),
      type: control.type,
      value: control.type === "file"
        ? [...(control.files || [])].map((file) => [file.name, file.size, file.lastModified])
        : control.value,
      checked: "checked" in control ? control.checked : undefined,
      dataKey: control.dataset.shortcut ? control.dataset.key || "" : undefined,
    })),
  );
}

function setBaseline(dialog) {
  requestAnimationFrame(() => baselines.set(dialog, serializeForm(dialog.querySelector("form"))));
}

function isDirty(dialog) {
  const baseline = baselines.get(dialog);
  return !!baseline && serializeForm(dialog.querySelector("form")) !== baseline;
}

function confirmDiscard(dialog) {
  return !isDirty(dialog) || window.confirm("Discard your unsaved changes?");
}

function outsideRect(dialog, event) {
  const rect = dialog.getBoundingClientRect();
  return event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
}

document.addEventListener(
  "click",
  (event) => {
    const dialog = event.target instanceof HTMLDialogElement ? event.target : null;
    if (!dialog?.open || !outsideRect(dialog, event)) return;
    event.preventDefault();
    if (confirmDiscard(dialog)) dialog.close();
  },
  true,
);

document.addEventListener(
  "click",
  (event) => {
    const button = event.target instanceof Element ? event.target.closest("button") : null;
    const dialog = button?.closest("dialog");
    if (!button || !dialog?.open) return;
    const closes = button.getAttribute("aria-label") === "Close" || button.textContent.trim() === "Cancel";
    if (!closes || !isDirty(dialog) || window.confirm("Discard your unsaved changes?")) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  },
  true,
);

function watchDialog(dialog) {
  if (!dialog) return;
  dialog.addEventListener("cancel", (event) => {
    if (isDirty(dialog) && !window.confirm("Discard your unsaved changes?")) event.preventDefault();
  });
  dialog.addEventListener("close", () => baselines.delete(dialog));
  new MutationObserver(() => {
    if (dialog.open) setBaseline(dialog);
  }).observe(dialog, { attributes: true, attributeFilter: ["open"] });
}

for (const dialog of document.querySelectorAll("dialog")) watchDialog(dialog);

function localDateInput(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fillCounterpart(changed) {
  if (!eventStart || !eventEnd) return;
  if (changed === "start" && eventStart.value && !eventEnd.value) {
    const start = new Date(eventStart.value);
    if (!Number.isNaN(start.getTime())) {
      start.setDate(start.getDate() + 1);
      eventEnd.value = localDateInput(start);
    }
  } else if (changed === "end" && eventEnd.value && !eventStart.value) {
    const end = new Date(eventEnd.value);
    if (!Number.isNaN(end.getTime())) {
      end.setDate(end.getDate() - 1);
      eventStart.value = localDateInput(end);
    }
  }
}

eventStart?.addEventListener("change", () => fillCounterpart("start"));
eventEnd?.addEventListener("change", () => fillCounterpart("end"));

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

const dropZone = document.querySelector("[data-attachment-drop-zone]");
if (dropZone && attachmentsInput) {
  for (const type of ["dragenter", "dragover"]) {
    dropZone.addEventListener(type, (event) => {
      event.preventDefault();
      dropZone.classList.add("dragging");
    });
  }
  for (const type of ["dragleave", "drop"]) dropZone.addEventListener(type, () => dropZone.classList.remove("dragging"));
  dropZone.addEventListener("drop", (event) => {
    event.preventDefault();
    mergeFiles(attachmentsInput, [...(event.dataTransfer?.files || [])]);
  });
}

function parseTags(value) {
  return String(value || "").split(",").map((tag) => tag.trim()).filter(Boolean);
}

async function findOpenEvent() {
  if (!editorDialog?.open || !document.querySelector("#kind-event")?.checked) return null;
  const itemId = editorDialog.dataset.itemId;
  const items = await listItemsSnapshot();
  if (itemId) return items.find((item) => item.id === itemId) || null;
  if (document.querySelector("#dialog-title")?.textContent?.startsWith("New")) return null;
  const title = editorForm.elements.title.value;
  return items.find(
    (item) => isEvent(item) && item.title === title && isoToLocalInput(item.start) === (eventStart?.value || "") && isoToLocalInput(item.end) === (eventEnd?.value || ""),
  ) || null;
}

async function populateEventFields() {
  if (!editorDialog?.open || !document.querySelector("#kind-event")?.checked) return;
  const existing = await findOpenEvent();
  editorDialog.dataset.itemId = existing?.id || editorDialog.dataset.itemId || "";
  if (tagsInput) tagsInput.value = (existing?.tags || []).join(", ");
  if (existingAttachments) {
    existingAttachments.textContent = existing?.attachments?.length
      ? `Attached: ${existing.attachments.map((attachment) => attachment.name).join(", ")}. New files are added to these.`
      : "Drop files here or use Choose Files.";
  }
  fillCounterpart(eventStart?.value ? "start" : "end");
  setBaseline(editorDialog);
}

async function saveEvent(event) {
  event.preventDefault();
  event.stopImmediatePropagation();
  fillCounterpart(eventStart?.value ? "start" : "end");
  const title = String(editorForm.elements.title.value || "").trim();
  if (!title) return;

  const existing = await findOpenEvent();
  const now = new Date().toISOString();
  const newAttachments = [...(attachmentsInput?.files || [])].map((file) => ({
    id: uuid(),
    name: file.name,
    type: file.type,
    size: file.size,
    blob: file,
  }));
  const item = {
    ...(existing || {}),
    id: existing?.id || uuid(),
    kind: "event",
    title,
    notes: String(editorForm.elements.notes.value || "").trim(),
    tags: parseTags(tagsInput?.value),
    attachments: [...(existing?.attachments || []), ...newAttachments],
    start: localInputToIso(eventStart?.value),
    end: localInputToIso(eventEnd?.value),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  await putItem(item);
  baselines.set(editorDialog, serializeForm(editorForm));
  editorDialog.close();
  editorDialog.dataset.itemId = "";
  toast(existing ? "Saved" : "Event created");
  document.querySelector(".primary-nav .nav-button.active")?.click();
}

editorForm?.addEventListener(
  "submit",
  (event) => {
    if (!document.querySelector("#kind-event")?.checked) return;
    saveEvent(event).catch((error) => {
      console.error(error);
      toast("Could not save event");
    });
  },
  true,
);

document.addEventListener(
  "pointerdown",
  (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest("#new-item")) {
      if (editorDialog) editorDialog.dataset.itemId = "";
      return;
    }
    const edit = target.closest('.task-card [data-action="edit"]');
    if (edit && editorDialog) {
      editorDialog.dataset.itemId = edit.closest(".task-card")?.dataset.id || "";
      return;
    }
    const chip = target.closest(".calendar-chip[data-item-id]");
    if (chip && editorDialog) editorDialog.dataset.itemId = chip.dataset.itemId || "";
  },
  true,
);

document.addEventListener("click", (event) => {
  if (event.target instanceof Element && event.target.closest("#new-item") && editorDialog) editorDialog.dataset.itemId = "";
}, true);

if (editorDialog) {
  new MutationObserver(() => {
    if (!editorDialog.open) return;
    if (document.querySelector("#kind-event")?.checked) populateEventFields().catch(console.error);
    else setBaseline(editorDialog);
  }).observe(editorDialog, { attributes: true, attributeFilter: ["open"] });
}

document.querySelector("#kind-event")?.addEventListener("change", () => {
  if (document.querySelector("#kind-event")?.checked && editorDialog?.open) populateEventFields().catch(console.error);
});
document.querySelector("#kind-task")?.addEventListener("change", () => {
  if (document.querySelector("#kind-task")?.checked && editorDialog?.open) setBaseline(editorDialog);
});
