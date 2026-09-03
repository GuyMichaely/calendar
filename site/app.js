import {
  actionability,
  availabilityStartForDate,
  calendarGridStart,
  dateKey,
  formatDateTime,
  isoToLocalInput,
  isEvent,
  isPendingOnDate,
  isTask,
  localInputToIso,
  sortTasks,
  taskMatchesFilter,
  textMatches,
  toDate,
} from "./domain.js";
import { deleteItem, exportData, importData, listItems, putItem } from "./storage.js";

const state = {
  items: [],
  view: "tasks",
  filter: "now",
  query: "",
  calendarMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  editingId: null,
};

const els = {
  app: document.querySelector("#app"),
  navButtons: [...document.querySelectorAll("[data-view]")],
  newButton: document.querySelector("#new-item"),
  search: document.querySelector("#search"),
  taskPanel: document.querySelector("#tasks-panel"),
  calendarPanel: document.querySelector("#calendar-panel"),
  taskList: document.querySelector("#task-list"),
  taskCount: document.querySelector("#task-count"),
  filterBar: document.querySelector("#filter-bar"),
  calendarGrid: document.querySelector("#calendar-grid"),
  monthLabel: document.querySelector("#month-label"),
  prevMonth: document.querySelector("#prev-month"),
  nextMonth: document.querySelector("#next-month"),
  todayButton: document.querySelector("#today"),
  dialog: document.querySelector("#editor-dialog"),
  form: document.querySelector("#editor-form"),
  dialogTitle: document.querySelector("#dialog-title"),
  deleteButton: document.querySelector("#delete-item"),
  kindTask: document.querySelector("#kind-task"),
  kindEvent: document.querySelector("#kind-event"),
  taskFields: document.querySelector("#task-fields"),
  eventFields: document.querySelector("#event-fields"),
  cancelEditor: document.querySelector("#cancel-editor"),
  menuButton: document.querySelector("#menu-button"),
  menu: document.querySelector("#data-menu"),
  exportButton: document.querySelector("#export-data"),
  importButton: document.querySelector("#import-data"),
  importInput: document.querySelector("#import-input"),
  toast: document.querySelector("#toast"),
};

const filterLabels = {
  now: "Can do now",
  waiting: "Waiting",
  all: "All open",
  completed: "Completed",
};

function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => els.toast.classList.remove("show"), 2400);
}

async function refresh() {
  state.items = await listItems();
  render();
}

function render() {
  els.navButtons.forEach((button) => button.classList.toggle("active", button.dataset.view === state.view));
  els.taskPanel.hidden = state.view !== "tasks";
  els.calendarPanel.hidden = state.view !== "calendar";

  if (state.view === "tasks") renderTasks();
  if (state.view === "calendar") renderCalendar();
}

function renderTasks() {
  [...els.filterBar.querySelectorAll("button")].forEach((button) => {
    button.classList.toggle("active", button.dataset.filter === state.filter);
  });

  const now = new Date();
  const tasks = sortTasks(
    state.items
      .filter(isTask)
      .filter((task) => taskMatchesFilter(task, state.filter, now))
      .filter((task) => textMatches(task, state.query)),
    now,
  );

  els.taskCount.textContent = `${tasks.length} ${tasks.length === 1 ? "task" : "tasks"}`;
  els.taskList.replaceChildren();

  if (!tasks.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = `<strong>No ${filterLabels[state.filter].toLowerCase()} tasks.</strong><span>Create one or switch filters.</span>`;
    els.taskList.append(empty);
    return;
  }

  for (const task of tasks) els.taskList.append(taskCard(task, now));
}

