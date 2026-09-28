import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount, type JSX } from "solid-js";
import { Icon } from "./Icon";
import { groupOptions } from "./group-board";
import { ancestors, buildSections, pushedDownInfo, taskGroupId, type Placement, type Section, type SectionId, type SubtaskMode, type TreeNode } from "./today";
import { taskSchedule, windowsById } from "./windows";
import type { Group, Item, Task } from "./types";

export type GroupLayout = "labels" | "headings";
// Sections stacked in one list, or side by side as columns (a design being compared).
export type TaskLayout = "list" | "columns";

export type TodayViewProps = {
  items: Item[];
  query: string;
  now: Date;
  selectedId: string | null;
  groupLayout: GroupLayout;
  layout: TaskLayout;
  subtaskMode: SubtaskMode;
  onSubtaskModeChange: (value: SubtaskMode) => void;
  // Compact folds each run of pushed-down sibling tasks into one expandable row.
  compact: boolean;
  onCompactChange: (value: boolean) => void;
  // Unsaved editor text shows on the row as it's typed.
  liveEdits: () => Map<string, Partial<Task>>;
  onEdit: (task: Task) => void;
  onComplete: (task: Task) => Promise<void>;
  onAddTask: (groupId: string | null, title: string) => Promise<boolean>;
  onPushDown: (task: Task, until: Date | null) => Promise<void>;
  onLift: (task: Task) => Promise<void>;
  onDeleteTask: (task: Task) => Promise<void>;
  onReopen: (task: Task) => Promise<void>;
  // Whether a task's finished subtasks show dimmed ("show") or fold into "+N completed" (null).
  onCompletedSubtasks: (task: Task, value: Task["completedSubtasks"]) => Promise<void>;
  onStartDependent: (task: Task, completeParent: boolean) => Promise<void>;
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
// In the list, these start collapsed.
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

function textMatches(task: Task, query: string) {
  const needle = query.trim().toLowerCase();
  return !needle || [task.title, task.notes || "", ...(task.tags || [])].some(value => value.toLowerCase().includes(needle));
}

/** Every task id in some trees, finished subtasks included. */
function idsIn(nodes: TreeNode[]): string[] {
  return nodes.flatMap(node => [node.task.id, ...idsIn(node.children), ...idsIn(node.finished || [])]);
}

type Chip = { label: string; kind?: "danger" | "warn" | "calm"; title?: string };

export function TodayView(props: TodayViewProps) {
  const byId = createMemo(() => new Map(props.items.map(item => [item.id, item])));
  const windows = createMemo(() => windowsById(props.items));
  const groups = createMemo(() => groupOptions(props.items));
  // "" is every group; "none" is tasks without one.
  const [groupFilter, setGroupFilter] = createSignal("");
  const sections = createMemo(() => {
    const filter = groupFilter();
    return buildSections(props.items, props.now, {
      mode: props.subtaskMode,
      // Completed tasks are always listed (in the list, their section starts collapsed).
      showCompleted: true,
      include: task => textMatches(task, props.query) && (!filter || (taskGroupId(task, byId()) ?? "none") === filter),
    });
  });
  const [collapsed, setCollapsed] = createSignal(new Set(COLLAPSED_AT_FIRST));
  const isCollapsed = (id: SectionId) => props.layout === "list" && collapsed().has(id);
  const toggleSection = (id: SectionId) => setCollapsed(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
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
    const dependents = props.items.filter((item): item is Task => item.kind === "task" && item.dependentOf === task.id);
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

  const groupTitle = (id: string | null) => {
    if (!id) return "";
    const option = groups().find(entry => entry.group.id === id);
    return option?.group.title || "";
  };

  const isPushed = (node: TreeNode) => node.placement ? node.placement.pushed && node.placement.section !== "completed" : pushedDownInfo(node.task, props.now).pushed;

  const Row = (rowProps: { node: TreeNode; depth: number; label: boolean; runKey: string }): JSX.Element => {
    const task = () => rowProps.node.task;
    // Finished itself or through a container: a ticked box that reopens it.
    const done = () => rowProps.node.placement?.section === "completed";
    const label = () => rowProps.label && props.groupLayout === "labels" ? groupTitle(taskGroupId(task(), byId())) : "";
    return <>
      <div class="today-row" title={rowProps.node.muted ? "Its own timing is less urgent; shown here with its family" : rowProps.node.container ? "Holds these subtasks; checking it off finishes all of them" : undefined} classList={{ container: rowProps.node.container, muted: !!rowProps.node.muted, pushed: isPushed(rowProps.node), selected: props.selectedId === task().id }}
        style={{ "padding-left": `${10 + rowProps.depth * 20}px` }} data-task-card="true" data-id={task().id} tabIndex={-1}
        onClick={event => { if (!(event.target as Element).closest("button, .task-menu")) props.onEdit(task()); }}>
        <Show when={!done()} fallback={<button class="complete-button checked" aria-label={`Reopen ${task().title || "Untitled task"}`} title={reopenTitle(task())} onClick={() => void reopen(task())}><svg class="check-mark" viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 10.5 10.5 16 21 1.5" /></svg></button>}>
          <button class="complete-button" aria-label={`Complete ${task().title}`} onClick={() => void complete(task())} />
        </Show>
        <span class="today-copy">
          <span class="today-title">{props.liveEdits().get(task().id)?.title ?? task().title ?? ""}<Show when={!(props.liveEdits().get(task().id)?.title ?? task().title)}>Untitled task</Show></span>
          <span class="today-chips"><For each={chips(rowProps.node)}>{chip => <span class={`today-chip ${chip.kind || ""}`} title={chip.title}>{chip.label}</span>}</For></span>
        </span>
        <Show when={label()}><span class="today-group">{label()}</span></Show>
        <RowMenu task={task()} done={done()} finished={rowProps.node.finished?.length ? rowProps.node.showFinished ? "show" : "fold" : null} />
      </div>
      <Rows nodes={rowProps.node.children} depth={rowProps.depth + 1} label={false} runKey={`${rowProps.runKey}/${task().id}`} />
      <Show when={rowProps.node.finished?.length}>
        <Show when={rowProps.node.showFinished} fallback={
          <button type="button" class="today-fold" data-holds={idsIn(rowProps.node.finished!).join(" ")} style={{ "padding-left": `${39 + rowProps.depth * 20}px` }} title="Show them dimmed here (remembered for this task)" onClick={() => void props.onCompletedSubtasks(task(), "show")}>+{rowProps.node.finished!.length} completed</button>}>
          <Rows nodes={rowProps.node.finished!} depth={rowProps.depth + 1} label={false} runKey={`${rowProps.runKey}/${task().id}/finished`} />
        </Show>
      </Show>
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
          <Show when={menuProps.finished}>
            <button role="menuitem" onClick={act(() => props.onCompletedSubtasks(menuProps.task, menuProps.finished === "show" ? null : "show"))}>{menuProps.finished === "show" ? "Fold completed subtasks" : "Show completed subtasks"}</button>
          </Show>
          <button role="menuitem" class="danger-text" onClick={act(() => props.onDeleteTask(menuProps.task))}>Delete</button>
        </div>
      </Show>
    </span>;
  };

  // With group headings, a section's trees are split by the group of their top task.
  const grouped = (section: Section) => {
    if (props.groupLayout !== "headings") return [{ id: "", title: "", trees: section.trees }];
    const order = [...groups().map(entry => entry.group.id), null];
    const buckets = new Map<string | null, TreeNode[]>();
    for (const tree of section.trees) { const id = taskGroupId(tree.task, byId()); buckets.set(id, [...(buckets.get(id) || []), tree]); }
    return order.filter(id => buckets.has(id)).map(id => ({ id: id || "none", title: id ? groupPath(id) : "No group", trees: buckets.get(id)! }));
  };
  const groupPath = (id: string) => {
    const names: string[] = [];
    for (let group = byId().get(id) as Group | undefined, guard = 0; group?.kind === "group" && guard < 20; group = byId().get(group.parentId || "") as Group | undefined, guard++) names.unshift(group.title);
    return names.join(" › ");
  };

  const [draft, setDraft] = createSignal("");
  const add = async () => {
    const title = draft().trim();
    if (!title) return;
    const filter = groupFilter();
    if (await props.onAddTask(filter && filter !== "none" ? filter : null, title)) setDraft(value => value.trim() === title ? "" : value);
  };

  return <section class="panel today-panel" classList={{ columns: props.layout === "columns" }}>
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
      <h1>Today</h1>
      <span class="today-date">{props.now.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })} · {clock(props.now)}</span>
      <span class="spacer" />
      <label class="today-subtasks" title={"Keep together: each task with subtasks shows once, in the section of its most urgent subtask, with the rest dimmed.\nSpread out: every subtask shows in its own section, under a dimmed row for its parent."}>
        <span>Subtasks</span>
        <select aria-label="How subtasks show" value={props.subtaskMode} onChange={event => props.onSubtaskModeChange(event.currentTarget.value as SubtaskMode)}>
          <option value="nested">Keep together</option>
          <option value="context">Spread out</option>
        </select>
      </label>
      <label class="check-row" title="Fold pushed-down tasks beside each other into one row you can open"><input type="checkbox" checked={props.compact} onChange={event => props.onCompactChange(event.currentTarget.checked)} />Compact</label>
      <label class="today-filter"><span class="visually-hidden">Group</span>
        <select value={groupFilter()} onChange={event => setGroupFilter(event.currentTarget.value)}>
          <option value="">All groups</option>
          <For each={groups()}>{option => <option value={option.group.id}>{"— ".repeat(option.depth)}{option.group.title}</option>}</For>
          <option value="none">No group</option>
        </select>
      </label>
    </div>
    <form class="quick-capture today-add" onSubmit={event => { event.preventDefault(); void add(); }}>
      <Icon name="plus" size={17} />
      <input placeholder="Add a task" aria-label="Add a task" value={draft()} onInput={event => setDraft(event.currentTarget.value)} />
    </form>
    <div class="today-board" ref={boardRef}>
      <Show when={sections().length} fallback={<p class="today-empty">{props.query ? "No tasks match your search." : "Nothing needs you right now."}</p>}>
        <For each={sections().map(entry => entry.id)}>{sectionId => <Show when={sections().find(entry => entry.id === sectionId)}>{current => { const id = current().id;
          return <section class="today-section" data-section={id}>
            <button class="today-section-heading" aria-expanded={!isCollapsed(id)} disabled={props.layout === "columns"} data-holds={isCollapsed(id) ? idsIn(current().trees).join(" ") : undefined} onClick={() => toggleSection(id)}>
              <Show when={props.layout === "list"}><span class="section-chevron" aria-hidden="true">›</span></Show>
              <strong>{SECTION_LABELS[id].title}</strong>
              <span class="section-count">{current().count}</span>
              <Show when={SECTION_LABELS[id].hint}><span class="today-hint">{SECTION_LABELS[id].hint}</span></Show>
            </button>
            <Show when={!isCollapsed(id)}>
              <div class="today-rows">
                <For each={grouped(current()).map(bucket => bucket.id)}>{bucketId => <Show when={grouped(current()).find(bucket => bucket.id === bucketId)}>{bucket => <>
                  <Show when={bucket().title}><div class="today-group-heading">{bucket().title}</div></Show>
                  <Rows nodes={bucket().trees} depth={0} label runKey={`${id}:${bucketId}`} />
                </>}</Show>}</For>
              </div>
            </Show>
          </section>; }}</Show>}
        </For>
      </Show>
    </div>
  </section>;
}

const Segmented = <T extends string>(props: { label: string; value: T; options: [T, string][]; onChange: (value: T) => void }) =>
  <span class="today-toggle" role="group" aria-label={props.label}><span>{props.label}</span>
    <For each={props.options}>{([value, text]) => <button type="button" aria-pressed={props.value === value} onClick={() => props.onChange(value)}>{text}</button>}</For>
  </span>;

/** The prototype's layout switches, shown in the top bar while comparing designs. */
export function DesignToggles(props: {
  groupLayout: GroupLayout; onGroupLayoutChange: (value: GroupLayout) => void;
  layout: TaskLayout; onLayoutChange: (value: TaskLayout) => void;
}) {
  return <div class="design-toggles" aria-label="Layout options">
    <Segmented label="Groups" value={props.groupLayout} options={[["labels", "Labels"], ["headings", "Headings"]]} onChange={props.onGroupLayoutChange} />
    <Segmented label="Layout" value={props.layout} options={[["list", "List"], ["columns", "Columns"]]} onChange={props.onLayoutChange} />
  </div>;
}
