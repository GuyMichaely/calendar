import { For, Show, createEffect, createMemo, createSignal, onCleanup, type JSX } from "solid-js";
import { Icon } from "./Icon";
import { groupOptions } from "./group-board";
import { ancestors, buildSections, familyMode, pushedDownInfo, taskGroupId, type Placement, type Section, type SectionId, type SubtaskMode, type TreeNode } from "./today";
import { taskSchedule, windowsById } from "./windows";
import type { Group, Item, Task } from "./types";

export type TaskScope = "today" | "upcoming" | "anytime";
export type GroupLayout = "labels" | "headings";
export type LaterPlacement = "below" | "separate";

export type TodayViewProps = {
  items: Item[];
  query: string;
  now: Date;
  scope: TaskScope;
  selectedId: string | null;
  showCompleted: boolean;
  onShowCompletedChange: (value: boolean) => void;
  groupLayout: GroupLayout;
  laterPlacement: LaterPlacement;
  subtaskMode: SubtaskMode;
  onSubtaskModeChange: (value: SubtaskMode) => void;
  // Unsaved editor text shows on the row as it's typed.
  liveEdits: () => Map<string, Partial<Task>>;
  onEdit: (task: Task) => void;
  onComplete: (task: Task) => Promise<void>;
  onAddTask: (groupId: string | null, title: string, extra: Partial<Task>) => Promise<boolean>;
  onPushDown: (task: Task, until: Date | null) => Promise<void>;
  onLift: (task: Task) => Promise<void>;
  onDeleteTask: (task: Task) => Promise<void>;
  onStartDependent: (task: Task, completeParent: boolean) => Promise<void>;
  // A top task's own choice of how its subtasks show (null: follow the view setting).
  onSubtaskLayout: (task: Task, layout: Task["subtaskLayout"]) => Promise<void>;
};

const SECTION_LABELS: Record<SectionId, { title: string; hint?: string }> = {
  firm: { title: "Firm", hint: "due soon or overdue" },
  closing: { title: "Closing today", hint: "window open now" },
  later: { title: "Opens later today" },
  available: { title: "Available" },
  anytime: { title: "Anytime", hint: "no timing" },
  upcoming: { title: "Upcoming", hint: "can't start yet, or window not open today" },
  completed: { title: "Completed" },
};
// Sections each scope shows; with Upcoming and Anytime below Today, Today shows all of them.
const SCOPE_SECTIONS: Record<TaskScope, SectionId[]> = {
  today: ["firm", "closing", "later", "available", "completed"],
  upcoming: ["upcoming"],
  anytime: ["anytime"],
};
const COLLAPSED_BELOW = new Set<SectionId>(["anytime", "upcoming", "completed"]);

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

type Chip = { label: string; kind?: "danger" | "warn" | "calm"; title?: string };