function taskCard(task, now) {
  const article = document.createElement("article");
  article.className = "task-card";
  article.dataset.id = task.id;

  const result = actionability(task, now);
  const tags = (task.tags || []).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("");
  const timing = [];
  if (task.availableFrom) timing.push(`Starts ${formatDateTime(task.availableFrom)}`);
  if (task.deadline) timing.push(`Due ${formatDateTime(task.deadline)}`);
  if (task.latestStart) timing.push(`Latest start ${formatDateTime(task.latestStart)}`);
  if (task.state === "waiting" && task.wakeAt) timing.push(`Wake ${formatDateTime(task.wakeAt)}`);

  const schedule = task.availabilitySchedule;
  if (schedule?.enabled) {
    const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const days = (schedule.days || []).map((d) => names[d]).join(", ");
    timing.push(`${days || "No days"} ${schedule.start || ""}–${schedule.end || ""}`);
  }

  article.innerHTML = `
    <div class="task-main">
      <button class="complete-button" data-action="complete" aria-label="Mark complete" title="Mark complete"></button>
      <div class="task-copy">
        <div class="task-title-row">
          <h3>${escapeHtml(task.title || "Untitled task")}</h3>
          <span class="status-pill ${result.actionable ? "ready" : "quiet"}">${escapeHtml(result.reason)}</span>
        </div>
        ${task.notes ? `<p class="notes">${escapeHtml(task.notes)}</p>` : ""}
        ${timing.length ? `<div class="timing">${timing.map((x) => `<span>${escapeHtml(x)}</span>`).join("")}</div>` : ""}
        ${tags ? `<div class="tags">${tags}</div>` : ""}
        ${(task.attachments || []).length ? `<div class="attachments">${task.attachments.map((a, i) => `<button class="attachment" data-action="attachment" data-attachment-index="${i}">📎 ${escapeHtml(a.name || "Attachment")}</button>`).join("")}</div>` : ""}
      </div>
    </div>
    <div class="task-actions">
      <button class="text-button" data-action="tomorrow">Tomorrow</button>
      <button class="text-button" data-action="edit">Edit</button>
    </div>
  `;

  article.addEventListener("click", handleTaskAction);
  return article;
}

async function handleTaskAction(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const card = event.currentTarget;
  const item = state.items.find((x) => x.id === card.dataset.id);
  if (!item) return;

  if (button.dataset.action === "edit") {
    openEditor(item);
    return;
  }

  if (button.dataset.action === "attachment") {
    const attachment = item.attachments?.[Number(button.dataset.attachmentIndex)];
    if (!attachment?.blob) return;
    const url = URL.createObjectURL(attachment.blob);
    window.open(url, "_blank", "noopener,noreferrer");
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return;
  }

  if (button.dataset.action === "complete") {
    await putItem({
      ...item,
      state: "completed",
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      history: [...(item.history || []), { at: new Date().toISOString(), type: "completed" }],
    });
    await refresh();
    showToast("Task completed");
    return;
  }

  if (button.dataset.action === "tomorrow") {
    const wake = new Date();
    wake.setDate(wake.getDate() + 1);
    wake.setHours(0, 0, 0, 0);
    await putItem({
      ...item,
      state: "waiting",
      wakeAt: wake.toISOString(),
      updatedAt: new Date().toISOString(),
      history: [...(item.history || []), { at: new Date().toISOString(), type: "deferred", until: wake.toISOString() }],
    });
    await refresh();
    showToast("Deferred until tomorrow");
  }
}

function renderCalendar() {
  const month = state.calendarMonth;
  els.monthLabel.textContent = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(month);
  els.calendarGrid.replaceChildren();

  const weekdayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  weekdayNames.forEach((name) => {
    const header = document.createElement("div");
    header.className = "weekday";
    header.textContent = name;
    els.calendarGrid.append(header);
  });

  const start = calendarGridStart(month);
  const today = dateKey(new Date());

  for (let i = 0; i < 42; i += 1) {
    const day = new Date(start);
    day.setDate(start.getDate() + i);
    const key = dateKey(day);
    const cell = document.createElement("div");
    cell.className = "calendar-day";
    if (day.getMonth() !== month.getMonth()) cell.classList.add("outside");
    if (key === today) cell.classList.add("today");

    const header = document.createElement("div");
    header.className = "day-number";
    header.textContent = day.getDate();
    cell.append(header);

    let reservedRows = 0;
    if (key === today) {
      const pendingCount = state.items.filter((item) => isPendingOnDate(item, day)).length;
      if (pendingCount) {
        const summary = document.createElement("button");
        summary.className = "calendar-chip task start";
        summary.textContent = `✓ ${pendingCount} pending ${pendingCount === 1 ? "task" : "tasks"}`;
        summary.title = "Open today's pending tasks";
        summary.addEventListener("click", () => {
          state.view = "tasks";
          state.filter = "all";
          render();
        });
        cell.append(summary);
        reservedRows = 1;
      }
    }

    const items = calendarItemsForDay(day);
    const itemLimit = 4 - reservedRows;
    for (const item of items.slice(0, itemLimit)) {
      const chip = document.createElement("button");
      chip.className = `calendar-chip ${item.kind} ${item.role || ""}`;
      chip.textContent = item.label;
      chip.title = item.title;
      chip.addEventListener("click", () => openEditor(item.source));
      cell.append(chip);
    }
    if (items.length > itemLimit) {
      const more = document.createElement("div");
      more.className = "more-count";
      more.textContent = `+${items.length - itemLimit} more`;
      cell.append(more);
    }

    els.calendarGrid.append(cell);
  }
}

