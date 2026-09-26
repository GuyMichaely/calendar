import { For, Index, Show, createEffect, createMemo, createSignal, onCleanup, onMount, type JSX } from "solid-js";
import { formatDateTime, isSleeping, sleepInfo } from "../../site/domain.js";
import { taskDescendants } from "../../site/task-tree.js";
import { Icon } from "./Icon";
import { renderNotes } from "./markdown";
import { BUILTIN_GROUPS, boardColumns, boardEntries, buildBoard, nestList, flattenGroupNodes, type BoardTarget, type GroupNode, type TaskNode } from "./group-board";
import { planTasks } from "./task-planning";
import { RELATIVE_DATE_FIELDS, isDormant } from "./dependencies";
import type { Group, Item, Task } from "./types";

export type TaskDrop =
  | { kind: "inside"; parent: Task }
  | { kind: "before" | "after"; ref: Task }
  | { kind: "group"; groupId: string | null }
  | { kind: "dependent"; owner: Task };

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
  onDropTask: (task: Task, drop: TaskDrop) => Promise<unknown>;
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
  // Dragging a group shows where it can go: between groups in a column, as a new
  // column, or inside another group (nestId) — the ghost follows the pointer.
  const [dragId, setDragId] = createSignal<string | null>(null);
  const [dropKey, setDropKey] = createSignal("");
  const [nestId, setNestId] = createSignal("");
  const targets = new Map<string, () => BoardTarget>();
  let boardRef!: HTMLDivElement;
  const dropTarget = (key: string, target: () => BoardTarget, class_: string) => {
    targets.set(key, target);
    return <div class={class_} data-drop={key} classList={{ active: !!dragId() && dropKey() === key }} />;
  };
  // Pointer-based so it works with touch as well as a mouse. The dragged group follows
  // the pointer as a fixed ghost while wells expand to preview where it would land.
  const startGroupDrag = (id: string) => (event: PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture(event.pointerId);
    setDragId(id);
    // A fixed clone tracks the pointer; the original stays ghosted in place.
    const section = handle.closest<HTMLElement>(".board-group");
    const ghost = section ? (section.cloneNode(true) as HTMLElement) : null;
    const startX = event.clientX, startY = event.clientY;
    if (section && ghost) {
      const rect = section.getBoundingClientRect();
      ghost.classList.remove("dragging");
      ghost.classList.add("board-group-ghost");
      Object.assign(ghost.style, { position: "fixed", left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, maxHeight: "60vh", overflow: "hidden", margin: "0", zIndex: "60" });
      document.body.appendChild(ghost);
      boardRef.style.setProperty("--drop-h", `${rect.height}px`);
      boardRef.style.setProperty("--drop-w", `${rect.width}px`);
    }
    // A group can't be dropped into itself or its own subgroups.
    const node = groupsById().get(id);
    const excluded = new Set(node ? [id, ...flattenGroupNodes(node.groups).keys()] : [id]);
    // A rAF loop drives the drag: pointermove events stop when a held finger is
    // stationary, so edge scrolling and drop-target tracking run every frame.
    let lastX = startX, lastY = startY, frame = 0;
    const update = () => {
      if (ghost) ghost.style.transform = `translate(${lastX - startX}px, ${lastY - startY}px)`;
      const edge = boardRef.getBoundingClientRect();
      const EDGE = 56;
      const leftDepth = edge.left + EDGE - lastX, rightDepth = lastX - (edge.right - EDGE);
      if (rightDepth > 0) boardRef.scrollLeft += Math.min(28, 4 + rightDepth * 0.4);
      else if (leftDepth > 0) boardRef.scrollLeft -= Math.min(28, 4 + leftDepth * 0.4);
      const hit = document.elementFromPoint(lastX, lastY);
      const well = hit?.closest<HTMLElement>("[data-drop]")?.dataset.drop;
      let key = well || "", nest = "";
      if (!well) {
        const host = hit?.closest<HTMLElement>(".board-group:not(.smart-group)");
        const hostId = host?.dataset.groupId || "";
        if (host && !excluded.has(hostId)) {
          const top = !host.parentElement?.closest(".board-group");
          const entry = top ? host.closest<HTMLElement>("[data-board-entry]") : null;
          if (entry) {
            const box = host.getBoundingClientRect();
            const relX = (lastX - box.left) / box.width;
            const column = Number(entry.dataset.column);
            // Over a top-level group's outer thirds it becomes a new column on that
            // side; the middle nests inside it. Built-in sections can't nest, so
            // only the halves-to-columns rule applies to them.
            const edgeShare = node ? 0.3 : 0.5;
            if (relX < edgeShare) key = `new-${column}`;
            else if (relX > 1 - edgeShare) key = `new-${column + 1}`;
            else nest = hostId;
          } else if (node) nest = hostId; // Nested hosts: dropping nests inside.
        } else if (!host) {
          // Over an entry's empty margin, the same halves-to-column rule applies.
          const entry = hit?.closest<HTMLElement>("[data-board-entry]");
          if (entry && entry.dataset.boardEntry !== id) {
            const box = entry.getBoundingClientRect(), column = Number(entry.dataset.column);
            key = `new-${lastX < box.left + box.width / 2 ? column : column + 1}`;
          }
        }
      }
      setDropKey(key); setNestId(nest);
      frame = requestAnimationFrame(update);
    };
    const move = (next: PointerEvent) => { lastX = next.clientX; lastY = next.clientY; };
    const end = (drop: boolean) => () => {
      cancelAnimationFrame(frame);
      ghost?.remove();
      boardRef.style.removeProperty("--drop-h");
      boardRef.style.removeProperty("--drop-w");
      handle.removeEventListener("pointermove", move);
      const key = dropKey(), nest = nestId(), target = targets.get(key);
      setDragId(null); setDropKey(""); setNestId("");
      if (!drop) return;
      const dragged = groupsById().get(id)?.group;
      if (nest) { if (dragged) void props.onMoveGroup(dragged, nest); }
      else if (key && target) void props.onPlaceGroup(id, target());
    };
    frame = requestAnimationFrame(update);
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end(true), { once: true });
    handle.addEventListener("pointercancel", end(false), { once: true });
  };

  // Task dragging: a grip on each card undocks it; dropping onto another card nests
  // it as a subtask (middle), orders as a sibling (top/bottom edge), or re-groups it.
  const [taskDragId, setTaskDragId] = createSignal<string | null>(null);
  const [taskDrop, setTaskDrop] = createSignal<{ kind: "before" | "after" | "inside" | "group" | "dependent"; id: string | null } | null>(null);
  const taskDropId = () => taskDrop()?.id;
  const startTaskDrag = (id: string, event: PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget as HTMLElement;
    const card = handle.closest<HTMLElement>("[data-task-card]");
    handle.setPointerCapture(event.pointerId);
    setTaskDragId(id);
    // A rAF loop drives the drag; pointermove stops when a held finger is stationary.
    let lastX = event.clientX, lastY = event.clientY, frame = 0;
    const ghost = card ? (card.cloneNode(true) as HTMLElement) : null;
    const startX = event.clientX, startY = event.clientY;
    if (card && ghost) {
      const rect = card.getBoundingClientRect();
      ghost.classList.remove("drop-inside", "drop-before", "drop-after");
      ghost.classList.add("task-ghost");
      Object.assign(ghost.style, { position: "fixed", left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, maxHeight: "72px", overflow: "hidden", margin: "0", zIndex: "60" });
      document.body.appendChild(ghost);
    }
    const byId = itemsById();
    const dragged = byId.get(id) as Task | undefined;
    // A task can't be dropped onto itself or its own subtasks.
    const excluded = new Set([id, ...taskDescendants(props.items, id).map(task => task.id)]);
    const update = () => {
      if (ghost) ghost.style.transform = `translate(${lastX - startX}px, ${lastY - startY}px)`;
      const edge = boardRef.getBoundingClientRect();
      const EDGE = 56;
      const leftDepth = edge.left + EDGE - lastX, rightDepth = lastX - (edge.right - EDGE);
      if (rightDepth > 0) boardRef.scrollLeft += Math.min(28, 4 + rightDepth * 0.4);
      else if (leftDepth > 0) boardRef.scrollLeft -= Math.min(28, 4 + leftDepth * 0.4);
      if (lastY > innerHeight - 48) window.scrollBy(0, Math.min(24, 4 + (lastY - (innerHeight - 48)) * 0.3));
      else if (lastY < 104) window.scrollBy(0, -Math.min(24, 4 + (104 - lastY) * 0.3));
      const hit = document.elementFromPoint(lastX, lastY);
      let drop: { kind: "before" | "after" | "inside" | "group" | "dependent"; id: string | null } | null = null;
      const hostCard = hit?.closest<HTMLElement>("[data-task-card]");
      if (hostCard && !excluded.has(hostCard.dataset.id || "")) {
        if (!hostCard.classList.contains("dormant")) {
          const box = hostCard.getBoundingClientRect();
          const relY = (lastY - box.top) / box.height;
          drop = { kind: relY < 0.28 ? "before" : relY > 0.72 ? "after" : "inside", id: hostCard.dataset.id || null };
        }
      } else if (!hostCard) {
        // The open editor's Subtasks/Dependent-tasks areas accept drops onto the
        // edited task itself (never its rows, which aren't task cards here).
        const zone = hit?.closest<HTMLElement>("[data-task-drop-zone]");
        const zoneTask = zone?.dataset.taskId || "";
        if (zone && zoneTask && !excluded.has(zoneTask) && byId.has(zoneTask)) {
          drop = { kind: zone.dataset.taskDropZone === "dependents" ? "dependent" : "inside", id: zoneTask };
        } else {
          const section = hit?.closest<HTMLElement>(".board-group");
          if (section?.classList.contains("smart-group")) {
            if (section.dataset.builtin === "ungrouped") drop = { kind: "group", id: null };
          } else if (section?.dataset.groupId) drop = { kind: "group", id: section.dataset.groupId };
        }
      }
      // Highlight the editor zone under the pointer, if any.
      document.querySelectorAll(".zone-target").forEach(element => element.classList.remove("zone-target"));
      if (drop?.kind === "dependent" || (drop?.kind === "inside" && hit?.closest("[data-task-drop-zone]"))) {
        hit?.closest("[data-task-drop-zone]")?.classList.add("zone-target");
      }
      setTaskDrop(drop);
      frame = requestAnimationFrame(update);
    };
    const move = (next: PointerEvent) => { lastX = next.clientX; lastY = next.clientY; };
    const end = (dropIt: boolean) => () => {
      cancelAnimationFrame(frame);
      ghost?.remove();
      document.querySelectorAll(".zone-target").forEach(element => element.classList.remove("zone-target"));
      handle.removeEventListener("pointermove", move);
      const drop = taskDrop();
      setTaskDragId(null); setTaskDrop(null);
      if (!dropIt || !drop || !dragged) return;
      if (drop.kind === "group") void props.onDropTask(dragged, { kind: "group", groupId: drop.id });
      else {
        const ref = byId.get(drop.id || "") as Task | undefined;
        if (!ref) return;
        void props.onDropTask(dragged, drop.kind === "inside" ? { kind: "inside", parent: ref }
          : drop.kind === "dependent" ? { kind: "dependent", owner: ref }
          : { kind: drop.kind, ref });
      }
    };
    frame = requestAnimationFrame(update);
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end(true), { once: true });
    handle.addEventListener("pointercancel", end(false), { once: true });
  };
  const focusGroupTitle = (id: string | null) => {
    if (id) setTimeout(() => { const input = document.querySelector<HTMLInputElement>(`[data-group-title="${CSS.escape(id)}"]`); input?.focus(); input?.select(); });
  };

  // A task open in the beside-the-board editor should stay visible: the pane shrinks
  // the board's width, which can push the card out of view. Remember the exact card
  // that was clicked (a task can appear in several sections) and scroll to it.
  let openedCard: HTMLElement | null = null;
  let scrolledFor: string | null = null;
  createEffect(() => {
    const id = props.selectedId;
    if (!id) { scrolledFor = null; return; }
    if (id === scrolledFor) return;
    scrolledFor = id;
    requestAnimationFrame(() => {
      const card = openedCard?.isConnected && openedCard.dataset.id === id
        ? openedCard
        : document.querySelector<HTMLElement>(`[data-task-card][data-id="${CSS.escape(id)}"]`);
      card?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    });
  });

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
    // Status chips under a task: sleep, dormant relative dates, can-start, and due.
    const chips = () => {
      const result: { label: string; kind: "sleep" | "relative" | "waiting" | "due" }[] = [];
      const sleep = sleepInfo(task(), props.now);
      if (sleep.sleeping) result.push({ label: sleep.indefinite ? "Sleeping" : `Sleeping until ${formatDateTime(sleep.until)}`, kind: "sleep" });
      // A dependent task's relative dates only become real dates when it is started.
      const labels = { availableFrom: "Can start", latestStart: "Start by", deadline: "Due" } as const;
      if (dormant()) for (const field of RELATIVE_DATE_FIELDS) {
        const days = task().relativeDates?.[field];
        if (days != null) result.push({ label: `${labels[field]} ${days}d after starting`, kind: "relative" });
      } else if (task().availableFrom && new Date(task().availableFrom as string) > props.now) {
        result.push({ label: `Can start ${formatDateTime(task().availableFrom)}`, kind: "waiting" });
      }
      if (task().deadline) result.push({ label: `Due ${formatDateTime(task().deadline)}`, kind: "due" });
      return result;
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
      <div class="board-task" classList={{ selected: props.selectedId === task().id, done: task().state === "completed", dormant: dormant(), "task-dragging": taskDragId() === task().id, "drop-inside": taskDrop()?.kind === "inside" && taskDropId() === task().id, "drop-before": taskDrop()?.kind === "before" && taskDropId() === task().id, "drop-after": taskDrop()?.kind === "after" && taskDropId() === task().id }} style={{ "padding-left": `${rowProps.depth * 16 + 6}px` }} data-task-card="true" data-id={task().id} tabIndex={-1}
        onMouseDown={() => { clickEndedEdit = !!editing(); }}
        onClick={event => {
          if (clickEndedEdit) { clickEndedEdit = false; return; }
          if (!(event.target instanceof Element && event.target.closest("button, textarea, .board-text"))) { openedCard = event.currentTarget as HTMLElement; props.onEdit(task()); }
        }}>
        <Show when={!dormant()}><div class="task-grip" title="Drag to move" aria-hidden="true" onPointerDown={event => startTaskDrag(task().id, event)} /></Show>
        <Show when={!dormant()} fallback={<span class="dormant-indicator" title="Not started" aria-hidden="true" />}>
          <Show when={task().state !== "completed"} fallback={<span class="complete-indicator" aria-hidden="true">✓</span>}>
            <button class="complete-button" aria-label={`Complete ${task().title}`} onClick={() => void complete()} />
          </Show>
        </Show>
        <span class="board-task-copy">
          <Show when={editing()} fallback={<>
            <div class="board-task-title"><span class="board-text" onClick={edit("title")}>{task().title || "Untitled task"}</span></div>
            <Show when={task().notes}>{notes => <div class="board-task-notes markdown-notes"><span class="board-text" innerHTML={renderNotes(notes())} onClick={event => {
              const link = event.target instanceof Element ? event.target.closest("a") : null;
              if (link) {
                // Attachment links have no real URL; opening the task shows its attachments.
                if (link.dataset.attachmentId) { event.preventDefault(); props.onEdit(task()); }
                return;
              }
              edit("notes")(event);
            }} /></div>}</Show>
          </>}>
            <div class="board-edit" onFocusOut={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) finish(true); }}>
              <InlineText class="board-task-title" label="Task title" multiline={false} value={task().title} autofocus={editing() === "title"} caret={caret} ref={element => { titleField = element; }} onFinish={finish} />
              <InlineText class="board-task-notes" label="Task description" placeholder="Add description" multiline value={task().notes || ""} autofocus={editing() === "notes"} caret={caret} ref={element => { notesField = element; }} onFinish={finish} />
            </div>
          </Show>
          <Show when={chips().length}>
            <span class="board-chips"><For each={chips()}>{chip => <span class={`board-chip ${chip.kind}`}>{chip.label}</span>}</For></span>
          </Show>
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
    // A subtask (one with a task parent) can become a dependent task of that parent.
    const subtaskParent = () => {
      const parent = itemsById().get(menuProps.task.parentId || "");
      return parent?.kind === "task" ? parent as Task : null;
    };
    return <span class="task-menu" ref={root}>
      <button class="icon-button task-menu-button" aria-label={`Actions for ${menuProps.task.title || "Untitled task"}`} aria-haspopup="menu" aria-expanded={open()} onClick={() => setOpen(value => !value)}>⋮</button>
      <Show when={open()}>
        <div class="task-menu-list" role="menu">
          <button role="menuitem" onClick={act(() => { openedCard = root.closest(".board-task"); props.onEdit(menuProps.task); })}>Open details</button>
          <Show when={!menuProps.dormant && subtaskParent()}>
            <button role="menuitem" onClick={act(() => props.onDropTask(menuProps.task, { kind: "dependent", owner: subtaskParent()! }))}>Make dependent of “{subtaskParent()?.title}”</button>
          </Show>
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
    // The ⋯ button opens a small dropdown menu; groups are organized by dragging instead.
    const [menu, setMenu] = createSignal(false);
    let menuRoot!: HTMLSpanElement;
    createEffect(() => {
      if (!menu()) return;
      const outside = (event: PointerEvent) => { if (!menuRoot.contains(event.target as Node)) setMenu(false); };
      const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); setMenu(false); } };
      document.addEventListener("pointerdown", outside, true); document.addEventListener("keydown", escape, true);
      onCleanup(() => { document.removeEventListener("pointerdown", outside, true); document.removeEventListener("keydown", escape, true); });
    });
    const index = () => sectionProps.siblings.indexOf(sectionProps.id);
    const rename = (input: HTMLInputElement) => {
      const title = input.value.trim();
      if (!title) { input.value = group().title; return; }
      if (title !== group().title) void props.onRenameGroup(group(), title);
    };
    return <section class="board-group" data-group-id={group().id} classList={{ nested: sectionProps.depth > 0, dragging: dragId() === sectionProps.id, "nest-target": !!dragId() && nestId() === sectionProps.id, "drop-group": taskDrop()?.kind === "group" && taskDropId() === sectionProps.id }}>
      <DragGrip id={group().id} />
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
        <span class="task-menu" ref={menuRoot}>
          <button class="icon-button" aria-label="Group options" aria-haspopup="menu" aria-expanded={menu()} onClick={() => setMenu(value => !value)}>⋯</button>
          <Show when={menu()}>
            <div class="task-menu-list" role="menu">
              <button role="menuitem" class="danger-text" onClick={() => { setMenu(false); void props.onDeleteGroup(group()); }}>Delete group</button>
            </div>
          </Show>
        </span>
      </header>
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

  // The strip across the top of a group is its drag handle, at any depth.
  const DragGrip = (gripProps: { id: string }) => <div class="board-grip" title="Drag to move" aria-hidden="true" onPointerDown={startGroupDrag(gripProps.id)}><span /></div>;

  // Built-in sections: availability lists across all groups, and tasks without a group.
  const BuiltinSection = (sectionProps: { id: string }) => {
    const spec = BUILTIN_GROUPS.find(entry => entry.id === sectionProps.id)!;
    const empty = { available: "Nothing is available right now.", upcoming: "Nothing is waiting to start.", sleeping: "No sleeping tasks.", ungrouped: "" }[spec.builtin];
    const nodes = () => spec.builtin === "ungrouped" ? board().ungrouped : smart()[spec.builtin];
    return <section class="board-group smart-group" data-builtin={spec.builtin} classList={{ dragging: dragId() === spec.id, "drop-group": taskDrop()?.kind === "group" && taskDropId() === null && spec.builtin === "ungrouped" }}>
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
    <div ref={boardRef} class="board" classList={{ compact: props.compact, "drag-active": !!dragId(), "task-dragging": !!taskDragId() }}>
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
