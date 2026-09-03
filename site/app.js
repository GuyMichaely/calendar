import {
  actionability,
  availabilityStartForDate,
  calendarGridStart,
  dateKey,
  formatDateTime,
  isoToLocalInput,
  isEvent,
  isPendingOnDate,
  isSleeping,
  isTask,
  localInputToIso,
  nextActionableStart,
  sleepInfo,
  sortTasks,
  taskMatchesFilter,
  textMatches,
  toDate,
  tomorrowMidnight,
  upcomingHorizonEnd,
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
  horizonMode: localStorage.getItem("calendar.upcomingHorizonMode") === "boundary" ? "boundary" : "rolling",
  calendarSleepMode: localStorage.getItem("calendar.calendarSleepMode") === "ignore" ? "ignore" : "respect",
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
  calendarSleepToggle: document.querySelector("#calendar-sleep-toggle"),
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
  { id: "upcoming", label: "Upcoming", defaultOpen: true },
  { id: "waiting", label: "Waiting", defaultOpen: true },
  { id: "sleeping", label: "Sleeping", defaultOpen: true },
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
  const nowDate = new Date();
  const now = nowDate.toISOString();
  const migrated = [];

  for (const item of items) {
    if (!isTask(item)) {
      migrated.push(item);
      continue;
    }

    let updated = { ...item };
    let changed = false;
    const history = [...(item.history || [])];

    if (updated.state === "waiting") {
      const wasOldTomorrow = history.some((entry) => entry?.type === "deferred");
      const wake = toDate(updated.wakeAt);
      const existingStart = toDate(updated.availableFrom);

      updated.state = "open";
      delete updated.wakeAt;
      changed = true;

      if (wake && wasOldTomorrow) {
        updated.sleep = updated.sleep || { until: wake.toISOString(), startedAt: now };
      } else if (wake && (!existingStart || wake > existingStart)) {
        updated.availableFrom = wake.toISOString();
      }
      history.push({ at: now, type: "legacy-waiting-migrated" });
    }

    const ignoredUntil = toDate(updated.ignoredUntil);
    if (Object.prototype.hasOwnProperty.call(updated, "ignoredUntil")) {
      if (!updated.sleep && ignoredUntil && ignoredUntil > nowDate) {
        updated.sleep = { until: ignoredUntil.toISOString(), startedAt: now };
        history.push({ at: now, type: "legacy-ignore-migrated-to-sleep", until: ignoredUntil.toISOString() });
      }
      delete updated.ignoredUntil;
      changed = true;
    }

    if (Object.prototype.hasOwnProperty.call(updated, "wakeAt")) {
      delete updated.wakeAt;
      changed = true;
    }

    if (updated.sleep?.until) {
      const until = toDate(updated.sleep.until);
      if (!until || until <= nowDate) {
        updated.sleep = null;
        changed = true;
      }
    }

    if (changed) {
      updated.updatedAt = now;
      updated.history = history;
      await putItem(updated);
    }

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

  const actionable = sortTasks(
    matching.filter((task) => taskMatchesFilter(task, "now", now) && !isSleeping(task, now)),
    now,
  );

  const rowsBySection = {
    now: actionable.map((task) => ({ task })),
    upcoming: upcomingRows(matching, now),
    waiting: sortTasks(
      matching.filter((task) => taskMatchesFilter(task, "waiting", now) && !isSleeping(task, now)),
      now,
    ).map((task) => ({ task })),
    sleeping: sortTasks(
      matching.filter((task) => !["completed", "canceled"].includes(task.state) && isSleeping(task, now)),
      now,
    ).map((task) => ({ task })),
    all: sortTasks(matching.filter((task) => taskMatchesFilter(task, "all", now)), now).map((task) => ({ task })),
    completed: sortTasks(matching.filter((task) => taskMatchesFilter(task, "completed", now)), now).map((task) => ({ task })),
  };

  els.taskSections.replaceChildren();
  for (const definition of taskSectionDefinitions) {
    els.taskSections.append(taskSection(definition, rowsBySection[definition.id], now));
  }
}

function upcomingRows(tasks, now) {
  const horizonEnd = upcomingHorizonEnd(now, state.horizonDays, state.horizonMode);

  return tasks
    .filter((task) => !["completed", "canceled"].includes(task.state))
    .map((task) => ({ task, upcomingAt: nextActionableStart(task, now, { respectSleep: true }) }))
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
    empty.textContent = emptySectionText(definition.id, now);
    list.append(empty);
  } else {
    for (const row of rows) list.append(taskCard(row.task, now, row.upcomingAt));
  }

  body.append(list);
  details.append(body);
  details.addEventListener("toggle", () => setSectionOpen(definition.id, details.open));
  return details;
}

