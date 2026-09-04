<script lang="ts">
  import {
    actionability,
    formatDateTime,
    nextActionableStart,
    sleepInfo,
    toDate,
  } from "../../site/domain.js";
  import TaskActionIcon from "./TaskActionIcon.svelte";
  import { actionForKey, normalizeEventKey, type Shortcuts } from "./shortcuts";
  import { focusCard, isInteractiveTarget, moveTaskFocus, rememberCard } from "./task-focus";
  import type { Attachment, Task } from "./types";
  import type { TaskRow } from "./task-row";

  type Props = {
    row: TaskRow;
    now: Date;
    shortcuts: Shortcuts;
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
    row,
    now,
    shortcuts,
    onEdit,
    onComplete,
    onWake,
    onSleepTomorrow,
    onSleepIndefinite,
    onSleepCustom,
    onSleepToWait,
    onWaitToSleep,
  }: Props = $props();

  let task = $derived(row.task);
  let upcomingAt = $derived(row.upcomingAt);
  let result = $derived(actionability(task, now));
  let sleep = $derived(sleepInfo(task, now));
  let closed = $derived(["completed", "canceled"].includes(task.state));
  let futureAvailable = $derived(toDate(task.availableFrom));
  let canConvertWaitToSleep = $derived(!sleep.sleeping && !!futureAvailable && futureAvailable > now);
  let timing = $derived.by(() => {
    const values: string[] = [];
    if (task.deadline) values.push(`Due ${formatDateTime(task.deadline)}`);
    if (task.latestStart) values.push(`Latest start ${formatDateTime(task.latestStart)}`);
    const schedule = task.availabilitySchedule;
    if (schedule?.enabled) {
      const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      values.push(`${schedule.days.map((day) => names[day]).join(", ") || "No days"} ${schedule.start}-${schedule.end}`);
    }
    return values;
  });
  let next = $derived(nextActionableStart(task, now, { respectSleep: sleep.sleeping }));
  let summary = $derived(
    sleep.sleeping && sleep.indefinite
      ? "Sleeping indefinitely"
      : sleep.sleeping
        ? next && Math.abs(next.getTime() - sleep.until.getTime()) >= 60000
          ? `Sleeping until ${friendlyWhen(sleep.until, now)} · available ${friendlyWhen(next, now)}`
          : `Sleeping until ${friendlyWhen(sleep.until, now)}`
        : upcomingAt ? `Available ${friendlyWhen(upcomingAt, now)}` : "",
  );
  let statusText = $derived(
    sleep.sleeping
      ? sleep.indefinite ? "Sleeping indefinitely" : `Sleeping until ${formatDateTime(sleep.until)}`
      : result.reason,
  );

  function friendlyWhen(date: Date | null, reference = new Date()) {
    if (!date) return "";
    const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
    const today = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate());
    const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const days = Math.round((target.getTime() - today.getTime()) / 86400000);
    if (days === 0) return `today · ${time}`;
    if (days === 1) return `tomorrow · ${time}`;
    if (days > 1 && days < 7) return `${new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(date)} · ${time}`;
    return `${new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date)} · ${time}`;
  }

  function taskTitle(value: Task) {
    return String(value.title || "").replace(/[\p{Cf}\p{Cc}\s]/gu, "") ? value.title : "Untitled task";
  }

  function openAttachment(attachment: Attachment) {
    if (!attachment.blob) return;
    const url = URL.createObjectURL(attachment.blob);
    window.open(url, "_blank", "noopener,noreferrer");
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter") {
      event.preventDefault();
      onEdit(task);
      return;
    }
    if (["ArrowUp", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      moveTaskFocus(event.key === "ArrowUp" ? -1 : 1, event.currentTarget as HTMLElement);
      return;
    }
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    const action = actionForKey(normalizeEventKey(event), shortcuts);
    if (!action || closed) return;
    event.preventDefault();
    if (action === "complete") void onComplete(task);
    else if (action === "sleepTomorrow") void onSleepTomorrow(task);
    else if (action === "sleepIndefinite") void onSleepIndefinite(task);
    else onSleepCustom(task);
  }
</script>

<article
  class={`task-card ${sleep.sleeping ? "sleeping-task" : ""}`}
  data-id={task.id}
  data-task-card="true"
  tabindex="-1"
  onfocus={(event) => rememberCard(event.currentTarget)}
  onpointerdown={(event) => {
    if (isInteractiveTarget(event.target)) return;
    focusCard(event.currentTarget, { scroll: false });
  }}
  onkeydown={handleKeyDown}
>
  <div class="task-main">
    {#if closed}
      <span class="complete-indicator" aria-hidden="true">✓</span>
    {:else}
      <button class="complete-button" aria-label="Mark complete" title="Mark complete" onclick={() => void onComplete(task)}></button>
    {/if}
    <div class="task-copy">
      <div class="task-title-row">
        <h3>
          <button class="task-title-link" aria-label={`Edit ${taskTitle(task)}`} title={`Edit ${taskTitle(task)}`} onclick={() => onEdit(task)}>{taskTitle(task)}</button>
        </h3>
        <span class={`status-pill ${result.actionable && !sleep.sleeping ? "ready" : sleep.sleeping ? "sleeping" : "quiet"}`}>{statusText}</span>
      </div>
      {#if summary}<div class="availability-summary">{summary}</div>{/if}
      {#if task.notes}<p class="notes">{task.notes}</p>{/if}
      {#if timing.length}
        <div class="timing">{#each timing as value}<span>{value}</span>{/each}</div>
      {/if}
      {#if task.tags?.length}
        <div class="tags">{#each task.tags as tag}<span class="tag">{tag}</span>{/each}</div>
      {/if}
      {#if task.attachments?.length}
        <div class="attachments">
          {#each task.attachments as attachment (attachment.id)}
            <button class="attachment" onclick={() => openAttachment(attachment)}>Attachment: {attachment.name || "Attachment"}</button>
          {/each}
        </div>
      {/if}
    </div>
  </div>
  {#if !closed}
    <div class="task-actions">
      {#if sleep.sleeping}
        <button class="text-button" onclick={() => void onWake(task)}>Wake</button>
        <button class="text-button" onclick={() => onSleepCustom(task)}>Change sleep…</button>
        {#if !sleep.indefinite}<button class="text-button" onclick={() => void onSleepToWait(task)}>Wait instead</button>{/if}
      {:else}
        <TaskActionIcon action="sleepTomorrow" {shortcuts} onclick={() => void onSleepTomorrow(task)} />
        <TaskActionIcon action="sleepIndefinite" {shortcuts} onclick={() => void onSleepIndefinite(task)} />
        <TaskActionIcon action="customSleep" {shortcuts} onclick={() => onSleepCustom(task)} />
        {#if canConvertWaitToSleep}<button class="text-button" onclick={() => void onWaitToSleep(task)}>Sleep instead</button>{/if}
      {/if}
    </div>
  {/if}
</article>
