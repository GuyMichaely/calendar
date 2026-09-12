import { startTaskDrag } from "./task-drag";
import { nestTaskRows, taskDescendants } from "../../site/task-tree.js";
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { downloadAttachmentOnDemand } from "../../site/attachment-remote.js";
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
import { MarkdownNotes } from "./MarkdownNotes";
import { actionForKey, normalizeEventKey, TaskActionIcon, type Shortcuts } from "./shortcuts";
import { availabilitySummary, taskTiming } from "./task-display";
import type { Attachment, HorizonMode, Item, Task } from "./types";

type TaskRow = { hidden?: boolean; task: Task; upcomingAt?: Date | null; depth?: number; hasChildren?: boolean };

const taskSections = [
  { id: "now", label: "Can do now", defaultOpen: true },
  { id: "upcoming", label: "Upcoming", defaultOpen: true },
  { id: "all", label: "All open", defaultOpen: false },
  { id: "completed", label: "Completed", defaultOpen: false },
] as const;

type SectionId = (typeof taskSections)[number]["id"];

let rememberedTaskId: string | null = null;
let rememberedTaskIndex = 0;
let rememberedSection: string | undefined;


function visibleTaskCards() {
  return [...document.querySelectorAll<HTMLElement>('[data-task-card="true"]')].filter((card) => {
    if (card.closest("[inert]")) return false;
    return card.getClientRects().length > 0;
  });
}

function rememberCard(card: HTMLElement) {
  const cards = visibleTaskCards();
  const index = cards.indexOf(card);
  if (index >= 0) rememberedTaskIndex = index;
  rememberedTaskId = card.dataset.id || rememberedTaskId;
  rememberedSection = card.closest<HTMLElement>("[data-section]")?.dataset.section;
  cards.forEach((candidate) => { candidate.tabIndex = candidate === card ? 0 : -1; });
}

function focusCard(card: HTMLElement | undefined, { scroll = true } = {}) {
  if (!card) return;
  rememberCard(card);
  card.focus({ preventScroll: !scroll });
  if (scroll) card.scrollIntoView({ block: "nearest" });
}

export function focusBoundaryTask(direction: 1 | -1) {
  const cards = visibleTaskCards();
  if (!cards.length) return false;
  focusCard(direction > 0 ? cards[0] : cards[cards.length - 1]);
  return true;
}

export function currentRovingTaskCard() {
  return document.querySelector<HTMLElement>('[data-task-card="true"][tabindex="0"]');
}

function moveTaskFocus(direction: number, activeCard?: HTMLElement) {
  const cards = visibleTaskCards();
  if (!cards.length) return;
  if (!activeCard) {
    focusCard(direction > 0 ? cards[0] : cards[cards.length - 1]);
    return;
  }
  const index = cards.indexOf(activeCard);
  if (index < 0) return;
  const nextIndex = Math.max(0, Math.min(cards.length - 1, index + direction));
  focusCard(cards[nextIndex]);
}

function isInteractiveTarget(target: EventTarget | null) {
  return target instanceof Element && !!target.closest("button, a, input, textarea, select, label, [contenteditable='true']");
}

function readSectionOpen(id: string, fallback: boolean) {
  const stored = localStorage.getItem(`calendar.section.${id}`);
  if (stored === "open") return true;
  if (stored === "closed") return false;
  return fallback;
}

function taskTitle(task: Task) {
  return String(task.title || "").replace(/[\p{Cf}\p{Cc}\s]/gu, "") ? task.title : "Untitled task";
}

type TasksViewProps = {
  animations: boolean;
  onMove: (id: string, target: string | null, placement: string) => Promise<void>;
  items: Item[];
  query: string;
  compact: boolean;
  horizonDays: number | null;
  horizonMode: HorizonMode;
  shortcuts: Shortcuts;
  now: Date;
  onCompactChange: (value: boolean) => void;
  onHorizonChange: (value: number | null) => void;
  onHorizonModeChange: (value: HorizonMode) => void;
  onAddSubtask: (task: Task) => void;
  onEdit: (task: Task) => void;
  onComplete: (task: Task) => Promise<void>;
  onWake: (task: Task) => Promise<void>;
  onSleepTomorrow: (task: Task) => Promise<void>;
  onSleepIndefinite: (task: Task) => Promise<void>;
  onSleepCustom: (task: Task) => void;
  onSleepToWait: (task: Task) => Promise<void>;
  onWaitToSleep: (task: Task) => Promise<void>;
};