function emptySectionText(sectionId, now) {
  if (sectionId === "now") return "Nothing is actionable right now.";
  if (sectionId === "waiting") return "Nothing is waiting for a known future opportunity.";
  if (sectionId === "sleeping") return "No tasks are sleeping.";
  if (sectionId === "upcoming") {
    const horizonEnd = upcomingHorizonEnd(now, state.horizonDays, state.horizonMode);
    return `Nothing becomes actionable by ${formatDateTime(horizonEnd)}.`;
  }
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

  const controls = document.createElement("div");
  controls.className = "horizon-controls";

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

  const boundaryToggle = document.createElement("button");
  boundaryToggle.type = "button";
  boundaryToggle.className = `secondary-button boundary-toggle ${state.horizonMode === "boundary" ? "active" : ""}`;
  boundaryToggle.textContent = "End of day/week/month";
  boundaryToggle.title = "Use the end of the current day, week, or month instead of a rolling 1, 7, or 30 days.";
  boundaryToggle.setAttribute("aria-pressed", String(state.horizonMode === "boundary"));
  boundaryToggle.addEventListener("click", () => {
    state.horizonMode = state.horizonMode === "boundary" ? "rolling" : "boundary";
    localStorage.setItem("calendar.upcomingHorizonMode", state.horizonMode);
    renderTasks();
  });

  controls.append(control, boundaryToggle);
  wrap.append(controls);
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
  const sleep = sleepInfo(task, now);
  if (sleep.sleeping) article.classList.add("sleeping-task");
  const tags = (task.tags || []).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("");
  const timing = [];
  if (upcomingAt) timing.push(`Next available ${formatDateTime(upcomingAt)}`);
  if (task.availableFrom) timing.push(`Starts ${formatDateTime(task.availableFrom)}`);
  if (task.deadline) timing.push(`Due ${formatDateTime(task.deadline)}`);
  if (task.latestStart) timing.push(`Latest start ${formatDateTime(task.latestStart)}`);
  if (sleep.sleeping) timing.push(sleep.indefinite ? "Sleeping indefinitely" : `Sleeping until ${formatDateTime(sleep.until)}`);

  const schedule = task.availabilitySchedule;
  if (schedule?.enabled) {
    const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const days = (schedule.days || []).map((d) => names[d]).join(", ");
    timing.push(`${days || "No days"} ${schedule.start || ""}-${schedule.end || ""}`);
  }

  const closed = ["completed", "canceled"].includes(task.state);
  const statusText = sleep.sleeping
    ? sleep.indefinite
      ? "Sleeping indefinitely"
      : `Sleeping until ${formatDateTime(sleep.until)}`
    : result.reason;
  const futureAvailable = toDate(task.availableFrom);
  const canConvertWaitToSleep = !sleep.sleeping && futureAvailable && futureAvailable > now;

  article.innerHTML = `
    <div class="task-main">
      ${closed ? '<span class="complete-indicator" aria-hidden="true">✓</span>' : '<button class="complete-button" data-action="complete" aria-label="Mark complete" title="Mark complete"></button>'}
      <div class="task-copy">
        <div class="task-title-row">
          <h3>${escapeHtml(task.title || "Untitled task")}</h3>
          <span class="status-pill ${result.actionable && !sleep.sleeping ? "ready" : sleep.sleeping ? "sleeping" : "quiet"}">${escapeHtml(statusText)}</span>
        </div>
        ${task.notes ? `<p class="notes">${escapeHtml(task.notes)}</p>` : ""}
        ${timing.length ? `<div class="timing">${timing.map((x) => `<span>${escapeHtml(x)}</span>`).join("")}</div>` : ""}
        ${tags ? `<div class="tags">${tags}</div>` : ""}
        ${(task.attachments || []).length ? `<div class="attachments">${task.attachments.map((a, i) => `<button class="attachment" data-action="attachment" data-attachment-index="${i}">Attachment: ${escapeHtml(a.name || "Attachment")}</button>`).join("")}</div>` : ""}
      </div>
    </div>
    <div class="task-actions">
      ${!closed && sleep.sleeping ? '<button class="text-button" data-action="wake">Wake</button>' : ""}
      ${!closed && sleep.sleeping && !sleep.indefinite ? '<button class="text-button" data-action="sleep-to-wait">Wait instead</button>' : ""}
      ${!closed && !sleep.sleeping ? '<button class="text-button" data-action="sleep-tomorrow">Sleep</button>' : ""}
      ${!closed && canConvertWaitToSleep ? '<button class="text-button" data-action="wait-to-sleep">Sleep instead</button>' : ""}
      <button class="text-button" data-action="edit">Edit</button>
    </div>
  `;

  article.addEventListener("click", handleTaskAction);
  return article;
}

