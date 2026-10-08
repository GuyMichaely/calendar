import { For, Show, createMemo, createSignal, on, createEffect } from "solid-js";
import { textMatches } from "../../site/domain.js";
import { Icon } from "./Icon";
import { calendarEntries, leafTasks, todaysWork, type CalendarEntry } from "./calendar-entries";
import { placementOf, type Placement } from "./today";
import { when } from "./TodayView";
import { shutsAt, windowsById } from "./windows";
import { addDays, clockText, dayKey, formatIn, partsOf, startOfDay } from "./zone";
import type { CalendarEvent, Item, Task } from "./types";

/** How many days the Agenda shows, today first. */
export type AgendaDays = 1 | 3 | 7;
export const agendaDayChoices: [AgendaDays, string][] = [[1, "Today"], [3, "3 days"], [7, "7 days"]];

type Row = {
  item: Task | CalendarEvent;
  // Where it goes in its day (null: no time, for Open todos).
  at: Date | null;
  label: string;
  mark: string;
  past?: boolean;
  // A repeating task: its occurrences in the days shown (it's listed once, at the first).
  repeats?: Date[];
};
type Day = { date: Date; rows: Row[] };

const time = (value?: string | null) => { const date = value ? new Date(value) : null; return date && !Number.isNaN(date.getTime()) ? date : null; };
// Midnight is just the day.
const timeOf = (date: Date) => { const { hour, minute } = partsOf(date); return hour || minute ? clockText(date) : ""; };
const title = (item: Item) => String(item.title || "").trim() || (item.kind === "event" ? "Untitled event" : "Untitled task");

/**
 * The days ahead at a glance, like the Calendar's day list: each day's events and timed tasks in
 * time order, today's overdue and open-now tasks first. Each task shows once in the days shown,
 * where it first comes up: a task whose window opens several times shows at the first opening, and
 * a repeating one at its first occurrence with how many there are. A task due on a later day
 * shows on that day; a day with nothing in it doesn't show. Tasks you can do now with nothing
 * timed about them in these days go last,
 * in Open todos (folded unless `todosOpen`).
 */
