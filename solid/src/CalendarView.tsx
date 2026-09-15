import { Icon } from "./Icon";
import { For, Show, createMemo, createSignal, createEffect } from "solid-js";
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
  const [selectedDay, setSelectedDay] = createSignal(props.now);
  createEffect(() => {
    const month = props.month;
    setSelectedDay(current => current.getMonth() === month.getMonth() && current.getFullYear() === month.getFullYear() ? current : (props.now.getMonth() === month.getMonth() && props.now.getFullYear() === month.getFullYear() ? props.now : new Date(month)));
  });
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
      if (item.kind !== "task" || item.state === "completed") continue;
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
      if (item.state === "completed") continue;

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

  const pendingForDay = (day: Date) => dateKey(day) === today() ? props.items.filter((item): item is Task => item.kind === "task" && isPendingOnDate(item, day)) : [];
  const matchingPending = (day: Date) => props.query ? pendingForDay(day).filter(item => textMatches(item, props.query)) : pendingForDay(day);
  const pendingText = (day: Date) => {
    const count = matchingPending(day).length;
    const noun = count === 1 ? "task" : "tasks";
    const sleeping = matchingPending(day).filter(item => isSleeping(item, props.now)).length;
    return `${props.query ? `${count} matching ${noun}` : `${count} ${noun}`} for today${sleeping ? ` · ${sleeping} sleeping` : ""}`;
  };
  const selectedEntries = createMemo(() => entriesForDay(selectedDay()).filter(entry => !props.query || textMatches(entry.item, props.query)));
  return <section class="panel calendar-panel">
    <div class="panel-heading">
      <div><p class="page-eyebrow">Calendar</p><h1>{new Intl.DateTimeFormat(undefined, {month: "long", year: "numeric"}).format(props.month)}</h1><p class="page-description">A little perspective on what's ahead.</p></div>
      <div class="month-controls">
        <button class="icon-button" aria-label="Previous month" onClick={() => props.onMonthChange(new Date(props.month.getFullYear(), props.month.getMonth() - 1, 1))}>‹</button>
        <button class="secondary-button" onClick={() => { props.onMonthChange(new Date(props.now.getFullYear(), props.now.getMonth(), 1)); setSelectedDay(props.now); }}>Today</button>
        <button class="icon-button" aria-label="Next month" onClick={() => props.onMonthChange(new Date(props.month.getFullYear(), props.month.getMonth() + 1, 1))}>›</button>
      </div>
    </div>
    <div class="calendar-layout">
      <div class="calendar-board">
        <div class="calendar-grid">
          <For each={["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]}>{name => <div class="weekday">{name}</div>}</For>
          <For each={days()}>{day => {
            const entries = () => entriesForDay(day);
            const matching = () => props.query ? entries().filter(entry => textMatches(entry.item, props.query)) : entries();
            return <div class={`calendar-day ${day.getMonth() !== props.month.getMonth() ? "outside" : ""} ${dateKey(day) === today() ? "today" : ""}`} classList={{selected: dateKey(day) === dateKey(selectedDay())}} onClick={() => setSelectedDay(day)}>
              <button class="day-number" aria-label={new Intl.DateTimeFormat(undefined, {dateStyle: "full"}).format(day)} aria-pressed={dateKey(day) === dateKey(selectedDay())} onClick={() => setSelectedDay(day)}>{day.getDate()}</button>
              <div class="calendar-cell-entries">
                <Show when={matchingPending(day).length}><button class="calendar-chip task start" title="Open today's tasks" onClick={event => { event.stopPropagation(); props.onOpenTodayTasks(); }}>{matchingPending(day).length} tasks for today</button></Show>
                <For each={entries().slice(0, pendingForDay(day).length ? 2 : 3)}>{entry => <button class={`calendar-chip ${entry.className} ${props.query && !textMatches(entry.item, props.query) ? "search-dimmed" : ""}`} title={entry.title} onClick={event => { event.stopPropagation(); props.onEdit(entry.item); }}>{entry.label}</button>}</For>
                <Show when={entries().length > (pendingForDay(day).length ? 2 : 3)}><button class="more-count" onClick={() => setSelectedDay(day)}>+{entries().length - (pendingForDay(day).length ? 2 : 3)} more</button></Show>
              </div>
              <div class="calendar-day-dots" aria-hidden="true"><For each={matching().slice(0, 3)}>{entry => <i class={`legend-dot ${entry.className.includes("event") ? "event" : entry.className.includes("due") ? "due" : "start"}`} />}</For><Show when={matchingPending(day).length}><i class="legend-dot start" /></Show></div>
            </div>;
          }}</For>
        </div>
        <div class="calendar-footnotes"><div class="calendar-legend"><span><i class="legend-dot event" />Event</span><span><i class="legend-dot start" />Can start</span><span><i class="legend-dot latest" />Latest start</span><span><i class="legend-dot due" />Due</span></div>
          <button type="button" class="text-button calendar-sleep-toggle" aria-pressed={props.sleepMode === "respect"} title={props.sleepMode === "respect" ? "Sleeping tasks are treated as unavailable until they wake." : "Sleep is ignored when projecting task opportunities. Sleeping projections are shown differently."} onClick={() => props.onSleepModeChange(props.sleepMode === "respect" ? "ignore" : "respect")}><Icon name="moon" size={14} />{props.sleepMode === "respect" ? "Respect sleep" : "Ignore sleep"}</button>
        </div>
      </div>
      <aside class="day-agenda" aria-label="Selected day">
        <div class="agenda-date"><span>{new Intl.DateTimeFormat(undefined, {weekday: "long"}).format(selectedDay())}</span><h2>{new Intl.DateTimeFormat(undefined, {month: "long", day: "numeric"}).format(selectedDay())}</h2><Show when={dateKey(selectedDay()) === today()}><span class="today-label">Today</span></Show></div>
        <Show when={matchingPending(selectedDay()).length}><button class="agenda-tasks" onClick={props.onOpenTodayTasks}><Icon name="sun" /><span>{pendingText(selectedDay())}</span><Icon name="arrow" size={16} /></button></Show>
        <div class="agenda-entries"><For each={selectedEntries()} fallback={<div class="agenda-empty"><Icon name="calendar" size={29} /><strong>A little breathing room</strong><p>{props.query ? "No matches on this day." : "Nothing scheduled for this day."}</p></div>}>{entry => <button class="agenda-entry" onClick={() => props.onEdit(entry.item)}><span class={`agenda-entry-mark ${entry.className}`} /><span><small>{entry.item.kind === "event" ? shortTime(entry.item.start) : entry.className.includes("due") ? "Due" : entry.className.includes("latest") ? "Latest start" : "Can start"}</small><strong>{entry.title}</strong></span><Icon name="arrow" size={15} /></button>}</For></div>
        <button class="secondary-button agenda-add" onClick={() => props.onCreateForDay(selectedDay())}><Icon name="plus" size={16} />Add an event</button>
      </aside>
    </div>
  </section>;
}
