import {
  actionability,
  availabilityStartForDate,
  calendarGridStart,
  dateKey,
  formatDateTime,
  isoToLocalInput,
  isEvent,
  isIgnored,
  isPendingOnDate,
  isTask,
  localInputToIso,
  nextActionableStart,
  sortTasks,
  taskMatchesFilter,
  textMatches,
  toDate,
  tomorrowMidnight,
} from "./domain.js";
import { deleteItem, exportData, importData, listItems, putItem } from "./storage.js";

function viewFromHash() {
  return location.hash === "#calendar" ? "calendar" : "tasks";
}

if (!["#tasks", "#calendar"].includes(location.hash)) {
  history.replaceState(null, "", "#tasks");
}

const state = {
  items: [],
  view: viewFromHash(),
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

async function migrateLegacyTasks(items) {
  const now = new Date().toISOString();
  const migrated = [];

  for (const item of items) {
    if (!isTask(item) || item.state !== "waiting") {
      migrated.push(item);
      continue;
    }

    const history = [...(item.history || [])];
    const wasOldTomorrow = history.some((entry) => entry?.type === "deferred");
    const wake = toDate(item.wakeAt);
    const existingStart = toDate(item.availableFrom);

    const updated = {
      ...item,
      state: "open",
      wakeAt: null,
      updatedAt: now,
      history: [...history, { at: now, type: "legacy-waiting-migrated" }],
    };

    if (wake && wasOldTomorrow) {
      updated.ignoredUntil = item.ignoredUntil || wake.toISOString();
    } else if (wake && (!existingStart || wake > existingStart)) {
      updated.availableFrom = wake.toISOString();
    }

    await putItem(updated);
    migrated.push(updated);
  }

  return migrated;
}

async function refresh() {
  state.items = await migrateLegacyTasks(await listItems());
  render();
}

function navigateView(view, { replace = false } = {}) {
  const target = view === "calendar" ? "calendar" : "tasks";
  const hash = `#${target}`;
  state.view = target;

  if (location.hash !== hash) {
    history[replace ? "replaceState" : "pushState"](null, "", hash);
  }

  render();
}

function syncViewFromLocation() {
  const next = viewFromHash();
  if (state.view !== next) state.view = next;
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

  const actionable = sortTasks(matching.filter((task) => taskMatchesFilter(task, "now", now) && !isIgnored(task, now)), now);
  const ignoredNowRows = sortTasks(
    matching.filter((task) => !["completed", "canceled"].includes(task.state) && isIgnored(task, now)),
    now,
  ).map((task) => ({ task }));
  const rowsBySection = {
    now: actionable.map((task) => ({ task })),
    waiting: sortTasks(
      matching.filter((task) => taskMatchesFilter(task, "waiting", now) && !isIgnored(task, now)),
      now,
    ).map((task) => ({ task })),
    upcoming: upcomingRows(matching, now),
    all: sortTasks(matching.filter((task) => taskMatchesFilter(task, "all", now)), now).map((task) => ({ task })),
    completed: sortTasks(matching.filter((task) => taskMatchesFilter(task, "completed", now)), now).map((task) => ({ task })),
  };

  els.taskSections.replaceChildren();
  for (const definition of taskSectionDefinitions) {
    els.taskSections.append(taskSection(definition, rowsBySection[definition.id], now, definition.id === "now" ? ignoredNowRows : []));
  }
}

function upcomingRows(tasks, now) {
  const horizonEnd = new Date(now.getTime() + state.horizonDays * 24 * 60 * 60 * 1000);

  return tasks
    .filter((task) => !["completed", "canceled"].includes(task.state))
    .filter((task) => !isIgnored(task, now))
    .filter((task) => !actionability(task, now).actionable)
    .map((task) => ({ task, upcomingAt: nextActionableStart(task, now) }))
    .filter(({ upcomingAt }) => upcomingAt && upcomingAt > now && upcomingAt <= horizonEnd)
    .sort((a, b) => {
      const byTime = a.upcomingAt.getTime() - b.upcomingAt.getTime();
      if (byTime) return byTime;
      return String(a.task.title || "").localeCompare(String(b.task.title || ""));
    });
}

function taskSection(definition, rows, now, ignoredRows = []) {
  const details = document.createElement("details");
  details.className = "task-section";
  details.dataset.section = definition.id;
  details.open = getSectionOpen(definition);

  const totalCount = rows.length + ignoredRows.length;
  const summary = document.createElement("summary");
  summary.innerHTML = `
    <span class="section-heading">
      <span class="section-chevron" aria-hidden="true">›</span>
      <strong>${escapeHtml(definition.label)}</strong>
    </span>
    <span class="section-count">${totalCount}</span>
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
    empty.textContent = definition.id === "now" && ignoredRows.length ? "No unignored tasks right now." : emptySectionText(definition.id);
    list.append(empty);
  } else {
    for (const row of rows) list.append(taskCard(row.task, now, row.upcomingAt));
  }

  body.append(list);

  if (definition.id === "now" && ignoredRows.length) {
    const ignoredBlock = document.createElement("div");
    ignoredBlock.className = "ignored-block";
    ignoredBlock.innerHTML = `<div class="ignored-heading"><span>Ignored for today</span><span>${ignoredRows.length}</span></div>`;

    const ignoredList = document.createElement("div");
    ignoredList.className = "task-list section-task-list ignored-task-list";
    for (const row of ignoredRows) ignoredList.append(taskCard(row.task, now, row.upcomingAt));
    ignoredBlock.append(ignoredList);
    body.append(ignoredBlock);
  }

  details.append(body);
  details.addEventListener("toggle", () => setSectionOpen(definition.id, details.open));
  return details;
}

function emptySectionText(sectionId) {
  if (sectionId === "now") return "Nothing is actionable right now.";
  if (sectionId === "waiting") return "Nothing has a known future opportunity.";
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
  const ignored = isIgnored(task, now);
  const tags = (task.tags || []).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("");
  const timing = [];
  if (upcomingAt) timing.push(`Next available ${formatDateTime(upcomingAt)}`);
  if (task.availableFrom) timing.push(`Starts ${formatDateTime(task.availableFrom)}`);
  if (task.deadline) timing.push(`Due ${formatDateTime(task.deadline)}`);
  if (task.latestStart) timing.push(`Latest start ${formatDateTime(task.latestStart)}`);

  const schedule = task.availabilitySchedule;
  if (schedule?.enabled) {
    const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const days = (schedule.days || []).map((d) => names[d]).join(", ");
    timing.push(`${days || "No days"} ${schedule.start || ""}–${schedule.end || ""}`);
  }

  const closed = ["completed", "canceled"].includes(task.state);
  const statusText = ignored ? "Ignored today" : result.reason;

  article.innerHTML = `
    <div class="task-main">
      ${closed ? '<span class="complete-indicator" aria-hidden="true">✓</span>' : '<button class="complete-button" data-action="complete" aria-label="Mark complete" title="Mark complete"></button>'}
      <div class="task-copy">
        <div class="task-title-row">
          <h3>${escapeHtml(task.title || "Untitled task")}</h3>
          <span class="status-pill ${result.actionable && !ignored ? "ready" : "quiet"}">${escapeHtml(statusText)}</span>
        </div>
        ${task.notes ? `<p class="notes">${escapeHtml(task.notes)}</p>` : ""}
        ${timing.length ? `<div class="timing">${timing.map((x) => `<span>${escapeHtml(x)}</span>`).join("")}</div>` : ""}
        ${tags ? `<div class="tags">${tags}</div>` : ""}
        ${(task.attachments || []).length ? `<div class="attachments">${task.attachments.map((a, i) => `<button class="attachment" data-action="attachment" data-attachment-index="${i}">📎 ${escapeHtml(a.name || "Attachment")}</button>`).join("")}</div>` : ""}
      </div>
    </div>
    <div class="task-actions">
      ${!closed && ignored ? '<button class="text-button" data-action="unignore">Unignore</button>' : ""}
      ${!closed && result.actionable && !ignored ? '<button class="text-button" data-action="check-tomorrow">Check tomorrow</button>' : ""}
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
      ignoredUntil: null,
      updatedAt: now,
      history: [...(item.history || []), { at: now, type: "completed" }],
    });
    await refresh();
    showToast("Task completed");
    return;
  }

  if (button.dataset.action === "unignore") {
    const now = new Date().toISOString();
    await putItem({
      ...item,
      ignoredUntil: null,
      updatedAt: now,
      history: [...(item.history || []), { at: now, type: "unignored" }],
    });
    await refresh();
    showToast("Task restored for today");
    return;
  }

  if (button.dataset.action === "check-tomorrow") {
    const nowDate = new Date();
    const until = tomorrowMidnight(nowDate);
    const now = nowDate.toISOString();
    await putItem({
      ...item,
      ignoredUntil: until.toISOString(),
      updatedAt: now,
      history: [...(item.history || []), { at: now, type: "check-tomorrow", until: until.toISOString() }],
    });
    await refresh();
    showToast("Ignored for the rest of today");
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
  const now = new Date();
  const today = dateKey(now);

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
      const pendingTasks = state.items.filter((item) => isPendingOnDate(item, day));
      const pendingCount = pendingTasks.length;
      const ignoredCount = pendingTasks.filter((item) => isIgnored(item, now)).length;
      if (pendingCount) {
        const summary = document.createElement("button");
        summary.className = "calendar-chip task start";
        summary.textContent = `${pendingCount} ${pendingCount === 1 ? "task" : "tasks"}${ignoredCount ? ` - ${ignoredCount} ignored` : ""}`;
        summary.title = "Open today's tasks";
        summary.addEventListener("click", () => {
          setSectionOpen("now", true);
          setSectionOpen("upcoming", true);
          navigateView("tasks");
          requestAnimationFrame(() => document.querySelector('[data-section="now"]')?.scrollIntoView({ block: "start" }));
        });
        cell.append(summary);
        reservedRows = 1;
      }
    }

    const items = calendarItemsForDay(day, now);
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