async function saveTaskMutation(item, patch, historyEntry, toast) {
  const now = new Date().toISOString();
  await putItem({
    ...item,
    ...patch,
    updatedAt: now,
    history: [...(item.history || []), { at: now, ...historyEntry }],
  });
  await refresh();
  showToast(toast);
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
      sleep: null,
      updatedAt: now,
      history: [...(item.history || []), { at: now, type: "completed" }],
    });
    await refresh();
    showToast("Task completed");
    return;
  }

  if (button.dataset.action === "wake") {
    await saveTaskMutation(item, { sleep: null }, { type: "woke" }, "Task is awake");
    return;
  }

  if (button.dataset.action === "sleep-tomorrow") {
    const nowDate = new Date();
    const until = tomorrowMidnight(nowDate);
    await saveTaskMutation(
      item,
      { sleep: { until: until.toISOString(), startedAt: nowDate.toISOString() } },
      { type: "slept", until: until.toISOString() },
      "Sleeping until tomorrow",
    );
    return;
  }

  if (button.dataset.action === "sleep-to-wait") {
    const sleep = sleepInfo(item, new Date());
    if (!sleep.sleeping || sleep.indefinite) return;
    const existingStart = toDate(item.availableFrom);
    const waitUntil = existingStart && existingStart > sleep.until ? existingStart : sleep.until;
    await saveTaskMutation(
      item,
      { sleep: null, availableFrom: waitUntil.toISOString() },
      { type: "sleep-converted-to-wait", until: waitUntil.toISOString() },
      "Converted sleep to waiting",
    );
    return;
  }

  if (button.dataset.action === "wait-to-sleep") {
    const available = toDate(item.availableFrom);
    if (!available || available <= new Date()) return;
    const now = new Date().toISOString();
    await saveTaskMutation(
      item,
      { availableFrom: null, sleep: { until: available.toISOString(), startedAt: now } },
      { type: "wait-converted-to-sleep", until: available.toISOString() },
      "Converted waiting to sleep",
    );
  }
}

