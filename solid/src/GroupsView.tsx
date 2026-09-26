import { For, Index, Show, createEffect, createMemo, createSignal, onCleanup, onMount, type JSX } from "solid-js";
import { formatDateTime, isSleeping, sleepInfo } from "../../site/domain.js";
import { groupDescendants } from "../../site/task-tree.js";
import { Icon } from "./Icon";
import { BUILTIN_GROUPS, boardColumns, boardEntries, buildBoard, nestList, flattenGroupNodes, groupOptions, type BoardTarget, type GroupNode, type TaskNode } from "./group-board";
import { planTasks } from "./task-planning";
import { RELATIVE_DATE_FIELDS, isDormant } from "./dependencies";
import type { Group, Item, Task } from "./types";

export type GroupsViewProps = {
  items: Item[];
  query: string;
  now: Date;
  selectedId: string | null;
  showCompleted: boolean;
  onShowCompletedChange: (value: boolean) => void;
  compact: boolean;
  onCompactChange: (value: boolean) => void;
  onPatchTask: (task: Task, patch: Partial<Pick<Task, "title" | "notes">>) => Promise<void>;
  onEdit: (task: Task) => void;
  onComplete: (task: Task) => Promise<void>;
  onAddTask: (groupId: string | null, title: string) => Promise<boolean>;
  onCreateGroup: (parentId: string | null) => Promise<string | null>;
  onRenameGroup: (group: Group, title: string) => Promise<void>;
  onMoveGroup: (group: Group, parentId: string | null) => Promise<void>;
  onReorderGroup: (group: Group, offset: -1 | 1) => Promise<void>;
  onDeleteGroup: (group: Group) => Promise<void>;
  onPlaceGroup: (id: string, target: BoardTarget) => Promise<void>;
  onStartDependent: (task: Task, completeParent: boolean) => Promise<void>;
  onDeleteTask: (task: Task) => Promise<void>;
  onSleepTask: (task: Task) => Promise<void>;
  onWakeTask: (task: Task) => Promise<void>;
  respectSleep: boolean;
};

// The character offset under a click within an element's text, so editing can start there.
function clickedOffset(event: MouseEvent, element: Element) {
  const position = document.caretPositionFromPoint?.(event.clientX, event.clientY);
  if (position && element.contains(position.offsetNode)) return position.offset;
  const range = document.caretRangeFromPoint?.(event.clientX, event.clientY);
  return range && element.contains(range.startContainer) ? range.startOffset : undefined;
}

/** Tasks shown in a list, counting subtasks. */
const countTasks = (nodes: TaskNode[]): number => nodes.reduce((total, node) => total + 1 + countTasks(node.children), 0);

function textMatches(task: Task, query: string) {
  const needle = query.trim().toLowerCase();
  return !needle || [task.title, task.notes || "", ...(task.tags || [])].some(value => value.toLowerCase().includes(needle));
}

