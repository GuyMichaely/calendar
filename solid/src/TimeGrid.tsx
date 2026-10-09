import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, onMount } from "solid-js";
import { textMatches } from "../../site/domain.js";
import { calendarEntries, todaysWork } from "./calendar-entries";
import { isDormant } from "./dependencies";
import type { Editable } from "./ItemEditor";
import { occurrenceTask } from "./repeats";
import { effectivelyDone, placementOf, pushedDownInfo } from "./today";
import type { Item, Task } from "./types";
import { openingOn, taskSchedule, windowsById } from "./windows";
import { addDays, clockText, dayKey, formatIn, partsOf, startOfDay } from "./zone";

/** How many days the time grid shows side by side. */
export type GridDays = 1 | 3;

// Something on a day's grid, in minutes from the start of that day. Kinds: an event's block; a
// record's (outlined, or a marker when it has no end); a windowed task's opening (the first in
// view as itself, the later ones dotted); a pin where a task can start or is due.
type Placed = {
  key: string; item: Editable; start: number; end: number;
  kind: "event" | "record" | "record-mark" | "window" | "window-later" | "start" | "due";
  label: string; detail: string; faded?: boolean;
  // Set by the layout: its column among those it overlaps, and how many there are.
  col?: number; cols?: number; cluster?: number;
};
// Untimed things, in the strip above the hours.
type Strip = { key: string; item: Editable; kind: "event" | "record" | "start" | "due" | "overdue"; label: string };
type Column = { date: Date; blocks: Placed[]; strip: Strip[]; todos: Task[] };

const MINUTE = 60_000, DAY_MINUTES = 24 * 60;
// A pin or marker takes this long on the grid, so two at the same time sit side by side.
const MARK_MINUTES = 30;
// Hours always shown; the range grows to take in anything earlier or later.
const FIRST_HOUR = 7, LAST_HOUR = 23;
const MAX_COLUMNS = 3;

const time = (value?: string | null) => { const date = value ? new Date(value) : null; return date && !Number.isNaN(date.getTime()) ? date : null; };
const midnight = (date: Date) => { const { hour, minute } = partsOf(date); return !hour && !minute; };
const title = (item: Item) => String(item.title || "").trim() || `Untitled ${item.kind}`;
// Minutes into `day` (its own clock), clamped to the day.
const minutesIn = (date: Date, day: Date) => {
  if (date <= day) return 0;
  if (date >= addDays(day, 1)) return DAY_MINUTES;
  const { hour, minute } = partsOf(date);
  return hour * 60 + minute;
};
const hourLabel = (hour: number) => hour === 0 || hour === 24 ? "12 AM" : hour === 12 ? "12 PM" : hour < 12 ? `${hour} AM` : `${hour - 12} PM`;

/** Overlapping blocks share the width, side by side; beyond MAX_COLUMNS the rest fold into "+N". */
function pack(blocks: Placed[]) {
  const sorted = [...blocks].sort((a, b) => a.start - b.start || b.end - a.end);
  let cluster: Placed[] = [], end = -1, id = 0;
  const flush = () => {
    const columns: number[] = [];
    for (const block of cluster) {
      let col = columns.findIndex(last => last <= block.start);
      if (col < 0) { col = columns.length; columns.push(block.end); } else columns[col] = block.end;
      Object.assign(block, { col, cluster: id });
    }
    for (const block of cluster) block.cols = columns.length;
    id++;
  };
  for (const block of sorted) {
    if (cluster.length && block.start >= end) { flush(); cluster = []; end = -1; }
    cluster.push(block);
    end = Math.max(end, block.end);
  }
  if (cluster.length) flush();
  return sorted;
}

/**
 * One or three days by the hour, like a day planner: events as blocks, records as markers (or
 * outlined, with an end), a windowed task's openings (the first in view as a block, the later
 * ones dotted), and pins where tasks can start or are due. Above the hours: all-day events and
 * date-only times, and today's overdue tasks and open todos (folded). Swipe sideways for the
 * days before or after; pinch (Ctrl+scroll, or −/+) to fit more or fewer hours, scroll for the rest.
 */
