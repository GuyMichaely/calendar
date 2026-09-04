import { For, Show, createMemo } from "solid-js";
import {
  calendarGridStart,
  dateKey,
  isPendingOnDate,
  isSleeping,
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

function displayTitle(item: Item) {
  const raw = String(item.title || "");
  if (raw.replace(/[\p{Cf}\p{Cc}\s]/gu, "")) return raw;
  return item.kind === "event" ? "Untitled event" : "Untitled task";
}

export function CalendarView(props: {
  items: Item[];
  query: string;
  month: Date;
  sleepMode: CalendarSleepMode;
  now: Date;
  onMonthChange: (date: Date) => void;
  onSleepModeChange: (mode: CalendarSleepMode) => void;
  onEdit: (item: Item) => void;
  onCreateForDay: (date: Date) => void;
  onOpenTodayTasks: () => void;
}) {
  const today = createMemo(() => dateKey(props.now));
  const days = createMemo(() => {
    const start = calendarGridStart(props.month);
    return Array.from({ length: 42 }, (_, index) => {
      const day = new Date(start);
      day.setDate(start.getDate() + index);
      return day;
    });
  });

  const projectedStarts = createMemo(() => {
    const starts = new Map<string, { task: Task; start: Date; bypassesSleep: boolean }>();
    const respectSleep = props.sleepMode === "respect";
    for (const item of props.items) {
      if (item.kind !== "task" || ["completed", "canceled"].includes(item.state)) continue;
      const projected = projectedTaskStart(item, props.now, respectSleep);
      if (!projected) continue;
      starts.set(item.id, {
        task: item,
        start: projected,
        bypassesSleep: projectedStartBypassesSleep(item, projected, props.now, respectSleep),
      });
    }
    return starts;
  });

  const entriesForDay = (day: Date): CalendarEntry[] => {
    const key = dateKey(day);
    const entries: CalendarEntry[] = [];
    for (const item of props.items) {
      const title = displayTitle(item);
      if (item.kind === "event") {
        if (dateKey(item.start) !== key) continue;
        entries.push({
          item,
          className: "event event",
          label: `${shortTime(item.start)} ${title}`,
          title,
          sort: toDate(item.start)?.getTime() || 0,
        });
        continue;
      }
      if (["completed", "canceled"].includes(item.state)) continue;

      const projected = projectedStarts().get(item.id);
      if (projected && dateKey(projected.start) === key) {
        entries.push({
          item,
          className: `task start${projected.bypassesSleep ? " sleep-bypassed" : ""}`,
          label: `${shortTime(projected.start)} ${title}`,
          title: projected.bypassesSleep
            ? `${title}: projected start while sleep is ignored`
            : `${title}: projected start`,
          sort: projected.start.getTime(),
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
            label: `${prefix} ${title}`,
            title: `${title}: ${role}`,
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
            const date = props.now;
            props.onMonthChange(new Date(date.getFullYear(), date.getMonth(), 1));
          }}>Today</button>
          <button class="icon-button" aria-label="Next month" onClick={() => props.onMonthChange(new Date(props.month.getFullYear(), props.month.getMonth() + 1, 1))}>›</button>
        </div>
        <div class="calendar-heading-actions">
          <button
            type="button"
            class={`secondary-button calendar-sleep-toggle ${props.sleepMode === "respect" ? "active" : ""}`}
            aria-pressed={props.sleepMode === "respect"}
            title={props.sleepMode === "respect"
              ? "Sleeping tasks are treated as unavailable until they wake."
              : "Sleep is ignored when projecting task opportunities. Sleeping projections are shown differently."}
            onClick={() => props.onSleepModeChange(props.sleepMode === "respect" ? "ignore" : "respect")}
          >
            {props.sleepMode === "respect" ? "Respect sleep" : "Ignore sleep"}
          </button>
          <h1>{new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(props.month)}</h1>
        </div>
      </div>
      <div class="calendar-grid">
        <For each={["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]}>{(name) => <div class="weekday">{name}</div>}</For>
        <For each={days()}>{(day) => {
          const key = () => dateKey(day);
          const pending = () => key() === today()
            ? props.items.filter((item): item is Task => item.kind === "task" && isPendingOnDate(item, day))
            : [];
          const matchingPending = () => props.query ? pending().filter((item) => textMatches(item, props.query)) : pending();
          const sleepingCount = () => matchingPending().filter((item) => isSleeping(item, props.now)).length;
          const pendingText = () => {
            const count = matchingPending().length;
            const noun = count === 1 ? "task" : "tasks";
            const prefix = props.query ? `${count} matching ${noun}` : `${count} ${noun}`;
            return `${prefix}${sleepingCount() ? ` - ${sleepingCount()} sleeping` : ""}`;
          };
          const entries = () => entriesForDay(day);
          const itemLimit = () => 4 - (pending().length ? 1 : 0);
          return (
            <div
              class={`calendar-day clickable ${day.getMonth() !== props.month.getMonth() ? "outside" : ""} ${key() === today() ? "today" : ""}`}
              onClick={(event) => {
                if ((event.target as Element).closest("button")) return;
                props.onCreateForDay(day);
              }}
            >
              <div class="day-number">{day.getDate()}</div>
              <Show when={pending().length}>
                <button
                  class={`calendar-chip task start ${props.query && !matchingPending().length ? "search-dimmed" : ""}`}
                  title="Open today's tasks"
                  onClick={(event) => {
                    event.stopPropagation();
                    props.onOpenTodayTasks();
                  }}
                >
                  {pendingText()}
                </button>
              </Show>
              <For each={entries().slice(0, itemLimit())}>{(entry) => (
                <button
                  class={`calendar-chip ${entry.className} ${props.query && !textMatches(entry.item, props.query) ? "search-dimmed" : ""}`}
                  title={entry.title}
                  onClick={(event) => {
                    event.stopPropagation();
                    props.onEdit(entry.item);
                  }}
                >
                  {entry.label}
                </button>
              )}</For>
              <Show when={entries().length > itemLimit()}><div class="more-count">+{entries().length - itemLimit()} more</div></Show>
            </div>
          );
        }}</For>
      </div>
      <div class="calendar-legend">
        <span><i class="legend-dot event" />Event</span>
        <span><i class="legend-dot start" />Task start</span>
        <span><i class="legend-dot latest" />Latest start</span>
        <span><i class="legend-dot due" />Due</span>
      </div>
    </section>
  );
}
