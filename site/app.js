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
  nextActionableStart,
  sortTasks,
  taskMatchesFilter,
  textMatches,
  toDate,
} from "./domain.js";
import { deleteItem, exportData, importData, listItems, putItem } from "./storage.js";

const state = {
  items: [],
  view: "tasks",
  query: "",
  calendarMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  editingId: null,
  compact: localStorage.getItem("calendar.compactTasks") === "1",
  horizonDays: Number(localStorage.getItem("calendar.upcomingHorizon")) || 7,
};

const els = {
  app: document.querySelector("#app"),
  navButtons: [...document.querySelectorAll("[data-view]")],
  newButton: document.querySelector("#new-item"),
  search: document.querySelector("#search"),
  taskPanel: document.querySelector("#tasks-panel"),
  calendarPanel: document.querySelector("#calendar-panel"),
  taskSections: document.querySelector("#task-sections"),
  taskCount: document.querySelector("#task-count"),
  compactToggle: document.querySelector("#compact-toggle"),
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

const taskSectionDefinitions = [
  { id: "now", label: "Can do now", defaultOpen: true },
  { id: "waiting", label: "Waiting", defaultOpen: true },
  { id: "upcoming", label: "Upcoming", defaultOpen: true },
  { id: "all", label: "All open", defaultOpen: false },
  { id: "completed", label: "Completed", defaultOpen: false },
];

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
  const now = new Date();
  const matching = state.items.filter(isTask).filter((task) => textMatches(task, state.query));
  const openCount = matching.filter((task) => !["completed", "canceled"].includes(task.state)).length;

  els.taskCount.textContent = state.query
    ? `${openCount} matching open ${openCount === 1 ? "task" : "tasks"}`
    : `${openCount} open ${openCount === 1 ? "task" : "tasks"}`;

  els.taskPanel.classList.toggle("compact", state.compact);
  els.compactToggle.classList.toggle("active", state.compact);
  els.compactToggle.setAttribute("aria-pressed", String(state.compact));

  const rowsBySection = {
    now: sortTasks(matching.filter((task) => taskMatchesFilter(task, "now", now)), now).map((task) => ({ task })),
    waiting: sortTasks(matching.filter((task) => taskMatchesFilter(task, "waiting", now)), now).map((task) => ({ task })),
    upcoming: upcomingRows(matching, now),
    all: sortTasks(matching.filter((task) => taskMatchesFilter(task, "all", now)), now).map((task) => ({ task })),
    completed: sortTasks(matching.filter((task) => taskMatchesFilter(task, "completed", now)), now).map((task) => ({ task })),
  };

  els.taskSections.replaceChildren();
  for (const definition of taskSectionDefinitions) {
    els.taskSections.append(taskSection(definition, rowsBySection[definition.id], now));
  }
}

function upcomingRows(tasks, now) {
  const horizonEnd = new Date(now.getTime() + state.horizonDays * 24 * 60 * 60 * 1000);

  return tasks
    .filter((task) => !["completed", "canceled"].includes(task.state))
    .filter((task) => !actionability(task, now).actionable)
    .map((task) => ({ task, upcomingAt: nextActionableStart(task, now) }))
    .filter(({ upcomingAt }) => upcomingAt && upcomingAt > now && upcomingAt <= horizonEnd)
    .sort((a, b) => {
      const byTime = a.upcomingAt.getTime() - b.upcomingAt.getTime();
      if (byTime) return byTime;
      return String(a.task.title || "").localeCompare(String(b.task.title || ""));
    });
}

function taskSection(definition, rows, now) {
  const details = document.createElement("details");
  details.className = "task-section";
  details.dataset.section = definition.id;
  details.open = getSectionOpen(definition);

  const summary = document.createElement("summary");
  summary.innerHTML = `
    <span class="section-heading">
      <span class="section-chevron" aria-hidden="true">›</span>
      <strong>${escapeHtml(definition.label)}</strong>
    </span>
    <span class="section-count">${rows.length}</span>
  `;
  details.append(summary);

  const body = document.createElement("div");
  body.className = "task-section-body";

  if (definition.id === "upcoming") body.append(upcomingHorizonControl());

  const list = document.createElement("div");
  list.className = "task-list section-task-list";

  if (!rows.length) {
    const empty = document.createElement("div");
    empty.className = "section-empty";
    empty.textContent = emptySectionText(definition.id);
    list.append(empty);
  } else {
    for (const row of rows) list.append(taskCard(row.task, now, row.upcomingAt));
  }

  body.append(list);
  details.append(body);
  details.addEventListener("toggle", () => setSectionOpen(definition.id, details.open));
  return details;
}

function emptySectionText(sectionId) {
  if (sectionId === "now") return "Nothing is actionable right now.";
  if (sectionId === "waiting") return "Nothing is waiting for a future opportunity.";
  if (sectionId === "upcoming") return `Nothing becomes actionable in the next ${state.horizonDays} ${state.horizonDays === 1 ? "day" : "days"}.`;
  if (sectionId === "completed") return "No completed tasks.";
  return "No open tasks.";
}

