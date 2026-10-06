import { Icon } from "./Icon";
import { For, Show, createMemo, createSignal, createEffect } from "solid-js";
import { textMatches } from "../../site/domain.js";
import { addDays, clockText, dayKey as dateKey, formatIn, partsOf, startOfDay, zonedDate } from "./zone";
import { calendarEntries, todaysWork, windowsFor, type CalendarEntry } from "./calendar-entries";
import { describeRepeat } from "./repeats";
import type { CalendarEvent, Item, Task } from "./types";

type Shown = CalendarEntry & { className: string; label: string; title: string; kindLabel: string };

function shortTime(date: Date | null | undefined) {
  return date ? clockText(date) : "";
}
// Midnight is just the day.
const timeOf = (date: Date) => { const { hour, minute } = partsOf(date); return hour || minute ? shortTime(date) : ""; };
// The first of a moment's month, and months before or after it (in the calendar's time zone).
const monthOf = (date: Date, offset = 0) => { const { year, month } = partsOf(date); return zonedDate(year, month + offset, 1); };
const daysInMonth = (first: Date) => { const { year, month } = partsOf(first); return new Date(Date.UTC(year, month, 0)).getUTCDate(); };
const sameMonth = (a: Date, b: Date) => { const x = partsOf(a), y = partsOf(b); return x.year === y.year && x.month === y.month; };

function displayTitle(item: Item) {
  const raw = String(item.title || "");
  if (raw.replace(/[\p{Cf}\p{Cc}\s]/gu, "")) return raw;
  return item.kind === "event" ? "Untitled event" : "Untitled task";
}

