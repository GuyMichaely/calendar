import {
  calendarGridStart,
  dateKey,
  isEvent,
  isPendingOnDate,
  isSleeping,
  isTask,
  nextActionableStart,
  nextAvailabilityStart,
  sleepInfo,
  textMatches,
  toDate,
} from "../domain.js";

function shortTime(value) {
  const date = toDate(value);
  if (!date) return "";
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
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

function taskProjection(task, now, respectSleep) {
  const start = projectedTaskStart(task, now, respectSleep);
  if (!start) return null;
  const sleep = sleepInfo(task, now);
  const bypassesSleep = !respectSleep && isSleeping(task, now) && (sleep.indefinite || start < sleep.until);
  return {
    kind: "task",
    role: bypassesSleep ? "start sleep-bypassed" : "start",
    label: `${shortTime(start)} ${task.title || "Untitled task"}`,
    title: bypassesSleep
      ? `${task.title || "Untitled task"}: projected start while sleep is ignored`
      : `${task.title || "Untitled task"}: projected start`,
    source: task,
    sort: start.getTime(),
    key: dateKey(start),
  };
}

function fixedEntries(item) {
  const entries = [];
  for (const [field, role, prefix] of [
    ["latestStart", "latest", "Latest:"],
    ["deadline", "due", "Due:"],
  ]) {
    if (!item[field]) continue;
    entries.push({
      kind: "task",
      role,
      label: `${prefix} ${item.title || "Untitled task"}`,
      title: `${item.title || "Untitled task"}: ${role}`,
      source: item,
      sort: toDate(item[field])?.getTime() || 0,
      key: dateKey(item[field]),
    });
  }
  return entries;
}

function entriesByDate(items, now, respectSleep) {
  const map = new Map();
  const add = (entry) => {
    if (!entry?.key) return;
    if (!map.has(entry.key)) map.set(entry.key, []);
    map.get(entry.key).push(entry);
  };

  for (const item of items) {
    if (isEvent(item)) {
      add({
        kind: "event",
        role: "event",
        label: `${shortTime(item.start)} ${item.title || "Untitled event"}`,
        title: item.title || "Untitled event",
        source: item,
        sort: toDate(item.start)?.getTime() || 0,
        key: dateKey(item.start),
      });
      continue;
    }
    if (!isTask(item) || ["completed", "canceled"].includes(item.state)) continue;
    add(taskProjection(item, now, respectSleep));
    for (const entry of fixedEntries(item)) add(entry);
  }

  for (const entries of map.values()) {
    entries.sort((a, b) => a.sort - b.sort || String(a.title).localeCompare(String(b.title)));
  }
  return map;
}

function pendingSummary(items, day, query, now) {
  const pending = items.filter((item) => isTask(item) && isPendingOnDate(item, day));
  const matching = query ? pending.filter((item) => textMatches(item, query)) : pending;
  const sleeping = matching.filter((item) => isSleeping(item, now)).length;
  const noun = matching.length === 1 ? "task" : "tasks";
  const prefix = query ? `${matching.length} matching ${noun}` : `${matching.length} ${noun}`;
  return {
    count: matching.length,
    total: pending.length,
    text: `${prefix}${sleeping ? ` - ${sleeping} sleeping` : ""}`,
  };
}

export function createCalendarView({ grid, monthLabel, sleepToggle, onOpenItem, onCreateEvent, onOpenTodayTasks, onSleepModeChanged }) {
  let model = null;

  grid.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target || !model) return;

    const chip = target.closest(".calendar-chip");
    if (chip) {
      event.stopPropagation();
      if (chip.dataset.todaySummary === "true") onOpenTodayTasks();
      else if (chip.dataset.itemId) onOpenItem(chip.dataset.itemId);
      return;
    }

    const cell = target.closest(".calendar-day");
    if (!cell?.dataset.date) return;
    const day = new Date(`${cell.dataset.date}T00:00:00`);
    if (!Number.isNaN(day.getTime())) onCreateEvent(day);
  });

  sleepToggle.addEventListener("click", () => {
    if (!model) return;
    onSleepModeChanged(model.sleepMode === "respect" ? "ignore" : "respect");
  });

  function render(nextModel) {
    model = nextModel;
    const month = nextModel.month;
    const now = nextModel.now || new Date();
    const today = dateKey(now);
    const respectSleep = nextModel.sleepMode === "respect";
    const entries = entriesByDate(nextModel.items, now, respectSleep);

    monthLabel.textContent = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(month);
    sleepToggle.classList.toggle("active", respectSleep);
    sleepToggle.setAttribute("aria-pressed", String(respectSleep));
    sleepToggle.textContent = respectSleep ? "Respect sleep" : "Ignore sleep";
    sleepToggle.title = respectSleep
      ? "Sleeping tasks are treated as unavailable until they wake."
      : "Sleep is ignored when projecting task opportunities. Sleeping projections are shown differently.";

    grid.replaceChildren();
    for (const name of ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]) {
      const header = document.createElement("div");
      header.className = "weekday";
      header.textContent = name;
      grid.append(header);
    }

    const start = calendarGridStart(month);
    for (let index = 0; index < 42; index += 1) {
      const day = new Date(start);
      day.setDate(start.getDate() + index);
      const key = dateKey(day);
      const cell = document.createElement("div");
      cell.className = "calendar-day";
      cell.dataset.date = key;
      if (day.getMonth() !== month.getMonth()) cell.classList.add("outside");
      if (key === today) cell.classList.add("today");

      const header = document.createElement("div");
      header.className = "day-number";
      header.textContent = day.getDate();
      cell.append(header);

      let reservedRows = 0;
      if (key === today) {
        const summaryData = pendingSummary(nextModel.items, day, nextModel.query, now);
        if (summaryData.total) {
          const summary = document.createElement("button");
          summary.type = "button";
          summary.className = "calendar-chip task start";
          summary.dataset.todaySummary = "true";
          summary.textContent = summaryData.text;
          summary.title = "Open today's tasks";
          summary.classList.toggle("search-dimmed", !!nextModel.query && summaryData.count === 0);
          cell.append(summary);
          reservedRows = 1;
        }
      }

      const dayEntries = entries.get(key) || [];
      const itemLimit = 4 - reservedRows;
      for (const entry of dayEntries.slice(0, itemLimit)) {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = `calendar-chip ${entry.kind} ${entry.role || ""}`;
        chip.dataset.itemId = entry.source.id;
        chip.textContent = entry.label;
        chip.title = entry.title;
        chip.classList.toggle("search-dimmed", !!nextModel.query && !textMatches(entry.source, nextModel.query));
        cell.append(chip);
      }
      if (dayEntries.length > itemLimit) {
        const more = document.createElement("div");
        more.className = "more-count";
        more.textContent = `+${dayEntries.length - itemLimit} more`;
        cell.append(more);
      }
      grid.append(cell);
    }
  }

  return { render };
}
