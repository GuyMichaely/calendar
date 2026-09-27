import { For, Index, Show, createEffect, createMemo, createSignal, onCleanup, onMount, type JSX } from "solid-js";
import { formatDateTime, isSleeping, sleepInfo } from "../../site/domain.js";
import { taskDescendants } from "../../site/task-tree.js";
import { Icon } from "./Icon";
import { renderNotes } from "./markdown";
import { BUILTIN_GROUPS, boardColumns, boardEntries, buildBoard, nestList, flattenGroupNodes, placeGroups, sameLayout, type BoardTarget, type GroupNode, type TaskNode } from "./group-board";
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
  onPlaceGroups: (ids: string[], target: BoardTarget) => Promise<unknown>;
  onDropTask: (task: Task, drop: TaskDrop) => Promise<unknown>;
  // Unsaved editor text is overlaid on the card live so everything syncs as you type.
  liveEdits: () => Map<string, Partial<Task>>;
  onLiveEdit: (taskId: string, patch: Partial<Task> | null) => void;
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
  // The dragged group shows a "home" outline over positions that would leave it put.
  const [dropHome, setDropHome] = createSignal(false);
  const targets = new Map<string, () => BoardTarget>();
  let boardRef!: HTMLDivElement;
  const widthKey = "calendar.boardColumnWidths";
  const [widths, setWidths] = createSignal<Record<string, number>>((() => {
    try { const saved = JSON.parse(localStorage.getItem(widthKey) || "{}"); return Object.fromEntries(Object.entries(saved).filter(([, value]) => typeof value === "number" && value >= 220 && value <= 800)) as Record<string, number>; } catch { return {}; }
  })());
  const setWidth = (ids: string[], value: number) => {
    const width = Math.max(220, Math.min(800, value));
    setWidths(previous => ({ ...previous, ...Object.fromEntries(ids.map(id => [id, width])) }));
    try { localStorage.setItem(widthKey, JSON.stringify(widths())); } catch { /* Session resizing still works without storage. */ }
  };
  const resizeColumn = (ids: string[], event: PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    const handle = event.currentTarget as HTMLElement;
    const initial = handle.parentElement!.getBoundingClientRect().width, start = event.clientX;
    handle.setPointerCapture(event.pointerId);
    const move = (next: PointerEvent) => setWidth(ids, initial + next.clientX - start);
    const end = () => { handle.removeEventListener("pointermove", move); handle.removeEventListener("pointerup", end); handle.removeEventListener("pointercancel", end); };
    handle.addEventListener("pointermove", move); handle.addEventListener("pointerup", end); handle.addEventListener("pointercancel", end);
  };

  const dropTarget = (key: string, target: () => BoardTarget, class_: string) => {
    targets.set(key, target);
    return <div class={class_} data-drop={key} classList={{ active: !!dragId() && dropKey() === key }} />;
  };
  // A bar atop each column selects all its groups; a selected group drags the whole set.
  const [columnPick, setColumnPick] = createSignal<string[] | null>(null);
  const toggleColumnPick = (ids: string[]) => setColumnPick(previous => previous && ids.every(id => previous.includes(id)) ? null : ids);
  const pickedColumn = (ids: string[]) => { const pick = columnPick(); return !!ids.length && !!pick && ids.every(id => pick.includes(id)); };
  // Clicking or dragging selects a group or task; Delete removes it, Escape clears.
  const [selection, setSelection] = createSignal<{ type: "group" | "task"; id: string } | null>(null);
  onMount(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setColumnPick(null); setSelection(null); return; }
      if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select, [contenteditable], [role=dialog], [role=menu], .task-detail-pane")) return;
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const current = selection();
      if (current && (event.key.startsWith("Arrow") || event.key === "Enter")) {
        const selector = current.type === "group" ? ".board-group[data-group-id]" : ".board-task";
        const candidates = [...boardRef.querySelectorAll<HTMLElement>(selector)].filter(el => el.getClientRects().length);
        const active = document.activeElement instanceof HTMLElement && document.activeElement.matches(selector) ? document.activeElement : candidates.find(el => (current.type === "group" ? el.dataset.groupId : el.dataset.id) === current.id);
        if (!active) return;
        event.preventDefault();
        const focus = (element?: HTMLElement | null) => {
          if (!element) return;
          element.focus({ preventScroll: true });
          element.scrollIntoView({ block: "nearest", inline: "nearest" });
        };
        const group = active.closest<HTMLElement>(".board-group[data-group-id]");
        // A nested group owns its own tasks; do not jump into it from its parent.
        const groupTasks = group ? [...group.querySelectorAll<HTMLElement>(".board-task")].filter(el => el.getClientRects().length && el.closest(".board-group") === group) : [];
        if (event.key === "Enter") {
          focus(groupTasks[0]);
          return;
        }
        if (current.type === "task" && event.key === "ArrowUp" && active === groupTasks[0]) {
          focus(group);
          return;
        }
        if (current.type === "group" && event.key === "ArrowDown") {
          const columnGroups = [...active.closest(".board-column")!.querySelectorAll<HTMLElement>(".board-group[data-group-id]")].filter(el => el.getClientRects().length);
          if (active === columnGroups.at(-1)) {
            focus(groupTasks.at(-1));
            return;
          }
        }
        const box = active.getBoundingClientRect(), horizontal = ["ArrowLeft", "ArrowRight"].includes(event.key);
        const sign = ["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1;
        const next = candidates.filter(el => el !== active).map(el => {
          const rect = el.getBoundingClientRect();
          const dx = rect.left + rect.width / 2 - box.left - box.width / 2;
          const dy = rect.top + rect.height / 2 - box.top - box.height / 2;
          return { el, along: (horizontal ? dx : dy) * sign, across: Math.abs(horizontal ? dy : dx) };
        }).filter(item => item.along > 1).sort((a,b) => (a.along + a.across * 4) - (b.along + b.across * 4))[0];
        focus(next?.el);
        return;
      }
      if (event.key !== "Delete") return;
      const sel = selection();
      if (!sel) return;
      event.preventDefault();
      setSelection(null);
      if (sel.type === "task") {
        const task = itemsById().get(sel.id);
        if (task?.kind === "task") void props.onDeleteTask(task);
      } else {
        const group = groupsById().get(sel.id)?.group;
        if (group) void props.onDeleteGroup(group);
      }
    };
    document.addEventListener("keydown", onKey);
    onCleanup(() => document.removeEventListener("keydown", onKey));
  });
  const scrollBoardVertically = (y: number, edge: DOMRect) => {
    const before = boardRef.scrollTop;
    if (y > edge.bottom - 48) boardRef.scrollTop += Math.min(24, 4 + (y - edge.bottom + 48) * .3);
    else if (y < edge.top + 48) boardRef.scrollTop -= Math.min(24, 4 + (edge.top + 48 - y) * .3);
    return boardRef.scrollTop - before;
  };
  // Pointer-based so it works with touch as well as a mouse. The dragged group follows
  // the pointer as a fixed ghost while wells expand to preview where it would land.
  const [dragSet, setDragSet] = createSignal<string[]>([]);
  const beginGroupDrag = (id: string, ids: string[], event: PointerEvent, handle: HTMLElement) => {
    handle.setPointerCapture(event.pointerId);
    setDragId(id);
    setDragSet(ids);
    if (groupsById().has(id) && ids.length === 1) setSelection({ type: "group", id });
    const multi = ids.length > 1, moving = new Set(ids);
    const node = groupsById().get(id);
    const canNest = !multi && !!node;
    // What the board looked like at drag start; targets reproducing it are no-ops and
    // don't highlight (the wells straddling the dragged column, an only-group's own
    // column slots, re-nesting at the same spot, …). A subgroup isn't on the board
    // yet, so any board spot moves it.
    const startLayout = boardColumns(boardEntries(props.items));
    const onBoard = new Set(startLayout.flat());
    const targetIsNoop = (key: string) => {
      const resolve = targets.get(key);
      return !!resolve && ids.every(entry => onBoard.has(entry)) && sameLayout(placeGroups(startLayout, ids, resolve()), startLayout);
    };
    // A fixed clone tracks the pointer (the whole column when dragging several);
    // the originals stay ghosted in place.
    const section = multi || !handle.closest(".board-group") ? handle.closest<HTMLElement>(".board-column") : handle.closest<HTMLElement>(".board-group");
    const ghost = section ? (section.cloneNode(true) as HTMLElement) : null;
    const startX = event.clientX, startY = event.clientY;
    if (section && ghost) {
      const rect = section.getBoundingClientRect();
      ghost.querySelectorAll(".dragging").forEach(element => element.classList.remove("dragging"));
      ghost.classList.remove("dragging");
      ghost.classList.add("board-group-ghost");
      Object.assign(ghost.style, { position: "fixed", left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, maxHeight: "60vh", overflow: "hidden", margin: "0", zIndex: "60" });
      document.body.appendChild(ghost);
      boardRef.style.setProperty("--drop-h", `${Math.min(rect.height, innerHeight * 0.6)}px`);
      boardRef.style.setProperty("--drop-w", `${rect.width}px`);
    }
    // A group can't be dropped into itself or its (or a dragged sibling's) subgroups.
    const excluded = new Set(ids.flatMap(entry => {
      const entryNode = groupsById().get(entry);
      return entryNode ? [entry, ...flattenGroupNodes(entryNode.groups).keys()] : [entry];
    }));
    // A rAF loop drives the drag: pointermove events stop when a held finger is
    // stationary, so edge scrolling runs every frame. The target only re-aims when
    // the pointer moves or the board shifts under it.
    let lastX = startX, lastY = startY, aimX = Infinity, aimY = Infinity, frame = 0;
    // Engaged targets stay put. Opening and closing wells moves things, so the element
    // that defines the current target (the well, or the group under the pointer) is
    // held at the screen spot where it engaged by translating the board's children:
    // sideways all together, vertically just the anchor's own column. Sideways shift
    // is traded for scrolling whenever the board has room; the rest eases back once
    // nothing is anchored in that column (or anywhere, for sideways), and on drop.
    let anchor: { element: HTMLElement; key: string; x: number; y: number; column: HTMLElement | null } | null = null;
    let shiftX = 0;
    const shiftY = new Map<HTMLElement, number>();
    const applyShift = () => {
      for (const child of boardRef.children as HTMLCollectionOf<HTMLElement>) {
        const y = shiftY.get(child) || 0;
        child.style.transform = shiftX || y ? `translate(${shiftX}px, ${y}px)` : "";
      }
    };
    const holdAnchor = () => {
      let moved = false;
      if (anchor?.element.isConnected) {
        const box = anchor.element.getBoundingClientRect();
        const dx = anchor.x - box.left, dy = anchor.y - box.top;
        if (Math.abs(dx) > 0.5) { shiftX += dx; moved = true; }
        if (Math.abs(dy) > 0.5 && anchor.column) { shiftY.set(anchor.column, (shiftY.get(anchor.column) || 0) + dy); moved = true; }
      }
      const ease = (value: number) => Math.abs(value) < 1 ? 0 : value * 0.8;
      for (const [column, y] of shiftY) if (column !== anchor?.column && y) { shiftY.set(column, ease(y)); moved = true; }
      if (!anchor && shiftX) { shiftX = ease(shiftX); moved = true; }
      // Scrolling by the same amount keeps everything where it is on screen.
      if (shiftX) {
        const before = boardRef.scrollLeft;
        boardRef.scrollLeft = before - shiftX;
        shiftX -= before - boardRef.scrollLeft;
        if (Math.abs(shiftX) < 0.5) shiftX = 0;
      }
      applyShift();
      return moved;
    };
    const update = () => {
      const edge = boardRef.getBoundingClientRect();
      const EDGE = 56;
      const preScrollX = boardRef.scrollLeft;
      const leftDepth = edge.left + EDGE - lastX, rightDepth = lastX - (edge.right - EDGE);
      if (rightDepth > 0) boardRef.scrollLeft += Math.min(28, 4 + rightDepth * 0.4);
      else if (leftDepth > 0) boardRef.scrollLeft -= Math.min(28, 4 + leftDepth * 0.4);
      // Deliberate edge scrolling carries the anchor along with the content.
      const scrolled = boardRef.scrollLeft - preScrollX;
      const scrolledY = scrollBoardVertically(lastY, edge);
      if (anchor) { anchor.x -= scrolled; anchor.y -= scrolledY; }
      const shifted = holdAnchor();
      if (ghost) ghost.style.transform = `translate(${lastX - startX}px, ${lastY - startY}px)`;
      if (Math.abs(lastX - aimX) + Math.abs(lastY - aimY) <= 5 && !scrolled && !scrolledY && !shifted) { frame = requestAnimationFrame(update); return; }
      aimX = lastX; aimY = lastY;
      const hit = document.elementFromPoint(lastX, lastY);
      const wellElement = hit?.closest<HTMLElement>("[data-drop]");
      const well = wellElement?.dataset.drop;
      let key = well || "", nest = "", home = false;
      let anchorElement: HTMLElement | null = wellElement || null;
      if (!well) {
        const host = hit?.closest<HTMLElement>(".board-group:not(.smart-group)") || hit?.closest<HTMLElement>(".board-group") || null;
        const hostId = host?.dataset.groupId || "";
        const entry = hit?.closest<HTMLElement>("[data-board-entry]") || null;
        anchorElement = host || entry;
        const builtin = !!host?.classList.contains("smart-group");
        if (host && !builtin && !excluded.has(hostId)) {
          const top = !host.parentElement?.closest(".board-group");
          if (top && entry) {
            const box = host.getBoundingClientRect();
            const relX = (lastX - box.left) / box.width;
            const column = Number(entry.dataset.column);
            // Over a top-level group's outer sixths it becomes a new column on that
            // side; the middle nests inside it (single drags only). Built-in sections
            // can't nest, so only the halves-to-columns rule applies to them.
            const edgeShare = canNest ? 1 / 6 : 0.5;
            if (relX < edgeShare) key = `new-${column}`;
            else if (relX > 1 - edgeShare) key = `new-${column + 1}`;
            else nest = hostId;
          } else if (canNest) nest = hostId; // Nested hosts: dropping nests inside.
        } else if (host && excluded.has(hostId)) {
          // Over the dragged group's own spot. Its top-level group's outer sixths still
          // open new columns, so a subgroup (whose spot fills most of its parent) can
          // leave sideways; anywhere else here drops it where it is.
          const top = entry?.querySelector<HTMLElement>(":scope > .board-group");
          const box = top?.getBoundingClientRect(), column = Number(entry?.dataset.column);
          const relX = box ? (lastX - box.left) / box.width : 0.5;
          if (relX < 1 / 6) key = `new-${column}`;
          else if (relX > 5 / 6) key = `new-${column + 1}`;
          else home = true;
          if (key) anchorElement = top || anchorElement;
        }
        else if (entry && moving.has(entry.dataset.boardEntry || "")) home = true; // Over its own spot.
        else if (entry) {
          // Built-in sections can't nest: their halves pick the column side.
          const box = entry.getBoundingClientRect(), column = Number(entry.dataset.column);
          key = `new-${lastX < box.left + box.width / 2 ? column : column + 1}`;
        }
      }
      // Dropping onto the current parent when already last in it changes nothing.
      if (nest && node?.group.parentId === nest && groupsById().get(nest)?.groups.at(-1)?.group.id === id) { nest = ""; home = true; }
      if (targetIsNoop(key)) { key = ""; home = true; }
      const engaged = key ? `key:${key}` : nest ? `nest:${nest}` : home ? "home" : "";
      if (!engaged || !anchorElement) anchor = null;
      else if (engaged !== anchor?.key) {
        const box = anchorElement.getBoundingClientRect();
        anchor = { element: anchorElement, key: engaged, x: box.left, y: box.top, column: anchorElement.closest<HTMLElement>(".board-column") };
      }
      setDropKey(key); setNestId(nest); setDropHome(home);
      holdAnchor();
      frame = requestAnimationFrame(update);
    };
    const move = (next: PointerEvent) => { lastX = next.clientX; lastY = next.clientY; };
    let live = true;
    const finish = (drop: boolean) => {
      if (!live) return;
      live = false;
      cancelAnimationFrame(frame);
      ghost?.remove();
      boardRef.style.removeProperty("--drop-h");
      boardRef.style.removeProperty("--drop-w");
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", cancel);
      document.removeEventListener("keydown", escape, true);
      const key = dropKey(), nest = nestId(), target = targets.get(key);
      setDragId(null); setDragSet([]); setDropKey(""); setNestId(""); setDropHome(false);
      // Whatever was shifted to hold a target in place slides back.
      const children = [...boardRef.children] as HTMLElement[];
      if (boardRef.closest('[data-animations="on"]') && children.some(child => child.style.transform)) {
        for (const child of children) child.style.transition = "transform .2s ease";
        requestAnimationFrame(() => { for (const child of children) child.style.transform = ""; });
        setTimeout(() => { for (const child of children) child.style.transition = ""; }, 260);
      } else for (const child of children) child.style.transform = "";
      if (!drop) return;
      const dragged = groupsById().get(id)?.group;
      if (nest) { if (dragged) void props.onMoveGroup(dragged, nest); }
      else if (key && target) {
        if (columnPick()?.includes(id)) setColumnPick(null);
        if (multi) void props.onPlaceGroups(ids, target());
        else void props.onPlaceGroup(id, target());
      }
    };
    const up = () => finish(true);
    const cancel = () => finish(false);
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); finish(false); } };
    frame = requestAnimationFrame(update);
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up, { once: true });
    handle.addEventListener("pointercancel", cancel, { once: true });
    document.addEventListener("keydown", escape, true);
  };
  // Dragging a group whose column is selected moves all of them, in board order.
  const startGroupDrag = (id: string) => (event: PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const pick = columnPick();
    const ids = pick && pick.includes(id) ? columns().flat().filter(entry => pick.includes(entry)) : [id];
    beginGroupDrag(id, ids, event, event.currentTarget as HTMLElement);
  };
  // Read the current column at pointerdown: Index preserves the bar while its groups change.
  // Clicking selects its groups; dragging moves the whole column.
  let suppressPickClick = false;
  const pressColumnBar = (ids: string[]) => (event: PointerEvent) => {
    suppressPickClick = false;
    if (event.button !== 0 || !ids.length) return;
    const bar = event.currentTarget as HTMLElement;
    const x0 = event.clientX, y0 = event.clientY;
    const arm = (next: PointerEvent) => {
      if (Math.abs(next.clientX - x0) + Math.abs(next.clientY - y0) <= 6) return;
      disarm();
      suppressPickClick = true;
      beginGroupDrag(ids[0], ids, next, bar);
    };
    const disarm = () => {
      bar.removeEventListener("pointermove", arm);
      bar.removeEventListener("pointerup", disarm);
      bar.removeEventListener("pointercancel", disarm);
    };
    bar.setPointerCapture(event.pointerId);
    bar.addEventListener("pointermove", arm);
    bar.addEventListener("pointerup", disarm, { once: true });
    bar.addEventListener("pointercancel", disarm, { once: true });
  };

  // Task dragging: a grip on each card undocks it, and the whole row starts a drag
  // after a small movement threshold; dropping onto another card nests it as a
  // subtask (middle), orders as a sibling (top/bottom edge), or re-groups it.
  const [taskDragId, setTaskDragId] = createSignal<string | null>(null);
  const [taskDrop, setTaskDrop] = createSignal<{ kind: "before" | "after" | "inside" | "group" | "dependent"; id: string | null } | null>(null);
  const taskDropId = () => taskDrop()?.id;
  // A row drag that engaged must not also count as an open-editor click on release.
  let suppressRowClick = "";
  const beginTaskDrag = (id: string, event: PointerEvent, host?: HTMLElement) => {
    if (host) event.preventDefault();
    const handle = (host || event.currentTarget) as HTMLElement;
    const card = handle.closest<HTMLElement>("[data-task-card]");
    handle.setPointerCapture(event.pointerId);
    setTaskDragId(id);
    setSelection({ type: "task", id });
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
      scrollBoardVertically(lastY, edge);
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
    let live = true;
    const finish = (dropIt: boolean) => {
      if (!live) return;
      live = false;
      cancelAnimationFrame(frame);
      ghost?.remove();
      document.querySelectorAll(".zone-target").forEach(element => element.classList.remove("zone-target"));
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", cancel);
      document.removeEventListener("keydown", escape, true);
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
    const up = () => finish(true);
    const cancel = () => finish(false);
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); finish(false); } };
    frame = requestAnimationFrame(update);
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up, { once: true });
    handle.addEventListener("pointercancel", cancel, { once: true });
    document.addEventListener("keydown", escape, true);
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
  const InlineText = (inlineProps: { onLive?: (value: string) => void; value: string; multiline: boolean; label: string; class: string; placeholder?: string; autofocus: boolean; caret?: number; ref: (element: HTMLTextAreaElement) => void; onFinish: (commit: boolean) => void }) => {
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
      inlineProps.onLive?.(ref.value);
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
    // What's drawn on the card: stored values plus any unsaved editor keystrokes.
    const shown = (): Task => ({ ...task(), ...(props.liveEdits().get(task().id) || {}) });
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
      const sleep = sleepInfo(shown(), props.now);
      if (sleep.sleeping) result.push({ label: sleep.indefinite ? "Sleeping" : `Sleeping until ${formatDateTime(sleep.until)}`, kind: "sleep" });
      // A dependent task's relative dates only become real dates when it is started.
      const labels = { availableFrom: "Can start", latestStart: "Start by", deadline: "Due" } as const;
      if (dormant()) for (const field of RELATIVE_DATE_FIELDS) {
        const days = shown().relativeDates?.[field];
        if (days != null) result.push({ label: `${labels[field]} ${days}d after starting`, kind: "relative" });
      } else if (shown().availableFrom && new Date(shown().availableFrom as string) > props.now) {
        result.push({ label: `Can start ${formatDateTime(shown().availableFrom)}`, kind: "waiting" });
      }
      if (shown().deadline) result.push({ label: `Due ${formatDateTime(shown().deadline)}`, kind: "due" });
      return result;
    };
    const finish = (commit: boolean) => {
      if (!editing()) return;
      const title = titleField?.value.trim() ?? "", notes = notesField?.value ?? "";
      setEditing(null);
      props.onLiveEdit(task().id, null);
      if (!commit) return;
      const patch: Partial<Pick<Task, "title" | "notes">> = {};
      if (title && title !== task().title) patch.title = title;
      if (notes !== (task().notes || "")) patch.notes = notes;
      if (Object.keys(patch).length) void props.onPatchTask(task(), patch);
    };
    let caret: number | undefined;
    const edit = (field: "title" | "notes") => (event: MouseEvent) => {
      event.stopPropagation();
      caret = field === "title" && !shown().title ? 0 : clickedOffset(event, event.currentTarget as Element);
      setEditing(field);
      setSelection({ type: "task", id: task().id });
      // Inline editing comes with the full editor open beside the board.
      openedCard = (event.currentTarget as Element).closest(".board-task") as HTMLElement | null;
      setSelection({ type: "task", id: task().id });
      props.onEdit(task());
    };
    return <>
      <div class="board-task" classList={{ selected: selection()?.type === "task" && selection()?.id === task().id, done: shown().state === "completed", dormant: dormant(), "task-dragging": taskDragId() === task().id, "drop-inside": taskDrop()?.kind === "inside" && taskDropId() === task().id, "drop-before": taskDrop()?.kind === "before" && taskDropId() === task().id, "drop-after": taskDrop()?.kind === "after" && taskDropId() === task().id }} style={{ "margin-left": `${rowProps.depth * 16}px` }} data-task-card="true" data-id={task().id} tabIndex={0} onFocus={event => { if (event.target === event.currentTarget) setSelection({ type: "task", id: task().id }); }}
        onMouseDown={() => { clickEndedEdit = !!editing(); }}
        onPointerDown={event => {
          // The whole card drags: press, then move past a small threshold (mouse only;
          // touch uses the grip so vertical scrolling never fights the drag).
          if (event.button !== 0 || event.pointerType !== "mouse" || dormant()) return;
          if (event.target instanceof Element && event.target.closest("button, textarea, input, select, a, .board-text")) return;
          const card = event.currentTarget as HTMLElement;
          const id = task().id, x0 = event.clientX, y0 = event.clientY;
          card.setPointerCapture(event.pointerId);
          const arm = (next: PointerEvent) => {
            if (Math.abs(next.clientX - x0) + Math.abs(next.clientY - y0) <= 6) return;
            suppressRowClick = id;
            card.removeEventListener("pointermove", arm);
            card.removeEventListener("pointerup", disarm);
            card.removeEventListener("pointercancel", disarm);
            beginTaskDrag(id, next, card);
          };
          const disarm = () => {
            card.removeEventListener("pointermove", arm);
            card.removeEventListener("pointerup", disarm);
            card.removeEventListener("pointercancel", disarm);
          };
          card.addEventListener("pointermove", arm);
          card.addEventListener("pointerup", disarm, { once: true });
          card.addEventListener("pointercancel", disarm, { once: true });
        }}
        onClick={event => {
          if (suppressRowClick === task().id) { suppressRowClick = ""; return; }
          if (clickEndedEdit) { clickEndedEdit = false; return; }
          if (!(event.target instanceof Element && event.target.closest("button, textarea, .board-text"))) { openedCard = event.currentTarget as HTMLElement; setSelection({ type: "task", id: task().id }); props.onEdit(task()); }
        }}>
        <Show when={!dormant()}><div class="task-grip" title="Drag to move" aria-hidden="true" onPointerDown={event => { if (event.button === 0) beginTaskDrag(task().id, event); }} /></Show>
        <Show when={!dormant()} fallback={<span class="dormant-indicator" title="Not started" aria-hidden="true" />}>
          <Show when={task().state !== "completed"} fallback={<span class="complete-indicator" aria-hidden="true">✓</span>}>
            <button class="complete-button" aria-label={`Complete ${task().title}`} onClick={() => void complete()} />
          </Show>
        </Show>
        <span class="board-task-copy">
          <Show when={editing()} fallback={<>
            <div class="board-task-title"><span class="board-text" onClick={edit("title")}>{shown().title}</span></div>
            <Show when={shown().notes}>{notes => <div class="board-task-notes markdown-notes"><span class="board-text" innerHTML={renderNotes(notes())} onClick={event => {
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
              <InlineText class="board-task-title" label="Task title" multiline={false} value={shown().title} autofocus={editing() === "title"} caret={caret} ref={element => { titleField = element; }} onFinish={finish} onLive={value => props.onLiveEdit(task().id, { title: value })} />
              <InlineText class="board-task-notes" label="Task description" placeholder="Add description" multiline value={shown().notes || ""} autofocus={editing() === "notes"} caret={caret} ref={element => { notesField = element; }} onFinish={finish} onLive={value => props.onLiveEdit(task().id, { notes: value })} />
            </div>
          </Show>
          <Show when={chips().length}>
            <span class="board-chips"><For each={chips()}>{chip => <span class={`board-chip ${chip.kind}`}>{chip.label}</span>}</For></span>
          </Show>
          <Show when={dormant()}>
            <span class="dependent-actions">
              <button class="text-button" onClick={() => void props.onStartDependent(task(), false)}>Start</button>
              <Show when={parent()?.state !== "completed"}>
                <button class="text-button" title={`Start this and complete “${parent()?.title || "Untitled task"}”`} onClick={() => void props.onStartDependent(task(), true)}>Start & complete</button>
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
      if (!title) { input.value = group().title; setShownTitle(group().title); return; }
      if (title !== group().title) void props.onRenameGroup(group(), title);
    };
    return <section class="board-group" data-group-id={group().id} tabIndex={0} onFocus={event => { if (event.target === event.currentTarget) setSelection({ type: "group", id: group().id }); }} classList={{ nested: sectionProps.depth > 0, dragging: dragSet().includes(sectionProps.id), "nest-target": !!dragId() && nestId() === sectionProps.id, "drop-home": dropHome() && dragId() === sectionProps.id, "drop-group": taskDrop()?.kind === "group" && taskDropId() === sectionProps.id, "col-picked": !!columnPick()?.includes(sectionProps.id), selected: selection()?.type === "group" && selection()?.id === sectionProps.id }}
      onClick={event => {
        // Clicking a group's own background selects it (controls and tasks inside don't).
        if ((event.target as Element).closest("button, input, select, a, .board-task, .task-menu")) return;
        event.stopPropagation();
        setSelection({ type: "group", id: sectionProps.id });
      }}>
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
        <AddTask groupId={group().id} />
        <TaskList nodes={node().tasks} depth={0} />
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
    return <section class="board-group smart-group" data-builtin={spec.builtin} data-group-id={spec.id} tabIndex={0} onFocus={event => { if (event.target === event.currentTarget) setSelection({ type: "group", id: spec.id }); }} onClick={event => { if (!(event.target as Element).closest("button, input, .board-task")) { event.stopPropagation(); setSelection({ type: "group", id: spec.id }); } }} classList={{ selected: selection()?.type === "group" && selection()?.id === spec.id, dragging: dragSet().includes(spec.id), "drop-home": dropHome() && dragId() === spec.id, "drop-group": taskDrop()?.kind === "group" && taskDropId() === null && spec.builtin === "ungrouped", "col-picked": !!columnPick()?.includes(spec.id) }}>
      <DragGrip id={spec.id} />
      <header class="board-group-header"><h2>{spec.title}</h2><span class="board-count">{countTasks(nodes())}</span></header>
      <Show when={spec.builtin === "ungrouped"}><AddTask groupId={null} /></Show>
      <Show when={nodes().length || !empty} fallback={<p class="board-empty">{empty}</p>}><TaskList nodes={nodes()} depth={0} /></Show>
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
    <div ref={boardRef} class="board" onClick={event => {
      if (!(event.target as Element).closest(".board-group, button, input, .column-resize")) {
        setSelection(null); setColumnPick(null);
        if (document.activeElement instanceof HTMLElement && boardRef.contains(document.activeElement)) document.activeElement.blur();
      }
    }} classList={{ compact: props.compact, "drag-active": !!dragId(), "task-dragging": !!taskDragId() }}>
      {dropTarget("new-0", () => ({ newColumn: 0 }), "board-drop-column")}
      <Index each={columns()}>{(column, columnIndex) => <>
        <div class="board-column" style={{ "flex-basis": widths()[column()[0]] ? `${widths()[column()[0]]}px` : undefined }}>
          <div class="column-resize" role="separator" aria-label={`Resize column ${columnIndex + 1}`} aria-orientation="vertical" aria-valuemin={220} aria-valuemax={800} aria-valuenow={widths()[column()[0]] || 290} tabIndex={0} onPointerDown={event => resizeColumn([...column()], event)} onKeyDown={event => {
            if (["ArrowLeft", "ArrowRight"].includes(event.key)) { event.preventDefault(); event.stopPropagation(); setWidth(column(), (widths()[column()[0]] || event.currentTarget.parentElement!.getBoundingClientRect().width) + (event.key === "ArrowRight" ? 20 : -20)); }
          }} />
          <button class="column-pick" aria-pressed={pickedColumn(column())} aria-label={`Select all groups in column ${columnIndex + 1}`} title="Click to select all groups in this column, or drag to move the whole column (Escape clears)" onPointerDown={event => pressColumnBar([...column()])(event)} onClick={() => { if (suppressPickClick) { suppressPickClick = false; return; } toggleColumnPick(column()); }} />
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
