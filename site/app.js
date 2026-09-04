import { dateKey, sleepInfo, toDate, tomorrowMidnight } from "./domain.js";
import { createEditor } from "./editor.js";
import { createKeyboardController } from "./keyboard.js";
import { exportData, importData, listItems, putItem } from "./storage.js";
import { createToaster, escapeHtml } from "./ui.js";
import { createCalendarView } from "./views/calendar-view.js";
import { createTasksView } from "./views/tasks-view.js";

function viewFromHash() {
  return location.hash === "#calendar" ? "calendar" : "tasks";
}

if (!["#tasks", "#calendar"].includes(location.hash)) history.replaceState(null, "", "#tasks");

const storedHorizon = localStorage.getItem("calendar.upcomingHorizon");
const parsedHorizon = Number(storedHorizon);
const state = {
  items: [],
  view: viewFromHash(),
  query: "",
  calendarMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  compact: localStorage.getItem("calendar.compactTasks") === "1",
  horizonDays: storedHorizon === "off" ? null : [1, 7, 30].includes(parsedHorizon) ? parsedHorizon : 7,
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
  menu: document.querySelector("#data-menu"),
  exportButton: document.querySelector("#export-data"),
  importButton: document.querySelector("#import-data"),
  importInput: document.querySelector("#import-input"),
};

const showToast = createToaster();
const getItem = (id) => state.items.find((item) => item.id === id) || null;

async function refresh() {
  state.items = await listItems();
  render();
}

function navigateView(view, { replace = false } = {}) {
  const target = view === "calendar" ? "calendar" : "tasks";
  const hash = `#${target}`;
  state.view = target;
  if (location.hash !== hash) history[replace ? "replaceState" : "pushState"](null, "", hash);
  render();
}

function syncViewFromLocation() {
  state.view = viewFromHash();
  render();
}

async function saveTaskMutation(item, patch, historyEntry, message) {
  const now = new Date().toISOString();
  await putItem({
    ...item,
    ...patch,
    updatedAt: now,
    history: [...(item.history || []), { at: now, ...historyEntry }],
  });
  await refresh();
  showToast(message);
}

const editor = createEditor({ getItem, onChanged: refresh, showToast });
const keyboard = createKeyboardController({
  taskSections: els.taskSections,
  showToast,
  onHistoryApplied: refresh,
});

async function handleTaskAction({ action, id, attachmentIndex }) {
  const item = getItem(id);
  if (!item) return;

  if (action === "edit") {
    editor.open(item);
    return;
  }
  if (action === "sleep-custom") {
    editor.openSleep(item);
    return;
  }
  if (action === "attachment") {
    const attachment = item.attachments?.[attachmentIndex];
    if (!attachment?.blob) return;
    const url = URL.createObjectURL(attachment.blob);
    window.open(url, "_blank", "noopener,noreferrer");
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return;
  }
  if (action === "complete") {
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
  if (action === "wake") {
    await saveTaskMutation(item, { sleep: null }, { type: "woke" }, "Task is awake");
    return;
  }
  if (action === "sleep-tomorrow") {
    const now = new Date();
    const until = tomorrowMidnight(now);
    await saveTaskMutation(
      item,
      { sleep: { until: until.toISOString(), startedAt: now.toISOString() } },
      { type: "slept", until: until.toISOString() },
      "Sleeping until tomorrow",
    );
    return;
  }
  if (action === "sleep-to-wait") {
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
  if (action === "wait-to-sleep") {
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

function updateTaskPreferences(patch) {
  if (Object.hasOwn(patch, "compact")) {
    state.compact = patch.compact;
    localStorage.setItem("calendar.compactTasks", state.compact ? "1" : "0");
  }
  if (Object.hasOwn(patch, "horizonDays")) {
    state.horizonDays = patch.horizonDays;
    localStorage.setItem("calendar.upcomingHorizon", state.horizonDays === null ? "off" : String(state.horizonDays));
  }
  if (Object.hasOwn(patch, "horizonMode")) {
    state.horizonMode = patch.horizonMode;
    localStorage.setItem("calendar.upcomingHorizonMode", state.horizonMode);
  }
  renderTasks();
}

const tasksView = createTasksView({
  panel: els.taskPanel,
  sections: els.taskSections,
  count: els.taskCount,
  compactToggle: els.compactToggle,
  onAction: (detail) => handleTaskAction(detail).catch(console.error),
  onPreferencesChanged: updateTaskPreferences,
  onRendered: keyboard.enhance,
});

const calendarView = createCalendarView({
  grid: els.calendarGrid,
  monthLabel: els.monthLabel,
  sleepToggle: els.calendarSleepToggle,
  onOpenItem(id) {
    const item = getItem(id);
    if (item) editor.open(item);
  },
  onCreateEvent(day) {
    editor.open(null, "event", { eventDay: day });
  },
  onOpenTodayTasks() {
    localStorage.setItem("calendar.section.now", "open");
    localStorage.setItem("calendar.section.upcoming", "open");
    navigateView("tasks");
    requestAnimationFrame(() => document.querySelector('[data-section="now"]')?.scrollIntoView({ block: "start" }));
  },
  onSleepModeChanged(mode) {
    state.calendarSleepMode = mode;
    localStorage.setItem("calendar.calendarSleepMode", mode);
    renderCalendar();
  },
});

function renderTasks() {
  tasksView.render({
    items: state.items,
    query: state.query,
    compact: state.compact,
    horizonDays: state.horizonDays,
    horizonMode: state.horizonMode,
    now: new Date(),
  });
}

function renderCalendar() {
  calendarView.render({
    items: state.items,
    query: state.query,
    month: state.calendarMonth,
    sleepMode: state.calendarSleepMode,
    now: new Date(),
  });
}

function render() {
  els.navButtons.forEach((button) => button.classList.toggle("active", button.dataset.view === state.view));
  els.taskPanel.hidden = state.view !== "tasks";
  els.calendarPanel.hidden = state.view !== "calendar";
  els.search.placeholder = state.view === "calendar" ? "Search calendar" : "Search tasks";
  if (state.view === "tasks") renderTasks();
  else renderCalendar();
}

els.navButtons.forEach((button) => button.addEventListener("click", () => navigateView(button.dataset.view)));
els.newButton.addEventListener("click", () => editor.open(null, state.view === "calendar" ? "event" : "task"));
els.search.addEventListener("input", () => {
  state.query = els.search.value;
  render();
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

els.taskSections.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.ctrlKey || event.metaKey || event.altKey) return;
  const card = event.target instanceof Element ? event.target.closest(".task-card") : null;
  if (!card || document.activeElement !== card) return;
  event.preventDefault();
  const item = getItem(card.dataset.id);
  if (item) editor.open(item);
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
  els.menu.hidePopover?.();
});
els.importButton.addEventListener("click", () => {
  els.importInput.click();
  els.menu.hidePopover?.();
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

setInterval(() => {
  if (!document.querySelector("dialog[open]")) render();
}, 30_000);

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

refresh().catch((error) => {
  console.error(error);
  els.app.innerHTML = `<div class="fatal">Could not open local storage. ${escapeHtml(error.message)}</div>`;
});
