import { For, Show, createEffect, createSignal, onCleanup } from "solid-js";
import { isoToLocalInput, localInputToIso } from "../../site/domain.js";
import { DateTimeField } from "./DateTimeField";
import { Icon } from "./Icon";

const HOUR = 3_600_000, DAY = 24 * HOUR;
const STEPS: [string, number][] = [["−1 day", -DAY], ["−1 hour", -HOUR], ["+1 hour", HOUR], ["+1 day", DAY]];
const TIMES_OF_DAY: [string, number][] = [["9 AM", 9], ["Noon", 12], ["5 PM", 17], ["9 PM", 21]];

/**
 * The top bar's clock: shows what the app treats as now and opens a small panel to
 * pretend it's another moment (for seeing how Today would look then).
 */
export function TimeControl(props: { now: Date; pretending: boolean; onSet: (at: Date) => void; onStep: (ms: number) => void; onReset: () => void }) {
  const [open, setOpen] = createSignal(false);
  let root!: HTMLDivElement;
  createEffect(() => {
    if (!open()) return;
    const outside = (event: PointerEvent) => { if (!root.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); } };
    document.addEventListener("pointerdown", outside, true); document.addEventListener("keydown", escape, true);
    onCleanup(() => { document.removeEventListener("pointerdown", outside, true); document.removeEventListener("keydown", escape, true); });
  });
  const time = () => props.now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const full = () => props.now.toLocaleString([], { weekday: "short", month: "short", day: "numeric", ...(props.now.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}), hour: "numeric", minute: "2-digit" });
  const atHour = (hour: number) => { const at = new Date(props.now); at.setHours(hour, 0, 0, 0); return at; };
  return <div class="time-control" ref={root} classList={{ pretending: props.pretending }}>
    <button type="button" class="time-control-button" aria-haspopup="dialog" aria-expanded={open()} title={props.pretending ? "Pretend time is on: the app acts as if it's this moment" : "Pretend it's another time"} onClick={() => setOpen(value => !value)}>
      <Icon name="clock" size={15} /><span>{props.pretending ? `Pretending ${full()}` : time()}</span>
    </button>
    <Show when={props.pretending}><button type="button" class="time-control-reset" aria-label="Back to real time" title="Back to real time" onClick={props.onReset}>×</button></Show>
    <Show when={open()}>
      <div class="time-control-panel" role="dialog" aria-label="Pretend time">
        <div class="field"><span>Pretend it's</span><DateTimeField name="pretendAt" label="Pretend it's" value={isoToLocalInput(props.now.toISOString())} onChange={value => { const at = localInputToIso(value); if (at) props.onSet(new Date(at)); }} /></div>
        <div class="time-control-row"><For each={STEPS}>{([label, ms]) => <button type="button" class="secondary-button" onClick={() => props.onStep(ms)}>{label}</button>}</For></div>
        <div class="time-control-row"><span>This day at</span><For each={TIMES_OF_DAY}>{([label, hour]) => <button type="button" class="secondary-button" onClick={() => props.onSet(atHour(hour))}>{label}</button>}</For></div>
        <div class="time-control-footer">
          <small class="field-hint">Only what's shown changes; anything you do is saved at the real time.</small>
          <button type="button" class="text-button" disabled={!props.pretending} onClick={() => { props.onReset(); setOpen(false); }}>Use real time</button>
        </div>
      </div>
    </Show>
  </div>;
}
