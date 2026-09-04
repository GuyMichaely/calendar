import {
  dateKey,
  isSleeping,
  isTask,
  nextActionableStart,
  nextAvailabilityStart,
  sleepInfo,
  toDate,
} from "./domain.js";
import { listItemsSnapshot } from "./storage.js";

const grid = document.querySelector("#calendar-grid");
const monthLabel = document.querySelector("#month-label");
let observer = null;
let scheduled = false;

function currentCalendarMonth() {
  const label = monthLabel?.textContent?.trim();
  if (!label) return null;

  const formatter = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });
  const currentYear = new Date().getFullYear();
  for (let year = currentYear - 50; year <= currentYear + 50; year += 1) {
    for (let month = 0; month < 12; month += 1) {
      const candidate = new Date(year, month, 1);
      if (formatter.format(candidate) === label) return candidate;
    }
  }
  return null;
}

function gridDates(month) {
  const start = new Date(month.getFullYear(), month.getMonth(), 1);
  start.setDate(start.getDate() - start.getDay());
  start.setHours(0, 0, 0, 0);

  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
}

function projectedTaskStart(task, now, respectSleep) {
  const sleep = sleepInfo(task, now);

  if (task.availabilitySchedule?.enabled) {
    if (respectSleep && sleep.sleeping) {
      if (sleep.indefinite) return null;
      return nextActionableStart(task, now, { respectSleep: true });
    }
    return nextAvailabilityStart(task, now);
  }

  const available = toDate(task.availableFrom);
  if (!available) return null;

  let projected = available;
  if (respectSleep && sleep.sleeping) {
    if (sleep.indefinite) return null;
    if (sleep.until > projected) projected = sleep.until;
  }

  const latestStart = toDate(task.latestStart);
  if (latestStart && projected > latestStart) return null;
  return projected;
}

function shortTime(value) {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(value);
}

function openTaskEditor(taskId) {
  document.querySelector('[data-view="tasks"]')?.click();
  requestAnimationFrame(() => {
    const card = document.querySelector(`.task-card[data-id="${CSS.escape(taskId)}"]`);
    card?.querySelector('[data-action="edit"]')?.click();
  });
}

function removeExistingTaskStartChips() {
  for (const chip of grid.querySelectorAll(".calendar-chip.task.start")) {
    if (chip.title === "Open today's tasks") continue;
    chip.remove();
  }
}

function insertProjectedStarts(entriesByDate, cellsByDate) {
  for (const [key, entries] of entriesByDate) {
    const cell = cellsByDate.get(key);
    if (!cell) continue;

    entries.sort((a, b) => a.start - b.start || a.title.localeCompare(b.title));
    const fragment = document.createDocumentFragment();

    for (const entry of entries) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = `calendar-chip task ${entry.bypassesSleep ? "start sleep-bypassed" : "start"}`;
      chip.textContent = `${shortTime(entry.start)} ${entry.title}`;
      chip.title = entry.bypassesSleep
        ? `${entry.title}: projected start while sleep is ignored`
        : `${entry.title}: projected start`;
      chip.addEventListener("click", () => openTaskEditor(entry.id));
      fragment.append(chip);
    }

    const todaySummary = [...cell.querySelectorAll(".calendar-chip")].find((chip) => chip.title === "Open today's tasks");
    const anchor = todaySummary || cell.querySelector(".day-number");
    anchor?.after(fragment);
  }
}

async function normalizeCalendarStarts() {
  scheduled = false;
  if (!grid || grid.closest("[hidden]") || !grid.children.length) return;

  const month = currentCalendarMonth();
  if (!month) return;

  observer?.disconnect();
  try {
    const dates = gridDates(month);
    const cells = [...grid.querySelectorAll(".calendar-day")];
    const cellsByDate = new Map();
    cells.forEach((cell, index) => {
      const day = dates[index];
      if (day) cellsByDate.set(dateKey(day), cell);
    });

    removeExistingTaskStartChips();

    const now = new Date();
    const respectSleep = localStorage.getItem("calendar.calendarSleepMode") !== "ignore";
    const entriesByDate = new Map();
    const items = await listItemsSnapshot();

    for (const task of items) {
      if (!isTask(task) || ["completed", "canceled"].includes(task.state)) continue;
      const start = projectedTaskStart(task, now, respectSleep);
      if (!start) continue;

      const key = dateKey(start);
      if (!cellsByDate.has(key)) continue;

      const sleep = sleepInfo(task, now);
      const bypassesSleep = !respectSleep && isSleeping(task, now) && (sleep.indefinite || start < sleep.until);
      if (!entriesByDate.has(key)) entriesByDate.set(key, []);
      entriesByDate.get(key).push({
        id: task.id,
        title: task.title || "Untitled task",
        start,
        bypassesSleep,
      });
    }

    insertProjectedStarts(entriesByDate, cellsByDate);
  } finally {
    observer?.observe(grid, { childList: true, subtree: true });
  }
}

function scheduleNormalize() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => normalizeCalendarStarts().catch(console.error));
}

if (grid) {
  observer = new MutationObserver(scheduleNormalize);
  observer.observe(grid, { childList: true, subtree: true });
  scheduleNormalize();
}
