import { For, Index, Show, createEffect, createMemo, createSignal, onCleanup, onMount, type JSX } from "solid-js";
import { Icon } from "./Icon";
import { ancestors, buildSections, pushedDownInfo, SECTION_ORDER, taskGroupId, type Placement, type Section, type SectionId, type SubtaskMode, type TreeNode } from "./today";
import { boardLayout, placeBoard, sameLayout, userBoards, type BoardLayout, type BoardTarget } from "./board-order";
import { taskSchedule, windowsById } from "./windows";
import { describeRepeat, lastCheckIn } from "./repeats";
// The same search as the calendar: title, notes, tags, and attachment names.
import { textMatches } from "../../site/domain.js";
import { addDays, clockText, daysBetween, formatIn, partsOf, sameDay, startOfDay } from "./zone";
import { actionForKey, normalizeEventKey, type Shortcuts } from "./shortcut-config";
import type { Group, Item, Task } from "./types";
import { BoardMenu } from "./BoardMenu";

// Agenda lists the urgency sections; Boards shows your boards and the built-in ones as columns.
export type TaskView = "today" | "boards";

export type TodayViewProps = {
  items: Item[];
  query: string;
  now: Date;
  selectedId: string | null;
  view: TaskView;
  // Settings → Display: a task's board and tags on its row.
  showBoard: boolean;
  showTags: boolean;
  subtaskMode: SubtaskMode;
  onSubtaskModeChange: (value: SubtaskMode) => void;
  // Boards: move a board's tasks that are Firm, closing or opening today, or upcoming into
  // those built-in columns; the rest (just Available) stay on their board.
  pullTimed: boolean;
  onPullTimedChange: (value: boolean) => void;
  // Compact folds each run of pushed-down sibling tasks into one expandable row.
  compact: boolean;
  onCompactChange: (value: boolean) => void;
  // Unsaved editor text shows on the row as it's typed.
  liveEdits: () => Map<string, Partial<Task>>;
  onEdit: (task: Task) => void;
  onComplete: (task: Task) => Promise<void>;
  // A repeating task finished for good (not just this occurrence).
  onFinish: (task: Task) => Promise<void>;
  // A check-in's "Not yet": recorded, and on to its next occurrence.
  onNotYet: (task: Task) => Promise<void>;
  onAddTask: (groupId: string | null, title: string) => Promise<boolean>;
  onPushDown: (task: Task, until: Date | null) => Promise<void>;
  onLift: (task: Task) => Promise<void>;
  onDeleteTask: (task: Task) => Promise<void>;
  onReopen: (task: Task) => Promise<void>;
  // Whether a task's finished subtasks show dimmed ("show") or fold into "+N completed" (null).
  onCompletedSubtasks: (task: Task, value: Task["completedSubtasks"]) => Promise<void>;
  onStartDependent: (task: Task, completeParent: boolean) => Promise<void>;
  // Dragging a task: under another task, or onto a board (null: no board), out of its parent.
  onMoveTask: (task: Task, to: { parent: Task } | { groupId: string | null }) => Promise<unknown>;
  // The Boards view's boards in a new layout (every board's key, a section id or a board id, by column).
  onLayoutBoards: (layout: BoardLayout) => Promise<void>;
  // A board's name edited in its heading, and its ⋮ menu's delete (with its tasks, or leaving them on no board).
  onRenameBoard: (board: Group, title: string) => Promise<unknown>;
  onDeleteBoard: (board: Group, withTasks: boolean) => Promise<unknown>;
  // Settings → Keyboard shortcuts.
  shortcuts: Shortcuts;
  // Lets the app animate changes made elsewhere (undo and redo) the same way.
  registerMotion?: (motion: (run: () => Promise<unknown>) => Promise<void>) => () => void;
};

const SECTION_LABELS: Record<SectionId, { title: string; hint?: string }> = {
  firm: { title: "Firm", hint: "due soon or overdue" },
  closing: { title: "Closing today", hint: "window open now" },
  later: { title: "Opens later today" },
  available: { title: "Available" },
  upcoming: { title: "Upcoming", hint: "can't start yet, or window not open today" },
  completed: { title: "Completed" },
};
// In the Agenda, these start collapsed.
const COLLAPSED_AT_FIRST = new Set<SectionId>(["upcoming", "completed"]);
const MOTION_MS = 320;

const clock = clockText;
/** "3:00 PM" today, "Thu 5:00 PM" this week, "Oct 12" later (with the year only when it isn't this year). */
export function when(date: Date, now: Date) {
  if (sameDay(date, now)) return clock(date);
  const days = daysBetween(now, date);
  // Midnight means the start of that day; its time adds nothing.
  const { hour, minute, year } = partsOf(date);
  const time = hour || minute ? ` ${clock(date)}` : "";
  if (days > 0 && days < 7) return `${formatIn(date, { weekday: "short" })}${time}`;
  return formatIn(date, { month: "short", day: "numeric", ...(year !== partsOf(now).year ? { year: "numeric" } : {}) });
}
export function duration(ms: number) {
  const minutes = Math.max(1, Math.ceil(ms / 60_000)), hours = Math.floor(minutes / 60);
  return hours ? `${hours}h${minutes % 60 ? ` ${minutes % 60}m` : ""}` : `${minutes}m`;
}


/** Every task id in some trees, finished subtasks included. */
function idsIn(nodes: TreeNode[]): string[] {
  return nodes.flatMap(node => [node.task.id, ...idsIn(node.children), ...idsIn(node.finished || []), ...idsIn(node.dependents || [])]);
}

type Chip = { label: string; kind?: "danger" | "warn" | "calm" | "tag"; title?: string };

