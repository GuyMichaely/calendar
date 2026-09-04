import { dateKey, isEvent, isPendingOnDate, isSleeping, isTask, textMatches } from "./domain.js";
import { listItemsSnapshot } from "./storage.js";

const grid = document.querySelector("#calendar-grid");
const calendarPanel = document.querySelector("#calendar-panel");
const search = document.querySelector("#search");
const editorDialog = document.querySelector("#editor-dialog");
const editorForm = document.querySelector("#editor-form");
let filterScheduled = false;
let gridObserver = null;

function currentMonth() {
  const label = document.querySelector("#month-label")?.textContent?.trim();
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

function localDateInput(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function openEventForDay(day) {
  if (editorDialog) editorDialog.dataset.itemId = "";
  document.querySelector("#new-item")?.click();
  requestAnimationFrame(() => {
    const date = new Date(day);
    date.setHours(9, 0, 0, 0);
    const radio = document.querySelector("#kind-event");
    radio.checked = true;
    radio.dispatchEvent(new Event("change", { bubbles: true }));
    editorForm.elements.eventStart.value = localDateInput(date);
    date.setDate(date.getDate() + 1);
    editorForm.elements.eventEnd.value = localDateInput(date);
    editorForm.elements.title.focus();
  });
}

grid?.addEventListener("click", (event) => {
  const cell = event.target instanceof Element ? event.target.closest(".calendar-day") : null;
  if (!cell || event.target.closest("button, a, input, select, textarea")) return;
  const month = currentMonth();
  if (!month) return;
  const cells = [...grid.querySelectorAll(".calendar-day")];
  const day = gridDates(month)[cells.indexOf(cell)];
  if (day) openEventForDay(day);
});

function removeSleepEndMarkers() {
  grid?.querySelectorAll(".calendar-chip.task.sleep").forEach((chip) => chip.remove());
  document.querySelector(".calendar-legend .legend-dot.sleep")?.closest("span")?.remove();
}

function summaryText(tasks, query) {
  const sleeping = tasks.filter((item) => isSleeping(item, new Date())).length;
  const noun = tasks.length === 1 ? "task" : "tasks";
  const prefix = query ? `${tasks.length} matching ${noun}` : `${tasks.length} ${noun}`;
  return `${prefix}${sleeping ? ` - ${sleeping} sleeping` : ""}`;
}

async function filterCalendar() {
  filterScheduled = false;
  if (!grid || calendarPanel?.hidden) return;

  // This pass mutates calendar UI derived from the rendered grid. Disconnect its
  // own observer while doing so, otherwise text/node writes can recursively
  // schedule another filtering pass. The projection observer may still react to
  // a real structural change, so all writes below are idempotent.
  gridObserver?.disconnect();
  try {
    removeSleepEndMarkers();

    const query = search?.value?.trim() || "";
    const items = await listItemsSnapshot();
    const byId = new Map(items.map((item) => [item.id, item]));
    const month = currentMonth();
    const dates = month ? gridDates(month) : [];
    const cells = [...grid.querySelectorAll(".calendar-day")];

    cells.forEach((cell, index) => {
      const day = dates[index];
      const key = day ? dateKey(day) : "";
      const todaySummary = [...cell.querySelectorAll(".calendar-chip")].find((chip) => chip.title === "Open today's tasks");

      if (todaySummary && day) {
        const pending = items.filter((item) => isTask(item) && isPendingOnDate(item, day));
        const matching = query ? pending.filter((item) => textMatches(item, query)) : pending;
        const nextText = summaryText(matching, query);
        if (todaySummary.textContent !== nextText) todaySummary.textContent = nextText;
        todaySummary.classList.toggle("search-dimmed", !!query && matching.length === 0);
      }

      for (const chip of cell.querySelectorAll(".calendar-chip")) {
        if (chip === todaySummary) continue;
        if (!chip.dataset.itemId) {
          const candidate = items.find((item) => {
            if (isEvent(item)) return dateKey(item.start) === key && chip.title === item.title;
            if (!isTask(item)) return false;
            return chip.title === item.title || chip.title?.startsWith(`${item.title}:`) || chip.textContent.includes(item.title || "Untitled task");
          });
          if (candidate) chip.dataset.itemId = candidate.id;
        }
        const item = byId.get(chip.dataset.itemId);
        const matches = !query || (item ? textMatches(item, query) : chip.textContent.toLowerCase().includes(query.toLowerCase()));
        chip.classList.toggle("search-dimmed", !matches);
      }
    });
  } finally {
    gridObserver?.observe(grid, { childList: true, subtree: true });
  }
}

function scheduleFilter() {
  if (filterScheduled) return;
  filterScheduled = true;
  requestAnimationFrame(() => filterCalendar().catch(console.error));
}

document.addEventListener(
  "input",
  (event) => {
    if (event.target !== search || calendarPanel?.hidden) return;
    event.stopImmediatePropagation();
    scheduleFilter();
  },
  true,
);

document.querySelector('[data-view="tasks"]')?.addEventListener("click", () => {
  setTimeout(() => search?.dispatchEvent(new Event("input", { bubbles: true })), 0);
});
if (grid) {
  gridObserver = new MutationObserver(scheduleFilter);
  gridObserver.observe(grid, { childList: true, subtree: true });
}
window.addEventListener("calendar:history-applied", scheduleFilter);
scheduleFilter();