function calendarItemsForDay(day) {
  const key = dateKey(day);
  const entries = [];
  for (const item of state.items) {
    if (isEvent(item) && dateKey(item.start) === key) {
      entries.push({
        kind: "event",
        role: "event",
        label: `${shortTime(item.start)} ${item.title}`,
        title: item.title,
        source: item,
        sort: toDate(item.start)?.getTime() || 0,
      });
      continue;
    }
    if (!isTask(item) || ["completed", "canceled"].includes(item.state)) continue;

    const scheduledStart = availabilityStartForDate(item, day);
    if (scheduledStart) {
      entries.push({
        kind: "task",
        role: "start",
        label: `${shortTime(scheduledStart)} ${item.title}`,
        title: `${item.title} — action window`,
        source: item,
        sort: scheduledStart.getTime(),
      });
    }

    for (const [field, role, prefix] of [
      ["availableFrom", "start", "↦"],
      ["wakeAt", "wake", "↻"],
      ["latestStart", "latest", "!"],
      ["deadline", "due", "●"],
    ]) {
      if (item[field] && dateKey(item[field]) === key) {
        entries.push({
          kind: "task",
          role,
          label: `${prefix} ${item.title}`,
          title: `${item.title} — ${role}`,
          source: item,
          sort: toDate(item[field])?.getTime() || 0,
        });
      }
    }
  }
  return entries.sort((a, b) => a.sort - b.sort);
}

function shortTime(value) {
  const d = toDate(value);
  if (!d) return "";
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(d);
}

function openEditor(item = null, defaultKind = "task") {
  state.editingId = item?.id || null;
  els.form.reset();
  els.deleteButton.hidden = !item;
  els.dialogTitle.textContent = item ? "Edit item" : "New item";

  const kind = item?.kind || defaultKind;
  els.kindTask.checked = kind === "task";
  els.kindEvent.checked = kind === "event";
  syncKindFields();

  els.form.elements.title.value = item?.title || "";
  els.form.elements.notes.value = item?.notes || "";

  if (kind === "task") {
    els.form.elements.taskState.value = item?.state || "open";
    els.form.elements.tags.value = (item?.tags || []).join(", ");
    els.form.elements.availableFrom.value = isoToLocalInput(item?.availableFrom);
    els.form.elements.deadline.value = isoToLocalInput(item?.deadline);
    els.form.elements.latestStart.value = isoToLocalInput(item?.latestStart);
    els.form.elements.wakeAt.value = isoToLocalInput(item?.wakeAt);

    const schedule = item?.availabilitySchedule;
    els.form.elements.scheduleEnabled.checked = !!schedule?.enabled;
    els.form.elements.scheduleStart.value = schedule?.start || "08:00";
    els.form.elements.scheduleEnd.value = schedule?.end || "17:00";
    document.querySelectorAll("[name='scheduleDay']").forEach((input) => {
      input.checked = schedule?.enabled ? (schedule.days || []).includes(Number(input.value)) : [1, 2, 3, 4, 5].includes(Number(input.value));
    });
    syncScheduleFields();
    const existingAttachments = document.querySelector("#existing-attachments");
    existingAttachments.textContent = (item?.attachments || []).length
      ? `Attached: ${(item.attachments || []).map((a) => a.name).join(", ")}. New files are added to these.`
      : "Files stay on this device until cloud sync is added.";
  } else {
    els.form.elements.eventStart.value = isoToLocalInput(item?.start) || isoToLocalInput(new Date());
    els.form.elements.eventEnd.value = isoToLocalInput(item?.end);
  }

  els.dialog.showModal();
  requestAnimationFrame(() => els.form.elements.title.focus());
}

function syncKindFields() {
  const kind = els.kindTask.checked ? "task" : "event";
  els.taskFields.hidden = kind !== "task";
  els.eventFields.hidden = kind !== "event";
}

function syncScheduleFields() {
  const enabled = els.form.elements.scheduleEnabled.checked;
  document.querySelector("#schedule-options").classList.toggle("disabled", !enabled);
  document.querySelectorAll("#schedule-options input").forEach((input) => (input.disabled = !enabled));
}