export function TodayView(props: TodayViewProps) {
  const byId = createMemo(() => new Map(props.items.map(item => [item.id, item])));
  const windows = createMemo(() => windowsById(props.items));
  const boards = createMemo(() => userBoards(props.items));
  // "" is every group; "none" is tasks without one.
  const [groupFilter, setGroupFilter] = createSignal("");
  const sections = createMemo(() => {
    const filter = groupFilter();
    return buildSections(props.items, props.now, {
      mode: props.subtaskMode,
      // Completed tasks are always listed (in the Agenda, their section starts collapsed).
      showCompleted: true,
      include: task => textMatches(task, props.query) && (props.view === "boards" || !filter || (taskGroupId(task, byId()) ?? "none") === filter),
      // In Boards, a task stays on its board whatever its urgency.
      boardOf: props.view === "boards" ? (task, placement) => props.pullTimed && placement.section !== "available" ? null : taskGroupId(task, byId()) : undefined,
    });
  });
  const [collapsed, setCollapsed] = createSignal(new Set<string>(COLLAPSED_AT_FIRST));
  const isCollapsed = (id: string) => props.view === "today" && collapsed().has(id);
  const toggleSection = (id: string) => setCollapsed(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  // Compact: which folded runs of pushed-down tasks are open, by where they sit.
  const [openRuns, setOpenRuns] = createSignal(new Set<string>());
  const toggleRun = (key: string) => setOpenRuns(current => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });

  // Rows glide from where they were to where a change puts them. A row that ends up
  // folded away (a collapsed section, "+N completed", a run of pushed tasks) flies into
  // whatever holds it, which names its tasks in data-holds.
  let boardRef!: HTMLDivElement;
  const rowElements = () => {
    const found = new Map<string, HTMLElement>();
    for (const element of boardRef.querySelectorAll<HTMLElement>(".today-row[data-id]")) if (!found.has(element.dataset.id!)) found.set(element.dataset.id!, element);
    return found;
  };
  // `ids` are the rows that may fold away; "all" (for undo and redo) watches every row.
  const moving = async (ids: string[] | "all", run: () => Promise<unknown>) => {
    if (!boardRef?.isConnected || !boardRef.closest('[data-animations="on"]')) { await run(); return; }
    const beforeRows = rowElements();
    const before = new Map([...beforeRows].map(([id, element]) => [id, element.getBoundingClientRect()]));
    const ghosts = (ids === "all" ? [...beforeRows.keys()] : ids).flatMap(id => { const element = beforeRows.get(id); return element ? [{ id, clone: element.cloneNode(true) as HTMLElement, rect: element.getBoundingClientRect() }] : []; });
    await run();
    const after = rowElements();
    const ease = "cubic-bezier(.2, .8, .2, 1)";
    for (const [id, element] of after) {
      const old = before.get(id);
      if (!old) { element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: MOTION_MS, easing: "ease-out" }); continue; }
      const box = element.getBoundingClientRect(), dx = old.left - box.left, dy = old.top - box.top;
      if (Math.abs(dx) + Math.abs(dy) > 1) element.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: MOTION_MS, easing: ease });
    }
    for (const ghost of ghosts) {
      if (after.has(ghost.id)) continue;
      const holder = boardRef.querySelector<HTMLElement>(`[data-holds~="${CSS.escape(ghost.id)}"]`)?.getBoundingClientRect();
      // Off screen either way, or gone with nowhere to go on screen: nothing to show.
      if (ghost.rect.bottom < 0 || ghost.rect.top > innerHeight) continue;
      const { clone, rect } = ghost;
      Object.assign(clone.style, { position: "fixed", left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, margin: "0", zIndex: "50", pointerEvents: "none", background: "var(--surface)" });
      document.body.appendChild(clone);
      const dx = holder ? holder.left + 20 - rect.left : 0, dy = holder ? holder.top + holder.height / 2 - (rect.top + rect.height / 2) : 0;
      clone.animate([{ transform: "none", opacity: 1 }, { transform: `translate(${dx}px, ${dy}px) scale(.7)`, opacity: 0 }], { duration: MOTION_MS + 80, easing: ease, fill: "forwards" });
      // Timed, not on the animation's end: a hidden page pauses animations.
      setTimeout(() => clone.remove(), MOTION_MS + 120);
    }
  };

  onMount(() => { const unregister = props.registerMotion?.(run => moving("all", run)); onCleanup(() => unregister?.()); });

  const [startPrompt, setStartPrompt] = createSignal<{ owner: Task; dependents: Task[] } | null>(null);
  const complete = async (task: Task) => {
    // Ones set to start by themselves aren't offered; finishing starts them.
    const dependents = props.items.filter((item): item is Task => item.kind === "task" && item.dependentOf === task.id && !item.startWhen);
    await moving([task.id], () => props.onComplete(task));
    if (dependents.length) setStartPrompt({ owner: task, dependents });
  };

  // Unchecking a finished task reopens it. One that's done only because a task above it
  // was finished reopens that task instead, which brings its whole family back.
  const finishedAbove = (task: Task) => task.state === "completed" ? task : [...ancestors(task, byId())].reverse().find(ancestor => ancestor.state === "completed") || task;
  const reopenTitle = (task: Task) => { const owner = finishedAbove(task); return owner === task ? "Reopen" : `Done with “${owner.title || "Untitled task"}”: reopen it`; };
  const reopen = (task: Task) => { const owner = finishedAbove(task); return moving([owner.id, task.id], () => props.onReopen(owner)); };

  const chips = (node: TreeNode): Chip[] => {
    const task = node.task, placement: Placement | undefined = node.placement, now = props.now;
    const result: Chip[] = [];
    // A container header shows only its own due date and push; its subtasks carry the rest.
    if (node.container) {
      if (task.deadline) result.push({ label: `Due ${when(new Date(task.deadline), now)}` });
      const own = pushedDownInfo(task, now);
      if (own.pushed) result.push({ label: own.until ? `Pushed down until ${when(own.until, now)}` : "Pushed down" });
      return result;
    }
    if (!placement || placement.section === "completed") return result;
    // Its window may come from a container.
    const windowed = !!placement.closes;
    const windowName = task.windowId ? windows().get(task.windowId)?.title : taskSchedule(task, windows()) ? "Custom hours" : undefined;
    if (placement.section === "firm" && placement.due) result.push(placement.overdue ? { label: `Overdue · was due ${when(placement.due, now)}`, kind: "danger" } : { label: `Due ${when(placement.due, now)} · in ${duration(placement.due.getTime() - now.getTime())}`, kind: "danger" });
    else if (placement.due) result.push({ label: `Due ${when(placement.due, now)}` });
    if (placement.section === "closing" && placement.closes) {
      const left = placement.closes.getTime() - now.getTime();
      result.push({ label: `Closes ${clock(placement.closes)} · ${duration(left)} left`, kind: left < 3_600_000 ? "warn" : "calm", title: windowName });
    } else if (placement.section === "later" && placement.opens) result.push({ label: `Opens ${clock(placement.opens)}`, title: windowName });
    else if (placement.section === "upcoming") result.push({ label: placement.next ? `${windowed ? "Opens" : "Starts"} ${when(placement.next, now)}` : "No opening in the next two weeks", title: windowName });
    const pushed = pushedDownInfo(task, now);
    if (pushed.pushed) result.push({ label: pushed.until ? `Pushed down until ${when(pushed.until, now)}` : "Pushed down" });
    else if (placement.pushed) result.push({ label: "Pushed down with its parent" });
    return result;
  };
  // How it repeats, and a check-in's last "Not yet".
  const repeatChips = (task: Task): Chip[] => {
    if (!task.repeat || task.state === "completed") return [];
    const until = task.repeat.until ? ` until ${when(new Date(task.repeat.until), props.now)}` : "";
    const chips: Chip[] = [{ label: `↻ ${describeRepeat(task.repeat)}${until}`, kind: "calm" }];
    const checked = task.repeat.untilDone ? lastCheckIn(task) : null;
    if (checked) chips.push({ label: `Not yet as of ${when(checked, props.now)}` });
    return chips;
  };
  const tagChips = (task: Task): Chip[] => props.showTags ? (task.tags || []).map(tag => ({ label: `#${tag}`, kind: "tag" as const })) : [];

  const boardTitle = (id: string | null) => id ? boards().find(board => board.id === id)?.title || "" : "";

  // Which tasks' waiting dependents are open (for this session).
  const [openWaiting, setOpenWaiting] = createSignal(new Set<string>());
  const toggleWaiting = (id: string) => setOpenWaiting(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const quoted = (task?: Task) => `“${task?.title || "Untitled task"}”`;
  /** What starts a dependent task. */
  const startsWhen = (task: Task): Chip => {
    const owner = quoted(byId().get(task.dependentOf || "") as Task | undefined);
    const when_ = task.startWhen;
    if (when_?.on === "parent-done") return { label: `Starts when ${owner} is done`, kind: "calm" };
    if (when_?.on === "not-yet") return { label: when_.after ? `Starts on a Not yet from ${when(new Date(when_.after), props.now)}` : "Starts on the next Not yet", kind: "calm", title: `A “Not yet” on ${owner}` };
    return { label: `Offered when ${owner} is done`, title: "Finishing it asks whether to start this" };
  };

  const isPushed = (node: TreeNode) => node.placement ? node.placement.pushed && node.placement.section !== "completed" : pushedDownInfo(node.task, props.now).pushed;

  const Row = (rowProps: { node: TreeNode; depth: number; label: boolean; runKey: string }): JSX.Element => {
    const task = () => rowProps.node.task;
    const waiting = () => rowProps.node.dependents || [];
    const waitingOpen = () => openWaiting().has(task().id);
    const waitingList = () => <Show when={waiting().length}>
      <button type="button" class="today-fold today-waiting" aria-expanded={waitingOpen()} data-holds={waitingOpen() ? undefined : idsIn(waiting()).join(" ")} style={{ "padding-left": `${39 + rowProps.depth * 20}px` }} title="Tasks that start after this one" onClick={() => toggleWaiting(task().id)}>
        <span class="section-chevron" aria-hidden="true">›</span>{waiting().length} waiting to start
      </button>
      <Show when={waitingOpen()}><For each={waiting()}>{node => <Row node={node} depth={rowProps.depth + 1} label={false} runKey={`${rowProps.runKey}/${task().id}/waiting`} />}</For></Show>
    </Show>;
    if (rowProps.node.dependent) return <>
      <div class="today-row dependent" classList={{ selected: props.selectedId === task().id }} style={{ "padding-left": `${10 + rowProps.depth * 20}px` }} data-task-card="true" data-id={task().id} tabIndex={focusId() === task().id ? 0 : -1} onFocus={() => setFocusId(task().id)}
        onClick={event => { if (!(event.target as Element).closest("button, .task-menu")) props.onEdit(task()); }}>
        <span class="waiting-mark" aria-hidden="true" />
        <span class="today-copy">
          <span class="today-title">{props.liveEdits().get(task().id)?.title ?? task().title ?? ""}<Show when={!(props.liveEdits().get(task().id)?.title ?? task().title)}>Untitled task</Show></span>
          <span class="today-chips"><For each={[startsWhen(task()), ...tagChips(task())]}>{chip => <span class={`today-chip ${chip.kind || ""}`} title={chip.title}>{chip.label}</span>}</For></span>
        </span>
        <button type="button" class="today-checkin" title="Start it now" onClick={() => void moving([task().id], () => props.onStartDependent(task(), false))}>Start</button>
      </div>
      {waitingList()}
    </>;
    // Finished itself or through a container: a ticked box that reopens it.
    const done = () => rowProps.node.placement?.section === "completed";
    const label = () => rowProps.label && props.showBoard ? boardTitle(taskGroupId(task(), byId())) : "";
    return <>
      <div class="today-row" title={rowProps.node.muted ? "Its own timing is less urgent; shown here with its family" : rowProps.node.container ? "Holds these subtasks; checking it off finishes all of them" : undefined} classList={{ container: rowProps.node.container, muted: !!rowProps.node.muted, pushed: isPushed(rowProps.node), selected: props.selectedId === task().id, "drag-source": draggingId() === task().id }}
        style={{ "padding-left": `${10 + rowProps.depth * 20}px` }} data-task-card="true" data-id={task().id} tabIndex={focusId() === task().id ? 0 : -1} onFocus={() => setFocusId(task().id)} onPointerDown={event => dragTask(task())(event)}
        onClick={event => { if (!(event.target as Element).closest("button, .task-menu")) props.onEdit(task()); }}>
        <Show when={!done()} fallback={<button class="complete-button checked" aria-label={`Reopen ${task().title || "Untitled task"}`} title={reopenTitle(task())} onClick={() => void reopen(task())}><svg class="check-mark" viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 12 10 15.5 17.5 4" /></svg></button>}>
          <button class="complete-button" aria-label={task().repeat?.untilDone ? `It happened: ${task().title}` : `Complete ${task().title}`} title={task().repeat?.untilDone ? "It happened (finishes it)" : task().repeat ? "Done for now (it repeats)" : undefined} onClick={() => void complete(task())} />
        </Show>
        <span class="today-copy">
          <span class="today-title">{props.liveEdits().get(task().id)?.title ?? task().title ?? ""}<Show when={!(props.liveEdits().get(task().id)?.title ?? task().title)}>Untitled task</Show></span>
          <span class="today-chips"><For each={[...chips(rowProps.node), ...repeatChips(task()), ...tagChips(task())]}>{chip => <span class={`today-chip ${chip.kind || ""}`} title={chip.title}>{chip.label}</span>}</For></span>
        </span>
        <Show when={label()}><span class="today-group">{label()}</span></Show>
        <Show when={!done() && task().repeat?.untilDone}><button type="button" class="today-checkin" title="Checked, and it hasn't happened yet: see it again next time" onClick={() => void moving([task().id], () => props.onNotYet(task()))}>Not yet</button></Show>
        <RowMenu task={task()} done={done()} finished={rowProps.node.finished?.length ? rowProps.node.showFinished ? "show" : "fold" : null} />
      </div>
      <Rows nodes={rowProps.node.children} depth={rowProps.depth + 1} label={false} runKey={`${rowProps.runKey}/${task().id}`} />
      <Show when={rowProps.node.finished?.length}>
        <Show when={rowProps.node.showFinished} fallback={
          <button type="button" class="today-fold" data-holds={idsIn(rowProps.node.finished!).join(" ")} style={{ "padding-left": `${39 + rowProps.depth * 20}px` }} title="Show them dimmed here (remembered for this task)" onClick={() => void props.onCompletedSubtasks(task(), "show")}>+{rowProps.node.finished!.length} completed</button>}>
          <Rows nodes={rowProps.node.finished!} depth={rowProps.depth + 1} label={false} runKey={`${rowProps.runKey}/${task().id}/finished`} />
        </Show>
      </Show>
      {waitingList()}
    </>;
  };
  // Rows are keyed by task, so a change re-renders only the rows it touches. In compact
  // mode the pushed-down ones fold into a row of their own.
  const Keyed = (keyedProps: { nodes: TreeNode[]; depth: number; label: boolean; runKey: string }) =>
    <For each={keyedProps.nodes.map(node => node.task.id)}>{id => <Show when={keyedProps.nodes.find(node => node.task.id === id)}>{node => <Row node={node()} depth={keyedProps.depth} label={keyedProps.label} runKey={keyedProps.runKey} />}</Show>}</For>;
  const Rows = (rowsProps: { nodes: TreeNode[]; depth: number; label: boolean; runKey: string }) => {
    const shown = () => props.compact ? rowsProps.nodes.filter(node => !isPushed(node)) : rowsProps.nodes;
    const folded = () => props.compact ? rowsProps.nodes.filter(isPushed) : [];
    const open = () => openRuns().has(rowsProps.runKey);
    return <>
      <Keyed nodes={shown()} depth={rowsProps.depth} label={rowsProps.label} runKey={rowsProps.runKey} />
      <Show when={folded().length}>
        <button type="button" class="today-fold today-run" aria-expanded={open()} data-holds={open() ? undefined : idsIn(folded()).join(" ")} style={{ "padding-left": `${10 + rowsProps.depth * 20}px` }} onClick={() => toggleRun(rowsProps.runKey)}>
          <span class="section-chevron" aria-hidden="true">›</span>{folded().length} pushed down
        </button>
        <Show when={open()}><Keyed nodes={folded()} depth={rowsProps.depth} label={rowsProps.label} runKey={rowsProps.runKey} /></Show>
      </Show>
    </>;
  };

  // Dragging a task (not reordering): drop it on another task to make it a subtask there,
  // on a board to move it to that board, or (in the Agenda) off any task to take it out of
  // its parent. With touch, a long press starts the drag so a swipe still scrolls.
  const [draggingId, setDraggingId] = createSignal<string | null>(null);
  type TaskTarget = { to: { parent: Task } | { groupId: string | null }; hint: string; element: HTMLElement };
  const taskTargetAt = (task: Task, x: number, y: number): TaskTarget | null => {
    const hit = document.elementFromPoint(x, y);
    if (!hit || !boardRef.contains(hit)) return null;
    const own = taskGroupId(task, byId());
    const row = hit.closest<HTMLElement>(".today-row[data-id]:not(.dependent)");
    if (row) {
      const parent = byId().get(row.dataset.id!) as Task | undefined;
      // Not itself, its own parent already, or anything under it.
      if (!parent || parent.id === task.id || parent.id === task.parentId || ancestors(parent, byId()).some(entry => entry.id === task.id)) return null;
      return { to: { parent }, hint: `Make a subtask of “${parent.title || "Untitled task"}”`, element: row };
    }
    const section = hit.closest<HTMLElement>(".today-section[data-section]");
    if (!section) return null;
    const key = section.dataset.section!;
    if (props.view === "boards" && isBoard(key)) {
      if (key === own && !task.parentId) return null;
      return { to: { groupId: key }, hint: key === own ? "Move out of its parent" : `Move to ${boardTitle(key)}`, element: section };
    }
    if (props.view === "boards" && key === "available") {
      if (!own && !task.parentId) return null;
      return { to: { groupId: null }, hint: own ? "Take it off its board" : "Move out of its parent", element: section };
    }
    // Agenda: out of its parent, keeping the board it had through it.
    if (props.view === "today" && task.parentId) return { to: { groupId: own }, hint: "Move out of its parent", element: section };
    return null;
  };
  const dragTask = (task: Task) => (event: PointerEvent) => {
    if (event.button !== 0 || (event.target as Element).closest("button, input, .task-menu")) return;
    const handle = event.currentTarget as HTMLElement;
    const touch = event.pointerType === "touch";
    const x0 = event.clientX, y0 = event.clientY;
    let x = x0, y = y0, started = false, frame = 0, ghost: HTMLElement | null = null, hint: HTMLElement | null = null, target: TaskTarget | null = null;
    let hold: ReturnType<typeof setTimeout> | undefined;
    const aim = () => {
      if (y < 60) scrollBy(0, -14); else if (y > innerHeight - 40) scrollBy(0, 14);
      if (props.view === "boards") { const box = boardRef.getBoundingClientRect(); if (x > box.right - 48) boardRef.scrollLeft += 16; else if (x < box.left + 48) boardRef.scrollLeft -= 16; }
      const next = taskTargetAt(task, x, y);
      if (next?.element !== target?.element) { target?.element.classList.remove("task-drop-target"); next?.element.classList.add("task-drop-target"); }
      target = next;
      if (ghost) ghost.style.transform = `translate(${x - x0}px, ${y - y0}px)`;
      if (hint) { hint.textContent = target?.hint ?? ""; hint.hidden = !target; hint.style.transform = `translate(${x + 14}px, ${y + 16}px)`; }
      frame = requestAnimationFrame(aim);
    };
    const begin = () => {
      if (started) return;
      started = true;
      setDraggingId(task.id);
      const rect = handle.getBoundingClientRect();
      ghost = handle.cloneNode(true) as HTMLElement;
      ghost.classList.add("task-drag-ghost");
      Object.assign(ghost.style, { position: "fixed", left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, margin: "0", zIndex: "60", pointerEvents: "none" });
      hint = document.createElement("div");
      hint.className = "task-drag-hint";
      hint.hidden = true;
      document.body.append(ghost, hint);
      document.body.classList.add("task-dragging");
      frame = requestAnimationFrame(aim);
    };
    const move = (next: PointerEvent) => {
      x = next.clientX; y = next.clientY;
      const far = Math.abs(x - x0) + Math.abs(y - y0) > 8;
      if (!started && far) { if (touch) end(false); else begin(); }
    };
    // While a touch drag is on, the page doesn't scroll under the finger.
    const still = (next: Event) => { if (started) next.preventDefault(); };
    const end = (drop: boolean) => {
      clearTimeout(hold);
      cancelAnimationFrame(frame);
      ghost?.remove(); hint?.remove();
      target?.element.classList.remove("task-drop-target");
      document.body.classList.remove("task-dragging");
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", cancel);
      document.removeEventListener("keydown", escape, true);
      document.removeEventListener("touchmove", still);
      document.removeEventListener("contextmenu", still, true);
      setDraggingId(null);
      if (!started) return;
      // The click that ends a drag doesn't also open the task.
      addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => removeEventListener("click", swallow, { capture: true }), 0);
      if (drop && target) { const to = target.to; void moving([task.id], () => props.onMoveTask(task, to)); }
    };
    const swallow = (next: Event) => { next.stopPropagation(); next.preventDefault(); };
    const up = () => end(true);
    const cancel = () => end(false);
    const escape = (next: KeyboardEvent) => { if (next.key === "Escape") { next.preventDefault(); next.stopPropagation(); end(false); } };
    try { handle.setPointerCapture(event.pointerId); } catch { return; }
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up, { once: true });
    handle.addEventListener("pointercancel", cancel, { once: true });
    document.addEventListener("keydown", escape, true);
    document.addEventListener("touchmove", still, { passive: false });
    document.addEventListener("contextmenu", still, true);
    if (touch) hold = setTimeout(begin, 380);
  };

  const RowMenu = (menuProps: { task: Task; done: boolean; finished: "show" | "fold" | null }) => {
    const [open, setOpen] = createSignal(false);
    let root!: HTMLSpanElement;
    createEffect(() => {
      if (!open()) return;
      const outside = (event: PointerEvent) => { if (!root.contains(event.target as Node)) setOpen(false); };
      const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); setOpen(false); } };
      document.addEventListener("pointerdown", outside, true); document.addEventListener("keydown", escape, true);
      onCleanup(() => { document.removeEventListener("pointerdown", outside, true); document.removeEventListener("keydown", escape, true); });
    });
    const act = (run: () => unknown) => () => { setOpen(false); void run(); };
    const pushed = () => pushedDownInfo(menuProps.task, props.now).pushed;
    const tomorrow = () => addDays(startOfDay(props.now), 1);
    const id = () => menuProps.task.id;
    return <span class="task-menu" ref={root}>
      <button class="icon-button task-menu-button" aria-label={`Actions for ${menuProps.task.title || "Untitled task"}`} aria-haspopup="menu" aria-expanded={open()} onClick={() => setOpen(value => !value)}>⋮</button>
      <Show when={open()}>
        <div class="task-menu-list" role="menu">
          <button role="menuitem" onClick={act(() => props.onEdit(menuProps.task))}>Open details</button>
          <Show when={menuProps.task.state === "completed"}>
            <button role="menuitem" onClick={act(() => moving([id()], () => props.onReopen(menuProps.task)))}>Reopen</button>
          </Show>
          <Show when={!menuProps.done}>
            <Show when={pushed()} fallback={<>
              <button role="menuitem" onClick={act(() => moving([id()], () => props.onPushDown(menuProps.task, null)))}>Push down</button>
              <button role="menuitem" onClick={act(() => moving([id()], () => props.onPushDown(menuProps.task, tomorrow())))}>Push down until tomorrow</button>
            </>}>
              <button role="menuitem" onClick={act(() => moving([id()], () => props.onLift(menuProps.task)))}>Lift back up</button>
            </Show>
          </Show>
          <Show when={!menuProps.done && menuProps.task.repeat && !menuProps.task.repeat.untilDone}>
            <button role="menuitem" onClick={act(() => moving([id()], () => props.onFinish(menuProps.task)))}>Finish for good</button>
          </Show>
          <Show when={menuProps.finished}>
            <button role="menuitem" onClick={act(() => props.onCompletedSubtasks(menuProps.task, menuProps.finished === "show" ? null : "show"))}>{menuProps.finished === "show" ? "Fold completed subtasks" : "Show completed subtasks"}</button>
          </Show>
          <button role="menuitem" class="danger-text" onClick={act(() => props.onDeleteTask(menuProps.task))}>Delete</button>
        </div>
      </Show>
    </span>;
  };


  // Keyboard. The last focused row is the one Tab comes back to; arrows move focus between
  // rows (and the rows that fold others away, and in the Agenda the section headings),
  // wrapping around at the ends. In Boards, ↑/↓ stay in a column and ←/→ change column.
  const [focusId, setFocusId] = createSignal<string | null>(null);
  const editable = (target: EventTarget | null) => target instanceof Element && !!target.closest("input, textarea, select, [contenteditable]");
  const stops = () => [...boardRef.querySelectorAll<HTMLElement>(`.today-row[data-id], .today-fold${props.view === "today" ? ", .today-section-heading" : ""}`)].filter(element => element.getClientRects().length);
  const stackOf = (element: Element) => element.closest(".board-stack");
  const focusStop = (element: HTMLElement | undefined) => { if (!element) return; element.focus(); element.scrollIntoView({ block: "nearest", inline: "nearest" }); };
  const step = (from: HTMLElement | null, key: string) => {
    const all = stops();
    if (!all.length) return;
    if (!from || !all.includes(from)) return focusStop(key === "ArrowUp" || key === "End" ? all.at(-1) : all[0]);
    // In Boards, a column's rows; ←/→ jump to the row nearest in height in the next column.
    const stacks = props.view === "boards" ? [...new Set(all.map(stackOf))] : [null];
    const here = props.view === "boards" ? all.filter(element => stackOf(element) === stackOf(from)) : all;
    const index = here.indexOf(from);
    if (key === "ArrowDown") return focusStop(here[(index + 1) % here.length]);
    if (key === "ArrowUp") return focusStop(here[(index - 1 + here.length) % here.length]);
    if (key === "Home") return focusStop(here[0]);
    if (key === "End") return focusStop(here.at(-1));
    if (props.view !== "boards" || stacks.length < 2) return;
    const stack = stacks[(stacks.indexOf(stackOf(from)) + (key === "ArrowRight" ? 1 : -1) + stacks.length) % stacks.length];
    const y = from.getBoundingClientRect().top;
    const nearest = all.filter(element => stackOf(element) === stack).sort((a, b) => Math.abs(a.getBoundingClientRect().top - y) - Math.abs(b.getBoundingClientRect().top - y))[0];
    focusStop(nearest);
  };
  // After a change moves the focused row away, focus stays where it was: on the row that
  // took its place, else the one before.
  const keepFocus = async (row: HTMLElement, run: () => Promise<unknown>) => {
    const all = stops(), index = all.indexOf(row);
    const key = (element?: HTMLElement) => element?.dataset.id ?? null;
    const after = key(all[index + 1]), before = key(all[index - 1]);
    await run();
    const find = (id: string | null) => id ? boardRef.querySelector<HTMLElement>(`.today-row[data-id="${CSS.escape(id)}"]`) ?? undefined : undefined;
    if (document.activeElement === row && row.isConnected && stops()[index] === row) return;
    focusStop(find(after) ?? find(before) ?? stops()[Math.min(index, stops().length - 1)]);
  };
  const addField = (row?: Element | null) => (row?.closest(".board-card")?.querySelector<HTMLInputElement>(".board-add input")) ?? boardRef.closest(".today-panel")?.querySelector<HTMLInputElement>(".today-add input");
  const onRowKey = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target as HTMLElement;
    if (["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) && (target.matches(".today-row, .today-fold, .today-section-heading"))) {
      event.preventDefault(); step(target, event.key); return;
    }
    if (!target.matches(".today-row[data-id]")) return;
    const task = byId().get(target.dataset.id!) as Task | undefined;
    const action = actionForKey(normalizeEventKey(event), props.shortcuts);
    if (!task || !action) return;
    event.preventDefault();
    const waiting = target.classList.contains("dependent"), done = !!target.querySelector(".complete-button.checked");
    if (action === "edit") props.onEdit(task);
    else if (action === "addTask") addField(target)?.focus();
    else if (waiting) return;
    else if (action === "complete") void keepFocus(target, () => done ? reopen(task) : complete(task));
    else if (done) return;
    else if (action === "pushDown") void keepFocus(target, () => moving([task.id], () => pushedDownInfo(task, props.now).pushed ? props.onLift(task) : props.onPushDown(task, null)));
    else if (action === "pushDownTomorrow") { const date = addDays(startOfDay(props.now), 1); void keepFocus(target, () => moving([task.id], () => props.onPushDown(task, date))); }
    else if (action === "notYet" && task.repeat?.untilDone) void keepFocus(target, () => moving([task.id], () => props.onNotYet(task)));
  };
  // With nothing focused, ↓/↑ start at the first or last row, and Add a task works too.
  onMount(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || editable(event.target) || document.querySelector(".solid-dialog-backdrop")) return;
      if (event.target !== document.body) return;
      if (["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); step(null, event.key); }
      else if (actionForKey(normalizeEventKey(event), props.shortcuts) === "addTask") { event.preventDefault(); addField()?.focus(); }
    };
    document.addEventListener("keydown", onKey);
    onCleanup(() => document.removeEventListener("keydown", onKey));
  });

  const [draft, setDraft] = createSignal("");
  const add = async () => {
    const title = draft().trim();
    if (!title) return;
    const filter = groupFilter();
    if (await props.onAddTask(props.view === "today" && filter && filter !== "none" ? filter : null, title)) setDraft(value => value.trim() === title ? "" : value);
  };

  // Boards: the saved layout, leaving out built-in boards with no tasks (yours always show).
  const found = createMemo(() => new Map(sections().map(section => [section.id, section])));
  const isBoard = (id: string) => !SECTION_ORDER.includes(id as SectionId);
  const shownLayout = createMemo(() => boardLayout(props.items).map(column => column.filter(key => found().has(key) || isBoard(key))).filter(column => column.length));
  const sectionOf = (key: string): Section => found().get(key) ?? { id: key, trees: [], count: 0 };
  const titleOf = (id: string) => SECTION_LABELS[id as SectionId]?.title ?? boardTitle(id);
  const hintOf = (id: string) => SECTION_LABELS[id as SectionId]?.hint;

  // Dragging a board by its heading. Over a column, where it would land in that column
  // opens up (above or below the board under the pointer); between columns, or over a
  // column's outer sixths, a new column opens there. That new column's space then stays
  // open, unhighlighted, while the pointer goes on over the next column, and moves only once
  // the pointer is past that column too, so nothing slides under the pointer as it goes.
  // Spots that change nothing don't open.
  const [dragKey, setDragKey] = createSignal<string | null>(null);
  const [dropKey, setDropKey] = createSignal("");
  const [spaceKey, setSpaceKey] = createSignal("");
  let boardDragged = false;
  const targetOf = (key: string): BoardTarget | null => {
    const [kind, a, b] = key.split(":");
    return kind === "slot" ? { column: Number(a), index: Number(b) } : kind === "column" ? { newColumn: Number(a) } : null;
  };
  const dragBoard = (key: string) => (event: PointerEvent) => {
    if (props.view !== "boards" || event.button !== 0 || (event.target as Element).closest("input, .board-menu")) return;
    const handle = event.currentTarget as HTMLElement, card = handle.closest<HTMLElement>(".board-card");
    // With touch, a long press starts the drag so a swipe across the boards still scrolls.
    const touch = event.pointerType === "touch", pointer = event.pointerId;
    const x0 = event.clientX, y0 = event.clientY;
    let x = x0, y = y0, started = false, frame = 0, ghost: HTMLElement | null = null, hold: ReturnType<typeof setTimeout> | undefined;
    const layout = boardLayout(props.items), shown = shownLayout();
    const changes = (drop: string) => { const target = targetOf(drop); return !!target && !sameLayout(placeBoard(layout, shown, key, target), layout); };
    // Where the pointer is: a spot in a column ("slot:column:index") or between columns ("column:index").
    const spotAt = () => {
      const hit = document.elementFromPoint(x, y);
      const opening = hit?.closest<HTMLElement>("[data-drop]")?.dataset.drop;
      if (opening) return opening;
      // The empty space under a column counts as its bottom slot.
      if (hit?.matches(".board-stack")) return (hit as HTMLElement).dataset.end ?? "";
      const over = hit?.closest<HTMLElement>(".board-card[data-column]");
      if (over) {
        const rect = over.getBoundingClientRect(), column = Number(over.dataset.column), row = Number(over.dataset.row);
        const across = (x - rect.left) / rect.width;
        return across < 1 / 6 ? `column:${column}` : across > 5 / 6 ? `column:${column + 1}` : (y - rect.top) / rect.height < 0.5 ? `slot:${column}:${row}` : `slot:${column}:${row + 1}`;
      }
      // Past the last column: a new column at the end.
      const stacks = boardRef.querySelectorAll(".board-stack");
      if (hit && boardRef.contains(hit) && stacks.length && x > stacks[stacks.length - 1].getBoundingClientRect().right) return `column:${stacks.length}`;
      return "";
    };
    const aim = () => {
      const box = boardRef.getBoundingClientRect();
      if (x > box.right - 48) boardRef.scrollLeft += 18; else if (x < box.left + 48) boardRef.scrollLeft -= 18;
      if (ghost) ghost.style.transform = `translate(${x - x0}px, ${y - y0}px)`;
      const spot = spotAt();
      const useful = !!spot && changes(spot);
      // A new column's space moves only to another new column that would change something.
      if (useful && spot.startsWith("column:")) setSpaceKey(spot);
      setDropKey(useful ? spot : "");
      frame = requestAnimationFrame(aim);
    };
    const begin = () => {
      started = true;
      try { handle.setPointerCapture(pointer); } catch { /* the pointer is already gone */ }
      setDragKey(key);
      if (card) {
        const rect = card.getBoundingClientRect();
        ghost = card.cloneNode(true) as HTMLElement;
        ghost.classList.add("board-card-ghost");
        Object.assign(ghost.style, { position: "fixed", left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, maxHeight: "50vh", overflow: "hidden", margin: "0", zIndex: "60", pointerEvents: "none" });
        document.body.appendChild(ghost);
        boardRef.style.setProperty("--drop-h", `${Math.min(rect.height, innerHeight * 0.5)}px`);
        boardRef.style.setProperty("--drop-w", `${rect.width}px`);
      }
      frame = requestAnimationFrame(aim);
    };
    const move = (next: PointerEvent) => {
      if (next.pointerId !== pointer) return;
      x = next.clientX; y = next.clientY;
      if (!started && Math.abs(x - x0) + Math.abs(y - y0) > (touch ? 8 : 6)) { if (touch) end(false); else begin(); }
    };
    const still = (next: Event) => { if (started) next.preventDefault(); };
    const end = (drop: boolean) => {
      clearTimeout(hold);
      document.removeEventListener("touchmove", still);
      document.removeEventListener("contextmenu", still, true);
      cancelAnimationFrame(frame);
      ghost?.remove();
      boardRef.style.removeProperty("--drop-h");
      boardRef.style.removeProperty("--drop-w");
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", cancel);
      document.removeEventListener("keydown", escape, true);
      const target = targetOf(dropKey());
      setDragKey(null); setDropKey(""); setSpaceKey("");
      // The click that ends a drag isn't a click on the board's name.
      if (started) { boardDragged = true; setTimeout(() => { boardDragged = false; }); }
      if (drop && started && target) void moveBoards(() => props.onLayoutBoards(placeBoard(layout, shown, key, target)));
    };
    const up = (next: PointerEvent) => { if (next.pointerId === pointer) end(true); };
    const cancel = (next: PointerEvent) => { if (next.pointerId === pointer) end(false); };
    const escape = (next: KeyboardEvent) => { if (next.key === "Escape") { next.preventDefault(); next.stopPropagation(); end(false); } };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", cancel);
    document.addEventListener("keydown", escape, true);
    document.addEventListener("touchmove", still, { passive: false });
    document.addEventListener("contextmenu", still, true);
    if (touch) hold = setTimeout(begin, 380);
  };
  // Boards slide to their new places too.
  const moveBoards = async (run: () => Promise<unknown>) => {
    const cards = () => new Map([...boardRef.querySelectorAll<HTMLElement>(".board-card[data-section]")].map(element => [element.dataset.section!, element]));
    const before = new Map([...cards()].map(([key, element]) => [key, element.getBoundingClientRect()]));
    await run();
    if (!boardRef.closest('[data-animations="on"]')) return;
    for (const [key, element] of cards()) {
      const old = before.get(key), box = element.getBoundingClientRect();
      if (!old) continue;
      const dx = old.left - box.left, dy = old.top - box.top;
      if (Math.abs(dx) + Math.abs(dy) > 1) element.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: MOTION_MS, easing: "cubic-bezier(.2, .8, .2, 1)" });
    }
  };

  // Boards: a task added at the bottom of a board goes on that board (on Available, on none).
  // The field stays ready for the next one; Escape leaves it.
  const BoardAdd = (addProps: { boardId: string | null }) => {
    const [title, setTitle] = createSignal("");
    const submit = async () => {
      const text = title().trim();
      if (text && await props.onAddTask(addProps.boardId, text)) setTitle(value => value.trim() === text ? "" : value);
    };
    return <form class="board-add" onSubmit={event => { event.preventDefault(); void submit(); }}>
      <Icon name="plus" size={14} />
      <input placeholder="Add a task" aria-label={`Add a task to ${addProps.boardId ? boardTitle(addProps.boardId) : "no board"}`} value={title()} onInput={event => setTitle(event.currentTarget.value)}
        onKeyDown={event => {
          if (event.key === "Escape") { event.preventDefault(); setTitle(""); event.currentTarget.blur(); }
          // Up from a board's field: its last row.
          else if (event.key === "ArrowUp") { event.preventDefault(); event.stopPropagation(); const rows = [...(event.currentTarget.closest(".board-card")?.querySelectorAll<HTMLElement>(".today-row[data-id], .today-fold") || [])]; focusStop(rows.at(-1)); }
        }} />
    </form>;
  };

  // A board's name in its heading: click it (or Rename in its ⋮ menu) to edit it there.
  // Enter or leaving the field saves; Escape, or an empty name, keeps the old one.
  const [renaming, setRenaming] = createSignal<string | null>(null);
  const BoardName = (nameProps: { board: Group }) => {
    const save = (input: HTMLInputElement) => {
      const title = input.value.trim();
      setRenaming(null);
      if (title && title !== nameProps.board.title) void props.onRenameBoard(nameProps.board, title);
    };
    return <Show when={renaming() === nameProps.board.id} fallback={
      <button type="button" class="board-name" title="Rename this board" onClick={() => { if (!boardDragged) setRenaming(nameProps.board.id); }}>{nameProps.board.title || "Untitled board"}</button>}>
      <input class="board-name-input" aria-label="Board name" value={nameProps.board.title} ref={input => requestAnimationFrame(() => { input.focus(); input.select(); })}
        onKeyDown={event => {
          if (event.key === "Enter") { event.preventDefault(); save(event.currentTarget); }
          else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setRenaming(null); }
        }}
        onBlur={event => { if (renaming() === nameProps.board.id) save(event.currentTarget); }} />
    </Show>;
  };

  // One section: in the Agenda a collapsible list section; in Boards a board you can drag.
  const SectionBlock = (blockProps: { id: string; column?: number; row?: number }) => {
    const id = () => blockProps.id;
    const current = () => props.view === "boards" ? sectionOf(id()) : found().get(id()) ?? { id: id(), trees: [], count: 0 };
    return <section class="today-section" classList={{ "board-card": props.view === "boards", dragging: dragKey() === id() }} data-section={id()} data-column={blockProps.column} data-row={blockProps.row}>
      <Show when={props.view === "boards"} fallback={
        <button class="today-section-heading" aria-expanded={!isCollapsed(id())} data-holds={isCollapsed(id()) ? idsIn(current().trees).join(" ") : undefined} onClick={() => toggleSection(id())}>
          <span class="section-chevron" aria-hidden="true">›</span>
          <strong>{titleOf(id())}</strong>
          <span class="section-count">{current().count}</span>
          <Show when={hintOf(id())}><span class="today-hint">{hintOf(id())}</span></Show>
        </button>}>
        <div class="today-section-heading board-heading" title="Drag to move this board" onPointerDown={dragBoard(id())}>
          <Show when={boards().find(board => board.id === id())} fallback={<strong>{titleOf(id())}</strong>}>{board => <BoardName board={board()} />}</Show>
          <span class="section-count">{current().count}</span>
          <Show when={hintOf(id())}><span class="today-hint">{hintOf(id())}</span></Show>
          <Show when={boards().find(board => board.id === id())}>{board =>
            <BoardMenu board={board()} items={props.items} onRename={() => setRenaming(board().id)} onDelete={props.onDeleteBoard} />}
          </Show>
        </div>
      </Show>
      <Show when={!isCollapsed(id())}>
        <div class="today-rows">
          <Show when={current().trees.length} fallback={<p class="today-column-empty">No tasks on this board.</p>}>
            {/* A board's own rows don't repeat its name. */}
            <Rows nodes={current().trees} depth={0} label={!isBoard(id())} runKey={id()} />
          </Show>
          <Show when={props.view === "boards" && (isBoard(id()) || id() === "available")}><BoardAdd boardId={isBoard(id()) ? id() : null} /></Show>
        </div>
      </Show>
    </section>;
  };
  const opening = (key: string, kind: "slot" | "column") => <div class={kind === "slot" ? "board-drop-slot" : "board-drop-column"} data-drop={key} classList={{ active: dropKey() === key, space: spaceKey() === key }} />;

  return <section class="panel today-panel" classList={{ columns: props.view === "boards" }}>
    <Show when={startPrompt()}>{prompt =>
      <div class="start-prompt" role="status">
        <span>Completed “{prompt().owner.title || "Untitled task"}”. Start a dependent task?</span>
        <div>
          <For each={prompt().dependents}>{dependent => <button class="secondary-button" onClick={() => { setStartPrompt(null); void props.onStartDependent(dependent, false); }}>{dependent.title || "Untitled task"}</button>}</For>
          <button class="text-button" onClick={() => setStartPrompt(null)}>Not now</button>
        </div>
      </div>}
    </Show>
    <div class="today-heading">
      <h1>{props.view === "boards" ? "Boards" : "Agenda"}</h1>
      <span class="today-date">{formatIn(props.now, { weekday: "short", month: "short", day: "numeric" })} · {clock(props.now)}</span>
      <span class="spacer" />
      <label class="today-subtasks" title={"Keep together: each task with subtasks shows once, in the section of its most urgent subtask, with the rest dimmed.\nSpread out: every subtask shows in its own section, under a dimmed row for its parent."}>
        <span>Subtasks</span>
        <select aria-label="How subtasks show" value={props.subtaskMode} onChange={event => props.onSubtaskModeChange(event.currentTarget.value as SubtaskMode)}>
          <option value="nested">Keep together</option>
          <option value="context">Spread out</option>
        </select>
      </label>
      <Show when={props.view === "boards"}>
        <label class="check-row" title="Tasks on a board that are Firm, closing or opening today, or upcoming move to that column; the rest stay on their board"><input type="checkbox" checked={props.pullTimed} onChange={event => props.onPullTimedChange(event.currentTarget.checked)} />Pull timed tasks off boards</label>
      </Show>
      <label class="check-row" title="Fold pushed-down tasks beside each other into one row you can open"><input type="checkbox" checked={props.compact} onChange={event => props.onCompactChange(event.currentTarget.checked)} />Compact</label>
      <Show when={props.view === "today"}>
        <label class="today-filter"><span class="visually-hidden">Board</span>
          <select value={groupFilter()} onChange={event => setGroupFilter(event.currentTarget.value)}>
            <option value="">All boards</option>
            <For each={boards()}>{board => <option value={board.id}>{board.title}</option>}</For>
            <option value="none">No board</option>
          </select>
        </label>
      </Show>
    </div>
    <form class="quick-capture today-add" onSubmit={event => { event.preventDefault(); void add(); }}>
      <Icon name="plus" size={17} />
      <input placeholder="Add a task" aria-label="Add a task" value={draft()} onInput={event => setDraft(event.currentTarget.value)}
        onKeyDown={event => { if (event.key === "ArrowDown") { event.preventDefault(); step(null, "ArrowDown"); } else if (event.key === "Escape" && !draft()) event.currentTarget.blur(); }} />
    </form>
    <div class="today-board" ref={boardRef} onKeyDown={onRowKey} classList={{ "boards-layout": props.view === "boards", "drag-active": !!dragKey() }}>
      <Show when={props.view === "boards"} fallback={
        <Show when={sections().length} fallback={<p class="today-empty">{props.query ? "No tasks match your search." : "Nothing needs you right now."}</p>}>
          <For each={sections().map(entry => entry.id)}>{id => <SectionBlock id={id} />}</For>
        </Show>}>
        {opening("column:0", "column")}
        <Index each={shownLayout()}>{(column, columnIndex) => <>
          <div class="board-stack" data-end={`slot:${columnIndex}:${column().length}`}>
            {opening(`slot:${columnIndex}:0`, "slot")}
            <For each={column()}>{(key, row) => <>
              <SectionBlock id={key} column={columnIndex} row={row()} />
              {opening(`slot:${columnIndex}:${row() + 1}`, "slot")}
            </>}</For>
          </div>
          {opening(`column:${columnIndex + 1}`, "column")}
        </>}</Index>
      </Show>
    </div>
  </section>;
}