function calendarItemsForDay(day, now = new Date()) {
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

    const scheduledStart = availabilityStartForDate(item, day, now);
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
    els.form.elements.taskState.value = ["completed", "canceled"].includes(item?.state) ? item.state : "open";
    els.form.elements.tags.value = (item?.tags || []).join(", ");
    els.form.elements.availableFrom.value = isoToLocalInput(item?.availableFrom);
    els.form.elements.deadline.value = isoToLocalInput(item?.deadline);
    els.form.elements.latestStart.value = isoToLocalInput(item?.latestStart);

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
    const taskState = String(form.get("taskState") || "open");
    const closed = ["completed", "canceled"].includes(taskState);

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
      wakeAt: null,
      ignoredUntil: closed ? null : existing?.ignoredUntil || null,
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
  button.addEventListener("click", () => navigateView(button.dataset.view));
});
els.newButton.addEventListener("click", () => openEditor(null, state.view === "calendar" ? "event" : "task"));
els.search.addEventListener("input", () => {
  state.query = els.search.value;
  if (state.view !== "tasks") navigateView("tasks");
  else renderTasks();
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

window.addEventListener("popstate", syncViewFromLocation);
window.addEventListener("hashchange", syncViewFromLocation);

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

refresh().catch((error) => {
  console.error(error);
  document.querySelector("#app").innerHTML = `<div class="fatal">Could not open local storage. ${escapeHtml(error.message)}</div>`;
});
