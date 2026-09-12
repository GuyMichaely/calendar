import { For, createEffect, createSignal, on, onCleanup, untrack, type Accessor, type JSX } from "solid-js";

// Keep departing rows mounted while their grid height collapses. An undo during
// the transition cancels removal and reuses the same row and its focus state.
export function TaskPresence(props: { fallback?: JSX.Element; ids: Accessor<string[]>; animate: Accessor<boolean>; children: (id: string, present: Accessor<boolean>) => JSX.Element }) {
  const [ids, setIds] = createSignal<string[]>([]);
  const [entering, setEntering] = createSignal(new Set<string>());
  const removals = new Map<string, ReturnType<typeof setTimeout>>();
  const frames = new Set<number>();
  let initialized = false;
  createEffect(on([props.ids, props.animate], ([next, enabled]) => {
    const animate = enabled;
    const previous = untrack(ids);
    const nextSet = new Set(next);
    for (const id of next) { clearTimeout(removals.get(id)); removals.delete(id); }
    if (!animate) {
      for (const timer of removals.values()) clearTimeout(timer);
      removals.clear(); setEntering(new Set<string>()); setIds(next); initialized = true; return;
    }
    const newIds = initialized ? next.filter(id => !previous.includes(id)) : [];
    if (newIds.length) {
      setEntering(current => new Set([...current, ...newIds]));
      const frame = requestAnimationFrame(() => {
        frames.delete(frame);
        const second = requestAnimationFrame(() => {
          frames.delete(second);
          setEntering(current => new Set([...current].filter(id => !newIds.includes(id))));
        }); frames.add(second);
      }); frames.add(frame);
    }
    const rendered = [...next];
    previous.forEach((id, index) => {
      if (nextSet.has(id)) return;
      rendered.splice(Math.min(index, rendered.length), 0, id);
      if (!removals.has(id)) removals.set(id, setTimeout(() => {
        removals.delete(id); setIds(current => current.filter(value => value !== id));
      }, 220));
    });
    setIds(rendered); initialized = true;
  }));
  onCleanup(() => { for (const timer of removals.values()) clearTimeout(timer); for (const frame of frames) cancelAnimationFrame(frame); });
  return <For each={ids()} fallback={props.fallback}>{id => props.children(id, () => props.ids().includes(id) && !entering().has(id))}</For>;
}