export function TimeGrid(props: {
  items: Item[];
  query: string;
  now: Date;
  // The first day shown.
  start: Date;
  days: GridDays;
  ghostIds: Set<string>;
  // Pixels per hour, as the zoom was last left on this device (null: fit the hours shown).
  hourHeight: number | null;
  onHourHeight: (height: number) => void;
  onShift: (days: number) => void;
  onEdit: (item: Editable) => void;
}) {
  const columns = createMemo((): Column[] => {
    const now = props.now, items = props.items;
    const dates = Array.from({ length: props.days }, (_, index) => addDays(startOfDay(props.start), index));
    const first = dates[0], after = addDays(dates.at(-1)!, 1);
    const byKey = new Map(dates.map(date => [dayKey(date), { date, blocks: [] as Placed[], strip: [] as Strip[], todos: [] as Task[] }]));
    const byId = new Map(items.map(item => [item.id, item]));
    const windows = windowsById(items);

    for (const item of items) {
      if (item.kind !== "event" && item.kind !== "record") continue;
      const start = time(item.start);
      if (!start) continue;
      const end = time(item.end);
      const until = end && end > start ? end : null;
      if ((until ?? start) < first || start >= after) continue;
      // A day or more, or midnight to midnight: all day, above the hours.
      const allDay = !!until && (until.getTime() - start.getTime() >= DAY_MINUTES * MINUTE || (midnight(start) && midnight(until)));
      const range = until ? `${clockText(start)}–${clockText(until)}` : clockText(start);
      for (const date of dates) {
        const next = addDays(date, 1);
        if (until ? start >= next || until <= date : start < date || start >= next) continue;
        const column = byKey.get(dayKey(date))!;
        const key = `${item.id}:${dayKey(date)}`;
        if (allDay) { column.strip.push({ key, item, kind: item.kind, label: title(item) }); continue; }
        const from = minutesIn(start, date);
        if (!until) column.blocks.push({ key, item, start: from, end: from + MARK_MINUTES, kind: "record-mark", label: title(item), detail: range });
        else column.blocks.push({ key, item, start: from, end: Math.max(from + 15, minutesIn(until, date)), kind: item.kind, label: title(item), detail: range, faded: until < now });
      }
    }

    // Tasks' can-start and due times (a windowed task's openings come next), and later occurrences.
    for (const entry of calendarEntries(items, first, dates.at(-1)!, now)) {
      if (entry.item.kind !== "task" || entry.kind === "event" || entry.kind === "record") continue;
      if (entry.item.windowId && entry.kind !== "due") continue;
      const column = byKey.get(dayKey(entry.at));
      if (!column) continue;
      const kind = entry.kind === "due" ? "due" : "start";
      const word = entry.kind === "due" ? entry.overdue ? "Overdue" : "Due" : entry.kind === "repeat" ? "Repeats" : "Can start";
      const key = `${entry.item.id}:${entry.kind}:${entry.at.getTime()}`;
      const faded = entry.pushed || props.ghostIds.has(entry.item.id);
      if (midnight(entry.at)) column.strip.push({ key, item: entry.item, kind, label: `${word}: ${title(entry.item)}` });
      else { const from = minutesIn(entry.at, column.date); column.blocks.push({ key, item: entry.item, start: from, end: from + MARK_MINUTES, kind, label: title(entry.item), detail: `${word} ${clockText(entry.at)}`, faded }); }
    }
    // A windowed task's openings in view, from when it can start: the first as itself, the rest dotted.
    for (const item of items) {
      if (item.kind !== "task" || !item.windowId || effectivelyDone(item, byId) || isDormant(item, byId)) continue;
      const task = occurrenceTask(item, now);
      const schedule = taskSchedule(task, windows);
      if (!schedule) continue;
      const canStart = time(task.availableFrom);
      const from = canStart && canStart > now ? canStart : now;
      const faded = pushedDownInfo(item, now).pushed || props.ghostIds.has(item.id);
      let shown = false;
      for (const date of dates) {
        const opening = openingOn(schedule, date);
        if (!opening || opening.closes <= from) continue;
        const range = `${clockText(opening.opens)}–${clockText(opening.closes)}`;
        byKey.get(dayKey(date))!.blocks.push({ key: `${item.id}:window:${dayKey(date)}`, item, start: minutesIn(opening.opens, date), end: minutesIn(opening.closes, date), kind: shown ? "window-later" : "window", label: title(item), detail: shown ? `Also open ${range}` : range, faded });
        shown = true;
      }
    }
    // Today: overdue tasks, and the open todos (tasks you can do now with nothing timed about them).
    const today = byKey.get(dayKey(now));
    if (today) for (const task of todaysWork(items, now)) {
      const placement = placementOf(task, items, now);
      if (placement.section === "firm" && placement.overdue) today.strip.unshift({ key: `${task.id}:overdue`, item: task, kind: "overdue", label: `Overdue: ${title(task)}` });
      else if (placement.section === "available") today.todos.push(task);
    }
    return dates.map(date => { const column = byKey.get(dayKey(date))!; return { ...column, blocks: pack(column.blocks) }; });
  });

  // The hours shown: the usual ones, and any others something falls in (and now, today).
  const hours = createMemo(() => {
    let first = FIRST_HOUR * 60, last = LAST_HOUR * 60;
    for (const column of columns()) for (const block of column.blocks) { first = Math.min(first, block.start); last = Math.max(last, block.end); }
    if (columns().some(column => dayKey(column.date) === dayKey(props.now))) { const now = minutesIn(props.now, startOfDay(props.now)); first = Math.min(first, now); last = Math.max(last, now + 30); }
    return { first: Math.floor(first / 60), last: Math.min(24, Math.ceil(last / 60)) };
  });
  const hourList = () => Array.from({ length: hours().last - hours().first }, (_, index) => hours().first + index);

  let scroller!: HTMLDivElement;
  const [viewHeight, setViewHeight] = createSignal(480);
  // The zoom left on this device, else the hours shown fitting the space.
  const [zoomed, setZoomed] = createSignal(props.hourHeight);
  const hourHeight = () => zoomed() ?? Math.max(28, Math.min(120, viewHeight() / (hours().last - hours().first)));
  const top = (minutes: number) => (minutes - hours().first * 60) * hourHeight() / 60;
  const zoomTo = (height: number, focusY = scroller.clientHeight / 2) => {
    const next = Math.max(20, Math.min(160, height)), before = hourHeight();
    const anchor = (scroller.scrollTop + focusY) / before;
    setZoomed(next);
    scroller.scrollTop = anchor * next - focusY;
  };
  const saveZoom = () => { if (zoomed() != null) props.onHourHeight(zoomed()!); };

  // The grid fills the window down to the bottom (or the phone's tab bar).
  const fit = () => {
    if (!scroller?.isConnected) return;
    const nav = document.querySelector<HTMLElement>(".mobile-nav");
    const bottom = nav && nav.offsetParent ? nav.getBoundingClientRect().height : 16;
    setViewHeight(Math.max(240, innerHeight - scroller.getBoundingClientRect().top - bottom));
  };
  // Opens on now (today), else on the first thing shown.
  const scrollToStart = () => {
    const today = columns().some(column => dayKey(column.date) === dayKey(props.now));
    const firstBlock = Math.min(...columns().flatMap(column => column.blocks.map(block => block.start)), Infinity);
    const minutes = today ? minutesIn(props.now, startOfDay(props.now)) - 60 : Number.isFinite(firstBlock) ? firstBlock - 30 : hours().first * 60;
    scroller.scrollTop = Math.max(0, top(minutes));
  };
  onMount(() => {
    fit();
    requestAnimationFrame(() => { fit(); scrollToStart(); });
    addEventListener("resize", fit);
    onCleanup(() => removeEventListener("resize", fit));
  });
  createEffect(on(() => [props.start.getTime(), props.days], () => requestAnimationFrame(scrollToStart), { defer: true }));

  // Touch: two fingers pinch the hours; one finger swiped sideways goes to the days before or after.
  const pointers = new Map<number, { x: number; y: number; x0: number; y0: number }>();
  let pinch: { distance: number; height: number } | null = null;
  const distance = () => { const [a, b] = [...pointers.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  const down = (event: PointerEvent) => {
    if (event.pointerType !== "touch") return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, x0: event.clientX, y0: event.clientY });
    if (pointers.size === 2) pinch = { distance: distance(), height: hourHeight() };
  };
  const move = (event: PointerEvent) => {
    const pointer = pointers.get(event.pointerId);
    if (!pointer) return;
    pointer.x = event.clientX; pointer.y = event.clientY;
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      zoomTo(pinch.height * distance() / pinch.distance, (a.y + b.y) / 2 - scroller.getBoundingClientRect().top);
    }
  };
  const up = (event: PointerEvent) => {
    const pointer = pointers.get(event.pointerId);
    pointers.delete(event.pointerId);
    if (pinch) { if (!pointers.size) { pinch = null; saveZoom(); } return; }
    if (!pointer || event.type === "pointercancel") return;
    const dx = pointer.x - pointer.x0, dy = pointer.y - pointer.y0;
    if (Math.abs(dx) > 60 && Math.abs(dx) > 2 * Math.abs(dy)) props.onShift(dx < 0 ? props.days : -props.days);
  };
  // A trackpad pinch (or Ctrl and the wheel) zooms too.
  const wheel = (event: WheelEvent) => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    zoomTo(hourHeight() * Math.exp(-event.deltaY * 0.01), event.clientY - scroller.getBoundingClientRect().top);
    clearTimeout(wheelSave);
    wheelSave = setTimeout(saveZoom, 300);
  };
  let wheelSave: ReturnType<typeof setTimeout> | undefined;
  onMount(() => { scroller.addEventListener("wheel", wheel, { passive: false }); onCleanup(() => scroller.removeEventListener("wheel", wheel)); });

  const [todosOpen, setTodosOpen] = createSignal(false);
  const [more, setMore] = createSignal<string | null>(null);
  const dimmed = (item: Item) => !!props.query && !textMatches(item, props.query);
  const isToday = (date: Date) => dayKey(date) === dayKey(props.now);
  const hasStrip = () => columns().some(column => column.strip.length || column.todos.length);

  const block = (placed: Placed) => {
    const width = () => 100 / Math.min(placed.cols!, MAX_COLUMNS);
    const height = () => Math.max(18, (placed.end - placed.start) * hourHeight() / 60 - 2);
    // Too short for two lines: the name and its time on one.
    return <button type="button" class={`grid-block ${placed.kind}`} classList={{ faded: !!placed.faded, "search-dimmed": dimmed(placed.item), short: height() < 34 }}
      style={{ top: `${top(placed.start)}px`, height: `${height()}px`, left: `${placed.col! * width()}%`, width: `calc(${width()}% - 2px)` }}
      title={`${placed.label} · ${placed.detail}`} onClick={() => props.onEdit(placed.item)}>
      <strong>{placed.label}</strong><small>{placed.detail}</small>
    </button>;
  };

  return <div class="timegrid" style={{ "--hour": `${hourHeight()}px`, "--grid-days": props.days }}>
    <div class="timegrid-head">
      <span class="timegrid-gutter" />
      <For each={columns()}>{column => <div class="timegrid-dayhead" classList={{ today: isToday(column.date) }}>
        <span>{formatIn(column.date, { weekday: "short" })}</span><strong>{partsOf(column.date).day}</strong>
      </div>}</For>
    </div>
    <Show when={hasStrip()}>
      <div class="timegrid-strip">
        <span class="timegrid-gutter" />
        <For each={columns()}>{column => <div class="timegrid-strip-day">
          <For each={column.strip}>{entry => <button type="button" class={`grid-chip ${entry.kind}`} classList={{ "search-dimmed": dimmed(entry.item) }} title={entry.label} onClick={() => props.onEdit(entry.item)}>{entry.label}</button>}</For>
          <Show when={column.todos.length}><button type="button" class="grid-chip todos" aria-expanded={todosOpen()} onClick={() => setTodosOpen(open => !open)}>{column.todos.length} open {column.todos.length === 1 ? "todo" : "todos"} {todosOpen() ? "▴" : "▾"}</button></Show>
        </div>}</For>
      </div>
      <Show when={todosOpen()}>
        <div class="timegrid-todos"><For each={columns().find(column => column.todos.length)?.todos ?? []}>{task =>
          <button type="button" class="grid-todo" classList={{ "search-dimmed": dimmed(task) }} onClick={() => props.onEdit(task)}>{title(task)}</button>}</For></div>
      </Show>
    </Show>
    <div class="timegrid-scroll" ref={scroller} style={{ height: `${viewHeight()}px` }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      <div class="timegrid-body" style={{ height: `${(hours().last - hours().first) * hourHeight()}px` }}>
        <div class="timegrid-hours timegrid-gutter"><For each={hourList()}>{hour => <span style={{ top: `${(hour - hours().first) * hourHeight()}px` }}>{hourLabel(hour)}</span>}</For></div>
        <For each={columns()}>{column => {
          const shown = () => column.blocks.filter(placed => placed.cols! <= MAX_COLUMNS || placed.col! < MAX_COLUMNS - 1);
          // A crowded stretch's "+N": the blocks that didn't fit, listed when tapped.
          const folds = () => {
            const hidden = column.blocks.filter(placed => placed.cols! > MAX_COLUMNS && placed.col! >= MAX_COLUMNS - 1);
            return [...new Set(hidden.map(placed => placed.cluster!))].map(cluster => { const list = hidden.filter(placed => placed.cluster === cluster); return { key: `${dayKey(column.date)}:${cluster}`, list, start: Math.min(...list.map(placed => placed.start)) }; });
          };
          return <div class="timegrid-day" classList={{ today: isToday(column.date) }}>
            <For each={shown()}>{block}</For>
            <For each={folds()}>{fold => <>
              <button type="button" class="grid-more" style={{ top: `${top(fold.start)}px`, left: `${(MAX_COLUMNS - 1) * 100 / MAX_COLUMNS}%`, width: `calc(${100 / MAX_COLUMNS}% - 2px)` }} aria-expanded={more() === fold.key} onClick={() => setMore(open => open === fold.key ? null : fold.key)}>+{fold.list.length}</button>
              <Show when={more() === fold.key}><div class="grid-more-list" style={{ top: `${top(fold.start) + 26}px` }}>
                <For each={fold.list}>{placed => <button type="button" onClick={() => { setMore(null); props.onEdit(placed.item); }}><strong>{placed.label}</strong><small>{placed.detail}</small></button>}</For>
              </div></Show>
            </>}</For>
            <Show when={isToday(column.date)}><div class="grid-now" style={{ top: `${top(minutesIn(props.now, startOfDay(props.now)))}px` }} /></Show>
          </div>;
        }}</For>
      </div>
    </div>
    <div class="timegrid-zoom" aria-label="Zoom">
      <button type="button" class="icon-button" aria-label="Fewer hours, taller" onClick={() => { zoomTo(hourHeight() * 1.25); saveZoom(); }}>+</button>
      <button type="button" class="icon-button" aria-label="More hours, shorter" onClick={() => { zoomTo(hourHeight() / 1.25); saveZoom(); }}>−</button>
    </div>
  </div>;
}
