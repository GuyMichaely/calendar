<script lang="ts">
  import { onMount, tick } from "svelte";
  import {
    formatDateTime,
    isSleeping,
    nextActionableStart,
    sortTasks,
    taskMatchesFilter,
    textMatches,
    upcomingHorizonEnd,
  } from "../../site/domain.js";
  import TaskCard from "./TaskCard.svelte";
  import type { TaskRow } from "./task-row";
  import type { Shortcuts } from "./shortcuts";
  import { noteTaskFocus, syncTaskFocus } from "./task-focus";
  import type { HorizonMode, Item, Task } from "./types";

  const taskSections = [
    { id: "now", label: "Can do now", defaultOpen: true },
    { id: "upcoming", label: "Upcoming", defaultOpen: true },
    { id: "all", label: "All open", defaultOpen: false },
    { id: "completed", label: "Completed", defaultOpen: false },
  ] as const;

  type SectionId = (typeof taskSections)[number]["id"];
  type Props = {
    items: Item[];
    query: string;
    compact: boolean;
    horizonDays: number | null;
    horizonMode: HorizonMode;
    now: Date;
    shortcuts: Shortcuts;
    onCompactChange: (value: boolean) => void;
    onHorizonChange: (value: number | null) => void;
    onHorizonModeChange: (value: HorizonMode) => void;
    onEdit: (task: Task) => void;
    onComplete: (task: Task) => Promise<void>;
    onWake: (task: Task) => Promise<void>;
    onSleepTomorrow: (task: Task) => Promise<void>;
    onSleepIndefinite: (task: Task) => Promise<void>;
    onSleepCustom: (task: Task) => void;
    onSleepToWait: (task: Task) => Promise<void>;
    onWaitToSleep: (task: Task) => Promise<void>;
  };

  let {
    items, query, compact, horizonDays, horizonMode, now, shortcuts,
    onCompactChange, onHorizonChange, onHorizonModeChange, onEdit, onComplete,
    onWake, onSleepTomorrow, onSleepIndefinite, onSleepCustom, onSleepToWait, onWaitToSleep,
  }: Props = $props();

  function readSectionOpen(id: string, fallback: boolean) {
    const stored = localStorage.getItem(`calendar.section.${id}`);
    if (stored === "open") return true;
    if (stored === "closed") return false;
    return fallback;
  }

  let openSections = $state<Record<SectionId, boolean>>(
    Object.fromEntries(taskSections.map((section) => [section.id, readSectionOpen(section.id, section.defaultOpen)])) as Record<SectionId, boolean>,
  );
  let matching = $derived(items.filter((item): item is Task => item.kind === "task").filter((task) => textMatches(task, query)));
  let openCount = $derived(matching.filter((task) => !["completed", "canceled"].includes(task.state)).length);
  let actionable = $derived(sortTasks(matching.filter((task) => taskMatchesFilter(task, "now", now) && !isSleeping(task, now)), now) as Task[]);
  let horizonEnd = $derived(horizonDays === null ? null : upcomingHorizonEnd(now, horizonDays, horizonMode));
  let upcoming = $derived.by(() => matching
    .filter((task) => !["completed", "canceled"].includes(task.state) && !isSleeping(task, now))
    .map((task) => ({ task, upcomingAt: nextActionableStart(task, now) }))
    .filter((row): row is { task: Task; upcomingAt: Date } => !!row.upcomingAt && row.upcomingAt > now && (!horizonEnd || row.upcomingAt <= horizonEnd))
    .sort((a, b) => a.upcomingAt.getTime() - b.upcomingAt.getTime() || a.task.title.localeCompare(b.task.title)));
  let sleeping = $derived((sortTasks(
    matching.filter((task) => !["completed", "canceled"].includes(task.state) && isSleeping(task, now)), now,
  ) as Task[]).map((task) => ({ task, upcomingAt: nextActionableStart(task, now, { respectSleep: true }) })));
  let rows = $derived<Record<SectionId, TaskRow[]>>({
    now: actionable.map((task) => ({ task })),
    upcoming,
    all: (sortTasks(matching.filter((task) => taskMatchesFilter(task, "all", now)), now) as Task[]).map((task) => ({ task })),
    completed: (sortTasks(matching.filter((task) => taskMatchesFilter(task, "completed", now)), now) as Task[]).map((task) => ({ task })),
  });

  $effect(() => {
    void rows;
    void openSections;
    void tick().then(syncTaskFocus);
  });

  onMount(() => {
    const handleFocus = (event: FocusEvent) => noteTaskFocus(event.target);
    document.addEventListener("focusin", handleFocus);
    return () => document.removeEventListener("focusin", handleFocus);
  });

  function horizonLabel(days: number) {
    if (horizonMode !== "boundary") return `${days}d`;
    if (days === 1) return "Today";
    if (days === 7) return "This week";
    return "This month";
  }

  function emptyMessage(section: SectionId) {
    if (section === "now") return "Nothing is actionable right now.";
    if (section === "completed") return "No completed tasks.";
    if (section === "upcoming") {
      if (horizonDays === null) return "Nothing is waiting for a known future opportunity.";
      return `Nothing becomes actionable by ${formatDateTime(horizonEnd)}.`;
    }
    return "No open tasks.";
  }
