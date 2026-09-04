import { useMemo, useState } from "preact/hooks";
import {
  actionability,
  formatDateTime,
  isSleeping,
  nextActionableStart,
  sleepInfo,
  sortTasks,
  taskMatchesFilter,
  textMatches,
  toDate,
  upcomingHorizonEnd,
} from "../../site/domain.js";
import { actionForKey, normalizeEventKey, type Shortcuts } from "./shortcuts";
import type { Attachment, HorizonMode, Item, Task } from "./types";

type TaskRow = { task: Task; upcomingAt?: Date | null };

const taskSections = [
  { id: "now", label: "Can do now", defaultOpen: true },
  { id: "upcoming", label: "Upcoming", defaultOpen: true },
  { id: "all", label: "All open", defaultOpen: false },
  { id: "completed", label: "Completed", defaultOpen: false },
] as const;

function readSectionOpen(id: string, fallback: boolean) {
  const stored = localStorage.getItem(`calendar.section.${id}`);
  if (stored === "open") return true;
  if (stored === "closed") return false;
  return fallback;
}

function friendlyWhen(date: Date | null, now = new Date()) {
  if (!date) return "";
  const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const days = Math.round((target.getTime() - today.getTime()) / 86400000);
  if (days === 0) return `today · ${time}`;
  if (days === 1) return `tomorrow · ${time}`;
  if (days > 1 && days < 7) return `${new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(date)} · ${time}`;
  return `${new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date)} · ${time}`;
}

function taskTitle(task: Task) {
  return String(task.title || "").replace(/[\p{Cf}\p{Cc}\s]/gu, "") ? task.title : "Untitled task";
}

