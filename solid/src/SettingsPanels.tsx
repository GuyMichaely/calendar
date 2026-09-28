import { For, Show, createMemo } from "solid-js";
import { userBoards } from "./board-order";
import { WEEKDAYS, describeSchedule } from "./windows";
import type { Group, Item, TimeWindow } from "./types";

type WindowFields = Pick<TimeWindow, "title" | "days" | "start" | "end">;

/** Named windows tasks can be done in. Editing one changes every task that uses it. */
export function WindowSettings(props: {
  items: Item[];
  onCreate: (fields: WindowFields) => Promise<unknown>;
  onUpdate: (window: TimeWindow, patch: Partial<WindowFields>) => Promise<unknown>;
  onDelete: (window: TimeWindow) => Promise<unknown>;
}) {
  const windows = createMemo(() => props.items.filter((item): item is TimeWindow => item.kind === "window").sort((a, b) => a.title.localeCompare(b.title)));
  const users = (window: TimeWindow) => props.items.filter(item => item.kind === "task" && item.state !== "completed" && item.windowId === window.id).length;
  return <section class="window-settings" aria-label="Windows">
    <p class="field-hint">A window is when tasks can be done, like business hours. Tasks pick one by name; the Agenda lists them as closing or opening today.</p>
    <For each={windows().map(window => window.id)}>{id => {
      const window = () => windows().find(entry => entry.id === id)!;
      return <Show when={windows().some(entry => entry.id === id)}>
        <div class="window-editor">
          <div class="window-editor-top">
            <input aria-label="Window name" value={window().title} onChange={event => { const title = event.currentTarget.value.trim(); if (title && title !== window().title) void props.onUpdate(window(), { title }); else event.currentTarget.value = window().title; }} />
            <button type="button" class="text-button danger-text" onClick={() => void props.onDelete(window())}>Delete</button>
          </div>
          <div class="window-days" role="group" aria-label="Days">
            <For each={WEEKDAYS}>{(name, day) => <button type="button" aria-pressed={window().days.includes(day())} onClick={() => void props.onUpdate(window(), { days: window().days.includes(day()) ? window().days.filter(entry => entry !== day()) : [...window().days, day()].sort() })}>{name.slice(0, 2)}</button>}</For>
          </div>
          <div class="window-times">
            <label>From <input type="time" value={window().start} onChange={event => { if (event.currentTarget.value) void props.onUpdate(window(), { start: event.currentTarget.value }); }} /></label>
            <label>Until <input type="time" value={window().end} onChange={event => { if (event.currentTarget.value) void props.onUpdate(window(), { end: event.currentTarget.value }); }} /></label>
          </div>
          <small class="field-hint">{describeSchedule(window())} · used by {users(window())} open task{users(window()) === 1 ? "" : "s"}</small>
        </div>
      </Show>;
    }}</For>
    <button type="button" class="secondary-button" onClick={() => void props.onCreate({ title: "New window", days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00" })}>+ New window</button>
  </section>;
}

/** Boards: each task is on at most one, chosen in its editor (subtasks follow their parent's unless set). */
export function BoardSettings(props: {
  items: Item[];
  onCreate: () => Promise<unknown>;
  onRename: (board: Group, title: string) => Promise<unknown>;
  onDelete: (board: Group) => Promise<unknown>;
}) {
  const boards = createMemo(() => userBoards(props.items));
  return <section class="group-settings" aria-label="Boards">
    <p class="field-hint">Boards file tasks by where or how you do them. The Agenda shows every task by urgency with its board's name; the Boards view gives each board a column (drag a column's heading to move it).</p>
    <For each={boards()}>{board =>
      <div class="group-editor">
        <input aria-label="Board name" value={board.title} onChange={event => { const title = event.currentTarget.value.trim(); if (title && title !== board.title) void props.onRename(board, title); else event.currentTarget.value = board.title; }} />
        <button type="button" class="text-button danger-text" title="Its tasks are left on no board" onClick={() => void props.onDelete(board)}>Delete</button>
      </div>}
    </For>
    <button type="button" class="secondary-button" onClick={() => void props.onCreate()}>+ New board</button>
  </section>;
}
