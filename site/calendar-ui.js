import { dateKey, isEvent, isTask, textMatches } from "./domain.js";
import { listItemsSnapshot } from "./storage.js";

const grid = document.querySelector("#calendar-grid");
const calendarPanel = document.querySelector("#calendar-panel");
const search = document.querySelector("#search");
const editorDialog = document.querySelector("#editor-dialog");
const editorForm = document.querySelector("#editor-form");
let filterScheduled = false;

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

function chooser() {
  let dialog = document.querySelector("#day-create-dialog");
  if (dialog) return dialog;
  dialog = document.createElement("dialog");
  dialog.id = "day-create-dialog";
  dialog.className = "editor-dialog day-create-dialog";
  dialog.innerHTML = `
    <form method="dialog">
      <div class="dialog-header">
        <div><h2>Add item</h2><p class="muted" data-day-label></p></div>
        <button type="button" class="icon-button" aria-label="Close" data-close>×</button>
      </div>
      <div class="day-create-actions">
        <button type="button" class="primary-button" data-kind="event">Event</button>
        <button type="button" class="secondary-button" data-kind="task">Task</button>
      </div>
    </form>`;
  document.body.append(dialog);
  dialog.querySelector("[data-close]").addEventListener("click", () => dialog.close());
  return dialog;
}

function openForDay(kind, day) {
  if (editorDialog) editorDialog.dataset.itemId = "";
  document.querySelector("#new-item")?.click();
  requestAnimationFrame(() => {
    const date = new Date(day);
    if (kind === "event") {
      date.setHours(9, 0, 0, 0);
      const radio = document.querySelector("#kind-event");
      radio.checked = true;
      radio.dispatchEvent(new Event("change", { bubbles: true }));
      editorForm.elements.eventStart.value = localDateInput(date);
      date.setDate(date.getDate() + 1);
      editorForm.elements.eventEnd.value = localDateInput(date);
    } else {
      date.setHours(0, 0, 0, 0);
      const radio = document.querySelector("#kind-task");
      radio.checked = true;
      radio.dispatchEvent(new Event("change", { bubbles: true }));
      editorForm.elements.availableFrom.value = localDateInput(date);
    }
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
  if (!day) return;

  const dialog = chooser();
  dialog.querySelector("[data-day-label]").textContent = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(day);
  dialog.querySelectorAll("[data-kind]").forEach((button) => {
    button.onclick = () => {
      dialog.close();
      openForDay(button.dataset.kind, day);
    };
  });
  dialog.showModal();
});

async function filterCalendar() {
  filterScheduled = false;
  if (!grid || calendarPanel?.hidden) return;
  const query = search?.value?.trim() || "";
  const items = await listItemsSnapshot();
  const byId = new Map(items.map((item) => [item.id, item]));
  const month = currentMonth();
  const dates = month ? gridDates(month) : [];
  const cells = [...grid.querySelectorAll(".calendar-day")];

  cells.forEach((cell, index) => {
    const key = dates[index] ? dateKey(dates[index]) : "";
    for (const chip of cell.querySelectorAll(".calendar-chip")) {
      if (chip.title === "Open today's tasks") continue;
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
if (grid) new MutationObserver(scheduleFilter).observe(grid, { childList: true, subtree: true });
scheduleFilter();