export function TasksView(props: {
  items: Item[];
  query: string;
  compact: boolean;
  horizonDays: number | null;
  horizonMode: HorizonMode;
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
}) {
  const now = new Date();
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(taskSections.map((section) => [section.id, readSectionOpen(section.id, section.defaultOpen)])),
  );

  const matching = useMemo(
    () => props.items.filter((item): item is Task => item.kind === "task").filter((task) => textMatches(task, props.query)),
    [props.items, props.query],
  );
  const openCount = matching.filter((task) => !["completed", "canceled"].includes(task.state)).length;
  const actionable = sortTasks(
    matching.filter((task) => taskMatchesFilter(task, "now", now) && !isSleeping(task, now)),
    now,
  ) as Task[];
  const horizonEnd = props.horizonDays === null ? null : upcomingHorizonEnd(now, props.horizonDays, props.horizonMode);
  const upcoming = matching
    .filter((task) => !["completed", "canceled"].includes(task.state) && !isSleeping(task, now))
    .map((task) => ({ task, upcomingAt: nextActionableStart(task, now) as Date | null }))
    .filter((row) => row.upcomingAt && row.upcomingAt > now && (!horizonEnd || row.upcomingAt <= horizonEnd))
    .sort((a, b) => (a.upcomingAt?.getTime() || 0) - (b.upcomingAt?.getTime() || 0) || a.task.title.localeCompare(b.task.title));
  const sleeping = (sortTasks(
    matching.filter((task) => !["completed", "canceled"].includes(task.state) && isSleeping(task, now)),
    now,
  ) as Task[]).map((task) => ({ task, upcomingAt: nextActionableStart(task, now, { respectSleep: true }) as Date | null }));
  const rows: Record<string, TaskRow[]> = {
    now: actionable.map((task) => ({ task })),
    upcoming,
    all: (sortTasks(matching.filter((task) => taskMatchesFilter(task, "all", now)), now) as Task[]).map((task) => ({ task })),
    completed: (sortTasks(matching.filter((task) => taskMatchesFilter(task, "completed", now)), now) as Task[]).map((task) => ({ task })),
  };

  const horizonLabel = (days: number) => {
    if (props.horizonMode !== "boundary") return `${days}d`;
    if (days === 1) return "Today";
    if (days === 7) return "This week";
    return "This month";
  };

  return (
    <section class={`panel tasks-panel ${props.compact ? "compact" : ""}`}>
      <div class="panel-heading">
        <div>
          <h1>Tasks</h1>
          <p class="muted">{props.query ? `${openCount} matching open ${openCount === 1 ? "task" : "tasks"}` : `${openCount} open ${openCount === 1 ? "task" : "tasks"}`}</p>
        </div>
        <button type="button" class={`secondary-button density-toggle ${props.compact ? "active" : ""}`} aria-pressed={props.compact} onClick={() => props.onCompactChange(!props.compact)}>Compact</button>
      </div>

      <div class="task-sections">
        {taskSections.map((section) => {
          const sectionRows = rows[section.id];
          const sleepingRows = section.id === "upcoming" ? sleeping : [];
          const label = section.id === "upcoming" && props.horizonDays === null ? "Waiting" : section.label;
          return (
            <details
              key={section.id}
              class="task-section"
              data-section={section.id}
              open={openSections[section.id]}
              onToggle={(event) => {
                const open = event.currentTarget.open;
                setOpenSections((current) => ({ ...current, [section.id]: open }));
                localStorage.setItem(`calendar.section.${section.id}`, open ? "open" : "closed");
              }}
            >
              <summary>
                <span class="section-heading"><span class="section-chevron" aria-hidden="true">›</span><strong>{label}</strong></span>
                <span class="section-count">{sectionRows.length + sleepingRows.length}</span>
              </summary>
              <div class="task-section-body">
                {section.id === "upcoming" ? (
                  <div class="horizon-row">
                    <span class="horizon-label">{props.horizonDays === null ? "Showing all future opportunities" : "Limit to"}</span>
                    <div class="horizon-controls">
                      <div class="segmented horizon-control" aria-label="Upcoming task horizon">
                        {[1, 7, 30].map((days) => (
                          <button key={days} type="button" class={props.horizonDays === days ? "active" : ""} aria-pressed={props.horizonDays === days} onClick={() => props.onHorizonChange(props.horizonDays === days ? null : days)}>{horizonLabel(days)}</button>
                        ))}
                      </div>
                      <button type="button" class={`secondary-button boundary-toggle ${props.horizonMode === "boundary" ? "active" : ""}`} aria-pressed={props.horizonMode === "boundary"} title="Use the end of the current day, week, or month instead of a rolling 1, 7, or 30 days." onClick={() => props.onHorizonModeChange(props.horizonMode === "boundary" ? "rolling" : "boundary")}>End of day/week/month</button>
                    </div>
                  </div>
                ) : null}

                <div class="task-list section-task-list">
                  {sectionRows.length ? sectionRows.map((row) => <TaskCard key={row.task.id} row={row} now={now} {...props} />) : (
                    <div class="section-empty">
                      {section.id === "now" ? "Nothing is actionable right now." : section.id === "completed" ? "No completed tasks." : section.id === "upcoming" ? props.horizonDays === null ? "Nothing is waiting for a known future opportunity." : `Nothing becomes actionable by ${formatDateTime(horizonEnd)}.` : "No open tasks."}
                    </div>
                  )}
                </div>

                {section.id === "upcoming" && sleepingRows.length ? (
                  <div class="sleeping-block">
                    <div class="sleeping-heading"><span>Sleeping</span><span>{sleepingRows.length}</span></div>
                    <div class="task-list section-task-list sleeping-task-list">
                      {sleepingRows.map((row) => <TaskCard key={row.task.id} row={row} now={now} {...props} />)}
                    </div>
                  </div>
                ) : null}
              </div>
            </details>
          );
        })}
      </div>
    </section>
  );
}

