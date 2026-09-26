import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { formatDateTimeShort, formatDateTimeText, fromLocalValue, parseDateTimeText, toLocalValue } from "./datetime-text";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const sameDay = (a: Date | null, b: Date) => !!a && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/**
 * A date and time picker: a calendar, a separate time (12:00 AM unless set), and an editable text version
 * above them. The value is a hidden "YYYY-MM-DDTHH:mm" input, the same as a datetime-local field.
 */
export function DateTimeField(props: { name: string; label: string; value: string; disabled?: boolean; placeholder?: string; onChange: (value: string) => void }) {
  const [value, setValue] = createSignal(props.value || "");
  createEffect(() => setValue(props.value || ""));
  const [open, setOpen] = createSignal(false);
  const [draft, setDraft] = createSignal<Date | null>(null);
  const [month, setMonth] = createSignal(new Date());
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
    setText(current ? formatDateTimeText(current) : "");
    setTextValid(true);
    const base = current || new Date();
    setMonth(new Date(base.getFullYear(), base.getMonth(), 1));
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
    setText(next ? formatDateTimeText(next) : "");
    setTextValid(true);
    if (next) setMonth(new Date(next.getFullYear(), next.getMonth(), 1));
  };
  const pickDay = (day: Date) => {
    const time = draft();
    pick(new Date(day.getFullYear(), day.getMonth(), day.getDate(), time?.getHours() ?? 0, time?.getMinutes() ?? 0));
  };
  const pickTime = (time: string) => {
    const [hours, minutes] = time ? time.split(":").map(Number) : [0, 0];
    const base = draft() || new Date();
    pick(new Date(base.getFullYear(), base.getMonth(), base.getDate(), hours, minutes));
  };
  const typed = (input: string) => {
    setText(input);
    const parsed = parseDateTimeText(input);
    setTextValid(!input.trim() || !!parsed);
    if (parsed) { setDraft(parsed); setMonth(new Date(parsed.getFullYear(), parsed.getMonth(), 1)); }
    else if (!input.trim()) setDraft(null);
  };
  const days = createMemo(() => {
    const first = month();
    const start = new Date(first.getFullYear(), first.getMonth(), 1 - first.getDay());
    const weeks = Math.ceil((first.getDay() + new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()) / 7);
    return Array.from({ length: weeks * 7 }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index));
  });
  const timeValue = () => { const date = draft(); return date ? `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}` : ""; };

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
        <input class="dt-text" classList={{ invalid: !textValid() }} data-editor-ignore aria-label={`${props.label} as text`} placeholder="e.g. Oct 10 2026 5pm" value={text()}
          onInput={event => typed(event.currentTarget.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); if (textValid()) commit(draft()); } }} />
        <div class="dt-month">
          <strong>{new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(month())}</strong>
          <button type="button" class="icon-button" aria-label="Previous month" onClick={() => setMonth(current => new Date(current.getFullYear(), current.getMonth() - 1, 1))}>‹</button>
          <button type="button" class="icon-button" aria-label="Next month" onClick={() => setMonth(current => new Date(current.getFullYear(), current.getMonth() + 1, 1))}>›</button>
        </div>
        <div class="dt-grid">
          <For each={WEEKDAYS}>{name => <span class="dt-weekday">{name}</span>}</For>
          <For each={days()}>{day => <button type="button" class="dt-day" classList={{ outside: day.getMonth() !== month().getMonth(), today: sameDay(new Date(), day), selected: sameDay(draft(), day) }} onClick={() => pickDay(day)}>{day.getDate()}</button>}</For>
        </div>
        <label class="dt-time"><span>Time</span><input type="time" data-editor-ignore aria-label={`${props.label} time`} value={timeValue()} onInput={event => pickTime(event.currentTarget.value)} /></label>
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
