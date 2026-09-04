import {
  actionability,
  formatDateTime,
  isSleeping,
  nextActionableStart,
  sleepInfo,
  sortTasks,
  taskMatchesFilter,
  textMatches,
  toDate,
  upcomingHorizonEnd,
} from "../domain.js";
import { escapeHtml, friendlyWhen } from "../ui.js";

const SECTION_DEFINITIONS = [
  { id: "now", label: "Can do now", defaultOpen: true },
  { id: "upcoming", label: "Upcoming", defaultOpen: true },
  { id: "all", label: "All open", defaultOpen: false },
  { id: "completed", label: "Completed", defaultOpen: false },
];

function getSectionOpen(definition) {
  const stored = localStorage.getItem(`calendar.section.${definition.id}`);
  if (stored === "open") return true;
  if (stored === "closed") return false;
  return definition.defaultOpen;
}

function setSectionOpen(sectionId, open) {
  localStorage.setItem(`calendar.section.${sectionId}`, open ? "open" : "closed");
}

function horizonLabel(days, mode) {
  if (mode !== "boundary") return `${days}d`;
  if (days === 1) return "Today";
  if (days === 7) return "This week";
  return "This month";
}

function sectionLabel(definition, horizonDays) {
  if (definition.id !== "upcoming") return definition.label;
  return horizonDays === null ? "Waiting" : "Upcoming";
}

function emptySectionText(sectionId, now, horizonDays, horizonMode) {
  if (sectionId === "now") return "Nothing is actionable right now.";
  if (sectionId === "upcoming") {
    if (horizonDays === null) return "Nothing is waiting for a known future opportunity.";
    return `Nothing becomes actionable by ${formatDateTime(upcomingHorizonEnd(now, horizonDays, horizonMode))}.`;
  }
  if (sectionId === "completed") return "No completed tasks.";
  return "No open tasks.";
}

function upcomingRows(tasks, now, horizonDays, horizonMode) {
  const horizonEnd = horizonDays === null ? null : upcomingHorizonEnd(now, horizonDays, horizonMode);
  return tasks
    .filter((task) => !["completed", "canceled"].includes(task.state))
    .filter((task) => !isSleeping(task, now))
    .map((task) => ({ task, upcomingAt: nextActionableStart(task, now) }))
    .filter(({ upcomingAt }) => upcomingAt && upcomingAt > now && (!horizonEnd || upcomingAt <= horizonEnd))
    .sort((a, b) => {
      const byTime = a.upcomingAt.getTime() - b.upcomingAt.getTime();
      if (byTime) return byTime;
      return String(a.task.title || "").localeCompare(String(b.task.title || ""));
    });
}

function displayTitle(task) {
  const raw = String(task?.title || "");
  return raw.replace(/[\p{Cf}\p{Cc}\s]/gu, "") ? raw : "Untitled task";
}

function availabilitySummary(task, now, upcomingAt) {
  const sleep = sleepInfo(task, now);
  const next = upcomingAt || nextActionableStart(task, now, { respectSleep: sleep.sleeping });
  if (sleep.sleeping && sleep.indefinite) return "Sleeping indefinitely";
  if (sleep.sleeping) {
    const sameMoment = next && Math.abs(next.getTime() - sleep.until.getTime()) < 60000;
    if (sameMoment || !next) return `Sleeping until ${friendlyWhen(sleep.until, now)}`;
    return `Sleeping until ${friendlyWhen(sleep.until, now)} · available ${friendlyWhen(next, now)}`;
  }
  return next ? `Available ${friendlyWhen(next, now)}` : "";
}

