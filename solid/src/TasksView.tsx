import { SleepControls } from "./SleepControls";
import { planTasks, taskVisible, type TaskSort } from "./task-planning";
import { Icon } from "./Icon";
import type { TaskScope } from "./WorkspaceShell";
import { TaskPresence } from "./TaskPresence";
import { startTaskDrag } from "./task-drag";
import { nestTaskRows, taskDescendants } from "../../site/task-tree.js";
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { downloadAttachmentOnDemand } from "../../site/attachment-remote.js";
import {
  actionability,
  formatDateTime,
  sleepInfo,
  textMatches,
  toDate,
  upcomingHorizonEnd,
} from "../../site/domain.js";
import { MarkdownNotes } from "./MarkdownNotes";
import { actionForKey, normalizeEventKey, TaskActionIcon, type Shortcuts } from "./shortcuts";
import { availabilitySummary } from "./task-display";
import type { CalendarSleepMode, Attachment, HorizonMode, Item, Task } from "./types";

type TaskRow = { hidden?: boolean; task: Task; upcomingAt?: Date | null; depth?: number; hasChildren?: boolean };

const taskSections = [
  { id: "now", label: "Can do now", defaultOpen: true },
  { id: "upcoming", label: "Upcoming", defaultOpen: true },
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
  const nextIndex = (index + direction + cards.length) % cards.length;
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
  sleepMode: CalendarSleepMode;
  hideSleeping: boolean;
  sort: TaskSort;
  onSleepModeChange: (mode: CalendarSleepMode) => void;
  onHideSleepingChange: (hide: boolean) => void;
  onSortChange: (sort: TaskSort) => void;
  scope: TaskScope;
  onScopeChange: (scope: TaskScope) => void;
  onQuickAdd: (title: string) => Promise<boolean>;
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
  const [draftTitle, setDraftTitle] = createSignal("");
  const [adding, setAdding] = createSignal(false);
  const captureTask = async () => {
    const title = draftTitle().trim();
    if (!title || adding()) return;
    setAdding(true);
    try { if (await props.onQuickAdd(title)) { if (draftTitle().trim() === title) setDraftTitle(""); } }
    finally { setAdding(false); }
  };
  const sectionVisible = (id: SectionId) => props.scope === "open" ? id === "now" || id === "upcoming" : id === props.scope;
  const [collapsed, setCollapsed] = createSignal(new Set<string>());
  const visibleItems = createMemo(() => props.items.filter(item => item.kind !== "task" || taskVisible(item, props.now, props.hideSleeping)));
  const nested = (rows: TaskRow[]) => nestTaskRows(rows, visibleItems(), props.query ? new Set<string>() : collapsed(), true, false);
  const toggle = (id: string) => setCollapsed(current => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const [openSections, setOpenSections] = createSignal<Record<SectionId, boolean>>(
    Object.fromEntries(taskSections.map((section) => [section.id, readSectionOpen(section.id, section.defaultOpen)])) as Record<SectionId, boolean>,
  );

  createEffect(() => {
    const scope = props.scope;
    if (scope === "completed") setOpenSections(current => ({...current, [scope]: true}));
  });
  const matching = createMemo(() =>
    props.items.filter((item): item is Task => item.kind === "task").filter((task) => taskVisible(task, props.now, props.hideSleeping) && textMatches(task, props.query)),
  );
  const openCount = createMemo(() => matching().filter((task) => task.state !== "completed").length);
  const horizonEnd = createMemo(() => props.horizonDays === null ? null : upcomingHorizonEnd(props.now, props.horizonDays, props.horizonMode));
  const rows = createMemo<Record<SectionId, TaskRow[]>>(() => planTasks(matching(), props.now, props.sleepMode === "respect", props.sort, horizonEnd()));
  const actionable = () => rows().now;


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
        ? "No other open tasks."
        : `Nothing becomes actionable by ${formatDateTime(horizonEnd())}.`;
    }
    return "No open tasks.";
  };

  const move = async (id: string, target: string | null, placement: string) => {
    await props.onMove(id, target, placement);
    if (placement === "before" || placement === "after") props.onSortChange("manual");
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
      onDrag={event => startTaskDrag(event, row().task.id, move, taskDescendants(props.items, row().task.id).map(task => task.id))}
      items={visibleItems()}
      collapsed={collapsed().has(row().task.id) && !props.query}
      onToggle={() => toggle(row().task.id)}
      onAddSubtask={props.onAddSubtask}
      now={props.now}
      showAvailability={showAvailability}
      respectSleep={props.sleepMode === "respect"}
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

  const taskList = (getRows: () => TaskRow[], showAvailability: boolean, empty?: string) => {
    const tree = createMemo(() => nested(getRows()));
    const byId = createMemo(() => new Map(tree().map(row => [row.task.id, row])));
    return <TaskPresence fallback={empty ? <div class="section-empty">{empty}</div> : undefined} ids={() => tree().map(row => row.task.id)} animate={() => props.animations}>{(id, present) => {
      let last = byId().get(id)!;
      const row = () => (last = byId().get(id) || last);
      return <div class="task-collapse" data-expanded={present() && !row().hidden} inert={!present() || row().hidden || undefined}><div class="collapse-inner"><div class="task-row-spacing">{taskCard(row, showAvailability)}</div></div></div>;
    }}</TaskPresence>;
  };

  return (
    <section class={`panel tasks-panel ${props.compact ? "compact" : ""} ${props.animations ? "motion-enabled" : ""}`}>
      <div class="panel-heading">
        <div><p class="page-eyebrow">{new Intl.DateTimeFormat(undefined, {weekday: "long", month: "long", day: "numeric"}).format(props.now)}</p>
          <h1>{props.query ? "Search results" : props.scope === "open" ? "Tasks" : "Completed"}<Show when={props.scope === "open" && !props.query}><span class="heading-sun"><Icon name="sun" size={33} /></span></Show></h1>
          <p class="page-description">{props.query ? `Matching “${props.query}”` : props.scope === "open" ? `${actionable().length} ready · ${openCount()} open tasks` : `${rows().completed.length} tasks taken care of.`}</p>
        </div>
        <button type="button" class={`secondary-button density-toggle ${props.compact ? "active" : ""}`} aria-pressed={props.compact} onClick={() => props.onCompactChange(!props.compact)}><Icon name="compact" size={16} /><span>Compact</span></button>
      </div>
      <div class="task-view-options">
        <SleepControls mode={props.sleepMode} hideSleeping={props.hideSleeping} onModeChange={props.onSleepModeChange} onHideChange={props.onHideSleepingChange} />
        <label class="task-sort">Sort <select aria-label="Task sort order" value={props.sort} onChange={event => props.onSortChange(event.currentTarget.value as TaskSort)}>
          <option value="start">Can start, then due</option><option value="later">Later of can start / due</option><option value="manual">Manual order</option>
        </select></label>
      </div>
      <div class="task-scope-tabs" role="group" aria-label="Task lists">
        <button aria-pressed={props.scope === "open"} onClick={() => props.onScopeChange("open")}>Tasks</button>
        <button aria-pressed={props.scope === "completed"} onClick={() => props.onScopeChange("completed")}>Completed</button>
      </div>
      <Show when={props.scope !== "completed"}><form class="quick-capture" onSubmit={event => { event.preventDefault(); void captureTask(); }}>
        <Icon name="plus" size={20} /><input aria-label="Quick add task" placeholder="What needs doing?" maxLength={240} value={draftTitle()} onInput={event => setDraftTitle(event.currentTarget.value)} />
        <button type="submit" aria-label="Add task" disabled={adding() || !draftTitle().trim()}><span>{adding() ? "Adding…" : "Add task"}</span><Icon name="arrow" size={17} /></button>
      </form></Show>
      <p class="drag-help"><Icon name="list" size={13} />Drag to arrange (switches to manual order). Drop onto a task to nest it. <span>On touch screens, hold first.</span></p>
      <div class="root-drop" data-drop-root="true">Drop here to make a top-level task</div>
      <div class="task-sections">
        <For each={taskSections}>{(section) => {
          const sectionRows = () => rows()[section.id];
          return (
            <section class="task-section" hidden={!sectionVisible(section.id)} inert={!sectionVisible(section.id) || undefined} data-section={section.id} data-expanded={openSections()[section.id]}>
              <button class="task-section-toggle" aria-expanded={openSections()[section.id]} onClick={() => {
                const open = !openSections()[section.id];
                setOpenSections(current => ({ ...current, [section.id]: open }));
                localStorage.setItem(`calendar.section.${section.id}`, open ? "open" : "closed");
              }}>
                <span class="section-heading"><span class="section-chevron" aria-hidden="true">›</span><strong>{section.label}</strong></span>
                <span class="section-count">{sectionRows().length}</span>
              </button>
              <div class="task-collapse" data-expanded={openSections()[section.id]} inert={!openSections()[section.id] || undefined}><div class="collapse-inner">
              <div class="task-section-body">
                <Show when={section.id === "upcoming"}>
                  <div class="horizon-row">
                    <span class="horizon-label">{props.horizonDays === null ? "Showing all other tasks" : "Limit to"}</span>
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
                    {taskList(sectionRows, section.id === "upcoming", emptyText(section.id))}
                </div>
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
  respectSleep: boolean;
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
  const summary = createMemo(() => availabilitySummary(props.row.task, props.now, props.row.upcomingAt, props.showAvailability, props.respectSleep));
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
      data-sleep-ignored={sleep().sleeping && !props.respectSleep || undefined}
      style={{ "margin-inline-start": `${Math.min(props.row.depth || 0, 5) * 12}px` }}
      data-parent={props.row.task.parentId || ""}
      data-depth={props.row.depth || 0}
      data-id={props.row.task.id}
      data-task-card="true"
      tabIndex={-1}
      onFocus={(event) => rememberCard(event.currentTarget)}
      onPointerDown={(event) => {
        const title = event.target instanceof Element && event.target.closest(".task-title-link");
        if (isInteractiveTarget(event.target) && !title) return;
        if (event.button !== 0) return;
        if (!title) focusCard(event.currentTarget, { scroll: false });
        props.onDrag(event);
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
          <Show when={props.row.depth ? undefined : parent()}>{parentTask => <button class="task-parent-link" onClick={() => props.onEdit(parentTask())}>↳ {taskTitle(parentTask())}</button>}</Show>
          <div class="task-title-row">
            <span class="task-disclosure-slot"><Show when={props.row.hasChildren}><button class="task-disclosure" aria-label={props.collapsed ? "Expand subtasks" : "Collapse subtasks"} aria-expanded={!props.collapsed} onClick={props.onToggle}><span class="section-chevron" aria-hidden="true">›</span></button></Show></span>
            <h3><button class="task-title-link" aria-label={`Edit ${taskTitle(props.row.task)}`} title={`Edit ${taskTitle(props.row.task)}`} onClick={() => props.onEdit(props.row.task)}>{taskTitle(props.row.task)}</button></h3>
            <Show when={sleep().sleeping}><span class="sleep-indicator" role="img" aria-label={`${statusText()}${props.respectSleep ? "" : " (sleep ignored)"}`} title={`${statusText()}${props.respectSleep ? "" : " (sleep ignored)"}`}><Icon name="moon" size={14} /></span></Show>
            <Show when={!closed()}><span class={`status-pill ${result().actionable && (!props.respectSleep || !sleep().sleeping) ? "ready" : sleep().sleeping ? "sleeping" : "quiet"}`}>{statusText()}</span></Show>
          </div>
          <Show when={descendants().length}><div class="subtask-progress">{descendants().filter(task => task.state === "completed").length}/{descendants().length} subtasks completed</div></Show>
          <Show when={summary()}><div class="availability-summary">{summary()}</div></Show>
          <Show when={props.row.task.notes}><MarkdownNotes text={props.row.task.notes || ""} attachments={props.row.task.attachments || []} onDownload={file => void openAttachment(file)} onError={message => window.alert(message)} /></Show>
          <Show when={props.row.task.tags?.length}><div class="tags"><For each={props.row.task.tags}>{(tag) => <span class="tag">{tag}</span>}</For></div></Show>
          <Show when={props.row.task.attachments?.length}><div class="attachments"><For each={props.row.task.attachments}>{(attachment) => <button class="attachment" onClick={() => void openAttachment(attachment)}><Icon name="paperclip" size={12} />{attachment.name || "Attachment"}</button>}</For></div></Show>
        </div>
      </div>
      <Show when={!closed()}>
        <div class="task-actions">
          <button class="text-button add-subtask-button" title="Add subtask" aria-label={`Add subtask to ${taskTitle(props.row.task)}`} onClick={() => props.onAddSubtask(props.row.task)}>+</button>
          <Show
            when={sleep().sleeping}
            fallback={
              <>
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