function TaskCard(props: {
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
  [key: string]: unknown;
}) {
  const { task, upcomingAt } = props.row;
  const result = actionability(task, props.now);
  const sleep = sleepInfo(task, props.now);
  const closed = ["completed", "canceled"].includes(task.state);
  const futureAvailable = toDate(task.availableFrom);
  const canConvertWaitToSleep = !sleep.sleeping && futureAvailable && futureAvailable > props.now;
  const timing: string[] = [];
  if (task.deadline) timing.push(`Due ${formatDateTime(task.deadline)}`);
  if (task.latestStart) timing.push(`Latest start ${formatDateTime(task.latestStart)}`);
  const schedule = task.availabilitySchedule;
  if (schedule?.enabled) {
    const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    timing.push(`${schedule.days.map((day) => names[day]).join(", ") || "No days"} ${schedule.start}-${schedule.end}`);
  }
  const next = nextActionableStart(task, props.now, { respectSleep: sleep.sleeping }) as Date | null;
  const summary = sleep.sleeping && sleep.indefinite
    ? "Sleeping indefinitely"
    : sleep.sleeping
      ? next && Math.abs(next.getTime() - sleep.until.getTime()) >= 60000
        ? `Sleeping until ${friendlyWhen(sleep.until, props.now)} · available ${friendlyWhen(next, props.now)}`
        : `Sleeping until ${friendlyWhen(sleep.until, props.now)}`
      : upcomingAt ? `Available ${friendlyWhen(upcomingAt, props.now)}` : "";
  const statusText = sleep.sleeping ? sleep.indefinite ? "Sleeping indefinitely" : `Sleeping until ${formatDateTime(sleep.until)}` : result.reason;

  const openAttachment = (attachment: Attachment) => {
    if (!attachment.blob) return;
    const url = URL.createObjectURL(attachment.blob);
    window.open(url, "_blank", "noopener,noreferrer");
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter") {
      event.preventDefault();
      props.onEdit(task);
      return;
    }
    if (["ArrowUp", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      const cards = [...document.querySelectorAll<HTMLElement>('[data-task-card="true"]')].filter((card) => !card.closest("details:not([open])"));
      const index = cards.indexOf(event.currentTarget as HTMLElement);
      const nextIndex = event.key === "ArrowUp" ? index - 1 : index + 1;
      cards[nextIndex]?.focus();
      return;
    }
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    const action = actionForKey(normalizeEventKey(event), props.shortcuts);
    if (!action || closed) return;
    event.preventDefault();
    if (action === "complete") void props.onComplete(task);
    else if (action === "sleepTomorrow") void props.onSleepTomorrow(task);
    else if (action === "sleepIndefinite") void props.onSleepIndefinite(task);
    else props.onSleepCustom(task);
  };

  return (
    <article class={`task-card ${sleep.sleeping ? "sleeping-task" : ""}`} data-id={task.id} data-task-card="true" tabIndex={0} onKeyDown={onKeyDown}>
      <div class="task-main">
        {closed ? <span class="complete-indicator" aria-hidden="true">✓</span> : <button class="complete-button" aria-label="Mark complete" title="Mark complete" onClick={() => void props.onComplete(task)} />}
        <div class="task-copy">
          <div class="task-title-row">
            <h3><button class="task-title-link" aria-label={`Edit ${taskTitle(task)}`} title={`Edit ${taskTitle(task)}`} onClick={() => props.onEdit(task)}>{taskTitle(task)}</button></h3>
            <span class={`status-pill ${result.actionable && !sleep.sleeping ? "ready" : sleep.sleeping ? "sleeping" : "quiet"}`}>{statusText}</span>
          </div>
          {summary ? <div class="availability-summary">{summary}</div> : null}
          {task.notes ? <p class="notes">{task.notes}</p> : null}
          {timing.length ? <div class="timing">{timing.map((value) => <span key={value}>{value}</span>)}</div> : null}
          {task.tags?.length ? <div class="tags">{task.tags.map((tag) => <span key={tag} class="tag">{tag}</span>)}</div> : null}
          {task.attachments?.length ? <div class="attachments">{task.attachments.map((attachment) => <button key={attachment.id} class="attachment" onClick={() => openAttachment(attachment)}>Attachment: {attachment.name || "Attachment"}</button>)}</div> : null}
        </div>
      </div>
      {!closed ? (
        <div class="task-actions">
          {sleep.sleeping ? (
            <>
              <button class="text-button" onClick={() => void props.onWake(task)}>Wake</button>
              <button class="text-button" onClick={() => props.onSleepCustom(task)}>Change sleep…</button>
              {!sleep.indefinite ? <button class="text-button" onClick={() => void props.onSleepToWait(task)}>Wait instead</button> : null}
            </>
          ) : (
            <>
              <button class="text-button" onClick={() => void props.onSleepTomorrow(task)}>Sleep until tomorrow</button>
              <button class="text-button" onClick={() => props.onSleepCustom(task)}>Sleep until…</button>
              {canConvertWaitToSleep ? <button class="text-button" onClick={() => void props.onWaitToSleep(task)}>Sleep instead</button> : null}
            </>
          )}
        </div>
      ) : null}
    </article>
  );
}