</script>

<section class={`panel tasks-panel ${compact ? "compact" : ""}`}>
  <div class="panel-heading">
    <div>
      <h1>Tasks</h1>
      <p class="muted">{query ? `${openCount} matching open ${openCount === 1 ? "task" : "tasks"}` : `${openCount} open ${openCount === 1 ? "task" : "tasks"}`}</p>
    </div>
    <button type="button" class={`secondary-button density-toggle ${compact ? "active" : ""}`} aria-pressed={compact} onclick={() => onCompactChange(!compact)}>Compact</button>
  </div>

  <div class="task-sections">
    {#each taskSections as section (section.id)}
      {@const sectionRows = rows[section.id]}
      {@const sleepingRows = section.id === "upcoming" ? sleeping : []}
      {@const label = section.id === "upcoming" && horizonDays === null ? "Waiting" : section.label}
      <details
        class="task-section"
        data-section={section.id}
        open={openSections[section.id]}
        ontoggle={(event) => {
          const open = event.currentTarget.open;
          openSections[section.id] = open;
          localStorage.setItem(`calendar.section.${section.id}`, open ? "open" : "closed");
        }}
      >
        <summary>
          <span class="section-heading"><span class="section-chevron" aria-hidden="true">›</span><strong>{label}</strong></span>
          <span class="section-count">{sectionRows.length + sleepingRows.length}</span>
        </summary>
        <div class="task-section-body">
          {#if section.id === "upcoming"}
            <div class="horizon-row">
              <span class="horizon-label">{horizonDays === null ? "Showing all future opportunities" : "Limit to"}</span>
              <div class="horizon-controls">
                <div class="segmented horizon-control" aria-label="Upcoming task horizon">
                  {#each [1, 7, 30] as days}
                    <button type="button" class:active={horizonDays === days} aria-pressed={horizonDays === days} onclick={() => onHorizonChange(horizonDays === days ? null : days)}>{horizonLabel(days)}</button>
                  {/each}
                </div>
                <button type="button" class={`secondary-button boundary-toggle ${horizonMode === "boundary" ? "active" : ""}`} aria-pressed={horizonMode === "boundary"} title="Use the end of the current day, week, or month instead of a rolling 1, 7, or 30 days." onclick={() => onHorizonModeChange(horizonMode === "boundary" ? "rolling" : "boundary")}>End of day/week/month</button>
              </div>
            </div>
          {/if}

          <div class="task-list section-task-list">
            {#if sectionRows.length}
              {#each sectionRows as row (row.task.id)}
                <TaskCard {row} {now} {shortcuts} showAvailability={section.id === "upcoming"} {onEdit} {onComplete} {onWake} {onSleepTomorrow} {onSleepIndefinite} {onSleepCustom} {onSleepToWait} {onWaitToSleep} />
              {/each}
            {:else}
              <div class="section-empty">{emptyMessage(section.id)}</div>
            {/if}
          </div>

          {#if section.id === "upcoming" && sleepingRows.length}
            <div class="sleeping-block">
              <div class="sleeping-heading"><span>Sleeping</span><span>{sleepingRows.length}</span></div>
              <div class="task-list section-task-list sleeping-task-list">
                {#each sleepingRows as row (row.task.id)}
                  <TaskCard {row} {now} {shortcuts} showAvailability {onEdit} {onComplete} {onWake} {onSleepTomorrow} {onSleepIndefinite} {onSleepCustom} {onSleepToWait} {onWaitToSleep} />
                {/each}
              </div>
            </div>
          {/if}
        </div>
      </details>
    {/each}
  </div>
</section>
