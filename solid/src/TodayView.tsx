import { For, Index, Show, createEffect, createMemo, createSignal, onCleanup, onMount, type JSX } from "solid-js";
import { Icon } from "./Icon";
import { ancestors, buildSections, pushedDownInfo, SECTION_ORDER, taskGroupId, type Placement, type Section, type SectionId, type SubtaskMode, type TreeNode } from "./today";
import { boardLayout, placeBoard, sameLayout, userBoards, type BoardLayout, type BoardTarget } from "./board-order";
import { taskSchedule, windowsById } from "./windows";
import { describeRepeat, lastCheckIn } from "./repeats";
// The same search as the calendar: title, notes, tags, and attachment names.
import { textMatches } from "../../site/domain.js";
import type { Item, Task } from "./types";

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
  // The Boards view's boards in a new layout (every board's key, a section id or a board id, by column).
  onLayoutBoards: (layout: BoardLayout) => Promise<void>;
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

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const clock = (date: Date) => date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
/** "3:00 PM" today, "Thu 5:00 PM" this week, "Oct 12" later (with the year only when it isn't this year). */
export function when(date: Date, now: Date) {
  if (sameDay(date, now)) return clock(date);
  const days = (new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86_400_000;
  // Midnight means the start of that day; its time adds nothing.
  const time = date.getHours() || date.getMinutes() ? ` ${clock(date)}` : "";
  if (days > 0 && days < 7) return `${date.toLocaleDateString([], { weekday: "short" })}${time}`;
  return date.toLocaleDateString([], { month: "short", day: "numeric", ...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
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
      <div class="today-row dependent" classList={{ selected: props.selectedId === task().id }} style={{ "padding-left": `${10 + rowProps.depth * 20}px` }} data-task-card="true" data-id={task().id} tabIndex={-1}
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
      <div class="today-row" title={rowProps.node.muted ? "Its own timing is less urgent; shown here with its family" : rowProps.node.container ? "Holds these subtasks; checking it off finishes all of them" : undefined} classList={{ container: rowProps.node.container, muted: !!rowProps.node.muted, pushed: isPushed(rowProps.node), selected: props.selectedId === task().id }}
        style={{ "padding-left": `${10 + rowProps.depth * 20}px` }} data-task-card="true" data-id={task().id} tabIndex={-1}
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
    const tomorrow = () => { const date = new Date(props.now); date.setDate(date.getDate() + 1); date.setHours(0, 0, 0, 0); return date; };
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

  // Dragging a board by its heading. Where it would land shows as an opening: over a
  // board's top or bottom half, above or below it in that column; over its outer sixths
  // or the gaps between columns, a new column there. Spots that change nothing don't open.
  const [dragKey, setDragKey] = createSignal<string | null>(null);
  const [dropKey, setDropKey] = createSignal("");
  const targetOf = (key: string): BoardTarget | null => {
    const [kind, a, b] = key.split(":");
    return kind === "slot" ? { column: Number(a), index: Number(b) } : kind === "column" ? { newColumn: Number(a) } : null;
  };
  const dragBoard = (key: string) => (event: PointerEvent) => {
    if (props.view !== "boards" || event.button !== 0) return;
    const handle = event.currentTarget as HTMLElement, card = handle.closest<HTMLElement>(".board-card");
    const x0 = event.clientX, y0 = event.clientY;
    let x = x0, y = y0, started = false, frame = 0, ghost: HTMLElement | null = null;
    handle.setPointerCapture(event.pointerId);
    const layout = boardLayout(props.items), shown = shownLayout();
    const changes = (drop: string) => { const target = targetOf(drop); return !!target && !sameLayout(placeBoard(layout, shown, key, target), layout); };
    const aim = () => {
      const box = boardRef.getBoundingClientRect();
      if (x > box.right - 48) boardRef.scrollLeft += 18; else if (x < box.left + 48) boardRef.scrollLeft -= 18;
      if (ghost) ghost.style.transform = `translate(${x - x0}px, ${y - y0}px)`;
      const hit = document.elementFromPoint(x, y);
      // The empty space under a column counts as its bottom slot.
      let drop = hit?.closest<HTMLElement>("[data-drop]")?.dataset.drop ?? (hit?.matches(".board-stack") ? (hit as HTMLElement).dataset.end ?? "" : "");
      const over = drop ? null : hit?.closest<HTMLElement>(".board-card[data-column]");
      if (over) {
        const rect = over.getBoundingClientRect(), column = Number(over.dataset.column), row = Number(over.dataset.row);
        const across = (x - rect.left) / rect.width;
        drop = across < 1 / 6 ? `column:${column}` : across > 5 / 6 ? `column:${column + 1}` : (y - rect.top) / rect.height < 0.5 ? `slot:${column}:${row}` : `slot:${column}:${row + 1}`;
      }
      setDropKey(drop && changes(drop) ? drop : "");
      frame = requestAnimationFrame(aim);
    };
    const begin = () => {
      started = true;
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
      x = next.clientX; y = next.clientY;
      if (!started && Math.abs(x - x0) + Math.abs(y - y0) > 6) begin();
    };
    const end = (drop: boolean) => {
      cancelAnimationFrame(frame);
      ghost?.remove();
      boardRef.style.removeProperty("--drop-h");
      boardRef.style.removeProperty("--drop-w");
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", cancel);
      document.removeEventListener("keydown", escape, true);
      const target = targetOf(dropKey());
      setDragKey(null); setDropKey("");
      if (drop && started && target) void moveBoards(() => props.onLayoutBoards(placeBoard(layout, shown, key, target)));
    };
    const up = () => end(true);
    const cancel = () => end(false);
    const escape = (next: KeyboardEvent) => { if (next.key === "Escape") { next.preventDefault(); next.stopPropagation(); end(false); } };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up, { once: true });
    handle.addEventListener("pointercancel", cancel, { once: true });
    document.addEventListener("keydown", escape, true);
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

  // One section: in the Agenda a collapsible list section; in Boards a board you can drag.
  const SectionBlock = (blockProps: { id: string; column?: number; row?: number }) => {
    const id = () => blockProps.id;
    const current = () => props.view === "boards" ? sectionOf(id()) : found().get(id()) ?? { id: id(), trees: [], count: 0 };
    return <section class="today-section" classList={{ "board-card": props.view === "boards", dragging: dragKey() === id() }} data-section={id()} data-column={blockProps.column} data-row={blockProps.row}>
      <button class="today-section-heading" aria-expanded={!isCollapsed(id())} title={props.view === "boards" ? "Drag to move this board" : undefined} data-holds={isCollapsed(id()) ? idsIn(current().trees).join(" ") : undefined}
        onPointerDown={dragBoard(id())} onClick={() => { if (props.view === "today") toggleSection(id()); }}>
        <Show when={props.view === "today"}><span class="section-chevron" aria-hidden="true">›</span></Show>
        <strong>{titleOf(id())}</strong>
        <span class="section-count">{current().count}</span>
        <Show when={hintOf(id())}><span class="today-hint">{hintOf(id())}</span></Show>
      </button>
      <Show when={!isCollapsed(id())}>
        <div class="today-rows">
          <Show when={current().trees.length} fallback={<p class="today-column-empty">No tasks on this board.</p>}>
            {/* A board's own rows don't repeat its name. */}
            <Rows nodes={current().trees} depth={0} label={!isBoard(id())} runKey={id()} />
          </Show>
        </div>
      </Show>
    </section>;
  };
  const opening = (key: string, kind: "slot" | "column") => <div class={kind === "slot" ? "board-drop-slot" : "board-drop-column"} data-drop={key} classList={{ active: dropKey() === key }} />;

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
      <span class="today-date">{props.now.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })} · {clock(props.now)}</span>
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
      <input placeholder="Add a task" aria-label="Add a task" value={draft()} onInput={event => setDraft(event.currentTarget.value)} />
    </form>
    <div class="today-board" ref={boardRef} classList={{ "boards-layout": props.view === "boards", "drag-active": !!dragKey() }}>
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
