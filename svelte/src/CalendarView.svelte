<script lang="ts">
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

  type Props = {
    items: Item[];
    query: string;
    month: Date;
    now: Date;
    sleepMode: CalendarSleepMode;
    onMonthChange: (date: Date) => void;
    onSleepModeChange: (mode: CalendarSleepMode) => void;
    onEdit: (item: Item) => void;
    onCreateForDay: (date: Date) => void;
    onOpenTodayTasks: () => void;
  };

  let { items, query, month, now, sleepMode, onMonthChange, onSleepModeChange, onEdit, onCreateForDay, onOpenTodayTasks }: Props = $props();
  let today = $derived(dateKey(now));
  let start = $derived(calendarGridStart(month));
  let days = $derived(Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  }));
  let projectedStarts = $derived.by(() => {
    const starts = new Map<string, { task: Task; start: Date; bypassesSleep: boolean }>();
    const respectSleep = sleepMode === "respect";
    for (const item of items) {
      if (item.kind !== "task" || ["completed", "canceled"].includes(item.state)) continue;
      const projected = projectedTaskStart(item, now, respectSleep);
      if (!projected) continue;
      starts.set(item.id, {
        task: item,
        start: projected,
        bypassesSleep: projectedStartBypassesSleep(item, projected, now, respectSleep),
      });
    }
    return starts;
  });

  function shortTime(value: string | Date | null | undefined) {
    const date = value instanceof Date ? value : toDate(value);
    return date ? new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date) : "";
  }

  function entriesForDay(day: Date): CalendarEntry[] {
    const key = dateKey(day);
    const entries: CalendarEntry[] = [];
    for (const item of items) {
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
  }
</script>

<section class="panel calendar-panel">
  <div class="calendar-toolbar">
    <div class="month-controls">
      <button class="icon-button" aria-label="Previous month" onclick={() => onMonthChange(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>‹</button>
      <button class="text-button" onclick={() => {
        const date = new Date();
        onMonthChange(new Date(date.getFullYear(), date.getMonth(), 1));
      }}>Today</button>
      <button class="icon-button" aria-label="Next month" onclick={() => onMonthChange(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>›</button>
    </div>
    <div class="calendar-heading-actions">
      <button
        type="button"
        class={`secondary-button calendar-sleep-toggle ${sleepMode === "respect" ? "active" : ""}`}
        aria-pressed={sleepMode === "respect"}
        title={sleepMode === "respect" ? "Sleeping tasks are treated as unavailable until they wake." : "Sleep is ignored when projecting task opportunities."}
        onclick={() => onSleepModeChange(sleepMode === "respect" ? "ignore" : "respect")}
      >
        {sleepMode === "respect" ? "Respect sleep" : "Ignore sleep"}
      </button>
      <h1>{new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(month)}</h1>
    </div>
  </div>
  <div class="calendar-grid">
    {#each ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as name}
      <div class="weekday">{name}</div>
    {/each}
    {#each days as day (dateKey(day))}
      {@const key = dateKey(day)}
      {@const pending = key === today ? items.filter((item): item is Task => item.kind === "task" && isPendingOnDate(item, day)) : []}
      {@const matchingPending = query ? pending.filter((item) => textMatches(item, query)) : pending}
      {@const sleepingCount = matchingPending.filter((item) => isSleeping(item, now)).length}
      {@const entries = entriesForDay(day)}
      {@const itemLimit = 4 - (pending.length ? 1 : 0)}
      <div
        class={`calendar-day clickable ${day.getMonth() !== month.getMonth() ? "outside" : ""} ${key === today ? "today" : ""}`}
        onclick={(event) => {
          if ((event.target as Element).closest("button")) return;
          onCreateForDay(day);
        }}
      >
        <div class="day-number">{day.getDate()}</div>
        {#if pending.length}
          <button
            class={`calendar-chip task start ${query && !matchingPending.length ? "search-dimmed" : ""}`}
            title="Open today's tasks"
            onclick={(event) => { event.stopPropagation(); onOpenTodayTasks(); }}
          >
            {matchingPending.length} {matchingPending.length === 1 ? "task" : "tasks"}{sleepingCount ? ` - ${sleepingCount} sleeping` : ""}
          </button>
        {/if}
        {#each entries.slice(0, itemLimit) as entry, index (`${entry.item.id}:${entry.className}:${entry.sort}:${index}`)}
          <button
            class={`calendar-chip ${entry.className} ${query && !textMatches(entry.item, query) ? "search-dimmed" : ""}`}
            title={entry.title}
            onclick={(event) => { event.stopPropagation(); onEdit(entry.item); }}
          >
            {entry.label}
          </button>
        {/each}
        {#if entries.length > itemLimit}<div class="more-count">+{entries.length - itemLimit} more</div>{/if}
      </div>
    {/each}
  </div>
  <div class="calendar-legend">
    <span><i class="legend-dot event"></i>Event</span>
    <span><i class="legend-dot start"></i>Task start</span>
    <span><i class="legend-dot latest"></i>Latest start</span>
    <span><i class="legend-dot due"></i>Due</span>
  </div>
</section>
