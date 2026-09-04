import { isTask, nextActionableStart, sleepInfo } from "./domain.js";
import { listItemsSnapshot } from "./storage.js";

const taskSections = document.querySelector("#task-sections");
const tasksPanel = document.querySelector("#tasks-panel");
const editorDialog = document.querySelector("#editor-dialog");
let scheduled = false;
let observer = null;

function friendlyWhen(date, now = new Date()) {
  if (!date) return "";
  const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const days = Math.round((target - today) / 86400000);
  if (days === 0) return `today · ${time}`;
  if (days === 1) return `tomorrow · ${time}`;
  if (days > 1 && days < 7) return `${new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(date)} · ${time}`;
  return `${new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date)} · ${time}`;
}

function displayTitle(task) {
  const raw = String(task?.title || "");
  const visible = raw.replace(/[\p{Cf}\p{Cc}\s]/gu, "");
  return visible ? raw : "Untitled task";
}

function openCardEditor(card) {
  if (!card) return;
  if (editorDialog) editorDialog.dataset.itemId = card.dataset.id || "";
  card.querySelector('[data-action="edit"]')?.click();
}

function enhanceTitle(card, task) {
  const heading = card.querySelector(".task-title-row h3");
  if (!heading) return;
  const title = displayTitle(task);
  let link = heading.querySelector(".task-title-link");
  if (!link) {
    link = document.createElement("a");
    link.href = "#";
    link.className = "task-title-link";
    link.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openCardEditor(card);
    });
    heading.replaceChildren(link);
  }
  link.textContent = title;
  link.setAttribute("aria-label", `Edit ${title}`);
  link.title = `Edit ${title}`;
}

async function normalizeTasks() {
  scheduled = false;
  if (!taskSections) return;

  const items = await listItemsSnapshot();
  const byId = new Map(items.map((item) => [item.id, item]));
  const now = new Date();

  observer?.disconnect();
  try {
    for (const card of taskSections.querySelectorAll(".task-card")) {
      const task = byId.get(card.dataset.id);
      if (task && isTask(task)) enhanceTitle(card, task);
    }

    const section = taskSections.querySelector('[data-section="upcoming"]');
    if (!section) return;

    for (const card of section.querySelectorAll(".task-card")) {
      const task = byId.get(card.dataset.id);
      if (!task || !isTask(task)) continue;
      card.querySelector(".availability-summary")?.remove();

      const sleep = sleepInfo(task, now);
      const next = nextActionableStart(task, now, { respectSleep: sleep.sleeping });
      let summary = "";
      if (sleep.sleeping && sleep.indefinite) {
        summary = "Sleeping indefinitely";
      } else if (sleep.sleeping) {
        const sameMoment = next && Math.abs(next.getTime() - sleep.until.getTime()) < 60000;
        summary = sameMoment || !next
          ? `Sleeping until ${friendlyWhen(sleep.until, now)}`
          : `Sleeping until ${friendlyWhen(sleep.until, now)} · available ${friendlyWhen(next, now)}`;
      } else if (next) {
        summary = `Available ${friendlyWhen(next, now)}`;
      }

      if (summary) {
        const line = document.createElement("div");
        line.className = "availability-summary";
        line.textContent = summary;
        card.querySelector(".task-title-row")?.after(line);
      }

      for (const span of card.querySelectorAll(".timing span")) {
        const text = span.textContent.trim();
        if (text.startsWith("Next available ") || text.startsWith("Starts ") || text.startsWith("Sleeping ")) span.remove();
      }
      if (!card.querySelector(".timing span")) card.querySelector(".timing")?.remove();
    }
  } finally {
    observer?.observe(taskSections, { childList: true, subtree: true });
  }
}

function scheduleNormalize() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => normalizeTasks().catch(console.error));
}

if (taskSections) {
  observer = new MutationObserver(scheduleNormalize);
  observer.observe(taskSections, { childList: true, subtree: true });
  scheduleNormalize();
}
if (tasksPanel) new MutationObserver(scheduleNormalize).observe(tasksPanel, { attributes: true, attributeFilter: ["class"] });
window.addEventListener("calendar:history-applied", scheduleNormalize);
window.addEventListener("calendar:history-state", () => setTimeout(scheduleNormalize, 0));

document.addEventListener(
  "keydown",
  (event) => {
    const card = event.target instanceof Element ? event.target.closest(".task-card") : null;
    if (event.key !== "Enter" || !card || document.activeElement !== card || event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openCardEditor(card);
  },
  true,
);
