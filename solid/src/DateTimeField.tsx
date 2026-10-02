import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { formatDateTimeShort, formatDateTimeText, parseDateTimeText } from "./datetime-text";
import { addDays, formatIn, fromInputValue as fromLocalValue, partsOf, sameDay as sameZoneDay, toInputValue as toLocalValue, zonedDate } from "./zone";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const sameDay = (a: Date | null, b: Date) => !!a && sameZoneDay(a, b);
// The first of a moment's month (in the calendar's time zone), or a month before or after it.
const monthOf = (date: Date, offset = 0) => { const { year, month } = partsOf(date); return zonedDate(year, month + offset, 1); };

/**
 * A date and time picker: a calendar, an optional time (midnight, or 11:59 PM for due dates, unless set), and an editable text version
 * above them. The value is a hidden "YYYY-MM-DDTHH:mm" input, the same as a datetime-local field.
 */
export function DateTimeField(props: { name: string; label: string; value: string; disabled?: boolean; placeholder?: string; onChange: (value: string) => void }) {
  const [value, setValue] = createSignal(props.value || "");
  createEffect(() => setValue(props.value || ""));
  const defaultTime = (): [number, number] => props.name === "deadline" ? [23, 59] : [0, 0];
  const [hasTime, setHasTime] = createSignal(false);
  const displayText = (date: Date) => hasTime() ? formatDateTimeText(date) : formatDateTimeText(date).split(" ")[0];
  const [open, setOpen] = createSignal(false);
  const [draft, setDraft] = createSignal<Date | null>(null);
  const [month, setMonth] = createSignal(monthOf(new Date()));
  const [text, setText] = createSignal("");
  const [textValid, setTextValid] = createSignal(true);
  const [position, setPosition] = createSignal<{ top: number; left: number } | null>(null);
  // Placed against the window, not the panel, so a narrow panel never clips it; phones use a bottom sheet.
  const place = () => {
    if (matchMedia("(max-width: 760px)").matches) { setPosition(null); return; }
    const field = root.getBoundingClientRect(), width = 284, height = 400;
    const below = field.bottom + 4 + height <= innerHeight;
    setPosition({ top: below ? field.bottom + 4 : Math.max(8, field.top - height - 4), left: Math.min(Math.max(8, field.left), innerWidth - width - 8) });
  };
  let root!: HTMLDivElement;

  const show = () => {
    const current = fromLocalValue(value());
    setDraft(current);
    setHasTime(!!current && (partsOf(current).hour !== defaultTime()[0] || partsOf(current).minute !== defaultTime()[1]));
    setText(current ? displayText(current) : "");
    setTextValid(true);
    const base = current || new Date();
    setMonth(monthOf(base));
    place();
    setOpen(true);
  };
  const commit = (next: Date | null) => {
    const local = next ? toLocalValue(next) : "";
    setOpen(false);
    if (local === value()) return;
    setValue(local);
    props.onChange(local);
  };
  const pick = (next: Date | null) => {
    setDraft(next);
    setText(next ? displayText(next) : "");
    setTextValid(true);
    if (next) setMonth(monthOf(next));
  };
  const pickDay = (day: Date) => {
    const time = draft();
    const { year, month, day: date } = partsOf(day);
    pick(zonedDate(year, month, date, time ? partsOf(time).hour : defaultTime()[0], time ? partsOf(time).minute : defaultTime()[1]));
  };
  const pickTime = (time: string) => {
    setHasTime(!!time);
    const [hours, minutes] = time ? time.split(":").map(Number) : defaultTime();
    const { year, month, day } = partsOf(draft() || new Date());
    pick(zonedDate(year, month, day, hours, minutes));
  };
  const typed = (input: string) => {
    setText(input);
    const parsed = parseDateTimeText(input, new Date(), defaultTime());
    // Different defaults only change a date-only parse; an explicit midnight remains explicit.
    const alternate = parseDateTimeText(input, new Date(), defaultTime()[0] === 0 ? [23, 59] : [0, 0]);
    setHasTime(!!parsed && !!alternate && parsed.getTime() === alternate.getTime());
    setTextValid(!input.trim() || !!parsed);
    if (parsed) { setDraft(parsed); setMonth(monthOf(parsed)); }
    else if (!input.trim()) setDraft(null);
  };
  const days = createMemo(() => {
    const first = month(), { year, month: number, weekday } = partsOf(first);
    const weeks = Math.ceil((weekday + new Date(Date.UTC(year, number, 0)).getUTCDate()) / 7);
    const start = addDays(first, -weekday);
    return Array.from({ length: weeks * 7 }, (_, index) => addDays(start, index));
  });
  const timeValue = () => { const date = draft(); return date && hasTime() ? toLocalValue(date).slice(11) : ""; };

  // Clicking outside cancels, like the Cancel button.
  createEffect(() => {
    if (!open()) return;
    const outside = (event: PointerEvent) => { if (!root.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", outside, true);
    addEventListener("scroll", place, true); addEventListener("resize", place);
    onCleanup(() => { document.removeEventListener("pointerdown", outside, true); removeEventListener("scroll", place, true); removeEventListener("resize", place); });
  });

  return <div class="dt-field" ref={root}
    onKeyDown={event => { if (event.key === "Escape" && open()) { event.preventDefault(); event.stopPropagation(); setOpen(false); } }}>
    <input type="hidden" name={props.name} value={value()} disabled={props.disabled} />
    <button type="button" class="dt-display" classList={{ empty: !value() }} aria-label={`${props.label}: ${value() ? formatDateTimeText(fromLocalValue(value())!) : "not set"}`} aria-expanded={open()} disabled={props.disabled} onClick={() => open() ? setOpen(false) : show()}>
      {value() ? formatDateTimeShort(fromLocalValue(value())!) : props.placeholder || "Set date"}
    </button>
    <Show when={open()}>
      <div class="dt-popover" style={position() ? { top: `${position()!.top}px`, left: `${position()!.left}px` } : undefined} role="dialog" aria-label={`Choose ${props.label.toLowerCase()}`}>
        <input class="dt-text" classList={{ invalid: !textValid() }} data-editor-ignore aria-label={`${props.label} as text`} placeholder="mm/dd/yyyy hh:mm AM/PM" value={text()}
          onInput={event => typed(event.currentTarget.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); if (textValid()) commit(draft()); } }} />
        <div class="dt-month">
          <strong>{formatIn(month(), { month: "long", year: "numeric" })}</strong>
          <button type="button" class="icon-button" aria-label="Previous month" onClick={() => setMonth(current => monthOf(current, -1))}>‹</button>
          <button type="button" class="icon-button" aria-label="Next month" onClick={() => setMonth(current => monthOf(current, 1))}>›</button>
        </div>
        <div class="dt-grid">
          <For each={WEEKDAYS}>{name => <span class="dt-weekday">{name}</span>}</For>
          <For each={days()}>{day => <button type="button" class="dt-day" classList={{ outside: partsOf(day).month !== partsOf(month()).month, today: sameDay(new Date(), day), selected: sameDay(draft(), day) }} onClick={() => pickDay(day)}>{partsOf(day).day}</button>}</For>
        </div>
        <label class="dt-time"><span>Time (optional)</span><input type="time" data-editor-ignore aria-label={`${props.label} time`} value={timeValue()} onInput={event => pickTime(event.currentTarget.value)} /></label>
        <small class="field-hint">Without a time: {props.name === "deadline" ? "11:59 PM" : "12:00 AM"}.</small>
        <div class="dt-actions">
          <button type="button" class="text-button" onClick={() => commit(null)}>Clear</button>
          <span class="spacer" />
          <button type="button" class="text-button" onClick={() => setOpen(false)}>Cancel</button>
          <button type="button" class="primary-button" disabled={!textValid()} onClick={() => commit(draft())}>Done</button>
        </div>
      </div>
    </Show>
  </div>;
}
