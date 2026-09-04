import {
  calendarGridStart,
  dateKey,
  formatDateTime,
  isPendingOnDate,
  isSleeping,
  sleepInfo,
  textMatches,
  toDate,
} from "../../site/domain.js";
import { projectedStartBypassesSleep, projectedTaskStart } from "./calendar-projection";
import type { CalendarSleepMode, Item, Task } from "./types";

type CalendarEntry = {
  item: Item;
  className: string;
  label: string;
  title: string;
  sort: number;
};

function shortTime(value: string | Date | null | undefined) {
  const date = value instanceof Date ? value : toDate(value);
  return date ? new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date) : "";
}

export function CalendarView(props: {
  items: Item[];
  query: string;
  month: Date;
  sleepMode: CalendarSleepMode;
  onMonthChange: (date: Date) => void;
  onSleepModeChange: (mode: CalendarSleepMode) => void;
  onEdit: (item: Item) => void;
  onCreateForDay: (date: Date) => void;
  onOpenTodayTasks: () => void;
}) {
  const now = new Date();
  const today = dateKey(now);
  const start = calendarGridStart(props.month);
  const days = Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });

  const projectedStarts = new Map<string, { task: Task; start: Date; bypassesSleep: boolean }>();
  const respectSleep = props.sleepMode === "respect";
  for (const item of props.items) {
    if (item.kind !== "task" || ["completed", "canceled"].includes(item.state)) continue;
    const projected = projectedTaskStart(item, now, respectSleep);
    if (!projected) continue;
    projectedStarts.set(item.id, {
      task: item,
      start: projected,
      bypassesSleep: projectedStartBypassesSleep(item, projected, now, respectSleep),
    });
  }

  const entriesForDay = (day: Date): CalendarEntry[] => {
    const key = dateKey(day);
    const entries: CalendarEntry[] = [];
    for (const item of props.items) {
      if (item.kind === "event") {
        if (dateKey(item.start) !== key) continue;
        entries.push({
          item,
          className: "event event",
          label: `${shortTime(item.start)} ${item.title}`,
          title: item.title,
          sort: toDate(item.start)?.getTime() || 0,
        });
        continue;
      }
      if (["completed", "canceled"].includes(item.state)) continue;

      const projected = projectedStarts.get(item.id);
      if (projected && dateKey(projected.start) === key) {
        entries.push({
          item,
          className: `task start${projected.bypassesSleep ? " sleep-bypassed" : ""}`,
          label: `${shortTime(projected.start)} ${item.title}`,
          title: projected.bypassesSleep
            ? `${item.title}: projected start while sleep is ignored`
            : `${item.title}: projected start`,
          sort: projected.start.getTime(),
        });
      }

      const sleep = sleepInfo(item, now);
      if (sleep.sleeping && !sleep.indefinite && dateKey(sleep.until) === key) {
        entries.push({
          item,
          className: "task sleep",
          label: `Sleep ends: ${item.title}`,
          title: `${item.title}: sleep ends ${formatDateTime(sleep.until)}`,
          sort: sleep.until.getTime(),
        });
      }

      for (const [field, role, prefix] of [
        ["latestStart", "latest", "Latest:"],
        ["deadline", "due", "Due:"],
      ] as const) {
        if (item[field] && dateKey(item[field]) === key) {
          entries.push({
            item,
            className: `task ${role}`,
            label: `${prefix} ${item.title}`,
            title: `${item.title}: ${role}`,
            sort: toDate(item[field])?.getTime() || 0,
          });
        }
      }
    }
    return entries.sort((a, b) => a.sort - b.sort || a.title.localeCompare(b.title));
  };

  return (
    <section class="panel calendar-panel">
      <div class="calendar-toolbar">
        <div class="month-controls">
          <button class="icon-button" aria-label="Previous month" onClick={() => props.onMonthChange(new Date(props.month.getFullYear(), props.month.getMonth() - 1, 1))}>‹</button>
          <button class="text-button" onClick={() => {
            const date = new Date();
            props.onMonthChange(new Date(date.getFullYear(), date.getMonth(), 1));
          }}>Today</button>
          <button class="icon-button" aria-label="Next month" onClick={() => props.onMonthChange(new Date(props.month.getFullYear(), props.month.getMonth() + 1, 1))}>›</button>
        </div>
        <div class="calendar-heading-actions">
          <button
            type="button"
            class={`secondary-button calendar-sleep-toggle ${props.sleepMode === "respect" ? "active" : ""}`}
            aria-pressed={props.sleepMode === "respect"}
            title={props.sleepMode === "respect" ? "Sleeping tasks are treated as unavailable until they wake." : "Sleep is ignored when projecting task opportunities."}
            onClick={() => props.onSleepModeChange(props.sleepMode === "respect" ? "ignore" : "respect")}
          >
            {props.sleepMode === "respect" ? "Respect sleep" : "Ignore sleep"}
          </button>
          <h1>{new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(props.month)}</h1>
        </div>
      </div>
      <div class="calendar-grid">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((name) => <div key={name} class="weekday">{name}</div>)}
        {days.map((day) => {
          const key = dateKey(day);
          const pending = key === today
            ? props.items.filter((item): item is Task => item.kind === "task" && isPendingOnDate(item, day))
            : [];
          const matchingPending = props.query ? pending.filter((item) => textMatches(item, props.query)) : pending;
          const sleepingCount = matchingPending.filter((item) => isSleeping(item, now)).length;
          const entries = entriesForDay(day);
          const itemLimit = 4 - (pending.length ? 1 : 0);
          return (
            <div
              key={key}
              class={`calendar-day clickable ${day.getMonth() !== props.month.getMonth() ? "outside" : ""} ${key === today ? "today" : ""}`}
              onClick={(event) => {
                if ((event.target as Element).closest("button")) return;
                props.onCreateForDay(day);
              }}
            >
              <div class="day-number">{day.getDate()}</div>
              {pending.length ? (
                <button
                  class={`calendar-chip task start ${props.query && !matchingPending.length ? "search-dimmed" : ""}`}
                  title="Open today's tasks"
                  onClick={(event) => {
                    event.stopPropagation();
                    props.onOpenTodayTasks();
                  }}
                >
                  {matchingPending.length} {matchingPending.length === 1 ? "task" : "tasks"}{sleepingCount ? ` · ${sleepingCount} sleeping` : ""}
                </button>
              ) : null}
              {entries.slice(0, itemLimit).map((entry, index) => (
                <button
                  key={`${entry.item.id}:${entry.className}:${entry.sort}:${index}`}
                  class={`calendar-chip ${entry.className} ${props.query && !textMatches(entry.item, props.query) ? "search-dimmed" : ""}`}
                  title={entry.title}
                  onClick={(event) => {
                    event.stopPropagation();
                    props.onEdit(entry.item);
                  }}
                >
                  {entry.label}
                </button>
              ))}
              {entries.length > itemLimit ? <div class="more-count">+{entries.length - itemLimit} more</div> : null}
            </div>
          );
        })}
      </div>
      <div class="calendar-legend">
        <span><i class="legend-dot event" />Event</span>
        <span><i class="legend-dot start" />Task start</span>
        <span><i class="legend-dot sleep" />Sleep ends</span>
        <span><i class="legend-dot latest" />Latest start</span>
        <span><i class="legend-dot due" />Due</span>
      </div>
    </section>
  );
}
