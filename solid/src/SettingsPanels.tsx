import { For, Show, createMemo, createSignal } from "solid-js";
import { WEEKDAYS, describeSchedule } from "./windows";
import { allTimeZones, calendarZone, deviceZone, formatIn, isTimeZone, partsOf, zonedDate } from "./zone";
import type { CalendarSettings, Item, TimeWindow } from "./types";

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
    <p class="field-hint">A window is when tasks can be done, like business hours. Tasks pick one by name; List shows them as closing or opening today.</p>
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

/**
 * The calendar's one time zone. Changing it asks whether dates keep their exact moments
 * (and so show at other clock times) or keep their clock times (and so move).
 */
export function TimeZoneSettings(props: {
  settings: CalendarSettings | undefined;
  items: Item[];
  now: Date;
  onChange: (timeZone: string, keepClock: boolean) => Promise<unknown>;
  onCreate: (timeZone: string) => Promise<unknown>;
}) {
  const [draft, setDraft] = createSignal("");
  const zones = allTimeZones();
  const current = () => props.settings?.timeZone ?? calendarZone();
  const chosen = () => { const value = draft().trim(); return value && value !== current() && isTimeZone(value) ? value : null; };
  const dated = createMemo(() => props.items.filter(item => item.kind === "task" ? !!(item.availableFrom || item.deadline || item.pushedDown?.until || item.repeat?.until) : item.kind === "event").length);
  const sample = () => zonedDate(partsOf(props.now).year, partsOf(props.now).month, partsOf(props.now).day, 9, 0);
  const apply = async (keepClock: boolean) => {
    const zone = chosen();
    if (!zone) return;
    if (props.settings) await props.onChange(zone, keepClock); else await props.onCreate(zone);
    setDraft("");
  };
  return <section class="time-zone-settings" aria-label="Time zone">
    <p class="field-hint">Every device shows this calendar in one time zone: window hours, “today”, repeats, and every date and time are read in it, wherever you are.</p>
    <div class="field">
      <span>Calendar time zone</span>
      <strong>{current().replace(/_/g, " ")} <small class="muted">· now {formatIn(props.now, { hour: "numeric", minute: "2-digit", timeZoneName: "short" })}</small></strong>
      <Show when={!props.settings}><small class="field-hint">Not saved yet: this device's zone is used until it is.</small></Show>
      <Show when={deviceZone() !== current()}><small class="field-hint">This device is set to {deviceZone().replace(/_/g, " ")}.</small></Show>
    </div>
    <label class="field">
      <span>Change to</span>
      <input list="time-zone-list" placeholder="Search, e.g. Europe/London" value={draft()} onInput={event => setDraft(event.currentTarget.value)} />
      <datalist id="time-zone-list"><For each={zones}>{zone => <option value={zone} />}</For></datalist>
    </label>
    <Show when={draft().trim() && !chosen() && draft().trim() !== current()}><small class="field-hint">Pick a time zone from the list.</small></Show>
    <Show when={chosen()}>{zone =>
      <div class="time-zone-choice">
        <p>What should happen to the {dated()} tasks and events with dates?</p>
        <button type="button" class="secondary-button" onClick={() => void apply(false)}>
          <strong>Keep the exact moments</strong>
          <small>Today's 9:00 AM shows as {formatIn(sample(), { hour: "numeric", minute: "2-digit" }, zone())} in {zone().replace(/_/g, " ")}. Nothing moves.</small>
        </button>
        <button type="button" class="secondary-button" onClick={() => void apply(true)}>
          <strong>Keep the clock times</strong>
          <small>9:00 AM stays 9:00 AM in {zone().replace(/_/g, " ")}, so dates move. For when you move there.</small>
        </button>
        <small class="field-hint">Window hours stay as they are, read in the new zone. Either way is one undo step.</small>
      </div>}
    </Show>
  </section>;
}