function taskCard(task, now, upcomingAt = null, showAvailability = false) {
  const article = document.createElement("article");
  article.className = "task-card";
  article.dataset.id = task.id;
  article.tabIndex = -1;

  const result = actionability(task, now);
  const sleep = sleepInfo(task, now);
  if (sleep.sleeping) article.classList.add("sleeping-task");

  const tags = (task.tags || []).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("");
  const timing = [];
  if (task.deadline) timing.push(`Due ${formatDateTime(task.deadline)}`);
  if (task.latestStart) timing.push(`Latest start ${formatDateTime(task.latestStart)}`);

  const schedule = task.availabilitySchedule;
  if (schedule?.enabled) {
    const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const days = (schedule.days || []).map((day) => names[day]).join(", ");
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
  const summary = showAvailability ? availabilitySummary(task, now, upcomingAt) : "";
  const title = displayTitle(task);

  article.innerHTML = `
    <div class="task-main">
      ${closed ? '<span class="complete-indicator" aria-hidden="true">✓</span>' : '<button class="complete-button" data-action="complete" aria-label="Mark complete" title="Mark complete"></button>'}
      <div class="task-copy">
        <div class="task-title-row">
          <h3><a href="#" class="task-title-link" data-action="edit">${escapeHtml(title)}</a></h3>
          <span class="status-pill ${result.actionable && !sleep.sleeping ? "ready" : sleep.sleeping ? "sleeping" : "quiet"}">${escapeHtml(statusText)}</span>
        </div>
        ${summary ? `<div class="availability-summary">${escapeHtml(summary)}</div>` : ""}
        ${task.notes ? `<p class="notes">${escapeHtml(task.notes)}</p>` : ""}
        ${timing.length ? `<div class="timing">${timing.map((value) => `<span>${escapeHtml(value)}</span>`).join("")}</div>` : ""}
        ${tags ? `<div class="tags">${tags}</div>` : ""}
        ${(task.attachments || []).length ? `<div class="attachments">${task.attachments.map((attachment, index) => `<button class="attachment" data-action="attachment" data-attachment-index="${index}">Attachment: ${escapeHtml(attachment.name || "Attachment")}</button>`).join("")}</div>` : ""}
      </div>
    </div>
    <div class="task-actions">
      ${!closed && sleep.sleeping ? '<button class="text-button" data-action="wake">Wake</button>' : ""}
      ${!closed && sleep.sleeping ? '<button class="text-button" data-action="sleep-custom">Change sleep…</button>' : ""}
      ${!closed && sleep.sleeping && !sleep.indefinite ? '<button class="text-button" data-action="sleep-to-wait">Wait instead</button>' : ""}
      ${!closed && !sleep.sleeping ? '<button class="text-button" data-action="sleep-tomorrow">Sleep until tomorrow</button>' : ""}
      ${!closed && !sleep.sleeping ? '<button class="text-button" data-action="sleep-custom">Sleep until…</button>' : ""}
      ${!closed && canConvertWaitToSleep ? '<button class="text-button" data-action="wait-to-sleep">Sleep instead</button>' : ""}
    </div>
  `;
  return article;
}

function horizonControl(model) {
  const wrap = document.createElement("div");
  wrap.className = "horizon-row";
  wrap.innerHTML = `<span class="horizon-label">${model.horizonDays === null ? "Showing all future opportunities" : "Limit to"}</span>`;

  const controls = document.createElement("div");
  controls.className = "horizon-controls";
  const segmented = document.createElement("div");
  segmented.className = "segmented horizon-control";
  segmented.setAttribute("aria-label", "Upcoming task horizon");

  for (const days of [1, 7, 30]) {
    const active = days === model.horizonDays;
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.horizon = String(days);
    button.className = active ? "active" : "";
    button.textContent = horizonLabel(days, model.horizonMode);
    button.setAttribute("aria-pressed", String(active));
    segmented.append(button);
  }

  const boundary = document.createElement("button");
  boundary.type = "button";
  boundary.dataset.action = "toggle-boundary";
  boundary.className = `secondary-button boundary-toggle ${model.horizonMode === "boundary" ? "active" : ""}`;
  boundary.textContent = "End of day/week/month";
  boundary.title = "Use the end of the current day, week, or month instead of a rolling 1, 7, or 30 days.";
  boundary.setAttribute("aria-pressed", String(model.horizonMode === "boundary"));

  controls.append(segmented, boundary);
  wrap.append(controls);
  return wrap;
}

function taskSection(definition, rows, sleepingRows, model, now) {
  const details = document.createElement("details");
  details.className = "task-section";
  details.dataset.section = definition.id;
  details.open = getSectionOpen(definition);

  const summary = document.createElement("summary");
  summary.innerHTML = `
    <span class="section-heading">
      <span class="section-chevron" aria-hidden="true">›</span>
      <strong>${escapeHtml(sectionLabel(definition, model.horizonDays))}</strong>
    </span>
    <span class="section-count">${rows.length + sleepingRows.length}</span>`;
  details.append(summary);

  const body = document.createElement("div");
  body.className = "task-section-body";
  if (definition.id === "upcoming") body.append(horizonControl(model));

  const list = document.createElement("div");
  list.className = "task-list section-task-list";
  if (!rows.length) {
    const empty = document.createElement("div");
    empty.className = "section-empty";
    empty.textContent = emptySectionText(definition.id, now, model.horizonDays, model.horizonMode);
    list.append(empty);
  } else {
    for (const row of rows) {
      list.append(taskCard(row.task, now, row.upcomingAt, definition.id === "upcoming"));
    }
  }
  body.append(list);

  if (definition.id === "upcoming" && sleepingRows.length) {
    const block = document.createElement("div");
    block.className = "sleeping-block";
    block.innerHTML = `<div class="sleeping-heading"><span>Sleeping</span><span>${sleepingRows.length}</span></div>`;
    const sleepingList = document.createElement("div");
    sleepingList.className = "task-list section-task-list sleeping-task-list";
    for (const row of sleepingRows) sleepingList.append(taskCard(row.task, now, row.upcomingAt, true));
    block.append(sleepingList);
    body.append(block);
  }

  details.append(body);
  return details;
}

export function createTasksView({ panel, sections, count, compactToggle, onAction, onPreferencesChanged, onRendered }) {
  let model = null;

  sections.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const horizon = target.closest("button[data-horizon]");
    if (horizon && model) {
      const days = Number(horizon.dataset.horizon);
      const next = model.horizonDays === days ? null : days;
      onPreferencesChanged({ horizonDays: next });
      return;
    }

    if (target.closest('[data-action="toggle-boundary"]') && model) {
      onPreferencesChanged({ horizonMode: model.horizonMode === "boundary" ? "rolling" : "boundary" });
      return;
    }

    const actionTarget = target.closest("[data-action]");
    const card = actionTarget?.closest(".task-card");
    if (!actionTarget || !card) return;
    if (actionTarget.matches("a")) event.preventDefault();
    onAction({
      action: actionTarget.dataset.action,
      id: card.dataset.id,
      attachmentIndex: actionTarget.dataset.attachmentIndex == null ? null : Number(actionTarget.dataset.attachmentIndex),
    });
  });

  sections.addEventListener(
    "toggle",
    (event) => {
      const details = event.target;
      if (details instanceof HTMLDetailsElement && details.dataset.section) {
        setSectionOpen(details.dataset.section, details.open);
      }
    },
    true,
  );

  compactToggle.addEventListener("click", () => {
    if (model) onPreferencesChanged({ compact: !model.compact });
  });

  function render(nextModel) {
    model = nextModel;
    const now = nextModel.now || new Date();
    const matching = nextModel.items.filter((item) => item.kind === "task").filter((task) => textMatches(task, nextModel.query));
    const openCount = matching.filter((task) => !["completed", "canceled"].includes(task.state)).length;

    count.textContent = nextModel.query
      ? `${openCount} matching open ${openCount === 1 ? "task" : "tasks"}`
      : `${openCount} open ${openCount === 1 ? "task" : "tasks"}`;

    panel.classList.toggle("compact", nextModel.compact);
    compactToggle.classList.toggle("active", nextModel.compact);
    compactToggle.setAttribute("aria-pressed", String(nextModel.compact));

    const actionable = sortTasks(
      matching.filter((task) => taskMatchesFilter(task, "now", now) && !isSleeping(task, now)),
      now,
    );
    const sleepingRows = sortTasks(
      matching.filter((task) => !["completed", "canceled"].includes(task.state) && isSleeping(task, now)),
      now,
    ).map((task) => ({ task, upcomingAt: nextActionableStart(task, now, { respectSleep: true }) }));

    const rowsBySection = {
      now: actionable.map((task) => ({ task })),
      upcoming: upcomingRows(matching, now, nextModel.horizonDays, nextModel.horizonMode),
      all: sortTasks(matching.filter((task) => taskMatchesFilter(task, "all", now)), now).map((task) => ({ task })),
      completed: sortTasks(matching.filter((task) => taskMatchesFilter(task, "completed", now)), now).map((task) => ({ task })),
    };

    sections.replaceChildren();
    for (const definition of SECTION_DEFINITIONS) {
      sections.append(taskSection(
        definition,
        rowsBySection[definition.id],
        definition.id === "upcoming" ? sleepingRows : [],
        nextModel,
        now,
      ));
    }
    onRendered?.();
  }

  return { render };
}