function renderCalendar() {
  const month = state.calendarMonth;
  els.monthLabel.textContent = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(month);
  els.calendarSleepToggle.classList.toggle("active", state.calendarSleepMode === "respect");
  els.calendarSleepToggle.setAttribute("aria-pressed", String(state.calendarSleepMode === "respect"));
  els.calendarSleepToggle.textContent = state.calendarSleepMode === "respect" ? "Respect sleep" : "Ignore sleep";
  els.calendarSleepToggle.title = state.calendarSleepMode === "respect"
    ? "Sleeping tasks are treated as unavailable until they wake."
    : "Sleep is ignored when projecting task opportunities. Sleeping projections are shown differently.";
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
      const sleepingCount = pendingTasks.filter((item) => isSleeping(item, now)).length;
      if (pendingCount) {
        const summary = document.createElement("button");
        summary.className = "calendar-chip task start";
        summary.textContent = `${pendingCount} ${pendingCount === 1 ? "task" : "tasks"}${sleepingCount ? ` - ${sleepingCount} sleeping` : ""}`;
        summary.title = "Open today's tasks";
        summary.addEventListener("click", () => {
          setSectionOpen("now", true);
          setSectionOpen("upcoming", true);
          setSectionOpen("sleeping", true);
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
  const respectSleep = state.calendarSleepMode === "respect";

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

    const scheduledStart = availabilityStartForDate(item, day, now, { respectSleep });
    if (scheduledStart) {
      const sleep = sleepInfo(item, now);
      const bypassesSleep = !respectSleep && sleep.sleeping && (sleep.indefinite || scheduledStart < sleep.until);
      entries.push({
        kind: "task",
        role: bypassesSleep ? "start sleep-bypassed" : "start",
        label: `${shortTime(scheduledStart)} ${item.title}`,
        title: bypassesSleep
          ? `${item.title}: projected action window while sleep is ignored`
          : `${item.title}: projected action window`,
        source: item,
        sort: scheduledStart.getTime(),
      });
    }

    const sleep = sleepInfo(item, now);
    if (sleep.sleeping && !sleep.indefinite && dateKey(sleep.until) === key) {
      entries.push({
        kind: "task",
        role: "sleep",
        label: `Sleep ends: ${item.title}`,
        title: `${item.title}: sleep ends ${formatDateTime(sleep.until)}`,
        source: item,
        sort: sleep.until.getTime(),
      });
    }

    for (const [field, role, prefix] of [
      ["availableFrom", "start", "Start:"],
      ["latestStart", "latest", "Latest:"],
      ["deadline", "due", "Due:"],
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

    const sleep = sleepInfo(item, new Date());
    els.form.elements.sleepMode.value = sleep.sleeping ? (sleep.indefinite ? "indefinite" : "until") : "awake";
    els.form.elements.sleepUntil.value = sleep.sleeping && !sleep.indefinite
      ? isoToLocalInput(sleep.until)
      : isoToLocalInput(tomorrowMidnight(new Date()));
    syncSleepFields();

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

function syncSleepFields() {
  const enabled = els.form.elements.sleepMode.value === "until";
  const field = document.querySelector("#sleep-until-field");
  field.classList.toggle("disabled", !enabled);
  els.form.elements.sleepUntil.disabled = !enabled;
}

function sleepFromEditor(existing, closed, now) {
  if (closed) return null;
  const mode = els.form.elements.sleepMode.value;
  if (mode === "indefinite") {
    return { until: null, startedAt: existing?.sleep?.startedAt || now };
  }
  if (mode === "until") {
    const until = localInputToIso(els.form.elements.sleepUntil.value);
    if (until && toDate(until) > new Date()) {
      return { until, startedAt: existing?.sleep?.startedAt || now };
    }
  }
  return null;
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
    const sleep = sleepFromEditor(existing?.kind === "task" ? existing : null, closed, now);
    const history = [...(existing?.kind === "task" ? existing.history || [] : [{ at: now, type: "created" }])];
    const oldSleep = existing?.kind === "task" ? existing.sleep || null : null;
    if (JSON.stringify(oldSleep) !== JSON.stringify(sleep)) {
      history.push({ at: now, type: sleep ? "sleep-updated" : "woke", until: sleep?.until ?? null });
    }

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
      sleep,
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
els.calendarSleepToggle.addEventListener("click", () => {
  state.calendarSleepMode = state.calendarSleepMode === "respect" ? "ignore" : "respect";
  localStorage.setItem("calendar.calendarSleepMode", state.calendarSleepMode);
  renderCalendar();
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
els.form.elements.sleepMode.addEventListener("change", syncSleepFields);
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
