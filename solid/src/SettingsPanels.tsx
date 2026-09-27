import { For, Show, createMemo } from "solid-js";
import { groupOptions } from "./group-board";
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
    <p class="field-hint">A window is when tasks can be done, like business hours. Tasks pick one by name; Today lists them as closing or opening today.</p>
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

/** Groups form a tree; tasks are filed under one from their editor. */
export function GroupSettings(props: {
  items: Item[];
  onCreate: () => Promise<unknown>;
  onRename: (group: Group, title: string) => Promise<unknown>;
  onMove: (group: Group, parentId: string | null) => Promise<unknown>;
  onDelete: (group: Group) => Promise<unknown>;
}) {
  const options = createMemo(() => groupOptions(props.items));
  // A group can't move into itself or its own subgroups.
  const inside = (group: Group) => {
    const ids = new Set([group.id]);
    for (const option of options()) if (option.group.parentId && ids.has(option.group.parentId)) ids.add(option.group.id);
    return ids;
  };
  return <section class="group-settings" aria-label="Groups">
    <p class="field-hint">Groups file tasks by project. Today can show them as labels or headings, and filter to one.</p>
    <For each={options()}>{option =>
      <div class="group-editor" style={{ "padding-left": `${option.depth * 18}px` }}>
        <input aria-label="Group name" value={option.group.title} onChange={event => { const title = event.currentTarget.value.trim(); if (title && title !== option.group.title) void props.onRename(option.group, title); else event.currentTarget.value = option.group.title; }} />
        <select aria-label={`Parent of ${option.group.title}`} value={option.group.parentId || ""} onChange={event => void props.onMove(option.group, event.currentTarget.value || null)}>
          <option value="">Top level</option>
          <For each={options().filter(entry => !inside(option.group).has(entry.group.id))}>{entry => <option value={entry.group.id}>In {"— ".repeat(entry.depth)}{entry.group.title}</option>}</For>
        </select>
        <button type="button" class="text-button danger-text" title="Its tasks and subgroups move up a level" onClick={() => void props.onDelete(option.group)}>Delete</button>
      </div>}
    </For>
    <button type="button" class="secondary-button" onClick={() => void props.onCreate()}>+ New group</button>
  </section>;
}