export function TasksView(props: TasksViewProps) {
  const [collapsed, setCollapsed] = createSignal(new Set<string>());
  const nested = (rows: TaskRow[]) => nestTaskRows(rows, props.items, props.query ? new Set<string>() : collapsed(), true);
  const toggle = (id: string) => setCollapsed(current => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const [openSections, setOpenSections] = createSignal<Record<SectionId, boolean>>(
    Object.fromEntries(taskSections.map((section) => [section.id, readSectionOpen(section.id, section.defaultOpen)])) as Record<SectionId, boolean>,
  );

  const matching = createMemo(() =>
    props.items.filter((item): item is Task => item.kind === "task").filter((task) => textMatches(task, props.query)),
  );
  const openCount = createMemo(() => matching().filter((task) => task.state !== "completed").length);
  const horizonEnd = createMemo(() => props.horizonDays === null ? null : upcomingHorizonEnd(props.now, props.horizonDays, props.horizonMode));
  const actionable = createMemo(() => sortTasks(
    matching().filter((task) => taskMatchesFilter(task, "now", props.now) && !isSleeping(task, props.now)),
    props.now,
  ) as Task[]);
  const upcoming = createMemo<TaskRow[]>(() => matching()
    .filter((task) => task.state !== "completed" && !isSleeping(task, props.now))
    .map((task) => ({ task, upcomingAt: nextActionableStart(task, props.now) as Date | null }))
    .filter((row) => row.upcomingAt && row.upcomingAt > props.now && (!horizonEnd() || row.upcomingAt <= horizonEnd()!))
    .sort((a, b) => (a.upcomingAt?.getTime() || 0) - (b.upcomingAt?.getTime() || 0) || a.task.title.localeCompare(b.task.title)));
  const sleeping = createMemo<TaskRow[]>(() => (sortTasks(
    matching().filter((task) => task.state !== "completed" && isSleeping(task, props.now)),
    props.now,
  ) as Task[]).map((task) => ({ task, upcomingAt: nextActionableStart(task, props.now, { respectSleep: true }) as Date | null })));
  const rows = createMemo<Record<SectionId, TaskRow[]>>(() => ({
    now: actionable().map((task) => ({ task })),
    upcoming: upcoming(),
    all: (sortTasks(matching().filter((task) => taskMatchesFilter(task, "all", props.now)), props.now) as Task[]).map((task) => ({ task })),
    completed: (sortTasks(matching().filter((task) => taskMatchesFilter(task, "completed", props.now)), props.now) as Task[]).map((task) => ({ task })),
  }));

  createEffect(() => {
    rows();
    collapsed();
    openSections();
    queueMicrotask(() => {
      const cards = visibleTaskCards();
      if (!cards.length) return;
      const remembered = rememberedTaskId ? cards.find((card) => card.dataset.id === rememberedTaskId && card.closest<HTMLElement>("[data-section]")?.dataset.section === rememberedSection) : null;
      const active = cards.find(card => card.contains(document.activeElement));
      const roving = active || remembered || cards[Math.min(rememberedTaskIndex, cards.length - 1)] || cards[0];
      cards.forEach((card) => { card.tabIndex = card === roving ? 0 : -1; });

    });
  });

  onMount(() => {
    const onFocusIn = (event: FocusEvent) => {
      const card = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-task-card="true"]') : null;

      if (card) rememberCard(card);
    };
    document.addEventListener("focusin", onFocusIn);
    onCleanup(() => document.removeEventListener("focusin", onFocusIn));
  });

  const horizonLabel = (days: number) => {
    if (props.horizonMode !== "boundary") return `${days}d`;
    if (days === 1) return "Today";
    if (days === 7) return "This week";
    return "This month";
  };

  const emptyText = (sectionId: SectionId) => {
    if (sectionId === "now") return "Nothing is actionable right now.";
    if (sectionId === "completed") return "No completed tasks.";
    if (sectionId === "upcoming") {
      return props.horizonDays === null
        ? "Nothing is waiting for a known future opportunity."
        : `Nothing becomes actionable by ${formatDateTime(horizonEnd())}.`;
    }
    return "No open tasks.";
  };

  const move = async (id: string, target: string | null, placement: string) => {
    await props.onMove(id, target, placement);
    if (placement === "inside" && target) setCollapsed(current => { const next = new Set(current); next.delete(target); return next; });
  };
  const moveWithKey = (event: KeyboardEvent, row: TaskRow) => {
    if (!["ArrowUp", "ArrowDown", "ArrowLeft"].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    if (event.key === "ArrowLeft") { void move(row.task.id, null, "root"); return; }
    const card = (event.currentTarget as HTMLElement).closest<HTMLElement>("[data-task-card]")!;
    const section = card.closest("[data-section]");
    const siblings = visibleTaskCards().filter(candidate => candidate.closest("[data-section]") === section && candidate.dataset.parent === (row.task.parentId || ""));
    const target = siblings[siblings.indexOf(card) + (event.key === "ArrowUp" ? -1 : 1)];
    if (target?.dataset.id) void move(row.task.id, target.dataset.id, event.key === "ArrowUp" ? "before" : "after");
  };
  const taskCard = (row: () => TaskRow, showAvailability: boolean) => (
    <TaskCard
      row={row()}
      onMoveKey={event => moveWithKey(event, row())}
      onDrag={event => startTaskDrag(event, row().task.id, move)}
      items={props.items}
      collapsed={collapsed().has(row().task.id) && !props.query}
      onToggle={() => toggle(row().task.id)}
      onAddSubtask={props.onAddSubtask}
      now={props.now}
      showAvailability={showAvailability}
      shortcuts={props.shortcuts}
      onEdit={props.onEdit}
      onComplete={props.onComplete}
      onWake={props.onWake}
      onSleepTomorrow={props.onSleepTomorrow}
      onSleepIndefinite={props.onSleepIndefinite}
      onSleepCustom={props.onSleepCustom}
      onSleepToWait={props.onSleepToWait}
      onWaitToSleep={props.onWaitToSleep}
    />
  );

  const taskList = (getRows: () => TaskRow[], showAvailability: boolean) => {
    const tree = createMemo(() => nested(getRows()));
    const byId = createMemo(() => new Map(tree().map(row => [row.task.id, row])));
    return <For each={tree().map(row => row.task.id)}>{id => {
      let last = byId().get(id)!;
      const row = () => (last = byId().get(id) || last);
      return <div class="task-collapse" data-expanded={!row().hidden} inert={row().hidden || undefined}><div class="collapse-inner"><div class="task-row-spacing">{taskCard(row, showAvailability)}</div></div></div>;
    }}</For>;
  };

  return (
    <section class={`panel tasks-panel ${props.compact ? "compact" : ""} ${props.animations ? "motion-enabled" : ""}`}>
      <div class="panel-heading">
        <div>
          <h1>Tasks</h1>
          <p class="muted">
            {props.query
              ? `${openCount()} matching open ${openCount() === 1 ? "task" : "tasks"}`
              : `${openCount()} open ${openCount() === 1 ? "task" : "tasks"}`}
          </p>
        </div>
        <button
          type="button"
          class={`secondary-button density-toggle ${props.compact ? "active" : ""}`}
          aria-pressed={props.compact}
          onClick={() => props.onCompactChange(!props.compact)}
        >Compact</button>
      </div>

      <p class="drag-help">Drag the grip beside a task to reorder; drop in the middle of a task to make it a subtask.</p>
      <div class="root-drop" data-drop-root="true">Drop here to make a top-level task</div>
      <div class="task-sections">
        <For each={taskSections}>{(section) => {
          const sectionRows = () => rows()[section.id];
          const sleepingRows = () => section.id === "upcoming" ? sleeping() : [];
          const label = () => section.id === "upcoming" && props.horizonDays === null ? "Waiting" : section.label;
          return (
            <section class="task-section" data-section={section.id} data-expanded={openSections()[section.id]}>
              <button class="task-section-toggle" aria-expanded={openSections()[section.id]} onClick={() => {
                const open = !openSections()[section.id];
                setOpenSections(current => ({ ...current, [section.id]: open }));
                localStorage.setItem(`calendar.section.${section.id}`, open ? "open" : "closed");
              }}>
                <span class="section-heading"><span class="section-chevron" aria-hidden="true">›</span><strong>{label()}</strong></span>
                <span class="section-count">{sectionRows().length + sleepingRows().length}</span>
              </button>
              <div class="task-collapse" data-expanded={openSections()[section.id]} inert={!openSections()[section.id] || undefined}><div class="collapse-inner">
              <div class="task-section-body">
                <Show when={section.id === "upcoming"}>
                  <div class="horizon-row">
                    <span class="horizon-label">{props.horizonDays === null ? "Showing all future opportunities" : "Limit to"}</span>
                    <div class="horizon-controls">
                      <div class="segmented horizon-control" aria-label="Upcoming task horizon">
                        <For each={[1, 7, 30]}>{(days) => (
                          <button
                            type="button"
                            class={props.horizonDays === days ? "active" : ""}
                            aria-pressed={props.horizonDays === days}
                            onClick={() => props.onHorizonChange(props.horizonDays === days ? null : days)}
                          >{horizonLabel(days)}</button>
                        )}</For>
                      </div>
                      <button
                        type="button"
                        class={`secondary-button boundary-toggle ${props.horizonMode === "boundary" ? "active" : ""}`}
                        aria-pressed={props.horizonMode === "boundary"}
                        title="Use the end of the current day, week, or month instead of a rolling 1, 7, or 30 days."
                        onClick={() => props.onHorizonModeChange(props.horizonMode === "boundary" ? "rolling" : "boundary")}
                      >End of day/week/month</button>
                    </div>
                  </div>
                </Show>

                <div class="task-list section-task-list">
                  <Show when={sectionRows().length} fallback={<div class="section-empty">{emptyText(section.id)}</div>}>
                    {taskList(sectionRows, section.id === "upcoming")}
                  </Show>
                </div>

                <Show when={section.id === "upcoming" && sleepingRows().length}>
                  <div class="sleeping-block">
                    <div class="sleeping-heading"><span>Sleeping</span><span>{sleepingRows().length}</span></div>
                    <div class="task-list section-task-list sleeping-task-list">
                      {taskList(sleepingRows, true)}
                    </div>
                  </div>
                </Show>
              </div>
              </div></div>
            </section>
          );
        }}</For>
      </div>
    </section>
  );
}

function TaskCard(props: {
  row: TaskRow;
  onDrag: (event: PointerEvent) => void;
  onMoveKey: (event: KeyboardEvent) => void;
  items: Item[];
  collapsed: boolean;
  onToggle: () => void;
  now: Date;
  showAvailability: boolean;
  shortcuts: Shortcuts;
  onAddSubtask: (task: Task) => void;
  onEdit: (task: Task) => void;
  onComplete: (task: Task) => Promise<void>;
  onWake: (task: Task) => Promise<void>;
  onSleepTomorrow: (task: Task) => Promise<void>;
  onSleepIndefinite: (task: Task) => Promise<void>;
  onSleepCustom: (task: Task) => void;
  onSleepToWait: (task: Task) => Promise<void>;
  onWaitToSleep: (task: Task) => Promise<void>;
}) {
  const descendants = createMemo(() => taskDescendants(props.items, props.row.task.id));
  const parent = createMemo(() => props.items.find((item): item is Task => item.kind === "task" && item.id === props.row.task.parentId));
  const result = createMemo(() => actionability(props.row.task, props.now));
  const sleep = createMemo(() => sleepInfo(props.row.task, props.now));
  const closed = createMemo(() => props.row.task.state === "completed");
  const futureAvailable = createMemo(() => toDate(props.row.task.availableFrom));
  const canConvertWaitToSleep = createMemo(() => !sleep().sleeping && !!futureAvailable() && futureAvailable()! > props.now);
  const timing = createMemo(() => taskTiming(props.row.task, props.now, props.showAvailability));
  const summary = createMemo(() => availabilitySummary(props.row.task, props.now, props.row.upcomingAt, props.showAvailability));
  const statusText = createMemo(() => {
    const currentSleep = sleep();
    return currentSleep.sleeping
      ? currentSleep.indefinite ? "Sleeping indefinitely" : `Sleeping until ${formatDateTime(currentSleep.until)}`
      : result().reason;
  });

  const openAttachment = async (attachment: Attachment) => {
    try {
      const blob = await downloadAttachmentOnDemand(attachment);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = attachment.name || "attachment";
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      console.error(error);
      window.alert(error instanceof Error ? error.message : "Could not download attachment.");
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      moveTaskFocus(event.key === "ArrowUp" ? -1 : 1, event.currentTarget as HTMLElement);
      return;
    }
    if (event.target !== event.currentTarget) return;
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    const action = actionForKey(normalizeEventKey(event), props.shortcuts);
    if (!action) return;
    if (action === "edit") { event.preventDefault(); props.onEdit(props.row.task); return; }
    if (closed()) return;
    event.preventDefault();
    if (action === "complete") void props.onComplete(props.row.task);
    else if (action === "sleepTomorrow") void props.onSleepTomorrow(props.row.task);
    else if (action === "sleepIndefinite") void props.onSleepIndefinite(props.row.task);
    else props.onSleepCustom(props.row.task);
  };

  return (
    <article
      class={`task-card ${sleep().sleeping ? "sleeping-task" : ""}`}
      style={{ "margin-inline-start": `${Math.min(props.row.depth || 0, 5) * 12}px` }}
      data-parent={props.row.task.parentId || ""}
      data-id={props.row.task.id}
      data-task-card="true"
      tabIndex={-1}
      onFocus={(event) => rememberCard(event.currentTarget)}
      onPointerDown={(event) => {
        if (isInteractiveTarget(event.target)) return;

        focusCard(event.currentTarget, { scroll: false });
      }}
      onDblClick={(event) => { if (!isInteractiveTarget(event.target)) props.onEdit(props.row.task); }}
      onKeyDown={onKeyDown}
    >
      <div class="task-main">
        <button class="task-drag-handle" aria-label={`Drag ${taskTitle(props.row.task)} to reorder or nest`} title="Drag to reorder or nest. Arrow keys: move up/down; left: make top-level." onKeyDown={props.onMoveKey} onPointerDown={props.onDrag}><svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 6h8M4 10h8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg></button>
        <Show
          when={closed()}
          fallback={<button class="complete-button" aria-label="Mark complete" title={descendants().length ? "Complete task and all its subtasks" : "Mark complete"} onClick={() => void props.onComplete(props.row.task)} />}
        >
          <span class="complete-indicator" aria-hidden="true">✓</span>
        </Show>
        <div class="task-copy">
          <Show when={parent()}>{parentTask => <button class="task-parent-link" onClick={() => props.onEdit(parentTask())}>↳ {taskTitle(parentTask())}</button>}</Show>
          <div class="task-title-row">
            <Show when={props.row.hasChildren}><button class="task-disclosure" aria-label={props.collapsed ? "Expand subtasks" : "Collapse subtasks"} aria-expanded={!props.collapsed} onClick={props.onToggle}><span class="section-chevron" aria-hidden="true">›</span></button></Show>
            <h3><button class="task-title-link" aria-label={`Edit ${taskTitle(props.row.task)}`} title={`Edit ${taskTitle(props.row.task)}`} onClick={() => props.onEdit(props.row.task)}>{taskTitle(props.row.task)}</button></h3>
            <span class={`status-pill ${result().actionable && !sleep().sleeping ? "ready" : sleep().sleeping ? "sleeping" : "quiet"}`}>{statusText()}</span>
          </div>
          <Show when={descendants().length}><div class="subtask-progress">{descendants().filter(task => task.state === "completed").length}/{descendants().length} subtasks completed</div></Show>
          <Show when={summary()}><div class="availability-summary">{summary()}</div></Show>
          <Show when={props.row.task.notes}><MarkdownNotes text={props.row.task.notes || ""} attachments={props.row.task.attachments || []} onDownload={file => void openAttachment(file)} onError={message => window.alert(message)} /></Show>
          <Show when={timing().length}><div class="timing"><For each={timing()}>{(value) => <span>{value}</span>}</For></div></Show>
          <Show when={props.row.task.tags?.length}><div class="tags"><For each={props.row.task.tags}>{(tag) => <span class="tag">{tag}</span>}</For></div></Show>
          <Show when={props.row.task.attachments?.length}><div class="attachments"><For each={props.row.task.attachments}>{(attachment) => <button class="attachment" onClick={() => void openAttachment(attachment)}>Attachment: {attachment.name || "Attachment"}</button>}</For></div></Show>
        </div>
      </div>
      <Show when={!closed()}>
        <div class="task-actions">
          <button class="text-button add-subtask-button" title="Add subtask" aria-label={`Add subtask to ${taskTitle(props.row.task)}`} onClick={() => props.onAddSubtask(props.row.task)}>+</button>
          <Show
            when={sleep().sleeping}
            fallback={
              <>
                <TaskActionIcon action="sleepTomorrow" shortcuts={props.shortcuts} onClick={() => void props.onSleepTomorrow(props.row.task)} />
                <TaskActionIcon action="sleepIndefinite" shortcuts={props.shortcuts} onClick={() => void props.onSleepIndefinite(props.row.task)} />
                <TaskActionIcon action="customSleep" shortcuts={props.shortcuts} onClick={() => props.onSleepCustom(props.row.task)} />
                <Show when={canConvertWaitToSleep()}><button class="text-button" onClick={() => void props.onWaitToSleep(props.row.task)}>Sleep instead</button></Show>
              </>
            }
          >
            <button class="text-button" onClick={() => void props.onWake(props.row.task)}>Wake</button>
            <button class="text-button" onClick={() => props.onSleepCustom(props.row.task)}>Change sleep…</button>
            <Show when={sleep().sleeping && !sleep().indefinite}><button class="text-button" onClick={() => void props.onSleepToWait(props.row.task)}>Wait instead</button></Show>
          </Show>
        </div>
      </Show>
    </article>
  );
}
