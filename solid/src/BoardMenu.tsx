import { Show, createEffect, createSignal, onCleanup } from "solid-js";
import { boardTasks } from "./boards";
import type { Group, Item } from "./types";

/*
 * A board's ⋮ menu: rename it (where its name isn't already a field), and delete it,
 * either with its tasks or leaving them on no board. Either is one undo step.
 */
export function BoardMenu(props: {
  board: Group;
  items: Item[];
  onRename?: () => void;
  onDelete: (board: Group, withTasks: boolean) => Promise<unknown>;
}) {
  const [open, setOpen] = createSignal(false);
  let root!: HTMLSpanElement;
  createEffect(() => {
    if (!open()) return;
    const outside = (event: PointerEvent) => { if (!root.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); root.querySelector("button")?.focus(); } };
    document.addEventListener("pointerdown", outside, true); document.addEventListener("keydown", escape, true);
    onCleanup(() => { document.removeEventListener("pointerdown", outside, true); document.removeEventListener("keydown", escape, true); });
  });
  const act = (run: () => unknown) => () => { setOpen(false); void run(); };
  // What deleting with tasks takes: its open tasks, with their subtasks and the tasks waiting on them.
  const doomed = () => boardTasks(props.items, props.board);
  const deletes = () => `Also deletes its ${doomed().length} task${doomed().length === 1 ? "" : "s"}`;
  return <span class="task-menu board-menu" ref={root}>
    <button type="button" class="icon-button task-menu-button" aria-label={`Actions for ${props.board.title || "board"}`} aria-haspopup="menu" aria-expanded={open()} onClick={() => setOpen(value => !value)}>⋮</button>
    <Show when={open()}>
      <div class="task-menu-list" role="menu">
        <Show when={props.onRename}>{rename => <button role="menuitem" onClick={act(rename())}>Rename</button>}</Show>
        <Show when={doomed().length} fallback={<button role="menuitem" class="danger-text" onClick={act(() => props.onDelete(props.board, false))}>Delete board</button>}>
          <button role="menuitem" class="danger-text" title={deletes()} onClick={act(() => props.onDelete(props.board, true))}>Delete board</button>
          <button role="menuitem" class="danger-text" title="Its tasks stay, on no board" onClick={act(() => props.onDelete(props.board, false))}>Delete board (keep tasks)</button>
        </Show>
      </div>
    </Show>
  </span>;
}