export function AgendaView(props: {
  items: Item[];
  query: string;
  now: Date;
  days: AgendaDays;
  onDaysChange: (days: AgendaDays) => void;
  todosOpen: boolean;
  onEdit: (item: Task | CalendarEvent) => void;
}) {
  const [todosOpen, setTodosOpen] = createSignal(props.todosOpen);
  createEffect(on(() => props.todosOpen, open => setTodosOpen(open), { defer: true }));

  const agenda = createMemo((): { days: Day[]; todos: Row[] } => {
    const now = props.now, items = props.items, today = startOfDay(now);
    const shown = (item: Item) => !props.query || textMatches(item, props.query);
    const dates = Array.from({ length: props.days }, (_, index) => addDays(today, index));
    const byDay = new Map(dates.map(date => [dayKey(date), { date, rows: [] as Row[] }]));
    const todos: Row[] = [];
    const todayBlock = byDay.get(dayKey(today))!;
    const windows = windowsById(items);
    const entries = calendarEntries(items, today, dates.at(-1)!, now);
    const seen = new Set<string>();

    // A repeating task's occurrences in these days: the current one (if it's in them) and the later ones.
    const repeats = new Map<string, Date[]>();
    const occurrence = (item: Item, at: Date) => { if (item.kind === "task" && item.repeat) repeats.set(item.id, [...(repeats.get(item.id) ?? []), at]); };
    const work = todaysWork(items, now);
    const working = new Set(work.map(task => task.id));
    for (const task of work) occurrence(task, now);
    const current = new Set(working);
    for (const entry of entries) {
      if (entry.kind === "repeat") occurrence(entry.item, entry.at);
      else if (entry.kind !== "event" && !current.has(entry.item.id)) { current.add(entry.item.id); occurrence(entry.item, entry.at); }
    }

    // Today's tasks, as the List places them.
    const describe = (task: Task, placement: Placement): Row | null => {
      const schedule = task.windowId ? windows.get(task.windowId) : undefined;
      if (placement.section === "firm") return { item: task, at: placement.due ?? now, mark: "task due", label: !placement.due ? "Due soon" : placement.overdue ? `Overdue · was due ${when(placement.due, now)}` : `Due ${timeOf(placement.due) || "today"}` };
      if (placement.section === "closing") { const shuts = placement.closes && (schedule ? shutsAt(schedule, { closes: placement.closes }) : placement.closes); return { item: task, at: now, mark: "task start", label: shuts ? `Open now · until ${clockText(shuts)}` : "Open now" }; }
      if (placement.section === "later" && placement.opens) { const shuts = schedule && placement.closes ? shutsAt(schedule, { closes: placement.closes }) : null; return { item: task, at: placement.opens, mark: "task start", label: shuts ? `${clockText(placement.opens)}–${clockText(shuts)}` : `From ${clockText(placement.opens)}` }; }
      return null;
    };
    for (const task of work) {
      if (!shown(task)) { seen.add(task.id); continue; }
      const placement = placementOf(task, items, now);
      const row = describe(task, placement);
      // Overdue goes first today; due later than today goes on its day (if shown), else in Open todos.
      const day = row?.at && !placement.overdue ? byDay.get(dayKey(row.at)) : todayBlock;
      if (row && day) day.rows.push(day === todayBlock ? row : { ...row, label: `Due ${timeOf(row.at!) || ""}`.trim() });
      else todos.push({ item: task, at: null, mark: "task start", label: placement.due ? `Due ${when(placement.due, now)}` : "" });
      seen.add(task.id);
    }

    // Everything else that comes up: events, and tasks' starts, deadlines, and repeats (a task
    // with subtasks as its open subtasks, the work actually done).
    const entryRow = (entry: CalendarEntry, item: Task | CalendarEvent): Row => {
      if (item.kind === "event") {
        const end = time(item.end);
        return { item, at: entry.at, mark: "event", label: [timeOf(entry.at), end && dayKey(end) === dayKey(entry.at) ? clockText(end) : ""].filter(Boolean).join("–") || "All day", past: (end ?? entry.at) < now };
      }
      const at = timeOf(entry.at);
      const pushed = entry.pushed ? " pushed-entry" : "";
      if (entry.kind === "due") return { item, at: entry.at, mark: `task due${pushed}`, label: entry.overdue ? `Overdue · was due ${clockText(entry.at)}` : ["Due", at].filter(Boolean).join(" ") };
      return { item, at: entry.at, mark: `task start${pushed}`, label: ["Can start", at && entry.until ? `${at}–${clockText(entry.until)}` : at].filter(Boolean).join(" · ") };
    };
    for (const entry of entries) {
      const block = byDay.get(dayKey(entry.at));
      // Records are for the Calendar and search: nothing to do.
      if (!block || entry.item.kind === "record") continue;
      const listed = entry.item.kind === "task" ? leafTasks(items, entry.item) : [entry.item];
      for (const item of listed) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        if (shown(item)) block.rows.push(entryRow(entry, item));
      }
    }

    const order = (a: Row, b: Row) => (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0);
    const withRepeats = (row: Row) => { const found = repeats.get(row.item.id); return found && found.length > 1 ? { ...row, repeats: found } : row; };
    return { days: dates.map(date => ({ date, rows: byDay.get(dayKey(date))!.rows.sort(order).map(withRepeats) })), todos: todos.map(withRepeats) };
  });

  const dayName = (date: Date) => {
    const index = Math.round((startOfDay(date).getTime() - startOfDay(props.now).getTime()) / 86_400_000);
    return index === 0 ? "Today" : index === 1 ? "Tomorrow" : formatIn(date, { weekday: "long" });
  };
  const row = (entry: Row) => <button class="agenda-entry" classList={{ "agenda-past": !!entry.past }} onClick={() => props.onEdit(entry.item)}>
    <span class={`agenda-entry-mark ${entry.mark}`} />
    <span><Show when={entry.label}><small>{entry.label}</small></Show><strong>{title(entry.item)}</strong></span>
    <Show when={entry.repeats}>{dates => <span class="agenda-repeats" title={`Comes up ${dates().length} times: ${dates().map(date => formatIn(date, { weekday: "short", month: "short", day: "numeric" })).join(", ")}`}>×{dates().length}</span>}</Show>
    <Icon name="arrow" size={15} />
  </button>;

  // Today's rows, with where now falls among them.
  const todayRows = (rows: Row[]) => {
    const split = rows.findIndex(entry => entry.at && entry.at > props.now);
    if (split <= 0 || split === rows.length) return <For each={rows}>{row}</For>;
    return <><For each={rows.slice(0, split)}>{row}</For><div class="agenda-now"><span>Now · {clockText(props.now)}</span></div><For each={rows.slice(split)}>{row}</For></>;
  };

  return <section class="panel today-panel agenda-panel">
    <div class="today-heading">
      <h1>Agenda</h1>
      <span class="today-date">{formatIn(props.now, { weekday: "short", month: "short", day: "numeric" })} · {clockText(props.now)}</span>
      <span class="spacer" />
      <div class="agenda-range" role="group" aria-label="Days shown">
        <For each={agendaDayChoices}>{([days, label]) => <button type="button" aria-pressed={props.days === days} onClick={() => props.onDaysChange(days)}>{label}</button>}</For>
      </div>
    </div>
    {/* Days with nothing in them don't show. */}
    <For each={agenda().days.filter(day => day.rows.length)} fallback={<p class="agenda-quiet">{props.query ? "No matches." : props.days === 1 ? "Nothing scheduled today." : `Nothing scheduled in the next ${props.days} days.`}</p>}>{day =>
      <section class="agenda-day" aria-label={dayName(day.date)}>
        <Show when={props.days > 1}><h2 class="agenda-day-heading"><span>{dayName(day.date)}</span><small>{formatIn(day.date, { month: "short", day: "numeric" })}</small></h2></Show>
        <div class="agenda-entries">{dayKey(day.date) === dayKey(props.now) ? todayRows(day.rows) : <For each={day.rows}>{row}</For>}</div>
      </section>}
    </For>
    <Show when={agenda().todos.length}>
      <section class="agenda-day agenda-todos" aria-label="Open todos">
        <h2 class="agenda-day-heading"><button type="button" class="agenda-fold" aria-expanded={todosOpen()} onClick={() => setTodosOpen(open => !open)}>
          <span class="section-chevron" aria-hidden="true">›</span>Open todos<small>{agenda().todos.length}</small>
        </button></h2>
        <Show when={todosOpen()}><div class="agenda-entries"><For each={agenda().todos}>{row}</For></div></Show>
      </section>
    </Show>
  </section>;
}