export function GroupsView(props: GroupsViewProps) {
  const board = createMemo(() => buildBoard(props.items, task => (props.showCompleted || task.state !== "completed") && textMatches(task, props.query)));
  // Components are keyed by id so inputs keep focus and drafts when the board is rebuilt.
  const groupsById = createMemo(() => flattenGroupNodes(board().groups));
  const columns = createMemo(() => boardColumns(boardEntries(props.items)));
  // Built-in groups list tasks by availability, across every group.
  const itemsById = createMemo(() => new Map(props.items.map(item => [item.id, item])));
  const smart = createMemo(() => {
    // Dependent tasks that haven't been started are left out until they are.
    const tasks = props.items.filter((item): item is Task => item.kind === "task" && item.state !== "completed" && !isDormant(item, itemsById()) && textMatches(item, props.query));
    const plan = planTasks(tasks, props.now, props.respectSleep, "start", null);
    const flat = (rows: { task: Task }[]): TaskNode[] => nestList(rows.map(row => row.task), props.items);
    return {
      available: flat(plan.now),
      upcoming: flat(plan.upcoming.filter(row => !isSleeping(row.task, props.now))),
      sleeping: flat(plan.upcoming.filter(row => isSleeping(row.task, props.now))),
    };
  });
  const [startPrompt, setStartPrompt] = createSignal<{ owner: Task; dependents: Task[] } | null>(null);
  // Dragging a top-level group shows where it can go: between groups in a column, or as a new column.
  const [dragId, setDragId] = createSignal<string | null>(null);
  const [dropKey, setDropKey] = createSignal("");
  const targets = new Map<string, () => BoardTarget>();
  let boardRef!: HTMLDivElement;
  const dropTarget = (key: string, target: () => BoardTarget, class_: string) => {
    targets.set(key, target);
    return <div class={class_} data-drop={key} classList={{ active: !!dragId() && dropKey() === key }} />;
  };
  // Pointer-based so it works with touch as well as a mouse.
  const startGroupDrag = (id: string) => (event: PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture(event.pointerId);
    setDragId(id);
    const move = (next: PointerEvent) => {
      const edge = boardRef.getBoundingClientRect();
      if (next.clientX > edge.right - 40) boardRef.scrollLeft += 16; else if (next.clientX < edge.left + 40) boardRef.scrollLeft -= 16;
      const hit = document.elementFromPoint(next.clientX, next.clientY);
      const well = hit?.closest<HTMLElement>("[data-drop]")?.dataset.drop;
      // Over another group, its left or right half means a new column on that side.
      const entry = well ? null : hit?.closest<HTMLElement>("[data-board-entry]");
      if (entry && entry.dataset.boardEntry !== id) {
        const box = entry.getBoundingClientRect(), column = Number(entry.dataset.column);
        setDropKey(`new-${next.clientX < box.left + box.width / 2 ? column : column + 1}`);
      } else setDropKey(well || "");
    };
    const end = (drop: boolean) => () => {
      handle.removeEventListener("pointermove", move);
      const key = dropKey(), target = targets.get(key);
      setDragId(null); setDropKey("");
      if (drop && key && target) void props.onPlaceGroup(id, target());
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end(true), { once: true });
    handle.addEventListener("pointercancel", end(false), { once: true });
  };
  const focusGroupTitle = (id: string | null) => {
    if (id) setTimeout(() => { const input = document.querySelector<HTMLInputElement>(`[data-group-title="${CSS.escape(id)}"]`); input?.focus(); input?.select(); });
  };

  // Textareas that replace a task's title and description while they are edited, sized to their whole text.
  const InlineText = (inlineProps: { value: string; multiline: boolean; label: string; class: string; placeholder?: string; autofocus: boolean; caret?: number; ref: (element: HTMLTextAreaElement) => void; onFinish: (commit: boolean) => void }) => {
    let ref!: HTMLTextAreaElement;
    const fit = () => { ref.style.height = "auto"; ref.style.height = `${ref.scrollHeight}px`; };
    const onInput = () => {
      // Titles are one line: pasted line breaks become spaces.
      if (!inlineProps.multiline && /[\r\n]/.test(ref.value)) {
        const caret = ref.selectionStart;
        ref.value = ref.value.replace(/\r\n?|\n/g, " ");
        ref.setSelectionRange(caret, caret);
      }
      fit();
    };
    onMount(() => { fit(); if (inlineProps.autofocus) { const caret = Math.min(inlineProps.caret ?? ref.value.length, ref.value.length); ref.focus(); ref.setSelectionRange(caret, caret); } });
    return <textarea ref={element => { ref = element; inlineProps.ref(element); }} class={`board-inline ${inlineProps.class}`} aria-label={inlineProps.label} placeholder={inlineProps.placeholder} rows={1} value={inlineProps.value} onInput={onInput}
      onKeyDown={event => {
        if (event.key === "Escape") { event.preventDefault(); inlineProps.onFinish(false); }
        else if (event.key === "Enter" && (!inlineProps.multiline || event.ctrlKey || event.metaKey)) { event.preventDefault(); inlineProps.onFinish(true); }
      }} />;
  };

  const TaskRow = (rowProps: { node: TaskNode; depth: number }): JSX.Element => {
    const task = () => rowProps.node.task;
    const dormant = () => isDormant(task(), itemsById());
    const parent = () => itemsById().get(task().dependentOf || "") as Task | undefined;
    // Completing a task that has unstarted dependent tasks offers to start one of them.
    const complete = async () => {
      const dependents = props.items.filter((item): item is Task => item.kind === "task" && item.dependentOf === task().id);
      const owner = task();
      await props.onComplete(owner);
      if (dependents.length) setStartPrompt({ owner, dependents });
    };
    // Clicking the title or description edits both in place; the session ends when focus leaves them.
    const [editing, setEditing] = createSignal<"title" | "notes" | null>(null);
    let titleField: HTMLTextAreaElement | undefined, notesField: HTMLTextAreaElement | undefined, clickEndedEdit = false;
    const meta = () => {
      const parts: string[] = [];
      const sleep = sleepInfo(task(), props.now);
      if (sleep.sleeping) parts.push(sleep.indefinite ? "Sleeping" : `Sleeping until ${formatDateTime(sleep.until)}`);
      // A dependent task's relative dates only become real dates when it is started.
      const labels = { availableFrom: "Can start", latestStart: "Start by", deadline: "Due" } as const;
      if (dormant()) for (const field of RELATIVE_DATE_FIELDS) {
        const days = task().relativeDates?.[field];
        if (days != null) parts.push(`${labels[field]} ${days}d after starting`);
      }
      if (task().deadline) parts.push(`Due ${formatDateTime(task().deadline)}`);
      return parts.join(" · ");
    };
    const finish = (commit: boolean) => {
      if (!editing()) return;
      const title = titleField?.value.trim() ?? "", notes = notesField?.value ?? "";
      setEditing(null);
      if (!commit) return;
      const patch: Partial<Pick<Task, "title" | "notes">> = {};
      if (title && title !== task().title) patch.title = title;
      if (notes !== (task().notes || "")) patch.notes = notes;
      if (Object.keys(patch).length) void props.onPatchTask(task(), patch);
    };
    let caret: number | undefined;
    const edit = (field: "title" | "notes") => (event: MouseEvent) => {
      event.stopPropagation();
      caret = field === "title" && !task().title ? 0 : clickedOffset(event, event.currentTarget as Element);
      setEditing(field);
    };
    return <>
      <div class="board-task" classList={{ selected: props.selectedId === task().id, done: task().state === "completed", dormant: dormant() }} style={{ "padding-left": `${rowProps.depth * 16 + 6}px` }} data-task-card="true" data-id={task().id} tabIndex={-1}
        onMouseDown={() => { clickEndedEdit = !!editing(); }}
        onClick={event => {
          if (clickEndedEdit) { clickEndedEdit = false; return; }
          if (!(event.target instanceof Element && event.target.closest("button, textarea, .board-text"))) props.onEdit(task());
        }}>
        <Show when={!dormant()} fallback={<span class="dormant-indicator" title="Not started" aria-hidden="true" />}>
          <Show when={task().state !== "completed"} fallback={<span class="complete-indicator" aria-hidden="true">✓</span>}>
            <button class="complete-button" aria-label={`Complete ${task().title}`} onClick={() => void complete()} />
          </Show>
        </Show>
        <span class="board-task-copy">
          <Show when={editing()} fallback={<>
            <div class="board-task-title"><span class="board-text" onClick={edit("title")}>{task().title || "Untitled task"}</span></div>
            <Show when={task().notes}><div class="board-task-notes"><span class="board-text" onClick={edit("notes")}>{task().notes}</span></div></Show>
          </>}>
            <div class="board-edit" onFocusOut={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) finish(true); }}>
              <InlineText class="board-task-title" label="Task title" multiline={false} value={task().title} autofocus={editing() === "title"} caret={caret} ref={element => { titleField = element; }} onFinish={finish} />
              <InlineText class="board-task-notes" label="Task description" placeholder="Add description" multiline value={task().notes || ""} autofocus={editing() === "notes"} caret={caret} ref={element => { notesField = element; }} onFinish={finish} />
            </div>
          </Show>
          <Show when={meta()}><small>{meta()}</small></Show>
          <Show when={dormant()}>
            <span class="dependent-actions">
              <button class="text-button" onClick={() => void props.onStartDependent(task(), false)}>Start</button>
              <Show when={parent()?.state !== "completed"}>
                <button class="text-button" title={`Start this and complete “${parent()?.title || "Untitled task"}”`} onClick={() => void props.onStartDependent(task(), true)}>Start & complete <span class="parent-name">{parent()?.title}</span></button>
              </Show>
            </span>
          </Show>
        </span>
        <TaskMenu task={task()} dormant={dormant()} parent={parent()} />
      </div>
      <TaskList nodes={rowProps.node.children} depth={rowProps.depth + 1} />
      <Show when={rowProps.node.dependents.length}>
        <div class="board-then" style={{ "margin-left": `${(rowProps.depth + 1) * 16 + 6}px` }}>Dependent tasks</div>
        <TaskList nodes={rowProps.node.dependents} depth={rowProps.depth + 1} />
      </Show>
    </>;
  };

  // The ⋮ menu on each task row.
  const TaskMenu = (menuProps: { task: Task; dormant: boolean; parent?: Task }) => {
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
    const sleeping = () => sleepInfo(menuProps.task, props.now).sleeping;
    return <span class="task-menu" ref={root}>
      <button class="icon-button task-menu-button" aria-label={`Actions for ${menuProps.task.title || "Untitled task"}`} aria-haspopup="menu" aria-expanded={open()} onClick={() => setOpen(value => !value)}>⋮</button>
      <Show when={open()}>
        <div class="task-menu-list" role="menu">
          <button role="menuitem" onClick={act(() => props.onEdit(menuProps.task))}>Open details</button>
          <Show when={menuProps.dormant}>
            <button role="menuitem" onClick={act(() => props.onStartDependent(menuProps.task, false))}>Start</button>
            <Show when={menuProps.parent && menuProps.parent.state !== "completed"}><button role="menuitem" onClick={act(() => props.onStartDependent(menuProps.task, true))}>Start & complete “{menuProps.parent?.title}”</button></Show>
          </Show>
          <Show when={menuProps.task.state !== "completed" && !menuProps.dormant}>
            <Show when={sleeping()} fallback={<button role="menuitem" onClick={act(() => props.onSleepTask(menuProps.task))}>Sleep until tomorrow</button>}>
              <button role="menuitem" onClick={act(() => props.onWakeTask(menuProps.task))}>Wake</button>
            </Show>
          </Show>
          <button role="menuitem" class="danger-text" onClick={act(() => props.onDeleteTask(menuProps.task))}>Delete</button>
        </div>
      </Show>
    </span>;
  };

  const TaskList = (listProps: { nodes: TaskNode[]; depth: number }): JSX.Element => {
    const byId = createMemo(() => new Map(listProps.nodes.map(node => [node.task.id, node])));
    return <For each={listProps.nodes.map(node => node.task.id)}>{id => <Show when={byId().get(id)}>{node => <TaskRow node={node()} depth={listProps.depth} />}</Show>}</For>;
  };

  const AddTask = (addProps: { groupId: string | null }) => {
    const [draft, setDraft] = createSignal("");
    const submit = async () => {
      const title = draft().trim();
      if (title && await props.onAddTask(addProps.groupId, title)) setDraft(value => value.trim() === title ? "" : value);
    };
    return <form class="board-add" onSubmit={event => { event.preventDefault(); void submit(); }}>
      <Icon name="plus" size={14} />
      <input placeholder="Add task" aria-label="Add task" value={draft()} onInput={event => setDraft(event.currentTarget.value)} />
    </form>;
  };

  const GroupSection = (sectionProps: { id: string; depth: number; siblings: string[] }): JSX.Element => {
    const node = () => groupsById().get(sectionProps.id) as GroupNode;
    const group = () => node().group;
    let titleInput!: HTMLInputElement;
    const title = createMemo(() => group().title);
    // The name field is as wide as its text so the count can sit right after it.
    const [shownTitle, setShownTitle] = createSignal(group().title);
    createEffect(() => { const value = title(); if (document.activeElement !== titleInput) { titleInput.value = value; setShownTitle(value); } });
    const [collapsed, setCollapsed] = createSignal(false);
    const [tools, setTools] = createSignal(false);
    const index = () => sectionProps.siblings.indexOf(sectionProps.id);
    const parentChoices = createMemo(() => groupOptions(props.items, new Set([group().id, ...groupDescendants(props.items, group().id).map((child: Group) => child.id)])));
    const parentLabel = (id: string) => { const option = parentChoices().find(choice => choice.group.id === id); return option ? `${"— ".repeat(option.depth)}${option.group.title}` : ""; };
    const rename = (input: HTMLInputElement) => {
      const title = input.value.trim();
      if (!title) { input.value = group().title; return; }
      if (title !== group().title) void props.onRenameGroup(group(), title);
    };
    return <section class="board-group" classList={{ nested: sectionProps.depth > 0, dragging: dragId() === sectionProps.id }}>
      <Show when={!sectionProps.depth}><DragGrip id={group().id} /></Show>
      <header class="board-group-header">
        <button class="icon-button board-collapse" aria-label={collapsed() ? "Expand group" : "Collapse group"} aria-expanded={!collapsed()} onClick={() => setCollapsed(value => !value)}>{collapsed() ? "›" : "⌄"}</button>
        <span class="title-fit" data-value={shownTitle()}><input ref={titleInput} size={1} class="board-group-title" data-group-title={group().id} aria-label="Group name" onInput={event => setShownTitle(event.currentTarget.value)}
          onChange={event => rename(event.currentTarget)} onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") { event.currentTarget.value = group().title; setShownTitle(group().title); event.currentTarget.blur(); } }} /></span>
        <span class="board-count" title="Tasks in this group">{countTasks(node().tasks)}</span>
        <span class="header-spacer" />
        <Show when={sectionProps.depth}>
          <button class="icon-button" aria-label="Move up" title="Move up" disabled={index() <= 0} onClick={() => void props.onReorderGroup(group(), -1)}>↑</button>
          <button class="icon-button" aria-label="Move down" title="Move down" disabled={index() >= sectionProps.siblings.length - 1} onClick={() => void props.onReorderGroup(group(), 1)}>↓</button>
        </Show>
        <button class="icon-button" aria-label="Group options" aria-expanded={tools()} onClick={() => setTools(value => !value)}>⋯</button>
      </header>
      <Show when={tools()}>
        <div class="board-group-tools">
          <button class="text-button" onClick={async () => { setCollapsed(false); focusGroupTitle(await props.onCreateGroup(group().id)); }}>+ Subgroup</button>
          <label>Inside <select value={group().parentId || ""} onChange={event => void props.onMoveGroup(group(), event.currentTarget.value || null)}>
            <option value="">Top level</option>
            <For each={parentChoices().map(option => option.group.id)}>{id => <option value={id}>{parentLabel(id)}</option>}</For>
          </select></label>
          <button class="text-button danger-text" onClick={() => void props.onDeleteGroup(group())}>Delete</button>
        </div>
      </Show>
      <Show when={!collapsed()}>
        <TaskList nodes={node().tasks} depth={0} />
        <AddTask groupId={group().id} />
        <GroupList nodes={node().groups} depth={sectionProps.depth + 1} />
      </Show>
    </section>;
  };

  const GroupList = (listProps: { nodes: GroupNode[]; depth: number }): JSX.Element => {
    const ids = createMemo(() => listProps.nodes.map(node => node.group.id));
    return <For each={ids()}>{id => <Show when={groupsById().has(id)}><GroupSection id={id} depth={listProps.depth} siblings={ids()} /></Show>}</For>;
  };

  // The strip across the top of a top-level group is its drag handle.
  const DragGrip = (gripProps: { id: string }) => <div class="board-grip" title="Drag to move" aria-hidden="true" onPointerDown={startGroupDrag(gripProps.id)}><span /></div>;

  // Built-in sections: availability lists across all groups, and tasks without a group.
  const BuiltinSection = (sectionProps: { id: string }) => {
    const spec = BUILTIN_GROUPS.find(entry => entry.id === sectionProps.id)!;
    const empty = { available: "Nothing is available right now.", upcoming: "Nothing is waiting to start.", sleeping: "No sleeping tasks.", ungrouped: "" }[spec.builtin];
    const nodes = () => spec.builtin === "ungrouped" ? board().ungrouped : smart()[spec.builtin];
    return <section class="board-group smart-group" classList={{ dragging: dragId() === spec.id }}>
      <DragGrip id={spec.id} />
      <header class="board-group-header"><h2>{spec.title}</h2><span class="board-count">{countTasks(nodes())}</span></header>
      <Show when={nodes().length || !empty} fallback={<p class="board-empty">{empty}</p>}><TaskList nodes={nodes()} depth={0} /></Show>
      <Show when={spec.builtin === "ungrouped"}><AddTask groupId={null} /></Show>
    </section>;
  };

  return <section class="panel groups-panel">
    <Show when={startPrompt()}>{prompt =>
      <div class="start-prompt" role="status">
        <span>Completed “{prompt().owner.title || "Untitled task"}”. Start a dependent task?</span>
        <div>
          <For each={prompt().dependents}>{dependent => <button class="secondary-button" onClick={() => { setStartPrompt(null); void props.onStartDependent(dependent, false); }}>{dependent.title || "Untitled task"}</button>}</For>
          <button class="text-button" onClick={() => setStartPrompt(null)}>Not now</button>
        </div>
      </div>}
    </Show>
    <div class="groups-toolbar">
      <h1>Groups</h1>
      <button class={`secondary-button density-toggle ${props.compact ? "active" : ""}`} aria-pressed={props.compact} onClick={() => props.onCompactChange(!props.compact)}><Icon name="compact" size={15} />Compact</button>
      <label class="check-row"><input type="checkbox" checked={props.showCompleted} onChange={event => props.onShowCompletedChange(event.currentTarget.checked)} />Show completed</label>
      <button class="secondary-button" onClick={async () => focusGroupTitle(await props.onCreateGroup(null))}><Icon name="plus" size={15} />New group</button>
    </div>
    <div ref={boardRef} class="board" classList={{ compact: props.compact, "drag-active": !!dragId() }}>
      {dropTarget("new-0", () => ({ newColumn: 0 }), "board-drop-column")}
      <Index each={columns()}>{(column, columnIndex) => <>
        <div class="board-column">
          {dropTarget(`in-${columnIndex}-0`, () => ({ column: columnIndex, index: 0 }), "board-drop-slot")}
          <For each={column()}>{(id, position) => <>
            <div class="board-entry" data-board-entry={id} data-column={columnIndex}>
              <Show when={groupsById().has(id)} fallback={<Show when={BUILTIN_GROUPS.some(entry => entry.id === id)}><BuiltinSection id={id} /></Show>}><GroupSection id={id} depth={0} siblings={column()} /></Show>
            </div>
            {dropTarget(`in-${columnIndex}-${id}`, () => ({ column: columnIndex, index: position() + 1 }), "board-drop-slot")}
          </>}</For>
        </div>
        {dropTarget(`new-${columnIndex + 1}`, () => ({ newColumn: columnIndex + 1 }), "board-drop-column")}
      </>}</Index>
    </div>
  </section>;
}
