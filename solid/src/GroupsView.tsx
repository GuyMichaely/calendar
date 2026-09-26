import { For, Show, createEffect, createMemo, createSignal, onMount, type JSX } from "solid-js";
import { formatDateTime, sleepInfo } from "../../site/domain.js";
import { groupDescendants } from "../../site/task-tree.js";
import { Icon } from "./Icon";
import { buildBoard, flattenGroupNodes, groupOptions, type GroupNode, type TaskNode } from "./group-board";
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
};

function textMatches(task: Task, query: string) {
  const needle = query.trim().toLowerCase();
  return !needle || [task.title, task.notes || "", ...(task.tags || [])].some(value => value.toLowerCase().includes(needle));
}

export function GroupsView(props: GroupsViewProps) {
  const board = createMemo(() => buildBoard(props.items, task => (props.showCompleted || task.state !== "completed") && textMatches(task, props.query)));
  // Components are keyed by id so inputs keep focus and drafts when the board is rebuilt.
  const groupsById = createMemo(() => flattenGroupNodes(board().groups));
  const focusGroupTitle = (id: string | null) => {
    if (id) setTimeout(() => { const input = document.querySelector<HTMLInputElement>(`[data-group-title="${CSS.escape(id)}"]`); input?.focus(); input?.select(); });
  };

  // A textarea that replaces a title or description while it is edited, sized to its whole text.
  const InlineText = (inlineProps: { value: string; multiline: boolean; label: string; class: string; onCommit: (value: string) => void; onCancel: () => void }) => {
    let ref!: HTMLTextAreaElement, done = false;
    const fit = () => { ref.style.height = "auto"; ref.style.height = `${ref.scrollHeight}px`; };
    const finish = (commit: boolean) => { if (done) return; done = true; if (commit) inlineProps.onCommit(ref.value); else inlineProps.onCancel(); };
    onMount(() => { fit(); ref.focus(); ref.setSelectionRange(ref.value.length, ref.value.length); });
    return <textarea ref={ref} class={`board-inline ${inlineProps.class}`} aria-label={inlineProps.label} rows={1} value={inlineProps.value} onInput={fit}
      onClick={event => event.stopPropagation()} onBlur={() => finish(true)}
      onKeyDown={event => {
        if (event.key === "Escape") { event.preventDefault(); finish(false); }
        else if (event.key === "Enter" && (!inlineProps.multiline || event.ctrlKey || event.metaKey)) { event.preventDefault(); finish(true); }
      }} />;
  };

  const TaskRow = (rowProps: { node: TaskNode; depth: number }): JSX.Element => {
    const task = () => rowProps.node.task;
    const [editing, setEditing] = createSignal<"title" | "notes" | null>(null);
    const meta = () => {
      const parts: string[] = [];
      const sleep = sleepInfo(task(), props.now);
      if (sleep.sleeping) parts.push(sleep.indefinite ? "Sleeping" : `Sleeping until ${formatDateTime(sleep.until)}`);
      if (task().deadline) parts.push(`Due ${formatDateTime(task().deadline)}`);
      return parts.join(" · ");
    };
    const edit = (field: "title" | "notes") => (event: MouseEvent) => { event.stopPropagation(); setEditing(field); };
    const save = (field: "title" | "notes", raw: string) => {
      setEditing(null);
      const value = field === "title" ? raw.trim() : raw;
      if (field === "title" && !value) return;
      if (value !== (task()[field] || "")) void props.onPatchTask(task(), { [field]: value });
    };
    return <>
      <div class="board-task" classList={{ selected: props.selectedId === task().id, done: task().state === "completed" }} style={{ "padding-left": `${rowProps.depth * 16 + 6}px` }} data-task-card="true" data-id={task().id} tabIndex={-1}
        onClick={event => { if (!(event.target instanceof Element && event.target.closest("button, textarea"))) props.onEdit(task()); }}>
        <Show when={task().state !== "completed"} fallback={<span class="complete-indicator" aria-hidden="true">✓</span>}>
          <button class="complete-button" aria-label={`Complete ${task().title}`} onClick={() => void props.onComplete(task())} />
        </Show>
        <span class="board-task-copy">
          <Show when={editing() === "title"} fallback={<span class="board-task-title" title="Click to rename" onClick={edit("title")}>{task().title || "Untitled task"}</span>}>
            <InlineText class="board-task-title" label="Task title" multiline={false} value={task().title} onCommit={value => save("title", value)} onCancel={() => setEditing(null)} />
          </Show>
          <Show when={task().notes || editing() === "notes"}>
            <Show when={editing() === "notes"} fallback={<span class="board-task-notes" title="Click to edit" onClick={edit("notes")}>{task().notes}</span>}>
              <InlineText class="board-task-notes" label="Task description" multiline value={task().notes || ""} onCommit={value => save("notes", value)} onCancel={() => setEditing(null)} />
            </Show>
          </Show>
          <Show when={meta()}><small>{meta()}</small></Show>
        </span>
      </div>
      <TaskList nodes={rowProps.node.children} depth={rowProps.depth + 1} />
    </>;
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
    createEffect(() => { const value = title(); if (document.activeElement !== titleInput) titleInput.value = value; });
    const [collapsed, setCollapsed] = createSignal(false);
    const [tools, setTools] = createSignal(false);
    const index = () => sectionProps.siblings.indexOf(sectionProps.id);
    const earlier = sectionProps.depth ? "↑" : "←", later = sectionProps.depth ? "↓" : "→";
    const parentChoices = createMemo(() => groupOptions(props.items, new Set([group().id, ...groupDescendants(props.items, group().id).map((child: Group) => child.id)])));
    const parentLabel = (id: string) => { const option = parentChoices().find(choice => choice.group.id === id); return option ? `${"— ".repeat(option.depth)}${option.group.title}` : ""; };
    const rename = (input: HTMLInputElement) => {
      const title = input.value.trim();
      if (!title) { input.value = group().title; return; }
      if (title !== group().title) void props.onRenameGroup(group(), title);
    };
    return <section class="board-group" classList={{ nested: sectionProps.depth > 0 }}>
      <header class="board-group-header">
        <button class="icon-button board-collapse" aria-label={collapsed() ? "Expand group" : "Collapse group"} aria-expanded={!collapsed()} onClick={() => setCollapsed(value => !value)}>{collapsed() ? "›" : "⌄"}</button>
        <input ref={titleInput} class="board-group-title" data-group-title={group().id} aria-label="Group name"
          onChange={event => rename(event.currentTarget)} onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") { event.currentTarget.value = group().title; event.currentTarget.blur(); } }} />
        <button class="icon-button" aria-label="Move earlier" title="Move earlier" disabled={index() <= 0} onClick={() => void props.onReorderGroup(group(), -1)}>{earlier}</button>
        <button class="icon-button" aria-label="Move later" title="Move later" disabled={index() >= sectionProps.siblings.length - 1} onClick={() => void props.onReorderGroup(group(), 1)}>{later}</button>
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

  return <section class="panel groups-panel">
    <div class="groups-toolbar">
      <h1>Groups</h1>
      <button class={`secondary-button density-toggle ${props.compact ? "active" : ""}`} aria-pressed={props.compact} onClick={() => props.onCompactChange(!props.compact)}><Icon name="compact" size={15} />Compact</button>
      <label class="check-row"><input type="checkbox" checked={props.showCompleted} onChange={event => props.onShowCompletedChange(event.currentTarget.checked)} />Show completed</label>
      <button class="secondary-button" onClick={async () => focusGroupTitle(await props.onCreateGroup(null))}><Icon name="plus" size={15} />New group</button>
    </div>
    <div class="board" classList={{ compact: props.compact }}>
      <div class="board-column">
        <section class="board-group">
          <header class="board-group-header"><h2>No group</h2></header>
          <TaskList nodes={board().ungrouped} depth={0} />
          <AddTask groupId={null} />
        </section>
      </div>
      <For each={board().groups.map(node => node.group.id)}>{id =>
        <div class="board-column"><Show when={groupsById().has(id)}><GroupSection id={id} depth={0} siblings={board().groups.map(node => node.group.id)} /></Show></div>}
      </For>
    </div>
  </section>;
}
