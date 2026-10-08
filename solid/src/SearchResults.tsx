import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, type JSX } from "solid-js";
import { textMatches } from "../../site/domain.js";
import { Icon } from "./Icon";
import type { CalendarEvent, Item, Task } from "./types";
import { placementOf } from "./today";
import { when } from "./TodayView";

type Found = Task | CalendarEvent;
type Result = { item: Found; at: Date | null; detail: string };

const LIMIT = 30;
const time = (value?: string | null) => { const date = value ? new Date(value) : null; return date && !Number.isNaN(date.getTime()) ? date : null; };

/** A task's or event's moment and what the results say about it, worded as List words it; `past` is whether it's behind you. */
function describe(item: Found, items: Item[], now: Date): Result & { past: boolean } {
  if (item.kind === "event") {
    const start = time(item.start), end = time(item.end) ?? start;
    return { item, at: start, detail: start ? when(start, now) : "No date", past: !!end && end < now };
  }
  const placement = placementOf(item, items, now);
  if (placement.section === "completed") {
    const done = time(item.completedAt);
    return { item, at: done, detail: done ? `Done ${when(done, now)}` : "Done", past: true };
  }
  const { due, opens, closes, next } = placement;
  const at = due ?? next ?? opens ?? null;
  const detail = placement.overdue && due ? `Overdue · was due ${when(due, now)}`
    : placement.section === "later" && opens ? `Opens ${when(opens, now)}`
    : placement.section === "closing" && closes ? `Open until ${when(closes, now)}`
    : placement.section === "upcoming" ? (next ? `Can start ${when(next, now)}` : "Can't start yet")
    : due ? `Due ${when(due, now)}` : "Available";
  return { item, at, detail, past: false };
}

/**
 * Search that finds: every task and event matching the query, wherever they are and whenever they
 * were. What's still ahead comes first, soonest first (undated tasks last), then what's done or
 * past, latest first. The search field's keys move through them (ArrowUp/Down, Enter, Escape).
 */
export function createFind(props: { items: () => Item[]; query: () => string; now: () => Date; onOpen: (item: Found) => void }) {
  const [dismissed, setDismissed] = createSignal(false);
  const [active, setActive] = createSignal(0);
  createEffect(on(props.query, () => { setDismissed(false); setActive(0); }, { defer: true }));

  const groups = createMemo(() => {
    const query = props.query().trim();
    if (!query) return null;
    const now = props.now();
    const found = props.items()
      .filter((item): item is Found => (item.kind === "task" || item.kind === "event") && textMatches(item, query))
      .map(item => describe(item, props.items(), now));
    const ahead = found.filter(result => !result.past).sort((a, b) => (a.at?.getTime() ?? Infinity) - (b.at?.getTime() ?? Infinity));
    const behind = found.filter(result => result.past).sort((a, b) => (b.at?.getTime() ?? -Infinity) - (a.at?.getTime() ?? -Infinity));
    const shownAhead = ahead.slice(0, LIMIT), shownBehind = behind.slice(0, LIMIT - shownAhead.length);
    return { ahead: shownAhead, behind: shownBehind, more: found.length - shownAhead.length - shownBehind.length };
  });
  const flat = () => { const shown = groups(); return shown ? [...shown.ahead, ...shown.behind] : []; };
  const open = () => !!groups() && !dismissed();
  const choose = (result: Result) => { setDismissed(true); props.onOpen(result.item); };

  const onKeyDown = (event: KeyboardEvent) => {
    if (!open()) { if (event.key === "ArrowDown" && groups()) { event.preventDefault(); setDismissed(false); } return; }
    const results = flat();
    if (event.key === "ArrowDown") { event.preventDefault(); setActive(index => Math.min(index + 1, results.length - 1)); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActive(index => Math.max(index - 1, 0)); }
    else if (event.key === "Enter" && results[active()]) { event.preventDefault(); choose(results[active()]); }
    else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setDismissed(true); }
  };

  let panel: HTMLDivElement | undefined;
  // A press anywhere but the search closes the results (focusing the field again reopens them).
  const outside = (event: PointerEvent) => { if (!(event.target instanceof Node && panel?.parentElement?.contains(event.target))) setDismissed(true); };
  document.addEventListener("pointerdown", outside);
  onCleanup(() => document.removeEventListener("pointerdown", outside));
  createEffect(() => { if (open()) panel?.querySelector(".search-result.active")?.scrollIntoView({ block: "nearest" }); });

  const row = (result: Result, index: number): JSX.Element => <li role="option" aria-selected={index === active()}>
    <button type="button" tabIndex={-1} class="search-result" classList={{ active: index === active() }} onPointerMove={() => setActive(index)} onClick={() => choose(result)}>
      <Icon name={result.item.kind === "event" ? "calendar" : result.item.state === "completed" ? "done" : "check"} size={16} />
      <span><strong>{result.item.title || (result.item.kind === "event" ? "Untitled event" : "Untitled task")}</strong><small>{result.detail}</small></span>
    </button>
  </li>;

  const view = <Show when={open() && groups()}>{shown => <div class="search-results" ref={panel} id="search-results">
    <Show when={shown().ahead.length || shown().behind.length} fallback={<p class="search-results-empty">Nothing matches.</p>}>
      <Show when={shown().ahead.length}><h3>Open and coming up</h3><ul role="listbox" aria-label="Open and coming up"><For each={shown().ahead}>{(result, index) => row(result, index())}</For></ul></Show>
      <Show when={shown().behind.length}><h3>Done and past</h3><ul role="listbox" aria-label="Done and past"><For each={shown().behind}>{(result, index) => row(result, shown().ahead.length + index())}</For></ul></Show>
      <Show when={shown().more > 0}><p class="search-results-empty">{shown().more} more; search for more of the title to narrow it down.</p></Show>
    </Show>
  </div>}</Show>;

  return { view, onKeyDown, open, reopen: () => setDismissed(false) };
}