export function TodayView(props: TodayViewProps) {
  const byId = createMemo(() => new Map(props.items.map(item => [item.id, item])));
  const windows = createMemo(() => windowsById(props.items));
  const groups = createMemo(() => groupOptions(props.items));
  // "" is every group; "none" is tasks without one.
  const [groupFilter, setGroupFilter] = createSignal("");
  const sections = createMemo(() => {
    const filter = groupFilter();
    const all = buildSections(props.items, props.now, {
      mode: props.subtaskMode,
      showCompleted: props.showCompleted,
      include: task => textMatches(task, props.query) && (!filter || (taskGroupId(task, byId()) ?? "none") === filter),
    });
    const wanted = props.laterPlacement === "below" && props.scope === "today" ? [...SCOPE_SECTIONS.today.slice(0, 4), "anytime", "upcoming", "completed"] : SCOPE_SECTIONS[props.scope];
    return wanted.map(id => all.find(section => section.id === id)).filter((section): section is Section => !!section);
  });
  const [collapsed, setCollapsed] = createSignal(new Set(COLLAPSED_BELOW));
  const isCollapsed = (id: SectionId) => props.scope === "today" && collapsed().has(id);
  const toggleSection = (id: SectionId) => setCollapsed(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  const [startPrompt, setStartPrompt] = createSignal<{ owner: Task; dependents: Task[] } | null>(null);
  const complete = async (task: Task) => {
    const dependents = props.items.filter((item): item is Task => item.kind === "task" && item.dependentOf === task.id);
    await props.onComplete(task);
    if (dependents.length) setStartPrompt({ owner: task, dependents });
  };

  const chips = (node: TreeNode): Chip[] => {
    const task = node.task, placement: Placement | undefined = node.placement, now = props.now;
    const result: Chip[] = [];
    if (!placement || task.state === "completed") return result;
    const schedule = taskSchedule(task, windows());
    const windowName = task.windowId ? windows().get(task.windowId)?.title : schedule ? "Custom hours" : undefined;
    if (placement.section === "firm" && placement.due) result.push(placement.overdue ? { label: `Overdue · was due ${when(placement.due, now)}`, kind: "danger" } : { label: `Due ${when(placement.due, now)} · in ${duration(placement.due.getTime() - now.getTime())}`, kind: "danger" });
    else if (placement.due) result.push({ label: `Due ${when(placement.due, now)}` });
    if (placement.section === "closing" && placement.closes) {
      const left = placement.closes.getTime() - now.getTime();
      const short = left < 3_600_000 || (task.takes != null && task.takes * 60_000 > left);
      result.push({ label: `Closes ${clock(placement.closes)} · ${duration(left)} left`, kind: short ? "warn" : "calm", title: windowName });
      if (task.takes != null && task.takes * 60_000 > left) result.push({ label: `Takes ~${duration(task.takes * 60_000)}: won't fit`, kind: "danger" });
    } else if (placement.section === "later" && placement.opens) result.push({ label: `Opens ${clock(placement.opens)}`, title: windowName });
    else if (placement.section === "upcoming") result.push({ label: placement.next ? `${schedule ? "Opens" : "Starts"} ${when(placement.next, now)}` : "No opening in the next two weeks", title: windowName });
    if (task.takes != null && !(placement.section === "closing" && placement.closes && task.takes * 60_000 > placement.closes.getTime() - now.getTime())) result.push({ label: `~${duration(task.takes * 60_000)}` });
    const pushed = pushedDownInfo(task, now);
    if (pushed.pushed) result.push({ label: pushed.until ? `Pushed down until ${when(pushed.until, now)}` : "Pushed down" });
    return result;
  };

  const groupTitle = (id: string | null) => {
    if (!id) return "";
    const option = groups().find(entry => entry.group.id === id);
    return option?.group.title || "";
  };

  const Row = (rowProps: { node: TreeNode; depth: number; label: boolean }): JSX.Element => {
    const task = () => rowProps.node.task;
    const pushed = () => !rowProps.node.context && !!rowProps.node.placement?.pushed;
    const label = () => rowProps.label && props.groupLayout === "labels" ? groupTitle(taskGroupId(task(), byId())) : "";
    return <>
      <div class="today-row" title={rowProps.node.muted ? "Its own timing is less urgent; shown here with its subtasks" : undefined} classList={{ context: rowProps.node.context, muted: !!rowProps.node.muted, pushed: pushed(), done: task().state === "completed", selected: props.selectedId === task().id }}
        style={{ "padding-left": `${10 + rowProps.depth * 20}px` }} data-task-card="true" data-id={task().id} tabIndex={-1}
        onClick={event => { if (!(event.target as Element).closest("button, .task-menu")) props.onEdit(task()); }}>
        <Show when={!rowProps.node.context} fallback={<span class="context-mark" title={task().state === "completed" ? "Completed; shown for its subtasks" : "Shown for its subtasks"} aria-hidden="true">{task().state === "completed" ? "✓" : "↳"}</span>}>
          <Show when={task().state !== "completed"} fallback={<span class="complete-indicator" aria-hidden="true">✓</span>}>
            <button class="complete-button" aria-label={`Complete ${task().title}`} onClick={() => void complete(task())} />
          </Show>
        </Show>
        <span class="today-copy">
          <span class="today-title">{props.liveEdits().get(task().id)?.title ?? task().title ?? ""}<Show when={!(props.liveEdits().get(task().id)?.title ?? task().title)}>Untitled task</Show></span>
          <span class="today-chips"><For each={rowProps.node.context ? [] : chips(rowProps.node)}>{chip => <span class={`today-chip ${chip.kind || ""}`} title={chip.title}>{chip.label}</span>}</For></span>
        </span>
        <Show when={label()}><span class="today-group">{label()}</span></Show>
        <Show when={!rowProps.node.context}><RowMenu task={task()} /></Show>
      </div>
      <For each={rowProps.node.children}>{child => <Row node={child} depth={rowProps.depth + 1} label={false} />}</For>
    </>;
  };

  // Only top tasks with subtasks choose how those show.
  const hasSubtasks = (task: Task) => !ancestors(task, byId()).length && props.items.some(item => item.kind === "task" && item.parentId === task.id);

  const RowMenu = (menuProps: { task: Task }) => {
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
    return <span class="task-menu" ref={root}>
      <button class="icon-button task-menu-button" aria-label={`Actions for ${menuProps.task.title || "Untitled task"}`} aria-haspopup="menu" aria-expanded={open()} onClick={() => setOpen(value => !value)}>⋮</button>
      <Show when={open()}>
        <div class="task-menu-list" role="menu">
          <button role="menuitem" onClick={act(() => props.onEdit(menuProps.task))}>Open details</button>
          <Show when={menuProps.task.state !== "completed"}>
            <Show when={pushed()} fallback={<>
              <button role="menuitem" onClick={act(() => props.onPushDown(menuProps.task, null))}>Push down</button>
              <button role="menuitem" onClick={act(() => props.onPushDown(menuProps.task, tomorrow()))}>Push down until tomorrow</button>
            </>}>
              <button role="menuitem" onClick={act(() => props.onLift(menuProps.task))}>Lift back up</button>
            </Show>
          </Show>
          <Show when={hasSubtasks(menuProps.task)}>
            <Show when={familyMode(menuProps.task, props.subtaskMode) === "context"} fallback={<button role="menuitem" onClick={act(() => props.onSubtaskLayout(menuProps.task, props.subtaskMode === "context" ? null : "spread"))}>Spread subtasks out</button>}>
              <button role="menuitem" onClick={act(() => props.onSubtaskLayout(menuProps.task, props.subtaskMode === "nested" ? null : "together"))}>Keep subtasks together</button>
            </Show>
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
    if (await props.onAddTask(filter && filter !== "none" ? filter : null, title, props.scope === "anytime" ? { anytime: true } : {})) setDraft(value => value.trim() === title ? "" : value);
  };

  const heading = () => props.scope === "today" ? "Today" : props.scope === "upcoming" ? "Upcoming" : "Anytime";
  return <section class="panel today-panel">
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
      <h1>{heading()}</h1>
      <span class="today-date">{props.now.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })} · {clock(props.now)}</span>
      <span class="spacer" />
      <label class="today-subtasks" title={"Keep together: each task with subtasks shows once, in the section of its most urgent subtask, with the rest dimmed.\nSpread out: every subtask shows in its own section, under a dimmed row for its parent.\nA task's ⋮ menu can choose differently for its own subtasks."}>
        <span>Subtasks</span>
        <select aria-label="How subtasks show" value={props.subtaskMode} onChange={event => props.onSubtaskModeChange(event.currentTarget.value as SubtaskMode)}>
          <option value="nested">Keep together</option>
          <option value="context">Spread out</option>
        </select>
      </label>
      <label class="check-row"><input type="checkbox" checked={props.showCompleted} onChange={event => props.onShowCompletedChange(event.currentTarget.checked)} />Show completed</label>
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
      <input placeholder={props.scope === "anytime" ? "Add an anytime task" : "Add a task"} aria-label="Add a task" value={draft()} onInput={event => setDraft(event.currentTarget.value)} />
    </form>
    <Show when={sections().length} fallback={<p class="today-empty">{props.query ? "No tasks match your search." : props.scope === "today" ? "Nothing needs you right now." : "Nothing here."}</p>}>
      <For each={sections()}>{section =>
        <section class="today-section" data-section={section.id}>
          <button class="today-section-heading" aria-expanded={!isCollapsed(section.id)} disabled={props.scope !== "today"} onClick={() => toggleSection(section.id)}>
            <Show when={props.scope === "today"}><span class="section-chevron" aria-hidden="true">›</span></Show>
            <strong>{SECTION_LABELS[section.id].title}</strong>
            <span class="section-count">{section.count}</span>
            <Show when={SECTION_LABELS[section.id].hint}><span class="today-hint">{SECTION_LABELS[section.id].hint}</span></Show>
          </button>
          <Show when={!isCollapsed(section.id)}>
            <div class="today-rows">
              <For each={grouped(section)}>{bucket => <>
                <Show when={bucket.title}><div class="today-group-heading">{bucket.title}</div></Show>
                <For each={bucket.trees}>{tree => <Row node={tree} depth={0} label />}</For>
              </>}</For>
            </div>
          </Show>
        </section>}
      </For>
    </Show>
  </section>;
}

const Segmented = <T extends string>(props: { label: string; value: T; options: [T, string][]; onChange: (value: T) => void }) =>
  <span class="today-toggle" role="group" aria-label={props.label}><span>{props.label}</span>
    <For each={props.options}>{([value, text]) => <button type="button" aria-pressed={props.value === value} onClick={() => props.onChange(value)}>{text}</button>}</For>
  </span>;

/** The prototype's layout switches, shown in the top bar while comparing designs. */
export function DesignToggles(props: {
  groupLayout: GroupLayout; onGroupLayoutChange: (value: GroupLayout) => void;
  laterPlacement: LaterPlacement; onLaterPlacementChange: (value: LaterPlacement) => void;
}) {
  return <div class="design-toggles" aria-label="Layout options">
    <Segmented label="Groups" value={props.groupLayout} options={[["labels", "Labels"], ["headings", "Headings"]]} onChange={props.onGroupLayoutChange} />
    <Segmented label="Upcoming/Anytime" value={props.laterPlacement} options={[["below", "Below Today"], ["separate", "Separate"]]} onChange={props.onLaterPlacementChange} />
  </div>;
}