function upcomingHorizonControl() {
  const wrap = document.createElement("div");
  wrap.className = "horizon-row";

  const label = document.createElement("span");
  label.className = "horizon-label";
  label.textContent = "Becomes available within";
  wrap.append(label);

  const control = document.createElement("div");
  control.className = "segmented horizon-control";
  control.setAttribute("aria-label", "Upcoming task horizon");

  for (const days of [1, 7, 30]) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.horizon = String(days);
    button.className = days === state.horizonDays ? "active" : "";
    button.textContent = `${days}d`;
    button.setAttribute("aria-pressed", String(days === state.horizonDays));
    button.addEventListener("click", () => {
      state.horizonDays = days;
      localStorage.setItem("calendar.upcomingHorizon", String(days));
      renderTasks();
    });
    control.append(button);
  }

  wrap.append(control);
  return wrap;
}

function getSectionOpen(definition) {
  const stored = localStorage.getItem(`calendar.section.${definition.id}`);
  if (stored === "open") return true;
  if (stored === "closed") return false;
  return definition.defaultOpen;
}

function setSectionOpen(sectionId, open) {
  localStorage.setItem(`calendar.section.${sectionId}`, open ? "open" : "closed");
}

function taskCard(task, now, upcomingAt = null) {
  const article = document.createElement("article");
  article.className = "task-card";
  article.dataset.id = task.id;

  const result = actionability(task, now);
  const tags = (task.tags || []).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("");
  const timing = [];
  if (upcomingAt) timing.push(`Next available ${formatDateTime(upcomingAt)}`);
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

  const canResume = task.state === "waiting" && !!task.wakeAt;
  const closed = ["completed", "canceled"].includes(task.state);

  article.innerHTML = `
    <div class="task-main">
      ${closed ? '<span class="complete-indicator" aria-hidden="true">✓</span>' : '<button class="complete-button" data-action="complete" aria-label="Mark complete" title="Mark complete"></button>'}
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
      ${!closed && canResume ? '<button class="text-button" data-action="resume">Resume now</button>' : ""}
      ${!closed ? '<button class="text-button" data-action="tomorrow">Tomorrow</button>' : ""}
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
    const now = new Date().toISOString();
    await putItem({
      ...item,
      state: "completed",
      completedAt: now,
      updatedAt: now,
      history: [...(item.history || []), { at: now, type: "completed" }],
    });
    await refresh();
    showToast("Task completed");
    return;
  }

  if (button.dataset.action === "resume") {
    const now = new Date().toISOString();
    await putItem({
      ...item,
      state: "open",
      wakeAt: null,
      updatedAt: now,
      history: [...(item.history || []), { at: now, type: "resumed" }],
    });
    await refresh();
    showToast("Delay cleared");
    return;
  }

  if (button.dataset.action === "tomorrow") {
    const wake = new Date();
    wake.setDate(wake.getDate() + 1);
    wake.setHours(0, 0, 0, 0);
    const now = new Date().toISOString();
    await putItem({
      ...item,
      state: "waiting",
      wakeAt: wake.toISOString(),
      updatedAt: now,
      history: [...(item.history || []), { at: now, type: "deferred", until: wake.toISOString() }],
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
          setSectionOpen("all", true);
          render();
          requestAnimationFrame(() => document.querySelector('[data-section="all"]')?.scrollIntoView({ block: "start" }));
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
        title: `${item.title}: action window`,
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
          title: `${item.title}: ${role}`,
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

    const requestedState = String(form.get("taskState") || "open");
    let wakeAt = localInputToIso(form.get("wakeAt"));
    let taskState = requestedState;
    const clearedExistingWake = existing?.kind === "task" && existing.state === "waiting" && existing.wakeAt && !wakeAt;

    if (requestedState === "open" && wakeAt) taskState = "waiting";
    if (clearedExistingWake && requestedState === "waiting") taskState = "open";
    if (taskState !== "waiting") wakeAt = null;

    const history = existing?.history ? [...existing.history] : [{ at: now, type: "created" }];
    if (clearedExistingWake) history.push({ at: now, type: "resumed" });

    item = {
      ...(existing?.kind === "task" ? existing : {}),
      id: existing?.id || uuid(),
      kind: "task",
      title: String(form.get("title")).trim(),
      notes: String(form.get("notes") || "").trim(),
      state: taskState,
      tags: String(form.get("tags") || "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
      attachments: [...(existing?.kind === "task" ? existing.attachments || [] : []), ...newAttachments],
      availableFrom: localInputToIso(form.get("availableFrom")),
      deadline: localInputToIso(form.get("deadline")),
      latestStart: localInputToIso(form.get("latestStart")),
      wakeAt,
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
      history,
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
els.compactToggle.addEventListener("click", () => {
  state.compact = !state.compact;
  localStorage.setItem("calendar.compactTasks", state.compact ? "1" : "0");
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