export function CalendarView(props: {
  items: Item[];
  query: string;
  // The first of the month shown.
  month: Date;
  now: Date;
  onMonthChange: (date: Date) => void;
  onEdit: (item: Task | CalendarEvent) => void;
  // Unstarted dependent tasks, projected as if started on their parent task's due date.
  ghostIds: Set<string>;
  showDependents: boolean;
  onShowDependentsChange: (value: boolean) => void;
  onCreateForDay: (date: Date) => void;
  onOpenTodayTasks: () => void;
}) {
  const [selectedDay, setSelectedDay] = createSignal(props.now);
  createEffect(() => {
    const month = props.month;
    setSelectedDay(current => sameMonth(current, month) ? current : sameMonth(props.now, month) ? props.now : month);
  });
  const today = createMemo(() => dateKey(props.now));
  const days = createMemo(() => {
    const first = monthOf(props.month), { weekday } = partsOf(first);
    const length = daysInMonth(first);
    const start = addDays(first, -weekday);
    return Array.from({ length: Math.ceil((weekday + length) / 7) * 7 }, (_, index) => addDays(start, index));
  });

  // Every entry in the grid (and the selected day, which may be outside it), by day.
  const byDay = createMemo(() => {
    const grid = days();
    const from = new Date(Math.min(grid[0].getTime(), startOfDay(selectedDay()).getTime()));
    const to = new Date(Math.max(grid.at(-1)!.getTime(), selectedDay().getTime()));
    const map = new Map<string, Shown[]>();
    for (const entry of calendarEntries(props.items, from, to, props.now)) {
      const title = displayTitle(entry.item);
      const ghost = props.ghostIds.has(entry.item.id);
      const task = entry.item.kind === "task" ? entry.item : null;
      const shown: Shown = entry.kind === "event" ? { ...entry, className: "event", label: `${shortTime(entry.at)} ${title}`, title, kindLabel: shortTime(entry.at) }
        : entry.kind === "due" ? { ...entry, className: `task due${entry.overdue ? " overdue" : ""}`, label: ["Due", timeOf(entry.at), title].filter(Boolean).join(" "), title: `${title}: due ${shortTime(entry.at)}${entry.overdue ? " (overdue)" : ""}`, kindLabel: ["Due", timeOf(entry.at)].filter(Boolean).join(" · ") }
        : entry.kind === "repeat" ? { ...entry, className: "task repeat", label: `↻ ${title}`, title: `${title}: a later occurrence (${describeRepeat(task!.repeat!)})`, kindLabel: `Repeats${timeOf(entry.at) ? ` · ${timeOf(entry.at)}` : ""}` }
        : { ...entry, className: "task start", label: title, title: `${title}: can start`, kindLabel: `Can start${timeOf(entry.at) ? ` · ${timeOf(entry.at)}` : ""}` };
      if (entry.pushed) { shown.className += " pushed-entry"; shown.title += " (pushed down)"; }
      if (ghost) { shown.className += " ghost-entry"; shown.label = `If started: ${shown.label}`; shown.title += " (dependent task, if started on its parent task's due date)"; }
      const key = dateKey(entry.at);
      map.set(key, [...(map.get(key) || []), shown]);
    }
    return map;
  });
  const entriesForDay = (day: Date) => byDay().get(dateKey(day)) || [];

  const work = createMemo(() => todaysWork(props.items, props.now));
  const pendingForDay = (day: Date) => dateKey(day) === today() ? work() : [];
  const matchingPending = (day: Date) => props.query ? pendingForDay(day).filter(item => textMatches(item, props.query)) : pendingForDay(day);
  const pendingText = (day: Date) => {
    const count = matchingPending(day).length;
    const noun = count === 1 ? "task" : "tasks";
    return `${props.query ? `${count} matching ${noun}` : `${count} ${noun}`} for today`;
  };
  // The windows the selected day's tasks (its entries, and today's work) are done in.
  const dayWindows = createMemo(() => {
    const day = selectedDay();
    const tasks = [...entriesForDay(day).map(entry => entry.item), ...pendingForDay(day)].filter((item): item is Task => item.kind === "task");
    return windowsFor(props.items, tasks, day);
  });
  const selectedEntries = createMemo(() => entriesForDay(selectedDay()).filter(entry => !props.query || textMatches(entry.item, props.query)));
  return <section class="panel calendar-panel" style={{"--calendar-weeks": days().length / 7}}>
    <div class="calendar-toolbar">
      <div class="calendar-titlebar">
        <button class="secondary-button month-today" onClick={() => { props.onMonthChange(monthOf(props.now)); setSelectedDay(props.now); }}>Today</button>
        <div class="month-controls">
          <button class="icon-button" aria-label="Previous month" onClick={() => props.onMonthChange(monthOf(props.month, -1))}>‹</button>
          <button class="icon-button" aria-label="Next month" onClick={() => props.onMonthChange(monthOf(props.month, 1))}>›</button>
        </div>
        <h1>{formatIn(props.month, {month: "long", year: "numeric"})}</h1>
      </div>
      <label class="check-row"><input type="checkbox" checked={props.showDependents} onChange={event => props.onShowDependentsChange(event.currentTarget.checked)} />Show dependent tasks</label>
    </div>
    <div class="calendar-layout">
      <div class="calendar-board">
        <div class="calendar-grid">
          <For each={["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]}>{name => <div class="weekday">{name}</div>}</For>
          <For each={days()}>{day => {
            const entries = () => entriesForDay(day);
            const matching = () => props.query ? entries().filter(entry => textMatches(entry.item, props.query)) : entries();
            return <div class={`calendar-day ${!sameMonth(day, props.month) ? "outside" : ""} ${dateKey(day) === today() ? "today" : ""}`} classList={{selected: dateKey(day) === dateKey(selectedDay())}} onClick={() => setSelectedDay(day)}>
              <button class="day-number" aria-label={formatIn(day, {dateStyle: "full"})} aria-pressed={dateKey(day) === dateKey(selectedDay())} onClick={() => setSelectedDay(day)}>{partsOf(day).day}</button>
              <div class="calendar-cell-entries">
                <Show when={matchingPending(day).length}><button class="calendar-chip task start" title="Open today's tasks" onClick={event => { event.stopPropagation(); props.onOpenTodayTasks(); }}>{matchingPending(day).length} tasks for today</button></Show>
                <For each={entries().slice(0, pendingForDay(day).length ? 2 : 3)}>{entry => <button class={`calendar-chip ${entry.className} ${props.query && !textMatches(entry.item, props.query) ? "search-dimmed" : ""}`} title={entry.title} onClick={event => { event.stopPropagation(); props.onEdit(entry.item); }}>{entry.label}</button>}</For>
                <Show when={entries().length > (pendingForDay(day).length ? 2 : 3)}><button class="more-count" onClick={() => setSelectedDay(day)}>+{entries().length - (pendingForDay(day).length ? 2 : 3)} more</button></Show>
              </div>
              <div class="calendar-day-dots" aria-hidden="true"><For each={matching().slice(0, 3)}>{entry => <i class={`legend-dot ${entry.kind === "event" ? "event" : entry.kind === "due" ? "due" : entry.kind === "repeat" ? "repeat" : "start"}`} />}</For><Show when={matchingPending(day).length}><i class="legend-dot start" /></Show></div>
            </div>;
          }}</For>
        </div>
        <div class="calendar-footnotes"><div class="calendar-legend"><span><i class="legend-dot event" />Event</span><span><i class="legend-dot start" />Can start</span><span><i class="legend-dot due" />Due</span><span><i class="legend-dot repeat" />Repeats</span></div>
        </div>
      </div>
      <aside class="day-agenda" aria-label="Selected day">
        <div class="agenda-date"><span>{formatIn(selectedDay(), {weekday: "long"})}</span><h2>{formatIn(selectedDay(), {month: "long", day: "numeric"})}</h2><Show when={dateKey(selectedDay()) === today()}><span class="today-label">Today</span></Show></div>
        <Show when={matchingPending(selectedDay()).length}><button class="agenda-tasks" onClick={props.onOpenTodayTasks}><Icon name="sun" /><span>{pendingText(selectedDay())}</span><Icon name="arrow" size={16} /></button></Show>
        <Show when={dayWindows().length}>
          <ul class="agenda-windows" aria-label="Windows this day's tasks are done in"><For each={dayWindows()}>{opening => <li><span>{opening.window.title}</span><small>{shortTime(opening.opens)}–{shortTime(opening.closes)}</small></li>}</For></ul>
        </Show>
        <div class="agenda-entries"><For each={selectedEntries()} fallback={<div class="agenda-empty"><Icon name="calendar" size={29} /><strong>A little breathing room</strong><p>{props.query ? "No matches on this day." : "Nothing scheduled for this day."}</p></div>}>{entry => <button class="agenda-entry" onClick={() => props.onEdit(entry.item)}><span class={`agenda-entry-mark ${entry.className}`} /><span><small>{entry.kindLabel}</small><strong>{displayTitle(entry.item)}</strong></span><Icon name="arrow" size={15} /></button>}</For></div>
        <button class="secondary-button agenda-add" onClick={() => props.onCreateForDay(selectedDay())}><Icon name="plus" size={16} />Add an event</button>
      </aside>
    </div>
  </section>;
}