async function saveEditor(event) {
  event.preventDefault();
  const form = new FormData(els.form);
  const existing = state.items.find((x) => x.id === state.editingId);
  const kind = form.get("kind");
  const now = new Date().toISOString();

  if (!String(form.get("title") || "").trim()) return;

  let item;
  if (kind === "task") {
    const scheduleEnabled = form.get("scheduleEnabled") === "on";
    const newAttachments = [...(els.form.elements.attachments.files || [])].map((file) => ({
      id: uuid(),
      name: file.name,
      type: file.type,
      size: file.size,
      blob: file,
    }));
    item = {
      ...(existing?.kind === "task" ? existing : {}),
      id: existing?.id || uuid(),
      kind: "task",
      title: String(form.get("title")).trim(),
      notes: String(form.get("notes") || "").trim(),
      state: String(form.get("taskState") || "open"),
      tags: String(form.get("tags") || "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
      attachments: [...(existing?.kind === "task" ? existing.attachments || [] : []), ...newAttachments],
      availableFrom: localInputToIso(form.get("availableFrom")),
      deadline: localInputToIso(form.get("deadline")),
      latestStart: localInputToIso(form.get("latestStart")),
      wakeAt: localInputToIso(form.get("wakeAt")),
      availabilitySchedule: scheduleEnabled
        ? {
            enabled: true,
            days: form.getAll("scheduleDay").map(Number),
            start: String(form.get("scheduleStart") || "08:00"),
            end: String(form.get("scheduleEnd") || "17:00"),
          }
        : null,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      history: existing?.history || [{ at: now, type: "created" }],
    };
  } else {
    item = {
      ...(existing?.kind === "event" ? existing : {}),
      id: existing?.id || uuid(),
      kind: "event",
      title: String(form.get("title")).trim(),
      notes: String(form.get("notes") || "").trim(),
      start: localInputToIso(form.get("eventStart")),
      end: localInputToIso(form.get("eventEnd")),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
  }

  await putItem(item);
  els.dialog.close();
  await refresh();
  showToast(existing ? "Saved" : `${kind === "task" ? "Task" : "Event"} created`);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

els.navButtons.forEach((button) => {
  button.addEventListener("click", () => {
    state.view = button.dataset.view;
    render();
  });
});

els.newButton.addEventListener("click", () => openEditor(null, state.view === "calendar" ? "event" : "task"));
els.search.addEventListener("input", () => {
  state.query = els.search.value;
  if (state.view !== "tasks") state.view = "tasks";
  render();
});
els.filterBar.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-filter]");
  if (!button) return;
  state.filter = button.dataset.filter;
  renderTasks();
});
els.prevMonth.addEventListener("click", () => {
  state.calendarMonth = new Date(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth() - 1, 1);
  renderCalendar();
});
els.nextMonth.addEventListener("click", () => {
  state.calendarMonth = new Date(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth() + 1, 1);
  renderCalendar();
});
els.todayButton.addEventListener("click", () => {
  const now = new Date();
  state.calendarMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  renderCalendar();
});
els.kindTask.addEventListener("change", syncKindFields);
els.kindEvent.addEventListener("change", syncKindFields);
els.form.elements.scheduleEnabled.addEventListener("change", syncScheduleFields);
els.form.addEventListener("submit", saveEditor);
els.cancelEditor.addEventListener("click", () => els.dialog.close());
els.deleteButton.addEventListener("click", async () => {
  if (!state.editingId) return;
  await deleteItem(state.editingId);
  els.dialog.close();
  await refresh();
  showToast("Deleted");
});
els.exportButton.addEventListener("click", async () => {
  const text = await exportData();
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `calendar-backup-${dateKey(new Date())}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  els.menu.hidePopover();
});
els.importButton.addEventListener("click", () => {
  els.importInput.click();
  els.menu.hidePopover();
});
els.importInput.addEventListener("change", async () => {
  const file = els.importInput.files?.[0];
  if (!file) return;
  try {
    const count = await importData(await file.text());
    await refresh();
    showToast(`Imported ${count} items`);
  } catch (error) {
    showToast(error.message || "Import failed");
  } finally {
    els.importInput.value = "";
  }
});

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

refresh().catch((error) => {
  console.error(error);
  document.querySelector("#app").innerHTML = `<div class="fatal">Could not open local storage. ${escapeHtml(error.message)}</div>`;
});